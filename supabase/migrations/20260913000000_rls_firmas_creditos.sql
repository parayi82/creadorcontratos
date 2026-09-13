-- ════════════════════════════════════════════════════════════════
-- RLS para firmas_creditos y firmas_creditos_log
-- Ejecutar en Supabase → SQL Editor (una sola vez)
--
-- Ambas tablas se crearon vía el script suelto EJECUTAR-CREDITOS-FIRMAS.sql
-- (nunca se versionó en supabase/migrations/) sin ENABLE ROW LEVEL SECURITY.
-- Se confirmó contra producción que anon/authenticated tienen otorgados
-- INSERT/SELECT/UPDATE/DELETE a nivel de tabla sobre ambas — sin RLS,
-- cualquiera con la anon key (pública, embebida en el frontend) podía leer
-- el saldo y el historial de créditos de TODOS los clientes, y modificar
-- directamente `saldo` en firmas_creditos saltándose por completo las
-- funciones atómicas descontar_firma_credito/agregar_firma_creditos
-- (podía autoasignarse firmas gratis, o borrar el historial de firmas_creditos_log).
--
-- Mismo patrón que 20260807000000_rls_firmas_electronicas.sql: cada
-- cliente ve solo sus propios movimientos, el admin ve todos. No se
-- agregan políticas de escritura para anon/authenticated a propósito:
-- toda escritura debe seguir llegando exclusivamente vía las funciones
-- SECURITY DEFINER (descontar_firma_credito/agregar_firma_creditos) o
-- desde el backend con service_role (netlify/functions/firmas-creditos.js,
-- firmas-admin-resumen.js), ambos casos bypasean RLS.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE firmas_creditos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmas_creditos_log ENABLE ROW LEVEL SECURITY;

-- ── firmas_creditos ─────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_su_saldo" ON firmas_creditos;
CREATE POLICY "cliente_ve_su_saldo"
  ON firmas_creditos
  FOR SELECT
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
  );

DROP POLICY IF EXISTS "admin_ve_todos_los_saldos" ON firmas_creditos;
CREATE POLICY "admin_ve_todos_los_saldos"
  ON firmas_creditos
  FOR SELECT
  USING (
    (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── firmas_creditos_log ─────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_su_historial" ON firmas_creditos_log;
CREATE POLICY "cliente_ve_su_historial"
  ON firmas_creditos_log
  FOR SELECT
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
  );

DROP POLICY IF EXISTS "admin_ve_todo_el_historial" ON firmas_creditos_log;
CREATE POLICY "admin_ve_todo_el_historial"
  ON firmas_creditos_log
  FOR SELECT
  USING (
    (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── Verificación ──────────────────────────────────────────────────
-- rowsecurity debe salir 't' para ambas, y deben listarse las 4 políticas.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('firmas_creditos', 'firmas_creditos_log');

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('firmas_creditos', 'firmas_creditos_log')
ORDER BY tablename, policyname;
