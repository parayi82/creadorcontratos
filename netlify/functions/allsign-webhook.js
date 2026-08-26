// netlify/functions/allsign-webhook.js
//
// Recibe eventos de AllSign vía webhook y actualiza firmas_electronicas en Supabase.
//
// Seguridad (dos capas):
//   1. HMAC-SHA256: AllSign envía X-AllSign-Signature con firma del payload.
//      Se verifica contra ALLSIGN_WEBHOOK_SECRET antes de procesar nada.
//   2. Lookup en Supabase por allsign_id para confirmar que el documento
//      existe localmente antes de actualizar estado.
//
// Variable requerida: ALLSIGN_WEBHOOK_SECRET
//   Generar con: openssl rand -hex 32
//   Registrar en AllSign Dashboard → Developers → Webhooks → Secreto
//
// Eventos manejados:
//   document.completed  — Todas las partes firmaron, evidencia PDF lista
//   document.expired    — Documento expiró sin completarse
//   signer.signed       — Un firmante individual completó
//
// URL a registrar en AllSign:
//   https://clicklaboral.mx/api/allsign-webhook

'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { clientIp, reportError, logSecurityEvent } = require('./_security');
const { waTexto } = require('./_whatsapp');

const ALLSIGN_BASE = () =>
  process.env.ALLSIGN_ENV === 'production'
    ? 'https://api.allsign.io/v1'
    : 'https://api-sandbox.allsign.io/v1';

function allsignAuth() {
  return `Bearer ${process.env.ALLSIGN_API_KEY}`;
}

// ── Verificación HMAC-SHA256 ──────────────────────────────────────────────────
// AllSign envía X-AllSign-Signature = HMAC-SHA256(payload, ALLSIGN_WEBHOOK_SECRET).
// Comparación en tiempo constante para evitar timing attacks.
function verificarFirmaHmac(event) {
  const secret = process.env.ALLSIGN_WEBHOOK_SECRET || '';
  if (!secret) return false;

  const firmaRecibida = (event.headers?.['x-allsign-signature'] || event.headers?.['X-AllSign-Signature'] || '').trim();
  if (!firmaRecibida) return false;

  const firmaEsperada = crypto
    .createHmac('sha256', secret)
    .update(event.body || '', 'utf8')
    .digest('hex');

  if (firmaRecibida.length !== firmaEsperada.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(firmaRecibida, 'hex'),
    Buffer.from(firmaEsperada, 'hex'),
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Capa 1: verificación HMAC ────────────────────────────────────────────────
  if (!verificarFirmaHmac(event)) {
    logSecurityEvent('webhook_allsign_firma_invalida', {
      path: 'allsign-webhook',
      ip: clientIp(event),
    });
    return { statusCode: 401, body: JSON.stringify({ error: 'Firma HMAC inválida' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'JSON inválido' };
  }

  // AllSign envía: { event: "document.completed", data: { id, ... } }
  const { event: eventType, data } = payload;
  if (!eventType || !data) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  }

  console.log(`[AllSign webhook] ${eventType} id=${data.id || '?'}`);

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    switch (eventType) {

      case 'document.completed': {
        const allsignId = data.id;
        if (!allsignId) break;

        // Descargar evidencia PDF firmada desde AllSign
        // Endpoint exacto a confirmar con la documentación de AllSign
        const pdfRes = await fetch(`${ALLSIGN_BASE()}/documents/${allsignId}/evidence`, {
          headers: { 'Authorization': allsignAuth() },
        });

        let pdfPath = null;
        if (pdfRes.ok) {
          const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

          const { data: firma } = await sb
            .from('firmas_electronicas')
            .select('cliente_rfc, documento_tipo, documento_folio')
            .eq('allsign_id', allsignId)
            .single();

          if (firma?.cliente_rfc) {
            pdfPath = `${firma.cliente_rfc}/firmas/${allsignId}.pdf`;
            await sb.storage.from('expedientes').upload(pdfPath, pdfBuffer, {
              contentType: 'application/pdf',
              upsert: true,
            });
          }
        }

        const { data: firmaFinal } = await sb
          .from('firmas_electronicas')
          .update({
            estado: 'firmado',
            signed_at: data.completed_at || data.updated_at || new Date().toISOString(),
            signed_pdf_path: pdfPath,
          })
          .eq('allsign_id', allsignId)
          .select('cliente_rfc, documento_tipo, documento_folio')
          .single();

        // Notificar al cliente por WhatsApp
        if (firmaFinal?.cliente_rfc) {
          try {
            const emailLogin = `${firmaFinal.cliente_rfc.toLowerCase()}@clicklaboral.mx`;
            const { data: { user: clienteUser } } = await sb.auth.admin.getUserByEmail(emailLogin);
            const tel = clienteUser?.user_metadata?.tel;
            if (tel) {
              const docDesc = [firmaFinal.documento_tipo, firmaFinal.documento_folio].filter(Boolean).join(' — ');
              await waTexto(tel,
                `✅ *ClickLaboral.mx* — Documento firmado exitosamente.\n\n` +
                (docDesc ? `📄 ${docDesc}\n\n` : '') +
                `El PDF con evidencia de firma ya está disponible en el portal:\n` +
                `https://clicklaboral.mx/portal-cliente.html`
              );
            }
          } catch (e) {
            console.warn('WA notify allsign error:', e.message);
          }
        }

        console.log(`✅ AllSign documento ${allsignId} completado y guardado.`);
        break;
      }

      case 'signer.signed': {
        // Un firmante individual completó — actualizar estado del firmante en el array
        const allsignId = data.document_id || data.document;
        if (!allsignId) break;

        const { data: firma } = await sb
          .from('firmas_electronicas')
          .select('firmantes')
          .eq('allsign_id', allsignId)
          .single();

        if (firma?.firmantes && data.signer?.email) {
          const updated = (firma.firmantes || []).map(f =>
            f.email === data.signer.email ? { ...f, firmado: true } : f
          );
          await sb.from('firmas_electronicas').update({ firmantes: updated }).eq('allsign_id', allsignId);
        }
        console.log(`✍️ AllSign firmante ${data.signer?.email} completó documento ${allsignId}`);
        break;
      }

      case 'document.expired': {
        const allsignId = data.id;
        if (!allsignId) break;
        await sb.from('firmas_electronicas').update({ estado: 'expirado' }).eq('allsign_id', allsignId);
        console.warn(`⏰ AllSign documento ${allsignId} expiró.`);
        break;
      }

      default:
        // document.created, document.fill_started, document.ready_to_sign,
        // signer.fill_completed, onboarding.completed, signature.reminder_sent
        // — informativos, sin acción requerida
        console.log(`[AllSign webhook] Evento informativo no manejado: ${eventType}`);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    reportError('allsign-webhook', err, { eventType, allsign_id: data?.id }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
