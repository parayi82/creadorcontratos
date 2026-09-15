// netlify/functions/crear-suscripcion.js
//
// Backend real que tokeniza el pago, crea el cliente + la suscripción en Stripe,
// guarda al cliente en Supabase, y envía el email de bienvenida con credenciales
// del portal vía Resend. Se llama desde checkout.html vía:
//   fetch('/api/crear-suscripcion', { method:'POST', body: JSON.stringify({...}) })
//
// Variables de entorno requeridas (Netlify → Site configuration → Environment variables):
//   STRIPE_SECRET_KEY      (obligatoria — empieza con sk_live_ o sk_test_)
//   SUPABASE_URL           (opcional — si falta, se omite el guardado en Supabase)
//   SUPABASE_SERVICE_KEY   (opcional — la "service_role" key, NUNCA la "anon" key)
//   RESEND_API_KEY         (opcional — si falta, el email de bienvenida no se envía)

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { handleCors, clientIp, safeJson, reportError, logSecurityEvent } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { PRICE_IDS, NOMBRES_PLAN, CUOTAS_PLAN, ES_PAGO_UNICO } = require('./_planes');
const { provisionarClientePortal } = require('./_provisionar-cliente');

exports.handler = async (event) => {
  // CORS restrictivo — solo clicklaboral.mx (o localhost en desarrollo)
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult; // respuesta OPTIONS 204
  const headers = corsResult._corsHeaders;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  // Rate limiting: máximo 5 intentos de checkout por IP cada 10 minutos
  const ip = clientIp(event);
  const rl = await checkRateLimit(ip, 'crear-suscripcion', 5, 600);
  if (rl.limited) {
    logSecurityEvent('RATE_LIMIT_CHECKOUT', { ip });
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

  const { paymentMethodId, plan, empresa, rfc, email, contacto, codigoReferido } = body;

  if (!paymentMethodId || !empresa || !rfc || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan datos obligatorios (empresa, RFC, email o método de pago)' }) };
  }

  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Plan no válido. Debe ser micro, pyme, mediana o empresa.' }) };
  }
  if (priceId.startsWith('price_FALTA_')) {
    console.error(`Falta configurar el price_id real para el plan "${plan}" en PRICE_IDS`);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Este plan todavía no está configurado para cobro. Contacte al administrador.' }) };
  }

  // Validar formato de RFC mexicano (personas morales: 3 letras + 6 dígitos + 3 alfanum;
  // personas físicas: 4 letras + 6 dígitos + 3 alfanum)
  const rfcRegex = /^[A-ZÑ&]{3,4}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$/i;
  if (!rfcRegex.test(rfc)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'RFC inválido. Verifique el formato (ej: XAXX010101000).' }) };
  }
  // Validar email básico
  const emailRegex = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
  if (!emailRegex.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Correo electrónico inválido.' }) };
  }
  // Límites de longitud para prevenir payloads abusivos
  if (empresa.length > 200) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nombre de empresa demasiado largo (máximo 200 caracteres).' }) };
  }
  if (contacto && contacto.length > 120) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nombre de contacto demasiado largo (máximo 120 caracteres).' }) };
  }

  try {
    // 1. Crear el customer en Stripe con el método de pago ya tokenizado por el navegador
    const customer = await stripe.customers.create({
      email,
      name: empresa,
      payment_method: paymentMethodId,
      invoice_settings: { default_payment_method: paymentMethodId },
      metadata: { rfc, plan, contacto: contacto || '', codigoReferido: codigoReferido || '' },
    });

    // 2. Crear el cobro: suscripción mensual o pago único anual
    let subscriptionId = null;
    let paymentIntent = null;

    if (ES_PAGO_UNICO[plan]) {
      // Plan anual → PaymentIntent de pago único
      const pi = await stripe.paymentIntents.create({
        amount: CUOTAS_PLAN[plan] * 100, // en centavos
        currency: 'mxn',
        customer: customer.id,
        payment_method: paymentMethodId,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { rfc, empresa, plan },
        description: NOMBRES_PLAN[plan] + ' — ClickLaboral.mx',
      });
      paymentIntent = pi;
      subscriptionId = null;
    } else {
      // Plan mensual → Suscripción recurrente
      // Stripe Tax automático: calcula y desglosa el IVA según la ubicación del cliente.
      // Requiere que Stripe Tax esté activado en el dashboard (ya está activado).
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        expand: ['latest_invoice.payment_intent'],
        metadata: { rfc, empresa, plan },
        automatic_tax: { enabled: true },
      });
      subscriptionId = subscription.id;
      paymentIntent = subscription.latest_invoice && subscription.latest_invoice.payment_intent;
    }

    // 3. Si el banco exige autenticación adicional (3D Secure), el frontend debe confirmarla
    if (paymentIntent && paymentIntent.status === 'requires_action') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          requiresAction: true,
          clientSecret: paymentIntent.client_secret,
          subscriptionId: subscriptionId,
        }),
      };
    }

    if (paymentIntent && paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'requires_capture') {
      throw new Error('El pago no pudo completarse (estado: ' + paymentIntent.status + ')');
    }

    // 4. Dar de alta el acceso al portal (usuario + email de bienvenida) —
    // no bloquea el cobro si falla. Lógica compartida con el flujo de SPEI
    // (stripe-webhook.js), ver _provisionar-cliente.js.
    let credencialesPortal = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      credencialesPortal = await provisionarClientePortal({
        supabase, rfc, plan, empresa, email, contacto,
        customerId: customer.id, subscriptionId,
      });
    } else {
      console.warn('SUPABASE_URL / SUPABASE_SERVICE_KEY no configuradas — el cliente se cobró pero no se guardó en la base de datos.');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        subscriptionId: subscriptionId,
        customerId: customer.id,
        confirmacion: 'CLM-' + Date.now().toString(36).toUpperCase(),
        credencialesPortal,
      }),
    };

  } catch (err) {
    const isCardError = err.type === 'StripeCardError';
    if (!isCardError) {
      reportError('crear-suscripcion', err, { plan: body?.plan, empresa: body?.empresa }).catch(() => {});
    }
    const mensaje = isCardError ? err.message : 'No se pudo procesar el pago. Verifique los datos de la tarjeta o intente con otro método de pago.';
    return { statusCode: 402, headers, body: JSON.stringify({ error: mensaje }) };
  }
};
