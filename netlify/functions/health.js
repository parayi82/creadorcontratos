// netlify/functions/health.js
//
// Health-check para monitoreo externo (UptimeRobot, Pingdom, etc.).
// GET /api/health → { ok: true, supabase: true|false, ts: "..." }
//
// Responde 200 si Supabase está accesible, 503 si no.
// No expone datos sensibles — solo verifica conectividad.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const ts = new Date().toISOString();
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://clicklaboral.mx',
  };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ ok: false, supabase: false, ts, reason: 'env vars missing' }) };
  }

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    // Ping ligero: contar trabajadores (no carga datos, solo verifica conexión)
    const { error } = await sb.from('trabajadores').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, supabase: true, ts }) };
  } catch (err) {
    return { statusCode: 503, headers, body: JSON.stringify({ ok: false, supabase: false, ts, reason: err.message }) };
  }
};
