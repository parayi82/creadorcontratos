// netlify/functions/mutar-datos-cliente.js
//
// Proxy de escritura autenticado para trabajadores, asistencias y Storage.
// Usa la service_role para bypassear RLS, pero valida primero que el
// llamante sea un cliente con su propio RFC o un despacho con ese
// cliente en su lista autorizada.
//
// POST { tabla, accion, cliente_rfc, payload, filtros? }
//   tabla:  'trabajadores' | 'asistencias' | 'storage_remove'
//   accion: 'insert' | 'update' | 'upsert' | 'delete' | 'remove'
//   cliente_rfc: RFC del cliente dueño de los datos
//   payload: objeto o array de datos
//   filtros: { campo: valor, ... } para WHERE en update/delete
//   conflicto: string (solo para upsert, ej. 'trabajador_id,fecha')
//
// Authorization: Bearer <access_token>
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

const TABLAS_PERMITIDAS = ['trabajadores', 'asistencias', 'evaluaciones_psicometricas', 'movimientos_trabajador', 'vacaciones_programadas', 'checadores'];
const TABLAS_LECTURA   = ['trabajadores', 'asistencias', 'documentos_identidad', 'documentos_expediente', 'evaluaciones_psicometricas', 'movimientos_trabajador', 'vacaciones_programadas', 'checadores'];

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  const rl = await checkRateLimit(clientIp(event), 'mutar-datos', 60, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  const meta = uData.user.user_metadata || {};
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { tabla, accion, cliente_rfc, payload, filtros, conflicto, paths } = body;
  const rfcU = String(cliente_rfc || '').toUpperCase().trim();

  if (!rfcU) return { statusCode: 400, headers, body: JSON.stringify({ error: 'cliente_rfc es obligatorio.' }) };

  if (!await puedeAccederRFC(sb, uData.user, rfcU)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado para este cliente.' }) };
  }

  // ── Storage remove ──
  if (tabla === 'storage_remove') {
    if (!Array.isArray(paths) || !paths.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'paths[] es obligatorio para storage_remove.' }) };
    }
    // Validar que cada path comience con el RFC del cliente
    const pathsInvalidos = paths.filter(p => !String(p).toUpperCase().startsWith(rfcU));
    if (pathsInvalidos.length) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Paths no pertenecen al cliente.' }) };
    }
    const { error } = await sb.storage.from('expedientes').remove(paths);
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // ── SELECT (lectura) — para despachos que no pueden leer con su propio JWT ──
  if (accion === 'select') {
    if (!TABLAS_LECTURA.includes(tabla)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: `Lectura no permitida en tabla: ${tabla}` }) };
    }
    const columnas = body.columnas || '*';
    const filtros_sel = body.filtros || {};
    let q = sb.from(tabla).select(columnas).eq('cliente_rfc', rfcU);
    for (const [k, v] of Object.entries(filtros_sel)) {
      if (k === 'activo') {
        if (v === false || v === 'false') q = q.or('activo.eq.false,fecha_baja.not.is.null');
        else q = q.eq(k, v).is('fecha_baja', null);
      } else if (k === 'gte') {
        for (const [campo, val] of Object.entries(v)) q = q.gte(campo, val);
      } else if (k === 'lte') {
        for (const [campo, val] of Object.entries(v)) q = q.lte(campo, val);
      } else if (k === '_ilike') {
        for (const [campo, val] of Object.entries(v)) q = q.ilike(campo, val);
      } else if (k === 'trabajador_id') {
        q = q.eq('trabajador_id', v);
      } else q = q.eq(k, v);
    }
    if (body.order)  q = q.order(body.order.campo, { ascending: body.order.asc ?? true });
    if (body.limit)  q = q.limit(body.limit);
    if (body.single) q = q.maybeSingle();
    const { data, error } = await q;
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data }) };
  }

  // ── Tablas de datos ──
  if (!TABLAS_PERMITIDAS.includes(tabla)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Tabla no permitida: ${tabla}` }) };
  }
  if (!['insert', 'update', 'upsert', 'delete'].includes(accion)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Acción no permitida: ${accion}` }) };
  }

  // Inyectar cliente_rfc en el payload para garantizar integridad
  const inyectar = data => {
    if (Array.isArray(data)) return data.map(r => ({ ...r, cliente_rfc: rfcU }));
    return { ...data, cliente_rfc: rfcU };
  };

  try {
    let q = sb.from(tabla);
    let error;

    // Para trabajadores/asistencias: garantizar que el cliente existe en la tabla clientes (FK)
    // Los clientes de despacho no pasan por el flujo de pago y no tienen registro en clientes.
    if ((tabla === 'trabajadores' || tabla === 'asistencias') && (accion === 'insert' || accion === 'upsert')) {
      try {
        // Verificar si ya existe
        const { data: existe } = await sb.from('clientes').select('rfc').eq('rfc', rfcU).maybeSingle();
        if (!existe) {
          // Insertar con columnas mínimas requeridas por el esquema
          // Intentar con columnas progresivas: primero las comunes, luego solo rfc
          // Columnas confirmadas del esquema real: rfc (PK), empresa (NOT NULL)
          const empresaNombre = body.empresa_nombre && body.empresa_nombre !== rfcU
            ? body.empresa_nombre : rfcU;
          const { error: insClienteErr } = await sb.from('clientes')
            .insert({ rfc: rfcU, empresa: empresaNombre });
          if (insClienteErr) {
            console.warn('No se pudo crear el cliente en tabla clientes:', insClienteErr.message);
          } else {
            console.log('Cliente de despacho registrado en tabla clientes:', rfcU, '/', empresaNombre);
          }
        }
      } catch (fkErr) {
        console.warn('Error verificando/creando cliente en tabla clientes:', fkErr.message);
      }
    }

    if (accion === 'insert') {
      ({ error } = await q.insert(inyectar(payload)));
    } else if (accion === 'upsert') {
      const opts = conflicto ? { onConflict: conflicto } : {};
      ({ error } = await q.upsert(inyectar(payload), opts));
    } else if (accion === 'update') {
      if (!filtros) return { statusCode: 400, headers, body: JSON.stringify({ error: 'filtros es obligatorio para update.' }) };
      let upQ = q.update(payload);
      upQ = upQ.eq('cliente_rfc', rfcU);
      for (const [k, v] of Object.entries(filtros)) upQ = upQ.eq(k, v);
      ({ error } = await upQ);
    } else if (accion === 'delete') {
      if (!filtros) return { statusCode: 400, headers, body: JSON.stringify({ error: 'filtros es obligatorio para delete.' }) };
      let delQ = q.delete().eq('cliente_rfc', rfcU);
      for (const [k, v] of Object.entries(filtros)) delQ = delQ.eq(k, v);
      ({ error } = await delQ);
    }

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('mutar-datos-cliente:', e.message || e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Error interno.' }) };
  }
};
