/**
 * _rate-limiter.js — Rate limiting distribuido usando Supabase
 *
 * Requiere la tabla `api_rate_limits` en Supabase (ver _db/sql-rate-limits.sql).
 * Si Supabase no está configurado, permite el paso pero registra una advertencia.
 *
 * Uso:
 *   const { checkRateLimit } = require('./_rate-limiter');
 *   const limited = await checkRateLimit(ip, 'crear-suscripcion', 5, 600);
 *   if (limited) return { statusCode: 429, ... };
 */

const { createClient } = require('@supabase/supabase-js');

/**
 * Verifica si la IP superó el límite de peticiones en la ventana de tiempo.
 *
 * @param {string} ip           - IP del cliente
 * @param {string} endpoint     - nombre del endpoint (ej: 'crear-suscripcion')
 * @param {number} maxRequests  - máximo de peticiones permitidas en la ventana
 * @param {number} windowSecs   - ventana de tiempo en segundos
 * @returns {Promise<{limited: boolean, remaining: number, resetAt: string}>}
 */
async function checkRateLimit(ip, endpoint, maxRequests = 10, windowSecs = 60) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.warn('Rate limiter: Supabase no configurado, saltando verificación');
    return { limited: false, remaining: maxRequests, resetAt: null };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSecs * 1000).toISOString();
  const key = `${ip}:${endpoint}`;

  try {
    // Limpiar registros viejos (fuera de la ventana) para esta key
    await supabase
      .from('api_rate_limits')
      .delete()
      .eq('key', key)
      .lt('created_at', windowStart);

    // Contar peticiones en la ventana actual
    const { count } = await supabase
      .from('api_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', windowStart);

    const currentCount = count || 0;

    if (currentCount >= maxRequests) {
      return {
        limited: true,
        remaining: 0,
        resetAt: new Date(now.getTime() + windowSecs * 1000).toISOString(),
      };
    }

    // Registrar esta petición
    await supabase.from('api_rate_limits').insert({ key, endpoint, ip });

    return {
      limited: false,
      remaining: maxRequests - currentCount - 1,
      resetAt: new Date(now.getTime() + windowSecs * 1000).toISOString(),
    };
  } catch (err) {
    // Si el rate limiter falla, NO bloquear al usuario — loguear y continuar
    console.error('Rate limiter error:', err.message);
    return { limited: false, remaining: maxRequests, resetAt: null };
  }
}

/**
 * Respuesta estándar 429 para cuando se supera el rate limit.
 */
function rateLimitResponse(corsHeaders, resetAt) {
  const headers = {
    ...corsHeaders,
    'Retry-After': '600',
    'X-RateLimit-Limit': '5',
    'X-RateLimit-Remaining': '0',
  };
  if (resetAt) headers['X-RateLimit-Reset'] = resetAt;

  return {
    statusCode: 429,
    headers,
    body: JSON.stringify({
      error: 'Demasiadas peticiones. Por favor espere unos minutos e intente de nuevo.',
      retryAfter: 600,
    }),
  };
}

module.exports = { checkRateLimit, rateLimitResponse };
