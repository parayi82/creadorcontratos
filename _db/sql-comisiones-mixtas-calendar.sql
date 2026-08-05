-- ══════════════════════════════════════════════════════════════════
-- Tabla para calendario de comisiones mixtas
-- Registra la fecha de constitución de cada comisión por cliente
-- para que notificaciones-laborales.js pueda calcular sesiones futuras.
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comisiones_mixtas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_rfc        TEXT NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('sh','cap','ptu','esc','rit','nom035')),
  fecha_constitucion DATE NOT NULL,
  nombre_empresa     TEXT,
  activa             BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_rfc, tipo)
);

CREATE INDEX IF NOT EXISTS idx_comisiones_mixtas_cliente ON comisiones_mixtas(cliente_rfc, activa);

ALTER TABLE comisiones_mixtas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cliente_ve_sus_comisiones" ON comisiones_mixtas;
CREATE POLICY "cliente_ve_sus_comisiones" ON comisiones_mixtas
  FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
  );

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_comisiones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comisiones_mixtas_updated_at ON comisiones_mixtas;
CREATE TRIGGER comisiones_mixtas_updated_at
  BEFORE UPDATE ON comisiones_mixtas
  FOR EACH ROW EXECUTE FUNCTION update_comisiones_updated_at();

SELECT 'comisiones_mixtas creada correctamente' AS resultado;
