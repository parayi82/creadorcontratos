// netlify/functions/despacho-cartera.js
//
// Auto-gestión de cartera para usuarios tipo despacho.
// Solo despachos autenticados pueden llamar esta función.
//
// Acciones (POST con JSON { accion: ... }):
//   { accion:'listar' }
//       → devuelve clientes activos del despacho (filtrado server-side por despacho_id)
//   { accion:'agregar', rfc, empresa, num_trabajadores? }
//       → agrega cliente a despacho_clientes del despacho que llama
//         (rechaza si el RFC ya tiene datos en la plataforma — debe ir al admin)
//   { accion:'quitar', rfc }
//       → desactiva al cliente en la cartera del despacho
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const rl = await checkRateLimit(clientIp(event), 'despacho-cartera', 20, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };
  }

  // Supabase client con timeout de 5 s por llamada.
  // Netlify corta a 10 s; con 5 s queda margen para el manejo de errores.
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    global: {
      fetch: (url, options = {}) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
      },
    },
  });

  const ok  = (obj)       => ({ statusCode: 200, headers, body: JSON.stringify(obj) });
  const err = (code, msg) => ({ statusCode: code, headers, body: JSON.stringify({ error: msg }) });

  // Todo dentro del try-catch principal para que cualquier cuelgue quede atrapado
  try {
    const { data: uData, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !uData?.user) return err(401, 'Sesión no válida.');

    const user = uData.user;
    const meta = user.user_metadata || {};

    if (meta.tipo !== 'despacho') {
      return err(403, 'Esta función es solo para cuentas de despacho.');
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return err(400, 'JSON inválido'); }

    // Obtener perfil del despacho (id + límite manual de clientes)
    const { data: desp, error: despErr } = await sb
      .from('despachos')
      .select('id, rango')
      .eq('auth_user_id', user.id)
      .eq('activo', true)
      .maybeSingle();
    if (despErr) return err(500, `Error al buscar perfil de despacho: ${despErr.message}`);
    if (!desp) return err(404, 'No se encontró perfil de despacho activo. Contacte a su asesor.');

    // ─────────────────────────────────────────────────────────────────
    switch (body.accion) {

      // ── LISTAR ───────────────────────────────────────────────────
      case 'listar': {
        // Intentar con num_trabajadores; si la columna no existe, listar sin ella
        let clientes = [];
        const { data: c1, error: e1 } = await sb
          .from('despacho_clientes')
          .select('cliente_rfc, empresa, num_trabajadores')
          .eq('despacho_id', desp.id)
          .eq('activo', true)
          .order('empresa');

        if (!e1) {
          clientes = c1 || [];
        } else {
          // Columna num_trabajadores aún no migrada — listar sin ella
          const { data: c2, error: e2 } = await sb
            .from('despacho_clientes')
            .select('cliente_rfc, empresa')
            .eq('despacho_id', desp.id)
            .eq('activo', true)
            .order('empresa');
          if (e2) throw e2;
          clientes = (c2 || []).map(r => ({ ...r, num_trabajadores: null }));
        }

        return ok({ clientes });
      }

      // ── AGREGAR ───────────────────────────────────────────────────
      case 'agregar': {
        const { rfc, empresa, num_trabajadores } = body;
        if (!rfc) return err(400, 'Falta el RFC del cliente.');
        const rfcU = String(rfc).toUpperCase().trim();

        if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfcU)) {
          return err(400, 'Formato de RFC inválido.');
        }

        // Rechazar si el RFC ya tiene trabajadores registrados (el admin lo vincula)
        const { count: trabCount } = await sb
          .from('trabajadores')
          .select('*', { count: 'exact', head: true })
          .eq('cliente_rfc', rfcU);
        if ((trabCount || 0) > 0) {
          return err(409, 'Este RFC ya tiene información en la plataforma. Para vincularlo a su cartera, solicítelo a su asesor ClickLaboral.');
        }

        // Verificar que no está ya activo en esta cartera
        const { count: yaExiste } = await sb
          .from('despacho_clientes')
          .select('*', { count: 'exact', head: true })
          .eq('despacho_id', desp.id)
          .eq('cliente_rfc', rfcU)
          .eq('activo', true);
        if ((yaExiste || 0) > 0) return err(409, 'Ese RFC ya está en su cartera.');

        // Límite de clientes: el rango se configura manualmente por admin en la tabla despachos.
        // No está ligado a los paquetes/precios del portal de clientes.
        const LIMITES = { '3-9': 9, '10-24': 24, '25-49': 49, '50+': Infinity };
        const maximo  = LIMITES[desp.rango] ?? Infinity;
        if (isFinite(maximo)) {
          const { count: totalActivos } = await sb
            .from('despacho_clientes')
            .select('*', { count: 'exact', head: true })
            .eq('despacho_id', desp.id)
            .eq('activo', true);
          if ((totalActivos || 0) >= maximo) {
            return err(403, `Límite de clientes alcanzado para este despacho (${maximo}). Contacte a su asesor para ampliar.`);
          }
        }

        // Insertar/reactivar el cliente (sin num_trabajadores para evitar error si columna no existe)
        const { error: insErr } = await sb.from('despacho_clientes').upsert({
          despacho_id: desp.id,
          cliente_rfc: rfcU,
          empresa:     (empresa || rfcU).trim(),
          activo:      true,
          agregado_at: new Date().toISOString(),
        }, { onConflict: 'despacho_id,cliente_rfc' });
        if (insErr) throw insErr;

        // Intentar guardar planta estimada (falla silenciosamente si la columna aún no existe)
        const numTrab = num_trabajadores != null ? parseInt(num_trabajadores, 10) : null;
        if (Number.isFinite(numTrab) && numTrab > 0) {
          try {
            await sb.from('despacho_clientes')
              .update({ num_trabajadores: numTrab })
              .eq('despacho_id', desp.id)
              .eq('cliente_rfc', rfcU);
          } catch (_) { /* columna no migrada aún */ }
        }

        return ok({ ok: true, rfc: rfcU });
      }

      // ── QUITAR ────────────────────────────────────────────────────
      case 'quitar': {
        const { rfc } = body;
        if (!rfc) return err(400, 'Falta el RFC del cliente.');
        const rfcU = String(rfc).toUpperCase().trim();

        // Verificar que el cliente pertenece a este despacho antes de actualizar
        const { count: existe } = await sb
          .from('despacho_clientes')
          .select('*', { count: 'exact', head: true })
          .eq('despacho_id', desp.id)
          .eq('cliente_rfc', rfcU)
          .eq('activo', true);

        if ((existe || 0) === 0) {
          return err(404, 'Ese cliente no está en su cartera activa.');
        }

        const { error: updErr } = await sb
          .from('despacho_clientes')
          .update({ activo: false })
          .eq('despacho_id', desp.id)
          .eq('cliente_rfc', rfcU);
        if (updErr) throw updErr;

        return ok({ ok: true, rfc: rfcU });
      }

      default:
        return err(400, 'Acción no reconocida.');
    }

  } catch (e) {
    console.error('despacho-cartera:', e?.message || e);
    // Fire-and-forget: no await para no acercarnos al límite de 10 s de Netlify
    reportError('despacho-cartera', e).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'Error interno.' }) };
  }
};
