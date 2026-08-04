-- ════════════════════════════════════════════════════════════════
-- ELIMINAR FKs HACIA clientes(rfc) — Ejecutar UNA VEZ en Supabase
--
-- Los clientes de despacho no tienen registro en la tabla clientes
-- (esa tabla es para suscriptores Stripe). Las FKs bloquean todo
-- intento del despacho de crear trabajadores o guardar documentos.
--
-- Los datos siguen protegidos por RLS y por la validación en las
-- funciones Netlify — la FK no agrega seguridad real en este modelo.
-- ════════════════════════════════════════════════════════════════

-- 1. Trabajadores
ALTER TABLE trabajadores
  DROP CONSTRAINT IF EXISTS trabajadores_cliente_rfc_fkey;

-- 2. Asistencias
ALTER TABLE asistencias
  DROP CONSTRAINT IF EXISTS asistencias_cliente_rfc_fkey;

-- 3. Actas de inasistencia
ALTER TABLE actas_inasistencia
  DROP CONSTRAINT IF EXISTS actas_inasistencia_cliente_rfc_fkey;

-- 4. Documentos del expediente
ALTER TABLE documentos_expediente
  DROP CONSTRAINT IF EXISTS documentos_expediente_cliente_rfc_fkey;

-- 5. Documentos de identidad
ALTER TABLE documentos_identidad
  DROP CONSTRAINT IF EXISTS documentos_identidad_cliente_rfc_fkey;

-- 6. Tipos de documento personalizado
ALTER TABLE tipos_documento_personalizado
  DROP CONSTRAINT IF EXISTS tipos_documento_personalizado_cliente_rfc_fkey;

-- Verificar que quedaron sin FK (deben aparecer sin "REFERENCES clientes"):
SELECT tc.table_name, tc.constraint_name, tc.constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'cliente_rfc'
ORDER BY tc.table_name;
-- Si la consulta devuelve filas vacías → todas las FKs fueron eliminadas ✅
