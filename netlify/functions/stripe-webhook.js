// stripe-webhook.js — Recibe eventos de Stripe y actualiza user_metadata en Supabase Auth
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig     = event.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (err) {
    console.error('Stripe signature error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Helper: buscar usuario por stripe_customer_id en user_metadata
  async function getUserByCustomerId(customerId) {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    return (data?.users || []).find(u => u.user_metadata?.stripe_customer_id === customerId);
  }

  try {
    switch (stripeEvent.type) {

      case 'customer.subscription.deleted': {
        const sub  = stripeEvent.data.object;
        const user = await getUserByCustomerId(sub.customer);
        if (user) {
          await supabase.auth.admin.updateUserById(user.id, {
            user_metadata: { ...user.user_metadata, suscripcion_activa: false }
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub  = stripeEvent.data.object;
        const user = await getUserByCustomerId(sub.customer);
        if (user) {
          await supabase.auth.admin.updateUserById(user.id, {
            user_metadata: {
              ...user.user_metadata,
              suscripcion_activa: (sub.status === 'active' || sub.status === 'trialing'),
              stripe_subscription_id: sub.id,
            }
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const inv  = stripeEvent.data.object;
        const user = await getUserByCustomerId(inv.customer);
        if (!user) break;
        await supabase.auth.admin.updateUserById(user.id, {
          user_metadata: {
            ...user.user_metadata,
            suscripcion_activa:    true,
            suspendida_por_pago:   false,
            pago_fallido_intentos: 0,
            ultimo_pago_fallido:   null,
          }
        });
        console.log(`✅ Pago exitoso para ${user.user_metadata?.rfc} — $${inv.amount_paid/100}`);
        break;
      }

      case 'invoice.payment_failed': {
        const inv  = stripeEvent.data.object;
        const user = await getUserByCustomerId(inv.customer);
        if (!user) break;

        const rfc     = user.user_metadata?.rfc     || '';
        const empresa = user.user_metadata?.empresa || rfc;
        const email   = user.user_metadata?.email_contacto || user.email || '';
        const intentos = (user.user_metadata?.pago_fallido_intentos || 0) + 1;

        // Actualizar conteo de fallos
        const metaUpdate = {
          ...user.user_metadata,
          pago_fallido_intentos: intentos,
          ultimo_pago_fallido:   new Date().toISOString(),
        };

        // Suspender cuenta tras 3 intentos fallidos
        if (intentos >= 3) {
          metaUpdate.suscripcion_activa  = false;
          metaUpdate.suspendida_por_pago = true;
          console.warn(`🔴 Cuenta ${rfc} suspendida tras ${intentos} pagos fallidos`);
        }

        await supabase.auth.admin.updateUserById(user.id, { user_metadata: metaUpdate });

        // Notificar al admin en el primer fallo
        if (process.env.RESEND_API_KEY && intentos === 1) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'ClickLaboral.mx <hola@clicklaboral.mx>',
              to: ['serjuemsa@gmail.com'],
              subject: `⚠️ Pago fallido — ${empresa} (${rfc})`,
              html: `<p><strong>${empresa}</strong> (RFC: ${rfc}) tuvo un pago fallido.</p>
                     <p>Monto: $${(inv.amount_due/100).toLocaleString('es-MX')} MXN · Email: ${email}</p>
                     <p>Stripe reintentará automáticamente. La cuenta se suspende al 3er fallo.</p>
                     <p><a href="https://dashboard.stripe.com/customers/${inv.customer}">Ver en Stripe →</a></p>`
            })
          }).catch(e => console.error('Notificación fallida:', e.message));
        }
        break;
      }

      default:
        console.log(`Evento no manejado: ${stripeEvent.type}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Error procesando webhook:', err.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
