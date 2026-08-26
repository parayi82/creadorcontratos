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
    // ── 1. Intentar descargar evidencia PDF directamente ─────────────────────
    // Si la evidencia existe → el documento está firmado, sin importar el campo status.
    // Esto evita depender del nombre exacto del campo de estado en AllSign.
    const evidenceRes = await fetch(`${ALLSIGN_BASE}/documents/${allsign_id}/evidence`, {
      headers: { Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}` },
    });

    // ── 2. Obtener estado del documento para firmantes individuales y expirado ─
    const docRes = await fetch(`${ALLSIGN_BASE}/documents/${allsign_id}`, {
      headers: { Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}` },
    });
    const doc = docRes.ok ? await docRes.json() : {};
    console.log(`[allsign-resync] doc fields: status=${doc.status} state=${doc.state} completed=${doc.completed} evidenceOk=${evidenceRes.ok}`);

    const STATUSES_EXPIRED  = ['expired', 'expirado', 'cancelled', 'cancelado'];
    const STATUSES_COMPLETE = ['completed', 'complete', 'signed', 'done', 'finished'];
    const rawStatus = (doc.status || doc.state || '').toLowerCase();

    const isExpired   = STATUSES_EXPIRED.includes(rawStatus);
    const isCompleted = evidenceRes.ok || STATUSES_COMPLETE.includes(rawStatus) ||
      doc.completed === true ||
      (Array.isArray(doc.participants) && doc.participants.length > 0 &&
        doc.participants.every(p => p.signed || STATUSES_COMPLETE.includes((p.status||'').toLowerCase()) || p.completedAt || p.signedAt));

    // ── 3. Actualizar firmantes individuales ─────────────────────────────────
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
        if (match && (match.signed || match.signedAt || match.completedAt ||
            STATUSES_COMPLETE.includes((match.status||'').toLowerCase()))) {
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
      await sb.from('firmas_electronicas')
        .update({ firmantes: firmantesActualizados })
        .eq('allsign_id', allsign_id).eq('cliente_rfc', rfcTarget);
      return { statusCode: 200, headers, body: JSON.stringify({
        ok: true, estado: 'pendiente',
        doc_status: rawStatus || 'desconocido',
        evidence_ok: evidenceRes.ok,
        debug: { status: doc.status, state: doc.state, completed: doc.completed },
      })};
    }

    // ── 4. Completado: guardar PDF de evidencia ───────────────────────────────
    // AllSign puede devolver el PDF binario directo O un JSON con una URL de descarga.
    let pdfPath = null;
    try {
      // Si evidenceRes ya fue consumido (no se puede releer), hacer nueva llamada
      const evRes = await fetch(`${ALLSIGN_BASE}/documents/${allsign_id}/evidence`, {
        headers: { Authorization: `Bearer ${process.env.ALLSIGN_API_KEY}` },
      });

      if (evRes.ok) {
        const contentType = evRes.headers.get('content-type') || '';
        let pdfBuffer;

        if (contentType.includes('application/json') || contentType.includes('text/')) {
          // AllSign devuelve JSON con URL de descarga
          const evJson = await evRes.json();
          console.log('[allsign-resync] evidence JSON:', JSON.stringify(evJson).slice(0, 300));
          const pdfUrl = evJson.url || evJson.downloadUrl || evJson.evidence_url ||
            evJson.pdf_url || evJson.fileUrl || evJson.link || evJson.signedUrl;
          if (!pdfUrl) throw new Error('No se encontró URL de PDF en respuesta de evidence');
          const pdfRes2 = await fetch(pdfUrl);
          if (!pdfRes2.ok) throw new Error('Error descargando PDF desde URL de evidence');
          pdfBuffer = Buffer.from(await pdfRes2.arrayBuffer());
        } else {
          // Respuesta binaria directa
          pdfBuffer = Buffer.from(await evRes.arrayBuffer());
        }

        pdfPath = `${rfcTarget}/firmas/${allsign_id}.pdf`;
        await sb.storage.from('expedientes').upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });
        console.log(`[allsign-resync] PDF guardado: ${pdfPath} (${pdfBuffer.length} bytes)`);
      }
    } catch (e) {
      console.warn('[allsign-resync] No se pudo guardar evidencia PDF:', e.message);
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
