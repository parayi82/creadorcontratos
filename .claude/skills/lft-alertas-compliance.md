# Skill: LFT Alertas Compliance

Automatiza TODAS las alertas de vencimientos laborales exigidos por la Ley Federal del Trabajo para ClickLaboral.mx.

## Objetivo

Cubrir cada plazo legal relevante de la LFT y NOMs para que los clientes nunca incumplan por falta de aviso. Cada vez que este skill se activa, revisa qué está implementado y qué falta, y avanza iterativamente hasta que TODO esté cubierto.

## Archivos clave

| Archivo | Propósito |
|---|---|
| `netlify/functions/notificaciones-laborales.js` | Función CRON que genera alertas diariamente |
| `_db/sql-alertas-laborales.sql` | Tabla `alertas_laborales` (ya existe) |
| `_db/sql-comisiones-mixtas-calendar.sql` | Tabla `comisiones_mixtas` (nueva) |
| `comisiones-mixtas.html` | Generador + botón "Registrar en calendario" |
| `contrato-prueba.html` | Generador + botón "Registrar alerta de vencimiento" |
| `contrato-capacitacion.html` | Generador + botón "Registrar alerta de vencimiento" |

## Mapa completo de plazos LFT

### Contratos (por trabajador, basado en `fecha_ingreso` en tabla `trabajadores`)

| Tipo | Plazo | Artículo | Alertas |
|---|---|---|---|
| Período de prueba general | 30 días | Art. 39-A | Días 23 y 27 |
| Período de prueba dirección | 180 días | Art. 39-A | Días 150 y 170 |
| Capacitación inicial general | 90 días | Art. 39-B | Días 75 y 85 |
| Capacitación inicial dirección | 180 días | Art. 39-B | Días 150 y 170 |
| Vacaciones | Anual desde 1er año | Art. 76 | -7 días del aniversario |
| Prima vacacional | Anual | Art. 80 | -7 días del aniversario |

### Obligaciones anuales (basado en clientes con trabajadores activos)

| Tipo | Fecha límite | Artículo | Alertas |
|---|---|---|---|
| Aguinaldo | 20 diciembre | Art. 87 | Dic 1 y Dic 10 |
| PTU pago (moral) | 31 mayo | Art. 122 | May 1 y May 20 |
| Comisión PTU (constitución) | Marzo | Art. 125 | Mar 1 |

### Comisiones Mixtas (basado en tabla `comisiones_mixtas`)

| Tipo | Frecuencia | Base legal | Alertas |
|---|---|---|---|
| S&H sesión | Mensual | Art. 509 + NOM-019 | -5 días del mes de constitución |
| Capacitación sesión | Trimestral | Art. 153-E | -7 días del trimestre |
| RIT revisión | Cada 2 años | Art. 424 | -60 y -30 días |
| NOM-035 evaluación | Cada 2 años | NOM-035 | -60 y -30 días |

## Tabla `comisiones_mixtas` (nueva)

```sql
CREATE TABLE comisiones_mixtas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_rfc      TEXT NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN ('sh','cap','ptu','esc','rit','nom035')),
  fecha_constitucion DATE NOT NULL,
  nombre_empresa   TEXT,
  activa           BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_rfc, tipo)
);
```

## Loop de implementación

Cada iteración debe:
1. Verificar qué alertas están en `notificaciones-laborales.js`
2. Agregar las que falten
3. Verificar qué UIs tienen botón "Registrar en calendario"
4. Agregar los que falten
5. Correr `node /tmp/.../scratchpad/smoke-static.js` para verificar integridad
6. Commit y push

## Estado

- [x] `periodo_prueba` (30d) — implementado
- [x] `prima_vacacional` — implementado
- [ ] `periodo_prueba_larga` (180d)
- [ ] `capacitacion_inicial` (90d)
- [ ] `capacitacion_inicial_larga` (180d)
- [ ] `vacaciones` (recordatorio anual)
- [ ] `aguinaldo` (diciembre)
- [ ] `ptu` (mayo)
- [ ] `comision_ptu` (marzo)
- [ ] `sesion_sh` (mensual desde `comisiones_mixtas`)
- [ ] `sesion_cap` (trimestral desde `comisiones_mixtas`)
- [ ] `revision_rit` (2 años desde `comisiones_mixtas`)
- [ ] `nom035` (2 años desde `comisiones_mixtas`)
- [ ] UI: `comisiones-mixtas.html` botón calendario
- [ ] UI: `contrato-prueba.html` botón alerta
- [ ] UI: `contrato-capacitacion.html` botón alerta
