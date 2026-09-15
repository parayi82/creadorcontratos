-- ════════════════════════════════════════════════════════════════
-- Invitaciones a proveedores REPSE
-- Ejecutar en Supabase → SQL Editor
--
-- Punto #6 del resumen ejecutivo de puntos ciegos: el contratante responde
-- solidariamente por sus contratistas de servicios especializados (Art. 15-A
-- LFT / Ley REPSE), así que necesita que SUS proveedores le compartan su
-- propia información REPSE — no solo llenarla él a mano. Esta tabla soporta
-- el link público que un cliente le manda a cada proveedor para que la
-- llene sin necesitar cuenta.
--
-- Requiere que repse_proveedores ya exista (sql-repse-proveedores.sql) —
-- si no lo has corrido, esta migración fallará en el FOREIGN KEY. Corre
-- primero ese script.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS repse_invitaciones (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_rfc     TEXT NOT NULL,
  token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  nombre_contacto TEXT,
  email_contacto  TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completado')),
  proveedor_id    UUID REFERENCES repse_proveedores(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  completado_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_repse_inv_cliente ON repse_invitaciones(cliente_rfc);
CREATE INDEX IF NOT EXISTS idx_repse_inv_token   ON repse_invitaciones(token);

ALTER TABLE repse_invitaciones ENABLE ROW LEVEL SECURITY;

-- El cliente que invita ve, crea y puede borrar (cancelar) sus propias
-- invitaciones. No hay política de UPDATE para anon/authenticated a
-- propósito: solo el backend con service_role (repse-invitacion.js) marca
-- una invitación como completada, cuando el proveedor invitado —que NUNCA
-- tiene sesión ni JWT propio— manda su información por el link público.
-- El RFC vive anidado en user_metadata, NO en la raíz del JWT — usar
-- auth.jwt()->>'rfc' aquí devolvería siempre NULL y ningún cliente podría
-- ver ni crear sus propias invitaciones (el mismo bug ya encontrado y
-- corregido una vez para firmas_electronicas en
-- 20260809000100_fix_rls_firmas_electronicas.sql).
DROP POLICY IF EXISTS "repse_inv_select" ON repse_invitaciones;
CREATE POLICY "repse_inv_select" ON repse_invitaciones
  FOR SELECT USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_inv_insert" ON repse_invitaciones;
CREATE POLICY "repse_inv_insert" ON repse_invitaciones
  FOR INSERT WITH CHECK (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

DROP POLICY IF EXISTS "repse_inv_delete" ON repse_invitaciones;
CREATE POLICY "repse_inv_delete" ON repse_invitaciones
  FOR DELETE USING (cliente_rfc = (auth.jwt()::jsonb -> 'user_metadata' ->> 'rfc'));

-- ── Verificación ──────────────────────────────────────────────────
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'repse_invitaciones';
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'repse_invitaciones' ORDER BY policyname;
