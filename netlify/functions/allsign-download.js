// netlify/functions/allsign-download.js
//
// Descarga la evidencia PDF de un documento firmado directamente desde AllSign.
// Evita almacenar el PDF en Supabase — lo sirve como proxy en tiempo real.
//
// GET /api/allsign-download?allsign_id=xxx&cliente_rfc=xxx
// Authorization: Bearer <access_token>

'use strict';

const { handleCors, clientIp } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

const ALLSIGN_BASE = 'https://api.allsign.io/v2';

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
    .select('allsign_id, allsign_estado, estado')
    .eq('allsign_id', allsign_id)
    .eq('cliente_rfc', rfcTarget)
    .single();

  if (!firma) return { statusCode: 404, body: JSON.stringify({ error: 'Documento no encontrado.' }) };

  try {
    const debug = {};

    // Paso 1: obtener metadatos del documento para encontrar URL de descarga
    const metaRes = await fetch(`${ALLSIGN_BASE}/documents/${allsign_id}`, {
      headers: { Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}` },
    });
    const metaJson = metaRes.ok ? await metaRes.json() : {};
    debug.meta = { status: metaRes.status, keys: Object.keys(metaJson) };

    // Buscar URL de descarga en los metadatos
    const metaPdfUrl = metaJson.downloadUrl || metaJson.pdf_url || metaJson.pdfUrl ||
      metaJson.evidence_url || metaJson.evidenceUrl || metaJson.fileUrl ||
      metaJson.signedUrl || metaJson.documents?.[0]?.url ||
      metaJson.documents?.[0]?.downloadUrl;
    if (metaPdfUrl) debug.meta.pdfUrl = metaPdfUrl;

    // Paso 2: probar endpoints en orden
    const candidates = [
      metaPdfUrl,
      `${ALLSIGN_BASE}/documents/${allsign_id}/evidence`,
      `${ALLSIGN_BASE}/documents/${allsign_id}/download`,
      `${ALLSIGN_BASE}/documents/${allsign_id}/pdf`,
    ].filter(Boolean);

    for (const endpoint of candidates) {
      const label = endpoint.includes('allsign.io') ? endpoint.split('/').pop() : 'meta_url';
      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}`,
          Accept: 'application/pdf, application/octet-stream, */*',
        },
      });

      const ct = res.headers.get('content-type') || '';
      const status = res.status;
      debug[label] = { status, ct };

      if (!res.ok) continue;

      let pdfBuffer;
      if (ct.includes('application/json') || ct.includes('text/')) {
        const json = await res.json();
        debug[label].json = JSON.stringify(json).slice(0, 600);
        const nextUrl = json.url || json.downloadUrl || json.evidence_url ||
          json.pdf_url || json.fileUrl || json.link || json.signedUrl || json.pdfUrl ||
          json.documents?.[0]?.url;
        if (!nextUrl) continue;
        const r2 = await fetch(nextUrl, { headers: { Accept: 'application/pdf, */*' } });
        debug[label].redirect = { status: r2.status, ct: r2.headers.get('content-type') || '' };
        if (!r2.ok) continue;
        pdfBuffer = Buffer.from(await r2.arrayBuffer());
      } else {
        pdfBuffer = Buffer.from(await res.arrayBuffer());
      }

      debug[label].bytes = pdfBuffer.length;
      debug[label].magic = pdfBuffer.slice(0, 8).toString('hex');

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
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
