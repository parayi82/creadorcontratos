-- ════════════════════════════════════════════════════════════════
-- RLS para firmas_electronicas
-- Ejecutar en Supabase → SQL Editor (una sola vez)
--
-- La tabla fue creada sin RLS (la escritura viene siempre del backend
-- con service_role). Sin embargo, sin una política de SELECT la anon
-- key podía leer los registros de todos los clientes — dato sensible
-- bajo LFPDPPP (datos biométricos / NOM-151).
--
-- Esta migración habilita RLS y permite que cada cliente vea
-- únicamente sus propios registros de firma.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE firmas_electronicas ENABLE ROW LEVEL SECURITY;

-- Los clientes ven solo las firmas de su propia empresa (matched por RFC
-- almacenado en la metadata del JWT de Supabase Auth).
CREATE POLICY "cliente_ve_sus_firmas"
  ON firmas_electronicas
  FOR SELECT
  USING (
    cliente_rfc = (auth.jwt() ->> 'rfc')
  );

-- Las escrituras siguen llegando exclusivamente desde el backend
-- (service_role bypasses RLS), así que no necesitan política propia.
-- Si en el futuro hubiera escrituras autenticadas desde el cliente,
-- agregar aquí la política FOR INSERT/UPDATE correspondiente.
