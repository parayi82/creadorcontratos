-- ════════════════════════════════════════════════════════════════
-- ClickLaboral.mx — SCRIPT COMPLETO PARA CORRER EN SUPABASE
-- SQL Editor → pega todo este archivo → Run
--
-- Es seguro correrlo aunque ya hayas corrido partes de esto antes
-- (incluso si ya te dio el error de "policy already exists" la vez
-- pasada): todo está corregido para borrar-y-recrear cada política,
-- y usar "IF NOT EXISTS" en cada tabla. No duplica ni rompe nada.
-- ════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
-- PARTE 1 — Asistencias, vacaciones, actas de inasistencia, solicitudes
-- ═══════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- MÓDULO DE ASISTENCIAS Y VACACIONES — Migración SQL
-- Ejecutar en Supabase → SQL Editor (rol: postgres)
-- ════════════════════════════════════════════════════════════════

-- Roster de trabajadores por cliente
CREATE TABLE IF NOT EXISTS trabajadores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_rfc   TEXT NOT NULL REFERENCES clientes(rfc) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  puesto        TEXT,
  fecha_ingreso DATE,
  nss           TEXT,
  activo        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Registro diario de asistencia/incidencia por trabajador
CREATE TABLE IF NOT EXISTS asistencias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id  UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  cliente_rfc    TEXT NOT NULL REFERENCES clientes(rfc) ON DELETE CASCADE,
  fecha          DATE NOT NULL,
  status         TEXT NOT NULL CHECK (status IN (
                   'presente','falta_injustificada','falta_justificada',
                   'vacaciones','permiso','incapacidad','festivo'
                 )),
  hora_entrada   TIME,
  hora_salida    TIME,
  fuente         TEXT DEFAULT 'manual' CHECK (fuente IN ('manual','csv_zkteco','csv_generico')),
  notas          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(trabajador_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_asistencias_trabajador_fecha ON asistencias(trabajador_id, fecha);
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente ON asistencias(cliente_rfc);

-- Row Level Security — cada cliente solo ve sus propios trabajadores/asistencias
ALTER TABLE trabajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE asistencias  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clientes ven y editan solo sus trabajadores" ON trabajadores;
CREATE POLICY "Clientes ven y editan solo sus trabajadores"
  ON trabajadores FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

DROP POLICY IF EXISTS "Clientes ven y editan solo sus asistencias" ON asistencias;
CREATE POLICY "Clientes ven y editan solo sus asistencias"
  ON asistencias FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

-- (Opcional) Marcar qué clientes compraron el checador ZKTeco
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS checador_zkteco BOOLEAN DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS checador_zkteco_fecha DATE;

-- ════════════════════════════════════════════════════════════════
-- ACTAS POR INASISTENCIA — se generan automáticamente al marcar una
-- falta en el calendario. Quedan como "provisional" mientras no se
-- resuelve (ej. el trabajador todavía no trae la incapacidad), y se
-- pueden editar/cerrar después sin perder el historial.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS actas_inasistencia (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id     UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  cliente_rfc       TEXT NOT NULL REFERENCES clientes(rfc) ON DELETE CASCADE,
  fecha             DATE NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('injustificada','justificada')),
  motivo            TEXT,
  folio_incapacidad TEXT,
  observaciones     TEXT,
  estado            TEXT NOT NULL DEFAULT 'provisional' CHECK (estado IN ('provisional','cerrada')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(trabajador_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_actas_inasistencia_cliente ON actas_inasistencia(cliente_rfc, estado);

ALTER TABLE actas_inasistencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clientes ven y editan solo sus actas de inasistencia" ON actas_inasistencia;
CREATE POLICY "Clientes ven y editan solo sus actas de inasistencia"
  ON actas_inasistencia FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

-- ════════════════════════════════════════════════════════════════
-- SOLICITUDES DE ASESORÍA — lo que el cliente manda desde "Solicitar
-- asesoría" en su portal. Antes no se guardaba en ningún lado.
-- Compatible tanto si ya existía la tabla (guía original, con
-- cliente_id) como si es la primera vez que se crea.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS solicitudes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id  UUID REFERENCES clientes(id) ON DELETE CASCADE,
  tipo        TEXT,
  prioridad   TEXT DEFAULT 'normal',
  descripcion TEXT NOT NULL,
  trabajador  TEXT,
  salario     NUMERIC,
  status      TEXT DEFAULT 'pendiente',
  respuesta   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Columnas que faltaban para que el portal pueda escribir directo por RFC
-- (sin tener que resolver primero el UUID del cliente)
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS cliente_rfc TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS empresa TEXT;
ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS antiguedad TEXT;

CREATE INDEX IF NOT EXISTS idx_solicitudes_cliente_rfc ON solicitudes(cliente_rfc, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitudes_status ON solicitudes(status, prioridad);

ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY;

-- ⚠️ Si ya tenías una política vieja en esta tabla con el patrón
-- auth.jwt()->>'rfc' (sin user_metadata), bórrala — es la que causaba
-- fallas de autenticación. Esta es la versión corregida:
DROP POLICY IF EXISTS "cliente_solicitudes" ON solicitudes;
DROP POLICY IF EXISTS "Clientes ven y crean solo sus solicitudes" ON solicitudes;
CREATE POLICY "Clientes ven y crean solo sus solicitudes"
  ON solicitudes FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

-- El dashboard del abogado NO usa esta política — lee todas las solicitudes
-- a través de una Netlify Function con la service_role key (ver
-- netlify/functions/solicitudes-admin.js), que ignora RLS por diseño.


-- ═══════════════════════════════════════════════════════════════
-- PARTE 2 — Login de administrador, RLS con acceso de admin, firma
-- electrónica simple, programa de referidos y comisiones
-- ═══════════════════════════════════════════════════════════════
-- NOTA: el PASO 1 de aquí abajo (crear tu usuario admin y marcarlo con
-- role:admin) YA LO HICISTE — lo confirmamos cuando entraste por primera
-- vez a tu dashboard con serjuemsa@gmail.com. No necesitas repetirlo,
-- está dejado solo como referencia (las líneas vienen comentadas con --).

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


-- ═══════════════════════════════════════════════════════════════
-- PARTE 3 — Arreglo de las 4 cuentas demo (dominio de correo viejo)
-- ═══════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- ARREGLO: las 4 cuentas demo se crearon con el dominio interno viejo
-- (@clm.mx) y el código ahora busca @clicklaboral.mx — por eso el
-- login de demo dejó de funcionar. Esto actualiza el correo de Auth
-- de cada una para que coincida con el dominio nuevo.
-- ════════════════════════════════════════════════════════════════

UPDATE auth.users SET email = 'din800101aaa@clicklaboral.mx', raw_user_meta_data = raw_user_meta_data
  WHERE email = 'din800101aaa@clm.mx';
UPDATE auth.users SET email = 'mtj750515bbb@clicklaboral.mx'
  WHERE email = 'mtj750515bbb@clm.mx';
UPDATE auth.users SET email = 'amd190501ddd@clicklaboral.mx'
  WHERE email = 'amd190501ddd@clm.mx';
UPDATE auth.users SET email = 'ref901230ccc@clicklaboral.mx'
  WHERE email = 'ref901230ccc@clm.mx';

-- Verifica que haya quedado bien (deben aparecer las 4 con @clicklaboral.mx):
SELECT email, raw_user_meta_data->>'rfc' AS rfc FROM auth.users WHERE email LIKE '%@clicklaboral.mx';

-- ════════════════════════════════════════════════════════════════
-- MEJORAS AL PANEL ADMIN DE SUSCRIPCIONES — columnas que faltan
-- en la tabla "clientes" para que las cancelaciones y los planes
-- anuales queden bien registrados.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS periodo TEXT DEFAULT 'mensual';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_cancelacion TIMESTAMPTZ;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS trabajadores INTEGER DEFAULT 0;

-- ════════════════════════════════════════════════════════════════
-- EXPEDIENTE ÚNICO DE TRABAJADOR — tabla de documentos generados
-- Vincula cada documento generado (contrato, acta, permiso, etc.)
-- a un trabajador del roster (tabla "trabajadores") y a su empresa.
--
-- NOTA: se llama "documentos_expediente" (no "documentos") porque
-- ya existe una tabla "documentos" en uso por dashboard-compliance.html
-- y portal-cliente.html para otro propósito (cliente_id, status, url_pdf).
-- Son tablas independientes, no hay conflicto entre ellas.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS documentos_expediente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id UUID REFERENCES trabajadores(id) ON DELETE SET NULL,
  cliente_rfc   TEXT NOT NULL REFERENCES clientes(rfc) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,   -- ej. 'contrato_indeterminado', 'acta_aperc', 'permiso', etc.
  nombre        TEXT NOT NULL,   -- nombre descriptivo para mostrar en el expediente
  generador     TEXT NOT NULL,   -- archivo HTML que lo generó, ej. 'acta-administrativa.html'
  metadata      JSONB,           -- datos clave del documento (fecha, folio, tipo de acta, etc.)
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_expediente_trabajador ON documentos_expediente(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_documentos_expediente_cliente ON documentos_expediente(cliente_rfc);

ALTER TABLE documentos_expediente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clientes ven y editan solo sus documentos de expediente" ON documentos_expediente;
CREATE POLICY "Clientes ven y editan solo sus documentos de expediente"
  ON documentos_expediente FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

-- ════════════════════════════════════════════════════════════════
-- CHECKLIST DE DOCUMENTOS DE IDENTIDAD DEL EXPEDIENTE
-- (identificación oficial, CURP, comprobante NSS, constancia RFC, etc.)
-- Los archivos en sí se guardan en Supabase Storage (bucket "expedientes");
-- esta tabla solo registra qué se subió, cuándo, y la ruta del archivo.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS documentos_identidad (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  cliente_rfc   TEXT NOT NULL REFERENCES clientes(rfc) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,   -- 'identificacion','curp','nss','rfc','comprobante_domicilio','acta_nacimiento','otro'
  nombre_archivo TEXT NOT NULL,
  storage_path  TEXT NOT NULL,  -- ruta dentro del bucket "expedientes"
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_identidad_trabajador ON documentos_identidad(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_documentos_identidad_cliente ON documentos_identidad(cliente_rfc);

ALTER TABLE documentos_identidad ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clientes ven y editan solo sus documentos de identidad" ON documentos_identidad;
CREATE POLICY "Clientes ven y editan solo sus documentos de identidad"
  ON documentos_identidad FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

-- ════════════════════════════════════════════════════════════════
-- STORAGE: bucket privado "expedientes" para los archivos escaneados.
-- IMPORTANTE: el bucket en sí NO se puede crear por SQL — debes crearlo
-- manualmente en Supabase Dashboard → Storage → New bucket:
--   Nombre: expedientes
--   Public: NO (privado)
-- Una vez creado el bucket, estas políticas controlan el acceso:
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Clientes suben archivos a su propia carpeta" ON storage.objects;
CREATE POLICY "Clientes suben archivos a su propia carpeta"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'expedientes'
    AND (storage.foldername(name))[1] = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
  );

DROP POLICY IF EXISTS "Clientes ven archivos de su propia carpeta" ON storage.objects;
CREATE POLICY "Clientes ven archivos de su propia carpeta"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'expedientes'
    AND (storage.foldername(name))[1] = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
  );

DROP POLICY IF EXISTS "Clientes borran archivos de su propia carpeta" ON storage.objects;
CREATE POLICY "Clientes borran archivos de su propia carpeta"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'expedientes'
    AND (storage.foldername(name))[1] = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
  );

-- ════════════════════════════════════════════════════════════════
-- DOCUMENTOS PERSONALIZADOS DEL EXPEDIENTE — categorías que cada
-- empresa define según su giro (ej. "Licencia de conducir",
-- "Certificado de manejo de alimentos", "Curso de altura", etc.)
-- Independientes del checklist fijo de identidad.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tipos_documento_personalizado (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_rfc TEXT NOT NULL REFERENCES clientes(rfc) ON DELETE CASCADE,
  label       TEXT NOT NULL,   -- nombre que la empresa le puso, ej. "Licencia de conducir"
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tipos_doc_personalizado_cliente ON tipos_documento_personalizado(cliente_rfc);

ALTER TABLE tipos_documento_personalizado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clientes ven y editan solo sus tipos personalizados" ON tipos_documento_personalizado;
CREATE POLICY "Clientes ven y editan solo sus tipos personalizados"
  ON tipos_documento_personalizado FOR ALL
  USING (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc')
  WITH CHECK (cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc');

-- ══════════════════════════════════════════════════════════════
-- TABLA: documentos_expediente
-- Registra los documentos generados vinculados al expediente
-- de cada trabajador. Ejecutar una sola vez.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documentos_expediente (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id     uuid REFERENCES trabajadores(id) ON DELETE CASCADE,
  cliente_rfc       text NOT NULL,
  tipo              text NOT NULL,      -- 'renuncia','finiquito','liquidacion', etc.
  nombre            text NOT NULL,      -- Nombre legible del documento
  fecha             date NOT NULL DEFAULT CURRENT_DATE,
  generado_en       text,               -- 'cartas-laborales', 'acta-administrativa', etc.
  metadata          jsonb DEFAULT '{}',
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE documentos_expediente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente ve sus documentos" ON documentos_expediente;
CREATE POLICY "Cliente ve sus documentos" ON documentos_expediente
  FOR ALL USING (
    cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc'
    OR (auth.jwt()::jsonb)->'user_metadata'->>'role' = 'admin'
  );

-- ══════════════════════════════════════════════════════════════
-- NIVEL 1 — RENDIMIENTO Y ESCALABILIDAD
-- Ejecutar en Supabase SQL Editor (rol: postgres)
-- Estos índices son seguros: usan IF NOT EXISTS, no rompen nada
-- ══════════════════════════════════════════════════════════════

-- ── TRABAJADORES ──
-- Búsqueda por RFC del cliente (el más frecuente: cargarTrabajadores)
CREATE INDEX IF NOT EXISTS idx_trabajadores_cliente_rfc
  ON trabajadores(cliente_rfc);

-- Búsqueda por nombre dentro de un cliente (guardarEnExpediente, búsquedas)
CREATE INDEX IF NOT EXISTS idx_trabajadores_cliente_nombre
  ON trabajadores(cliente_rfc, nombre);

-- Filtrar activos vs dados de baja frecuentemente
CREATE INDEX IF NOT EXISTS idx_trabajadores_activo
  ON trabajadores(cliente_rfc, activo) WHERE activo = true;

-- ── ASISTENCIAS ──
-- La consulta más pesada: asistencias de un trabajador en un mes
CREATE INDEX IF NOT EXISTS idx_asistencias_trabajador_fecha
  ON asistencias(trabajador_id, fecha);

-- Para el tablero anual: todos los trabajadores de un cliente en un rango de fechas
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente_fecha
  ON asistencias(cliente_rfc, fecha);

-- Para estadísticas por status (faltas, vacaciones por tipo)
CREATE INDEX IF NOT EXISTS idx_asistencias_cliente_status
  ON asistencias(cliente_rfc, status, fecha);

-- ── ACTAS DE INASISTENCIA ──
CREATE INDEX IF NOT EXISTS idx_actas_trabajador
  ON actas_inasistencia(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_actas_cliente
  ON actas_inasistencia(cliente_rfc, fecha);

-- ── DOCUMENTOS EXPEDIENTE ──
CREATE INDEX IF NOT EXISTS idx_docs_expediente_trabajador
  ON documentos_expediente(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_docs_expediente_cliente
  ON documentos_expediente(cliente_rfc, fecha DESC);

-- ── DOCUMENTOS IDENTIDAD ──
CREATE INDEX IF NOT EXISTS idx_docs_identidad_trabajador
  ON documentos_identidad(trabajador_id);

-- ── COLUMNAS NUEVAS: baja y paginación ──
-- Agregar columnas de baja si no existen (idempotente)
ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS fecha_baja              DATE,
  ADD COLUMN IF NOT EXISTS motivo_baja             TEXT,
  ADD COLUMN IF NOT EXISTS observaciones_baja      TEXT,
  ADD COLUMN IF NOT EXISTS fecha_eliminacion_permitida DATE;

-- Índice para consultar trabajadores dados de baja por cliente
CREATE INDEX IF NOT EXISTS idx_trabajadores_baja
  ON trabajadores(cliente_rfc, fecha_baja) WHERE fecha_baja IS NOT NULL;

-- ── ESTADÍSTICAS PARA EL ADMIN (ANALYZE actualiza el planner) ──
ANALYZE trabajadores;
ANALYZE asistencias;
ANALYZE documentos_expediente;


-- ════════════════════════════════════════════════════════════════════
-- MEJORAS DE SEGURIDAD Y CUMPLIMIENTO Art. 804 LFT
-- Soft-delete: los registros no se borran permanentemente
-- Se agrega deleted_at + retención mínima de 5 años
-- ════════════════════════════════════════════════════════════════════

-- Agregar deleted_at a las tablas principales
ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE documentos_expediente
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Vista para trabajadores activos (no borrados)
CREATE OR REPLACE VIEW trabajadores_activos AS
  SELECT * FROM trabajadores
  WHERE deleted_at IS NULL;

-- Función de soft-delete que respeta retención de 5 años (Art. 804 LFT)
CREATE OR REPLACE FUNCTION soft_delete_trabajador(p_id UUID)
RETURNS VOID AS $$
DECLARE
  v_ingreso DATE;
BEGIN
  SELECT fecha_ingreso INTO v_ingreso FROM trabajadores WHERE id = p_id;
  -- Art. 804 LFT: retener documentos mínimo 5 años desde la baja
  UPDATE trabajadores
  SET
    activo    = false,
    fecha_baja = COALESCE(fecha_baja, CURRENT_DATE),
    deleted_at = NULL, -- no borrar aún, solo marcar inactivo
    fecha_eliminacion_permitida = GREATEST(
      CURRENT_DATE + INTERVAL '5 years',
      COALESCE(v_ingreso, CURRENT_DATE) + INTERVAL '5 years'
    )
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Índices para filtrar registros borrados eficientemente
CREATE INDEX IF NOT EXISTS idx_trabajadores_deleted_at
  ON trabajadores(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_deleted_at
  ON documentos_expediente(deleted_at) WHERE deleted_at IS NULL;

-- RLS: usuarios solo ven registros no borrados
-- (Las políticas existentes ya filtran por cliente_rfc; agregar filtro deleted_at)
-- Nota: ejecutar DESPUÉS de las políticas RLS existentes


-- ── Ampliar el CHECK constraint de fuente en asistencias ──
-- Agregar 'control_diario' y 'api' para checadores digitales y futuras integraciones
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_fuente_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_fuente_check
  CHECK (fuente IN ('manual','csv_zkteco','csv_generico','control_diario','api','webhook'));

-- ── Ampliar CHECK constraints de la tabla asistencias ──
-- Agregar 'retraso' al status y nuevos valores de fuente

-- 1. Constraint de status: agregar 'retraso'
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_status_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_status_check
  CHECK (status IN (
    'presente','falta_injustificada','falta_justificada',
    'vacaciones','permiso','incapacidad','festivo','retraso'
  ));

-- 2. Constraint de fuente: agregar control_diario, api, webhook
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_fuente_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_fuente_check
  CHECK (fuente IN ('manual','csv_zkteco','csv_generico','control_diario','api','webhook'));

-- ── v15: apartado de vacaciones ──
-- La tabla vacaciones_programadas está en _db/sql-vacaciones-programadas.sql
-- (ejecútalo también). Aquí sólo ampliamos el origen permitido:
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_fuente_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_fuente_check
  CHECK (fuente IN ('manual','csv_zkteco','csv_generico','control_diario','api','webhook','programacion'));
