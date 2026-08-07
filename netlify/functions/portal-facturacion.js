// netlify/functions/portal-facturacion.js
//
// Genera un enlace temporal al Customer Portal de Stripe para que el cliente
// pueda ver y descargar sus facturas, y actualizar su método de pago.
// Se llama desde portal-cliente.html vía:
//   fetch('/.netlify/functions/portal-facturacion', { method:'POST', body: JSON.stringify({ rfc }) })
//
// Variables de entorno requeridas (las mismas que crear-suscripcion.js):
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//
// NOTA: el Customer Portal debe activarse una vez en Stripe Dashboard →
// Settings → Billing → Customer portal → Activate, antes de que esto funcione.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { verificarSesion, puedeAccederRFC, cabecerasCORS } = require('./_admin-auth');
const { clientIp } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');

exports.handler = async (event) => {
  const headers = cabecerasCORS(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }
  const rl = await checkRateLimit(clientIp(event), 'portal-facturacion', 10, 300);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'El servidor no está configurado correctamente (faltan variables de entorno).' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { rfc } = body;
  if (!rfc) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta el RFC del cliente.' }) };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── Autorización ───────────────────────────────────────────────────────────
  // El enlace generado da acceso al portal de Stripe del cliente (facturas y
  // método de pago). Nunca debe generarse para un RFC ajeno.
  const usuario = await verificarSesion(event, supabase);
  if (!usuario) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Inicie sesión para acceder a su facturación.' }) };
  }
  if (!puedeAccederRFC(usuario, rfc)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No está autorizado para acceder a la facturación de este cliente.' }) };
  }

  try {
    // Buscar stripe_customer_id en user_metadata
    const { data: usersData2 } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const userFound2 = (usersData2?.users || []).find(u => (u.user_metadata?.rfc||'').toUpperCase() === rfc.toUpperCase());
    const cliente = { stripe_customer_id: userFound2?.user_metadata?.stripe_customer_id || null };
    if (!userFound2) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Cliente no encontrado.' }) };
    }
    if (!cliente.stripe_customer_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Este cliente no tiene un método de pago registrado en Stripe (puede ser una suscripción dada de alta manualmente). No hay facturas que mostrar.' }) };
    }

    const returnUrl = (process.env.URL || 'https://clicklaboral.mx') + '/portal-cliente.html';

    const session = await stripe.billingPortal.sessions.create({
      customer: cliente.stripe_customer_id,
      return_url: returnUrl,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    console.error('Error al generar el portal de facturación:', e.message || e);
    const mensaje = e.message && e.message.includes('configuration')
      ? 'El Customer Portal de Stripe no está activado todavía. Actívalo en Stripe Dashboard → Settings → Billing → Customer portal.'
      : (e.message || 'No se pudo generar el enlace de facturación.');
    return { statusCode: 500, headers, body: JSON.stringify({ error: mensaje }) };
  }
};
