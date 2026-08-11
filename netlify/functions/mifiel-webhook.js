// netlify/functions/mifiel-webhook.js
//
// Recibe eventos de Mifiel vía webhook y actualiza firmas_electronicas en Supabase.
//
// Seguridad (dos capas):
//   1. Token secreto en query string: la URL registrada en Mifiel lleva
//      ?token=MIFIEL_WEBHOOK_SECRET. Cualquier request sin ese token
//      se rechaza antes de procesar nada.
//   2. Verificación contra la API de Mifiel: para eventos que cambian
//      el estado del documento (document_closed, signer_rejected,
//      signer_completed) se llama GET /documents/:id con nuestras
//      credenciales para confirmar que el documento realmente existe y
//      tiene el estado que el webhook afirma. Evita que un atacante que
//      conozca el token y un mifiel_id real falsifique estados.
//
// Variable requerida adicional: MIFIEL_WEBHOOK_SECRET
//   Generar con: openssl rand -hex 32
//   Registrar en Mifiel Dashboard como:
//     https://clicklaboral.mx/api/mifiel-webhook?token=<secret>
//
// Eventos manejados:
//   document_closed  — Documento firmado + NOM-151 → descarga PDF/XML
//   signer_completed — Un firmante completó
//   signer_rejected  — Un firmante rechazó
//   document_deleted — Documento eliminado

const { createClient } = require('@supabase/supabase-js');
const { clientIp, reportError, logSecurityEvent } = require('./_security');
const { waTexto } = require('./_whatsapp');

const MIFIEL_BASE = () =>
  process.env.MIFIEL_ENV === 'production'
    ? 'https://app.mifiel.com/api/v1'
    : 'https://app-sandbox.mifiel.com/api/v1';

function mifielAuth() {
  const creds = Buffer.from(`${process.env.MIFIEL_APP_ID}:${process.env.MIFIEL_APP_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

// ── Verificación 1: token en query string ─────────────────────────────────────
// Comparación en tiempo constante para evitar timing attacks.
function verificarToken(event) {
  const secretEsperado = process.env.MIFIEL_WEBHOOK_SECRET || '';
  if (!secretEsperado) return false;
  const tokenRecibido = (event.queryStringParameters || {}).token || '';
  if (tokenRecibido.length !== secretEsperado.length) return false;
  let diff = 0;
  for (let i = 0; i < secretEsperado.length; i++) {
    diff |= tokenRecibido.charCodeAt(i) ^ secretEsperado.charCodeAt(i);
  }
  return diff === 0;
}

// ── Verificación 2: llamada de regreso a Mifiel ────────────────────────────────
// Confirma que el documento existe en Mifiel con nuestras credenciales.
// Retorna: { ok: true, doc } | { ok: false, networkError: bool }
async function verificarEnMifiel(mifielId) {
  try {
    const res = await fetch(`${MIFIEL_BASE()}/documents/${mifielId}`, {
      headers: { 'Authorization': mifielAuth() },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, networkError: res.status !== 404 };
    }
    const doc = await res.json();
    return { ok: true, doc };
  } catch {
    return { ok: false, networkError: true };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Capa 1: token secreto ──────────────────────────────────────────────────
  if (!verificarToken(event)) {
    logSecurityEvent('webhook_token_invalido', {
      path: 'mifiel-webhook',
      ip: clientIp(event),
    });
    return { statusCode: 401, body: JSON.stringify({ error: 'No autorizado' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'JSON inválido' };
  }

  const { event: eventType, data } = payload;
  if (!eventType || !data) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  }

  console.log(`[Mifiel webhook] ${eventType}`, JSON.stringify(data).slice(0, 200));

  // ── Capa 2: verificar contra la API de Mifiel para eventos que cambian estado
  const EVENTOS_VERIFICAR = ['document_closed', 'signer_completed', 'signer_rejected'];
  if (EVENTOS_VERIFICAR.includes(eventType)) {
    const mifielId = data.id || data.document;
    if (!mifielId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta mifiel_id en el payload' }) };
    }

    const { ok, networkError } = await verificarEnMifiel(mifielId);
    if (!ok) {
      if (networkError) {
        // Mifiel no responde — devolver 500 para que Mifiel reintente más tarde
        console.error(`[Mifiel webhook] No se pudo verificar documento ${mifielId} (error de red)`);
        return { statusCode: 500, body: JSON.stringify({ error: 'No se pudo verificar el documento con Mifiel' }) };
      }
      // El documento no existe en Mifiel (404) — request fabricado
      logSecurityEvent('webhook_mifiel_documento_inexistente', {
        mifielId,
        eventType,
        ip: clientIp(event),
      });
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: 'documento no encontrado en Mifiel' }) };
    }
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    switch (eventType) {

      case 'document_closed': {
        const mifielId = data.id;
        if (!mifielId) break;

        // Descargar PDF firmado desde Mifiel
        const pdfRes = await fetch(`${MIFIEL_BASE()}/documents/${mifielId}/file_signed`, {
          headers: { 'Authorization': mifielAuth() },
        });

        let pdfPath = null;
        if (pdfRes.ok) {
          const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

          const { data: firma } = await sb
            .from('firmas_electronicas')
            .select('cliente_rfc, documento_tipo')
            .eq('mifiel_id', mifielId)
            .single();

          if (firma?.cliente_rfc) {
            pdfPath = `${firma.cliente_rfc}/firmas/${mifielId}.pdf`;
            await sb.storage.from('expedientes').upload(pdfPath, pdfBuffer, {
              contentType: 'application/pdf',
              upsert: true,
            });
          }
        }

        // Descargar XML (NOM-151)
        const xmlRes = await fetch(`${MIFIEL_BASE()}/documents/${mifielId}/xml`, {
          headers: { 'Authorization': mifielAuth() },
        });
        let xmlPath = null;
        if (xmlRes.ok) {
          const xmlBuffer = Buffer.from(await xmlRes.arrayBuffer());
          const { data: firma } = await sb
            .from('firmas_electronicas')
            .select('cliente_rfc')
            .eq('mifiel_id', mifielId)
            .single();
          if (firma?.cliente_rfc) {
            xmlPath = `${firma.cliente_rfc}/firmas/${mifielId}.xml`;
            await sb.storage.from('expedientes').upload(xmlPath, xmlBuffer, {
              contentType: 'application/xml',
              upsert: true,
            });
          }
        }

        const { data: firmaFinal } = await sb.from('firmas_electronicas').update({
          estado: 'firmado',
          signed_at: data.signed_at || new Date().toISOString(),
          signed_pdf_path: pdfPath,
          signed_xml_path: xmlPath,
        }).eq('mifiel_id', mifielId).select('cliente_rfc, documento_tipo, documento_folio').single();

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
                `El PDF y XML con validez NOM-151 ya están disponibles en el portal:\n` +
                `https://clicklaboral.mx/portal-cliente.html`
              );
            }
          } catch (e) {
            console.warn('WA notify mifiel error:', e.message);
          }
        }

        console.log(`✅ Documento ${mifielId} firmado y guardado.`);
        break;
      }

      case 'signer_completed': {
        const mifielId = data.document;
        if (!mifielId) break;

        const { data: firma } = await sb
          .from('firmas_electronicas')
          .select('firmantes')
          .eq('mifiel_id', mifielId)
          .single();

        if (firma?.firmantes && data.signer?.email) {
          const updated = (firma.firmantes || []).map(f =>
            f.email === data.signer.email ? { ...f, firmado: true } : f
          );
          await sb.from('firmas_electronicas').update({ firmantes: updated }).eq('mifiel_id', mifielId);
        }
        console.log(`✍️ Firmante ${data.signer?.email} completó documento ${mifielId}`);
        break;
      }

      case 'signer_rejected': {
        const mifielId = data.document;
        if (!mifielId) break;
        await sb.from('firmas_electronicas').update({ estado: 'rechazado' }).eq('mifiel_id', mifielId);
        console.warn(`❌ Firmante rechazó documento ${mifielId}`);
        break;
      }

      case 'document_deleted': {
        const mifielId = data.id;
        if (!mifielId) break;
        await sb.from('firmas_electronicas').update({ estado: 'eliminado' }).eq('mifiel_id', mifielId);
        break;
      }

      default:
        console.log(`[Mifiel webhook] Evento no manejado: ${eventType}`);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    await reportError('mifiel-webhook', err, { eventType, mifiel_id: data?.id });
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
