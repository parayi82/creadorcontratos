// netlify/functions/mis-alertas.js
//
// Devuelve y gestiona alertas laborales para el cliente autenticado.
// Soporta usuarios directos (su RFC = cliente_rfc) y despachos (gestionan
// clientes de su cartera). Usa la clave de servicio para omitir RLS y evitar
// que la política antigua basada en raw_user_meta_data bloquee las consultas.
//
// POST /api/mis-alertas   { accion, cliente_rfc, id? }
//   accion = 'listar'       → { alertas: [...] }
//   accion = 'contar'       → { sin_leer: N }
//   accion = 'marcar_leida' → { ok: true }   (requiere id)
//   accion = 'marcar_todas' → { ok: true }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY

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

  const rl = await checkRateLimit(clientIp(event), 'mis-alertas', 60, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Variables de entorno faltantes.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };
  }

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

  try {
    const { data: uData, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !uData?.user) return err(401, 'Sesión no válida.');

    const user = uData.user;
    const meta = user.user_metadata || {};
    const esDespacho = meta.tipo === 'despacho';

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return err(400, 'JSON inválido.'); }

    const { accion, cliente_rfc: rfcRaw, id } = body;
    if (!accion) return err(400, 'Falta accion.');
    if (!rfcRaw) return err(400, 'Falta cliente_rfc.');
    const clienteRFC = String(rfcRaw).toUpperCase().trim();

    // ── Verificar autorización ────────────────────────────────────────
    if (esDespacho) {
      const { data: desp, error: despErr } = await sb
        .from('despachos')
        .select('id')
        .eq('auth_user_id', user.id)
        .eq('activo', true)
        .maybeSingle();
      if (despErr) return err(500, `Error al verificar despacho: ${despErr.message}`);
      if (!desp) return err(403, 'No se encontró perfil de despacho activo.');

      const { count: enCartera } = await sb
        .from('despacho_clientes')
        .select('*', { count: 'exact', head: true })
        .eq('despacho_id', desp.id)
        .eq('cliente_rfc', clienteRFC)
        .eq('activo', true);
      if ((enCartera || 0) === 0) return err(403, 'El cliente no pertenece a su cartera.');
    } else {
      const rfcUsuario = String(meta.rfc || '').toUpperCase().trim();
      if (!rfcUsuario || rfcUsuario !== clienteRFC) {
        return err(403, 'No tiene acceso a las alertas de ese cliente.');
      }
    }

    // ── Acciones ──────────────────────────────────────────────────────
    switch (accion) {

      case 'listar': {
        const { data: alertas, error: aErr } = await sb
          .from('alertas_laborales')
          .select('*')
          .eq('cliente_rfc', clienteRFC)
          .or('resuelta.is.null,resuelta.eq.false')
          .order('urgencia', { ascending: true })
          .order('fecha_alerta', { ascending: false })
          .limit(200);
        if (aErr) return err(500, aErr.message);
        return ok({ alertas: alertas || [] });
      }

      case 'contar': {
        const { count, error: cErr } = await sb
          .from('alertas_laborales')
          .select('*', { count: 'exact', head: true })
          .eq('cliente_rfc', clienteRFC)
          .eq('leida', false)
          .or('resuelta.is.null,resuelta.eq.false');
        if (cErr) return err(500, cErr.message);
        return ok({ sin_leer: count || 0 });
      }

      case 'marcar_leida': {
        if (!id) return err(400, 'Falta id de la alerta.');
        const { error: mErr } = await sb
          .from('alertas_laborales')
          .update({ leida: true })
          .eq('id', id)
          .eq('cliente_rfc', clienteRFC);
        if (mErr) return err(500, mErr.message);
        return ok({ ok: true });
      }

      case 'marcar_todas': {
        const { error: mtErr } = await sb
          .from('alertas_laborales')
          .update({ leida: true })
          .eq('cliente_rfc', clienteRFC)
          .eq('leida', false);
        if (mtErr) return err(500, mtErr.message);
        return ok({ ok: true });
      }

      default:
        return err(400, `Acción desconocida: ${accion}`);
    }

  } catch (e) {
    console.error('mis-alertas:', e?.message || e);
    reportError('mis-alertas', e).catch(() => {});
    return err(500, e?.message || 'Error interno.');
  }
};
