-- ============================================================
-- Tabla: api_rate_limits
-- Propósito: rate limiting distribuido para Netlify Functions
-- Ejecutar en: Supabase SQL Editor (una sola vez)
-- ============================================================

CREATE TABLE IF NOT EXISTS api_rate_limits (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,        -- formato: "ip:endpoint"
  endpoint    text NOT NULL,        -- nombre del endpoint
  ip          text NOT NULL,        -- IP del cliente
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índice para consultas rápidas por key y tiempo
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_time
  ON api_rate_limits (key, created_at DESC);

-- Índice para limpieza de registros viejos
CREATE INDEX IF NOT EXISTS idx_rate_limits_created
  ON api_rate_limits (created_at);

-- RLS: solo el service role puede leer/escribir (las funciones usan SUPABASE_SERVICE_KEY)
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Política: acceso solo desde el backend (service role bypasses RLS automáticamente)
-- El anon key no puede acceder a esta tabla desde el cliente
CREATE POLICY "solo_service_role" ON api_rate_limits
  FOR ALL USING (false);

-- Limpieza automática de registros con más de 24 horas (cron de Supabase o pg_cron)
-- Activar en Supabase Dashboard → Database → Extensions → pg_cron
-- SELECT cron.schedule('rate-limits-cleanup', '0 */6 * * *',
--   $$DELETE FROM api_rate_limits WHERE created_at < now() - interval '24 hours'$$);

COMMENT ON TABLE api_rate_limits IS
  'Rate limiting distribuido para Netlify Functions. Registra peticiones por IP/endpoint. Limpieza manual o con pg_cron cada 6h.';
