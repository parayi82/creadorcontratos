-- ════════════════════════════════════════════════════════════════
-- FIX: RLS de firmas_electronicas — JWT path incorrecto
--
-- La policy original usaba  auth.jwt() ->> 'rfc'  que extrae del
-- nivel raíz del JWT y siempre devuelve NULL en Supabase (el RFC
-- está anidado en user_metadata). El resultado era que ningún
-- cliente autenticado podía leer sus propias firmas.
--
-- Ejecutar en Supabase → SQL Editor para corregir producción.
-- Los preview branches (Supabase Branching) ya reciben la versión
-- corregida directamente desde la migración 20260807000000.
-- ════════════════════════════════════════════════════════════════

-- Reemplazar la policy rota
DROP POLICY IF EXISTS "cliente_ve_sus_firmas" ON firmas_electronicas;
CREATE POLICY "cliente_ve_sus_firmas"
  ON firmas_electronicas
  FOR SELECT
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
  );

-- Agregar acceso de administrador (faltaba)
DROP POLICY IF EXISTS "admin_ve_todas_las_firmas" ON firmas_electronicas;
CREATE POLICY "admin_ve_todas_las_firmas"
  ON firmas_electronicas
  FOR SELECT
  USING (
    (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- Verificar que las dos policies quedaron activas:
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'firmas_electronicas';
