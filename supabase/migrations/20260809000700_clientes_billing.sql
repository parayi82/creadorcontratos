-- ════════════════════════════════════════════════════════════════
-- Tabla clientes_billing: lookup O(1) para RFC ↔ Stripe
--
-- Problema: cancelar-suscripcion, historial-pagos, portal-facturacion
-- y stripe-webhook hacían listUsers(1000) para encontrar a un usuario
-- por su RFC o stripe_customer_id. No escala con >1000 clientes.
--
-- Solución: tabla con índices para hacer la búsqueda en O(1), y
-- luego getUserById(auth_user_id) para obtener la metadata completa.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clientes_billing (
  rfc                TEXT        PRIMARY KEY,
  auth_user_id        UUID        NOT NULL UNIQUE,
  stripe_customer_id  TEXT        UNIQUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cb_stripe ON clientes_billing(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- RLS: solo service_role accede (nunca se expone al cliente directamente)
ALTER TABLE clientes_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solo_service_role" ON clientes_billing;
CREATE POLICY "solo_service_role" ON clientes_billing
  USING ((auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin');

-- Backfill desde auth.users (idempotente)
DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN
    SELECT id,
           upper(trim(raw_user_meta_data->>'rfc'))              AS rfc,
           raw_user_meta_data->>'stripe_customer_id'            AS cust_id
    FROM auth.users
    WHERE raw_user_meta_data->>'rfc' IS NOT NULL
      AND raw_user_meta_data->>'tipo' IS DISTINCT FROM 'despacho'
  LOOP
    CONTINUE WHEN u.rfc = '' OR u.rfc IS NULL;
    INSERT INTO clientes_billing (rfc, auth_user_id, stripe_customer_id)
    VALUES (u.rfc, u.id, NULLIF(u.cust_id, ''))
    ON CONFLICT (rfc) DO UPDATE SET
      auth_user_id       = EXCLUDED.auth_user_id,
      stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, clientes_billing.stripe_customer_id),
      updated_at         = now();
  END LOOP;
END;
$$;

SELECT COUNT(*) AS clientes_migrados FROM clientes_billing;
