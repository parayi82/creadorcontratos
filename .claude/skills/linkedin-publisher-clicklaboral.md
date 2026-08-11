# LinkedIn Publisher — ClickLaboral.mx

## Propósito

Guía para crear y gestionar el sistema de publicación diaria en LinkedIn de ClickLaboral.mx.
El objetivo es generar leads calificados entre las 4 audiencias objetivo mediante contenido
de valor sobre derecho laboral mexicano, posicionando ClickLaboral.mx como la solución
de referencia para el cumplimiento laboral de PyMEs.

---

## Arquitectura del Sistema

```
GitHub Actions (cron diario 9am CST, Lun–Vie)
  └── generate-linkedin-post.js
        ├── Selecciona audiencia del día (rotación semanal)
        ├── Selecciona tema (rotación por semana del año — 60 temas, sin repetir)
        ├── Llama Claude API → genera post de 200-270 palabras
        ├── Envía el texto por email via Resend → listo para copiar/pegar
        └── Registra en linkedin-posts-log.json

Flujo de publicación (30 segundos):
  1. Recibes el email con el post generado
  2. Copias el texto
  3. Lo pegas en LinkedIn → Publicar
```

**Sin API de LinkedIn. Sin tokens que expiren. Sin pagos extra.**

---

## Audiencias y Calendario Semanal

| Día       | Audiencia Principal      | Dolor principal                                  | Ángulo de venta                         |
|-----------|--------------------------|--------------------------------------------------|-----------------------------------------|
| Lunes     | Reclutadores / RH        | Contratos incorrectos, expedientes incompletos   | Genera contratos con IA en minutos      |
| Martes    | Contadores               | Errores de nómina, multas IMSS/SAT               | Dashboard de nómina y alertas de fechas |
| Miércoles | Abogados laboralistas    | Clientes mal documentados, juicios perdibles     | Expedientes y actas irrefutables        |
| Jueves    | Patrones / Dueños PyME   | Multas STPS, demandas, costos ocultos            | Diagnóstico de cumplimiento gratuito    |
| Viernes   | Reclutadores (rotación)  | Contratación, periodos de prueba, home office    | Contratos especializados por sector     |

---

## Secretos de GitHub Requeridos

Solo necesitas agregar **un secreto** a los que ya tienes. El `RESEND_API_KEY` lo tienes
configurado en Netlify — solo cópialo a GitHub Secrets.

| Secreto             | Descripción                          | Estado                                |
|---------------------|--------------------------------------|---------------------------------------|
| `ANTHROPIC_API_KEY` | Claude API key                       | ✅ Ya configurado                     |
| `RESEND_API_KEY`    | Resend API key (misma que en Netlify)| ⚠️ Añadir a GitHub Secrets           |
| `NOTIFY_EMAIL`      | Email donde recibirás los posts      | Opcional (default: serjuemsa@gmail.com) |

### Cómo añadir RESEND_API_KEY a GitHub Secrets
1. En Netlify: **Site settings → Environment variables → Copiar valor de RESEND_API_KEY**
2. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `RESEND_API_KEY`
   - Value: el valor copiado de Netlify
3. Click **Add secret**

**Eso es todo. Sin LinkedIn API. Sin tokens OAuth.**

---

## Estructura de un Post de LinkedIn Exitoso

```
[GANCHO — primera línea impactante, máx 15 palabras]
[línea vacía]
[Párrafo 1: contexto del problema con dato específico]
[línea vacía]
[Párrafo 2: desarrollo con referencia legal real (LFT Art. X, IMSS, etc.)]
[línea vacía]
[Párrafo 3: cómo ClickLaboral.mx resuelve esto — mención NATURAL, no de anuncio]
[línea vacía]
[CTA: acción concreta + URL con UTM]
[línea vacía]
#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5
```

**Longitud objetivo:** 180–280 palabras (favorecido por el algoritmo de LinkedIn)
**Emojis:** máximo 2, estratégicos (✅ ⚠️ 📊 — nunca al inicio de cada párrafo)
**Tono:** experto que comparte conocimiento, no vendedor

---

## Biblioteca de Hashtags por Audiencia

### Reclutadores / RH
`#RecursosHumanos #RRHH #Reclutamiento #ContratosLaborales #LeyFederalDelTrabajo #TalentoHumano #HRMexico #CumplimientoLaboral #ClickLaboralmx`

### Contadores
`#Nómina #Contabilidad #IMSS #INFONAVIT #PTU #Aguinaldo #CFDINomina #CumplimientoFiscal #NóminaElectrónica #ClickLaboralmx`

### Abogados
`#DerechoLaboral #AbogadoLaboral #LFT #ReformaLaboral #ComplianceMéxico #DerechoEmpresarial #JuicioLaboral #ClickLaboralmx`

### Patrones / PyMEs
`#PyME #Emprendimiento #GestiónEmpresarial #STPS #CumplimientoLaboral #DerechoEmpresarial #PatronMexicano #ClickLaboralmx`

---

## UTMs para Tracking

Los CTAs incluyen parámetros UTM por audiencia:

| Audiencia     | UTM content           |
|---------------|-----------------------|
| Reclutadores  | `reclutadores`        |
| Contadores    | `contadores`          |
| Abogados      | `abogados`            |
| Patrones      | `patrones`            |

URL base: `https://clicklaboral.mx/?utm_source=linkedin&utm_medium=social&utm_campaign=organic&utm_content=AUDIENCIA`

---

## Ejecución Manual

### Activar desde GitHub Actions
1. Ir a **Actions → LinkedIn — Post diario ClickLaboral.mx**
2. Click en **Run workflow**
3. Opcionalmente especificar audiencia y/o tema; activar DRY RUN para previsualizar sin enviar

### Ejecutar localmente (testing)
```bash
ANTHROPIC_API_KEY=sk-ant-xxx \
RESEND_API_KEY=re_xxx \
NOTIFY_EMAIL=serjuemsa@gmail.com \
node .github/scripts/generate-linkedin-post.js
```

Para solo generar el texto sin enviar email:
```bash
DRY_RUN=true \
ANTHROPIC_API_KEY=sk-ant-xxx \
node .github/scripts/generate-linkedin-post.js
```

---

## Métricas de Éxito (revisar mensualmente)

- **Impresiones por post** — objetivo: >500/post a los 3 meses
- **Tasa de engagement** — objetivo: >3% (likes + comentarios + shares / impresiones)
- **Clicks al perfil** — proxy de consideración de compra
- **Tráfico web desde LinkedIn** — verificar en Google Analytics con filtro utm_source=linkedin
- **Leads generados** — contactos que llegan desde LinkedIn a checkout.html

---

## Sin tokens que renovar

Al usar Resend en lugar de la API de LinkedIn, no hay tokens OAuth que caduquen.
El único mantenimiento necesario es si cambias tu API key de Resend (muy raro).

---

## Generación de Contenido con Claude

El script usa este modelo de prompt para cada audiencia. Al invocar Claude:

```
Eres el community manager de ClickLaboral.mx, plataforma líder en México
de cumplimiento laboral para PyMEs.

AUDIENCIA: [reclutadores / contadores / abogados / patrones]
TEMA: [tema seleccionado del pool]

Escribe un post de LinkedIn de 200-260 palabras que:
1. Abra con un gancho (pregunta retórica o dato impactante)
2. Desarrolle el tema con datos específicos de la LFT/IMSS 2025
3. Mencione ClickLaboral.mx de forma natural como solución
4. Cierre con CTA hacia clicklaboral.mx con UTMs
5. Incluya 4-5 hashtags al final

Tono: experto accesible, español mexicano formal, máximo 2 emojis.
```

---

## Log de Posts Publicados

El archivo `linkedin-posts-log.json` registra cada publicación con:
- fecha, audiencia, tema, ID del post en LinkedIn, URL del post
- Se actualiza automáticamente en cada ejecución del workflow
