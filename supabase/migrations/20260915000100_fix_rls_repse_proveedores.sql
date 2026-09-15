-- ════════════════════════════════════════════════════════════════
-- FIX: RLS de repse_proveedores y repse_docs_mensuales — JWT path incorrecto
--
-- Mismo bug que ya se encontró y corrigió una vez para firmas_electronicas
-- (ver 20260809000100_fix_rls_firmas_electronicas.sql): las políticas de
-- sql-repse-proveedores.sql usan auth.jwt() ->> 'rfc', que extrae del nivel
-- raíz del JWT y siempre devuelve NULL en Supabase — el RFC está anidado
-- en user_metadata. El resultado es que cliente_rfc = NULL nunca es
-- verdadero, así que ningún cliente autenticado puede leer (ni actualizar
-- ni borrar) directamente sus propios proveedores REPSE ni su
-- documentación mensual.
--
-- En la práctica esto no rompía el ALTA de un proveedor (gestor-repse.html
-- inserta vía /api/mutar-datos-cliente, que usa service_role y bypasea
-- RLS por completo), pero sí dejaba la lista de proveedores (sidebar de
-- gestor-repse.html, que sí lee directo con sb.from(...) y la anon key)
-- permanentemente vacía para cualquier cliente real, sin importar cuántos
-- proveedores hubiera realmente guardado.
--
-- Ejecutar en Supabase → SQL Editor para corregir producción. Requiere que
-- sql-repse-proveedores.sql ya se haya corrido (si no, esta migración no
-- encontrará las tablas).
-- ════════════════════════════════════════════════════════════════

-- ── repse_proveedores ──────────────────────────────────────────────
DROP POLICY IF EXISTS "repse_prov_select" ON repse_proveedores;
CREATE POLICY "repse_prov_select" ON repse_proveedores
  FOR SELECT USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_prov_insert" ON repse_proveedores;
CREATE POLICY "repse_prov_insert" ON repse_proveedores
  FOR INSERT WITH CHECK (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_prov_update" ON repse_proveedores;
CREATE POLICY "repse_prov_update" ON repse_proveedores
  FOR UPDATE USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_prov_delete" ON repse_proveedores;
CREATE POLICY "repse_prov_delete" ON repse_proveedores
  FOR DELETE USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

-- ── repse_docs_mensuales ───────────────────────────────────────────
DROP POLICY IF EXISTS "repse_docs_select" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_select" ON repse_docs_mensuales
  FOR SELECT USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_docs_insert" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_insert" ON repse_docs_mensuales
  FOR INSERT WITH CHECK (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_docs_update" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_update" ON repse_docs_mensuales
  FOR UPDATE USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_docs_delete" ON repse_docs_mensuales;
CREATE POLICY "repse_docs_delete" ON repse_docs_mensuales
  FOR DELETE USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

-- ── Verificación ──────────────────────────────────────────────────
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('repse_proveedores', 'repse_docs_mensuales')
ORDER BY tablename, policyname;
