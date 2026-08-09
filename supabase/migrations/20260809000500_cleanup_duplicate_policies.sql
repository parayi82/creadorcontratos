-- ════════════════════════════════════════════════════════════════
-- Limpieza: eliminar políticas RLS duplicadas/antiguas
--
-- Después de aplicar 20260809000400_rls_despacho_access.sql
-- algunas tablas quedaron con políticas antiguas coexistiendo
-- con las nuevas tri-nivel. PostgreSQL evalúa múltiples políticas
-- con OR, por lo que no es un problema de seguridad, pero es
-- confuso y puede causar comportamiento inesperado al depurar.
-- ════════════════════════════════════════════════════════════════

-- ── documentos_expediente ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Cliente ve sus documentos"                           ON documentos_expediente;

-- ── documentos_identidad ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cliente_documentos_identidad"                       ON documentos_identidad;

-- ── solicitudes ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_ve_todo_solicitudes"                          ON solicitudes;
DROP POLICY IF EXISTS "cliente_solicitudes_insert"                         ON solicitudes;
DROP POLICY IF EXISTS "cliente_solicitudes_select"                         ON solicitudes;

-- ── tipos_documento_personalizado ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Clientes ven y editan solo sus tipos personalizados" ON tipos_documento_personalizado;
DROP POLICY IF EXISTS "cliente_tipos_personalizados"                        ON tipos_documento_personalizado;

-- Verificar resultado final limpio
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
