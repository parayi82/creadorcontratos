-- ═══════════════════════════════════════════════════════════════════════════
-- Elimina la columna duplicada asistencias.hora_servidor
--
-- Dos migraciones agregaron, sin saberlo, la misma protección dos veces:
--   • 20260804001100_registro_electronico_2027.sql → registrado_ts
--     (la que realmente usa el código: netlify/functions/reporte-asistencias.js
--     y asistencias-vacaciones.html la exponen en el expediente exportable
--     Art. 804 LFT / Art. 132 fr. XXXIV LFT)
--   • 20260902000001_asistencias_audit_uid_email.sql → hora_servidor
--     (nunca referenciada por ningún código de la aplicación)
--
-- Ambas son TIMESTAMPTZ DEFAULT now(), fijadas por Postgres en el mismo
-- INSERT — para toda fila creada después del 2 de septiembre de 2026 tienen
-- exactamente el mismo valor. hora_servidor no aporta información que
-- registrado_ts no tenga ya, así que se elimina para no mantener dos
-- columnas con el mismo propósito.
--
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE asistencias DROP COLUMN IF EXISTS hora_servidor;

-- ── Verificación ───────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'asistencias'
  AND column_name IN ('hora_servidor', 'registrado_ts', 'modificado_ts')
ORDER BY column_name;
-- Debe mostrar solo registrado_ts y modificado_ts — hora_servidor ya no
-- debe aparecer en el resultado.
