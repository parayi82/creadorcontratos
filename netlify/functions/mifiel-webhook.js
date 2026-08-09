// netlify/functions/mifiel-webhook.js
//
// Recibe eventos de Mifiel vía webhook y actualiza firmas_electronicas en Supabase.
//
// Eventos manejados:
//   document_closed  — Documento firmado por todos + NOM-151 generada → descarga PDF firmado
//   signer_completed — Un firmante completó
//   signer_rejected  — Un firmante rechazó
//   document_deleted — Documento eliminado
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY,
//                       MIFIEL_APP_ID, MIFIEL_APP_SECRET, MIFIEL_ENV

const { createClient } = require('@supabase/supabase-js');
const { reportError } = require('./_security');

const MIFIEL_BASE = () =>
  process.env.MIFIEL_ENV === 'production'
    ? 'https://app.mifiel.com/api/v1'
    : 'https://app-sandbox.mifiel.com/api/v1';

function mifielAuth() {
  const creds = Buffer.from(`${process.env.MIFIEL_APP_ID}:${process.env.MIFIEL_APP_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'JSON inválido' }; }

  const { event: eventType, data } = payload;
  if (!eventType || !data) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };

  console.log(`[Mifiel webhook] ${eventType}`, JSON.stringify(data).slice(0, 200));

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

          // Buscar el registro para obtener cliente_rfc
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

        // Actualizar registro en Supabase
        await sb.from('firmas_electronicas').update({
          estado: 'firmado',
          signed_at: data.signed_at || new Date().toISOString(),
          signed_pdf_path: pdfPath,
          signed_xml_path: xmlPath,
        }).eq('mifiel_id', mifielId);

        console.log(`✅ Documento ${mifielId} firmado y guardado.`);
        break;
      }

      case 'signer_completed': {
        const mifielId = data.document;
        if (!mifielId) break;

        // Actualizar el firmante en el JSONB firmantes
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
