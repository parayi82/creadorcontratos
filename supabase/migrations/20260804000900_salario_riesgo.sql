-- ════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Salario diario en trabajadores
-- Necesario para el reporte "Exposición de riesgo" (reportes-gerenciales.html)
-- Ejecutar en Supabase SQL Editor. Idempotente — seguro re-ejecutar.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS salario_diario NUMERIC(10,2) NULL;

COMMENT ON COLUMN trabajadores.salario_diario IS
  'Salario diario nominal MXN. Usado por reportes gerenciales para estimar pasivo contingente. NULL = usar salario estimado por defecto del reporte.';

-- No requiere cambios de RLS: hereda las políticas existentes de la tabla trabajadores.
