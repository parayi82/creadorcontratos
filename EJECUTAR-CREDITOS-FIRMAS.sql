-- ============================================================
-- Créditos de firma electrónica — ClickLaboral
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Saldo de créditos por cliente
CREATE TABLE IF NOT EXISTS firmas_creditos (
  cliente_rfc  text PRIMARY KEY,
  saldo        integer NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  updated_at   timestamptz DEFAULT now()
);

-- Historial de movimientos
CREATE TABLE IF NOT EXISTS firmas_creditos_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_rfc  text NOT NULL,
  tipo         text NOT NULL, -- 'compra_unitaria' | 'compra_paquete6' | 'uso' | 'ajuste_admin'
  cantidad     integer NOT NULL,
  saldo_previo integer NOT NULL,
  saldo_nuevo  integer NOT NULL,
  referencia   text,          -- stripe payment_intent o allsign_id
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS firmas_creditos_log_rfc ON firmas_creditos_log(cliente_rfc, created_at DESC);

-- RPC atómica para descontar un crédito (evita race conditions)
CREATE OR REPLACE FUNCTION descontar_firma_credito(p_rfc text, p_allsign_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_saldo_previo integer;
  v_saldo_nuevo  integer;
BEGIN
  SELECT saldo INTO v_saldo_previo FROM firmas_creditos WHERE cliente_rfc = p_rfc FOR UPDATE;
  IF NOT FOUND OR v_saldo_previo < 1 THEN
    RETURN json_build_object('ok', false, 'saldo', COALESCE(v_saldo_previo, 0));
  END IF;
  v_saldo_nuevo := v_saldo_previo - 1;
  UPDATE firmas_creditos SET saldo = v_saldo_nuevo, updated_at = now() WHERE cliente_rfc = p_rfc;
  INSERT INTO firmas_creditos_log(cliente_rfc, tipo, cantidad, saldo_previo, saldo_nuevo, referencia)
    VALUES(p_rfc, 'uso', -1, v_saldo_previo, v_saldo_nuevo, p_allsign_id);
  RETURN json_build_object('ok', true, 'saldo', v_saldo_nuevo);
END;
$$;

-- RPC para agregar créditos (compra o ajuste admin)
CREATE OR REPLACE FUNCTION agregar_firma_creditos(p_rfc text, p_cantidad integer, p_tipo text, p_ref text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_saldo_previo integer := 0;
  v_saldo_nuevo  integer;
BEGIN
  INSERT INTO firmas_creditos(cliente_rfc, saldo) VALUES(p_rfc, 0)
    ON CONFLICT (cliente_rfc) DO NOTHING;
  SELECT saldo INTO v_saldo_previo FROM firmas_creditos WHERE cliente_rfc = p_rfc FOR UPDATE;
  v_saldo_nuevo := v_saldo_previo + p_cantidad;
  UPDATE firmas_creditos SET saldo = v_saldo_nuevo, updated_at = now() WHERE cliente_rfc = p_rfc;
  INSERT INTO firmas_creditos_log(cliente_rfc, tipo, cantidad, saldo_previo, saldo_nuevo, referencia)
    VALUES(p_rfc, p_tipo, p_cantidad, v_saldo_previo, v_saldo_nuevo, p_ref);
  RETURN json_build_object('ok', true, 'saldo', v_saldo_nuevo);
END;
$$;

-- Permisos (service_role tiene acceso pleno; anon solo puede leer su propio saldo via función)
GRANT EXECUTE ON FUNCTION descontar_firma_credito TO service_role;
GRANT EXECUTE ON FUNCTION agregar_firma_creditos  TO service_role;
