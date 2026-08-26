// netlify/functions/allsign-download.js
//
// Descarga la evidencia PDF de un documento firmado directamente desde AllSign.
// Evita almacenar el PDF en Supabase — lo sirve como proxy en tiempo real.
//
// GET /api/allsign-download?allsign_id=xxx&cliente_rfc=xxx
// Authorization: Bearer <access_token>

'use strict';

const { handleCors } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

const ALLSIGN_BASE = 'https://api.allsign.io/v2';

// Busca recursivamente cualquier valor que parezca una URL de PDF en un objeto JSON
function encontrarUrlPdf(obj, depth = 0) {
  if (depth > 4 || !obj || typeof obj !== 'object') return null;
  const URL_KEYS = [
    'downloadUrl', 'download_url', 'url', 'pdfUrl', 'pdf_url',
    'evidenceUrl', 'evidence_url', 'fileUrl', 'file_url',
    'signedUrl', 'signed_url', 'link', 'href', 'src',
    'documentUrl', 'document_url', 'certificateUrl', 'certificate_url',
  ];
  for (const k of URL_KEYS) {
    if (obj[k] && typeof obj[k] === 'string' && obj[k].startsWith('http')) return obj[k];
  }
  for (const k of Object.keys(obj)) {
    if (Array.isArray(obj[k])) {
      for (const item of obj[k]) {
        const found = encontrarUrlPdf(item, depth + 1);
        if (found) return found;
      }
    } else if (typeof obj[k] === 'object') {
      const found = encontrarUrlPdf(obj[k], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!process.env.ALLSIGN_API_KEY) {
    return { statusCode: 503, body: JSON.stringify({ error: 'AllSign no configurado.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Token requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  const { allsign_id, cliente_rfc } = event.queryStringParameters || {};
  if (!allsign_id || !cliente_rfc) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan allsign_id y cliente_rfc.' }) };
  }

  const rfcTarget = cliente_rfc.toUpperCase();
  if (!await puedeAccederRFC(sb, uData.user, rfcTarget)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado.' }) };
  }

  // Verificar que el documento existe y pertenece al cliente
  const { data: firma } = await sb
    .from('firmas_electronicas')
    .select('allsign_id, allsign_estado, estado, signed_pdf_path')
    .eq('allsign_id', allsign_id)
    .eq('cliente_rfc', rfcTarget)
    .single();

  if (!firma) return { statusCode: 404, body: JSON.stringify({ error: 'Documento no encontrado.' }) };

  // Si ya tenemos el PDF en Supabase Storage, servirlo desde ahí
  if (firma.signed_pdf_path) {
    const { data: signedUrl } = sb.storage
      .from('expedientes')
      .getPublicUrl(firma.signed_pdf_path);
    if (signedUrl?.publicUrl) {
      const storageRes = await fetch(signedUrl.publicUrl);
      if (storageRes.ok) {
        const buf = Buffer.from(await storageRes.arrayBuffer());
        if (buf.length > 100 && buf.slice(0, 4).toString() === '%PDF') {
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="firma-${allsign_id}.pdf"`,
              'Content-Length': String(buf.length),
            },
            body: buf.toString('base64'),
            isBase64Encoded: true,
          };
        }
      }
    }
  }

  try {
    const debug = {};

    // ── Paso 1: metadatos del documento ────────────────────────────────────────
    const metaRes = await fetch(`${ALLSIGN_BASE}/documents/${allsign_id}`, {
      headers: { Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}` },
    });

    let metaJson = {};
    let metaRaw = '';
    if (metaRes.ok) {
      const ct = metaRes.headers.get('content-type') || '';
      if (ct.includes('json') || ct.includes('text')) {
        metaRaw = await metaRes.text();
        try { metaJson = JSON.parse(metaRaw); } catch { metaJson = {}; }
      } else {
        metaRaw = '(binary)';
      }
    }

    debug.meta = {
      status: metaRes.status,
      ct: metaRes.headers.get('content-type') || '',
      // Incluir contenido completo (truncado a 3000 chars) para diagnóstico
      body: metaRaw.slice(0, 3000),
      keys: Object.keys(metaJson),
    };

    const metaPdfUrl = encontrarUrlPdf(metaJson);
    if (metaPdfUrl) debug.meta.pdfUrl = metaPdfUrl;

    // ── Paso 2: probar endpoints en orden ──────────────────────────────────────
    const candidates = [
      metaPdfUrl && { url: metaPdfUrl, label: 'meta_url' },
      { url: `${ALLSIGN_BASE}/documents/${allsign_id}/evidence`, label: 'evidence' },
      { url: `${ALLSIGN_BASE}/documents/${allsign_id}/download`, label: 'download' },
      { url: `${ALLSIGN_BASE}/documents/${allsign_id}/pdf`, label: 'pdf' },
      { url: `${ALLSIGN_BASE}/documents/${allsign_id}/certificate`, label: 'certificate' },
      { url: `${ALLSIGN_BASE}/documents/${allsign_id}/signed`, label: 'signed' },
    ].filter(Boolean);

    for (const { url: endpoint, label } of candidates) {
      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}`,
          Accept: 'application/pdf, application/octet-stream, */*',
        },
        redirect: 'follow',
      });

      const ct = res.headers.get('content-type') || '';
      const status = res.status;
      debug[label] = { status, ct };

      if (!res.ok) {
        // Capturar body del error para diagnóstico
        try {
          const errText = await res.text();
          debug[label].errorBody = errText.slice(0, 500);
        } catch {}
        continue;
      }

      let pdfBuffer;
      if (ct.includes('application/json') || ct.includes('text/') || !ct) {
        let rawText;
        try { rawText = await res.text(); } catch { continue; }
        debug[label].body = rawText.slice(0, 2000);

        let json = {};
        try { json = JSON.parse(rawText); } catch {
          // Verificar si es PDF en texto (cabecera %PDF)
          if (rawText.startsWith('%PDF')) {
            pdfBuffer = Buffer.from(rawText, 'binary');
          } else {
            continue;
          }
        }

        if (!pdfBuffer) {
          const nextUrl = encontrarUrlPdf(json);
          debug[label].foundUrl = nextUrl || null;
          if (!nextUrl) continue;

          const r2 = await fetch(nextUrl, {
            headers: { Accept: 'application/pdf, */*' },
            redirect: 'follow',
          });
          debug[label].redirect = { status: r2.status, ct: r2.headers.get('content-type') || '' };
          if (!r2.ok) {
            try { debug[label].redirect.errorBody = (await r2.text()).slice(0, 300); } catch {}
            continue;
          }
          pdfBuffer = Buffer.from(await r2.arrayBuffer());
        }
      } else {
        pdfBuffer = Buffer.from(await res.arrayBuffer());
      }

      debug[label].bytes = pdfBuffer.length;
      debug[label].magic = pdfBuffer.slice(0, 8).toString('hex');
      debug[label].header = pdfBuffer.slice(0, 16).toString('latin1').replace(/[^\x20-\x7E]/g, '·');

      if (pdfBuffer.length < 100 || pdfBuffer.slice(0, 4).toString() !== '%PDF') {
        debug[label].invalid = true;
        continue;
      }

      console.log(`[allsign-download] PDF válido desde ${label}: ${pdfBuffer.length} bytes`);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="firma-${allsign_id}.pdf"`,
          'Content-Length': String(pdfBuffer.length),
        },
        body: pdfBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    }

    console.error('[allsign-download] todos los endpoints fallaron:', JSON.stringify(debug));
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No se pudo obtener el PDF firmado desde AllSign.', debug }),
    };

  } catch (err) {
    console.error('[allsign-download] error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, stack: err.stack?.slice(0, 500) }),
    };
  }
};
