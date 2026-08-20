-- sql-adms.sql
-- Migración para integración de checadores ZKTeco via ADMS (red) y USB.
-- Ejecutar en: Supabase Dashboard → SQL Editor

-- ── 1. PIN del checador en la tabla de trabajadores ──────────────────────────
-- Almacena el User ID del dispositivo ZKTeco (p.ej. "1", "42").
-- Se rellena automáticamente al importar user.dat por USB.
ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS pin_checador TEXT;

CREATE INDEX IF NOT EXISTS idx_trabajadores_pin_checador
  ON trabajadores(pin_checador);

-- ── 2. Registro de dispositivos (checadores en red) ───────────────────────────
CREATE TABLE IF NOT EXISTS checadores (
  sn                TEXT        PRIMARY KEY,   -- Número de serie del dispositivo
  nombre            TEXT,                       -- Alias (p.ej. "Entrada principal")
  ubicacion         TEXT,
  cliente_rfc       TEXT        REFERENCES clientes(rfc) ON DELETE SET NULL,
  ultimo_contacto   TIMESTAMPTZ,
  creado_en         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checadores_cliente
  ON checadores(cliente_rfc);

-- RLS: clientes ven solo sus propios dispositivos
ALTER TABLE checadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clientes_ven_sus_checadores" ON checadores;
CREATE POLICY "clientes_ven_sus_checadores"
  ON checadores FOR SELECT
  USING (
    cliente_rfc = (SELECT raw_user_meta_data->>'rfc' FROM auth.users WHERE id = auth.uid())
  );
