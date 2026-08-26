// stripe-webhook.js — Recibe eventos de Stripe y actualiza user_metadata en Supabase Auth
const { createClient } = require('@supabase/supabase-js');
const { reportError } = require('./_security');
const { waTexto } = require('./_whatsapp');

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

  // Helper: buscar usuario por stripe_customer_id en clientes_billing (O(1))
  async function getUserByCustomerId(customerId) {
    const { data: billing } = await supabase
      .from('clientes_billing').select('auth_user_id').eq('stripe_customer_id', customerId).maybeSingle();
    if (!billing) return null;
    const { data: { user } } = await supabase.auth.admin.getUserById(billing.auth_user_id);
    return user || null;
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
          const tel = user.user_metadata?.tel;
          if (tel) {
            await waTexto(tel,
              `👋 *ClickLaboral.mx* — Su suscripción ha sido cancelada.\n\n` +
              `Su acceso al portal estará disponible hasta el fin del periodo pagado.\n\n` +
              `Si canceló por error o desea reactivar, escríbanos:\nhttps://wa.me/5213339263817`
            ).catch(() => {});
          }
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

        // Notificar al cliente por WhatsApp en cada fallo
        const telCliente = user.user_metadata?.tel;
        if (telCliente) {
          const msg = intentos >= 3
            ? `⛔ *ClickLaboral.mx* — Su cuenta *${empresa}* ha sido suspendida por ${intentos} pagos fallidos.\n\nActualice su método de pago para reactivarla:\nhttps://clicklaboral.mx/portal-cliente.html`
            : `⚠️ *ClickLaboral.mx* — No pudimos procesar el pago de su suscripción (intento ${intentos}/3).\n\nActualice su método de pago para evitar la suspensión:\nhttps://clicklaboral.mx/portal-cliente.html`;
          await waTexto(telCliente, msg).catch(() => {});
        }

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

      case 'checkout.session.completed': {
        const session  = stripeEvent.data.object;
        const meta     = session.metadata || {};
        if (meta.tipo === 'firmas_creditos' && meta.cliente_rfc && meta.cantidad) {
          const cantidad = parseInt(meta.cantidad, 10);
          const { error: rpcErr } = await supabase.rpc('agregar_firma_creditos', {
            p_rfc:      meta.cliente_rfc,
            p_cantidad: cantidad,
            p_tipo:     meta.paquete === 'paquete6' ? 'compra_paquete6' : 'compra_unitaria',
            p_ref:      session.payment_intent || session.id,
          });
          if (rpcErr) console.error('[stripe-webhook] agregar_firma_creditos error:', rpcErr.message);
          else console.log(`[stripe-webhook] +${cantidad} crédito(s) → ${meta.cliente_rfc}`);
        }
        break;
      }

      default:
        console.log(`Evento no manejado: ${stripeEvent.type}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    reportError('stripe-webhook', err, { type: stripeEvent?.type }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
