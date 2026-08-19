-- Permite configurar el límite de empresas-cliente por despacho de forma manual.
-- NULL = el backend usa el campo `rango` como fallback (comportamiento anterior).
-- El administrador puede actualizar este valor por despacho según lo acordado con el cliente.

ALTER TABLE despachos
  ADD COLUMN IF NOT EXISTS max_clientes INTEGER;
