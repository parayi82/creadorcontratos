-- 20260820000000_asistencias_sin_registro.sql
--
-- Amplía el sistema de asistencias para garantizar cobertura día a día:
-- • status 'sin_registro' = trabajador activo sin movimiento ese día
--   (antes de determinar si fue falta u otro motivo)
-- • fuente  'sistema' = insertado automáticamente por el proceso de cierre de jornada

ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_status_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_status_check
  CHECK (status IN (
    'presente','retraso','falta_injustificada','falta_justificada',
    'vacaciones','permiso','incapacidad','festivo','sin_registro'
  ));

ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_fuente_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_fuente_check
  CHECK (fuente IN ('manual','csv_zkteco','csv_generico','checador','sistema'));

-- Índice adicional: búsqueda por cliente_rfc + rango de fechas (para reportes)
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente_fecha_rango
  ON asistencias(cliente_rfc, fecha DESC);

COMMENT ON COLUMN asistencias.status IS
  'presente | retraso | falta_injustificada | falta_justificada | vacaciones | permiso | incapacidad | festivo | sin_registro';

COMMENT ON COLUMN asistencias.fuente IS
  'manual | csv_zkteco | csv_generico | checador | sistema';
