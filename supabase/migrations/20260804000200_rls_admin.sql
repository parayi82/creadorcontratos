-- ════════════════════════════════════════════════════════════════
-- LOGIN REAL PARA EL DASHBOARD DEL ABOGADO (admin)
-- Ejecutar en Supabase → SQL Editor (rol: postgres)
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- PASO 1 — Crear tu usuario admin (hazlo ANTES de correr el resto)
-- ────────────────────────────────────────────────────────────────
-- 1. Ve a Supabase Dashboard → Authentication → Users → Add user
-- 2. Pon tu correo real y una contraseña fuerte. Marca "Auto Confirm User".
-- 3. Copia tu correo y pégalo abajo en el UPDATE (reemplaza el placeholder),
--    luego corre esa línea para marcarte como admin:

-- UPDATE auth.users
-- SET raw_user_meta_data = raw_user_meta_data || '{"role":"admin"}'::jsonb
-- WHERE email = 'TU-CORREO-AQUI@dominio.mx';

-- ────────────────────────────────────────────────────────────────
-- PASO 2 — RLS con acceso de administrador en cada tabla relevante
-- Usa bloques seguros: si una tabla no existe todavía, simplemente
-- se omite ese bloque sin tronar el resto del script.
-- ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.clientes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE clientes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "admin_ve_todo" ON clientes';
    EXECUTE 'DROP POLICY IF EXISTS "acceso_clientes" ON clientes';
    EXECUTE $p$
      CREATE POLICY "acceso_clientes" ON clientes FOR ALL
      USING (
        rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
        OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
      )
      WITH CHECK (
        rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
        OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
      )
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.documentos') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE documentos ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "cliente_documentos" ON documentos';
    EXECUTE 'DROP POLICY IF EXISTS "acceso_documentos" ON documentos';
    EXECUTE $p$
      CREATE POLICY "acceso_documentos" ON documentos FOR ALL
      USING (
        cliente_id = (SELECT id FROM clientes WHERE rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
        OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
      )
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.alertas') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE alertas ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "cliente_alertas" ON alertas';
    EXECUTE 'DROP POLICY IF EXISTS "acceso_alertas" ON alertas';
    EXECUTE $p$
      CREATE POLICY "acceso_alertas" ON alertas FOR ALL
      USING (
        cliente_id = (SELECT id FROM clientes WHERE rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
        OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
      )
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.compliance') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE compliance ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "cliente_compliance" ON compliance';
    EXECUTE 'DROP POLICY IF EXISTS "acceso_compliance" ON compliance';
    EXECUTE $p$
      CREATE POLICY "acceso_compliance" ON compliance FOR ALL
      USING (
        cliente_id = (SELECT id FROM clientes WHERE rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
        OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
      )
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.pagos') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE pagos ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "acceso_pagos" ON pagos';
    EXECUTE $p$
      CREATE POLICY "acceso_pagos" ON pagos FOR ALL
      USING ((auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin')
    $p$;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- NOTA sobre "solicitudes": el dashboard YA lee esa tabla a través
-- de netlify/functions/solicitudes-admin.js (service_role key, evita
-- RLS por diseño) — no necesita política de admin aquí. La política
-- de cliente que ya tiene (de la migración de asistencias) se queda igual.
-- ────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — corre esto al final para confirmar tu rol admin
-- ────────────────────────────────────────────────────────────────
-- SELECT email, raw_user_meta_data->>'role' AS rol FROM auth.users;

-- ════════════════════════════════════════════════════════════════
-- FIRMA ELECTRÓNICA SIMPLE — bitácora de respaldo (NO es NOM-151,
-- ver nota en netlify/functions/registrar-firma.js)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS firmas_electronicas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_firma       TEXT UNIQUE NOT NULL,
  documento_tipo    TEXT,
  documento_folio   TEXT,
  hash_documento    TEXT NOT NULL,
  firmantes         JSONB NOT NULL,
  ip_origen         TEXT,
  timestamp_servidor TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);
-- Sin RLS — solo se escribe desde el backend (service_role), nunca desde el navegador.

-- ════════════════════════════════════════════════════════════════
-- PROGRAMA DE REFERIDOS — tablas que faltaban (por esto no se podían
-- crear cuentas de referidor: el código ya las usaba, pero nunca existieron)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS referidores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              TEXT UNIQUE NOT NULL,
  nombre              TEXT NOT NULL,
  email               TEXT UNIQUE NOT NULL,
  telefono            TEXT,
  despacho            TEXT,
  porcentaje_comision NUMERIC NOT NULL DEFAULT 25,
  activo              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comisiones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referidor_id     UUID NOT NULL REFERENCES referidores(id) ON DELETE CASCADE,
  cliente_id       UUID REFERENCES clientes(id) ON DELETE SET NULL,
  periodo          TEXT NOT NULL,
  porcentaje       NUMERIC NOT NULL,
  monto_pago       NUMERIC NOT NULL,
  monto_comision   NUMERIC NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','pagada')),
  stripe_invoice_id TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comisiones_referidor ON comisiones(referidor_id, created_at DESC);

-- referido_por en clientes guarda el CÓDIGO del referidor (texto), no su UUID —
-- así es como ya lo escribe netlify/functions/crear-suscripcion.js
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS referido_por TEXT;

-- RLS: cada referidor solo ve su propio registro y sus propias comisiones.
-- El registro (signup) y el dashboard del abogado usan la anon key sin sesión de
-- referidor todavía, así que esto no bloquea la inserción inicial (no hay USING
-- restrictivo en INSERT vía signUp, que corre como usuario recién creado).
ALTER TABLE referidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE comisiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referidor_ve_su_registro" ON referidores;
CREATE POLICY "referidor_ve_su_registro" ON referidores FOR ALL
  USING (
    email = (auth.jwt()::jsonb)->>'email'
    OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
  )
  WITH CHECK (
    email = (auth.jwt()::jsonb)->>'email'
    OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
  );

DROP POLICY IF EXISTS "referidor_ve_sus_comisiones" ON comisiones;
CREATE POLICY "referidor_ve_sus_comisiones" ON comisiones FOR SELECT
  USING (
    referidor_id IN (SELECT id FROM referidores WHERE email = (auth.jwt()::jsonb)->>'email')
    OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
  );
-- Las comisiones solo las inserta el webhook con la service_role key (evita RLS).
