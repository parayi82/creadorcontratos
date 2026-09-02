-- ═══════════════════════════════════════════════════════════════
-- Asistencias retroactivas para trabajadores existentes
--
-- Problema: al dar de alta un trabajador con fecha_ingreso anterior
-- a hoy, los días sin registro quedan como faltas_injustificadas
-- cuando corre el cron deteccion-faltas.
--
-- Esta migración inserta 'presente' para TODOS los días entre
-- fecha_ingreso y ayer para cada trabajador activo que no tenga
-- registro en esa fecha. Solo aplica donde no hay ningún registro
-- (ON CONFLICT DO NOTHING / WHERE NOT EXISTS).
--
-- A partir de hoy (2026-09-02) la asistencia es diaria vía checador.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO asistencias (trabajador_id, cliente_rfc, fecha, status, fuente, notas)
SELECT
  t.id                  AS trabajador_id,
  t.cliente_rfc,
  d::date               AS fecha,
  'presente'            AS status,
  'manual'              AS fuente,
  'Asistencia retroactiva — carga al dar de alta con fecha de ingreso anterior'
FROM trabajadores t
CROSS JOIN LATERAL generate_series(
  t.fecha_ingreso,
  CURRENT_DATE - INTERVAL '1 day',
  '1 day'::interval
) AS d
WHERE t.activo = true
  AND t.fecha_ingreso IS NOT NULL
  AND t.fecha_ingreso < CURRENT_DATE
ON CONFLICT (trabajador_id, fecha) DO NOTHING;
