-- ════════════════════════════════════════════════════════════════
-- Eliminar FK faltante en movimientos_trabajador → clientes(rfc)
--
-- La migración 001200 eliminó esta FK de 6 tablas pero omitió
-- movimientos_trabajador (creada en 001000). Los clientes de
-- despacho no tienen registro en la tabla clientes, por lo que
-- la FK bloquea la creación de movimientos para esos clientes.
-- Los datos siguen protegidos por RLS igual que las otras tablas.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE movimientos_trabajador
  DROP CONSTRAINT IF EXISTS movimientos_trabajador_cliente_rfc_fkey;

-- Verificar: no debe quedar ninguna FK de cliente_rfc hacia clientes
SELECT tc.table_name, tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.table_constraints tc2
  ON rc.unique_constraint_name = tc2.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'cliente_rfc'
  AND tc2.table_name = 'clientes'
ORDER BY tc.table_name;
-- Debe devolver 0 filas ✅
