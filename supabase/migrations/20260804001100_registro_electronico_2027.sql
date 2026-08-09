-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRO ELECTRÓNICO DE JORNADA — Cumplimiento Art. 132 fr. XXXIV LFT
-- (Reforma DOF 01-05-2026 · obligatorio a partir del 1 de enero de 2027)
--
-- La ley exige un registro electrónico con INTEGRIDAD y TRAZABILIDAD, cuyo
-- contenido puede hacer prueba plena en juicio. Esta migración agrega:
--   1. Sello de tiempo del SERVIDOR en cada marcación (no manipulable desde
--      el reloj del dispositivo/tablet).
--   2. Bitácora inmutable de toda modificación o borrado posterior de un
--      registro de asistencia (quién, cuándo, valores anteriores).
--
-- Ejecutar completo en Supabase SQL Editor. Idempotente (re-ejecutable).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Sello de tiempo de servidor en asistencias ──────────────────────────
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS registrado_ts TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS modificado_ts TIMESTAMPTZ NULL;

COMMENT ON COLUMN asistencias.registrado_ts IS
  'Sello de tiempo del servidor al crear el registro (integridad Art. 132 fr. XXXIV LFT). No depende del reloj del dispositivo.';

-- ── 2. Bitácora inmutable de cambios ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS asistencias_bitacora (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asistencia_id UUID NOT NULL,
  trabajador_id UUID,
  cliente_rfc   TEXT NOT NULL,
  operacion     TEXT NOT NULL CHECK (operacion IN ('UPDATE','DELETE')),
  datos_previos JSONB NOT NULL,           -- fila completa ANTES del cambio
  usuario_auth  UUID,                     -- auth.uid() que ejecutó el cambio
  usuario_rfc   TEXT,                     -- rfc del user_metadata (patrón/despacho)
  sellado_ts    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bitacora_asistencia ON asistencias_bitacora(asistencia_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_cliente    ON asistencias_bitacora(cliente_rfc, sellado_ts DESC);

-- ── 3. Trigger de auditoría (SECURITY DEFINER: escribe aunque el usuario
--       no tenga permisos directos sobre la bitácora) ──────────────────────
CREATE OR REPLACE FUNCTION fn_auditar_asistencias()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.modificado_ts := now();
    INSERT INTO asistencias_bitacora
      (asistencia_id, trabajador_id, cliente_rfc, operacion, datos_previos, usuario_auth, usuario_rfc)
    VALUES
      (OLD.id, OLD.trabajador_id, OLD.cliente_rfc, 'UPDATE', to_jsonb(OLD),
       auth.uid(), (auth.jwt()::jsonb)->'user_metadata'->>'rfc');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO asistencias_bitacora
      (asistencia_id, trabajador_id, cliente_rfc, operacion, datos_previos, usuario_auth, usuario_rfc)
    VALUES
      (OLD.id, OLD.trabajador_id, OLD.cliente_rfc, 'DELETE', to_jsonb(OLD),
       auth.uid(), (auth.jwt()::jsonb)->'user_metadata'->>'rfc');
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditar_asistencias ON asistencias;
CREATE TRIGGER trg_auditar_asistencias
  BEFORE UPDATE OR DELETE ON asistencias
  FOR EACH ROW EXECUTE FUNCTION fn_auditar_asistencias();

-- ── 4. RLS de la bitácora: solo LECTURA del propio cliente. Nadie puede
--       insertar/editar/borrar directamente (solo el trigger) ──────────────
ALTER TABLE asistencias_bitacora ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clientes leen su bitacora de jornada" ON asistencias_bitacora;
CREATE POLICY "Clientes leen su bitacora de jornada"
  ON asistencias_bitacora FOR SELECT
  USING ( cliente_rfc = (auth.jwt()::jsonb)->'user_metadata'->>'rfc' );
-- Sin políticas INSERT/UPDATE/DELETE → operaciones directas bloqueadas.
-- El trigger inserta vía SECURITY DEFINER, garantizando inmutabilidad.

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (opcional): tras editar una asistencia desde el calendario,
--   SELECT * FROM asistencias_bitacora ORDER BY sellado_ts DESC LIMIT 5;
-- debe mostrar la fila con los valores previos y el rfc del usuario.
-- ═══════════════════════════════════════════════════════════════════════════
