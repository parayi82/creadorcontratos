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

// Planes vigentes por tamaño de empresa. Acceso total al software en todos;
// cambian los tickets de asesoría legal incluidos.
// IMPORTANTE: crea 4 Precios RECURRENTES mensuales en Stripe y pega aquí sus price_...
// (mientras digan 'price_FALTA_', el checkout devolverá "plan no configurado" en vez de cobrar).
const PRICE_IDS = {
  // PLANES MENSUALES VIGENTES  ← reemplaza cada 'price_FALTA_...' con el price_ real de Stripe
  micro:    'price_1TzPquBEbjDXzIvUfsSiAvon',    // $899 MXN/mes, IVA incl. (1-15 trabajadores)
  pyme:     'price_1TzPrdBEbjDXzIvUirhfcDOI',     // $1,999 MXN/mes, IVA incl. (16-50 trabajadores)
  mediana:  'price_1TzPsBBEbjDXzIvUGbz5Sstv',  // $4,499 MXN/mes, IVA incl. (51-150 trabajadores)
  empresa:  'price_1TzPsnBEbjDXzIvU37MZPwYV',  // $9,999 MXN/mes, IVA incl. (151-500 trabajadores)
  // LEGACY — clientes existentes de planes anteriores (no borrar)
  basico:   'price_1TnpmfBEbjDXzIvUgXP6EZb0',
  estandar: 'price_1TscfDBEbjDXzIvU3ABI9mp8',
  pro:      'price_1Tscg1BEbjDXzIvUSsgy1kyo',
};
const NOMBRES_PLAN = {
  micro:'Plan Micro', pyme:'Plan PyME', mediana:'Plan Mediana', empresa:'Plan Empresa',
  basico:'Plan Básico', estandar:'Plan Estándar', pro:'Plan Pro',
};
const CUOTAS_PLAN = {
  micro:899, pyme:1999, mediana:4499, empresa:9999,
  basico:499, estandar:799, pro:2399,
};
// Ya no hay planes anuales de pago único; todos los planes vigentes son suscripción mensual.
const ES_PAGO_UNICO = {};

exports.handler = async (event) => {
  // CORS básico (el checkout vive en el mismo dominio, pero esto evita dolores de cabeza)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
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
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        expand: ['latest_invoice.payment_intent'],
        metadata: { rfc, empresa, plan },
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

    // 4. Guardar el cliente en Supabase (si está configurado) — no bloquea el cobro si falla
    let credencialesPortal = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      try {
        // Guardar stripe_customer_id en user_metadata (se actualiza después de crear el usuario Auth)
        // El plan y empresa ya se guardan en createUser.user_metadata
        console.log('Cliente registrado en Supabase Auth — stripe_customer_id se actualizará al crear usuario');
      } catch (dbErr) {
        // El cobro ya se hizo correctamente — un fallo aquí no debe romper la suscripción del cliente.
        console.error('Aviso: no se pudo guardar el cliente en Supabase (revisar columnas de la tabla "clientes"):', dbErr.message || dbErr);
      }

      // 5. Crear el usuario de acceso al portal de cliente — contraseña aleatoria,
      // NUNCA predecible a partir del RFC (el RFC no es secreto, aparece en facturas/contratos).
      try {
        const emailPortal = `${rfc.toLowerCase()}@clicklaboral.mx`;
        const passwordPortal = Math.random().toString(36).slice(2, 8).toUpperCase() + Math.random().toString(36).slice(2, 6) + '!';
        await supabase.auth.admin.createUser({
          email: emailPortal,
          password: passwordPortal,
          email_confirm: true,
          user_metadata: { rfc, plan: NOMBRES_PLAN[plan].toLowerCase(), empresa, email_contacto: email, stripe_customer_id: customer.id, stripe_subscription_id: subscriptionId || null },
        });
        credencialesPortal = { email: emailPortal, password: passwordPortal };
      } catch (authErr) {
        // Si el usuario ya existía (cliente que regresa, alta manual previa, o reintento),
        // NO perder el vínculo con Stripe: actualizar la metadata del usuario existente.
        console.error('createUser falló, intentando actualizar usuario existente:', authErr.message || authErr);
        try {
          const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const existente = (usersData?.users || []).find(u =>
            (u.user_metadata?.rfc || '').toUpperCase() === rfc.toUpperCase() ||
            (u.email || '').toLowerCase() === emailPortal.toLowerCase()
          );
          if (existente) {
            await supabase.auth.admin.updateUserById(existente.id, {
              user_metadata: {
                ...existente.user_metadata,
                rfc,
                plan: NOMBRES_PLAN[plan].toLowerCase(),
                empresa,
                email_contacto: email,
                stripe_customer_id: customer.id,
                stripe_subscription_id: subscriptionId || null,
                suscripcion_activa: true,
              },
            });
            console.log('✅ Usuario existente vinculado con Stripe:', rfc, customer.id);
          } else {
            console.error('No se encontró usuario existente para vincular con Stripe:', rfc);
          }
        } catch (updErr) {
          console.error('Aviso: no se pudo vincular el usuario existente con Stripe:', updErr.message || updErr);
        }
      }

      // 6. Enviar email de bienvenida con credenciales del portal (vía Resend)
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
          console.log('Email de bienvenida enviado a', email);
        } catch (emailErr) {
          // El email falló pero el cobro y el alta del portal ya se hicieron — solo registrar el error
          console.error('Aviso: no se pudo enviar el email de bienvenida:', emailErr.message || emailErr);
        }
      }
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
    console.error('Error creando suscripción:', err);
    // Stripe regresa mensajes en inglés técnicos; el mensaje de tarjeta declinada sí es entendible para el usuario
    const mensaje = (err.type === 'StripeCardError') ? err.message : 'No se pudo procesar el pago. Verifique los datos de la tarjeta o intente con otro método de pago.';
    return { statusCode: 402, headers, body: JSON.stringify({ error: mensaje }) };
  }
};
