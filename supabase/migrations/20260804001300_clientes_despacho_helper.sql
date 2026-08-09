-- ════════════════════════════════════════════════════════════════
-- REGISTRAR CLIENTES DE DESPACHO EN LA TABLA CLIENTES
-- Ejecutar en Supabase → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- PASO 1: Ver las columnas reales de la tabla clientes
-- (ejecuta esto primero para saber qué columnas existen)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'clientes'
ORDER BY ordinal_position;

-- ════════════════════════════════════════════════════════════════
-- PASO 2: Insertar el cliente del despacho (solo con rfc y empresa,
-- que son las únicas columnas garantizadas por el esquema base).
-- Ajusta los valores según lo que muestre el PASO 1.
-- ════════════════════════════════════════════════════════════════

-- Opción A: Solo rfc (mínimo absoluto, siempre funciona)
INSERT INTO clientes (rfc)
VALUES ('SALJ820818Q64')
ON CONFLICT (rfc) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- PASO 3 (opcional): Actualizar con más datos si las columnas existen
-- Descomenta y ajusta según lo que viste en el PASO 1
-- ════════════════════════════════════════════════════════════════

-- UPDATE clientes SET empresa = 'legaltech' WHERE rfc = 'SALJ820818Q64';
-- UPDATE clientes SET plan = 'despacho' WHERE rfc = 'SALJ820818Q64';

-- Verificar:
-- SELECT * FROM clientes WHERE rfc = 'SALJ820818Q64';
