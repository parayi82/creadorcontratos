// netlify/functions/notificaciones-laborales.js
// Alertas automáticas de vencimientos laborales
// Cron: https://clicklaboral.mx/api/notificaciones-laborales?secret=EL_VALOR_DE_SU_CRON_SECRET

const { createClient } = require('@supabase/supabase-js');

const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async function(event) {
  // Seguridad
  // Sin fallback: si CRON_SECRET no está configurado en Netlify, la función no
  // corre. Antes usaba un valor por defecto que estaba escrito aquí en el código.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET no está configurado en las variables de entorno de Netlify.');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'El servidor no está configurado (falta CRON_SECRET).' }) };
  }
  const q = event.queryStringParameters || {};
  const auth = (event.headers || {})['authorization'] || '';
  if (q.secret !== secret && auth !== 'Bearer ' + secret) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!SUPA_URL || !SUPA_KEY) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Variables de entorno faltantes: SUPABASE_URL o SUPABASE_SERVICE_KEY' }) };
  }

  const sb = createClient(SUPA_URL, SUPA_KEY);
  const hoy = new Date().toISOString().split('T')[0];
  const alertas = [];

  try {
    // ── Obtener trabajadores activos con fecha de ingreso ─────────────────────
    const { data: trabajadores, error: err1 } = await sb
      .from('trabajadores')
      .select('id, nombre, puesto, fecha_ingreso, cliente_rfc')
      .eq('activo', true)
      .not('fecha_ingreso', 'is', null);

    if (err1) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: err1.message }) };

    const hoyDate = new Date(hoy + 'T12:00:00');

    for (const t of (trabajadores || [])) {
      const ingreso = new Date(t.fecha_ingreso + 'T12:00:00');
      const diasDesdeIngreso = Math.floor((hoyDate - ingreso) / 86400000);

      // Período de prueba: 30 días (Art. 47 LFT)
      if (diasDesdeIngreso === 23 || diasDesdeIngreso === 27) { // aviso a 7 y 3 días del vencimiento
        alertas.push({
          cliente_rfc: t.cliente_rfc,
          tipo: 'periodo_prueba',
          trabajador_nombre: t.nombre,
          fecha_alerta: hoy,
          mensaje: `El período de prueba de ${t.nombre} vence el ${addDias(t.fecha_ingreso, 30)}. Confirme o dé por terminada la relación laboral antes de esa fecha.`,
          urgencia: diasDesdeIngreso >= 27 ? 'alta' : 'media',
          leida: false,
        });
      }

      // Aniversario laboral (prima vacacional) — avisar 7 días antes
      const anios = hoyDate.getFullYear() - ingreso.getFullYear();
      if (anios > 0) {
        const proximoAniv = new Date(ingreso);
        proximoAniv.setFullYear(hoyDate.getFullYear());
        if (proximoAniv < hoyDate) proximoAniv.setFullYear(hoyDate.getFullYear() + 1);
        const diasAniv = Math.round((proximoAniv - hoyDate) / 86400000);
        if (diasAniv === 7) {
          alertas.push({
            cliente_rfc: t.cliente_rfc,
            tipo: 'prima_vacacional',
            trabajador_nombre: t.nombre,
            fecha_alerta: hoy,
            mensaje: `${t.nombre} cumple ${proximoAniv.getFullYear() - ingreso.getFullYear()} año(s) el ${fmtFecha(proximoAniv.toISOString().split('T')[0])}. Prepare el pago de prima vacacional (Art. 80 LFT).`,
            urgencia: 'media',
            leida: false,
          });
        }
      }
    }

    // ── Insertar alertas en Supabase ──────────────────────────────────────────
    if (alertas.length > 0) {
      await sb.from('alertas_laborales').upsert(alertas, {
        onConflict: 'cliente_rfc,tipo,trabajador_nombre,fecha_alerta'
      });
    }

    // ── Enviar email por cada RFC único con alertas ───────────────────────────
    let emailsEnviados = 0;
    if (RESEND_KEY && alertas.length > 0) {
      const porRFC = {};
      alertas.forEach(a => { (porRFC[a.cliente_rfc] = porRFC[a.cliente_rfc] || []).push(a); });

      for (const [rfc, items] of Object.entries(porRFC)) {
        // Obtener email del cliente via Admin API
        try {
          const res = await fetch(`${SUPA_URL}/auth/v1/admin/users?filter=${encodeURIComponent(rfc)}`, {
            headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
          });
          const json = await res.json();
          const usuario = (json.users || []).find(u => u.user_metadata?.rfc === rfc);
          const email = usuario?.user_metadata?.email_contacto || usuario?.email;
          if (!email) continue;

          const itemsHTML = items.map(a =>
            `<div style="border-left:4px solid ${a.urgencia==='alta'?'#dc2626':'#d97706'};padding:12px 16px;margin-bottom:10px;background:#fafafa;border-radius:0 8px 8px 0;">
              <div style="font-weight:700;color:#111;margin-bottom:4px;">${a.tipo === 'periodo_prueba' ? '⚠️ Período de prueba próximo a vencer' : '📅 Prima vacacional próxima'}</div>
              <div style="font-size:13px;color:#444;">${a.mensaje}</div>
            </div>`
          ).join('');

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'ClickLaboral <alertas@clicklaboral.mx>',
              to: email,
              subject: `⚠️ ${items.length} alerta(s) laboral(es) — ${usuario?.user_metadata?.empresa || rfc}`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:#0f2640;padding:20px 24px;border-radius:10px 10px 0 0;">
                  <div style="font-size:16px;font-weight:800;color:#fff;">ClickLaboral<span style="color:#c5dcf5;font-weight:400;">.mx</span></div>
                </div>
                <div style="padding:24px;background:#fff;border:1px solid #eee;border-radius:0 0 10px 10px;">
                  <p style="margin-bottom:16px;color:#444;font-size:14px;">Tiene <strong>${items.length} alerta(s)</strong> que requieren atención:</p>
                  ${itemsHTML}
                  <div style="text-align:center;margin-top:20px;">
                    <a href="https://clicklaboral.mx/portal-cliente.html" style="background:#0f2640;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Ir a mi portal →</a>
                  </div>
                </div>
              </div>`,
            }),
          });
          emailsEnviados++;
        } catch(e) { console.error('Email error:', e.message); }
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, fecha: hoy, alertas_generadas: alertas.length, emails_enviados: emailsEnviados }),
    };

  } catch(e) {
    console.error('Error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

function addDias(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

function fmtFecha(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}
