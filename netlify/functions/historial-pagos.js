// netlify/functions/historial-pagos.js
//
// Devuelve el historial de pagos (facturas de Stripe) de un cliente para
// mostrarlo en la tarjeta "Historial de pagos" del portal.
// Se llama desde portal-cliente.html vía:
//   fetch('/.netlify/functions/historial-pagos', { method:'POST', body: JSON.stringify({ rfc }) })
//
// Variables de entorno requeridas (las mismas que portal-facturacion.js):
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { verificarSesion, puedeAccederRFC, cabecerasCORS } = require('./_admin-auth');
const { clientIp } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

exports.handler = async (event) => {
  const headers = cabecerasCORS(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }
  const rl = await checkRateLimit(clientIp(event), 'historial-pagos', 20, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);
  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'El servidor no está configurado correctamente (faltan variables de entorno).' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { rfc } = body;
  if (!rfc) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta el RFC del cliente.' }) };

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── Autorización ───────────────────────────────────────────────────────────
  // Los montos y fechas de facturación son datos sensibles del cliente.
  const usuario = await verificarSesion(event, supabase);
  if (!usuario) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Inicie sesión para consultar su historial de pagos.' }) };
  }
  if (!puedeAccederRFC(usuario, rfc)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No está autorizado para consultar los pagos de este cliente.' }) };
  }

  try {
    const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const user = (usersData?.users || []).find(u => (u.user_metadata?.rfc || '').toUpperCase() === rfc.toUpperCase());
    if (!user) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Cliente no encontrado.' }) };

    let customerId = user.user_metadata?.stripe_customer_id || null;

    // Auto-reparación: si el usuario no tiene el vínculo con Stripe (p. ej. pagó
    // cuando su usuario ya existía y createUser falló), buscar su customer en
    // Stripe por RFC y guardarlo en la metadata para futuras consultas.
    if (!customerId) {
      try {
        let candidato = null;
        // 1º por RFC en la metadata del customer (crear-suscripcion.js siempre lo guarda)
        try {
          const bus = await stripe.customers.search({ query: `metadata['rfc']:'${rfc.toUpperCase()}'`, limit: 5 });
          candidato = (bus.data || [])[0] || null;
        } catch (_) { /* la API de búsqueda puede no estar disponible en algunas cuentas */ }
        // 2º por email de contacto
        if (!candidato) {
          const emailBusqueda = user.user_metadata?.email_contacto || user.email || '';
          if (emailBusqueda && !emailBusqueda.endsWith('@clicklaboral.mx')) {
            const lista = await stripe.customers.list({ email: emailBusqueda, limit: 5 });
            candidato = (lista.data || [])[0] || null;
          }
        }
        if (candidato) {
          customerId = candidato.id;
          await supabase.auth.admin.updateUserById(user.id, {
            user_metadata: { ...user.user_metadata, stripe_customer_id: candidato.id },
          });
          console.log(`🔗 Auto-vinculado ${rfc} con Stripe customer ${candidato.id}`);
        }
      } catch (e) {
        console.error('Auto-vinculación con Stripe falló:', e.message || e);
      }
    }

    if (!customerId) {
      // Sin rastro en Stripe: suscripción dada de alta manualmente.
      return { statusCode: 200, headers, body: JSON.stringify({ pagos: [], manual: true }) };
    }

    // Información de la suscripción activa (próximo pago, estado, monto)
    let suscripcion = null;
    try {
      const subId = user.user_metadata?.stripe_subscription_id || null;
      let sub = null;
      if (subId) {
        sub = await stripe.subscriptions.retrieve(subId);
      } else {
        const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 3 });
        sub = (subs.data || []).find(s => ['active','trialing','past_due'].includes(s.status)) || (subs.data || [])[0] || null;
      }
      if (sub) {
        const fin = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
        suscripcion = {
          status: sub.status,
          statusLabel: { active:'Activo', trialing:'Periodo de prueba', past_due:'Pago vencido', canceled:'Cancelada', unpaid:'Sin pagar', incomplete:'Incompleta' }[sub.status] || sub.status,
          proximoPago: fin ? `${fin.getDate()} de ${MESES[fin.getMonth()]} de ${fin.getFullYear()}` : null,
          monto: sub.items?.data?.[0]?.price?.unit_amount ? sub.items.data[0].price.unit_amount / 100 : null,
          cancelaAlFinal: !!sub.cancel_at_period_end,
        };
      }
    } catch (subErr) {
      console.error('No se pudo consultar la suscripción:', subErr.message || subErr);
    }

    const invoices = await stripe.invoices.list({ customer: customerId, limit: 24 });

    const pagos = (invoices.data || [])
      .filter(inv => inv.status !== 'draft' && inv.status !== 'void')
      .map(inv => {
        const f = new Date((inv.status_transitions?.paid_at || inv.created) * 1000);
        return {
          mes:    `${MESES[f.getMonth()]} ${f.getFullYear()}`,
          fecha:  f.toISOString().split('T')[0],
          monto:  (inv.status === 'paid' ? inv.amount_paid : inv.amount_due) / 100,
          status: inv.status === 'paid' ? 'Pagado' : inv.status === 'open' ? 'Pendiente' : inv.status,
          metodo: 'Stripe · tarjeta',
          recibo: inv.hosted_invoice_url || inv.invoice_pdf || null,
        };
      });

    return { statusCode: 200, headers, body: JSON.stringify({ pagos, suscripcion }) };
  } catch (e) {
    console.error('Error consultando historial de pagos:', e.message || e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'No se pudo consultar el historial de pagos.' }) };
  }
};
