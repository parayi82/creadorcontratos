// netlify/functions/actualizar-config-cliente.js
//
// Actualiza los datos de contacto del cliente autenticado en su propio
// user_metadata. Usa service_role, pero SOLO permite modificar una lista
// blanca de campos inofensivos (contacto_rrhh, email_contacto, tel).
// Nunca acepta plan, rfc, role ni ningún otro campo de metadata —
// evita que un cliente se auto-asigne un plan superior desde la consola.
//
// POST { contacto_rrhh, email_contacto, tel }
// Authorization: Bearer <access_token>
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');

const CAMPOS_PERMITIDOS = ['contacto_rrhh', 'email_contacto', 'tel', 'tolerancia_retraso_min'];

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  const rl = await checkRateLimit(clientIp(event), 'actualizar-config', 10, 600);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  // Lista blanca estricta: ignorar cualquier otro campo del body
  const cambios = {};
  const CAMPOS_STRING = ['contacto_rrhh', 'email_contacto', 'tel'];
  for (const campo of CAMPOS_STRING) {
    if (typeof body[campo] === 'string') cambios[campo] = body[campo].trim().slice(0, 200);
  }
  if (cambios.email_contacto && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cambios.email_contacto)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email con formato inválido.' }) };
  }
  // Campo numérico — tolerancia de retraso según el RIT (0-60 minutos)
  if ('tolerancia_retraso_min' in body) {
    const val = parseInt(body.tolerancia_retraso_min, 10);
    if (isNaN(val) || val < 0 || val > 60) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'tolerancia_retraso_min debe ser un entero entre 0 y 60.' }) };
    }
    cambios.tolerancia_retraso_min = val;
  }
  if (!Object.keys(cambios).length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nada que actualizar.' }) };
  }

  // Merge sobre la metadata existente (no reemplazar el objeto completo)
  const metaActual = uData.user.user_metadata || {};
  const { error: updErr } = await sb.auth.admin.updateUserById(uData.user.id, {
    user_metadata: { ...metaActual, ...cambios },
  });
  if (updErr) return { statusCode: 500, headers, body: JSON.stringify({ error: updErr.message }) };

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, cambios }) };
};
