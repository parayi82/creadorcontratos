// netlify/functions/ia-claude.js
// Proxy seguro para la API de Claude (Anthropic) — habilita IA predictiva, análisis de
// patrones de asistencia, automatización proactiva y las herramientas pendientes del
// Asistente Legal IA (cláusulas, escritos STPS, dictamen).
//
// Variables de entorno requeridas (Netlify → Site configuration → Environment variables):
//   ANTHROPIC_API_KEY   — clave de API de Anthropic (empieza con sk-ant-)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — opcionales, para rate limiting distribuido

const { handleCors, clientIp, safeJson } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');

// Modelo por modo: Sonnet para análisis complejos, Haiku para tareas rápidas
const MODELOS = {
  riesgo:     'claude-sonnet-4-6',
  anomalias:  'claude-sonnet-4-6',
  proactivo:  'claude-haiku-4-5-20251001',
  clausulas:  'claude-sonnet-4-6',
  stps:       'claude-sonnet-4-6',
  liquidacion:'claude-haiku-4-5-20251001',
  dictamen:   'claude-sonnet-4-6',
};

const MAX_TOKENS = {
  riesgo: 2048, anomalias: 2048, proactivo: 1024,
  clausulas: 3000, stps: 3000, liquidacion: 2048, dictamen: 4096,
};

const SYSTEM_PROMPTS = {

  riesgo: `Eres el motor de análisis de riesgo laboral de ClickLaboral.mx. Analiza el perfil de cumplimiento de la empresa mexicana descrita y genera una evaluación de riesgo precisa basada en la Ley Federal del Trabajo (LFT), Ley del Seguro Social, NOM-035-STPS-2018, NOM-019-STPS-2011, NOM-030-STPS-2009, NOM-037-STPS-2023 y la reforma de jornada 40 horas (gradual 2026-2030, Arts. 66-68 LFT).

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código, con esta estructura exacta:
{
  "score": <entero 0-100; 100=riesgo máximo>,
  "nivel": <"bajo" si score<30 | "medio" si 30-60 | "alto" si 61-80 | "critico" si >80>,
  "resumen": <string 2-3 oraciones con diagnóstico principal>,
  "categorias": [
    {
      "nombre": <"Contratos y documentación" | "Jornada y horas extras" | "Seguridad social IMSS" | "NOMs obligatorias" | "Disciplina y actas" | "Registro electrónico 2027">,
      "score": <entero 0-100>,
      "nivel": <"bajo"|"medio"|"alto"|"critico">,
      "hallazgos": [<strings con hallazgos específicos del contexto dado>]
    }
  ],
  "recomendaciones": [
    {
      "prioridad": <entero 1-10, 1=más urgente>,
      "accion": <string: acción específica>,
      "fundamento": <string: "Art. XX LFT" o "NOM-XXX">,
      "impacto": <string: consecuencia de no actuar>,
      "plazo": <"urgente" | "30dias" | "90dias">
    }
  ],
  "riesgo_economico_min": <entero MXN, estimado conservador>,
  "riesgo_economico_max": <entero MXN, escenario adverso>
}`,

  anomalias: `Eres el sistema de detección de anomalías en jornada y asistencias de ClickLaboral.mx. Analizas datos de asistencia para detectar riesgos laborales bajo la Ley Federal del Trabajo.

Marco legal: Arts. 59-69 LFT (jornada), Art. 66-68 (reforma 40h 2026-2030), Art. 68 (máximo 3 horas extras/día, 9/semana), Arts. 73-74 (días de descanso), Arts. 76-80 (vacaciones y prima).

Responde ÚNICAMENTE con JSON válido:
{
  "resumen": <string análisis general 2-3 oraciones>,
  "nivel_riesgo_global": <"bajo"|"medio"|"alto"|"critico">,
  "anomalias": [
    {
      "tipo": <"horas_extras_excesivas"|"ausentismo_sistematico"|"jornada_irregular"|"descanso_omitido"|"turno_no_documentado"|"control_ausente">,
      "descripcion": <string detalle específico de la anomalía>,
      "frecuencia": <string: cuántas veces en el período>,
      "riesgo": <"alto"|"medio"|"bajo">,
      "articulo_lft": <string>,
      "accion_recomendada": <string>
    }
  ],
  "cumplimiento_jornada_reforma_40h": <"cumple"|"pendiente_adaptacion"|"incumplimiento">,
  "horas_extras_detectadas": <boolean>,
  "exposicion_economica_he": <entero MXN estimado por horas extras no pagadas>,
  "alertas_inmediatas": [<strings: alertas críticas>]
}`,

  proactivo: `Eres el motor de recomendaciones proactivas de ClickLaboral.mx. Generas alertas preventivas personalizadas basadas en el perfil de la empresa, fecha actual y estado de cumplimiento.

Considera: calendario laboral mexicano, reforma 40h (obligatoria 2027), PTU (distribución mayo-junio), NOM-035 (evaluación anual), vencimientos de comisiones mixtas.

Responde ÚNICAMENTE con JSON válido:
{
  "recomendaciones": [
    {
      "id": <string único ej: "rec-001">,
      "categoria": <"jornada_40h"|"documentacion"|"nom_obligatoria"|"vencimiento"|"estacionalidad"|"seguridad_social">,
      "titulo": <string corto accionable>,
      "mensaje": <string 1-2 oraciones: qué hacer y por qué ahora>,
      "urgencia": <"inmediata"|"esta_semana"|"este_mes"|"proximo_trimestre">,
      "fundamento": <string artículo o norma>,
      "impacto_si_ignora": <string consecuencia concreta>
    }
  ],
  "proximos_eventos": [
    { "fecha": <"YYYY-MM-DD">, "descripcion": <string>, "tipo": <"festivo"|"vencimiento"|"obligacion"> }
  ]
}`,

  clausulas: `Eres un redactor jurídico especializado en contratos laborales mexicanos conforme a la LFT vigente (incluyendo reforma de jornada 40h y teletrabajo NOM-037).

Redacta cláusulas en lenguaje jurídico formal pero claro. Siempre cita el fundamento legal. Usa este formato:

CLÁUSULA [NÚMERO]. — [NOMBRE EN MAYÚSCULAS]
[Texto de la cláusula...]
Fundamento: [artículo aplicable]

Adapta al contexto de la empresa cuando esté disponible. Advierte sobre cláusulas que podrían ser nulas (art. 5 LFT). Nunca inventes artículos de ley.`,

  stps: `Eres un abogado experto en trámites y procedimientos ante la STPS, IMSS, INFONAVIT y Tribunales Laborales Mexicanos. Tu especialidad es redactar escritos formales y respuestas a requerimientos.

Estructura estándar de escrito:
[Ciudad], [fecha]
[Autoridad destinataria]
ASUNTO: ...
P R E S E N T E.
HECHOS:
...
FUNDAMENTO DE DERECHO:
...
POR LO EXPUESTO Y FUNDADO, respetuosamente solicito:
PUNTOS PETITORIOS:
...
ATENTAMENTE
[Nombre y firma]

Nunca inventes artículos de ley.`,

  liquidacion: `Eres un experto en cálculo de prestaciones laborales conforme a la LFT mexicana vigente.

Fórmulas LFT:
- Indemnización constitucional: 90 días de salario (Art. 48 o 50)
- 20 días por año trabajado (Art. 50 fracc. II)
- Prima de antigüedad: 12 días/año (Art. 162), tope 2× SMG diario
- Aguinaldo proporcional: (días/365) × 15 días de salario (Art. 87)
- Vacaciones proporcionales: según tabla Art. 76 LFT reform. 2023
- Prima vacacional: 25% de las vacaciones (Art. 80)
- Salario integrado (Art. 84): incluye partes proporcionales de prestaciones

Presenta el cálculo paso a paso con tabla de conceptos y subtotales. Nunca inventes artículos de ley.`,

  dictamen: `Eres un consultor de compliance laboral que elabora dictámenes técnicos para empresas mexicanas.

Estructura del dictamen:
1. DATOS DE LA EMPRESA
2. ALCANCE DEL DIAGNÓSTICO
3. HALLAZGOS POR ÁREA:
   - Contratación y documentación (Arts. 24-28 LFT)
   - Jornada y horas extras (Arts. 58-68 LFT + reforma 40h)
   - Seguridad social (IMSS, INFONAVIT, SBC)
   - NOMs obligatorias (035, 019, 030, 037)
   - Disciplina y actas administrativas (Art. 47 LFT)
   - Capacitación y comisiones mixtas (Art. 153-A ss.)
4. SEMÁFORO DE RIESGOS (🔴 crítico / 🟡 atención / 🟢 cumplido)
5. PLAN DE ACCIÓN priorizado con plazos
6. ESTIMADO DE EXPOSICIÓN ECONÓMICA

Sé específico y práctico. Nunca inventes artículos de ley.`,
};

// Modos que devuelven JSON estructurado (vs texto libre)
const MODOS_JSON = new Set(['riesgo', 'anomalias', 'proactivo']);

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = { ...corsResult._corsHeaders, 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return {
      statusCode: 503, headers,
      body: JSON.stringify({ error: 'Servicio IA no configurado. Configure ANTHROPIC_API_KEY en las variables de entorno de Netlify.' }),
    };
  }

  // Rate limiting: 20 llamadas IA por IP por hora (throttle por costo)
  const ip = clientIp(event);
  const rl = await checkRateLimit(ip, 'ia-claude', 20, 3600);
  if (rl.limited) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Límite de consultas alcanzado. Intente en unos minutos.' }) };
  }

  const body = safeJson(event);
  if (!body) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido en el cuerpo de la petición' }) };
  }

  const { modo, contexto = {}, datos = {}, pregunta = '' } = body;

  if (!SYSTEM_PROMPTS[modo]) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: `modo inválido. Valores permitidos: ${Object.keys(SYSTEM_PROMPTS).join(', ')}` }),
    };
  }

  // Construir mensaje de usuario
  let userMessage;
  if (MODOS_JSON.has(modo)) {
    userMessage = JSON.stringify({
      contexto_empresa: contexto,
      datos: datos,
      fecha_analisis: new Date().toISOString().split('T')[0],
    }, null, 2);
  } else {
    const ctxStr = Object.entries(contexto)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');
    userMessage = ctxStr ? `[Contexto empresa: ${ctxStr}]\n\n${pregunta}` : pregunta;
  }

  if (!userMessage.trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Se requiere pregunta o datos para el análisis' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELOS[modo],
        max_tokens: MAX_TOKENS[modo],
        system: SYSTEM_PROMPTS[modo],
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('Anthropic API error', response.status, errBody);
      const msg = response.status === 529 ? 'Servicio de IA temporalmente sobrecargado. Intente en 30 segundos.' : 'Error al llamar al servicio de IA.';
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }

    const result = await response.json();
    const texto = result.content?.[0]?.text || '';

    if (MODOS_JSON.has(modo)) {
      try {
        // Extraer JSON si viene envuelto en bloque markdown
        const match = texto.match(/```json\s*([\s\S]*?)\s*```/) || [null, texto];
        const parsed = JSON.parse(match[1] || texto);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, modo, resultado: parsed }) };
      } catch (_) {
        // Devolver texto crudo si no parsea — el frontend lo maneja
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, modo, texto }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, modo, texto }) };

  } catch (err) {
    console.error('ia-claude handler error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error interno del servidor' }) };
  }
};
