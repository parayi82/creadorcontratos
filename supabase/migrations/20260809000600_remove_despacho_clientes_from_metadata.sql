-- ════════════════════════════════════════════════════════════════
-- FASE 3: Eliminar despacho_clientes de user_metadata
--
-- La relación despacho ↔ cliente ahora vive SOLO en la tabla
-- despacho_clientes. Las funciones Netlify y el frontend ya no
-- leen de user_metadata.despacho_clientes.
--
-- Esta migración limpia el campo de todos los usuarios despacho
-- para que los JWTs ya no carguen ese array (reduce tamaño del token).
-- ════════════════════════════════════════════════════════════════

UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'despacho_clientes'
WHERE raw_user_meta_data->>'tipo' = 'despacho'
  AND raw_user_meta_data ? 'despacho_clientes';

-- Verificar: no debe quedar ningún despacho con el campo
SELECT COUNT(*) AS despachos_con_campo_viejo
FROM auth.users
WHERE raw_user_meta_data->>'tipo' = 'despacho'
  AND raw_user_meta_data ? 'despacho_clientes';
