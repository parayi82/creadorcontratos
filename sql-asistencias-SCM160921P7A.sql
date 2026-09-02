-- ═══════════════════════════════════════════════════════════════
-- ASISTENCIA RETROACTIVA — SCM160921P7A
-- Desde fecha_ingreso de cada trabajador hasta 2026-09-01
-- A partir de 2026-09-02 se registra manualmente con el reloj checador
-- ═══════════════════════════════════════════════════════════════

-- PASO 1: Verificar los 3 trabajadores (solo lectura, sin cambios)
SELECT
  id,
  nombre,
  puesto,
  fecha_ingreso,
  activo,
  ('2026-09-01'::date - fecha_ingreso + 1) AS dias_a_insertar
FROM trabajadores
WHERE cliente_rfc = 'SCM160921P7A'
  AND activo = true
ORDER BY fecha_ingreso;

-- ───────────────────────────────────────────────────────────────
-- PASO 2: Insertar asistencias en bloque
-- ON CONFLICT DO NOTHING = si ya existe algún día, lo deja intacto
-- ───────────────────────────────────────────────────────────────
INSERT INTO asistencias (
  trabajador_id,
  cliente_rfc,
  fecha,
  status,
  fuente,
  notas
)
SELECT
  t.id                  AS trabajador_id,
  t.cliente_rfc,
  d::date               AS fecha,
  'presente'            AS status,
  'manual'              AS fuente,
  'Asistencia retroactiva — carga en bloque hasta 2026-09-01'
FROM trabajadores t
CROSS JOIN LATERAL generate_series(
  t.fecha_ingreso,
  '2026-09-01'::date,
  '1 day'::interval
) AS d
WHERE t.cliente_rfc = 'SCM160921P7A'
  AND t.activo = true
ON CONFLICT (trabajador_id, fecha) DO NOTHING;

-- PASO 3: Confirmar cuántos registros se insertaron por trabajador
SELECT
  t.nombre,
  t.fecha_ingreso,
  COUNT(a.id) AS dias_con_asistencia,
  MIN(a.fecha) AS primer_dia,
  MAX(a.fecha) AS ultimo_dia
FROM trabajadores t
JOIN asistencias a ON a.trabajador_id = t.id
WHERE t.cliente_rfc = 'SCM160921P7A'
  AND t.activo = true
GROUP BY t.nombre, t.fecha_ingreso
ORDER BY t.fecha_ingreso;
