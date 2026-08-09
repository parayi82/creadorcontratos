-- ══════════════════════════════════════════════════════════════════
-- Tabla para alertas laborales automáticas
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alertas_laborales (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_rfc      TEXT NOT NULL,
  tipo             TEXT NOT NULL,
  trabajador_nombre TEXT,
  fecha_alerta     DATE NOT NULL DEFAULT CURRENT_DATE,
  mensaje          TEXT,
  urgencia         TEXT DEFAULT 'media' CHECK (urgencia IN ('alta','media','baja')),
  leida            BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_rfc, tipo, trabajador_nombre, fecha_alerta)
);

-- Índice para consultas por cliente
CREATE INDEX IF NOT EXISTS idx_alertas_cliente ON alertas_laborales(cliente_rfc, leida);

-- RLS: cada cliente solo ve sus alertas
ALTER TABLE alertas_laborales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_ve_sus_alertas" ON alertas_laborales
  FOR ALL USING (
    cliente_rfc = (SELECT raw_user_meta_data->>'rfc' FROM auth.users WHERE id = auth.uid())
  );

-- Verificar
SELECT 'alertas_laborales creada correctamente' as resultado;
