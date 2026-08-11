#!/usr/bin/env node
/**
 * generate-linkedin-post.js
 * Genera y publica diariamente en LinkedIn contenido de valor para ClickLaboral.mx.
 * Audiencias rotativas: reclutadores, contadores, abogados, patrones.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY      — Claude API key (GitHub Secret)
 *   LINKEDIN_ACCESS_TOKEN  — OAuth 2.0 token (GitHub Secret, válido 60 días)
 *   LINKEDIN_AUTHOR_URN    — urn:li:person:XXX  o  urn:li:organization:XXX
 *
 * Optional:
 *   DRY_RUN=true           — genera contenido pero NO publica en LinkedIn
 *   AUDIENCE=reclutadores  — fuerza una audiencia específica
 *   TOPIC="texto del tema" — fuerza un tema específico
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ─── Configuración ────────────────────────────────────────────────────────────

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const DRY_RUN      = process.env.DRY_RUN === 'true';

// Mapeo día de semana → audiencia (0=Dom, 1=Lun, …, 5=Vie, 6=Sáb)
const AUDIENCE_BY_DAY = {
  0: 'patrones',      // Dom — publicación especial fin de semana
  1: 'reclutadores',  // Lun — inicio de semana, RRHH activo
  2: 'contadores',    // Mar
  3: 'abogados',      // Mié
  4: 'patrones',      // Jue
  5: 'reclutadores',  // Vie — segunda rotación semanal
  6: 'contadores',    // Sáb
};

// ─── Pools de temas por audiencia ────────────────────────────────────────────

const TOPICS = {
  reclutadores: [
    'Periodo de prueba en México: duración legal, qué cubre y cómo documentarlo correctamente',
    'Contrato por tiempo indeterminado vs. determinado: cuándo usar cada uno y el riesgo de equivocarse',
    'Checklist del expediente del trabajador: los documentos obligatorios según la LFT',
    'Carta oferta vs. contrato de trabajo: diferencias legales que todo reclutador debe conocer',
    'NOM-035: qué debe hacer Recursos Humanos antes de contratar a un nuevo empleado',
    'Cómo documentar una renuncia voluntaria para que sea irrefutable en un juicio laboral',
    'Contratos para trabajo remoto/home office en México: qué debe incluir según la NOM-037',
    'Periodo de capacitación inicial: derechos y obligaciones del patrón y del trabajador',
    'Cómo evitar demandas laborales desde el primer día de la contratación',
    'Tablas de salario mínimo 2025: zonas geográficas y salarios mínimos profesionales',
    'Trabajadores de confianza vs. sindicalizados: diferencias contractuales que cambian todo',
    'Contratación de extranjeros en México: permisos, restricciones y requisitos de la LFT',
    'Actas administrativas durante el período de evaluación: cuándo y cómo aplicarlas',
    'Contrato de capacitación inicial: cuándo sustituye al periodo de prueba y cómo redactarlo',
    'Registro del contrato de trabajo: obligaciones del patrón y del sindicato ante la STPS',
  ],

  contadores: [
    'PTU 2025: fecha límite, cómo calcularla correctamente y quiénes tienen derecho',
    'Aguinaldo: cálculo exacto, fecha de pago y multas por incumplimiento en 2025',
    'Prima vacacional: porcentaje mínimo, base de cálculo y cuándo pagarla según la LFT',
    'Cuotas patronales IMSS 2025: tabla actualizada y cómo calcular sin errores',
    'INFONAVIT 2025: porcentaje de aportación y cómo afecta la nómina de la empresa',
    'Horas extra: límite legal, factor de pago doble/triple y contingencias fiscales que evitar',
    'Prima de antigüedad: cuándo se paga, a quién aplica y cómo calcularla',
    'CFDI de nómina 4.0: los 7 errores más comunes y cómo corregirlos antes de que llegue el SAT',
    'Deducción de nómina: qué conceptos son 100% deducibles para el patrón en 2025',
    'Liquidación vs. finiquito: diferencias fiscales y cómo calcular cada uno correctamente',
    'ISR de nómina: subsidio al empleo, tablas 2025 y cómo aplicar el cálculo mensual',
    'Propinas: tratamiento fiscal, cómo integran el salario cotizable al IMSS y obligaciones',
    'Prima de riesgo IMSS: cómo determinarla, declararla y reducirla con buenas prácticas',
    'Vales de despensa, seguro de gastos médicos y fondos de ahorro: impacto en IMSS e ISR',
    'Bimestral IMSS vs. mensual CFDI: cómo cuadrar ambas obligaciones sin errores de dispersión',
  ],

  abogados: [
    'Acta administrativa: requisitos formales que la hacen válida ante el Tribunal Laboral',
    'Rescisión sin responsabilidad patronal: causales del Art. 47 LFT y carga de la prueba',
    'Fuero sindical: titulares protegidos, alcance de la protección y cómo tramitar la exclusión',
    'Convenio de terminación laboral homologado: requisitos para que sea válido y ejecutable',
    'Subcontratación post-reforma 2021: qué servicios especializados siguen siendo legales',
    'Teletrabajo en México: obligaciones patronales del Art. 330-A al 330-K de la LFT',
    'NOM-035: responsabilidad patronal ante incumplimiento y montos reales de multas STPS',
    'Prescripción de acciones laborales: plazos actualizados y cómo computarlos correctamente',
    'Accidente de trabajo vs. enfermedad profesional: diferencias legales y consecuencias',
    'Huelga: requisitos de emplazamiento, calificación por el Tribunal y efectos para el patrón',
    'Reglamento Interior de Trabajo: contenido obligatorio y proceso de registro ante la STPS',
    'Despido justificado: qué documentación mínima necesita para ganar en sede arbitral',
    'Comisiones mixtas obligatorias: cuáles son, cómo integrarlas y consecuencias de omitirlas',
    'Contratos colectivos: vigencia, revisión, depositación y cláusulas esenciales en 2025',
    'Tercerización de servicios especializados y REPSE: obligaciones del contratante y contratista',
  ],

  patrones: [
    'Multas STPS 2025: las 10 infracciones más costosas y qué documentos las evitan',
    'Inspección STPS sorpresiva: los documentos que debes tener listos antes de que lleguen',
    'Comisiones mixtas obligatorias: cuáles son, cuándo instalarlas y qué pasa si no las tienes',
    'Reglamento Interior de Trabajo: por qué es tu mejor defensa ante una demanda laboral',
    'Costo real de un despido: cómo calcularlo antes de tomar la decisión para no quebrarte',
    'Aguinaldo sin liquidez: opciones legales para PyMEs que no pueden pagar en diciembre',
    'Calendario de días de descanso obligatorio 2025: qué pasa si el trabajador trabaja ese día',
    'Vacaciones y prima vacacional: los 5 errores más caros que cometen los patrones mexicanos',
    'Accidente de trabajo en tu empresa: qué hacer en las primeras 24 horas para no perder el juicio',
    'Check-up de cumplimiento laboral: 15 preguntas que debes responder hoy mismo',
    'Outsourcing 2025: cómo contratar servicios especializados sin violar la Ley Federal del Trabajo',
    'Trabajadores del hogar: obligación de asegurarlos al IMSS, montos y cómo darte de alta',
    'Trabajo por obra o proyecto en México: cuándo es legal, cuándo no, y cómo documentarlo',
    'Prima de riesgo IMSS: cómo reducirla y ahorrar miles de pesos al año con un plan de seguridad',
    'NOM-035 para PyMEs: qué obligaciones aplican si tienes entre 1 y 50 trabajadores',
  ],
};

// ─── Descripciones de audiencia para el prompt ───────────────────────────────

const AUDIENCE_CONTEXT = {
  reclutadores: {
    descripcion: 'reclutadores, gerentes de Recursos Humanos y directores de Capital Humano de empresas mexicanas',
    dolores:     'contratos mal redactados, expedientes incompletos, actas administrativas inválidas, demandas laborales por errores en la contratación',
    cta:         'Genera contratos laborales correctos y expedientes digitales en minutos — prueba gratis en',
    utm:         'reclutadores',
  },
  contadores: {
    descripcion: 'contadores públicos, administradores de nómina y CFOs de PyMEs mexicanas',
    dolores:     'errores en el cálculo de nómina, multas IMSS y SAT, CFDI de nómina con errores, discrepancias fiscales',
    cta:         'Automatiza el cumplimiento laboral de tus clientes y evita multas — explora ClickLaboral.mx en',
    utm:         'contadores',
  },
  abogados: {
    descripcion: 'abogados laboralistas, asesores legales empresariales y socios de despachos laborales en México',
    dolores:     'clientes sin documentación laboral, pérdida de juicios por falta de actas, contratos sin cláusulas clave',
    cta:         'Equipa a tus clientes para que tengan toda la documentación laboral lista antes del juicio — conoce el panel para despachos en',
    utm:         'abogados',
  },
  patrones: {
    descripcion: 'dueños de PyMEs, directores generales y gerentes administrativos de empresas mexicanas',
    dolores:     'multas STPS inesperadas, demandas laborales, costos ocultos de nómina, inspecciones sin preparación',
    cta:         'Haz el diagnóstico de cumplimiento laboral de tu empresa gratis — sin tarjeta de crédito — en',
    utm:         'patrones',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function httpsPost(hostname, reqPath, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, port: 443, path: reqPath, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(raw ? JSON.parse(raw) : {});
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getWeekNumber(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
}

function selectAudienceAndTopic() {
  const now    = new Date();
  const day    = now.getDay();
  const week   = getWeekNumber(now);
  const date   = now.toISOString().slice(0, 10);

  // Audiencia forzada por env var o rotación por día de semana
  const audience = process.env.AUDIENCE || AUDIENCE_BY_DAY[day] || 'patrones';
  const pool     = TOPICS[audience];

  // Forzar tema por env var, o rotar por semana del año dentro del pool
  const topic = process.env.TOPIC || pool[(week - 1) % pool.length];

  return { audience, topic, date, week };
}

// ─── Generación de contenido con Claude ──────────────────────────────────────

async function generatePost(audience, topic) {
  const ctx = AUDIENCE_CONTEXT[audience];
  const url = `https://clicklaboral.mx/?utm_source=linkedin&utm_medium=social&utm_campaign=organic&utm_content=${ctx.utm}`;

  const prompt = `Eres el community manager de ClickLaboral.mx, la plataforma mexicana de referencia para el cumplimiento laboral de PyMEs.

AUDIENCIA OBJETIVO: ${ctx.descripcion}
Sus principales dolores profesionales: ${ctx.dolores}

TEMA DEL POST: ${topic}

INSTRUCCIONES PARA EL POST DE LINKEDIN:

1. PRIMERA LÍNEA (el gancho): Pregunta retórica poderosa, dato impactante o afirmación que genere urgencia. Máximo 15 palabras. Sin emojis en esta línea.

2. CUERPO (150-200 palabras en 2-3 párrafos):
   - Desarrolla el tema con datos específicos y vigentes: artículos de la LFT, montos reales de multas STPS en UMAs, plazos del IMSS/SAT, etc.
   - Usa español mexicano formal pero accesible ("el patrón", "la empresa", "su nómina")
   - En el último párrafo menciona ClickLaboral.mx de forma NATURAL como herramienta que resuelve el problema descrito (no como anuncio)

3. CALL TO ACTION (1 línea):
   "${ctx.cta} ${url}"

4. HASHTAGS (4-6 al final, en una sola línea):
   Relevantes al tema y la audiencia, incluir siempre #ClickLaboralmx

REGLAS ABSOLUTAS:
- Máximo 2 emojis en todo el post (✅ ⚠️ 📊 — solo si añaden valor)
- NO uses listas con guiones ni bullet points (párrafos fluidos)
- NO inventes artículos de ley; si no estás seguro del número exacto, describe el principio
- El post completo debe tener entre 200-270 palabras (sin contar hashtags)
- Deja una línea vacía entre párrafos

RETORNA ÚNICAMENTE el texto del post, listo para copiar y pegar en LinkedIn. Sin explicaciones previas.`;

  const response = await httpsPost('api.anthropic.com', '/v1/messages', {
    'x-api-key':          process.env.ANTHROPIC_API_KEY,
    'anthropic-version':  '2023-06-01',
    'content-type':       'application/json',
  }, {
    model:      CLAUDE_MODEL,
    max_tokens: 700,
    messages:   [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

// ─── LinkedIn API (UGC Posts) ─────────────────────────────────────────────────

async function publishToLinkedIn(postText) {
  const body = {
    author:         process.env.LINKEDIN_AUTHOR_URN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary:    { text: postText },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  return httpsPost('api.linkedin.com', '/v2/ugcPosts', {
    'Authorization':              `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
    'Content-Type':               'application/json',
    'X-Restli-Protocol-Version':  '2.0.0',
  }, body);
}

// ─── Registro de posts publicados ────────────────────────────────────────────

function logPost({ date, audience, topic, postId, postUrl, postText }) {
  const logFile = path.join(ROOT, 'linkedin-posts-log.json');
  let log = [];
  if (fs.existsSync(logFile)) {
    try { log = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (_) { log = []; }
  }
  log.unshift({ date, audience, topic, postId, postUrl, preview: postText.slice(0, 100) + '…' });
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no definida');
  if (!DRY_RUN && !process.env.LINKEDIN_ACCESS_TOKEN) throw new Error('LINKEDIN_ACCESS_TOKEN no definida');
  if (!DRY_RUN && !process.env.LINKEDIN_AUTHOR_URN)   throw new Error('LINKEDIN_AUTHOR_URN no definida');

  const { audience, topic, date, week } = selectAudienceAndTopic();

  console.log('─────────────────────────────────────────────────');
  console.log(`📅 Fecha:     ${date}  (semana ${week})`);
  console.log(`🎯 Audiencia: ${audience}`);
  console.log(`📝 Tema:      ${topic}`);
  if (DRY_RUN) console.log('🔵 Modo DRY RUN — no se publicará en LinkedIn');
  console.log('─────────────────────────────────────────────────');

  console.log('\n⏳ Generando contenido con Claude...\n');
  const postText = await generatePost(audience, topic);

  console.log('── Contenido generado ───────────────────────────');
  console.log(postText);
  console.log('─────────────────────────────────────────────────');
  console.log(`\n📊 Palabras: ${postText.split(/\s+/).filter(Boolean).length}`);

  if (DRY_RUN) {
    console.log('\n✅ DRY RUN completo — contenido generado pero no publicado.');
    return;
  }

  console.log('\n⏳ Publicando en LinkedIn...');
  const result  = await publishToLinkedIn(postText);
  const postId  = result.id || result.value || 'unknown';
  const postUrl = `https://www.linkedin.com/feed/update/${postId}/`;

  console.log(`✅ Publicado en LinkedIn`);
  console.log(`🔗 URL: ${postUrl}`);

  logPost({ date, audience, topic, postId, postUrl, postText });
  console.log('📋 Registro guardado en linkedin-posts-log.json');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
