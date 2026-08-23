-- sql-repse-proveedores.sql
-- Tablas para el Gestor de Proveedores REPSE
-- Ejecutar en Supabase → SQL Editor

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla de proveedores REPSE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repse_proveedores (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_rfc      TEXT NOT NULL,
  nombre           TEXT NOT NULL,
  rfc_proveedor    TEXT,
  num_repse        TEXT NOT NULL,
  vigencia_repse   DATE NOT NULL,
  actividad        TEXT,
  domicilio        TEXT,
  rep_legal        TEXT,
  email            TEXT,
  telefono         TEXT,
  activo           BOOLEAN DEFAULT true,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repse_prov_rfc     ON repse_proveedores(cliente_rfc);
CREATE INDEX IF NOT EXISTS idx_repse_prov_vigencia ON repse_proveedores(vigencia_repse);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabla de documentación mensual por proveedor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repse_docs_mensuales (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proveedor_id           UUID REFERENCES repse_proveedores(id) ON DELETE CASCADE,
  cliente_rfc            TEXT NOT NULL,
  periodo                TEXT NOT NULL,        -- 'YYYY-MM'
  cfdi                   BOOLEAN DEFAULT false,
  sua_imss               BOOLEAN DEFAULT false,
  infonavit              BOOLEAN DEFAULT false,
  repse_vigencia_doc     BOOLEAN DEFAULT false,
  relacion_trabajadores  BOOLEAN DEFAULT false,
  notas                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now(),
  UNIQUE(proveedor_id, periodo)
);

CREATE INDEX IF NOT EXISTS idx_repse_docs_prov    ON repse_docs_mensuales(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_repse_docs_rfc     ON repse_docs_mensuales(cliente_rfc);
CREATE INDEX IF NOT EXISTS idx_repse_docs_periodo ON repse_docs_mensuales(periodo);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS: cada cliente solo ve y escribe sus propios datos
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE repse_proveedores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE repse_docs_mensuales  ENABLE ROW LEVEL SECURITY;

-- repse_proveedores
DROP POLICY IF EXISTS "repse_prov_select" ON repse_proveedores;
CREATE POLICY "repse_prov_select" ON repse_proveedores
  FOR SELECT USING (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

DROP POLICY IF EXISTS "repse_prov_insert" ON repse_proveedores;
CREATE POLICY "repse_prov_insert" ON repse_proveedores
  FOR INSERT WITH CHECK (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

DROP POLICY IF EXISTS "repse_prov_update" ON repse_proveedores;
CREATE POLICY "repse_prov_update" ON repse_proveedores
  FOR UPDATE USING (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

DROP POLICY IF EXISTS "repse_prov_delete" ON repse_proveedores;
CREATE POLICY "repse_prov_delete" ON repse_proveedores
  FOR DELETE USING (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

-- repse_docs_mensuales
DROP POLICY IF EXISTS "repse_docs_select" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_select" ON repse_docs_mensuales
  FOR SELECT USING (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

DROP POLICY IF EXISTS "repse_docs_insert" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_insert" ON repse_docs_mensuales
  FOR INSERT WITH CHECK (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

DROP POLICY IF EXISTS "repse_docs_update" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_update" ON repse_docs_mensuales
  FOR UPDATE USING (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

DROP POLICY IF EXISTS "repse_docs_delete" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_delete" ON repse_docs_mensuales
  FOR DELETE USING (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: actualizar updated_at automáticamente
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_repse_prov_updated  ON repse_proveedores;
CREATE TRIGGER trg_repse_prov_updated
  BEFORE UPDATE ON repse_proveedores
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_repse_docs_updated ON repse_docs_mensuales;
CREATE TRIGGER trg_repse_docs_updated
  BEFORE UPDATE ON repse_docs_mensuales
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación
-- ─────────────────────────────────────────────────────────────────────────────

SELECT table_name, (SELECT count(*) FROM information_schema.columns WHERE table_name=t.table_name) AS columnas
FROM information_schema.tables t
WHERE table_name IN ('repse_proveedores','repse_docs_mensuales')
  AND table_schema = 'public';
