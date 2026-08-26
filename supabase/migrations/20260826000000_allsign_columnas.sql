-- supabase/migrations/20260826000000_allsign_columnas.sql
--
-- Agrega soporte AllSign a la tabla firmas_electronicas.
-- Equivalente a 20260809000000_mifiel_columnas.sql pero para AllSign.

BEGIN;

ALTER TABLE firmas_electronicas
  ADD COLUMN IF NOT EXISTS allsign_id TEXT,
  ADD COLUMN IF NOT EXISTS allsign_estado TEXT DEFAULT 'pendiente';

CREATE UNIQUE INDEX IF NOT EXISTS idx_firmas_allsign_id
  ON firmas_electronicas (allsign_id)
  WHERE allsign_id IS NOT NULL;

COMMENT ON COLUMN firmas_electronicas.allsign_id    IS 'ID del documento en AllSign (proveedor de firma electrónica).';
COMMENT ON COLUMN firmas_electronicas.allsign_estado IS 'Estado reportado por AllSign: pendiente, firmado, expirado, rechazado.';

COMMIT;
