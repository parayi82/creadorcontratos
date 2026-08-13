// netlify/functions/notificaciones-laborales.js
// Alertas automáticas de vencimientos laborales — cobertura completa LFT + NOMs
// Cron: https://clicklaboral.mx/api/notificaciones-laborales?secret=EL_VALOR_DE_SU_CRON_SECRET

const { handleCors, clientIp, reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');

const headers = { 'Access-Control-Allow-Origin': 'https://clicklaboral.mx', 'Content-Type': 'application/json' };

exports.handler = async function(event) {
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
  const hoyDate = new Date(hoy + 'T12:00:00');
  const alertas = [];

  try {
    // ══════════════════════════════════════════════════════════════
    // BLOQUE 1 — Alertas por trabajador (basadas en fecha_ingreso)
    // ══════════════════════════════════════════════════════════════
    const { data: trabajadores, error: err1 } = await sb
      .from('trabajadores')
      .select('id, nombre, puesto, fecha_ingreso, cliente_rfc')
      .eq('activo', true)
      .not('fecha_ingreso', 'is', null);

    if (err1) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: err1.message }) };

    for (const t of (trabajadores || [])) {
      const ingreso = new Date(t.fecha_ingreso + 'T12:00:00');
      const dias = Math.floor((hoyDate - ingreso) / 86400000);

      // ── Art. 39-A: Período de prueba general (30 días) ───────────
      if (dias === 23 || dias === 27) {
        alertas.push({
          cliente_rfc: t.cliente_rfc,
          tipo: 'periodo_prueba',
          trabajador_nombre: t.nombre,
          fecha_alerta: hoy,
          mensaje: `El período de prueba de ${t.nombre} vence el ${addDias(t.fecha_ingreso, 30)} (art. 39-A LFT). Confirme o dé por terminada la relación antes de esa fecha.`,
          urgencia: dias >= 27 ? 'alta' : 'media',
          leida: false,
        });
      }

      // ── Art. 39-A: Período de prueba largo (180 días — dirección) ─
      if (dias === 150 || dias === 170) {
        alertas.push({
          cliente_rfc: t.cliente_rfc,
          tipo: 'periodo_prueba_larga',
          trabajador_nombre: t.nombre,
          fecha_alerta: hoy,
          mensaje: `El período de prueba largo de ${t.nombre} (puesto: ${t.puesto || '—'}) vence el ${addDias(t.fecha_ingreso, 180)} (art. 39-A LFT, puestos de dirección). Si no aplica este plazo, ignore esta alerta.`,
          urgencia: dias >= 170 ? 'alta' : 'media',
          leida: false,
        });
      }

      // ── Art. 39-B: Capacitación inicial general (90 días) ────────
      if (dias === 75 || dias === 85) {
        alertas.push({
          cliente_rfc: t.cliente_rfc,
          tipo: 'capacitacion_inicial',
          trabajador_nombre: t.nombre,
          fecha_alerta: hoy,
          mensaje: `El contrato de capacitación inicial de ${t.nombre} vence el ${addDias(t.fecha_ingreso, 90)} (art. 39-B LFT). Evalúe si confirma la contratación definitiva o termina la relación laboral.`,
          urgencia: dias >= 85 ? 'alta' : 'media',
          leida: false,
        });
      }

      // ── Art. 39-B: Capacitación inicial larga (180 días) ─────────
      if (dias === 150 || dias === 170) {
        alertas.push({
          cliente_rfc: t.cliente_rfc,
          tipo: 'capacitacion_inicial_larga',
          trabajador_nombre: t.nombre,
          fecha_alerta: hoy,
          mensaje: `El contrato de capacitación inicial largo de ${t.nombre} vence el ${addDias(t.fecha_ingreso, 180)} (art. 39-B LFT, puestos de dirección). Si no aplica, ignore esta alerta.`,
          urgencia: dias >= 170 ? 'alta' : 'media',
          leida: false,
        });
      }

      // ── Art. 76 + Art. 80: Vacaciones y prima vacacional ─────────
      const anios = hoyDate.getFullYear() - ingreso.getFullYear();
      if (anios > 0) {
        const proximoAniv = new Date(ingreso);
        proximoAniv.setFullYear(hoyDate.getFullYear());
        if (proximoAniv < hoyDate) proximoAniv.setFullYear(hoyDate.getFullYear() + 1);
        const diasAniv = Math.round((proximoAniv - hoyDate) / 86400000);
        const aniosAlAniv = proximoAniv.getFullYear() - ingreso.getFullYear();
        const diasVac = diasVacaciones(aniosAlAniv);

        if (diasAniv === 7) {
          // Prima vacacional (Art. 80)
          alertas.push({
            cliente_rfc: t.cliente_rfc,
            tipo: 'prima_vacacional',
            trabajador_nombre: t.nombre,
            fecha_alerta: hoy,
            mensaje: `${t.nombre} cumple ${aniosAlAniv} año(s) el ${fmtFecha(proximoAniv.toISOString().split('T')[0])}. Prepare el pago de prima vacacional (mínimo 25% sobre ${diasVac} días de vacaciones — art. 80 LFT).`,
            urgencia: 'media',
            leida: false,
          });
          // Recordatorio de vacaciones (Art. 76)
          alertas.push({
            cliente_rfc: t.cliente_rfc,
            tipo: 'vacaciones',
            trabajador_nombre: t.nombre,
            fecha_alerta: hoy,
            mensaje: `${t.nombre} cumple ${aniosAlAniv} año(s) el ${fmtFecha(proximoAniv.toISOString().split('T')[0])}. Le corresponden ${diasVac} días de vacaciones (art. 76 LFT). Acuerde el período vacacional dentro de los 6 meses siguientes.`,
            urgencia: 'baja',
            leida: false,
          });
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // BLOQUE 2 — Alertas anuales de fecha fija (aguinaldo, PTU)
    // ══════════════════════════════════════════════════════════════
    const mes = hoyDate.getMonth() + 1; // 1-12
    const dia = hoyDate.getDate();

    // Obtener RFCs con trabajadores activos para alertas globales
    const rfcsActivos = [...new Set((trabajadores || []).map(t => t.cliente_rfc))];

    for (const rfc of rfcsActivos) {
      const trabsRFC = (trabajadores || []).filter(t => t.cliente_rfc === rfc);

      // ── Art. 87: Aguinaldo — pago antes del 20 de diciembre ──────
      if (mes === 12 && (dia === 1 || dia === 10)) {
        const conDerecho = trabsRFC.filter(t => {
          const ingreso = new Date(t.fecha_ingreso + 'T12:00:00');
          return Math.floor((hoyDate - ingreso) / 86400000) >= 60; // > 2 meses
        });
        if (conDerecho.length > 0) {
          alertas.push({
            cliente_rfc: rfc,
            tipo: 'aguinaldo',
            trabajador_nombre: null,
            fecha_alerta: hoy,
            mensaje: `Aguinaldo 2025 (art. 87 LFT): tiene ${conDerecho.length} trabajador(es) con derecho. Debe pagarse a más tardar el 20 de diciembre. Mínimo 15 días de salario por año completo; proporcional si tienen menos de 1 año.`,
            urgencia: dia >= 10 ? 'alta' : 'media',
            leida: false,
          });
        }
      }

      // ── Art. 122: PTU — pago antes del 31 de mayo ────────────────
      if (mes === 5 && (dia === 1 || dia === 20)) {
        if (trabsRFC.length > 0) {
          alertas.push({
            cliente_rfc: rfc,
            tipo: 'ptu',
            trabajador_nombre: null,
            fecha_alerta: hoy,
            mensaje: `PTU ${hoyDate.getFullYear()} (art. 122 LFT): fecha límite de pago para personas morales es el 31 de mayo. Si aún no ha determinado el monto, reúna a la Comisión Mixta de PTU de inmediato.`,
            urgencia: dia >= 20 ? 'alta' : 'media',
            leida: false,
          });
        }
      }

      // ── Art. 125: Comisión Mixta PTU — constituir en marzo ───────
      if (mes === 3 && dia === 1) {
        if (trabsRFC.length > 0) {
          alertas.push({
            cliente_rfc: rfc,
            tipo: 'comision_ptu',
            trabajador_nombre: null,
            fecha_alerta: hoy,
            mensaje: `Comisión Mixta de PTU (art. 125 LFT): debe integrarse en marzo de cada año para determinar la participación de utilidades del ejercicio anterior. Genere el acta en ClickLaboral → Comisiones Mixtas → PTU.`,
            urgencia: 'media',
            leida: false,
          });
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // BLOQUE 3 — Alertas de comisiones mixtas (desde tabla comisiones_mixtas)
    // ══════════════════════════════════════════════════════════════
    const { data: comisiones, error: errCom } = await sb
      .from('comisiones_mixtas')
      .select('cliente_rfc, tipo, fecha_constitucion, nombre_empresa')
      .eq('activa', true);

    if (!errCom) {
      for (const c of (comisiones || [])) {
        const fCon = new Date(c.fecha_constitucion + 'T12:00:00');
        const empresa = c.nombre_empresa || c.cliente_rfc;

        if (c.tipo === 'sh') {
          // Sesiones mensuales S&H — alerta 5 días antes del día mensual
          const diaConst = fCon.getDate();
          const proximaSesion = new Date(hoyDate.getFullYear(), hoyDate.getMonth(), diaConst);
          if (proximaSesion <= hoyDate) proximaSesion.setMonth(proximaSesion.getMonth() + 1);
          const diasSesion = Math.round((proximaSesion - hoyDate) / 86400000);
          if (diasSesion === 5) {
            alertas.push({
              cliente_rfc: c.cliente_rfc,
              tipo: 'sesion_sh',
              trabajador_nombre: null,
              fecha_alerta: hoy,
              mensaje: `Comisión S&H de ${empresa}: sesión mensual programada para el ${fmtFecha(proximaSesion.toISOString().split('T')[0])} (art. 509 LFT + NOM-019-STPS-2011). Convoque a los integrantes y prepare el acta en ClickLaboral → Comisiones Mixtas → S&H.`,
              urgencia: 'media',
              leida: false,
            });
          }
        }

        if (c.tipo === 'cap') {
          // Sesiones trimestrales de Capacitación — alerta 7 días antes
          const mesesDesde = (hoyDate.getFullYear() - fCon.getFullYear()) * 12 + (hoyDate.getMonth() - fCon.getMonth());
          const proximoTrimestre = Math.ceil((mesesDesde + 1) / 3) * 3;
          const proximaSesion = new Date(fCon);
          proximaSesion.setMonth(fCon.getMonth() + proximoTrimestre);
          const diasSesion = Math.round((proximaSesion - hoyDate) / 86400000);
          if (diasSesion === 7) {
            alertas.push({
              cliente_rfc: c.cliente_rfc,
              tipo: 'sesion_cap',
              trabajador_nombre: null,
              fecha_alerta: hoy,
              mensaje: `Comisión de Capacitación de ${empresa}: sesión trimestral programada para el ${fmtFecha(proximaSesion.toISOString().split('T')[0])} (art. 153-E LFT). Prepare el informe de avances del plan de capacitación y el acta de sesión.`,
              urgencia: 'media',
              leida: false,
            });
          }
        }

        if (c.tipo === 'rit') {
          // Revisión bienal del Reglamento Interior — Art. 424 LFT
          const aniosDesde = Math.floor((hoyDate - fCon) / (86400000 * 365.25));
          const proximaRevision = new Date(fCon);
          proximaRevision.setFullYear(fCon.getFullYear() + Math.ceil((aniosDesde + 1) / 2) * 2);
          const diasRevision = Math.round((proximaRevision - hoyDate) / 86400000);
          if (diasRevision === 60 || diasRevision === 30) {
            alertas.push({
              cliente_rfc: c.cliente_rfc,
              tipo: 'revision_rit',
              trabajador_nombre: null,
              fecha_alerta: hoy,
              mensaje: `Comisión de Reglamento Interior de ${empresa}: revisión bienal en ${diasRevision} días (${fmtFecha(proximaRevision.toISOString().split('T')[0])}) — art. 424 LFT. Inicie el proceso de revisión con la comisión mixta.`,
              urgencia: diasRevision <= 30 ? 'alta' : 'media',
              leida: false,
            });
          }
        }

        if (c.tipo === 'nom035') {
          // Evaluación bienal NOM-035-STPS-2018
          const aniosDesde = Math.floor((hoyDate - fCon) / (86400000 * 365.25));
          const proximaEval = new Date(fCon);
          proximaEval.setFullYear(fCon.getFullYear() + Math.ceil((aniosDesde + 1) / 2) * 2);
          const diasEval = Math.round((proximaEval - hoyDate) / 86400000);
          if (diasEval === 60 || diasEval === 30) {
            alertas.push({
              cliente_rfc: c.cliente_rfc,
              tipo: 'nom035',
              trabajador_nombre: null,
              fecha_alerta: hoy,
              mensaje: `NOM-035-STPS-2018 de ${empresa}: evaluación bienal de factores de riesgo psicosocial en ${diasEval} días (${fmtFecha(proximaEval.toISOString().split('T')[0])}). Aplique las guías de referencia y documente resultados.`,
              urgencia: diasEval <= 30 ? 'alta' : 'media',
              leida: false,
            });
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // GUARDAR y ENVIAR
    // ══════════════════════════════════════════════════════════════
    if (alertas.length > 0) {
      await sb.from('alertas_laborales').upsert(alertas, {
        onConflict: 'cliente_rfc,tipo,trabajador_nombre,fecha_alerta',
        ignoreDuplicates: true,
      });
    }

    let emailsEnviados = 0;
    if (RESEND_KEY && alertas.length > 0) {
      const porRFC = {};
      alertas.forEach(a => { (porRFC[a.cliente_rfc] = porRFC[a.cliente_rfc] || []).push(a); });

      for (const [rfc, items] of Object.entries(porRFC)) {
        try {
          const { data: billing } = await sb
            .from('clientes_billing')
            .select('auth_user_id')
            .eq('rfc', rfc.toUpperCase())
            .maybeSingle();
          if (!billing?.auth_user_id) continue;
          const { data: { user: usuario } } = await sb.auth.admin.getUserById(billing.auth_user_id);
          if (!usuario) continue;
          const rawEmail = usuario?.user_metadata?.email_contacto || usuario?.email || '';
          const email = rawEmail.endsWith('@clicklaboral.mx') ? null : rawEmail;
          if (!email) continue;

          const ICONOS = {
            periodo_prueba: '⚠️',
            periodo_prueba_larga: '⚠️',
            capacitacion_inicial: '🎓',
            capacitacion_inicial_larga: '🎓',
            prima_vacacional: '🌴',
            vacaciones: '📅',
            aguinaldo: '🎁',
            ptu: '💰',
            comision_ptu: '⚖️',
            sesion_sh: '🦺',
            sesion_cap: '🎓',
            revision_rit: '📖',
            nom035: '🧠',
          };

          const ETIQUETAS = {
            periodo_prueba: 'Período de prueba próximo a vencer',
            periodo_prueba_larga: 'Período de prueba largo próximo a vencer',
            capacitacion_inicial: 'Capacitación inicial próxima a vencer',
            capacitacion_inicial_larga: 'Capacitación inicial larga próxima a vencer',
            prima_vacacional: 'Prima vacacional próxima',
            vacaciones: 'Vacaciones por programar',
            aguinaldo: 'Aguinaldo — pago próximo',
            ptu: 'PTU — fecha límite de pago',
            comision_ptu: 'Comisión Mixta PTU — integrar',
            sesion_sh: 'Sesión mensual S&H',
            sesion_cap: 'Sesión trimestral Capacitación',
            revision_rit: 'Revisión bienal Reglamento Interior',
            nom035: 'Evaluación NOM-035 — próxima',
          };

          const itemsHTML = items.map(a =>
            `<div style="border-left:4px solid ${a.urgencia==='alta'?'#dc2626':a.urgencia==='media'?'#d97706':'#059669'};padding:12px 16px;margin-bottom:10px;background:#fafafa;border-radius:0 8px 8px 0;">
              <div style="font-weight:700;color:#111;margin-bottom:4px;">${ICONOS[a.tipo]||'📋'} ${ETIQUETAS[a.tipo]||a.tipo}${a.trabajador_nombre?` — ${a.trabajador_nombre}`:''}</div>
              <div style="font-size:13px;color:#444;line-height:1.5;">${a.mensaje}</div>
            </div>`
          ).join('');

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'ClickLaboral <alertas@clicklaboral.mx>',
              to: email,
              subject: `📋 ${items.length} alerta(s) laboral(es) — ${usuario?.user_metadata?.empresa || rfc}`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:#0f2640;padding:20px 24px;border-radius:10px 10px 0 0;">
                  <div style="font-size:16px;font-weight:800;color:#fff;">ClickLaboral<span style="color:#c5dcf5;font-weight:400;">.mx</span></div>
                  <div style="font-size:12px;color:#c5dcf5;margin-top:4px;">Sistema de alertas laborales</div>
                </div>
                <div style="padding:24px;background:#fff;border:1px solid #eee;border-radius:0 0 10px 10px;">
                  <p style="margin-bottom:16px;color:#444;font-size:14px;">Tiene <strong>${items.length} alerta(s)</strong> que requieren atención hoy:</p>
                  ${itemsHTML}
                  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:12px;color:#0c4a6e;">
                    💡 Para marcar alertas como leídas y ver el historial completo, acceda a su Portal de Cliente.
                  </div>
                  <div style="text-align:center;margin-top:20px;">
                    <a href="https://clicklaboral.mx/portal-cliente.html" style="background:#0f2640;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Ir a mi portal →</a>
                  </div>
                </div>
              </div>`,
            }),
          });
          const resendData = await resendRes.json();
          if (!resendRes.ok) {
            console.error('Resend error:', JSON.stringify({ status: resendRes.status, body: resendData, rfc, email }));
          } else {
            emailsEnviados++;
          }
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

// ── Utilidades ──────────────────────────────────────────────────────────────

function addDias(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

function fmtFecha(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function diasVacaciones(anios) {
  // Art. 76 LFT: tabla de vacaciones según antigüedad
  if (anios <= 0) return 0;
  if (anios === 1) return 12;
  if (anios === 2) return 14;
  if (anios === 3) return 16;
  if (anios === 4) return 18;
  // A partir del 5o año: 12 + 2 por cada año completado, o
  // a partir del 5o año según la tabla actual: 20 días en el 5to, luego +2 cada 5 años
  // Tabla exacta LFT (reforma 2023): 1=12, 2=14, 3=16, 4=18, 5=20, 6-10=22, 11-15=24, 16-20=26, 21-25=28, 26-30=30, 31-35=32
  if (anios <= 5) return 20;
  if (anios <= 10) return 22;
  if (anios <= 15) return 24;
  if (anios <= 20) return 26;
  if (anios <= 25) return 28;
  if (anios <= 30) return 30;
  return 32;
}
