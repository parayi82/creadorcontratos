-- ═══════════════════════════════════════════════════════════════════════════
-- MARCACIONES INMUTABLES (solo-agregar) + PAUSAS
-- Registro electrónico de jornada — Art. 132 fr. XXXIV LFT
--
-- Hasta ahora la única fuente era `asistencias`: un renglón por trabajador y
-- día que se EDITA (la salida es un UPDATE; RH puede cambiar horas). Queda
-- auditado en asistencias_bitacora, pero el dato en sí es mutable y no hay
-- forma de registrar pausas.
--
-- Esta migración agrega `marcaciones`: el registro crudo de cada checada
-- (entrada, inicio_pausa, fin_pausa, salida). Reglas:
--   • Nadie puede hacer UPDATE / DELETE / TRUNCATE — ni el patrón, ni el
--     backend con service_role. Lo bloquea un trigger, no solo RLS.
--   • ts_servidor lo fija Postgres (now()); el cliente no lo puede mandar.
--   • Las correcciones son CONTRA-ASIENTOS: una marcación nueva con
--     fuente='correccion' y motivo obligatorio, o una 'anulacion' que apunta
--     a la marcación que deja sin efecto. La original nunca desaparece.
--   • Sin FK hacia trabajadores a propósito: borrar un trabajador (o un
--     cliente) no debe poder arrastrar la evidencia de jornada (Art. 804 LFT:
--     conservar hasta un año después de terminada la relación).
--
-- `asistencias` se mantiene como RESUMEN diario (lo usan el motor de faltas,
-- actas, calendario y reportes). La función registrar_marcacion() escribe la
-- marcación y actualiza el resumen en la misma transacción.
--
-- Requiere: 20260809000300 (es_cliente_de_despacho), 20261101000000.
-- Ejecutar completo en Supabase SQL Editor. Idempotente (re-ejecutable).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tabla ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marcaciones (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trabajador_id      UUID        NOT NULL,
  cliente_rfc        TEXT        NOT NULL,
  fecha              DATE        NOT NULL,   -- jornada a la que pertenece
  tipo               TEXT        NOT NULL CHECK (tipo IN
                       ('entrada','inicio_pausa','fin_pausa','salida','anulacion')),
  ts_servidor        TIMESTAMPTZ NOT NULL DEFAULT now(),
  hora_dispositivo   TIMESTAMP   NULL,       -- fecha-hora LOCAL declarada por el dispositivo (referencia)
  fuente             TEXT        NOT NULL CHECK (fuente IN ('checador','adms','correccion')),
  geo_lat            NUMERIC(9,6) NULL,
  geo_lng            NUMERIC(9,6) NULL,
  anula_id           BIGINT      NULL REFERENCES marcaciones(id),
  motivo             TEXT        NULL,
  registrado_por_uid UUID        NULL,
  registrado_por_rfc TEXT        NULL,
  CONSTRAINT marcaciones_anulacion_chk
    CHECK ((tipo = 'anulacion') = (anula_id IS NOT NULL)),
  CONSTRAINT marcaciones_motivo_chk
    CHECK (fuente <> 'correccion' OR length(trim(coalesce(motivo,''))) >= 5),
  -- Evita duplicar checadas que el reloj ZKTeco reenvía
  CONSTRAINT marcaciones_dedup UNIQUE (trabajador_id, fuente, tipo, hora_dispositivo)
);

CREATE INDEX IF NOT EXISTS idx_marcaciones_trab_fecha  ON marcaciones(trabajador_id, fecha, ts_servidor);
CREATE INDEX IF NOT EXISTS idx_marcaciones_cliente     ON marcaciones(cliente_rfc, fecha);
CREATE INDEX IF NOT EXISTS idx_marcaciones_anula       ON marcaciones(anula_id) WHERE anula_id IS NOT NULL;

COMMENT ON TABLE marcaciones IS
  'Registro inmutable (solo-agregar) de cada checada. Sin UPDATE/DELETE/TRUNCATE para nadie (trigger). Correcciones = contra-asientos con motivo.';

-- ── 2. Sellos forzados por el servidor en el INSERT ────────────────────────
CREATE OR REPLACE FUNCTION fn_marcaciones_sellar()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.ts_servidor        := now();
  NEW.registrado_por_uid := auth.uid();
  NEW.registrado_por_rfc := (auth.jwt()::jsonb)->'user_metadata'->>'rfc';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marcaciones_sellar ON marcaciones;
CREATE TRIGGER trg_marcaciones_sellar
  BEFORE INSERT ON marcaciones
  FOR EACH ROW EXECUTE FUNCTION fn_marcaciones_sellar();

-- ── 3. Inmutabilidad: bloquear UPDATE / DELETE / TRUNCATE ──────────────────
CREATE OR REPLACE FUNCTION fn_marcaciones_inmutables()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'marcaciones es un registro inmutable: % no permitido. Use una corrección (contra-asiento) con motivo.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_marcaciones_inmutables ON marcaciones;
CREATE TRIGGER trg_marcaciones_inmutables
  BEFORE UPDATE OR DELETE ON marcaciones
  FOR EACH ROW EXECUTE FUNCTION fn_marcaciones_inmutables();

DROP TRIGGER IF EXISTS trg_marcaciones_no_truncate ON marcaciones;
CREATE TRIGGER trg_marcaciones_no_truncate
  BEFORE TRUNCATE ON marcaciones
  FOR EACH STATEMENT EXECUTE FUNCTION fn_marcaciones_inmutables();

-- ── 4. Permisos y RLS: el cliente solo LEE; escribe vía las funciones ──────
ALTER TABLE marcaciones ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON marcaciones FROM anon, authenticated;
GRANT SELECT ON marcaciones TO authenticated;

DROP POLICY IF EXISTS "lectura_marcaciones" ON marcaciones;
CREATE POLICY "lectura_marcaciones" ON marcaciones FOR SELECT
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );
-- Sin políticas INSERT/UPDATE/DELETE a propósito.

-- ── 5. Helper: ¿la sesión puede operar sobre este cliente? ─────────────────
-- Mismo criterio que la política "acceso_asistencias".
CREATE OR REPLACE FUNCTION fn_puede_operar_cliente(p_rfc TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- coalesce: sin rol/rfc en el JWT la comparación da NULL, y un IF NOT NULL
  -- NO entra al bloque → dejaría pasar. Siempre devolver true/false.
  SELECT coalesce(auth.uid() IS NOT NULL AND (
       p_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(p_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  ), false);
$$;

-- Última marcación vigente (no anulada) de una jornada
CREATE OR REPLACE FUNCTION fn_ultima_marcacion(p_trabajador_id UUID, p_fecha DATE)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT m.tipo FROM marcaciones m
   WHERE m.trabajador_id = p_trabajador_id
     AND m.fecha = p_fecha
     AND m.tipo <> 'anulacion'
     AND NOT EXISTS (SELECT 1 FROM marcaciones x WHERE x.anula_id = m.id)
   ORDER BY m.ts_servidor DESC, m.id DESC
   LIMIT 1;
$$;

-- ── 6. registrar_marcacion: la ÚNICA vía del kiosco ────────────────────────
CREATE OR REPLACE FUNCTION registrar_marcacion(
  p_trabajador_id    UUID,
  p_tipo             TEXT,
  p_fecha            DATE,
  p_hora_dispositivo TIMESTAMP DEFAULT NULL,
  p_nip              TEXT      DEFAULT NULL,
  p_geo_lat          NUMERIC   DEFAULT NULL,
  p_geo_lng          NUMERIC   DEFAULT NULL,
  p_status           TEXT      DEFAULT 'presente'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t        RECORD;
  v_hoy    DATE := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_ultimo TEXT;
  v_hora   TIME;
  v_id     BIGINT;
  v_ts     TIMESTAMPTZ;
  a        RECORD;
BEGIN
  IF p_tipo NOT IN ('entrada','inicio_pausa','fin_pausa','salida') THEN
    RAISE EXCEPTION 'Tipo de marcación no válido: %', p_tipo;
  END IF;

  SELECT id, cliente_rfc, nip, activo INTO t FROM trabajadores WHERE id = p_trabajador_id;
  IF NOT FOUND OR NOT coalesce(t.activo, false) THEN
    RAISE EXCEPTION 'Trabajador no encontrado o inactivo';
  END IF;
  IF fn_puede_operar_cliente(t.cliente_rfc) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sin permiso para registrar asistencia de este trabajador'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- NIP validado en el servidor (si el trabajador tiene uno)
  IF nullif(trim(coalesce(t.nip,'')),'') IS NOT NULL
     AND trim(coalesce(p_nip,'')) <> trim(t.nip) THEN
    RAISE EXCEPTION 'NIP incorrecto';
  END IF;

  -- La jornada debe ser de ayer/hoy/mañana (cubre zonas horarias de MX y
  -- turno nocturno); impide fabricar checadas de fechas pasadas.
  IF p_fecha IS NULL OR p_fecha < v_hoy - 1 OR p_fecha > v_hoy + 1 THEN
    RAISE EXCEPTION 'Fecha de jornada fuera de rango: %', p_fecha;
  END IF;

  -- Serializar checadas del mismo trabajador (doble toque)
  PERFORM pg_advisory_xact_lock(hashtext('marcacion:' || p_trabajador_id::text));

  v_ultimo := fn_ultima_marcacion(p_trabajador_id, p_fecha);
  IF v_ultimo IS NULL THEN
    -- Jornadas abiertas antes de existir esta tabla: inferir del resumen
    SELECT hora_entrada, hora_salida INTO a
      FROM asistencias WHERE trabajador_id = p_trabajador_id AND fecha = p_fecha;
    IF FOUND AND a.hora_entrada IS NOT NULL THEN
      v_ultimo := CASE WHEN a.hora_salida IS NULL THEN 'entrada' ELSE 'salida' END;
    END IF;
  END IF;

  IF p_tipo = 'entrada' AND v_ultimo IS NOT NULL THEN
    RAISE EXCEPTION 'Ya hay una entrada registrada para esta jornada';
  ELSIF p_tipo = 'inicio_pausa' AND coalesce(v_ultimo,'') NOT IN ('entrada','fin_pausa') THEN
    RAISE EXCEPTION 'No se puede iniciar pausa: el trabajador no está dentro';
  ELSIF p_tipo = 'fin_pausa' AND coalesce(v_ultimo,'') <> 'inicio_pausa' THEN
    RAISE EXCEPTION 'No hay una pausa abierta';
  ELSIF p_tipo = 'salida' AND coalesce(v_ultimo,'') NOT IN ('entrada','inicio_pausa','fin_pausa') THEN
    RAISE EXCEPTION 'No hay una entrada abierta para registrar la salida';
  END IF;

  INSERT INTO marcaciones (trabajador_id, cliente_rfc, fecha, tipo, hora_dispositivo,
                           fuente, geo_lat, geo_lng)
  VALUES (p_trabajador_id, t.cliente_rfc, p_fecha, p_tipo, p_hora_dispositivo,
          'checador', p_geo_lat, p_geo_lng)
  RETURNING id, ts_servidor INTO v_id, v_ts;

  -- Resumen diario en asistencias (misma semántica que el checador anterior:
  -- hora declarada por el dispositivo; entrada_ts/salida_ts las sella
  -- trg_sellar_marcaciones).
  v_hora := date_trunc('second', coalesce(p_hora_dispositivo, now() AT TIME ZONE 'America/Mexico_City'))::time;

  IF p_tipo = 'entrada' THEN
    INSERT INTO asistencias (trabajador_id, cliente_rfc, fecha, status, hora_entrada,
                             fuente, notas, geo_lat, geo_lng)
    VALUES (p_trabajador_id, t.cliente_rfc, p_fecha,
            CASE WHEN p_status = 'retraso' THEN 'retraso' ELSE 'presente' END,
            v_hora, 'checador', 'Registrado vía checador digital', p_geo_lat, p_geo_lng)
    ON CONFLICT (trabajador_id, fecha) DO UPDATE
      SET status       = EXCLUDED.status,
          hora_entrada = EXCLUDED.hora_entrada,
          geo_lat      = EXCLUDED.geo_lat,
          geo_lng      = EXCLUDED.geo_lng;
  ELSIF p_tipo = 'salida' THEN
    UPDATE asistencias SET hora_salida = v_hora
     WHERE trabajador_id = p_trabajador_id AND fecha = p_fecha;
  END IF;
  -- Las pausas solo viven en marcaciones.

  RETURN jsonb_build_object('id', v_id, 'tipo', p_tipo, 'fecha', p_fecha, 'ts_servidor', v_ts);
END;
$$;

REVOKE ALL ON FUNCTION registrar_marcacion(UUID,TEXT,DATE,TIMESTAMP,TEXT,NUMERIC,NUMERIC,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_marcacion(UUID,TEXT,DATE,TIMESTAMP,TEXT,NUMERIC,NUMERIC,TEXT) TO authenticated;

-- ── 7. corregir_marcacion: contra-asiento con motivo (RH) ──────────────────
--   • p_anula_id NOT NULL → inserta 'anulacion' de esa marcación.
--   • p_anula_id NULL     → inserta una marcación faltante (p_tipo) con la
--                           hora que RH declara (p_hora_declarada).
-- No toca el resumen de asistencias: ese se ajusta desde el calendario,
-- que queda en asistencias_bitacora.
CREATE OR REPLACE FUNCTION corregir_marcacion(
  p_motivo          TEXT,
  p_anula_id        BIGINT    DEFAULT NULL,
  p_trabajador_id   UUID      DEFAULT NULL,
  p_fecha           DATE      DEFAULT NULL,
  p_tipo            TEXT      DEFAULT NULL,
  p_hora_declarada  TIMESTAMP DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o    RECORD;
  t    RECORD;
  v_id BIGINT;
  v_ts TIMESTAMPTZ;
BEGIN
  IF length(trim(coalesce(p_motivo,''))) < 5 THEN
    RAISE EXCEPTION 'El motivo de la corrección es obligatorio (mínimo 5 caracteres)';
  END IF;

  IF p_anula_id IS NOT NULL THEN
    SELECT * INTO o FROM marcaciones WHERE id = p_anula_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Marcación % no existe', p_anula_id; END IF;
    IF fn_puede_operar_cliente(o.cliente_rfc) IS NOT TRUE THEN
      RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF o.tipo = 'anulacion' THEN RAISE EXCEPTION 'No se puede anular una anulación'; END IF;
    IF EXISTS (SELECT 1 FROM marcaciones WHERE anula_id = p_anula_id) THEN
      RAISE EXCEPTION 'La marcación % ya fue anulada', p_anula_id;
    END IF;
    INSERT INTO marcaciones (trabajador_id, cliente_rfc, fecha, tipo, fuente, anula_id, motivo)
    VALUES (o.trabajador_id, o.cliente_rfc, o.fecha, 'anulacion', 'correccion', o.id, trim(p_motivo))
    RETURNING id, ts_servidor INTO v_id, v_ts;
  ELSE
    IF p_tipo NOT IN ('entrada','inicio_pausa','fin_pausa','salida') OR p_fecha IS NULL OR p_trabajador_id IS NULL THEN
      RAISE EXCEPTION 'Para agregar una marcación faltante se requieren trabajador, fecha y tipo válidos';
    END IF;
    SELECT id, cliente_rfc INTO t FROM trabajadores WHERE id = p_trabajador_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Trabajador no encontrado'; END IF;
    IF fn_puede_operar_cliente(t.cliente_rfc) IS NOT TRUE THEN
      RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO marcaciones (trabajador_id, cliente_rfc, fecha, tipo, hora_dispositivo, fuente, motivo)
    VALUES (p_trabajador_id, t.cliente_rfc, p_fecha, p_tipo, p_hora_declarada, 'correccion', trim(p_motivo))
    RETURNING id, ts_servidor INTO v_id, v_ts;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'ts_servidor', v_ts);
END;
$$;

REVOKE ALL ON FUNCTION corregir_marcacion(TEXT,BIGINT,UUID,DATE,TEXT,TIMESTAMP) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION corregir_marcacion(TEXT,BIGINT,UUID,DATE,TEXT,TIMESTAMP) TO authenticated;

-- Helpers internos: no exponer por la API
REVOKE ALL ON FUNCTION fn_puede_operar_cliente(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_ultima_marcacion(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- 1) Triggers de la tabla (deben salir 3):
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'marcaciones'::regclass AND NOT tgisinternal;
--   → trg_marcaciones_inmutables, trg_marcaciones_no_truncate, trg_marcaciones_sellar
-- 2) Inmutabilidad — prueba SEGURA (si algo fallara, todo se revierte):
--   DO $$ BEGIN
--     TRUNCATE marcaciones;
--     RAISE EXCEPTION 'FALLO: TRUNCATE no fue bloqueado (revertido)';
--   EXCEPTION WHEN insufficient_privilege THEN
--     RAISE NOTICE 'OK: marcaciones es inmutable';
--   END $$;
--   → debe mostrar "OK: marcaciones es inmutable".
-- 3) Tras checar en el kiosco (entrada, pausa, fin de pausa, salida):
--   SELECT fecha, tipo, hora_dispositivo, ts_servidor, fuente
--     FROM marcaciones ORDER BY id DESC LIMIT 10;
-- ═══════════════════════════════════════════════════════════════════════════
