#!/usr/bin/env node
/**
 * generate-blog-post.js
 * Calls Claude API to generate a new SEO-optimized blog post for ClickLaboral.mx,
 * writes the HTML file, updates posts.json and blog/index.html.
 *
 * Usage: node generate-blog-post.js [--topic "optional topic override"]
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY  — stored as GitHub Secret, never in code
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..', '..');

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = { hostname, port: 443, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(raw));
        else reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Topic pool (rotates; avoids repeats) ──────────────────────────────────

const TOPIC_POOL = [
  // Contratos
  { topic: "Contrato por tiempo indeterminado vs. determinado: cuándo usar cada uno", cat: "Contratos" },
  { topic: "Subcontratación (outsourcing) tras la reforma 2021: qué cambió y cómo cumplir", cat: "Contratos" },
  { topic: "Cómo redactar correctamente el puesto y las funciones en un contrato laboral", cat: "Contratos" },
  { topic: "Carta oferta vs. contrato de trabajo: diferencias y riesgos legales", cat: "Contratos" },
  // Prestaciones
  { topic: "Aguinaldo 2025: cómo calcularlo correctamente y cuándo pagarlo", cat: "Prestaciones" },
  { topic: "PTU 2025: qué es la participación de utilidades y cómo distribuirla", cat: "Prestaciones" },
  { topic: "Prima dominical y días de descanso obligatorio en México", cat: "Prestaciones" },
  { topic: "Cómo calcular el finiquito de un trabajador que renuncia", cat: "Prestaciones" },
  { topic: "Liquidación por despido injustificado: fórmula exacta 2025", cat: "Prestaciones" },
  // Cumplimiento
  { topic: "Reglamento interior de trabajo: qué debe incluir y cómo depositarlo ante la STPS", cat: "Cumplimiento" },
  { topic: "Registro Patronal IMSS: obligaciones y plazos que no puede ignorar", cat: "Cumplimiento" },
  { topic: "Actas administrativas: cuándo levantarlas y cómo hacerlo para que sean válidas", cat: "Cumplimiento" },
  { topic: "Cómo documentar un despido por causa justificada y no perder en juicio", cat: "Cumplimiento" },
  { topic: "Registro de jornada laboral: obligaciones del patrón y cómo cumplirlas", cat: "Cumplimiento" },
  // NOMs
  { topic: "NOM-035-STPS: guía práctica para centros de trabajo con más de 16 empleados", cat: "NOMs" },
  { topic: "NOM-019-STPS: Comisiones de Seguridad e Higiene paso a paso", cat: "NOMs" },
  { topic: "NOM-030-STPS: servicios preventivos de seguridad y salud en el trabajo", cat: "NOMs" },
  { topic: "NOM-037-STPS: teletrabajo — obligaciones del patrón en 2025", cat: "NOMs" },
  // Terminación laboral
  { topic: "Las 15 causales de rescisión sin responsabilidad para el patrón (art. 47 LFT)", cat: "Terminación laboral" },
  { topic: "Aviso de rescisión: qué debe decir y en qué plazo entregarlo", cat: "Terminación laboral" },
  { topic: "Trabajador de confianza: diferencias laborales y cómo afecta el despido", cat: "Terminación laboral" },
];

function pickTopic(existingSlugs) {
  const used = new Set(existingSlugs);
  const unused = TOPIC_POOL.filter(t => !used.has(slugify(t.topic)));
  if (unused.length === 0) return TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
  return unused[Math.floor(Math.random() * unused.length)];
}

// ── Claude prompt ──────────────────────────────────────────────────────────

function buildPrompt(topic, categoria) {
  return `Eres un experto en derecho laboral mexicano y SEO. Escribe un artículo de blog completo para ClickLaboral.mx sobre:

**TEMA:** ${topic}
**CATEGORÍA:** ${categoria}

REQUISITOS DE CONTENIDO:
- Longitud: 1,000 a 1,400 palabras de contenido visible
- Idioma: español formal mexicano (tuteo empresarial: "su empresa", "el patrón", "el trabajador")
- Incluir al menos una tabla HTML con datos reales (artículos LFT, montos, plazos)
- Incluir al menos un bloque .bl-info-box o .bl-warning-box con contenido relevante
- Incluir un bloque .bl-cta-box al final del contenido (antes del resumen)
- Terminar con sección h2 id="conclusion" con lista <ul> de 5 a 7 puntos de resumen ejecutivo
- Usar hechos legales reales y vigentes para México 2025
- NO inventar artículos de ley; si hay duda, ser general pero correcto
- Tono: informativo, directo, práctico — lenguaje de empresario, no de abogado

ESTRUCTURA HTML REQUERIDA (retorna SOLO el bloque dentro de <div class="bl-content">):
- <p class="bl-lead"> párrafo de apertura de alto impacto
- <h2 id="..."> secciones con ids en minúsculas con guiones
- Tablas con thead/tbody
- Clases disponibles: .bl-info-box (azul), .bl-warning-box (amarillo), .bl-cta-box
- En .bl-cta-box usar: <h3>, <p>, y <a href="/diagnostico-cumplimiento.html">Ver diagnóstico gratuito →</a>

RETORNA ÚNICAMENTE el HTML del bloque .bl-content (sin la etiqueta div exterior). Sin explicaciones, sin markdown, solo HTML listo para insertar.`;
}

// ── Call Claude API ────────────────────────────────────────────────────────

async function generateContent(topic, categoria) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY no definida');

  const response = await httpsPost('api.anthropic.com', '/v1/messages', {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }, {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: buildPrompt(topic, categoria) }],
  });

  return response.content[0].text.trim();
}

// ── Estimate reading time ──────────────────────────────────────────────────

function estimateReadTime(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const words = text.trim().split(' ').length;
  return Math.max(4, Math.round(words / 200));
}

// ── Extract plain-text excerpt ─────────────────────────────────────────────

function extractExcerpt(html) {
  const match = html.match(/<p class="bl-lead">([\s\S]*?)<\/p>/);
  if (match) return match[1].replace(/<[^>]+>/g, '').slice(0, 200).trim() + '…';
  const anyP = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  if (anyP) return anyP[1].replace(/<[^>]+>/g, '').slice(0, 200).trim() + '…';
  return '';
}

// ── Build keywords from topic ──────────────────────────────────────────────

function buildKeywords(topic, categoria) {
  const base = slugify(topic).replace(/-/g, ' ');
  return `${base}, ${categoria.toLowerCase()} laboral México 2025, LFT`;
}

// ── Build full article HTML ────────────────────────────────────────────────

function buildArticleHtml({ slug, title, categoria, fecha, minLectura, contentHtml, relatedPosts }) {
  const related = relatedPosts.slice(0, 2).map(p => `
      <article class="bl-card">
        <div class="bl-card-body">
          <div class="bl-card-cat">${p.categoria}</div>
          <h2><a href="/blog/${p.slug}.html">${p.title}</a></h2>
          <p class="bl-card-exc">${p.excerpt}</p>
          <div class="bl-card-meta"><span>📅 ${fmtFecha(p.fecha)}</span><a href="/blog/${p.slug}.html" class="bl-card-read">Leer →</a></div>
        </div>
      </article>`).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | ClickLaboral.mx</title>
<meta name="description" content="${extractExcerpt(contentHtml).slice(0, 160)}">
<link rel="canonical" href="https://clicklaboral.mx/blog/${slug}.html">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/blog/blog.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${extractExcerpt(contentHtml).slice(0, 160)}">
<meta property="og:url" content="https://clicklaboral.mx/blog/${slug}.html">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${title.replace(/"/g, '\\"')}",
  "description": "${extractExcerpt(contentHtml).slice(0, 160).replace(/"/g, '\\"')}",
  "datePublished": "${fecha}",
  "dateModified": "${fecha}",
  "author": {"@type": "Organization","name": "ClickLaboral.mx"},
  "publisher": {"@type": "Organization","name": "ClickLaboral.mx","url": "https://clicklaboral.mx"}
}
<\/script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem","position": 1,"name": "Inicio","item": "https://clicklaboral.mx"},
    {"@type": "ListItem","position": 2,"name": "Blog","item": "https://clicklaboral.mx/blog/"},
    {"@type": "ListItem","position": 3,"name": "${title.replace(/"/g, '\\"')}","item": "https://clicklaboral.mx/blog/${slug}.html"}
  ]
}
<\/script>
</head>
<body>

<nav class="bl-nav">
  <a href="/" class="bl-nav-logo">Click<span>Laboral.mx</span></a>
  <div class="bl-nav-links">
    <a href="/" class="bl-nav-link">Inicio</a>
    <a href="/blog/" class="bl-nav-link">Blog</a>
    <a href="/diagnostico-cumplimiento.html" class="bl-nav-cta">Diagnóstico gratis →</a>
  </div>
</nav>

<div class="bl-article-wrap">
  <nav class="bl-breadcrumb" aria-label="Navegación">
    <a href="/">Inicio</a><span>›</span>
    <a href="/blog/">Blog</a><span>›</span>
    <span>${title}</span>
  </nav>

  <header class="bl-article-header">
    <div class="bl-article-cat">${categoria}</div>
    <h1>${title}</h1>
    <div class="bl-article-meta">
      <span>📅 <strong>${fmtFecha(fecha)}</strong></span>
      <span>⏱ ${minLectura} min de lectura</span>
      <span>👤 ClickLaboral Editorial</span>
    </div>
  </header>

  <div class="bl-article-body">
    <div class="bl-content">
${contentHtml}
    </div>

    <aside class="bl-sidebar">
      <div class="bl-toc">
        <div class="bl-toc-title">Contenido</div>
        <ul id="toc-list"></ul>
      </div>
      <div class="bl-sidebar-cta">
        <h4>Cumpla la ley sin complicaciones</h4>
        <p>Contratos, comisiones mixtas, alertas de vencimiento y más — automatizado en un solo portal.</p>
        <a href="/diagnostico-cumplimiento.html">Ver ClickLaboral →</a>
      </div>
    </aside>
  </div>
</div>

<section class="bl-related">
  <div class="bl-related-inner">
    <h2>Artículos relacionados</h2>
    <div class="bl-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-top:0;">
${related}
    </div>
  </div>
</section>

<footer class="bl-footer">
  <p><a href="/">ClickLaboral.mx</a> — Plataforma de compliance laboral para PyMEs mexicanas</p>
  <p style="margin-top:4px;"><a href="/aviso-de-privacidad.html">Aviso de privacidad</a> · <a href="/terminos-de-servicio.html">Términos de servicio</a></p>
  <p style="margin-top:12px;font-size:12px;opacity:.5;">Este artículo es informativo y no constituye asesoría legal.</p>
</footer>

<script>
// Auto-build TOC from h2 headings
(function(){
  const hs = document.querySelectorAll('.bl-content h2[id]');
  const ul = document.getElementById('toc-list');
  hs.forEach(h => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    ul.appendChild(li);
  });
  const links = ul.querySelectorAll('a');
  window.addEventListener('scroll', () => {
    let cur = '';
    hs.forEach(h => { if (window.scrollY >= h.offsetTop - 100) cur = h.id; });
    links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
  }, { passive: true });
})();
</script>
</body>
</html>`;
}

function fmtFecha(iso) {
  const [y, m, d] = iso.split('-');
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(d)} ${meses[parseInt(m)-1]} ${y}`;
}

// ── Update posts.json ──────────────────────────────────────────────────────

function updatePostsJson(newPost) {
  const file = path.join(ROOT, 'blog', 'posts.json');
  const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
  posts.unshift(newPost);
  fs.writeFileSync(file, JSON.stringify(posts, null, 2) + '\n');
  return posts;
}

// ── Update blog/index.html ─────────────────────────────────────────────────

function updateBlogIndex(posts) {
  const file = path.join(ROOT, 'blog', 'index.html');
  let html = fs.readFileSync(file, 'utf8');

  const cards = posts.map(p => `
    <!-- POST: ${p.title} -->
    <article class="bl-card" data-cat="${p.categoria}">
      <div class="bl-card-body">
        <div class="bl-card-cat">${p.categoria}</div>
        <h2><a href="/blog/${p.slug}.html">${p.title}</a></h2>
        <p class="bl-card-exc">${p.excerpt}</p>
        <div class="bl-card-meta">
          <span>📅 ${fmtFecha(p.fecha)}</span>
          <span>⏱ ${p.minLectura} min</span>
          <a href="/blog/${p.slug}.html" class="bl-card-read">Leer →</a>
        </div>
      </div>
    </article>`).join('\n');

  html = html.replace(
    /(<div class="bl-grid" id="bl-grid">)([\s\S]*?)(<\/div>\s*<p id="bl-no-posts")/,
    `$1\n${cards}\n\n  $3`
  );

  fs.writeFileSync(file, html);
}

// ── Update sitemap.xml ─────────────────────────────────────────────────────

function updateSitemap(posts) {
  const file = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(file)) return;

  let xml = fs.readFileSync(file, 'utf8');
  const blogEntries = posts.map(p =>
    `  <url>\n    <loc>https://clicklaboral.mx/blog/${p.slug}.html</loc>\n    <lastmod>${p.fecha}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`
  ).join('\n');

  if (xml.includes('<!-- BLOG_POSTS -->')) {
    xml = xml.replace(/<!-- BLOG_POSTS -->[\s\S]*?<!-- \/BLOG_POSTS -->/, `<!-- BLOG_POSTS -->\n${blogEntries}\n<!-- /BLOG_POSTS -->`);
  } else if (xml.includes('/blog/')) {
    xml = xml.replace(/<url>\s*<loc>https:\/\/clicklaboral\.mx\/blog\/[\s\S]*?<\/url>/g, '');
    xml = xml.replace('</urlset>', `${blogEntries}\n</urlset>`);
  } else {
    xml = xml.replace('</urlset>', `${blogEntries}\n</urlset>`);
  }

  fs.writeFileSync(file, xml);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let topicOverride = null;
  let catOverride = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic') topicOverride = args[i + 1];
    if (args[i] === '--categoria') catOverride = args[i + 1];
  }

  const postsFile = path.join(ROOT, 'blog', 'posts.json');
  const existingPosts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  const existingSlugs = existingPosts.map(p => p.slug);

  const selected = topicOverride
    ? { topic: topicOverride, cat: catOverride || 'Cumplimiento' }
    : pickTopic(existingSlugs);

  console.log(`📝 Generando artículo: "${selected.topic}" (${selected.cat})`);

  const contentHtml = await generateContent(selected.topic, selected.cat);
  const slug = slugify(selected.topic) + '-' + today().slice(0, 4);
  const fecha = today();
  const minLectura = estimateReadTime(contentHtml);
  const excerpt = extractExcerpt(contentHtml);
  const palabrasClave = buildKeywords(selected.topic, selected.cat);

  const newPost = { slug, title: selected.topic, excerpt, categoria: selected.cat, fecha, minLectura, palabrasClave };

  const articleHtml = buildArticleHtml({
    slug, title: selected.topic, categoria: selected.cat, fecha, minLectura, contentHtml,
    relatedPosts: existingPosts.slice(0, 2),
  });

  const outFile = path.join(ROOT, 'blog', `${slug}.html`);
  fs.writeFileSync(outFile, articleHtml);
  console.log(`✅ Artículo guardado: blog/${slug}.html`);

  const allPosts = updatePostsJson(newPost);
  console.log(`✅ posts.json actualizado (${allPosts.length} artículos)`);

  updateBlogIndex(allPosts);
  console.log('✅ blog/index.html actualizado');

  updateSitemap(allPosts);
  console.log('✅ sitemap.xml actualizado');

  console.log(`\n🎉 Nuevo artículo listo para commit: blog/${slug}.html`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
