// netlify/functions/whatsapp-bot.js
//
// WhatsApp Cloud API webhook — bot de ventas ClickLaboral.mx
//
// Variables de entorno requeridas (Netlify UI → Environment variables):
//   WHATSAPP_TOKEN        — Bearer token de la WhatsApp Business API (permanente)
//   WHATSAPP_PHONE_ID     — ID del número de teléfono de la app de Meta
//   WHATSAPP_VERIFY_TOKEN — Token aleatorio para verificar el webhook en Meta
//   WHATSAPP_ASESOR_TEL   — Número del asesor (ej: 5213339263817) — recibe aviso de leads
//   SUPABASE_URL          — URL del proyecto Supabase
//   SUPABASE_SERVICE_KEY  — Clave service_role (nunca exponer al cliente)
//
// Registrar webhook en Meta App Dashboard:
//   URL: https://clicklaboral.mx/.netlify/functions/whatsapp-bot
//   Verify token: valor de WHATSAPP_VERIFY_TOKEN
//   Suscribirse a: messages

'use strict';

const https = require('https');

// ─── Catálogo de planes ──────────────────────────────────────────────────────
const PLANES = {
  micro:   { nombre:'Micro',   precio:899,   trab:'1-15',   link:'https://clicklaboral.mx/checkout.html?plan=micro',   tickets:1 },
  pyme:    { nombre:'PyME',    precio:1999,  trab:'16-50',  link:'https://clicklaboral.mx/checkout.html?plan=pyme',    tickets:3 },
  mediana: { nombre:'Mediana', precio:4499,  trab:'51-150', link:'https://clicklaboral.mx/checkout.html?plan=mediana', tickets:5 },
  empresa: { nombre:'Empresa', precio:9999,  trab:'151-500',link:'https://clicklaboral.mx/checkout.html?plan=empresa', tickets:8 },
};

// ─── Paso por tamaño de empresa ─────────────────────────────────────────────
function planPorTamano(n) {
  if (n <= 15)  return 'micro';
  if (n <= 50)  return 'pyme';
  if (n <= 150) return 'mediana';
  return 'empresa';
}

// ─── HTTP helper (Node built-in) ─────────────────────────────────────────────
function httpJson(method, urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => (raw += d));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── WhatsApp Cloud API ──────────────────────────────────────────────────────
async function waSend(to, payload) {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  return httpJson(
    'POST',
    `https://graph.facebook.com/v19.0/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, ...payload },
    { Authorization: `Bearer ${token}` },
  );
}

function waTexto(to, texto) {
  return waSend(to, { type: 'text', text: { body: texto, preview_url: false } });
}

function waInteractivo(to, body, footer, botones) {
  return waSend(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      footer: footer ? { text: footer } : undefined,
      action: {
        buttons: botones.map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

function waLista(to, body, footer, botonAbre, secciones) {
  return waSend(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      footer: footer ? { text: footer } : undefined,
      action: {
        button: botonAbre,
        sections: secciones,
      },
    },
  });
}

// ─── Supabase helper (sin SDK, REST directo) ─────────────────────────────────
function sbHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function convGet(telefono) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/whatsapp_conversaciones?telefono=eq.${encodeURIComponent(telefono)}&limit=1`;
  const rows = await httpJson('GET', url, null, sbHeaders());
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function convUpsert(telefono, paso, datos) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/whatsapp_conversaciones`;
  const headers = { ...sbHeaders(), Prefer: 'return=minimal,resolution=merge-duplicates' };
  return httpJson('POST', url, { telefono, paso, datos, actualizado_at: new Date().toISOString() }, headers);
}

// ─── Mensajes del bot ────────────────────────────────────────────────────────
async function pasoBienvenida(from) {
  await waInteractivo(
    from,
    '¡Hola! 👋 Soy el asistente de *ClickLaboral.mx*.\n\nGeneramos contratos laborales con IA, expedientes digitales y cumplimiento LFT — sin abogados costosos.\n\n¿Qué le describe mejor?',
    'Respuesta en segundos',
    [
      { id: 'accion_empresa',  title: '🏢 Soy empresa' },
      { id: 'accion_despacho', title: '🧮 Soy contador/abogado' },
      { id: 'accion_info',     title: '❓ Solo quiero info' },
    ],
  );
  await convUpsert(from, 'accion', {});
}

async function pasoTamano(from) {
  await waInteractivo(
    from,
    '¿Cuántos trabajadores tiene aproximadamente?',
    null,
    [
      { id: 'tam_1',  title: '1 - 15 trabajadores' },
      { id: 'tam_16', title: '16 - 50 trabajadores' },
      { id: 'tam_51', title: '51 o más trabajadores' },
    ],
  );
  await convUpsert(from, 'tamano', {});
}

async function pasoPropuestaPlan(from, claveplan, datos) {
  const p = PLANES[claveplan];
  const msg =
    `✅ *Plan ${p.nombre} — $${p.precio.toLocaleString('es-MX')}/mes*\n\n` +
    `• ${p.trab} trabajadores\n` +
    `• Contratos ilimitados con IA\n` +
    `• Expedientes digitales\n` +
    `• ${p.tickets} ticket${p.tickets > 1 ? 's' : ''} de soporte/mes\n` +
    `• Sin permanencia\n\n` +
    `¿Le gustaría empezar hoy?`;
  await waInteractivo(
    from,
    msg,
    'Sin permanencia · Sin formularios largos',
    [
      { id: `contratar_${claveplan}`, title: '✅ Contratar ahora' },
      { id: 'ver_mas_planes',        title: '🔍 Ver todos los planes' },
      { id: 'hablar_asesor',         title: '💬 Hablar con asesor' },
    ],
  );
  await convUpsert(from, 'propuesta', { ...datos, plan: claveplan });
}

async function pasoDespachoTamano(from) {
  await waInteractivo(
    from,
    '¿Cuántos clientes (empresas) gestiona actualmente?',
    null,
    [
      { id: 'desp_1',  title: '1 - 5 clientes' },
      { id: 'desp_6',  title: '6 - 20 clientes' },
      { id: 'desp_21', title: '21 o más clientes' },
    ],
  );
  await convUpsert(from, 'despacho_tamano', {});
}

async function pasoDespachoInfo(from, datos) {
  const numClientes = datos.num_clientes || 'varios';
  const msg =
    `🧮 *Panel Despacho — ClickLaboral.mx*\n\n` +
    `Gestione *${numClientes}* o más clientes desde un solo panel:\n\n` +
    `• Un RFC por cliente, documentos separados\n` +
    `• Usted accede al dashboard de cada cliente con un clic\n` +
    `• Contratos e incidencias bajo su propia marca\n` +
    `• Sus clientes no ven la interfaz de ClickLaboral\n\n` +
    `Contamos con planes especiales para despachos. ¿Le mando los detalles?`;
  await waInteractivo(
    from,
    msg,
    null,
    [
      { id: 'desp_quiero_info', title: '✅ Sí, mándame info' },
      { id: 'hablar_asesor',   title: '💬 Hablar con asesor' },
    ],
  );
  await convUpsert(from, 'despacho_info', datos);
}

async function pasoCapturaNombre(from, datos) {
  await waTexto(from, '¡Perfecto! Para enviarle la información personalizada, ¿cuál es su nombre?');
  await convUpsert(from, 'captura_nombre', datos);
}

async function pasoCapturaContacto(from, datos) {
  await waTexto(
    from,
    `Gracias, *${datos.nombre}* 😊\n\nY un correo electrónico para enviarle el acceso de prueba (si decide registrarse):`,
  );
  await convUpsert(from, 'captura_contacto', datos);
}

async function pasoFin(from, datos) {
  const plan = datos.plan ? PLANES[datos.plan] : null;
  let msg = `🎉 *¡Listo, ${datos.nombre || 'bienvenido/a'}!*\n\nUn asesor le contactará en breve para ayudarle a empezar.\n\n`;
  if (plan) {
    msg += `📎 También puede *contratar directamente en línea*:\n${plan.link}\n\n`;
  }
  msg += `Mientras tanto, pruebe el *diagnóstico de cumplimiento gratuito* en:\nhttps://clicklaboral.mx/diagnostico-cumplimiento.html`;
  await waTexto(from, msg);

  // Notificar al asesor
  const asesor = process.env.WHATSAPP_ASESOR_TEL;
  if (asesor) {
    const info =
      `🔔 *Nuevo lead ClickLaboral*\n\n` +
      `Nombre: ${datos.nombre || '—'}\n` +
      `Correo: ${datos.correo || '—'}\n` +
      `Teléfono: ${from}\n` +
      `Plan: ${plan ? plan.nombre + ' ($' + plan.precio + '/mes)' : datos.tipo === 'despacho' ? 'Despacho' : '—'}\n` +
      `Tipo: ${datos.tipo || 'empresa'}`;
    await waTexto(asesor, info).catch(() => {});
  }

  await convUpsert(from, 'fin', datos);
}

async function pasoVerPlanes(from) {
  const rows = Object.entries(PLANES).map(([k, p]) => ({
    id: `contratar_${k}`,
    title: `${p.nombre} — $${p.precio.toLocaleString('es-MX')}/mes`,
    description: `${p.trab} trabajadores · ${p.tickets} ticket${p.tickets > 1 ? 's' : ''}`,
  }));
  await waLista(
    from,
    '📋 *Planes ClickLaboral.mx*\n\nTodos incluyen contratos ilimitados, expedientes y firma electrónica. Sin permanencia.',
    'Cancele cuando quiera',
    'Ver planes',
    [{ title: 'Planes disponibles', rows }],
  );
  await convUpsert(from, 'ver_planes', {});
}

// ─── Comandos globales ────────────────────────────────────────────────────────
const RE_MENU = /\b(menu|menú|inicio|hola|hi|hello|start|comenzar|empezar|reiniciar)\b/i;

// ─── Procesar mensaje entrante ────────────────────────────────────────────────
async function procesarMensaje(from, tipo, msgBody, buttonId) {
  // Reinicio global
  if (RE_MENU.test(msgBody || '')) {
    await pasoBienvenida(from);
    return;
  }

  // Obtener estado actual
  let conv = await convGet(from);
  const paso  = conv?.paso  || 'inicio';
  const datos = conv?.datos || {};

  // Respuesta a botón interactivo
  const btn = buttonId || '';

  // ─── Flujo principal ──────────────────────────────────────────────────────

  if (paso === 'inicio' || paso === 'fin') {
    await pasoBienvenida(from);
    return;
  }

  if (paso === 'accion') {
    if (btn === 'accion_empresa' || /empresa|negocio|pyme|comercio/i.test(msgBody)) {
      await pasoTamano(from);
    } else if (btn === 'accion_despacho' || /contador|contaduría|abogado|despacho|firma|estudio/i.test(msgBody)) {
      await pasoDespachoTamano(from);
    } else if (btn === 'accion_info' || /info|informaci/i.test(msgBody)) {
      await waInteractivo(from,
        '¿Sobre qué le gustaría saber más?',
        null,
        [
          { id: 'accion_empresa',  title: '💼 Para mi empresa' },
          { id: 'accion_despacho', title: '🧮 Panel despacho' },
          { id: 'ver_mas_planes',  title: '💲 Planes y precios' },
        ],
      );
    } else {
      await pasoBienvenida(from);
    }
    return;
  }

  if (paso === 'tamano') {
    let plan;
    if      (btn === 'tam_1'  || /^1[0-5]$|^\b[1-9]\b/.test(msgBody))  plan = 'micro';
    else if (btn === 'tam_16' || /1[6-9]|[2-4]\d|50/.test(msgBody))      plan = 'pyme';
    else if (btn === 'tam_51' || /5[1-9]|\d{3,}/.test(msgBody))          plan = 'mediana';
    else {
      // Intentar parsear número directamente
      const n = parseInt(msgBody, 10);
      plan = isNaN(n) ? null : planPorTamano(n);
    }
    if (!plan) {
      await waTexto(from, 'Por favor seleccione una de las opciones o escriba la cantidad de trabajadores (ej: 12).');
      return;
    }
    if (plan === 'empresa' || btn === 'tam_51') {
      // Para empresas grandes (>150) ofrecer plan Empresa y plan Mediana
      await waInteractivo(from,
        '¿Cuántos trabajadores exactamente?\n\nPara 51-150: Plan Mediana ($4,499/mes)\nPara 151-500: Plan Empresa ($9,999/mes)',
        null,
        [
          { id: 'contratar_mediana', title: 'Plan Mediana ($4,499)' },
          { id: 'contratar_empresa', title: 'Plan Empresa ($9,999)' },
          { id: 'hablar_asesor',     title: '💬 Hablar con asesor' },
        ],
      );
      await convUpsert(from, 'propuesta', { ...datos, tipo: 'empresa' });
    } else {
      await pasoPropuestaPlan(from, plan, { ...datos, tipo: 'empresa' });
    }
    return;
  }

  if (paso === 'despacho_tamano') {
    let numClientes = '5+';
    if      (btn === 'desp_1')  numClientes = '1-5';
    else if (btn === 'desp_6')  numClientes = '6-20';
    else if (btn === 'desp_21') numClientes = '21+';
    else {
      const n = parseInt(msgBody, 10);
      if (!isNaN(n)) numClientes = String(n);
    }
    await pasoDespachoInfo(from, { ...datos, tipo: 'despacho', num_clientes: numClientes });
    return;
  }

  if (paso === 'despacho_info') {
    if (btn === 'desp_quiero_info' || /sí|si|quiero|manda|info/i.test(msgBody)) {
      await pasoCapturaNombre(from, { ...datos, tipo: 'despacho' });
    } else if (btn === 'hablar_asesor') {
      await hablarConAsesor(from, datos);
    } else {
      await pasoCapturaNombre(from, { ...datos, tipo: 'despacho' });
    }
    return;
  }

  if (paso === 'propuesta' || paso === 'ver_planes') {
    if (btn.startsWith('contratar_')) {
      const clave = btn.replace('contratar_', '');
      if (PLANES[clave]) {
        await waTexto(from, `¡Excelente elección! Para contratar el *Plan ${PLANES[clave].nombre}*, puede hacerlo directamente en:\n\n${PLANES[clave].link}\n\nO si prefiere, con gusto le ayuda un asesor.`);
        await pasoCapturaNombre(from, { ...datos, plan: clave, tipo: datos.tipo || 'empresa' });
      } else {
        await pasoVerPlanes(from);
      }
    } else if (btn === 'ver_mas_planes') {
      await pasoVerPlanes(from);
    } else if (btn === 'hablar_asesor') {
      await hablarConAsesor(from, datos);
    } else {
      // Si escribe texto libre en estado propuesta, intentar detectar intención
      if (/precio|plan|costo|cuanto/i.test(msgBody)) {
        await pasoVerPlanes(from);
      } else {
        await pasoCapturaNombre(from, datos);
      }
    }
    return;
  }

  if (paso === 'captura_nombre') {
    const nombre = (msgBody || '').trim();
    if (nombre.length < 2) {
      await waTexto(from, 'Por favor dígame su nombre para continuar.');
      return;
    }
    await pasoCapturaContacto(from, { ...datos, nombre });
    return;
  }

  if (paso === 'captura_contacto') {
    const correo = (msgBody || '').trim().toLowerCase();
    const esEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
    if (!esEmail) {
      await waTexto(from, 'Parece que eso no es un correo válido. Por favor ingrese su correo electrónico (ej: nombre@empresa.com):');
      return;
    }
    await pasoFin(from, { ...datos, correo });
    return;
  }

  // Estado desconocido → reiniciar
  await pasoBienvenida(from);
}

async function hablarConAsesor(from, datos) {
  await waTexto(
    from,
    `¡Claro! Un asesor de ClickLaboral le atenderá en breve.\n\nTambién puede escribirnos directamente:\nhttps://wa.me/5213339263817?text=Hola%2C%20necesito%20informaci%C3%B3n%20sobre%20ClickLaboral.mx`,
  );
  // Notificar al asesor
  const asesor = process.env.WHATSAPP_ASESOR_TEL;
  if (asesor) {
    await waTexto(asesor, `🔔 *Lead solicita asesor*\nTeléfono: ${from}\nDatos: ${JSON.stringify(datos)}`).catch(() => {});
  }
  await convUpsert(from, 'fin', datos);
}

// ─── Handler principal Netlify ────────────────────────────────────────────────
exports.handler = async function (event) {
  // GET — verificación del webhook
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    if (
      params['hub.mode'] === 'subscribe' &&
      params['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return { statusCode: 200, body: params['hub.challenge'] };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // POST — mensajes entrantes
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  // Responder a Meta de inmediato (evita re-envíos por timeout)
  const respond200 = { statusCode: 200, body: 'OK' };

  try {
    const entry    = body?.entry?.[0];
    const changes  = entry?.changes?.[0];
    const value    = changes?.value;
    const messages = value?.messages;

    if (!messages || !messages.length) return respond200;

    const msg  = messages[0];
    const from = msg.from; // número del usuario

    let texto    = '';
    let buttonId = '';

    if (msg.type === 'text') {
      texto = msg.text?.body || '';
    } else if (msg.type === 'interactive') {
      if (msg.interactive?.type === 'button_reply') {
        buttonId = msg.interactive.button_reply?.id || '';
        texto    = msg.interactive.button_reply?.title || '';
      } else if (msg.interactive?.type === 'list_reply') {
        buttonId = msg.interactive.list_reply?.id || '';
        texto    = msg.interactive.list_reply?.title || '';
      }
    } else {
      // Tipo no soportado (imagen, audio…) — pedir texto
      await waTexto(from, 'Por favor responda con texto o seleccione una de las opciones del menú. Escriva *menu* para empezar.');
      return respond200;
    }

    await procesarMensaje(from, msg.type, texto, buttonId);
  } catch (err) {
    console.error('whatsapp-bot error:', err);
  }

  return respond200;
};
