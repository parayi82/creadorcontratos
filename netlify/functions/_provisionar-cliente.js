// netlify/functions/_provisionar-cliente.js
//
// Da de alta el acceso al portal de un cliente cuyo pago ya se confirmó:
// crea (o vincula) su usuario en Supabase Auth, actualiza clientes_billing
// con el customer de Stripe, y envía el correo de bienvenida con
// credenciales vía Resend.
//
// Extraído de crear-suscripcion.js (antes vivía inline ahí) para poder
// compartirlo con el flujo de transferencia SPEI, que confirma el pago de
// forma asíncrona en el webhook en vez de en la misma petición HTTP:
//   - crear-suscripcion.js (tarjeta): el pago se confirma de forma síncrona
//     en la misma petición; llama esto justo después.
//   - stripe-webhook.js (SPEI): el pago se confirma cuando el banco acredita
//     la transferencia, potencialmente horas o días después; el evento
//     invoice.payment_succeeded llama esto en ese momento.
//
// No cambia ningún comportamiento respecto al código original — mismo
// orden de pasos, mismos mensajes, mismo manejo de errores (un fallo aquí
// nunca debe hacer fallar el cobro que ya se hizo).

const { randomBytes } = require('crypto');
const { NOMBRES_PLAN, CUOTAS_PLAN, ES_PAGO_UNICO } = require('./_planes');

// supabase: cliente ya creado con SUPABASE_SERVICE_KEY.
// Devuelve { email, password } si se generaron credenciales nuevas, o null.
async function provisionarClientePortal({ supabase, rfc, plan, empresa, email, contacto, customerId, subscriptionId }) {
  let credencialesPortal = null;

  // Crear el usuario de acceso al portal de cliente — contraseña aleatoria,
  // NUNCA predecible a partir del RFC (el RFC no es secreto, aparece en facturas/contratos).
  const emailPortal = `${rfc.toLowerCase()}@clicklaboral.mx`;
  const passwordPortal = randomBytes(9).toString('base64url').slice(0, 8).toUpperCase()
    + randomBytes(4).toString('base64url').slice(0, 4) + '!';
  try {
    const { data: newUserData } = await supabase.auth.admin.createUser({
      email: emailPortal,
      password: passwordPortal,
      email_confirm: true,
      user_metadata: { rfc, plan: NOMBRES_PLAN[plan].toLowerCase(), empresa, email_contacto: email, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId || null },
    });
    credencialesPortal = { email: emailPortal, password: passwordPortal };
    if (newUserData?.user?.id) {
      await supabase.from('clientes_billing').upsert({
        rfc: rfc.toUpperCase(), auth_user_id: newUserData.user.id,
        stripe_customer_id: customerId, updated_at: new Date().toISOString(),
      }, { onConflict: 'rfc' }).catch(e => console.error('clientes_billing upsert:', e.message || e));
    }
  } catch (authErr) {
    // Si el usuario ya existía (cliente que regresa, alta manual previa, o reintento),
    // NO perder el vínculo con Stripe: actualizar la metadata del usuario existente.
    console.error('createUser falló, intentando actualizar usuario existente:', authErr.message || authErr);
    try {
      // Look up via clientes_billing (O(1)) instead of listUsers(1000)
      const { data: billingFallback } = await supabase
        .from('clientes_billing').select('auth_user_id').eq('rfc', rfc.toUpperCase()).maybeSingle();
      let existente = null;
      if (billingFallback) {
        const { data: { user: u } } = await supabase.auth.admin.getUserById(billingFallback.auth_user_id);
        existente = u || null;
      }
      if (existente) {
        await supabase.auth.admin.updateUserById(existente.id, {
          user_metadata: {
            ...existente.user_metadata,
            rfc,
            plan: NOMBRES_PLAN[plan].toLowerCase(),
            empresa,
            email_contacto: email,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId || null,
            suscripcion_activa: true,
          },
        });
        await supabase.from('clientes_billing').upsert({
          rfc: rfc.toUpperCase(), auth_user_id: existente.id,
          stripe_customer_id: customerId, updated_at: new Date().toISOString(),
        }, { onConflict: 'rfc' }).catch(e => console.error('clientes_billing upsert (fallback):', e.message || e));
        console.log('✅ Usuario existente vinculado con Stripe');
      } else {
        // Not yet in clientes_billing (run migration 000700 backfill). The Stripe
        // webhook (invoice.payment_succeeded) ya está manejando este mismo evento.
        console.error('No se encontró usuario existente en clientes_billing (RFC omitido por PII)');
      }
    } catch (updErr) {
      console.error('Aviso: no se pudo vincular el usuario existente con Stripe:', updErr.message || updErr);
    }
  }

  // Enviar email de bienvenida con credenciales del portal (vía Resend)
  if (process.env.RESEND_API_KEY && credencialesPortal) {
    try {
      const cuotaFmt = `$${CUOTAS_PLAN[plan].toLocaleString('es-MX')} MXN${ES_PAGO_UNICO[plan] ? ' (pago único anual)' : '/mes, IVA incluido'}`;
      const emailHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f5f4f0;font-family:'Segoe UI',system-ui,sans-serif;color:#111110;}
  .wrap{max-width:600px;margin:0 auto;padding:32px 16px;}
  .card{background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.08);}
  .header{background:#0f2640;padding:32px 40px;text-align:center;}
  .header-logo{color:rgba(255,255,255,.5);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px;}
  .header-title{color:#ffffff;font-size:22px;font-weight:800;line-height:1.3;}
  .body{padding:36px 40px;}
  .greeting{font-size:15px;color:#444440;margin-bottom:20px;line-height:1.6;}
  .plan-badge{display:inline-block;background:#e8f2fc;color:#1a3a5c;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:24px;}
  .section-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1a3a5c;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid #eeede8;}
  .cred-box{background:#f5f4f0;border-radius:8px;padding:20px 24px;margin-bottom:8px;}
  .cred-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
  .cred-label{font-size:12px;color:#888880;font-weight:500;}
  .cred-value{font-size:14px;color:#111110;font-weight:700;font-family:monospace;background:#ffffff;padding:4px 10px;border-radius:6px;border:1px solid #ddddd6;}
  .warn-box{background:#fef3c7;border:1px solid rgba(217,119,6,.3);border-radius:8px;padding:14px 18px;font-size:12px;color:#92400e;margin-top:8px;line-height:1.6;}
  .cta-btn{display:block;text-align:center;background:#0f2640;color:#ffffff !important;text-decoration:none;font-size:14px;font-weight:700;padding:14px 28px;border-radius:8px;margin:24px 0;}
  .steps{margin:0;padding-left:20px;}
  .steps li{font-size:13px;color:#444440;margin-bottom:10px;line-height:1.6;}
  .footer{text-align:center;padding:24px 40px;background:#f5f4f0;}
  .footer p{font-size:11px;color:#888880;margin:0;line-height:1.7;}
  .footer a{color:#1a3a5c;}
  @media(max-width:560px){
    .header,.body,.footer{padding-left:20px !important;padding-right:20px !important;}
    .cred-row{flex-direction:column;align-items:flex-start;gap:6px;}
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <div class="header-logo">ClickLaboral.mx</div>
      <div class="header-title">¡Bienvenido a su servicio<br>de compliance laboral!</div>
    </div>
    <div class="body">
      <p class="greeting">Estimado(a) <strong>${contacto || empresa}</strong>,<br><br>
      Nos da mucho gusto confirmar que <strong>${empresa}</strong> ya es parte de ClickLaboral.mx. Su suscripción está activa y su portal personalizado está listo.</p>

      <div class="plan-badge">${NOMBRES_PLAN[plan]} · ${cuotaFmt}</div>

      <div class="section-title">Acceso a su portal</div>
      <p style="font-size:13px;color:#444440;margin-bottom:12px;">Use estas credenciales para ingresar a su portal de compliance en cualquier momento:</p>
      <div class="cred-box">
        <div class="cred-row">
          <span class="cred-label">URL del portal</span>
          <span class="cred-value">clicklaboral.mx/portal-cliente</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Usuario (RFC)</span>
          <span class="cred-value">${rfc}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Contraseña</span>
          <span class="cred-value">${credencialesPortal.password}</span>
        </div>
      </div>
      <div class="warn-box">
        ⚠️ <strong>Guarde estas credenciales en un lugar seguro.</strong> La contraseña no se puede recuperar desde el portal — si la pierde, contáctenos por WhatsApp para restablecerla.
      </div>

      <a class="cta-btn" href="https://clicklaboral.mx/portal-cliente.html">Ingresar a mi portal →</a>

      <div class="section-title">Próximos pasos (primeros 15 días)</div>
      <ol class="steps">
        <li>Ingrese a su portal y revise el <strong>semáforo de compliance</strong> — le muestra el estado actual de sus obligaciones laborales.</li>
        <li>Genere sus <strong>contratos individuales de trabajo</strong> desde la sección "Generar nuevo".</li>
        <li>Registre a sus trabajadores en <strong>"Expedientes de trabajadores"</strong> para gestionar asistencias, vacaciones y documentos.</li>
        <li>Publique el <strong>Reglamento Interior de Trabajo</strong> en los tableros de avisos de su empresa.</li>
        <li>Aplique la evaluación inicial de la <strong>NOM-035-STPS-2018</strong> a todos sus colaboradores.</li>
      </ol>

      <div class="section-title">¿Necesita ayuda?</div>
      <p style="font-size:13px;color:#444440;line-height:1.7;">
        Estamos a sus órdenes para cualquier duda o contingencia laboral que se presente.<br>
        📱 WhatsApp: <a href="https://wa.me/5213339263817" style="color:#1a3a5c;font-weight:600;">+52 33 3926 3817</a><br>
        📧 Email: <a href="mailto:serjuemsa@gmail.com" style="color:#1a3a5c;">serjuemsa@gmail.com</a>
      </p>

      <p style="font-size:13px;color:#444440;line-height:1.7;margin-top:20px;">Quedo a sus órdenes y en espera de una larga y exitosa colaboración.<br><br>
      Atentamente,<br>
      <strong>Lic. Juan José Salas Llamas</strong><br>
      Abogado en Derecho Laboral · ClickLaboral.mx</p>
    </div>
    <div class="footer">
      <p>ClickLaboral.mx · Zapopan, Jalisco, México<br>
      RFC: SALJ820818Q64 · <a href="https://clicklaboral.mx/aviso-de-privacidad.html">Aviso de privacidad</a> · <a href="https://clicklaboral.mx/terminos-de-servicio.html">Términos de servicio</a><br>
      Este correo se envió a ${email} por haber contratado el servicio de ClickLaboral.mx.</p>
    </div>
  </div>
</div>
</body>
</html>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'ClickLaboral.mx <bienvenida@clicklaboral.mx>',
          to: [email],
          bcc: ['serjuemsa@gmail.com'],  // copia al despacho en cada alta
          subject: `¡Bienvenido a ClickLaboral.mx! Sus credenciales de acceso — ${empresa}`,
          html: emailHtml,
        }),
      });
      console.log('Email de bienvenida enviado');
    } catch (emailErr) {
      // El email falló pero el cobro y el alta del portal ya se hicieron — solo registrar el error
      console.error('Aviso: no se pudo enviar el email de bienvenida:', emailErr.message || emailErr);
    }
  }

  return credencialesPortal;
}

module.exports = { provisionarClientePortal };
