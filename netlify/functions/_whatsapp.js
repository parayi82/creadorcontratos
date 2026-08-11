// netlify/functions/_whatsapp.js
//
// Módulo compartido — envía mensajes salientes via WhatsApp Cloud API (Meta).
//
// Variables de entorno requeridas:
//   WHATSAPP_TOKEN    — Bearer token permanente de la app de Meta
//   WHATSAPP_PHONE_ID — ID del número de teléfono WABA
//
// USO:
//   const { waTexto, waSend } = require('./_whatsapp');
//   await waTexto('5213312345678', 'Hola, su pago fue procesado.');
//
// IMPORTANTE — ventanas de conversación:
//   • waTexto / waSend con type:"text" solo funcionan dentro de las 24 h
//     posteriores a un mensaje del cliente (ventana de servicio de Meta).
//   • Para notificaciones proactivas fuera de esa ventana, use templates
//     pre-aprobados: waSend(tel, { type:'template', template:{...} }).
//   • En producción, registre los templates en Meta Business Suite →
//     WhatsApp → Plantillas de mensaje.

'use strict';

const https = require('https');

// ─── Normalizar número a E.164 sin "+" (México) ─────────────────────────────
// Acepta: "3312345678", "523312345678", "5213312345678", "+52..."
function normalizarTel(tel) {
  if (!tel) return null;
  // Quitar todo lo que no sea dígito
  let d = tel.replace(/\D/g, '');
  // Si empieza con 521 (México móvil antiguo) → convertir a 52+10
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3);
  // Si son 10 dígitos → agregar código de país México
  if (d.length === 10) d = '52' + d;
  // Validar: debe quedar 12 dígitos empezando en 52
  if (d.length !== 12 || !d.startsWith('52')) return null;
  return d;
}

// ─── HTTP POST a graph.facebook.com ─────────────────────────────────────────
function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => (raw += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Enviar payload genérico ─────────────────────────────────────────────────
async function waSend(telefono, payload) {
  const tel = normalizarTel(telefono);
  if (!tel) {
    console.warn(`_whatsapp: número inválido "${telefono}", mensaje no enviado`);
    return null;
  }
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) {
    console.warn('_whatsapp: faltan WHATSAPP_PHONE_ID o WHATSAPP_TOKEN');
    return null;
  }
  const result = await httpPost(
    `https://graph.facebook.com/v19.0/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to: tel, ...payload },
    { Authorization: `Bearer ${token}` },
  );
  if (result.status >= 400) {
    console.error(`_whatsapp: error ${result.status}`, JSON.stringify(result.body));
  }
  return result;
}

// ─── Texto libre (ventana 24 h) ──────────────────────────────────────────────
function waTexto(telefono, texto) {
  return waSend(telefono, { type: 'text', text: { body: texto, preview_url: false } });
}

// ─── Template pre-aprobado (proactivo, sin ventana) ─────────────────────────
// nombre    — nombre exacto del template registrado en Meta
// langCode  — 'es_MX' por defecto
// params    — array de strings que se inyectan en los {{1}}, {{2}}... del template
function waTemplate(telefono, nombre, params, langCode) {
  const components = params && params.length
    ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: String(p) })) }]
    : [];
  return waSend(telefono, {
    type: 'template',
    template: {
      name: nombre,
      language: { code: langCode || 'es_MX' },
      components,
    },
  });
}

module.exports = { waSend, waTexto, waTemplate, normalizarTel };
