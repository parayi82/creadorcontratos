-- supabase/migrations/20260825000000_nom151_constancias.sql
--
-- Tabla append-only para constancias de conservación NOM-151.
-- RLS: INSERT permitido solo desde service_role (backend).
--      UPDATE y DELETE explícitamente bloqueados.
-- Una sola constancia por (tabla_origen, fila_id) — índice UNIQUE.

BEGIN;

CREATE TABLE IF NOT EXISTS constancias_conservacion (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla_origen    TEXT        NOT NULL,
  fila_id         TEXT        NOT NULL,
  hash_documento  TEXT        NOT NULL,      -- SHA-256 HEX (64 chars)
  id_constancia   TEXT        NOT NULL,      -- folio emitido por el PSC
  sello_tiempo    TIMESTAMPTZ NOT NULL,      -- fecha cierta del PSC
  proveedor       TEXT        NOT NULL,      -- "mock" | "finkok" | …
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_constancia_fila UNIQUE (tabla_origen, fila_id),
  CONSTRAINT chk_hash_sha256 CHECK (length(hash_documento) = 64)
);

COMMENT ON TABLE  constancias_conservacion IS 'Registro append-only de constancias NOM-151. No modificar filas existentes.';
COMMENT ON COLUMN constancias_conservacion.hash_documento IS 'SHA-256 HEX del contenido conservado, calculado en servidor.';
COMMENT ON COLUMN constancias_conservacion.id_constancia  IS 'Folio único emitido por el PSC acreditado.';
COMMENT ON COLUMN constancias_conservacion.sello_tiempo   IS 'Fecha cierta emitida por el PSC (RFC 3161).';

-- Índice para consultas por tabla + fila
CREATE INDEX IF NOT EXISTS idx_constancias_tabla_fila
  ON constancias_conservacion (tabla_origen, fila_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE constancias_conservacion ENABLE ROW LEVEL SECURITY;

-- Solo service_role (backend) puede insertar.
-- anon y authenticated no tienen permiso de escritura.
CREATE POLICY "service_role puede insertar constancias"
  ON constancias_conservacion
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Lectura: admin y service_role pueden consultar; clientes no.
CREATE POLICY "service_role puede leer constancias"
  ON constancias_conservacion
  FOR SELECT
  TO service_role
  USING (true);

-- Sin UPDATE ni DELETE — la tabla es append-only por diseño.
-- No se crean políticas UPDATE/DELETE → operaciones bloqueadas para todos.

COMMIT;
