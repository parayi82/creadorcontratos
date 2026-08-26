// netlify/functions/allsign-resync.js
//
// Sincroniza el estado de un documento AllSign consultando la API directamente.
// Úsalo cuando el webhook falla o aún no está configurado.
//
// POST /api/allsign-resync
// Authorization: Bearer <access_token>
// Body: { allsign_id, cliente_rfc }

'use strict';

const { handleCors, clientIp, reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

const ALLSIGN_BASE = 'https://api.allsign.io/v2';

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = { ...corsResult._corsHeaders, 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  if (!process.env.ALLSIGN_API_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'AllSign no configurado.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) };
  }

  const { allsign_id, cliente_rfc } = body;
  if (!allsign_id || !cliente_rfc) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan allsign_id y cliente_rfc.' }) };
  }

  const rfcTarget = cliente_rfc.toUpperCase();
  if (!await puedeAccederRFC(sb, uData.user, rfcTarget)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado.' }) };
  }

  try {
    // ── 1. Obtener estado del documento en AllSign ────────────────────────────
    const docRes = await fetch(`${ALLSIGN_BASE}/documents/${allsign_id}`, {
      headers: { Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}` },
    });
    if (!docRes.ok) {
      const err = await docRes.json().catch(() => ({}));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error consultando AllSign.', detalle: err }) };
    }
    const doc = await docRes.json();

    // AllSign puede usar status, state, o completed como indicador
    const isCompleted =
      doc.status === 'completed' ||
      doc.state  === 'completed' ||
      doc.completed === true ||
      (Array.isArray(doc.participants) && doc.participants.length > 0 &&
        doc.participants.every(p => p.signed || p.status === 'signed' || p.completedAt));

    const isExpired =
      doc.status === 'expired' || doc.state === 'expired';

    // ── 2. Actualizar firmantes individuales ─────────────────────────────────
    const { data: firmaRow } = await sb
      .from('firmas_electronicas')
      .select('firmantes')
      .eq('allsign_id', allsign_id)
      .eq('cliente_rfc', rfcTarget)
      .single();

    let firmantesActualizados = firmaRow?.firmantes || [];
    if (Array.isArray(doc.participants) && doc.participants.length) {
      firmantesActualizados = firmantesActualizados.map(f => {
        const match = doc.participants.find(p =>
          p.email === f.email || p.signerEmail === f.email
        );
        if (match && (match.signed || match.status === 'signed' || match.completedAt)) {
          return { ...f, firmado: true };
        }
        return f;
      });
    }

    if (isExpired) {
      await sb.from('firmas_electronicas')
        .update({ estado: 'expirado', allsign_estado: 'expirado', firmantes: firmantesActualizados })
        .eq('allsign_id', allsign_id).eq('cliente_rfc', rfcTarget);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, estado: 'expirado' }) };
    }

    if (!isCompleted) {
      // Solo actualizar firmantes individuales que ya firmaron
      await sb.from('firmas_electronicas')
        .update({ firmantes: firmantesActualizados })
        .eq('allsign_id', allsign_id).eq('cliente_rfc', rfcTarget);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, estado: 'pendiente', doc_status: doc.status || doc.state }) };
    }

    // ── 3. Completado: descargar PDF de evidencia ────────────────────────────
    let pdfPath = null;
    const evidenceRes = await fetch(`${ALLSIGN_BASE}/documents/${allsign_id}/evidence`, {
      headers: { Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}` },
    });
    if (evidenceRes.ok) {
      const pdfBuffer = Buffer.from(await evidenceRes.arrayBuffer());
      pdfPath = `${rfcTarget}/firmas/${allsign_id}.pdf`;
      await sb.storage.from('expedientes').upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });
    }

    // ── 4. Actualizar Supabase ────────────────────────────────────────────────
    await sb.from('firmas_electronicas').update({
      estado:          'firmado',
      allsign_estado:  'firmado',
      signed_at:       doc.completedAt || doc.completed_at || new Date().toISOString(),
      signed_pdf_path: pdfPath,
      firmantes:       firmantesActualizados,
    }).eq('allsign_id', allsign_id).eq('cliente_rfc', rfcTarget);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, estado: 'firmado', signed_pdf_path: pdfPath }),
    };

  } catch (err) {
    reportError('allsign-resync', err, {}).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
