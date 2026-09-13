# CLAUDE.md

Guía para trabajar en este repo (ClickLaboral.mx). Se actualiza con hallazgos verificados contra producción, no con suposiciones.

## Checador digital / registro de asistencias

Auditado y verificado directamente contra la base de datos de Supabase en producción (septiembre 2026). Antes de tocar `asistencias`, `checador.html`, `asistencias-vacaciones.html` o `netlify/functions/reporte-asistencias.js`, lee esto:

**Qué es realmente inmutable y qué no:**
- **No existe** ningún trigger que bloquee editar o borrar un registro de `asistencias`, ni siquiera los que vienen del checador digital (`fuente = 'checador'` o `'adms'`). La "inmutabilidad" es solo una convención en el código cliente de `checador.html` (evita reinsertar una entrada del día), no una restricción de base de datos.
- Lo que sí existe: **cada UPDATE/DELETE queda auditado**. El trigger `trg_auditar_asistencias` → `fn_auditar_asistencias()` escribe la fila completa anterior (quién, cuándo, valores previos) en `asistencias_bitacora` antes de permitir el cambio. Esa tabla tiene RLS que bloquea escritura directa — solo el trigger (`SECURITY DEFINER`) puede insertar ahí. No es "no se puede editar", es "no se puede editar sin dejar rastro permanente".
- Los dos únicos triggers reales sobre `asistencias` son `trg_auditar_asistencias` (auditoría) y `trg_reconciliar_asistencia` (genera/cierra actas de inasistencia y alertas — el "motor central", `fn_reconciliar_asistencia()` en `20260902000002_motor_asistencias.sql`).

**Columnas de sello de tiempo:**
- `registrado_ts` es la **única** columna de sello de tiempo del servidor (`TIMESTAMPTZ DEFAULT now()`, fijada por Postgres en el INSERT, no depende del reloj del dispositivo). Es la que usa el código: `reporte-asistencias.js` y `asistencias-vacaciones.html` (expediente exportable Art. 804 LFT) la incluyen como evidencia de mayor fuerza probatoria que `hora_entrada`/`hora_salida` (que sí vienen del `new Date()` del navegador del trabajador — ver `checador.html`).
- Existió una columna duplicada `hora_servidor` (misma idea, otra migración, nunca usada por ningún código de la app) — **se eliminó** en septiembre 2026 (migración `20260912000000_drop_hora_servidor_duplicado.sql`). Si ves referencias viejas a `hora_servidor` en comentarios de migraciones anteriores, son historia — no la recrees.
- `geo_lat`/`geo_lng` (geolocalización del checado) también se capturan y están incluidas en el reporte exportable desde septiembre 2026.

**Scripts SQL sueltos en la raíz del repo (fuera de `supabase/migrations/`):**
- El repo tiene varios `sql-*.sql` en la raíz y en `_db/` que son en su mayoría mirrors o borradores manuales para correr en el SQL Editor de Supabase. **No asumas que están aplicados en producción solo porque existen en el repo.** Ya se encontró y eliminó uno (`sql-auditoria-asistencias.sql`) que definía un trigger de inmutabilidad dura y una tabla de auditoría (`asistencias_audit`) que **nunca se ejecutaron** — quedó huérfano generando información falsa sobre las protecciones reales del sistema.
- Antes de confiar en un script suelto sin fecha reciente ni referencias desde el código de la app, verifica contra la base de datos real:
  ```sql
  SELECT tgname, tgenabled, pg_get_triggerdef(oid)
  FROM pg_trigger WHERE tgrelid = '<tabla>'::regclass AND NOT tgisinternal;
  ```
  `supabase/migrations/` (con timestamp) es la fuente de verdad de lo que debería estar aplicado; los `sql-*.sql` sueltos no lo son necesariamente.

**Este entorno no tiene acceso directo a Supabase** (sin credenciales en variables de entorno, sin conector MCP de base de datos). Cualquier migración nueva se agrega como archivo en `supabase/migrations/` y se le pide al usuario que la corra manualmente en el SQL Editor, con una consulta de verificación al final.

## Herramientas de este repo

- `graphify-out/` (si existe) es un artefacto local generado por la herramienta externa `graphify` para explorar el grafo de dependencias del código — está en `.gitignore`, no se commitea.
