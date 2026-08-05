/**
 * _security.js — Módulo compartido de seguridad para todas las Netlify Functions
 *
 * Exporta:
 *   corsHeaders(origin)      → headers CORS restrictivos (solo clicklaboral.mx)
 *   handleCors(event)        → responde 204 a OPTIONS o null si continúa
 *   reportError(ctx, err)    → envía alerta al webhook de monitoreo
 *   safeJson(event)          → parsea body con try/catch
 *   clientIp(event)          → extrae IP real considerando proxies
 */

const ALLOWED_ORIGINS = new Set([
  'https://clicklaboral.mx',
  'https://www.clicklaboral.mx',
]);

/**
 * Devuelve los headers CORS correctos según el origen de la petición.
 * En producción solo permite clicklaboral.mx. En localhost permite cualquier
 * origen localhost para desarrollo local sin romper el flujo.
 */
function corsHeaders(requestOrigin) {
  const origin = requestOrigin || '';
  const isAllowed = ALLOWED_ORIGINS.has(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : 'https://clicklaboral.mx',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * Maneja preflight OPTIONS. Devuelve respuesta 204 si es OPTIONS, o null si
 * se debe continuar procesando la petición.
 */
function handleCors(event) {
  const origin = (event.headers || {}).origin || (event.headers || {}).Origin || '';
  const headers = corsHeaders(origin);
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  return { _corsHeaders: headers };
}

/**
 * Extrae la IP real del cliente, considerando Cloudflare y proxies de Netlify.
 */
function clientIp(event) {
  const h = event.headers || {};
  return (
    h['cf-connecting-ip'] ||
    h['x-real-ip'] ||
    h['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.requestContext?.identity?.sourceIp ||
    'unknown'
  );
}

/**
 * Parsea el body JSON con manejo seguro de errores.
 */
function safeJson(event) {
  try {
    return { data: JSON.parse(event.body || '{}'), error: null };
  } catch {
    return { data: null, error: 'JSON inválido en el body de la petición' };
  }
}

/**
 * Reporta errores críticos al webhook de monitoreo (Slack, Discord, o custom).
 * Solo se activa si MONITORING_WEBHOOK_URL está configurado en Netlify env vars.
 * No bloquea la respuesta al usuario — siempre se llama con await pero sin
 * propagar errores si falla el webhook.
 *
 * @param {string} context  - nombre de la función / contexto
 * @param {Error|string} err - error capturado
 * @param {object} meta     - datos adicionales (plan, rfc, etc — sin datos sensibles)
 */
async function reportError(context, err, meta = {}) {
  const webhookUrl = process.env.MONITORING_WEBHOOK_URL;
  const errorMsg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack || '').slice(0, 500) : '';

  // Siempre loguear para los logs de Netlify (visibles en dashboard)
  console.error(JSON.stringify({
    level: 'ERROR',
    timestamp: new Date().toISOString(),
    function: context,
    message: errorMsg,
    stack,
    meta,
  }));

  if (!webhookUrl) return;

  try {
    const body = JSON.stringify({
      text: `🚨 *Error en ClickLaboral.mx*\n*Función:* \`${context}\`\n*Error:* ${errorMsg}\n*Meta:* ${JSON.stringify(meta)}\n*Hora:* ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`,
    });
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch {
    // El webhook falló — ya está logueado arriba, no hacer nada más
  }
}

/**
 * Loguea eventos de seguridad (intentos de ataque, rate limit, CORS inválido).
 */
function logSecurityEvent(type, details) {
  console.warn(JSON.stringify({
    level: 'SECURITY',
    timestamp: new Date().toISOString(),
    type,
    ...details,
  }));
}

module.exports = { corsHeaders, handleCors, clientIp, safeJson, reportError, logSecurityEvent };
