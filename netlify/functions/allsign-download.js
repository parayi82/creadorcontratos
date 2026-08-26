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
    // Probar /evidence primero, luego /download como fallback
    const endpoints = [
      `${ALLSIGN_BASE}/documents/${allsign_id}/evidence`,
      `${ALLSIGN_BASE}/documents/${allsign_id}/download`,
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}`,
          Accept: 'application/pdf, application/octet-stream, */*',
        },
      });

      if (!res.ok) continue;

      const ct = res.headers.get('content-type') || '';

      // Si devuelve JSON con URL de descarga, seguirla
      if (ct.includes('application/json') || ct.includes('text/')) {
        const json = await res.json();
        console.log('[allsign-download] JSON evidence:', JSON.stringify(json).slice(0, 500));
        const pdfUrl = json.url || json.downloadUrl || json.evidence_url ||
          json.pdf_url || json.fileUrl || json.link || json.signedUrl || json.pdfUrl;
        if (!pdfUrl) continue;

        const pdfRes = await fetch(pdfUrl, {
          headers: { Accept: 'application/pdf, */*' },
        });
        if (!pdfRes.ok) continue;

        const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
        if (pdfBuffer.slice(0, 4).toString() !== '%PDF') {
          console.warn('[allsign-download] URL no devolvió PDF válido:', pdfBuffer.slice(0, 20).toString('hex'));
          continue;
        }

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

      // Respuesta binaria directa
      const pdfBuffer = Buffer.from(await res.arrayBuffer());
      if (pdfBuffer.slice(0, 4).toString() !== '%PDF') {
        console.warn('[allsign-download] Respuesta no es PDF:', pdfBuffer.slice(0, 20).toString('hex'));
        continue;
      }

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

    return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo obtener el PDF firmado desde AllSign.' }) };

  } catch (err) {
    console.error('[allsign-download] error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
