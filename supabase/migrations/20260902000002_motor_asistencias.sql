-- ═══════════════════════════════════════════════════════════════════════════
-- MOTOR CENTRAL DE ASISTENCIAS — un solo cerebro para faltas, actas y alertas
--
-- Problema que resuelve:
--   Cada escritor de `asistencias` (checador digital, ZKTeco ADMS, CSV,
--   captura manual, control diario, cron deteccion-faltas, alta retroactiva,
--   vacaciones aplicadas) actuaba por su cuenta. Nadie sincronizaba
--   `actas_inasistencia` ni `alertas_laborales` cuando un día dejaba de ser
--   falta. Resultado: actas fantasma, alertas que no se cierran, tablero
--   con FI que ya no existen.
--
-- Solución:
--   1. CHECK constraints = unión real de todos los valores usados en código
--      (la migración 20260820 excluía 'control_diario', 'adms', 'programacion'
--      → el cron y el ADMS fallaban en silencio).
--   2. alertas_laborales gana trabajador_id / fecha_evento / resuelta para
--      poder cerrarse automáticamente.
--   3. Trigger fn_reconciliar_asistencia() en asistencias: la ÚNICA pieza
--      que crea/borra actas provisionales y crea/resuelve alertas de falta.
--      Todo lo demás (tablero, calendario, reportes, aguinaldo, Art. 47,
--      dashboard compliance) YA lee de asistencias → queda consistente.
--   4. Limpieza única de datos históricos.
--
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. CHECK constraints — unión de todo lo que escribe el código ──────────
ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_status_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_status_check
  CHECK (status IN (
    'presente','retraso','falta_injustificada','falta_justificada',
    'vacaciones','permiso','incapacidad','festivo','sin_registro'
  ));

ALTER TABLE asistencias DROP CONSTRAINT IF EXISTS asistencias_fuente_check;
ALTER TABLE asistencias ADD CONSTRAINT asistencias_fuente_check
  CHECK (fuente IN (
    'manual',          -- captura RH (calendario, control diario)
    'csv_zkteco',      -- importación CSV / attlog.dat
    'csv_generico',
    'checador',        -- checador digital (inmutable)
    'adms',            -- ZKTeco ADMS push (inmutable)
    'correccion',      -- corrección de un registro inmutable
    'sistema',         -- retroactivo al alta / reconciliación
    'control_diario',  -- cierre de jornada del cron
    'programacion',    -- vacaciones aplicadas desde el tablero
    'api','webhook'
  ));

COMMENT ON COLUMN asistencias.fuente IS
  'manual | csv_zkteco | csv_generico | checador | adms | correccion | sistema | control_diario | programacion | api | webhook';

-- ── 2. alertas_laborales: trazabilidad al evento y resolución automática ──
ALTER TABLE alertas_laborales
  ADD COLUMN IF NOT EXISTS trabajador_id   UUID,
  ADD COLUMN IF NOT EXISTS fecha_evento    DATE,
  ADD COLUMN IF NOT EXISTS resuelta        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resuelta_en     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resuelta_motivo TEXT;

CREATE INDEX IF NOT EXISTS idx_alertas_evento
  ON alertas_laborales (trabajador_id, fecha_evento, tipo)
  WHERE resuelta = false;

-- ── 3. Helper: ¿el día está cubierto por vacaciones autorizadas/gozadas? ───
CREATE OR REPLACE FUNCTION fn_dia_con_vacaciones_autorizadas(p_trab UUID, p_fecha DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM vacaciones_programadas vp
    WHERE vp.trabajador_id = p_trab
      AND vp.estado IN ('autorizada','gozada')
      AND p_fecha BETWEEN vp.fecha_inicio AND vp.fecha_fin
      AND (vp.incluye_finde OR EXTRACT(ISODOW FROM p_fecha) < 6)
  );
$$;

-- ── 4. EL CEREBRO: reconciliar actas y alertas en cada cambio de asistencia ─
CREATE OR REPLACE FUNCTION fn_resolver_alertas_falta(p_trab UUID, p_fecha DATE, p_motivo TEXT)
RETURNS void LANGUAGE sql AS $$
  UPDATE alertas_laborales
     SET resuelta = true, resuelta_en = now(), resuelta_motivo = p_motivo, leida = true
   WHERE trabajador_id = p_trab AND fecha_evento = p_fecha
     AND tipo IN ('falta_injustificada','faltas_historicas')
     AND resuelta = false;
$$;

CREATE OR REPLACE FUNCTION fn_reconciliar_asistencia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trab_nombre TEXT;
  v_hoy         DATE := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_status      TEXT;
  v_trab        UUID;
  v_fecha       DATE;
  v_rfc         TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_status := NULL; v_trab := OLD.trabajador_id; v_fecha := OLD.fecha; v_rfc := OLD.cliente_rfc;
  ELSE
    v_status := NEW.status; v_trab := NEW.trabajador_id; v_fecha := NEW.fecha; v_rfc := NEW.cliente_rfc;
  END IF;

  -- Solo procesamos días ya cerrados (hoy y futuro no generan faltas)
  IF v_fecha >= v_hoy AND v_status = 'falta_injustificada' THEN
    RETURN NULL;
  END IF;

  -- ── A. Falta injustificada → acta provisional + alerta ──────────────────
  IF v_status = 'falta_injustificada' THEN
    -- Si el día tiene vacaciones autorizadas, NO es falta: corregimos la fuente de verdad
    IF fn_dia_con_vacaciones_autorizadas(v_trab, v_fecha) THEN
      UPDATE asistencias SET status = 'vacaciones', fuente = 'programacion',
             notas = 'Reconciliado: día cubierto por periodo de vacaciones autorizado.'
       WHERE id = NEW.id;
      RETURN NULL; -- el UPDATE re-dispara este trigger con status='vacaciones'
    END IF;

    SELECT nombre INTO v_trab_nombre FROM trabajadores WHERE id = v_trab;

    INSERT INTO actas_inasistencia
      (trabajador_id, cliente_rfc, fecha, tipo, motivo, observaciones, estado)
    VALUES
      (v_trab, v_rfc, v_fecha, 'injustificada',
       'No se registró entrada en el checador digital.',
       'Generada automáticamente el ' || v_hoy || '. Actualice el motivo si la ausencia fue justificada.',
       'provisional')
    ON CONFLICT (trabajador_id, fecha) DO NOTHING; -- respeta actas ya trabajadas por RH

    INSERT INTO alertas_laborales
      (cliente_rfc, tipo, trabajador_nombre, trabajador_id, fecha_evento, fecha_alerta, mensaje, urgencia, leida, resuelta)
    VALUES
      (v_rfc, 'falta_injustificada', v_trab_nombre, v_trab, v_fecha, v_hoy,
       v_trab_nombre || ' no registró entrada el ' || to_char(v_fecha, 'DD/MM/YYYY') ||
       '. Se generó un acta de inasistencia provisional. Si la ausencia fue justificada, cambie el status del día en Control de Asistencias.',
       'alta', false, false)
    ON CONFLICT (cliente_rfc, tipo, trabajador_nombre, fecha_alerta) DO UPDATE
      SET trabajador_id = EXCLUDED.trabajador_id,
          fecha_evento  = EXCLUDED.fecha_evento,
          resuelta      = false, resuelta_en = NULL, resuelta_motivo = NULL;
    RETURN NULL;
  END IF;

  -- ── B. Falta justificada → acta justificada, alerta resuelta ────────────
  IF v_status = 'falta_justificada' THEN
    INSERT INTO actas_inasistencia
      (trabajador_id, cliente_rfc, fecha, tipo, motivo, estado)
    VALUES (v_trab, v_rfc, v_fecha, 'justificada', 'Ausencia justificada por el patrón.', 'cerrada')
    ON CONFLICT (trabajador_id, fecha) DO UPDATE
      SET tipo = 'justificada', estado = 'cerrada', updated_at = now();
    PERFORM fn_resolver_alertas_falta(v_trab, v_fecha, 'Falta justificada por RH');
    RETURN NULL;
  END IF;

  -- ── C. Incapacidad → acta justificada cerrada, alerta resuelta ──────────
  IF v_status = 'incapacidad' THEN
    UPDATE actas_inasistencia
       SET tipo = 'justificada', estado = 'cerrada',
           motivo = COALESCE(NULLIF(motivo, 'No se registró entrada en el checador digital.'), 'Incapacidad médica'),
           updated_at = now()
     WHERE trabajador_id = v_trab AND fecha = v_fecha;
    PERFORM fn_resolver_alertas_falta(v_trab, v_fecha, 'Incapacidad médica');
    RETURN NULL;
  END IF;

  -- ── D. Cualquier otro estado (presente/retraso/vacaciones/permiso/festivo/
  --      sin_registro) o borrado → el día NO es falta: limpiar acta provisional
  --      y resolver alertas. Las actas 'cerradas' son documentos formales: se
  --      conservan.
  DELETE FROM actas_inasistencia
   WHERE trabajador_id = v_trab AND fecha = v_fecha
     AND estado = 'provisional' AND tipo = 'injustificada';
  PERFORM fn_resolver_alertas_falta(v_trab, v_fecha,
    'Día reconciliado como ' || COALESCE(v_status, 'sin registro'));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconciliar_asistencia ON asistencias;
CREATE TRIGGER trg_reconciliar_asistencia
  AFTER INSERT OR UPDATE OF status OR DELETE ON asistencias
  FOR EACH ROW EXECUTE FUNCTION fn_reconciliar_asistencia();

-- ── 5. Vacaciones autorizadas → cuando se autorizan, los días pasados sin
--      registro real quedan como 'vacaciones' (evita FI del cron por olvido
--      de "Aplicar"). Los días futuros los escribe el cron al cerrarlos.
CREATE OR REPLACE FUNCTION fn_vacaciones_autorizadas_reconciliar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE d DATE;
BEGIN
  IF NEW.estado NOT IN ('autorizada','gozada') THEN RETURN NULL; END IF;
  FOR d IN SELECT generate_series(NEW.fecha_inicio, LEAST(NEW.fecha_fin, CURRENT_DATE - 1), '1 day')::date LOOP
    IF NOT NEW.incluye_finde AND EXTRACT(ISODOW FROM d) >= 6 THEN CONTINUE; END IF;
    UPDATE asistencias SET status = 'vacaciones', fuente = 'programacion',
           notas = COALESCE(NEW.notas, 'Periodo de vacaciones autorizado')
     WHERE trabajador_id = NEW.trabajador_id AND fecha = d
       AND status IN ('sin_registro','falta_injustificada');
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_vacaciones_autorizadas ON vacaciones_programadas;
CREATE TRIGGER trg_vacaciones_autorizadas
  AFTER INSERT OR UPDATE OF estado ON vacaciones_programadas
  FOR EACH ROW EXECUTE FUNCTION fn_vacaciones_autorizadas_reconciliar();

-- ── 6. LIMPIEZA ÚNICA de datos históricos ──────────────────────────────────
-- 6a. FI anteriores al alta del trabajador en el sistema → presente
--     (política acordada: la asistencia empieza a controlarse desde el alta)
UPDATE asistencias a
   SET status = 'presente', fuente = 'sistema',
       notas  = 'Asistencia retroactiva — anterior al alta en ClickLaboral'
  FROM trabajadores t
 WHERE a.trabajador_id = t.id
   AND a.status IN ('falta_injustificada','sin_registro')
   AND a.fecha >= t.fecha_ingreso
   AND a.fecha <  LEAST(COALESCE(t.created_at::date, CURRENT_DATE), CURRENT_DATE)
   AND t.activo = true;

-- 6b. FI en días con vacaciones autorizadas → vacaciones
UPDATE asistencias a
   SET status = 'vacaciones', fuente = 'programacion',
       notas  = 'Reconciliado: día cubierto por periodo de vacaciones autorizado.'
 WHERE a.status IN ('falta_injustificada','sin_registro')
   AND fn_dia_con_vacaciones_autorizadas(a.trabajador_id, a.fecha);

-- 6c. Actas provisionales huérfanas (el día ya no es FI)
DELETE FROM actas_inasistencia ai
 WHERE ai.estado = 'provisional' AND ai.tipo = 'injustificada'
   AND NOT EXISTS (
     SELECT 1 FROM asistencias a
      WHERE a.trabajador_id = ai.trabajador_id AND a.fecha = ai.fecha
        AND a.status = 'falta_injustificada'
   );

-- 6d. Alertas antiguas sin trabajador_id: vincular por nombre y resolver
--     las de faltas históricas (ya reconciliadas) y las de faltas cuyo día
--     ya no es FI.
UPDATE alertas_laborales al
   SET trabajador_id = t.id
  FROM trabajadores t
 WHERE al.trabajador_id IS NULL
   AND t.cliente_rfc = al.cliente_rfc
   AND lower(t.nombre) = lower(al.trabajador_nombre);

UPDATE alertas_laborales
   SET resuelta = true, resuelta_en = now(), leida = true,
       resuelta_motivo = 'Reconciliación histórica: asistencias anteriores al alta marcadas como presente'
 WHERE tipo = 'faltas_historicas' AND resuelta = false;

UPDATE alertas_laborales al
   SET resuelta = true, resuelta_en = now(), leida = true,
       resuelta_motivo = 'Reconciliación: el trabajador ya no tiene faltas injustificadas pendientes'
 WHERE al.tipo = 'falta_injustificada' AND al.resuelta = false
   AND al.trabajador_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM actas_inasistencia ai
      WHERE ai.trabajador_id = al.trabajador_id AND ai.estado = 'provisional'
   );

-- ── Verificación ───────────────────────────────────────────────────────────
SELECT 'FI pendientes (días pasados)'  AS metrica, COUNT(*) FROM asistencias WHERE status='falta_injustificada' AND fecha < CURRENT_DATE
UNION ALL
SELECT 'Actas provisionales',           COUNT(*) FROM actas_inasistencia WHERE estado='provisional'
UNION ALL
SELECT 'Alertas de falta sin resolver', COUNT(*) FROM alertas_laborales WHERE tipo='falta_injustificada' AND resuelta=false;
