// netlify/functions/crear-checkout-spei.js
//
// Alta de suscripción por transferencia SPEI, como alternativa al flujo de
// tarjeta de crear-suscripcion.js (que no se toca). A diferencia de la
// tarjeta, el pago no se confirma en esta misma petición: creamos una
// Stripe Checkout Session con el método de pago "customer_balance"
// (transferencia bancaria mexicana / mx_bank_transfer) y devolvemos la URL
// de Checkout hospedado por Stripe, donde el cliente ve la CLABE a la que
// debe transferir. Stripe confirma el pago después (minutos u horas más
// tarde) vía el webhook invoice.payment_succeeded — ahí es donde
// stripe-webhook.js da de alta el acceso al portal (ver _provisionar-cliente.js),
// no aquí.
//
// Se llama desde checkout.html vía:
//   fetch('/api/crear-checkout-spei', { method:'POST', body: JSON.stringify({...}) })
//
// Variables de entorno requeridas (las mismas que crear-suscripcion.js):
//   STRIPE_SECRET_KEY (obligatoria)
//
// ⚠️ Sin probar contra la API real de Stripe en este entorno (sin credenciales
// de prueba disponibles) — antes de activar en producción, correr un alta de
// prueba completa en modo test de Stripe (ver notas del PR).

const Stripe = require('stripe');
const { handleCors, clientIp, reportError, logSecurityEvent } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { PRICE_IDS, ES_PAGO_UNICO } = require('./_planes');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const ip = clientIp(event);
  const rl = await checkRateLimit(ip, 'crear-checkout-spei', 5, 600);
  if (rl.limited) {
    logSecurityEvent('RATE_LIMIT_CHECKOUT_SPEI', { ip });
    return rateLimitResponse(headers, rl.resetAt);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('Falta configurar STRIPE_SECRET_KEY en las variables de entorno de Netlify');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'El servidor no está configurado correctamente. Contacte al administrador.' }) };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { plan, empresa, rfc, email, contacto, codigoReferido } = body;

  if (!empresa || !rfc || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan datos obligatorios (empresa, RFC o email)' }) };
  }

  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Plan no válido. Debe ser micro, pyme, mediana o empresa.' }) };
  }
  if (priceId.startsWith('price_FALTA_')) {
    console.error(`Falta configurar el price_id real para el plan "${plan}" en PRICE_IDS`);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Este plan todavía no está configurado para cobro. Contacte al administrador.' }) };
  }
  if (ES_PAGO_UNICO[plan]) {
    // La transferencia SPEI vía customer_balance de Stripe está pensada para
    // suscripciones recurrentes (genera una CLABE nueva por cada factura).
    // Ningún plan vigente es de pago único, pero por si se reactivara uno,
    // no lo soportamos por esta vía todavía.
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'El pago por transferencia no está disponible para este plan. Use tarjeta.' }) };
  }

  const rfcRegex = /^[A-ZÑ&]{3,4}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$/i;
  if (!rfcRegex.test(rfc)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'RFC inválido. Verifique el formato (ej: XAXX010101000).' }) };
  }
  const emailRegex = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
  if (!emailRegex.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Correo electrónico inválido.' }) };
  }
  if (empresa.length > 200) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nombre de empresa demasiado largo (máximo 200 caracteres).' }) };
  }
  if (contacto && contacto.length > 120) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nombre de contacto demasiado largo (máximo 120 caracteres).' }) };
  }

  const origen = (event.headers?.origin || event.headers?.Origin || 'https://clicklaboral.mx').replace(/\/$/, '');

  try {
    // El customer se crea de una vez (aunque el pago todavía no se confirme)
    // para poder guardar rfc/plan/empresa/contacto en su metadata — el
    // webhook los lee de ahí cuando la transferencia se confirma, ya que en
    // ese momento no tenemos la petición HTTP original a la mano.
    const customer = await stripe.customers.create({
      email,
      name: empresa,
      metadata: { rfc, plan, empresa, contacto: contacto || '', codigoReferido: codigoReferido || '' },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ['customer_balance'],
      payment_method_options: {
        customer_balance: {
          funding_type: 'bank_transfer',
          bank_transfer: { type: 'mx_bank_transfer' },
        },
      },
      automatic_tax: { enabled: true },
      metadata: { rfc, plan, empresa, contacto: contacto || '', codigoReferido: codigoReferido || '' },
      success_url: `${origen}/checkout.html?spei=exito&rfc=${encodeURIComponent(rfc)}`,
      cancel_url: `${origen}/checkout.html?spei=cancelado`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    reportError('crear-checkout-spei', err, { plan: body?.plan, empresa: body?.empresa }).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo iniciar el pago por transferencia. Intente de nuevo o use tarjeta.' }) };
  }
};
