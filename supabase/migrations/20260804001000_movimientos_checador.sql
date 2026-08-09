-- ════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Historial de movimientos + Checador PWA
-- Ejecutar en Supabase SQL Editor DESPUÉS de sql-migracion-salario-riesgo.sql
-- Idempotente — seguro re-ejecutar.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Historial de movimientos del trabajador (ciclo de vida) ──
CREATE TABLE IF NOT EXISTS movimientos_trabajador (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id  UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  cliente_rfc    TEXT NOT NULL REFERENCES clientes(rfc) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN (
                   'alta','promocion','cambio_puesto','cambio_salario',
                   'cambio_turno','cambio_jornada','baja','reingreso','otro'
                 )),
  valor_anterior JSONB,
  valor_nuevo    JSONB,
  fecha_efectiva DATE NOT NULL DEFAULT CURRENT_DATE,
  notas          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movtrab_trabajador
  ON movimientos_trabajador(trabajador_id, fecha_efectiva DESC);
CREATE INDEX IF NOT EXISTS idx_movtrab_cliente
  ON movimientos_trabajador(cliente_rfc, created_at DESC);

ALTER TABLE movimientos_trabajador ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clientes ven y editan solo sus movimientos" ON movimientos_trabajador;
CREATE POLICY "Clientes ven y editan solo sus movimientos"
  ON movimientos_trabajador FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

-- ── 2. NIP del trabajador para el checador (opcional, 4 dígitos) ──
ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS nip TEXT NULL;

COMMENT ON COLUMN trabajadores.nip IS
  'NIP de 4 dígitos para registrar entrada/salida en el checador. NULL = sin NIP (registro con un toque).';

-- ── 3. Ajustes a asistencias para el checador ──
-- 3a. Geolocalización opcional del registro
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS geo_lat NUMERIC(9,6) NULL,
  ADD COLUMN IF NOT EXISTS geo_lng NUMERIC(9,6) NULL;

-- 3b. Ampliar CHECK de fuente para incluir 'checador'
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_fuente_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_fuente_check
  CHECK (fuente IN ('manual','csv_zkteco','csv_generico','checador'));

-- 3c. Ampliar CHECK de status para incluir 'retraso'
--     (el panel de reportes ya lo contemplaba; esto corrige la restricción)
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_status_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_status_check
  CHECK (status IN (
    'presente','retraso','falta_injustificada','falta_justificada',
    'vacaciones','permiso','incapacidad','festivo'
  ));
