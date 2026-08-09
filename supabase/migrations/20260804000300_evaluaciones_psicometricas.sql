-- ══════════════════════════════════════════════════════════════════
-- Tabla para evaluaciones psicométricas de candidatos
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS evaluaciones_psicometricas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_rfc        TEXT NOT NULL,
  candidato_nombre   TEXT NOT NULL,
  puesto             TEXT,
  email              TEXT,
  score_razonamiento INTEGER CHECK (score_razonamiento BETWEEN 0 AND 100),
  score_integridad   INTEGER CHECK (score_integridad BETWEEN 0 AND 100),
  score_global       INTEGER CHECK (score_global BETWEEN 0 AND 100),
  veredicto          TEXT CHECK (veredicto IN ('apto','apto_reservas','no_apto')),
  perfil_disc        TEXT CHECK (perfil_disc IN ('D','I','S','C')),
  detalle            JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluaciones_cliente
  ON evaluaciones_psicometricas(cliente_rfc, created_at DESC);

-- RLS: cada cliente solo ve sus evaluaciones (lectura directa desde el portal;
-- las escrituras pasan por la función mutar-datos-cliente con service_role)
ALTER TABLE evaluaciones_psicometricas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cliente_ve_sus_evaluaciones" ON evaluaciones_psicometricas;
CREATE POLICY "cliente_ve_sus_evaluaciones" ON evaluaciones_psicometricas
  FOR SELECT TO authenticated
  USING (
    cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
  );

-- Recargar el esquema de la API
NOTIFY pgrst, 'reload schema';

SELECT 'evaluaciones_psicometricas creada correctamente' AS resultado;
