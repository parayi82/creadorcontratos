-- sql-turno-mixto.sql
-- Soporte para jornada partida / turno mixto (dos bloques horarios por día).
-- Ejecutar en: Supabase Dashboard → SQL Editor

-- ── 1. Horario habitual del segundo turno en la tabla de trabajadores ─────────
ALTER TABLE trabajadores
  ADD COLUMN IF NOT EXISTS hora_entrada_habitual_2 TIME,
  ADD COLUMN IF NOT EXISTS hora_salida_habitual_2  TIME;

-- ── 2. Registro de horas del segundo turno en asistencias ────────────────────
ALTER TABLE asistencias
  ADD COLUMN IF NOT EXISTS hora_entrada_2 TIME,
  ADD COLUMN IF NOT EXISTS hora_salida_2  TIME;
