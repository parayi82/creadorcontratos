// netlify/functions/crear-cliente-admin.js
//
// (Reconstruida — la versión original se perdió del repositorio local.)
// Alta manual de clientes desde el dashboard admin. PROTEGIDA: requiere
// sesión de administrador (Authorization: Bearer <token>, role 'admin').
//
// POST { rfc, empresa, email, tel, plan, pass, enviarEmail }
//   → crea el usuario del portal con su metadata.
//   Si enviarEmail es true, envía al cliente un correo de recuperación
//   de Supabase para que establezca/confirme su acceso.
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { verificarAdmin } = require('./_admin-auth');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno de Supabase.' }) };
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const responder = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });

  const admin = await verificarAdmin(event, supabase);
  if (!admin) return responder(401, { error: 'No autorizado. Inicie sesión como administrador.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return responder(400, { error: 'JSON inválido' }); }

  const { rfc, empresa, email, tel, plan, pass, enviarEmail } = body;
  if (!rfc || !empresa || !email || !pass) {
    return responder(400, { error: 'RFC, empresa, email y contraseña son obligatorios.' });
  }
  if (pass.length < 8) return responder(400, { error: 'La contraseña debe tener al menos 8 caracteres.' });

  try {
    // El portal inicia sesión con el email sintético derivado del RFC
    // (rfc@clicklaboral.mx). El email de contacto se guarda en metadata
    // y es a donde llega la bienvenida.
    const rfcLimpio = rfc.trim().toUpperCase();
    const emailLogin = `${rfcLimpio.toLowerCase()}@clicklaboral.mx`;
    const emailContacto = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.admin.createUser({
      email: emailLogin,
      password: pass,
      email_confirm: true,
      user_metadata: {
        rfc: rfcLimpio,
        empresa: empresa.trim(),
        plan: (plan || 'estandar').toLowerCase(),
        tel: tel || '',
        email_contacto: emailContacto,
        suscripcion_activa: true,
      },
    });
    if (error) {
      if (/already/i.test(error.message)) return responder(409, { error: 'Ya existe un cliente con ese RFC.' });
      throw error;
    }

    // Email de bienvenida con credenciales al correo de CONTACTO (vía Resend)
    let emailEnviado = false;
    if (enviarEmail && process.env.RESEND_API_KEY) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'ClickLaboral.mx <bienvenida@clicklaboral.mx>',
            to: [emailContacto],
            subject: `Bienvenido a ClickLaboral.mx — Acceso al portal de ${empresa.trim()}`,
            html: `
              <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;">
                <h2 style="color:#0f2640;">¡Bienvenido a ClickLaboral.mx!</h2>
                <p>Su cuenta para <strong>${empresa.trim()}</strong> ya está activa. Estos son sus datos de acceso al portal:</p>
                <div style="background:#f5f4f0;border-radius:10px;padding:18px 22px;margin:18px 0;">
                  <p style="margin:4px 0;"><strong>Portal:</strong> <a href="https://clicklaboral.mx/portal-cliente">clicklaboral.mx/portal-cliente</a></p>
                  <p style="margin:4px 0;"><strong>Usuario (RFC):</strong> ${rfcLimpio}</p>
                  <p style="margin:4px 0;"><strong>Contraseña inicial:</strong> ${pass}</p>
                </div>
                <p>Por seguridad, le recomendamos cambiar su contraseña en el primer acceso desde <strong>Configuración</strong>.</p>
                <p style="font-size:12px;color:#888;margin-top:24px;">Si usted no solicitó esta cuenta, ignore este correo o contáctenos en info@clicklaboral.mx.</p>
              </div>`,
          }),
        });
        emailEnviado = r.ok;
      } catch (_) { emailEnviado = false; }
    }

    return responder(200, { ok: true, id: data.user.id, emailEnviado });
  } catch (e) {
    console.error('crear-cliente-admin:', e.message || e);
    return responder(500, { error: e.message || 'Error interno.' });
  }
};
