-- sql-retroactivo-fi-a-presente.sql
-- Convierte falta_injustificada → presente para todos los trabajadores activos
-- en los días anteriores a la fecha actual, dentro de su período de empleo.
-- Ejecutar en Supabase → SQL Editor (una sola vez)

-- ── 1. Actualiza asistencias ────────────────────────────────────────────────
UPDATE asistencias a
SET
  status = 'presente',
  fuente = 'manual',
  notas  = 'Asistencia retroactiva — registros anteriores al alta en ClickLaboral'
FROM trabajadores t
WHERE a.trabajador_id   = t.id
  AND a.status          = 'falta_injustificada'
  AND a.fecha           >= t.fecha_ingreso
  AND a.fecha           < CURRENT_DATE
  AND t.activo          = true;

-- ── 2. Elimina actas de inasistencia que ahora tienen asistencia ────────────
DELETE FROM actas_inasistencia ai
WHERE ai.estado = 'provisional'
  AND EXISTS (
    SELECT 1 FROM asistencias a
    WHERE a.trabajador_id = ai.trabajador_id
      AND a.fecha         = ai.fecha
      AND a.status IN ('presente','vacaciones','permiso','incapacidad','festivo')
  );

-- ── Verificación ────────────────────────────────────────────────────────────
SELECT COUNT(*) AS fi_restantes        FROM asistencias       WHERE status = 'falta_injustificada' AND fecha < CURRENT_DATE;
SELECT COUNT(*) AS actas_restantes     FROM actas_inasistencia WHERE estado = 'provisional';
