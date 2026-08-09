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

-- La tabla fue creada sin columna de RFC — la agregamos primero.
-- Si ya existe (segunda ejecución), el IF NOT EXISTS la omite sin error.
ALTER TABLE firmas_electronicas
  ADD COLUMN IF NOT EXISTS cliente_rfc TEXT;

ALTER TABLE firmas_electronicas ENABLE ROW LEVEL SECURITY;

-- Eliminar política previa si existía (idempotente)
DROP POLICY IF EXISTS "cliente_ve_sus_firmas" ON firmas_electronicas;

-- Los clientes ven solo las firmas de su propia empresa.
-- El RFC vive en user_metadata del JWT (no en el nivel raíz).
CREATE POLICY "cliente_ve_sus_firmas"
  ON firmas_electronicas
  FOR SELECT
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
  );

-- El administrador puede ver todos los registros.
DROP POLICY IF EXISTS "admin_ve_todas_las_firmas" ON firmas_electronicas;
CREATE POLICY "admin_ve_todas_las_firmas"
  ON firmas_electronicas
  FOR SELECT
  USING (
    (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- Las escrituras siguen llegando exclusivamente desde el backend
-- (service_role bypasses RLS), así que no necesitan política propia.
-- Si en el futuro hubiera escrituras autenticadas desde el cliente,
-- agregar aquí la política FOR INSERT/UPDATE correspondiente.
