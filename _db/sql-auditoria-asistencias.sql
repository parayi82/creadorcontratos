-- ============================================================
-- Columnas de auditoría de ediciones manuales en asistencias
-- Propósito: trazabilidad (Art. 784 LFT — carga de la prueba
--   de la jornada recae en el patrón; estas columnas permiten
--   acreditar que los registros no fueron alterados)
-- Ejecutar en: Supabase SQL Editor (una sola vez)
-- ============================================================

ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS editado_por  text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS editado_at   timestamptz DEFAULT NULL;

-- Índice para auditorías rápidas por quién editó
CREATE INDEX IF NOT EXISTS idx_asistencias_editado
  ON asistencias (editado_por, editado_at DESC)
  WHERE editado_por IS NOT NULL;

COMMENT ON COLUMN asistencias.editado_por IS
  'RFC del cliente que realizó la última edición manual (Art. 784 LFT: trazabilidad de registros)';
COMMENT ON COLUMN asistencias.editado_at IS
  'Timestamp UTC de la última edición manual del registro de asistencia';
