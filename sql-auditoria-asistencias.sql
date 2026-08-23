-- sql-auditoria-asistencias.sql
-- Mejoras de auditoría e inmutabilidad para registros de asistencias
-- Ejecutar en Supabase → SQL Editor

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Nuevas columnas en asistencias
-- ─────────────────────────────────────────────────────────────────────────────

-- Timestamp del servidor: se fija en el INSERT, nunca se puede cambiar
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS hora_servidor TIMESTAMPTZ DEFAULT now();

-- UID del usuario autenticado que registró la asistencia (HR o sistema)
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS registrado_por_uid UUID;

-- UID del usuario autenticado que realizó la última edición manual
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS editado_por_uid UUID;

-- Email del usuario que realizó la última edición (además del RFC)
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS editado_por_email TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger: fijar hora_servidor en INSERT y protegerla de UPDATE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_fijar_hora_servidor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Siempre usar el reloj del servidor, ignorar el valor que llegue del cliente
    NEW.hora_servidor := now();
  ELSIF TG_OP = 'UPDATE' THEN
    -- Nunca permitir que se modifique la hora del servidor
    NEW.hora_servidor := OLD.hora_servidor;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fijar_hora_servidor ON asistencias;
CREATE TRIGGER trg_fijar_hora_servidor
  BEFORE INSERT OR UPDATE ON asistencias
  FOR EACH ROW EXECUTE FUNCTION fn_fijar_hora_servidor();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: inmutabilidad para registros de fuente = 'checador' o 'adms'
--    Los registros del checador digital y del ZKTeco no se pueden editar.
--    Para corregir uno: eliminarlo e insertar uno nuevo con fuente='correccion'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_inmutabilidad_checador()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.fuente IN ('checador', 'adms') THEN
    RAISE EXCEPTION 'inmutable: El registro de % (ID: %) no puede modificarse. Para corregirlo, elimínelo e inserte uno nuevo con fuente=correccion.',
      OLD.fuente, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inmutabilidad_checador ON asistencias;
CREATE TRIGGER trg_inmutabilidad_checador
  BEFORE UPDATE ON asistencias
  FOR EACH ROW EXECUTE FUNCTION fn_inmutabilidad_checador();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Tabla de auditoría: log de todas las modificaciones a asistencias
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asistencias_audit (
  id               BIGSERIAL PRIMARY KEY,
  asistencia_id    BIGINT,          -- ID del registro original
  operacion        TEXT NOT NULL,   -- 'INSERT' | 'UPDATE' | 'DELETE'
  cliente_rfc      TEXT,
  trabajador_id    UUID,
  fecha            DATE,
  fuente_anterior  TEXT,
  fuente_nueva     TEXT,
  status_anterior  TEXT,
  status_nuevo     TEXT,
  hora_entrada_ant TEXT,
  hora_entrada_nva TEXT,
  hora_salida_ant  TEXT,
  hora_salida_nva  TEXT,
  notas_anterior   TEXT,
  notas_nueva      TEXT,
  usuario_uid      UUID,            -- quién hizo el cambio
  usuario_email    TEXT,
  ip_address       TEXT,            -- disponible si se pasa vía app
  registrado_en    TIMESTAMPTZ DEFAULT now()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_asist_audit_asistencia ON asistencias_audit(asistencia_id);
CREATE INDEX IF NOT EXISTS idx_asist_audit_cliente    ON asistencias_audit(cliente_rfc);
CREATE INDEX IF NOT EXISTS idx_asist_audit_trabajador ON asistencias_audit(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_asist_audit_fecha      ON asistencias_audit(registrado_en);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: llenar asistencias_audit en cada cambio
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_audit_asistencias()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO asistencias_audit(
      asistencia_id, operacion, cliente_rfc, trabajador_id, fecha,
      fuente_nueva, status_nuevo, hora_entrada_nva, hora_salida_nva, notas_nueva,
      usuario_uid, usuario_email
    ) VALUES (
      NEW.id, 'INSERT', NEW.cliente_rfc, NEW.trabajador_id, NEW.fecha,
      NEW.fuente, NEW.status, NEW.hora_entrada, NEW.hora_salida, NEW.notas,
      NEW.registrado_por_uid, NEW.editado_por_email
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO asistencias_audit(
      asistencia_id, operacion, cliente_rfc, trabajador_id, fecha,
      fuente_anterior, fuente_nueva,
      status_anterior, status_nuevo,
      hora_entrada_ant, hora_entrada_nva,
      hora_salida_ant,  hora_salida_nva,
      notas_anterior,   notas_nueva,
      usuario_uid, usuario_email
    ) VALUES (
      OLD.id, 'UPDATE', OLD.cliente_rfc, OLD.trabajador_id, OLD.fecha,
      OLD.fuente, NEW.fuente,
      OLD.status, NEW.status,
      OLD.hora_entrada, NEW.hora_entrada,
      OLD.hora_salida,  NEW.hora_salida,
      OLD.notas, NEW.notas,
      NEW.editado_por_uid, NEW.editado_por_email
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO asistencias_audit(
      asistencia_id, operacion, cliente_rfc, trabajador_id, fecha,
      fuente_anterior, status_anterior, hora_entrada_ant, hora_salida_ant, notas_anterior,
      usuario_uid, usuario_email
    ) VALUES (
      OLD.id, 'DELETE', OLD.cliente_rfc, OLD.trabajador_id, OLD.fecha,
      OLD.fuente, OLD.status, OLD.hora_entrada, OLD.hora_salida, OLD.notas,
      NULL, NULL
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_asistencias ON asistencias;
CREATE TRIGGER trg_audit_asistencias
  AFTER INSERT OR UPDATE OR DELETE ON asistencias
  FOR EACH ROW EXECUTE FUNCTION fn_audit_asistencias();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS para asistencias_audit (solo lectura para el cliente dueño)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE asistencias_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit lectura propia" ON asistencias_audit;
CREATE POLICY "audit lectura propia" ON asistencias_audit
  FOR SELECT
  USING (cliente_rfc = (auth.jwt() ->> 'rfc')::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación: mostrar estructura resultante
-- ─────────────────────────────────────────────────────────────────────────────

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'asistencias'
  AND column_name IN ('hora_servidor','registrado_por_uid','editado_por_uid','editado_por_email','editado_por','editado_at')
ORDER BY ordinal_position;
