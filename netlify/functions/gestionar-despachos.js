// netlify/functions/gestionar-despachos.js
//
// Alta y gestión de despachos (contadores/abogados/RRHH en marca blanca)
// desde el dashboard de administración, usando la service_role key.
//
// Acciones (POST con JSON { accion: ... }):
//   { accion:'listar' }
//       → lista de despachos con su cartera (lee de tabla despachos/despacho_clientes)
//   { accion:'crear', email, password, nombre_despacho, color?, clientes? }
//       → crea el usuario tipo despacho en Auth + tabla despachos
//   { accion:'agregar_cliente', despacho_id, rfc, empresa }
//       → agrega cliente a despacho_clientes + sincroniza user_metadata
//   { accion:'quitar_cliente', despacho_id, rfc }
//       → desactiva cliente en despacho_clientes + sincroniza user_metadata
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { verificarAdmin } = require('./_admin-auth');

const LIMITES_PLAN = { '3-9': 9, '10-24': 24, '25-49': 49, '50+': Infinity };

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  const rl = await checkRateLimit(clientIp(event), 'gestionar-despachos', 20, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.limitedAt);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno de Supabase.' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const admin = await verificarAdmin(event, supabase);
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado. Inicie sesión como administrador.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const ok  = (obj)       => ({ statusCode: 200, headers, body: JSON.stringify(obj) });
  const err = (code, msg) => ({ statusCode: code, headers, body: JSON.stringify({ error: msg }) });

  try {
    switch (body.accion) {

      // ── listar ──────────────────────────────────────────────────────────────
      case 'listar': {
        const { data: desps, error: e1 } = await supabase
          .from('despachos')
          .select('*, despacho_clientes(cliente_rfc, empresa, activo, agregado_at)')
          .eq('activo', true)
          .order('created_at', { ascending: false });
        if (e1) throw e1;

        return ok({
          despachos: (desps || []).map(d => ({
            id:       d.id,
            auth_id:  d.auth_user_id,
            nombre:   d.nombre,
            color:    d.color,
            tipo:     d.tipo,
            rango:    d.rango,
            clientes: (d.despacho_clientes || [])
              .filter(c => c.activo)
              .map(c => ({ rfc: c.cliente_rfc, empresa: c.empresa, desde: c.agregado_at })),
          })),
        });
      }

      // ── crear ────────────────────────────────────────────────────────────────
      case 'crear': {
        const { email, password, nombre_despacho, color, clientes, tipo_despacho, rango_clientes } = body;
        if (!email || !password || !nombre_despacho) {
          return err(400, 'Faltan datos: email, password y nombre_despacho son obligatorios.');
        }
        if (password.length < 8) return err(400, 'La contraseña debe tener al menos 8 caracteres.');

        const clientesArr = Array.isArray(clientes) ? clientes : [];

        // 1. Crear usuario en Auth
        const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          password,
          email_confirm: true,
          user_metadata: {
            tipo:              'despacho',
            nombre_despacho:   nombre_despacho.trim(),
            color:             color || '#1e3a5f',
            tipo_despacho:     tipo_despacho || 'contador',
            rango_clientes:    rango_clientes || '3-9',
            despacho_clientes: clientesArr,
          },
        });
        if (authErr) {
          if (/already/i.test(authErr.message)) return err(409, 'Ya existe un usuario con ese correo.');
          throw authErr;
        }

        const authUserId = authData.user.id;

        // 2. Insertar en tabla despachos
        const { data: desp, error: despErr } = await supabase.from('despachos').insert({
          auth_user_id: authUserId,
          nombre:       nombre_despacho.trim(),
          color:        color || '#1e3a5f',
          tipo:         tipo_despacho || 'contador',
          rango:        rango_clientes || '3-9',
        }).select('id').single();
        if (despErr) throw despErr;

        // 3. Insertar clientes iniciales si los hay
        if (clientesArr.length > 0) {
          const filas = clientesArr
            .filter(c => c && c.rfc)
            .map(c => ({
              despacho_id: desp.id,
              cliente_rfc: String(c.rfc).toUpperCase().trim(),
              empresa:     c.empresa || String(c.rfc).toUpperCase().trim(),
            }));
          if (filas.length) {
            const { error: cliErr } = await supabase.from('despacho_clientes').insert(filas);
            if (cliErr) throw cliErr;
          }
        }

        return ok({ ok: true, id: authUserId, despacho_id: desp.id, mensaje: 'Despacho creado. Entrega estas credenciales al despacho.' });
      }

      // ── agregar_cliente ──────────────────────────────────────────────────────
      case 'agregar_cliente': {
        const { despacho_id, rfc, empresa } = body;
        if (!despacho_id || !rfc) return err(400, 'Faltan despacho_id y rfc.');
        const rfcU = String(rfc).toUpperCase().trim();

        // Leer despacho
        const { data: desp, error: e1 } = await supabase
          .from('despachos')
          .select('id, auth_user_id, rango')
          .eq('id', despacho_id)
          .single();
        if (e1 || !desp) return err(404, 'Despacho no encontrado.');

        // Verificar límite del plan
        const { count } = await supabase
          .from('despacho_clientes')
          .select('*', { count: 'exact', head: true })
          .eq('despacho_id', despacho_id)
          .eq('activo', true);
        const maximo = LIMITES_PLAN[desp.rango] ?? 9;
        if ((count || 0) >= maximo) {
          return err(403, `Límite de clientes alcanzado para el plan ${desp.rango}. Actualice el plan del despacho.`);
        }

        // Insertar o reactivar
        const { error: insErr } = await supabase.from('despacho_clientes').upsert({
          despacho_id,
          cliente_rfc: rfcU,
          empresa:     (empresa || rfcU).trim(),
          activo:      true,
          agregado_at: new Date().toISOString(),
        }, { onConflict: 'despacho_id,cliente_rfc' });
        if (insErr) throw insErr;

        // Sincronizar user_metadata (backward compat para RLS basada en JWT)
        await sincronizarMetadata(supabase, desp.auth_user_id, despacho_id);

        return ok({ ok: true });
      }

      // ── quitar_cliente ───────────────────────────────────────────────────────
      case 'quitar_cliente': {
        const { despacho_id, rfc } = body;
        if (!despacho_id || !rfc) return err(400, 'Faltan despacho_id y rfc.');
        const rfcU = String(rfc).toUpperCase().trim();

        const { data: desp } = await supabase
          .from('despachos')
          .select('auth_user_id')
          .eq('id', despacho_id)
          .single();
        if (!desp) return err(404, 'Despacho no encontrado.');

        await supabase.from('despacho_clientes')
          .update({ activo: false })
          .eq('despacho_id', despacho_id)
          .eq('cliente_rfc', rfcU);

        await sincronizarMetadata(supabase, desp.auth_user_id, despacho_id);

        return ok({ ok: true });
      }

      default:
        return err(400, 'Acción no reconocida.');
    }
  } catch (e) {
    console.error('gestionar-despachos:', e.message || e);
    await reportError('gestionar-despachos', e);
    return err(500, e.message || 'Error interno.');
  }
};

// Mantiene user_metadata.despacho_clientes sincronizado con la tabla
// para que el JWT siga funcionando en RLS durante la transición.
async function sincronizarMetadata(supabase, authUserId, despachoId) {
  const { data: clientes } = await supabase
    .from('despacho_clientes')
    .select('cliente_rfc, empresa')
    .eq('despacho_id', despachoId)
    .eq('activo', true);

  const lista = (clientes || []).map(c => ({ rfc: c.cliente_rfc, empresa: c.empresa }));

  const { data: user } = await supabase.auth.admin.getUserById(authUserId);
  await supabase.auth.admin.updateUserById(authUserId, {
    user_metadata: {
      ...(user?.user?.user_metadata || {}),
      despacho_clientes: lista,
    },
  });
}
