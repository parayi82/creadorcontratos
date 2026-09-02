-- ═══════════════════════════════════════════════════════════════
-- Columnas de auditoría extendida en asistencias
-- Agrega: hora_servidor, registrado_por_uid, editado_por_uid,
--         editado_por_email — requeridas por asistencias-vacaciones.html
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS hora_servidor      TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS registrado_por_uid UUID        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS editado_por_uid    UUID        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS editado_por_email  TEXT        DEFAULT NULL;
