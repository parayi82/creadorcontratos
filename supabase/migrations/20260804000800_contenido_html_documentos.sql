-- ════════════════════════════════════════════════════════════════
-- Agregar columna contenido_html a documentos_expediente
-- Ejecutar UNA VEZ en Supabase → SQL Editor
-- ════════════════════════════════════════════════════════════════

ALTER TABLE documentos_expediente
  ADD COLUMN IF NOT EXISTS contenido_html TEXT;

-- Verificar que quedó
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'documentos_expediente'
ORDER BY ordinal_position;
