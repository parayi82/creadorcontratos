-- ════════════════════════════════════════════════════════════════
-- FASE 2 Multi-tenant: tablas despachos y despacho_clientes
--
-- Antes: la relación despacho ↔ cliente vivía SOLO en
--   auth.users.user_metadata.despacho_clientes (array JSON).
-- Problemas:
--   · listUsers(1000) en cada request no escala
--   · Array JSON no tiene índice ni FK
--   · Límite de tamaño de JWT con carteras grandes
--   · Sin audit trail de altas/bajas de clientes
--
-- Ahora: tabla relacional + función RLS + backfill desde metadata.
-- La escritura en user_metadata se mantiene durante la transición
-- (dual-write) para no romper funciones que todavía leen de ahí.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Perfil del despacho ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despachos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID        NOT NULL UNIQUE,
  nombre        TEXT        NOT NULL,
  color         TEXT        NOT NULL DEFAULT '#1e3a5f',
  tipo          TEXT        NOT NULL DEFAULT 'contador',
  rango         TEXT        NOT NULL DEFAULT '3-9',
  activo        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Relación despacho ↔ cliente ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despacho_clientes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id  UUID        NOT NULL REFERENCES despachos(id) ON DELETE CASCADE,
  cliente_rfc  TEXT        NOT NULL,
  empresa      TEXT,
  activo       BOOLEAN     NOT NULL DEFAULT true,
  agregado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (despacho_id, cliente_rfc)
);

CREATE INDEX IF NOT EXISTS idx_dc_despacho
  ON despacho_clientes(despacho_id) WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_dc_rfc
  ON despacho_clientes(cliente_rfc)  WHERE activo = true;

-- ── 3. RLS de las nuevas tablas ───────────────────────────────────────────────
ALTER TABLE despachos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE despacho_clientes ENABLE ROW LEVEL SECURITY;

-- Admin accede a todo
DROP POLICY IF EXISTS "admin_ve_despachos" ON despachos;
CREATE POLICY "admin_ve_despachos" ON despachos FOR ALL
  USING ((auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "admin_ve_despacho_clientes" ON despacho_clientes;
CREATE POLICY "admin_ve_despacho_clientes" ON despacho_clientes FOR ALL
  USING ((auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin');

-- El despacho solo ve su propio perfil y cartera
DROP POLICY IF EXISTS "despacho_ve_su_perfil" ON despachos;
CREATE POLICY "despacho_ve_su_perfil" ON despachos FOR SELECT
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "despacho_ve_sus_clientes" ON despacho_clientes;
CREATE POLICY "despacho_ve_sus_clientes" ON despacho_clientes FOR SELECT
  USING (
    despacho_id IN (SELECT id FROM despachos WHERE auth_user_id = auth.uid())
  );

-- ── 4. Función RLS: ¿este despacho gestiona ese RFC? ─────────────────────────
-- SECURITY DEFINER: corre como el owner del schema, puede leer despacho_clientes
-- sin que el caller tenga permiso directo. STABLE: safe en lectura concurrente.
DROP FUNCTION IF EXISTS es_cliente_de_despacho(TEXT);
CREATE OR REPLACE FUNCTION es_cliente_de_despacho(rfc TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   despacho_clientes dc
    JOIN   despachos d ON dc.despacho_id = d.id
    WHERE  d.auth_user_id = auth.uid()
      AND  dc.cliente_rfc  = rfc
      AND  dc.activo       = true
      AND  d.activo        = true
  );
$$;

-- ── 5. Backfill desde user_metadata existente ─────────────────────────────────
-- Idempotente: ON CONFLICT DO NOTHING / DO UPDATE.
DO $$
DECLARE
  u         RECORD;
  cliente   JSONB;
  d_id      UUID;
BEGIN
  FOR u IN
    SELECT id, raw_user_meta_data AS m
    FROM   auth.users
    WHERE  raw_user_meta_data->>'tipo' = 'despacho'
  LOOP
    INSERT INTO despachos (auth_user_id, nombre, color, tipo, rango)
    VALUES (
      u.id,
      COALESCE(u.m->>'nombre_despacho', 'Sin nombre'),
      COALESCE(u.m->>'color',           '#1e3a5f'),
      COALESCE(u.m->>'tipo_despacho',   'contador'),
      COALESCE(u.m->>'rango_clientes',  '3-9')
    )
    ON CONFLICT (auth_user_id) DO UPDATE SET
      nombre = EXCLUDED.nombre,
      color  = EXCLUDED.color,
      tipo   = EXCLUDED.tipo,
      rango  = EXCLUDED.rango;

    SELECT id INTO d_id FROM despachos WHERE auth_user_id = u.id;

    FOR cliente IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(u.m->'despacho_clientes', '[]'::jsonb)
      )
    LOOP
      CONTINUE WHEN NULLIF(TRIM(cliente->>'rfc'), '') IS NULL;
      INSERT INTO despacho_clientes (despacho_id, cliente_rfc, empresa)
      VALUES (
        d_id,
        UPPER(TRIM(cliente->>'rfc')),
        COALESCE(cliente->>'empresa', UPPER(TRIM(cliente->>'rfc')))
      )
      ON CONFLICT (despacho_id, cliente_rfc) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;
