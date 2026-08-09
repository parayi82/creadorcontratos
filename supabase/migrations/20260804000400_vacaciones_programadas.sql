-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN v15: APARTADO / PROGRAMACIÓN DE VACACIONES
-- Ejecutar en Supabase → SQL Editor (una sola vez)
--
-- Permite APARTAR periodos de vacaciones a futuro en el tablero
-- anual, antes de que se gocen. Flujo:
--
--   solicitada  → el trabajador/RH aparta el periodo (bloquea el día
--                 en el tablero, pero NO descuenta saldo todavía)
--   autorizada  → el patrón autoriza el periodo (Art. 81 LFT)
--   gozada      → al llegar la fecha se aplica y se escriben los
--                 registros en `asistencias` con status='vacaciones';
--                 hasta entonces se descuenta el saldo real
--   cancelada   → el periodo se dejó sin efecto (queda el histórico)
--
-- NOTA LEGAL: el saldo de vacaciones (Arts. 76, 80 y 81 LFT) sólo se
-- descuenta cuando los días se GOZAN. Los días apartados se muestran
-- como "comprometidos" para efectos de planeación operativa.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vacaciones_programadas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_rfc     TEXT NOT NULL,
  trabajador_id   UUID NOT NULL,
  fecha_inicio    DATE NOT NULL,
  fecha_fin       DATE NOT NULL,
  dias            INTEGER NOT NULL DEFAULT 0,
  incluye_finde   BOOLEAN NOT NULL DEFAULT FALSE,
  estado          TEXT NOT NULL DEFAULT 'solicitada'
                    CHECK (estado IN ('solicitada','autorizada','gozada','cancelada')),
  notas           TEXT,
  creado_por      TEXT,
  autorizado_por  TEXT,
  autorizado_en   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vp_rango_valido CHECK (fecha_fin >= fecha_inicio)
);

-- FK opcional al roster (se omite si la tabla trabajadores usa otro tipo)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vacaciones_programadas_trabajador_fk'
  ) THEN
    BEGIN
      ALTER TABLE vacaciones_programadas
        ADD CONSTRAINT vacaciones_programadas_trabajador_fk
        FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE CASCADE;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'FK a trabajadores omitida: %', SQLERRM;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vp_cliente_fechas
  ON vacaciones_programadas (cliente_rfc, fecha_inicio, fecha_fin);
CREATE INDEX IF NOT EXISTS idx_vp_trabajador
  ON vacaciones_programadas (trabajador_id, estado);

-- ── RLS: cada cliente sólo ve y edita sus propios apartados ──
ALTER TABLE vacaciones_programadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cliente_gestiona_sus_vacaciones_programadas" ON vacaciones_programadas;
CREATE POLICY "cliente_gestiona_sus_vacaciones_programadas" ON vacaciones_programadas
  FOR ALL USING (
    cliente_rfc = (SELECT raw_user_meta_data->>'rfc' FROM auth.users WHERE id = auth.uid())
  )
  WITH CHECK (
    cliente_rfc = (SELECT raw_user_meta_data->>'rfc' FROM auth.users WHERE id = auth.uid())
  );

-- ── Vista de apoyo: días comprometidos (apartados y aún no gozados) ──
CREATE OR REPLACE VIEW v_vacaciones_comprometidas AS
SELECT
  trabajador_id,
  cliente_rfc,
  SUM(dias) FILTER (WHERE estado = 'solicitada') AS dias_solicitados,
  SUM(dias) FILTER (WHERE estado = 'autorizada') AS dias_autorizados,
  SUM(dias) FILTER (WHERE estado IN ('solicitada','autorizada')) AS dias_comprometidos,
  MIN(fecha_inicio) FILTER (WHERE estado IN ('solicitada','autorizada')) AS proximo_periodo
FROM vacaciones_programadas
GROUP BY trabajador_id, cliente_rfc;

SELECT 'vacaciones_programadas creada correctamente' AS resultado;

-- ══════════════════════════════════════════════════════════════════
-- Permitir 'programacion' como origen en asistencias
-- (los días que se aplican desde un periodo apartado)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_fuente_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_fuente_check
  CHECK (fuente IN ('manual','csv_zkteco','csv_generico','control_diario','api','webhook','programacion'));

SELECT 'migración v15 completa — ya puedes apartar vacaciones en el tablero' AS resultado;
