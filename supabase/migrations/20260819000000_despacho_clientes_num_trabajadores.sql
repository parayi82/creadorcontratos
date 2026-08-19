-- Agrega número estimado de trabajadores por cliente en la cartera del despacho.
-- Permite al despacho indicar la planta laboral esperada al registrar un cliente.

ALTER TABLE despacho_clientes
  ADD COLUMN IF NOT EXISTS num_trabajadores INTEGER;
