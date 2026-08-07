// netlify/functions/cancelar-suscripcion.js
//
// Cancela la suscripción recurrente de un cliente en Stripe (si la tiene) y lo marca
// como inactivo en Supabase. Se llama desde admin-suscripciones.html vía:
//   fetch('/.netlify/functions/cancelar-suscripcion', { method:'POST', body: JSON.stringify({ rfc }) })
//
// Variables de entorno requeridas (las mismas que crear-suscripcion.js):
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

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
  const rl = await checkRateLimit(clientIp(event), 'cancelar-suscripcion', 5, 600);
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
  // Sin esto, cualquiera que conozca un RFC (dato público) podía cancelar la
  // suscripción de un cliente ajeno.
  const usuario = await verificarSesion(event, supabase);
  if (!usuario) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Inicie sesión para realizar esta acción.' }) };
  }
  if (!puedeAccederRFC(usuario, rfc)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No está autorizado para cancelar la suscripción de este cliente.' }) };
  }

  try {
    // Buscar en auth.users por RFC
    const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const userFound = (usersData?.users || []).find(u => (u.user_metadata?.rfc||'').toUpperCase() === rfc.toUpperCase());
    if (!userFound) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Cliente no encontrado.' }) };
    }
    const cliente = { stripe_subscription_id: userFound.user_metadata?.stripe_subscription_id || null };

    // Solo los planes mensuales tienen suscripción recurrente en Stripe que cancelar.
    // Los planes anuales son pago único — no hay nada que cancelar en Stripe, solo se desactiva localmente.
    if (cliente.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(cliente.stripe_subscription_id);
      } catch (stripeErr) {
        // Si ya estaba cancelada en Stripe (p.ej. por tarjeta rechazada repetidas veces),
        // seguimos adelante para reflejar el estado correcto en Supabase de todas formas.
        console.error('Aviso al cancelar en Stripe (puede ya estar cancelada):', stripeErr.message || stripeErr);
      }
    }

    // Actualizar user_metadata en Auth
    await supabase.auth.admin.updateUserById(userFound.id, {
      user_metadata: { ...userFound.user_metadata, suscripcion_activa: false }
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('Error al cancelar suscripción:', e.message || e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'No se pudo cancelar la suscripción.' }) };
  }
};
