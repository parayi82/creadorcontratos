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

## Firmas electrónicas (AllSign) — créditos por cliente

Auditado y verificado contra producción (septiembre 2026, PR #114 y #115). Antes de tocar `firmas_creditos`, `firmas_creditos_log`, `firmas_electronicas` o cualquier `netlify/functions/allsign-*.js`/`firmas-creditos*.js`, lee esto:

- **`firmas_electronicas`** (documento firmado, folio, estado AllSign) sí tiene RLS desde `20260807000000_rls_firmas_electronicas.sql`: cliente ve solo su propio `cliente_rfc`, admin ve todo. Las escrituras siempre llegan por el backend con `service_role` (bypasea RLS).
- **`firmas_creditos`** (saldo por cliente) y **`firmas_creditos_log`** (historial de movimientos) se crearon vía el script suelto `EJECUTAR-CREDITOS-FIRMAS.sql` (raíz del repo) — **nunca se versionaron en `supabase/migrations/`** más que su fix de RLS. Hasta el 13 de septiembre de 2026 **no tenían RLS habilitado en absoluto**, y se confirmó contra producción que `anon`/`authenticated` tenían INSERT/SELECT/UPDATE/DELETE otorgados a nivel de tabla sobre ambas: cualquiera con la anon key (pública, embebida en el frontend) podía leer el saldo y el historial de créditos de **todos** los clientes, y modificar `saldo` directamente saltándose por completo las funciones atómicas `descontar_firma_credito`/`agregar_firma_creditos` (autoasignarse firmas gratis, o alterar/borrar el log). **Ya se corrigió** con `20260913000000_rls_firmas_creditos.sql` (verificado: `rowsecurity = true` en ambas, 4 políticas SELECT activas — cliente ve su propio RFC, admin ve todo). No se agregaron políticas de escritura a propósito: toda escritura debe seguir llegando vía las funciones `SECURITY DEFINER` (otorgadas solo a `service_role`) o desde el backend.
- Las dos únicas escrituras legítimas a `firmas_creditos`/`firmas_creditos_log` son las funciones RPC `descontar_firma_credito(p_rfc, p_allsign_id)` (uso, -1) y `agregar_firma_creditos(p_rfc, p_cantidad, p_tipo, p_ref)` (compra o `ajuste_admin`), ambas `SECURITY DEFINER` y `GRANT EXECUTE` solo a `service_role`.
- `netlify/functions/firmas-creditos.js` es el endpoint del lado del cliente (`GET` saldo propio) y también el que usa el admin para ajustes manuales (`POST {accion:'ajuste_admin', cliente_rfc, cantidad}`, llama a `agregar_firma_creditos`). **Tuvo un bug real** hasta el PR #114: el `POST` llamaba a `esAdmin(sb, user)`, una función que nunca existió en `_admin-auth.js` (solo exporta `verificarAdmin`) — cualquier intento de ajuste admin tronaba con `TypeError`. Ya corregido a `verificarAdmin(event, sb)`, el patrón que usa el resto de funciones admin del repo.
- El panel de administración ("Firmas electrónicas", sidebar → Operación de `dashboard-compliance.html`) se agregó en el PR #114: totales agregados, tabla por cliente con saldo/conteo de firmas por estado, y modal de detalle + ajuste de créditos por cliente. Se alimenta de `netlify/functions/firmas-admin-resumen.js` (solo lectura, admin-only, agrega `firmas_creditos` + `firmas_electronicas` por RFC).
- **Pendiente, no bloqueante**: `firmas_creditos`/`firmas_creditos_log` siguen sin tener su `CREATE TABLE` en `supabase/migrations/` — solo su fix de RLS. Si se vuelve a tocar el esquema de estas tablas, considera traer también la definición base a una migración versionada, para dejar de depender de `EJECUTAR-CREDITOS-FIRMAS.sql` como fuente de verdad.

## Herramientas de este repo

- `graphify-out/` (si existe) es un artefacto local generado por la herramienta externa `graphify` para explorar el grafo de dependencias del código — está en `.gitignore`, no se commitea.
