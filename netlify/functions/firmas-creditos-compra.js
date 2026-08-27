// netlify/functions/firmas-creditos-compra.js
//
// Crea una sesión de Stripe Checkout para comprar créditos de firma.
//
// POST /api/firmas-creditos-compra
// Body: { paquete: 'unitaria' | 'paquete6', cliente_rfc }
// Authorization: Bearer <access_token>
//
// Precios:
//   unitaria  → 1 firma, $89 MXN
//   paquete6  → 6 firmas, $350 MXN

'use strict';

const { handleCors } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

const PAQUETES = {
  unitaria: { cantidad: 1, precio_centavos: 8900,  label: '1 firma electrónica' },
  paquete6: { cantidad: 6, precio_centavos: 35000, label: 'Paquete 6 firmas electrónicas' },
};

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = { ...corsResult._corsHeaders, 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido.' }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Pagos no configurados.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) };
  }

  const { paquete, cliente_rfc } = body;
  const pkg = PAQUETES[paquete];
  if (!pkg || !cliente_rfc) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos requeridos: paquete (unitaria|paquete6), cliente_rfc.' }) };
  }

  const rfcTarget = cliente_rfc.toUpperCase();
  if (!await puedeAccederRFC(sb, uData.user, rfcTarget)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado.' }) };
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  const origin = event.headers?.origin || event.headers?.referer?.replace(/\/[^/]*$/, '') || 'https://clicklaboral.mx';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    currency: 'mxn',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'mxn',
        unit_amount: pkg.precio_centavos,
        product_data: {
          name: pkg.label,
          description: `ClickLaboral — Firma electrónica AllSign | RFC: ${rfcTarget}`,
        },
      },
    }],
    metadata: {
      tipo:        'firmas_creditos',
      paquete,
      cliente_rfc: rfcTarget,
      cantidad:    String(pkg.cantidad),
      user_id:     uData.user.id,
    },
    success_url: `${origin}/portal-cliente.html?panel=firmas&creditos=ok`,
    cancel_url:  `${origin}/portal-cliente.html?panel=firmas`,
  });

  return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
};
