-- ════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Horario habitual por trabajador
-- Ejecutar en Supabase → SQL Editor (una sola vez)
--
-- Guarda la hora de entrada y salida acordadas de cada trabajador
-- para que el registro diario se precargue automáticamente.
-- El frontend funciona sin esta migración (usa almacenamiento local
-- del navegador), pero con ella el horario queda guardado de forma
-- permanente y disponible en cualquier dispositivo.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS hora_entrada_habitual TIME NULL,
  ADD COLUMN IF NOT EXISTS hora_salida_habitual  TIME NULL;

COMMENT ON COLUMN trabajadores.hora_entrada_habitual IS
  'Hora de entrada acordada (jornada pactada). Se precarga en el registro diario de asistencia.';
COMMENT ON COLUMN trabajadores.hora_salida_habitual IS
  'Hora de salida acordada. Se precarga en el registro diario de asistencia.';
