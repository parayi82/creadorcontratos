-- sql-limpiar-actas-con-asistencia.sql
-- Elimina actas de inasistencia cuyo día ahora tiene asistencia registrada (presente)
-- Ejecutar en Supabase → SQL Editor
-- Aplica a TODOS los clientes (ON CONFLICT en asistencias ya garantiza coherencia)

DELETE FROM actas_inasistencia ai
WHERE EXISTS (
  SELECT 1
  FROM asistencias a
  WHERE a.trabajador_id = ai.trabajador_id
    AND a.fecha         = ai.fecha
    AND a.status IN ('presente','vacaciones','permiso','incapacidad','festivo')
)
AND ai.estado = 'provisional';

-- Verificar cuántas quedaron activas después del borrado
SELECT COUNT(*) AS actas_pendientes_restantes FROM actas_inasistencia WHERE estado = 'provisional';
