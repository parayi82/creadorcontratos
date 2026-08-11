# LinkedIn Publisher — ClickLaboral.mx

## Propósito

Guía para crear y gestionar el sistema de publicación diaria en LinkedIn de ClickLaboral.mx.
El objetivo es generar leads calificados entre las 4 audiencias objetivo mediante contenido
de valor sobre derecho laboral mexicano, posicionando ClickLaboral.mx como la solución
de referencia para el cumplimiento laboral de PyMEs.

---

## Arquitectura del Sistema

```
GitHub Actions (cron diario 9am CST)
  └── generate-linkedin-post.js
        ├── Selecciona audiencia del día (rotación semanal)
        ├── Selecciona tema (rotación por semana del año)
        ├── Llama Claude API → genera post
        ├── Llama LinkedIn API → publica
        └── Registra en linkedin-posts-log.json
```

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

| Secreto               | Descripción                                    | Cómo obtener                                                                    |
|-----------------------|------------------------------------------------|---------------------------------------------------------------------------------|
| `ANTHROPIC_API_KEY`   | Ya configurado en el repositorio               | —                                                                               |
| `LINKEDIN_ACCESS_TOKEN` | Token OAuth 2.0 de LinkedIn (válido 60 días) | Ver sección "Configuración OAuth" abajo                                         |
| `LINKEDIN_AUTHOR_URN`  | URN del autor (persona u organización)         | `urn:li:person:XXXXXXXX` o `urn:li:organization:XXXXXXXX` (ver sección abajo)  |

---

## Configuración de LinkedIn API (paso a paso)

### 1. Crear LinkedIn App
1. Entrar a https://www.linkedin.com/developers/apps/new
2. Crear app con nombre "ClickLaboral.mx"
3. En **Products** solicitar: **Share on LinkedIn** + **Sign In with LinkedIn**
4. Scopes necesarios: `w_member_social` (para perfil personal) o `w_organization_social` (para página empresa)

### 2. Obtener Access Token (flujo Authorization Code)

```bash
# Paso A: Autorización (abrir en navegador)
https://www.linkedin.com/oauth/v2/authorization
  ?response_type=code
  &client_id=TU_CLIENT_ID
  &redirect_uri=https://clicklaboral.mx/oauth/callback
  &scope=w_member_social%20r_liteprofile

# Paso B: Canjear código por token
curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
  -d "grant_type=authorization_code" \
  -d "code=CODIGO_DE_RESPUESTA" \
  -d "client_id=TU_CLIENT_ID" \
  -d "client_secret=TU_CLIENT_SECRET" \
  -d "redirect_uri=https://clicklaboral.mx/oauth/callback"
```

El token dura **60 días**. Programar renovación cada 50 días (hay workflow de renovación incluido).

### 3. Obtener Author URN

```bash
# Para perfil personal:
curl -H "Authorization: Bearer TU_TOKEN" https://api.linkedin.com/v2/me
# Responder con: {"id": "XXXXXXXX"} → URN: urn:li:person:XXXXXXXX

# Para página empresa (organización):
curl -H "Authorization: Bearer TU_TOKEN" \
  "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~))"
# Responder con el ID de la org → URN: urn:li:organization:XXXXXXXX
```

### 4. Guardar en GitHub Secrets
En el repositorio: **Settings → Secrets → Actions → New repository secret**
- `LINKEDIN_ACCESS_TOKEN` = el token obtenido en paso B
- `LINKEDIN_AUTHOR_URN` = `urn:li:person:XXXXXXXX` o `urn:li:organization:XXXXXXXX`

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
1. Ir a **Actions → LinkedIn Daily Publish — ClickLaboral.mx**
2. Click en **Run workflow**
3. Opcionalmente especificar audiencia y tema

### Ejecutar localmente (testing)
```bash
ANTHROPIC_API_KEY=sk-ant-xxx \
LINKEDIN_ACCESS_TOKEN=AQV... \
LINKEDIN_AUTHOR_URN=urn:li:person:XXXXXXXX \
node .github/scripts/generate-linkedin-post.js
```

Para modo dry-run (generar contenido sin publicar):
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

## Renovación del Access Token

El token de LinkedIn expira cada 60 días. El workflow `linkedin-token-refresh.yml`
envía un recordatorio por email 10 días antes del vencimiento.

Para renovar manualmente ejecutar el flujo OAuth del paso 2 y actualizar
el secreto `LINKEDIN_ACCESS_TOKEN` en GitHub Settings.

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
