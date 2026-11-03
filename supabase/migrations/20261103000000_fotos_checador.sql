-- ═══════════════════════════════════════════════════════════════════════════
-- FOTO EN CADA CHECADA (opcional por empresa) + CONSENTIMIENTO DEL TRABAJADOR
-- Registro electrónico de jornada — Art. 132 fr. XXXIV LFT · LFPDPPP
--
-- • checador_config: modo de foto por empresa: 'apagada' (default),
--   'opcional' (se pide; si no hay cámara/permiso/consentimiento la checada
--   se registra igual, marcada) u 'obligatoria'.
-- • consentimientos_trabajador: aceptación/negativa expresa del trabajador,
--   con el texto exacto que vio. Solo-agregar (inmutable): revocar = renglón
--   nuevo con acepta=false.
-- • Bucket privado 'checadas': el kiosco SUBE y LEE; nadie puede sobrescribir
--   ni borrar vía API (sin políticas UPDATE/DELETE).
-- • marcaciones + foto_path / foto_sha256 / foto_estado. El SHA-256 permite
--   demostrar después que el archivo no se cambió.
-- • registrar_marcacion() valida modo, consentimiento y que la foto exista en
--   la carpeta del trabajador.
--
-- NO hay reconocimiento facial automático: la foto es evidencia para revisión
-- humana. Requiere: 20261102000000_marcaciones_inmutables.sql.
-- Ejecutar completo en Supabase SQL Editor. Idempotente (re-ejecutable).
-- ═══════════════════════════════════════════════════════════════════════════

-- La usan las políticas de Storage (se evalúan con el rol del usuario).
-- Solo responde si la sesión actual puede operar sobre un RFC: no expone datos.
GRANT EXECUTE ON FUNCTION fn_puede_operar_cliente(TEXT) TO authenticated;

-- Inmutabilidad genérica para registros solo-agregar
CREATE OR REPLACE FUNCTION fn_registro_inmutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es un registro inmutable: % no permitido. Agregue un renglón nuevo.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ── 1. Configuración por empresa ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checador_config (
  cliente_rfc         TEXT PRIMARY KEY,
  foto_modo           TEXT NOT NULL DEFAULT 'apagada'
                        CHECK (foto_modo IN ('apagada','opcional','obligatoria')),
  actualizado_ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por_uid UUID
);

CREATE OR REPLACE FUNCTION fn_checador_config_sellar()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.actualizado_ts      := now();
  NEW.actualizado_por_uid := auth.uid();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_checador_config_sellar ON checador_config;
CREATE TRIGGER trg_checador_config_sellar
  BEFORE INSERT OR UPDATE ON checador_config
  FOR EACH ROW EXECUTE FUNCTION fn_checador_config_sellar();

ALTER TABLE checador_config ENABLE ROW LEVEL SECURITY;
REVOKE DELETE, TRUNCATE ON checador_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON checador_config TO authenticated;

DROP POLICY IF EXISTS "checador_config_select" ON checador_config;
CREATE POLICY "checador_config_select" ON checador_config FOR SELECT
  USING (fn_puede_operar_cliente(cliente_rfc));
DROP POLICY IF EXISTS "checador_config_insert" ON checador_config;
CREATE POLICY "checador_config_insert" ON checador_config FOR INSERT
  WITH CHECK (fn_puede_operar_cliente(cliente_rfc));
DROP POLICY IF EXISTS "checador_config_update" ON checador_config;
CREATE POLICY "checador_config_update" ON checador_config FOR UPDATE
  USING (fn_puede_operar_cliente(cliente_rfc))
  WITH CHECK (fn_puede_operar_cliente(cliente_rfc));

-- ── 2. Consentimientos (solo-agregar) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS consentimientos_trabajador (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trabajador_id      UUID        NOT NULL,      -- sin FK a propósito (evidencia)
  cliente_rfc        TEXT        NOT NULL,
  finalidad          TEXT        NOT NULL CHECK (finalidad IN ('foto_checador')),
  acepta             BOOLEAN     NOT NULL,
  version            TEXT        NOT NULL,
  texto              TEXT        NOT NULL,      -- texto exacto mostrado al trabajador
  metodo             TEXT        NOT NULL DEFAULT 'kiosco',
  con_nip            BOOLEAN     NOT NULL DEFAULT false,  -- ¿se confirmó con el NIP del trabajador?
  ts_servidor        TIMESTAMPTZ NOT NULL DEFAULT now(),
  registrado_por_uid UUID,
  registrado_por_rfc TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_trab ON consentimientos_trabajador(trabajador_id, finalidad, id);
CREATE INDEX IF NOT EXISTS idx_consent_cliente ON consentimientos_trabajador(cliente_rfc);

CREATE OR REPLACE FUNCTION fn_consentimiento_sellar()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.ts_servidor        := now();
  NEW.registrado_por_uid := auth.uid();
  NEW.registrado_por_rfc := (auth.jwt()::jsonb)->'user_metadata'->>'rfc';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_consentimiento_sellar ON consentimientos_trabajador;
CREATE TRIGGER trg_consentimiento_sellar
  BEFORE INSERT ON consentimientos_trabajador
  FOR EACH ROW EXECUTE FUNCTION fn_consentimiento_sellar();
DROP TRIGGER IF EXISTS trg_consentimiento_inmutable ON consentimientos_trabajador;
CREATE TRIGGER trg_consentimiento_inmutable
  BEFORE UPDATE OR DELETE ON consentimientos_trabajador
  FOR EACH ROW EXECUTE FUNCTION fn_registro_inmutable();
DROP TRIGGER IF EXISTS trg_consentimiento_no_truncate ON consentimientos_trabajador;
CREATE TRIGGER trg_consentimiento_no_truncate
  BEFORE TRUNCATE ON consentimientos_trabajador
  FOR EACH STATEMENT EXECUTE FUNCTION fn_registro_inmutable();

ALTER TABLE consentimientos_trabajador ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON consentimientos_trabajador FROM anon, authenticated;
GRANT SELECT ON consentimientos_trabajador TO authenticated;
DROP POLICY IF EXISTS "consentimientos_select" ON consentimientos_trabajador;
CREATE POLICY "consentimientos_select" ON consentimientos_trabajador FOR SELECT
  USING (fn_puede_operar_cliente(cliente_rfc));

-- ¿Consentimiento vigente? = el último renglón de esa finalidad dice acepta
CREATE OR REPLACE FUNCTION fn_consentimiento_vigente(p_trabajador_id UUID, p_finalidad TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT acepta FROM consentimientos_trabajador
     WHERE trabajador_id = p_trabajador_id AND finalidad = p_finalidad
     ORDER BY id DESC LIMIT 1
  ), false);
$$;
REVOKE ALL ON FUNCTION fn_consentimiento_vigente(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION registrar_consentimiento(
  p_trabajador_id UUID,
  p_finalidad     TEXT,
  p_acepta        BOOLEAN,
  p_version       TEXT,
  p_texto         TEXT,
  p_nip           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t       RECORD;
  v_nip   BOOLEAN := false;
  v_id    BIGINT;
  v_ts    TIMESTAMPTZ;
BEGIN
  IF p_acepta IS NULL OR p_finalidad IS NULL
     OR length(trim(coalesce(p_version,''))) = 0 OR length(trim(coalesce(p_texto,''))) < 50 THEN
    RAISE EXCEPTION 'Consentimiento incompleto';
  END IF;
  SELECT id, cliente_rfc, nip, activo INTO t FROM trabajadores WHERE id = p_trabajador_id;
  IF NOT FOUND OR NOT coalesce(t.activo, false) THEN
    RAISE EXCEPTION 'Trabajador no encontrado o inactivo';
  END IF;
  IF fn_puede_operar_cliente(t.cliente_rfc) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF nullif(trim(coalesce(t.nip,'')),'') IS NOT NULL THEN
    IF trim(coalesce(p_nip,'')) <> trim(t.nip) THEN
      RAISE EXCEPTION 'NIP incorrecto';
    END IF;
    v_nip := true;
  END IF;

  INSERT INTO consentimientos_trabajador
    (trabajador_id, cliente_rfc, finalidad, acepta, version, texto, metodo, con_nip)
  VALUES
    (p_trabajador_id, t.cliente_rfc, p_finalidad, p_acepta, trim(p_version), p_texto, 'kiosco', v_nip)
  RETURNING id, ts_servidor INTO v_id, v_ts;

  RETURN jsonb_build_object('id', v_id, 'acepta', p_acepta, 'ts_servidor', v_ts);
END;
$$;
REVOKE ALL ON FUNCTION registrar_consentimiento(UUID,TEXT,BOOLEAN,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_consentimiento(UUID,TEXT,BOOLEAN,TEXT,TEXT,TEXT) TO authenticated;

-- ── 3. Columnas de foto en marcaciones ────────────────────────────────────
-- (ALTER TABLE no es UPDATE: los triggers de inmutabilidad no se disparan.)
ALTER TABLE marcaciones
  ADD COLUMN IF NOT EXISTS foto_path   TEXT NULL,
  ADD COLUMN IF NOT EXISTS foto_sha256 TEXT NULL,
  ADD COLUMN IF NOT EXISTS foto_estado TEXT NULL;

ALTER TABLE marcaciones DROP CONSTRAINT IF EXISTS marcaciones_foto_estado_chk;
ALTER TABLE marcaciones ADD CONSTRAINT marcaciones_foto_estado_chk CHECK (
  foto_estado IS NULL OR foto_estado IN
    ('tomada','sin_camara','permiso_denegado','sin_consentimiento','error')
);
ALTER TABLE marcaciones DROP CONSTRAINT IF EXISTS marcaciones_foto_coherente_chk;
-- 'tomada' ⇔ hay archivo y hash (coalesce: con NULL un CHECK pasaría siempre)
ALTER TABLE marcaciones ADD CONSTRAINT marcaciones_foto_coherente_chk CHECK (
  (coalesce(foto_estado, '') = 'tomada') = (foto_path IS NOT NULL AND foto_sha256 IS NOT NULL)
);
-- Una foto no se puede reutilizar para otra checada
CREATE UNIQUE INDEX IF NOT EXISTS ux_marcaciones_foto_path
  ON marcaciones(foto_path) WHERE foto_path IS NOT NULL;

COMMENT ON COLUMN marcaciones.foto_sha256 IS
  'SHA-256 (hex) del JPEG subido a storage checadas/<foto_path>, calculado por el kiosco. Si el archivo se alterara, su hash ya no coincidiría.';

-- ── 4. Bucket privado de fotos ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('checadas', 'checadas', false, 1048576, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 1048576, allowed_mime_types = ARRAY['image/jpeg'];

-- Ruta: <cliente_rfc>/<trabajador_id>/<fecha>/<uuid>.jpg
DROP POLICY IF EXISTS "checadas_insert" ON storage.objects;
CREATE POLICY "checadas_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'checadas'
    AND fn_puede_operar_cliente((storage.foldername(name))[1])
  );
DROP POLICY IF EXISTS "checadas_select" ON storage.objects;
CREATE POLICY "checadas_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'checadas'
    AND fn_puede_operar_cliente((storage.foldername(name))[1])
  );
-- Sin políticas UPDATE/DELETE para 'checadas' a propósito: no se pueden
-- sobrescribir ni borrar fotos desde la app.

-- ── 5. registrar_marcacion con foto ───────────────────────────────────────
-- Se reemplaza la firma anterior (8 parámetros) por una con 3 parámetros de
-- foto opcionales; las llamadas anteriores siguen funcionando igual.
DROP FUNCTION IF EXISTS registrar_marcacion(UUID,TEXT,DATE,TIMESTAMP,TEXT,NUMERIC,NUMERIC,TEXT);

CREATE OR REPLACE FUNCTION registrar_marcacion(
  p_trabajador_id    UUID,
  p_tipo             TEXT,
  p_fecha            DATE,
  p_hora_dispositivo TIMESTAMP DEFAULT NULL,
  p_nip              TEXT      DEFAULT NULL,
  p_geo_lat          NUMERIC   DEFAULT NULL,
  p_geo_lng          NUMERIC   DEFAULT NULL,
  p_status           TEXT      DEFAULT 'presente',
  p_foto_path        TEXT      DEFAULT NULL,
  p_foto_sha256      TEXT      DEFAULT NULL,
  p_foto_estado      TEXT      DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t         RECORD;
  v_hoy     DATE := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_ultimo  TEXT;
  v_hora    TIME;
  v_id      BIGINT;
  v_ts      TIMESTAMPTZ;
  a         RECORD;
  v_modo    TEXT;
  v_fpath   TEXT;
  v_fsha    TEXT;
  v_festado TEXT;
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

  -- ── Foto ──
  v_modo := coalesce((SELECT foto_modo FROM checador_config WHERE cliente_rfc = t.cliente_rfc), 'apagada');
  IF p_foto_path IS NOT NULL THEN
    IF v_modo = 'apagada' THEN
      RAISE EXCEPTION 'La foto al checar no está activada para esta empresa';
    END IF;
    IF NOT fn_consentimiento_vigente(p_trabajador_id, 'foto_checador') THEN
      RAISE EXCEPTION 'El trabajador no ha autorizado la foto al checar';
    END IF;
    IF NOT starts_with(p_foto_path, t.cliente_rfc || '/' || p_trabajador_id::text || '/')
       OR p_foto_path !~ '\.jpg$' OR position('..' IN p_foto_path) > 0 THEN
      RAISE EXCEPTION 'Ruta de foto no válida';
    END IF;
    IF coalesce(p_foto_sha256,'') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Huella SHA-256 de la foto no válida';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o
                    WHERE o.bucket_id = 'checadas' AND o.name = p_foto_path) THEN
      RAISE EXCEPTION 'La foto no se encontró en el almacenamiento';
    END IF;
    v_fpath := p_foto_path; v_fsha := p_foto_sha256; v_festado := 'tomada';
  ELSE
    IF v_modo = 'obligatoria' THEN
      RAISE EXCEPTION 'Esta empresa requiere foto para checar';
    END IF;
    IF v_modo = 'opcional' THEN
      v_festado := CASE WHEN p_foto_estado IN ('sin_camara','permiso_denegado','sin_consentimiento','error')
                        THEN p_foto_estado ELSE 'error' END;
    END IF;  -- apagada → NULL
  END IF;

  -- Serializar checadas del mismo trabajador (doble toque)
  PERFORM pg_advisory_xact_lock(hashtext('marcacion:' || p_trabajador_id::text));

  v_ultimo := fn_ultima_marcacion(p_trabajador_id, p_fecha);
  IF v_ultimo IS NULL THEN
    -- Jornadas abiertas antes de existir la tabla marcaciones: inferir del resumen
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
                           fuente, geo_lat, geo_lng, foto_path, foto_sha256, foto_estado)
  VALUES (p_trabajador_id, t.cliente_rfc, p_fecha, p_tipo, p_hora_dispositivo,
          'checador', p_geo_lat, p_geo_lng, v_fpath, v_fsha, v_festado)
  RETURNING id, ts_servidor INTO v_id, v_ts;

  -- Resumen diario en asistencias (hora declarada por el dispositivo;
  -- entrada_ts/salida_ts las sella trg_sellar_marcaciones).
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

  RETURN jsonb_build_object('id', v_id, 'tipo', p_tipo, 'fecha', p_fecha,
                            'ts_servidor', v_ts, 'foto_estado', v_festado);
END;
$$;

REVOKE ALL ON FUNCTION registrar_marcacion(UUID,TEXT,DATE,TIMESTAMP,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_marcacion(UUID,TEXT,DATE,TIMESTAMP,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- 1) Bucket privado:
--   SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'checadas';
--   → public = false
-- 2) Solo existe la versión nueva de la función (11 parámetros):
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'registrar_marcacion';
-- 3) Activar foto opcional para una empresa (o desde el panel de asistencias):
--   INSERT INTO checador_config (cliente_rfc, foto_modo) VALUES ('<RFC>', 'opcional')
--   ON CONFLICT (cliente_rfc) DO UPDATE SET foto_modo = EXCLUDED.foto_modo;
-- 4) Tras checar con foto en el kiosco:
--   SELECT id, tipo, foto_estado, foto_path, foto_sha256 FROM marcaciones ORDER BY id DESC LIMIT 5;
--   SELECT trabajador_id, acepta, version, con_nip, ts_servidor FROM consentimientos_trabajador ORDER BY id DESC LIMIT 5;
-- ═══════════════════════════════════════════════════════════════════════════
