-- ═══════════════════════════════════════════════════════════════════════════
-- SELLO DE TIEMPO DEL SERVIDOR POR MARCACIÓN (entrada y salida)
-- Registro electrónico de jornada — Art. 132 fr. XXXIV LFT
--
-- Problema que corrige (verificado en el código, noviembre 2026):
--   • registrado_ts solo se fija en el INSERT. La SALIDA del checador es un
--     UPDATE de hora_salida → nunca tuvo sello de servidor propio. El único
--     rastro era modificado_ts, que se sobrescribe con cualquier edición
--     posterior.
--   • Si ya existía un registro del día (p.ej. capturado desde el calendario),
--     la ENTRADA del checador lo actualiza y registrado_ts queda con la hora
--     de aquella captura, no la del checado.
--   • hora_entrada / hora_salida vienen del reloj del dispositivo (tablet o
--     reloj ZKTeco), que controla el patrón.
--
-- Solución:
--   entrada_ts / salida_ts = now() del servidor en el momento exacto en que
--   Postgres recibe cada marcación. Lo fija un trigger BEFORE INSERT/UPDATE;
--   cualquier valor que mande el cliente se ignora (no se pueden falsificar
--   vía API). hora_entrada / hora_salida se conservan como "hora declarada
--   por el dispositivo", solo como referencia.
--   Una edición manual posterior de la hora (desde el calendario) vuelve a
--   sellar con la hora real de la edición — queda claro cuándo se capturó
--   el valor — y la bitácora (trg_auditar_asistencias) conserva el anterior.
--
-- Ejecutar completo en Supabase SQL Editor. Idempotente (re-ejecutable).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas ────────────────────────────────────────────────────────────
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS entrada_ts TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS salida_ts  TIMESTAMPTZ NULL;

COMMENT ON COLUMN asistencias.entrada_ts IS
  'Sello de tiempo del SERVIDOR cuando se recibió la hora de entrada (trigger trg_sellar_marcaciones). No lo puede escribir el cliente. hora_entrada es la hora declarada por el dispositivo.';
COMMENT ON COLUMN asistencias.salida_ts IS
  'Sello de tiempo del SERVIDOR cuando se recibió la hora de salida (trigger trg_sellar_marcaciones). No lo puede escribir el cliente. hora_salida es la hora declarada por el dispositivo.';

-- ── 2. Trigger de sellado ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_sellar_marcaciones()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.entrada_ts := CASE WHEN NEW.hora_entrada IS NOT NULL THEN now() END;
    NEW.salida_ts  := CASE WHEN NEW.hora_salida  IS NOT NULL THEN now() END;
  ELSE -- UPDATE
    IF NEW.hora_entrada IS DISTINCT FROM OLD.hora_entrada THEN
      NEW.entrada_ts := CASE WHEN NEW.hora_entrada IS NOT NULL THEN now() END;
    ELSE
      NEW.entrada_ts := OLD.entrada_ts;   -- el cliente no puede reescribirlo
    END IF;
    IF NEW.hora_salida IS DISTINCT FROM OLD.hora_salida THEN
      NEW.salida_ts := CASE WHEN NEW.hora_salida IS NOT NULL THEN now() END;
    ELSE
      NEW.salida_ts := OLD.salida_ts;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sellar_marcaciones ON asistencias;
CREATE TRIGGER trg_sellar_marcaciones
  BEFORE INSERT OR UPDATE ON asistencias
  FOR EACH ROW EXECUTE FUNCTION fn_sellar_marcaciones();

-- ── 3. Histórico: solo donde el sello es EXACTO ─────────────────────────────
-- Para registros del checador digital que nunca se modificaron (sin ninguna
-- fila en la bitácora), la entrada se hizo en el INSERT → registrado_ts es
-- exactamente el sello de servidor de la entrada. Los demás históricos se
-- dejan en NULL a propósito (no se inventan sellos); su historia está en
-- asistencias_bitacora.
-- (Este UPDATE dispara el trigger, que preserva OLD.entrada_ts porque
--  hora_entrada no cambia — por eso se desactiva solo el sellado mientras
--  corre; la bitácora sí registra el cambio, como debe ser.)
ALTER TABLE asistencias DISABLE TRIGGER trg_sellar_marcaciones;
UPDATE asistencias a
   SET entrada_ts = a.registrado_ts
 WHERE a.entrada_ts IS NULL
   AND a.hora_entrada IS NOT NULL
   AND a.registrado_ts IS NOT NULL
   AND a.fuente = 'checador'
   AND NOT EXISTS (SELECT 1 FROM asistencias_bitacora b WHERE b.asistencia_id = a.id);
ALTER TABLE asistencias ENABLE TRIGGER trg_sellar_marcaciones;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- 1) El trigger existe y está habilitado (tgenabled = 'O'):
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'asistencias'::regclass AND NOT tgisinternal;
--   → trg_auditar_asistencias, trg_reconciliar_asistencia, trg_sellar_marcaciones
-- 2) Tras checar entrada y salida en el kiosco:
--   SELECT fecha, hora_entrada, entrada_ts, hora_salida, salida_ts, fuente
--     FROM asistencias WHERE fuente = 'checador'
--    ORDER BY registrado_ts DESC LIMIT 5;
--   → entrada_ts y salida_ts con la hora real del servidor.
-- ═══════════════════════════════════════════════════════════════════════════
