#!/usr/bin/env node
/**
 * generate-blog-post.js
 * Calls Claude API to generate SEO-optimized content for ClickLaboral.mx.
 *
 * Usage:
 *   node generate-blog-post.js                        — artículo semanal (aleatorio)
 *   node generate-blog-post.js --tipo noticia         — noticia/tip diaria (300-400 palabras)
 *   node generate-blog-post.js --topic "..." --categoria "..."  — tema específico
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

function httpsPost(hostname, reqPath, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = { hostname, port: 443, path: reqPath, method: 'POST',
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

// ── Article topic pool (long-form, 3×/week) ────────────────────────────────

const TOPIC_POOL = [
  // Contratos
  { topic: "Contrato por tiempo indeterminado vs. determinado: cuándo usar cada uno", cat: "Contratos" },
  { topic: "Subcontratación (outsourcing) tras la reforma 2021: qué cambió y cómo cumplir", cat: "Contratos" },
  { topic: "Cómo redactar correctamente el puesto y las funciones en un contrato laboral", cat: "Contratos" },
  { topic: "Carta oferta vs. contrato de trabajo: diferencias y riesgos legales", cat: "Contratos" },
  { topic: "Contrato por obra determinada: cuándo es válido y cómo redactarlo", cat: "Contratos" },
  { topic: "Cláusulas prohibidas en contratos de trabajo según la LFT", cat: "Contratos" },
  { topic: "Teletrabajo: cómo formalizar el contrato y cumplir con NOM-037", cat: "Contratos" },
  { topic: "Trabajadores domésticos: obligaciones del patrón en 2025", cat: "Contratos" },
  { topic: "Contrato colectivo de trabajo: qué es, cuándo aplica y cómo negociarlo", cat: "Contratos" },
  { topic: "Modificación de condiciones de trabajo: qué puede cambiar el patrón y qué no", cat: "Contratos" },
  { topic: "Trabajadores extranjeros en México: permisos, restricciones y contratos", cat: "Contratos" },
  { topic: "Contrato de honorarios vs. relación laboral: cómo saber cuándo hay subordinación", cat: "Contratos" },
  // Prestaciones
  { topic: "Aguinaldo 2025: cómo calcularlo correctamente y cuándo pagarlo", cat: "Prestaciones" },
  { topic: "PTU 2025: qué es la participación de utilidades y cómo distribuirla", cat: "Prestaciones" },
  { topic: "Prima dominical y días de descanso obligatorio en México", cat: "Prestaciones" },
  { topic: "Cómo calcular el finiquito de un trabajador que renuncia", cat: "Prestaciones" },
  { topic: "Liquidación por despido injustificado: fórmula exacta 2025", cat: "Prestaciones" },
  { topic: "Prima de antigüedad: cuándo se paga, cómo se calcula y quiénes tienen derecho", cat: "Prestaciones" },
  { topic: "Salario mínimo 2025 en México: monto, zonas y obligaciones del patrón", cat: "Prestaciones" },
  { topic: "Salario base de cotización IMSS: qué incluye y cómo calcularlo correctamente", cat: "Prestaciones" },
  { topic: "Vales de despensa: tratamiento fiscal y laboral para la empresa", cat: "Prestaciones" },
  { topic: "Fondo de ahorro para trabajadores: cómo implementarlo y qué dice la LFT", cat: "Prestaciones" },
  { topic: "INFONAVIT: obligaciones del patrón con los créditos de sus trabajadores", cat: "Prestaciones" },
  { topic: "AFORE y retiro: qué debe aportar el patrón y en qué plazos", cat: "Prestaciones" },
  { topic: "Horas extra en México: límites legales, cuánto se pagan y cómo documentarlas", cat: "Prestaciones" },
  { topic: "Licencia de maternidad y paternidad 2025: días, pagos y obligaciones patronales", cat: "Prestaciones" },
  // Cumplimiento
  { topic: "Reglamento interior de trabajo: qué debe incluir y cómo depositarlo ante la STPS", cat: "Cumplimiento" },
  { topic: "Registro Patronal IMSS: obligaciones y plazos que no puede ignorar", cat: "Cumplimiento" },
  { topic: "Actas administrativas: cuándo levantarlas y cómo hacerlo para que sean válidas", cat: "Cumplimiento" },
  { topic: "Cómo documentar un despido por causa justificada y no perder en juicio", cat: "Cumplimiento" },
  { topic: "Registro de jornada laboral: obligaciones del patrón y cómo cumplirlas", cat: "Cumplimiento" },
  { topic: "CFDI de nómina: requisitos obligatorios para que sea fiscalmente válido", cat: "Cumplimiento" },
  { topic: "Inspección del IMSS: qué revisan y cómo preparar su empresa", cat: "Cumplimiento" },
  { topic: "Cuotas IMSS del patrón 2025: cómo se calculan y cuándo se pagan", cat: "Cumplimiento" },
  { topic: "Programa anual de capacitación: cómo elaborarlo y registrarlo ante la STPS", cat: "Cumplimiento" },
  { topic: "Comisión Mixta de PTU: integración, funciones y plazos legales", cat: "Cumplimiento" },
  { topic: "Control de asistencia: qué formatos acepta la STPS y cómo implementarlo", cat: "Cumplimiento" },
  { topic: "Nuevo sistema de justicia laboral: cómo funcionan los juicios laborales en 2025", cat: "Cumplimiento" },
  { topic: "REPSE: qué es el Registro de Prestadoras de Servicios y cómo obtenerlo", cat: "Cumplimiento" },
  { topic: "Carta de renuncia voluntaria: qué debe incluir y por qué protege al patrón", cat: "Cumplimiento" },
  { topic: "Archivo laboral: qué documentos debe conservar el patrón y por cuánto tiempo", cat: "Cumplimiento" },
  { topic: "Conciliación laboral obligatoria: cómo funciona el CFCRL antes del juicio", cat: "Cumplimiento" },
  // NOMs
  { topic: "NOM-035-STPS: guía práctica para centros de trabajo con más de 16 empleados", cat: "NOMs" },
  { topic: "NOM-019-STPS: Comisiones de Seguridad e Higiene paso a paso", cat: "NOMs" },
  { topic: "NOM-030-STPS: servicios preventivos de seguridad y salud en el trabajo", cat: "NOMs" },
  { topic: "NOM-037-STPS: teletrabajo — obligaciones del patrón en 2025", cat: "NOMs" },
  { topic: "NOM-017-STPS: equipo de protección personal — qué debe proveer el patrón", cat: "NOMs" },
  { topic: "NOM-025-STPS: iluminación en centros de trabajo — requisitos y sanciones", cat: "NOMs" },
  { topic: "NOM-006-STPS: manejo y almacenamiento de materiales — obligaciones básicas", cat: "NOMs" },
  { topic: "Plan de emergencia y brigadas de seguridad: qué exige la STPS a las PyMEs", cat: "NOMs" },
  { topic: "NOM-035 para empresas con menos de 15 trabajadores: obligaciones mínimas", cat: "NOMs" },
  // Terminación laboral
  { topic: "Las 15 causales de rescisión sin responsabilidad para el patrón (art. 47 LFT)", cat: "Terminación laboral" },
  { topic: "Aviso de rescisión: qué debe decir y en qué plazo entregarlo", cat: "Terminación laboral" },
  { topic: "Trabajador de confianza: diferencias laborales y cómo afecta el despido", cat: "Terminación laboral" },
  { topic: "Renuncia voluntaria vs. rescisión: diferencias que cambian todo el finiquito", cat: "Terminación laboral" },
  { topic: "Abandono de empleo: cómo documentarlo legalmente para no tener responsabilidad", cat: "Terminación laboral" },
  { topic: "Trabajador que se niega a firmar su renuncia: qué puede hacer el patrón", cat: "Terminación laboral" },
  { topic: "Acuerdo de terminación laboral ante el CFCRL: ventajas y cómo formalizarlo", cat: "Terminación laboral" },
  { topic: "Reducción de personal por causas económicas: procedimiento legal correcto", cat: "Terminación laboral" },
  { topic: "Demanda laboral: cómo defenderse y qué documentos necesita desde el primer día", cat: "Terminación laboral" },
  { topic: "Jubilación y pensión IMSS: obligaciones del patrón cuando un trabajador se retira", cat: "Terminación laboral" },
  { topic: "Reinstalación de trabajador por laudo: derechos del patrón y opciones legales", cat: "Terminación laboral" },
];

// ── News/tips topic pool (daily, 300-400 words) ────────────────────────────

const NEWS_TOPIC_POOL = [
  // Tip RH
  { topic: "Tip: cómo registrar correctamente una amonestación verbal sin que se vuelva contra usted", cat: "Tip RH" },
  { topic: "Tip: qué debe decir un acta administrativa para que sea válida ante un juez laboral", cat: "Tip RH" },
  { topic: "Tip: los 5 documentos que todo expediente laboral debe tener antes del mes 3", cat: "Tip RH" },
  { topic: "Tip: cómo comunicar un cambio de turno sin arriesgar una demanda por modificación unilateral", cat: "Tip RH" },
  { topic: "Tip: el error más común al calcular la prima dominical y cómo evitarlo", cat: "Tip RH" },
  { topic: "Tip: cómo formalizar un préstamo al trabajador para descontarlo legalmente de nómina", cat: "Tip RH" },
  { topic: "Tip: cuándo un permiso sin goce de sueldo puede convertirse en un riesgo laboral", cat: "Tip RH" },
  { topic: "Tip: cómo documentar una baja voluntaria para que sea irrefutable en juicio", cat: "Tip RH" },
  { topic: "Tip: qué preguntar y qué no en una entrevista de trabajo para no violar la LFPED", cat: "Tip RH" },
  { topic: "Tip: cómo evitar que las horas extra no documentadas se conviertan en una deuda millonaria", cat: "Tip RH" },
  { topic: "Tip: cómo calcular correctamente la prima vacacional proporcional al momento de una renuncia", cat: "Tip RH" },
  { topic: "Tip: las 3 razones por las que el patrón pierde en juicio aunque el trabajador haya renunciado", cat: "Tip RH" },
  { topic: "Tip: cómo entregar el CFDI de nómina al trabajador — obligaciones y plazos", cat: "Tip RH" },
  // Alerta Legal
  { topic: "Alerta: en 2026 la jornada máxima baja a 46 horas semanales — ¿ya ajustó su nómina?", cat: "Alerta Legal" },
  { topic: "Alerta: el plazo para distribuir PTU vence el 30 de mayo — lo que debe saber", cat: "Alerta Legal" },
  { topic: "Alerta: las multas por no tener Comisión de Seguridad e Higiene actualizada son hasta 435 UMAs", cat: "Alerta Legal" },
  { topic: "Alerta: IMSS puede rechazar CFDI de nómina con errores en RFC — cómo prevenirlo", cat: "Alerta Legal" },
  { topic: "Alerta: el REPSE vence cada 3 años — verifique si su empresa necesita renovarlo", cat: "Alerta Legal" },
  { topic: "Alerta: trabajadores eventuales sin contrato escrito generan presunción de relación laboral indefinida", cat: "Alerta Legal" },
  { topic: "Alerta: las vacaciones no gozadas no prescriben en el año — pueden reclamarse hasta 1 año después", cat: "Alerta Legal" },
  { topic: "Alerta: NOM-035 aplica aunque tenga solo 1 trabajador, aunque con obligaciones mínimas", cat: "Alerta Legal" },
  { topic: "Alerta: los contratos a prueba no pueden prorrogarse — el error podría costarle una liquidación completa", cat: "Alerta Legal" },
  { topic: "Alerta: aguinaldo proporcional es obligatorio incluso si el trabajador renuncia antes de diciembre", cat: "Alerta Legal" },
  { topic: "Alerta: retener documentos del trabajador al terminar la relación laboral es un delito en México", cat: "Alerta Legal" },
  { topic: "Alerta: la cuota patronal al IMSS cambia cuando el trabajador cumple 60 años — verifique su nómina", cat: "Alerta Legal" },
  // Jurisprudencia
  { topic: "Criterio SCJN: mensajes de WhatsApp sí pueden ser prueba en juicio laboral si están bien ofrecidos", cat: "Jurisprudencia" },
  { topic: "Criterio: el patrón pierde el juicio si no entrega copia firmada del contrato al trabajador al inicio", cat: "Jurisprudencia" },
  { topic: "Tesis: el bono discrecional que se paga de forma regular sí integra el salario cotizable al IMSS", cat: "Jurisprudencia" },
  { topic: "Criterio JLCA: periodo de prueba mal documentado se considera contrato por tiempo indeterminado", cat: "Jurisprudencia" },
  { topic: "Criterio: trabajador de confianza degradado a puesto de base puede rescindir sin responsabilidad", cat: "Jurisprudencia" },
  { topic: "Tesis: las cámaras de seguridad en el trabajo son prueba válida solo si el trabajador fue notificado", cat: "Jurisprudencia" },
  { topic: "Criterio: el patrón puede presumir abandono si el trabajador falta más de 3 días sin justificación", cat: "Jurisprudencia" },
  { topic: "Tesis: la carta de renuncia firmada ante dos testigos es prueba suficiente de voluntariedad en juicio", cat: "Jurisprudencia" },
  { topic: "Criterio: el correo corporativo enviado desde dispositivo de empresa es propiedad del patrón", cat: "Jurisprudencia" },
  { topic: "Tesis: el salario en especie no puede superar el 50% del salario total — si lo supera hay incumplimiento", cat: "Jurisprudencia" },
  // Noticias
  { topic: "Reforma 40 horas: impacto real en nómina para una PyME de 20 empleados", cat: "Noticias" },
  { topic: "STPS actualiza plataforma digital para que PyMEs generen su reglamento interior en línea", cat: "Noticias" },
  { topic: "Encuesta: el 58% de PyMEs mexicanas no conoce todas sus obligaciones bajo NOM-037", cat: "Noticias" },
  { topic: "Home office en México: qué prestaciones deben cubrir las empresas según NOM-037", cat: "Noticias" },
  { topic: "IMSS reporta aumento en multas a empresas con trabajadores no registrados en 2025", cat: "Noticias" },
  { topic: "El outsourcing tres años después de la reforma: cómo cambió la relación laboral en México", cat: "Noticias" },
  { topic: "PTU 2025: por qué el cálculo es diferente para empresas de reciente creación", cat: "Noticias" },
  { topic: "Trabajo híbrido y derecho laboral mexicano: qué dice la LFT y qué vacíos legales quedan", cat: "Noticias" },
  // Reforma Laboral
  { topic: "Reforma 40 horas: el calendario exacto de reducción gradual 2026-2030 y cómo prepararse", cat: "Reforma Laboral" },
  { topic: "Reforma de vacaciones 2023: dos años después, lo que aún confunde a los patrones", cat: "Reforma Laboral" },
  { topic: "Subcontratación 2021: qué puede y qué no puede hacer con el REPSE en 2025", cat: "Reforma Laboral" },
  { topic: "Licencia de paternidad en México: la reforma que muchos patrones todavía aplican mal", cat: "Reforma Laboral" },
  { topic: "Reforma de justicia laboral: tres años de nuevos tribunales laborales, qué ha mejorado", cat: "Reforma Laboral" },
  { topic: "Aguinaldo de 30 días: dónde quedó la propuesta legislativa y cuál es la obligación actual", cat: "Reforma Laboral" },
  { topic: "NOM-037 dos años después: qué obligaciones del teletrabajo siguen sin cumplirse en las PyMEs", cat: "Reforma Laboral" },
];

function pickTopic(existingSlugs) {
  const used = new Set(existingSlugs);
  const unused = TOPIC_POOL.filter(t => !used.has(slugify(t.topic)));
  if (unused.length === 0) return TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
  return unused[Math.floor(Math.random() * unused.length)];
}

function pickNews(existingTitles) {
  const usedLower = new Set(existingTitles.map(t => t.toLowerCase()));
  const unused = NEWS_TOPIC_POOL.filter(t => !usedLower.has(t.topic.toLowerCase()));
  if (unused.length === 0) return NEWS_TOPIC_POOL[Math.floor(Math.random() * NEWS_TOPIC_POOL.length)];
  return unused[Math.floor(Math.random() * unused.length)];
}

// ── Claude prompts ─────────────────────────────────────────────────────────

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

function buildNewsPrompt(topic, categoria) {
  return `Eres redactor de noticias laborales para ClickLaboral.mx, dirigido a patrones y directores de RH de PyMEs mexicanas. Escribe una nota corta sobre:

**TEMA:** ${topic}
**CATEGORÍA:** ${categoria}

REQUISITOS:
- Longitud: 280 a 380 palabras de contenido visible (nota breve, no artículo extenso)
- Idioma: español formal mexicano ("su empresa", "el patrón", "el trabajador")
- Tono: informativo, directo, con dato concreto o acción al inicio
- Si es "Tip RH": empezar con el tip accionable en bl-lead, luego el fundamento legal
- Si es "Alerta Legal": empezar con la alerta concreta y cifra específica, luego el contexto
- Si es "Jurisprudencia": mencionar el criterio y qué significa para el patrón en la práctica
- Si es "Noticias" o "Reforma Laboral": dato de impacto para la empresa al inicio
- Incluir exactamente un bloque .bl-info-box (azul, informativo) o .bl-warning-box (amarillo, advertencia) con el punto clave en negrita
- Terminar con un .bl-cta-box con <h3>, <p> y <a href="/diagnostico-cumplimiento.html">Ver ClickLaboral →</a>
- NO incluir tablas (nota corta no las necesita)
- Usar solo artículos LFT, NOMs e instituciones reales

ESTRUCTURA HTML (retorna SOLO el contenido, sin wrapper externo):
- <p class="bl-lead"> apertura directa con el hecho principal (1-2 oraciones)
- 2-3 párrafos <p>
- Un .bl-info-box o .bl-warning-box con el punto clave
- <p> párrafo de cierre con recomendación práctica
- .bl-cta-box al final

RETORNA ÚNICAMENTE el HTML del contenido. Sin explicaciones, sin markdown.`;
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

async function generateNews(topic, categoria) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY no definida');

  const response = await httpsPost('api.anthropic.com', '/v1/messages', {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }, {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildNewsPrompt(topic, categoria) }],
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

// ── Format date ────────────────────────────────────────────────────────────

function fmtFecha(iso) {
  const [y, m, d] = iso.split('-');
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(d)} ${meses[parseInt(m)-1]} ${y}`;
}

// ── Build full article HTML (long-form, with TOC sidebar) ──────────────────

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

  const exc = extractExcerpt(contentHtml).slice(0, 160);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | ClickLaboral.mx</title>
<meta name="description" content="${exc}">
<link rel="canonical" href="https://clicklaboral.mx/blog/${slug}.html">
<link rel="alternate" type="application/rss+xml" title="ClickLaboral.mx Blog" href="/blog/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/blog/blog.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${exc}">
<meta property="og:url" content="https://clicklaboral.mx/blog/${slug}.html">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${title.replace(/"/g, '\\"')}",
  "description": "${exc.replace(/"/g, '\\"')}",
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

// ── Build news HTML (short-form, no sidebar) ───────────────────────────────

function buildNewsHtml({ slug, title, categoria, fecha, contentHtml, relatedPosts }) {
  const related = relatedPosts.slice(0, 2).map(p => `
      <article class="bl-card">
        <div class="bl-card-body">
          <div class="bl-card-cat">${p.categoria}</div>
          <h2><a href="/blog/${p.slug}.html">${p.title}</a></h2>
          <p class="bl-card-exc">${p.excerpt}</p>
          <div class="bl-card-meta"><span>📅 ${fmtFecha(p.fecha)}</span><a href="/blog/${p.slug}.html" class="bl-card-read">Leer →</a></div>
        </div>
      </article>`).join('\n');

  const exc = extractExcerpt(contentHtml).slice(0, 160);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | ClickLaboral.mx</title>
<meta name="description" content="${exc}">
<link rel="canonical" href="https://clicklaboral.mx/blog/${slug}.html">
<link rel="alternate" type="application/rss+xml" title="ClickLaboral.mx Blog" href="/blog/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/blog/blog.css">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${exc}">
<meta property="og:url" content="https://clicklaboral.mx/blog/${slug}.html">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "${title.replace(/"/g, '\\"')}",
  "description": "${exc.replace(/"/g, '\\"')}",
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
    {"@type": "ListItem","position": 3,"name": "Noticias","item": "https://clicklaboral.mx/blog/"},
    {"@type": "ListItem","position": 4,"name": "${title.replace(/"/g, '\\"')}","item": "https://clicklaboral.mx/blog/${slug}.html"}
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <div class="bl-article-cat bl-noticia-badge">📰 Noticia laboral</div>
      <div class="bl-article-cat">${categoria}</div>
    </div>
    <h1>${title}</h1>
    <div class="bl-article-meta">
      <span>📅 <strong>${fmtFecha(fecha)}</strong></span>
      <span>👤 ClickLaboral Editorial</span>
      <span>⏱ Lectura rápida</span>
    </div>
  </header>

  <div class="bl-news-body">
    <div class="bl-content">
${contentHtml}
    </div>
  </div>
</div>

<section class="bl-related">
  <div class="bl-related-inner">
    <h2>También puede interesarle</h2>
    <div class="bl-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-top:0;">
${related}
    </div>
  </div>
</section>

<footer class="bl-footer">
  <p><a href="/">ClickLaboral.mx</a> — Plataforma de compliance laboral para PyMEs mexicanas</p>
  <p style="margin-top:4px;"><a href="/aviso-de-privacidad.html">Aviso de privacidad</a> · <a href="/terminos-de-servicio.html">Términos de servicio</a></p>
  <p style="margin-top:12px;font-size:12px;opacity:.5;">Este contenido es informativo y no constituye asesoría legal.</p>
</footer>

</body>
</html>`;
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

  const cards = posts.map(p => {
    const tipo = p.tipo || 'articulo';
    const isNews = tipo === 'noticia';
    const cardClass = isNews ? 'bl-card bl-card-noticia' : 'bl-card';
    const catLabel = isNews ? `📰 ${p.categoria}` : p.categoria;
    const dataCat = isNews ? 'Noticias' : p.categoria;
    return `
    <!-- ${isNews ? 'NOTICIA' : 'POST'}: ${p.title} -->
    <article class="${cardClass}" data-cat="${dataCat}" data-tipo="${tipo}">
      <div class="bl-card-body">
        <div class="bl-card-cat">${catLabel}</div>
        <h2><a href="/blog/${p.slug}.html">${p.title}</a></h2>
        <p class="bl-card-exc">${p.excerpt}</p>
        <div class="bl-card-meta">
          <span>📅 ${fmtFecha(p.fecha)}</span>
          ${isNews ? '<span>📰 Lectura rápida</span>' : `<span>⏱ ${p.minLectura} min</span>`}
          <a href="/blog/${p.slug}.html" class="bl-card-read">Leer →</a>
        </div>
      </div>
    </article>`;
  }).join('\n');

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
  const blogEntries = posts.map(p => {
    const priority = p.tipo === 'noticia' ? '0.6' : '0.7';
    return `  <url>\n    <loc>https://clicklaboral.mx/blog/${p.slug}.html</loc>\n    <lastmod>${p.fecha}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  }).join('\n');

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

// ── Update blog/rss.xml ────────────────────────────────────────────────────

function updateRssFeed(posts) {
  const file = path.join(ROOT, 'blog', 'rss.xml');

  function xmlEscape(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toRfc822(iso) {
    return new Date(iso + 'T12:00:00Z').toUTCString();
  }

  const items = posts.slice(0, 25).map(p => `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>https://clicklaboral.mx/blog/${p.slug}.html</link>
      <guid isPermaLink="true">https://clicklaboral.mx/blog/${p.slug}.html</guid>
      <pubDate>${toRfc822(p.fecha)}</pubDate>
      <category>${xmlEscape(p.categoria)}</category>
      <description>${xmlEscape(p.excerpt || '')}</description>
    </item>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ClickLaboral.mx — Blog Laboral</title>
    <link>https://clicklaboral.mx/blog/</link>
    <description>Artículos, noticias y tips de compliance laboral para PyMEs mexicanas</description>
    <language>es-MX</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <managingEditor>blog@clicklaboral.mx (ClickLaboral.mx)</managingEditor>
    <atom:link href="https://clicklaboral.mx/blog/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  fs.writeFileSync(file, xml);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let topicOverride = null;
  let catOverride = null;
  let tipo = 'articulo';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic') topicOverride = args[i + 1];
    if (args[i] === '--categoria') catOverride = args[i + 1];
    if (args[i] === '--tipo') tipo = args[i + 1];
  }

  const postsFile = path.join(ROOT, 'blog', 'posts.json');
  const existingPosts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));

  if (tipo === 'noticia') {
    // ── Daily news/tips path ───────────────────────────────────────────────
    const existingNewsTitles = existingPosts
      .filter(p => p.tipo === 'noticia')
      .map(p => p.title);

    const selected = topicOverride
      ? { topic: topicOverride, cat: catOverride || 'Tip RH' }
      : pickNews(existingNewsTitles);

    console.log(`🗞️  Generando noticia: "${selected.topic}" (${selected.cat})`);

    const contentHtml = await generateNews(selected.topic, selected.cat);
    // Slug includes full date (YYYY-MM-DD) to avoid collisions entre años
    const slug = 'noticia-' + slugify(selected.topic).slice(0, 50) + '-' + today();
    const fecha = today();
    const excerpt = extractExcerpt(contentHtml);

    const newPost = {
      slug,
      title: selected.topic,
      excerpt,
      categoria: selected.cat,
      fecha,
      tipo: 'noticia',
      palabrasClave: buildKeywords(selected.topic, selected.cat),
    };

    const newsHtml = buildNewsHtml({
      slug, title: selected.topic, categoria: selected.cat, fecha, contentHtml,
      relatedPosts: existingPosts.filter(p => p.tipo !== 'noticia').slice(0, 2),
    });

    const outFile = path.join(ROOT, 'blog', `${slug}.html`);
    fs.writeFileSync(outFile, newsHtml);
    console.log(`✅ Noticia guardada: blog/${slug}.html`);

    const allPosts = updatePostsJson(newPost);
    console.log(`✅ posts.json actualizado (${allPosts.length} entradas)`);

    updateBlogIndex(allPosts);
    console.log('✅ blog/index.html actualizado');

    updateRssFeed(allPosts);
    console.log('✅ blog/rss.xml actualizado');

    updateSitemap(allPosts);
    console.log('✅ sitemap.xml actualizado');

    console.log(`\n🎉 Noticia lista: blog/${slug}.html`);

  } else {
    // ── Long-form article path (3×/week) ──────────────────────────────────
    const existingSlugs = existingPosts.map(p => p.slug);

    const selected = topicOverride
      ? { topic: topicOverride, cat: catOverride || 'Cumplimiento' }
      : pickTopic(existingSlugs);

    console.log(`📝 Generando artículo: "${selected.topic}" (${selected.cat})`);

    const contentHtml = await generateContent(selected.topic, selected.cat);
    // Slug includes full date (YYYY-MM-DD) to avoid collisions entre años
    const slug = slugify(selected.topic) + '-' + today();
    const fecha = today();
    const minLectura = estimateReadTime(contentHtml);
    const excerpt = extractExcerpt(contentHtml);
    const palabrasClave = buildKeywords(selected.topic, selected.cat);

    const newPost = {
      slug, title: selected.topic, excerpt,
      categoria: selected.cat, fecha, minLectura, palabrasClave,
      tipo: 'articulo',
    };

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

    updateRssFeed(allPosts);
    console.log('✅ blog/rss.xml actualizado');

    updateSitemap(allPosts);
    console.log('✅ sitemap.xml actualizado');

    console.log(`\n🎉 Nuevo artículo listo para commit: blog/${slug}.html`);
  }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
