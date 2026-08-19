// netlify/functions/despacho-cartera.js
//
// Auto-gestión de cartera para usuarios tipo despacho.
// Solo despachos autenticados pueden llamar esta función.
//
// Acciones (POST con JSON { accion: ... }):
//   { accion:'agregar', rfc, empresa }
//       → agrega cliente a despacho_clientes del despacho que llama
//         (rechaza si el RFC ya tiene datos en la plataforma — debe ir al admin)
//
// Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  const rl = await checkRateLimit(clientIp(event), 'despacho-cartera', 20, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  const user = uData.user;
  const meta = user.user_metadata || {};

  if (meta.tipo !== 'despacho') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Esta función es solo para cuentas de despacho.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const ok  = (obj)       => ({ statusCode: 200, headers, body: JSON.stringify(obj) });
  const err = (code, msg) => ({ statusCode: code, headers, body: JSON.stringify({ error: msg }) });

  try {
    // Obtener el despacho_id del usuario que llama
    const { data: desp, error: despErr } = await sb
      .from('despachos')
      .select('id, rango')
      .eq('auth_user_id', user.id)
      .eq('activo', true)
      .maybeSingle();
    if (despErr) return err(500, `Error al buscar perfil de despacho: ${despErr.message}`);
    if (!desp) return err(404, 'No se encontró perfil de despacho activo. Contacte a su asesor para verificar su cuenta.');

    switch (body.accion) {

      case 'agregar': {
        const { rfc, empresa, num_trabajadores } = body;
        if (!rfc) return err(400, 'Falta el RFC del cliente.');
        const rfcU = String(rfc).toUpperCase().trim();

        // Validar formato RFC
        if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfcU)) {
          return err(400, 'Formato de RFC inválido.');
        }

        // Verificar si el RFC ya tiene datos en la plataforma (lo gestiona el admin)
        const { count: trabCount } = await sb
          .from('trabajadores')
          .select('*', { count: 'exact', head: true })
          .eq('cliente_rfc', rfcU);
        if ((trabCount || 0) > 0) {
          return err(409, 'Este RFC ya tiene información registrada en la plataforma. Para vincularlo a su cartera, solicítelo a su asesor ClickLaboral.');
        }

        // Verificar que no está ya activo en esta cartera
        const { count: yaExiste } = await sb
          .from('despacho_clientes')
          .select('*', { count: 'exact', head: true })
          .eq('despacho_id', desp.id)
          .eq('cliente_rfc', rfcU)
          .eq('activo', true);
        if ((yaExiste || 0) > 0) return err(409, 'Ese RFC ya está en su cartera.');

        // Verificar límite del plan
        const LIMITES = { '3-9': 9, '10-24': 24, '25-49': 49, '50+': Infinity };
        const { count: totalActivos } = await sb
          .from('despacho_clientes')
          .select('*', { count: 'exact', head: true })
          .eq('despacho_id', desp.id)
          .eq('activo', true);
        const maximo = LIMITES[desp.rango] ?? 9;
        if ((totalActivos || 0) >= maximo) {
          return err(403, `Límite de clientes alcanzado para su plan (${desp.rango}). Contacte a su asesor para ampliar el plan.`);
        }

        const numTrab = num_trabajadores != null ? parseInt(num_trabajadores, 10) : null;
        const { error: insErr } = await sb.from('despacho_clientes').upsert({
          despacho_id:      desp.id,
          cliente_rfc:      rfcU,
          empresa:          (empresa || rfcU).trim(),
          activo:           true,
          agregado_at:      new Date().toISOString(),
          num_trabajadores: Number.isFinite(numTrab) && numTrab > 0 ? numTrab : null,
        }, { onConflict: 'despacho_id,cliente_rfc' });
        if (insErr) throw insErr;

        // Guardar num_trabajadores en columna separada (requiere migración).
        // Si la columna aún no existe se ignora el error para no bloquear el alta.
        const numTrab = num_trabajadores != null ? parseInt(num_trabajadores, 10) : null;
        if (Number.isFinite(numTrab) && numTrab > 0) {
          try {
            await sb.from('despacho_clientes')
              .update({ num_trabajadores: numTrab })
              .eq('despacho_id', desp.id)
              .eq('cliente_rfc', rfcU);
          } catch (_) { /* columna no existe aún — se ignorará */ }
        }

        return ok({ ok: true, rfc: rfcU });
      }

      case 'quitar': {
        const { rfc } = body;
        if (!rfc) return err(400, 'Falta el RFC del cliente.');
        const rfcU = String(rfc).toUpperCase().trim();
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
    console.error('despacho-cartera:', e.message || e);
    await reportError('despacho-cartera', e);
    return err(500, e.message || 'Error interno.');
  }
};
