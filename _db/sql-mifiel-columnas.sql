-- ════════════════════════════════════════════════════════════════
-- Columnas adicionales en firmas_electronicas para integración Mifiel
-- Ejecutar en Supabase → SQL Editor (una sola vez)
-- ════════════════════════════════════════════════════════════════

ALTER TABLE firmas_electronicas
  ADD COLUMN IF NOT EXISTS mifiel_id       TEXT,
  ADD COLUMN IF NOT EXISTS estado          TEXT DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS signed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS signed_xml_path TEXT;

-- Índice para búsquedas por mifiel_id (el webhook lo usa en cada evento)
CREATE INDEX IF NOT EXISTS idx_firmas_mifiel_id ON firmas_electronicas (mifiel_id);
