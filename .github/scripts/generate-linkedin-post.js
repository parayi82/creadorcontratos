#!/usr/bin/env node
/**
 * generate-linkedin-post.js
 * Genera contenido diario de LinkedIn para ClickLaboral.mx y lo envía por email
 * listo para copiar y pegar. Sin API de LinkedIn — cero configuración extra.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY   — Claude API key (GitHub Secret)
 *   RESEND_API_KEY      — Resend API key (mismo que usa Netlify, añadir a GitHub Secrets)
 *   NOTIFY_EMAIL        — Email destino del post diario (ej: serjuemsa@gmail.com)
 *
 * Optional:
 *   DRY_RUN=true        — genera contenido y lo imprime pero NO envía email
 *   AUDIENCE=reclutadores — fuerza una audiencia específica
 *   TOPIC="texto"       — fuerza un tema específico
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ─── Config ───────────────────────────────────────────────────────────────────

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const DRY_RUN      = process.env.DRY_RUN === 'true';

// Audiencia rotativa por día de semana (0=Dom … 6=Sáb)
const AUDIENCE_BY_DAY = {
  0: 'patrones',
  1: 'reclutadores',
  2: 'contadores',
  3: 'abogados',
  4: 'patrones',
  5: 'reclutadores',
  6: 'contadores',
};

// ─── Pool de temas por audiencia (60 temas totales) ──────────────────────────

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

// ─── Contexto por audiencia ───────────────────────────────────────────────────

const AUDIENCE_CONTEXT = {
  reclutadores: {
    label:    'Reclutadores / RH',
    desc:     'reclutadores, gerentes de Recursos Humanos y directores de Capital Humano de empresas mexicanas',
    dolores:  'contratos mal redactados, expedientes incompletos, actas administrativas inválidas, demandas por errores en contratación',
    cta:      'Genera contratos laborales correctos y expedientes digitales en minutos — prueba gratis en https://clicklaboral.mx/?utm_source=linkedin&utm_medium=social&utm_campaign=organic&utm_content=reclutadores',
    hashtags: '#RecursosHumanos #RRHH #Reclutamiento #ContratosLaborales #LeyFederalDelTrabajo #TalentoHumano #CumplimientoLaboral #ClickLaboralmx',
  },
  contadores: {
    label:    'Contadores / Nómina',
    desc:     'contadores públicos, administradores de nómina y CFOs de PyMEs mexicanas',
    dolores:  'errores en cálculo de nómina, multas IMSS y SAT, CFDI con errores, discrepancias fiscales',
    cta:      'Automatiza el cumplimiento laboral de tus clientes — explora ClickLaboral.mx en https://clicklaboral.mx/?utm_source=linkedin&utm_medium=social&utm_campaign=organic&utm_content=contadores',
    hashtags: '#Nómina #Contabilidad #IMSS #INFONAVIT #PTU #Aguinaldo #CFDINomina #CumplimientoFiscal #ClickLaboralmx',
  },
  abogados: {
    label:    'Abogados Laboralistas',
    desc:     'abogados laboralistas, asesores legales empresariales y socios de despachos en México',
    dolores:  'clientes sin documentación laboral, pérdida de juicios por falta de actas, contratos sin cláusulas clave',
    cta:      'Equipa a tus clientes con documentación laboral impecable — conoce el panel para despachos en https://clicklaboral.mx/?utm_source=linkedin&utm_medium=social&utm_campaign=organic&utm_content=abogados',
    hashtags: '#DerechoLaboral #AbogadoLaboral #LFT #ReformaLaboral #ComplianceMéxico #DerechoEmpresarial #ClickLaboralmx',
  },
  patrones: {
    label:    'Patrones / Dueños de PyME',
    desc:     'dueños de PyMEs, directores generales y gerentes administrativos de empresas mexicanas',
    dolores:  'multas STPS inesperadas, demandas laborales, costos ocultos de nómina, inspecciones sin preparación',
    cta:      'Haz el diagnóstico de cumplimiento laboral de tu empresa gratis — sin tarjeta — en https://clicklaboral.mx/?utm_source=linkedin&utm_medium=social&utm_campaign=organic&utm_content=patrones',
    hashtags: '#PyME #Emprendimiento #GestiónEmpresarial #STPS #CumplimientoLaboral #DerechoEmpresarial #ClickLaboralmx',
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
  const now     = new Date();
  const day     = now.getDay();
  const week    = getWeekNumber(now);
  const date    = now.toISOString().slice(0, 10);
  const audience = process.env.AUDIENCE || AUDIENCE_BY_DAY[day] || 'patrones';
  const pool    = TOPICS[audience];
  const topic   = process.env.TOPIC || pool[(week - 1) % pool.length];
  return { audience, topic, date, week };
}

// ─── Generación de contenido con Claude ──────────────────────────────────────

async function generatePost(audience, topic) {
  const ctx = AUDIENCE_CONTEXT[audience];

  const prompt = `Eres el community manager de ClickLaboral.mx, la plataforma mexicana de referencia para el cumplimiento laboral de PyMEs.

AUDIENCIA OBJETIVO: ${ctx.desc}
Sus principales dolores profesionales: ${ctx.dolores}

TEMA DEL POST: ${topic}

INSTRUCCIONES:

1. PRIMERA LÍNEA (gancho): Pregunta retórica poderosa, dato impactante o afirmación que genere urgencia. Máximo 15 palabras. Sin emojis en esta línea.

2. CUERPO (150-200 palabras en 2-3 párrafos separados por línea vacía):
   - Desarrolla el tema con datos específicos y vigentes: artículos de la LFT, montos reales de multas STPS en UMAs, plazos del IMSS/SAT 2025
   - Usa español mexicano formal pero accesible ("el patrón", "la empresa", "su nómina")
   - En el último párrafo menciona ClickLaboral.mx de forma NATURAL como herramienta que resuelve el problema (no como anuncio forzado)

3. CALL TO ACTION (1 sola línea):
   "${ctx.cta}"

4. HASHTAGS: escribe exactamente estos en una sola línea al final:
   ${ctx.hashtags}

REGLAS:
- Máximo 2 emojis en todo el post (✅ ⚠️ 📊 — solo si añaden valor real)
- NO uses listas con guiones ni bullet points — párrafos fluidos únicamente
- NO inventes artículos de ley; si no estás seguro del número, describe el principio
- El post debe tener entre 200-270 palabras (sin contar hashtags)
- Deja una línea vacía entre párrafos

Retorna ÚNICAMENTE el texto del post, sin explicaciones previas ni comillas alrededor.`;

  const response = await httpsPost('api.anthropic.com', '/v1/messages', {
    'x-api-key':         process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
  }, {
    model:    CLAUDE_MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

// ─── Email via Resend ─────────────────────────────────────────────────────────

function buildEmailHtml({ audience, topic, date, week, postText }) {
  const ctx        = AUDIENCE_CONTEXT[audience];
  const wordCount  = postText.split(/\s+/).filter(Boolean).length;
  const textLines  = postText.split('\n').map(l =>
    `<p style="margin:0 0 10px;white-space:pre-wrap;">${l || '&nbsp;'}</p>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
<div style="max-width:620px;margin:32px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

  <!-- Cabecera -->
  <div style="background:#1a1a2e;padding:28px 32px;">
    <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">Click<span style="color:#f97316;">Laboral.mx</span></p>
    <p style="margin:6px 0 0;color:#94a3b8;font-size:14px;">Post de LinkedIn generado automáticamente</p>
  </div>

  <!-- Metadatos -->
  <div style="background:#f8fafc;padding:16px 32px;border-bottom:1px solid #e2e8f0;">
    <table style="width:100%;font-size:13px;color:#475569;border-collapse:collapse;">
      <tr>
        <td style="padding:4px 0;width:110px;font-weight:bold;">📅 Fecha</td>
        <td style="padding:4px 0;">${date} (semana ${week})</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-weight:bold;">🎯 Audiencia</td>
        <td style="padding:4px 0;">${ctx.label}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-weight:bold;">📝 Tema</td>
        <td style="padding:4px 0;">${topic}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-weight:bold;">📊 Palabras</td>
        <td style="padding:4px 0;">${wordCount} palabras</td>
      </tr>
    </table>
  </div>

  <!-- Instrucciones -->
  <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:14px 32px;font-size:13px;color:#1e40af;">
    <strong>Cómo publicar (30 segundos):</strong>
    <ol style="margin:6px 0 0;padding-left:18px;line-height:1.8;">
      <li>Copia el texto del recuadro de abajo</li>
      <li>Ve a <a href="https://www.linkedin.com/feed/" style="color:#2563eb;">linkedin.com</a> y haz click en <strong>"Comenzar una publicación"</strong></li>
      <li>Pega el texto y haz click en <strong>Publicar</strong></li>
    </ol>
  </div>

  <!-- Texto del post -->
  <div style="background:#ffffff;padding:28px 32px;">
    <p style="margin:0 0 16px;font-size:13px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Texto del post:</p>
    <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:8px;padding:20px 24px;font-size:15px;line-height:1.7;color:#1e293b;">
      ${textLines}
    </div>
  </div>

  <!-- Nota -->
  <div style="background:#fefce8;border-top:1px solid #fde68a;padding:12px 32px;font-size:12px;color:#92400e;">
    💡 <strong>Tip:</strong> Publica entre 8–10am o 12–2pm hora de Ciudad de México para mayor alcance.
    El algoritmo de LinkedIn favorece los primeros 60 minutos — responde cualquier comentario pronto.
  </div>

  <!-- Footer -->
  <div style="background:#1a1a2e;padding:20px 32px;text-align:center;">
    <p style="margin:0;color:#94a3b8;font-size:12px;">
      ClickLaboral.mx — Sistema de contenido automático para LinkedIn<br>
      <a href="https://clicklaboral.mx" style="color:#f97316;text-decoration:none;">clicklaboral.mx</a>
    </p>
  </div>

</div>
</body>
</html>`;
}

async function sendEmail({ audience, topic, date, week, postText }) {
  const ctx     = AUDIENCE_CONTEXT[audience];
  const to      = process.env.NOTIFY_EMAIL || 'serjuemsa@gmail.com';
  const subject = `LinkedIn hoy — ${ctx.label} | ${date}`;
  const html    = buildEmailHtml({ audience, topic, date, week, postText });

  await httpsPost('api.resend.com', '/emails', {
    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type':  'application/json',
  }, {
    from:    'ClickLaboral <alertas@clicklaboral.mx>',
    to:      [to],
    subject,
    html,
  });
}

// ─── Log de publicaciones ────────────────────────────────────────────────────

function logPost({ date, audience, topic, postText }) {
  const logFile = path.join(ROOT, 'linkedin-posts-log.json');
  let log = [];
  if (fs.existsSync(logFile)) {
    try { log = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (_) { log = []; }
  }
  log.unshift({ date, audience, topic, preview: postText.slice(0, 120) + '…' });
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no definida');
  if (!DRY_RUN && !process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY no definida');

  const { audience, topic, date, week } = selectAudienceAndTopic();

  console.log('─────────────────────────────────────────────────');
  console.log(`📅 Fecha:     ${date}  (semana ${week})`);
  console.log(`🎯 Audiencia: ${AUDIENCE_CONTEXT[audience].label}`);
  console.log(`📝 Tema:      ${topic}`);
  if (DRY_RUN) console.log('🔵 Modo DRY RUN — no se enviará email');
  console.log('─────────────────────────────────────────────────');

  console.log('\n⏳ Generando contenido con Claude...\n');
  const postText = await generatePost(audience, topic);

  console.log('── Contenido generado ───────────────────────────');
  console.log(postText);
  console.log('─────────────────────────────────────────────────');
  console.log(`\n📊 Palabras: ${postText.split(/\s+/).filter(Boolean).length}`);

  if (DRY_RUN) {
    console.log('\n✅ DRY RUN completo — contenido generado, email no enviado.');
    return;
  }

  console.log('\n⏳ Enviando email con Resend...');
  await sendEmail({ audience, topic, date, week, postText });
  console.log(`✅ Email enviado a ${process.env.NOTIFY_EMAIL || 'serjuemsa@gmail.com'}`);

  logPost({ date, audience, topic, postText });
  console.log('📋 Registro guardado en linkedin-posts-log.json');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
