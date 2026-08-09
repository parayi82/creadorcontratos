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
