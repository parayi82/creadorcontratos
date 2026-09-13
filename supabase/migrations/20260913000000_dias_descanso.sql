-- ═══════════════════════════════════════════════════════════════════════════
-- Días de descanso por trabajador
--
-- Problema que resuelve: el sistema asumía en varios lugares (calendario en
-- asistencias-vacaciones.html, cierre automático de jornada en
-- deteccion-faltas.js, reporte de cumplimiento en reporte-asistencias.js)
-- que TODO trabajador descansa sábado y domingo y trabaja de lunes a
-- viernes — sin ninguna forma de configurarlo distinto. Para trabajadores
-- con jornada no estándar (turnos rotativos, personal de salud, retail con
-- descanso entre semana, etc.) esto marcaba su día de descanso real como
-- "sin registro" cada semana, indistinguible de una falta.
--
-- Solución: columna dias_descanso en trabajadores — arreglo de enteros
-- 0-6 siguiendo la convención de JS Date.getDay()/getUTCDay()
-- (0=domingo, 1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado).
-- Un arreglo vacío (valor por defecto) conserva el comportamiento anterior
-- (sábado/domingo como descanso implícito) para no romper trabajadores ya
-- configurados — es responsabilidad de cada empresa configurar el día real
-- de descanso de cada trabajador que no siga el horario de oficina estándar.
--
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS dias_descanso INT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN trabajadores.dias_descanso IS
  'Días de la semana en que el trabajador descansa, 0=domingo..6=sábado (Date.getDay()). Arreglo vacío = usa el default sábado/domingo por compatibilidad.';

-- Permitir el nuevo status 'descanso' en asistencias (generado automáticamente
-- por deteccion-faltas.js y por el calendario cuando el día cae en un día de
-- descanso configurado del trabajador).
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_status_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_status_check
  CHECK (status IN (
    'presente','retraso','falta_injustificada','falta_justificada',
    'vacaciones','permiso','incapacidad','festivo','sin_registro','descanso'
  ));

-- ── Verificación ───────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'trabajadores' AND column_name = 'dias_descanso';
