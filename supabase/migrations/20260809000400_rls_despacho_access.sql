-- ════════════════════════════════════════════════════════════════
-- FASE 2 Multi-tenant: RLS con acceso de despacho en todas las tablas
--
-- Patrón tri-nivel para cada tabla con cliente_rfc:
--   1. cliente directo  → RFC del JWT coincide con cliente_rfc
--   2. despacho         → es_cliente_de_despacho(cliente_rfc) = true
--   3. admin            → role = 'admin' en user_metadata
--
-- Requiere que 20260809000300_multitenant_despachos.sql ya esté
-- aplicado (crea la función es_cliente_de_despacho).
-- ════════════════════════════════════════════════════════════════

-- ── Helper: expresión de acceso reutilizable ──────────────────────────────────
-- La función se referencia directamente en cada policy; no hay macro en SQL,
-- así que se repite el patrón (es lo que hace el planner de Postgres de todas
-- formas después de inline expansion).

-- ── trabajadores ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Clientes ven y editan solo sus trabajadores" ON trabajadores;
CREATE POLICY "acceso_trabajadores" ON trabajadores FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── asistencias ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Clientes ven y editan solo sus asistencias" ON asistencias;
CREATE POLICY "acceso_asistencias" ON asistencias FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── actas_inasistencia ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Clientes ven y editan solo sus actas de inasistencia" ON actas_inasistencia;
CREATE POLICY "acceso_actas_inasistencia" ON actas_inasistencia FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── solicitudes ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Clientes ven y crean solo sus solicitudes" ON solicitudes;
CREATE POLICY "acceso_solicitudes" ON solicitudes FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── firmas_electronicas ───────────────────────────────────────────────────────
-- (admin policy ya existe; agregar despacho sin tocar cliente ni admin)
DROP POLICY IF EXISTS "cliente_ve_sus_firmas" ON firmas_electronicas;
DROP POLICY IF EXISTS "admin_ve_todas_las_firmas" ON firmas_electronicas;
CREATE POLICY "acceso_firmas_electronicas" ON firmas_electronicas FOR SELECT
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── documentos_expediente ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Clientes ven y editan solo sus documentos de expediente" ON documentos_expediente;
CREATE POLICY "acceso_documentos_expediente" ON documentos_expediente FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── documentos_identidad ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Clientes ven y editan solo sus documentos de identidad" ON documentos_identidad;
CREATE POLICY "acceso_documentos_identidad" ON documentos_identidad FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── tipos_documento_personalizado ─────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_sus_tipos" ON tipos_documento_personalizado;
DROP POLICY IF EXISTS "Clientes ven y editan solo sus tipos de documento" ON tipos_documento_personalizado;
CREATE POLICY "acceso_tipos_documento" ON tipos_documento_personalizado FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── vacaciones_programadas ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_sus_vacaciones" ON vacaciones_programadas;
DROP POLICY IF EXISTS "Clientes ven y editan sus vacaciones" ON vacaciones_programadas;
CREATE POLICY "acceso_vacaciones_programadas" ON vacaciones_programadas FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── movimientos_trabajador ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_sus_movimientos" ON movimientos_trabajador;
DROP POLICY IF EXISTS "Clientes ven y editan sus movimientos" ON movimientos_trabajador;
CREATE POLICY "acceso_movimientos_trabajador" ON movimientos_trabajador FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── alertas_laborales ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_sus_alertas" ON alertas_laborales;
DROP POLICY IF EXISTS "Clientes ven sus alertas" ON alertas_laborales;
CREATE POLICY "acceso_alertas_laborales" ON alertas_laborales FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── evaluaciones_psicometricas ────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_sus_evaluaciones" ON evaluaciones_psicometricas;
DROP POLICY IF EXISTS "Clientes ven sus evaluaciones" ON evaluaciones_psicometricas;
CREATE POLICY "acceso_evaluaciones_psicometricas" ON evaluaciones_psicometricas FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── comisiones_mixtas ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_ve_sus_comisiones_mixtas" ON comisiones_mixtas;
DROP POLICY IF EXISTS "Clientes ven sus comisiones mixtas" ON comisiones_mixtas;
CREATE POLICY "acceso_comisiones_mixtas" ON comisiones_mixtas FOR ALL
  USING (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
    OR es_cliente_de_despacho(cliente_rfc)
    OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );

-- ── storage.objects (expedientes) ─────────────────────────────────────────────
-- Los archivos se guardan como  {cliente_rfc}/...  en el bucket "expedientes".
-- El despacho puede leer/escribir archivos de sus clientes.
DROP POLICY IF EXISTS "Clientes suben archivos a su propia carpeta" ON storage.objects;
CREATE POLICY "acceso_storage_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'expedientes'
    AND (
      (storage.foldername(name))[1] = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
      OR es_cliente_de_despacho((storage.foldername(name))[1])
      OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
    )
  );

DROP POLICY IF EXISTS "Clientes ven archivos de su propia carpeta" ON storage.objects;
CREATE POLICY "acceso_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'expedientes'
    AND (
      (storage.foldername(name))[1] = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
      OR es_cliente_de_despacho((storage.foldername(name))[1])
      OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
    )
  );

DROP POLICY IF EXISTS "Clientes borran archivos de su propia carpeta" ON storage.objects;
CREATE POLICY "acceso_storage_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'expedientes'
    AND (
      (storage.foldername(name))[1] = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc')
      OR es_cliente_de_despacho((storage.foldername(name))[1])
      OR (auth.jwt()::jsonb -> 'user_metadata' ->> 'role') = 'admin'
    )
  );

-- Verificar resultado
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'trabajadores','asistencias','actas_inasistencia','solicitudes',
  'firmas_electronicas','documentos_expediente','documentos_identidad',
  'tipos_documento_personalizado','vacaciones_programadas',
  'movimientos_trabajador','alertas_laborales','evaluaciones_psicometricas',
  'comisiones_mixtas','despachos','despacho_clientes'
)
ORDER BY tablename, policyname;
