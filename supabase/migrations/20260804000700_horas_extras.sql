-- ════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Horas extras (Arts. 66-68 LFT / Reforma DOF 01-05-2026)
-- Ejecutar en Supabase → SQL Editor
-- Agrega persistencia de horas extras dobles y triples por día.
-- El frontend (asistencias-vacaciones.html) funciona sin esta
-- migración, pero las extras capturadas no se guardarán hasta
-- ejecutarla.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS horas_extra_dobles  NUMERIC(4,1) NOT NULL DEFAULT 0
    CHECK (horas_extra_dobles >= 0 AND horas_extra_dobles <= 12),
  ADD COLUMN IF NOT EXISTS horas_extra_triples NUMERIC(4,1) NOT NULL DEFAULT 0
    CHECK (horas_extra_triples >= 0);

COMMENT ON COLUMN asistencias.horas_extra_dobles  IS
  'Horas extras pagadas al 200% (Art. 67 LFT). Tope semanal según año: 9h (≤2026), 10h (2027), 11h (2028), 12h (2029+).';
COMMENT ON COLUMN asistencias.horas_extra_triples IS
  'Horas extras pagadas al 300% (Art. 68 LFT). A partir de 2030: tope de 4h/semana.';

-- Vista de apoyo: totales semanales de extras por trabajador
-- (semana ISO lunes-domingo, útil para nómina y auditoría)
CREATE OR REPLACE VIEW v_extras_semanales AS
SELECT
  trabajador_id,
  cliente_rfc,
  date_trunc('week', fecha)::date            AS semana_lunes,
  SUM(horas_extra_dobles)                    AS total_dobles,
  SUM(horas_extra_triples)                   AS total_triples,
  SUM(horas_extra_dobles + horas_extra_triples) AS total_extras,
  COUNT(*) FILTER (WHERE horas_extra_dobles + horas_extra_triples > 0) AS dias_con_extras
FROM asistencias
GROUP BY trabajador_id, cliente_rfc, date_trunc('week', fecha);
