# Skill: Blog SEO — ClickLaboral.mx

## Propósito
Crear, publicar y mantener el blog de cumplimiento laboral de ClickLaboral.mx con foco en SEO orgánico en Google México. Cada artículo apunta a un keyword de intención informacional ("qué son las vacaciones LFT", "multas STPS monto") para atraer empresarios buscando respuestas laborales.

## Arquitectura

```
/blog/
  index.html          — listado con filtros por categoría
  blog.css            — CSS compartido de todo el blog
  posts.json          — metadata de todos los artículos (slug, title, excerpt, categoria, fecha, minLectura)
  [slug].html         — un archivo HTML estático por artículo
/.github/
  workflows/
    blog-autopublish.yml   — GitHub Action: publica un artículo cada lunes 09:00 UTC
  scripts/
    generate-blog-post.js  — Node.js: llama Claude API, escribe HTML, actualiza posts.json e index.html
```

## Categorías disponibles
- `Contratos` — contratos de trabajo, períodos de prueba, modalidades
- `Prestaciones` — vacaciones, aguinaldo, PTU, prima vacacional, finiquito, liquidación
- `Cumplimiento` — multas STPS, inspecciones, reglamento interior, registros obligatorios
- `NOMs` — NOM-035, NOM-019, NOM-030, NOM-037
- `Terminación laboral` — rescisión, despido justificado, aviso, liquidación

## SEO checklist por artículo
- [ ] `<title>` ≤ 60 chars, keyword principal al inicio
- [ ] `<meta name="description">` 140–160 chars, incluye keyword secundario
- [ ] `<link rel="canonical">` apunta al URL final sin trailing slash
- [ ] Schema.org `Article` con `datePublished`, `dateModified`, `author`, `publisher`
- [ ] Schema.org `BreadcrumbList` con 3 niveles: Inicio → Blog → Artículo
- [ ] Open Graph: `og:title`, `og:description`, `og:url`, `og:type: article`
- [ ] `<h1>` único, incluye keyword exacto
- [ ] `<h2>` con `id=""` para anclas (TOC en sidebar)
- [ ] Al menos una tabla con datos reales
- [ ] Imagen social (cuando se agregue carpeta `/img/blog/`)
- [ ] Internal links: al menos 2 (hacia CTA de producto y artículo relacionado)

## Loop de publicación

### Automático (GitHub Actions)
- Disparo: cada lunes 09:00 UTC automáticamente
- También: manual desde Actions tab con campo de tema opcional
- El script evita repetir temas revisando slugs existentes en `posts.json`
- Requiere: `ANTHROPIC_API_KEY` como GitHub Secret (nunca en código)
- Requiere (opcional): `NETLIFY_BUILD_HOOK` como GitHub Secret para auto-deploy

### Manual (cuando el usuario pide un artículo específico)
```bash
ANTHROPIC_API_KEY=... node .github/scripts/generate-blog-post.js \
  --topic "Aguinaldo 2025: cómo calcularlo" \
  --categoria "Prestaciones"
```

## Checklist de loop completo

### 1. Verificar estado del blog
```bash
cat blog/posts.json | jq 'length'   # cuántos artículos hay
ls blog/*.html                       # archivos presentes
```

### 2. Generar nuevo artículo
- Seleccionar tema del `TOPIC_POOL` en `generate-blog-post.js` (o uno específico)
- El script genera HTML, actualiza `posts.json`, `index.html` y `sitemap.xml`

### 3. Revisar calidad del artículo generado
- Verificar que el HTML es válido (sin tags sin cerrar)
- Verificar que tiene tabla, info-box o warning-box
- Verificar que el CTA link apunta a `/diagnostico-cumplimiento.html`
- Verificar que el excerpt en posts.json tiene sentido

### 4. Commit y push
```bash
git add blog/ sitemap.xml
git commit -m "blog: [título del artículo]"
git push origin claude/session-github-onuvc9
```

### 5. Deploy
- Si hay webhook configurado: `curl -X POST "$NETLIFY_BUILD_HOOK"`
- Si no: notificar al usuario para deploy manual desde Netlify dashboard

## Pool de temas (pendientes)
Ver `TOPIC_POOL` en `.github/scripts/generate-blog-post.js` — actualmente 22 temas en 5 categorías. Agregar temas nuevos al array cuando se agoten.

## Contenido existente
| Slug | Categoría | Fecha | Status |
|------|-----------|-------|--------|
| multas-stps-2025 | Cumplimiento | 2025-08-01 | ✅ Publicado |
| tabla-vacaciones-lft-2025 | Prestaciones | 2025-07-25 | ✅ Publicado |
| periodo-de-prueba-lft-2025 | Contratos | 2025-07-18 | ✅ Publicado |

## Notas de seguridad
- `ANTHROPIC_API_KEY` → GitHub Secret únicamente, jamás en código o commits
- `NETLIFY_BUILD_HOOK` → GitHub Secret únicamente
- El script usa solo módulos nativos de Node.js (https, fs, path) — sin dependencias npm que deban instalarse
