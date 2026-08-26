// netlify/functions/allsign-enviar.js
//
// Envía un documento PDF a AllSign para firma electrónica.
// Flujo (3 llamadas a la API de AllSign):
//   1. POST /v2/documents  → crea el documento con el PDF en base64
//   2. POST /v2/documents/{id}/add-signer  (por cada firmante)
//   3. POST /v2/documents/{id}/invite-bulk → envía invitaciones
//
// POST /api/allsign-enviar
// Body JSON:
//   pdf_base64   string  — PDF en base64
//   filename     string  — nombre del archivo, ej: "Contrato-JUANP.pdf"
//   tipo         string  — tipo de documento, ej: "contrato_indeterminado"
//   folio        string  — folio interno del documento
//   firmantes    array   — [{ nombre, email }]
//   cliente_rfc  string  — RFC del cliente ClickLaboral dueño del doc
// Authorization: Bearer <access_token>
//
// Variables de entorno:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   ALLSIGN_API_KEY   — allsign_live_sk_xxx (producción) | allsign_test_sk_xxx (sandbox)
//   ALLSIGN_ENV       — "production" | "sandbox" (default: sandbox)
//   ALLSIGN_OWNER_EMAIL — email del dueño de la cuenta AllSign (para invitedByEmail)

'use strict';

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse }  = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

const ALLSIGN_BASE = () => 'https://api.allsign.io/v2';

function allsignAuth() {
  return `Bearer ${process.env.ALLSIGN_API_KEY}`;
}

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = { ...corsResult._corsHeaders, 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const rl = await checkRateLimit(clientIp(event), 'allsign-enviar', 5, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (!process.env.ALLSIGN_API_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Integración AllSign no configurada.' }) };
  }

  // Autenticación de sesión
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) }; }

  const { pdf_base64, filename, tipo, folio, firmantes, cliente_rfc } = body;
  if (!pdf_base64 || !filename || !firmantes?.length || !cliente_rfc) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan campos requeridos: pdf_base64, filename, firmantes, cliente_rfc.' }) };
  }

  const rfcTarget = cliente_rfc.toUpperCase();
  if (!await puedeAccederRFC(sb, uData.user, rfcTarget)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado para este cliente.' }) };
  }

  try {
    const base = ALLSIGN_BASE();

    // Posiciones de campos de firma en página A4 (595 × 842 pt).
    // Hasta 2 por fila, empezando desde la base. AllSign requiere al menos
    // un campo colocado o rechaza invite-bulk con E1200.
    const FIELD_W = 230, FIELD_H = 60, FIELD_GAP_V = 20;
    function fieldPos(idx) {
      const col  = idx % 2;
      const row  = Math.floor(idx / 2);
      const x    = col === 0 ? 60 : 305;
      const y    = 760 - row * (FIELD_H + FIELD_GAP_V);
      return { x, y };
    }

    const participantsList = firmantes.map(f => ({
      email: f.email,
      name:  f.nombre,
    }));

    // AllSign v2 requiere participantEmail (no signerKey) en cada campo.
    const fieldsList = firmantes.map((f, i) => {
      const { x, y } = fieldPos(i);
      return {
        participantEmail: f.email,
        type:             'signature',
        documentIndex:    0,
        page:             1,
        x,
        y,
        width:            FIELD_W,
        height:           FIELD_H,
      };
    });

    // ── 1. Crear documento con participantes y campos posicionados ────────────
    // Incluir participants + fields en la creación evita el modo "autógrafa
    // sin campos" (E1200) que bloquea invite-bulk.
    const createRes = await fetch(`${base}/documents/`, {
      method: 'POST',
      headers: {
        'Authorization': allsignAuth(),
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        documents: [
          {
            base64Content: pdf_base64,
            fileType:      'pdf',
            name:          filename.replace(/\.pdf$/i, ''),
          },
        ],
        participants: participantsList,
        fields:       fieldsList,
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error('AllSign create error:', JSON.stringify(createData));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error al crear documento en AllSign.', detalle: createData }) };
    }

    const allsignId = createData.id;
    const pdfHash   = createData.pdfHash || '';

    // ── 2. Agregar cada firmante (por si la creación no los persistió) ────────
    // add-signer es idempotente: si ya existe devuelve "ya está en la lista",
    // lo que tratamos como éxito. El signerId viene de esta llamada o del
    // array participants del createData.
    const createdParticipants = createData.participants || [];
    const firmantesConId = [];
    for (let i = 0; i < firmantes.length; i++) {
      const f = firmantes[i];

      // Intentar obtener signerId del createData primero
      const fromCreate = createdParticipants.find(
        p => p.email === f.email || p.signerKey === `firmante_${i}`
      );
      if (fromCreate?.signerId || fromCreate?.id) {
        firmantesConId.push({
          allsign_signer_id: fromCreate.signerId || fromCreate.id,
          email:             f.email,
          nombre:            f.nombre,
          firmado:           false,
        });
        continue;
      }

      const signerRes = await fetch(`${base}/documents/${allsignId}/add-signer`, {
        method: 'POST',
        headers: {
          'Authorization': allsignAuth(),
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          signerEmail: f.email,
          signerName:  f.nombre,
        }),
      });

      const signerData = await signerRes.json();
      const alreadyExists = String(signerData.message || signerData.error?.message || '').toLowerCase().includes('ya está en la lista');
      if (!signerRes.ok && !alreadyExists) {
        console.error(`AllSign add-signer error (${f.email}):`, JSON.stringify(signerData));
        return { statusCode: 502, headers, body: JSON.stringify({ error: `Error al agregar firmante ${f.email}.`, detalle: signerData }) };
      }

      firmantesConId.push({
        allsign_signer_id: signerData.signerId || null,
        email:             f.email,
        nombre:            f.nombre,
        firmado:           false,
      });
    }

    // ── 3. Enviar invitaciones ────────────────────────────────────────────────
    const ownerEmail = process.env.ALLSIGN_OWNER_EMAIL || 'admin@clicklaboral.mx';
    const inviteRes = await fetch(`${base}/documents/${allsignId}/invite-bulk`, {
      method: 'POST',
      headers: {
        'Authorization': allsignAuth(),
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        participants: firmantes.map(f => ({ email: f.email, name: f.nombre })),
        config: { invitedByEmail: ownerEmail },
      }),
    });

    const inviteData = await inviteRes.json();
    if (!inviteRes.ok) {
      console.error('AllSign invite-bulk error:', JSON.stringify(inviteData));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error al enviar invitaciones en AllSign.', detalle: inviteData }) };
    }

    // ── 4. Guardar registro en firmas_electronicas ────────────────────────────
    const externalId = `${rfcTarget}:${folio || Date.now()}`;

    await sb.from('firmas_electronicas').insert({
      folio_firma:        `AS-${allsignId}`,
      documento_tipo:     tipo || 'documento',
      documento_folio:    folio || null,
      hash_documento:     pdfHash,
      firmantes:          firmantesConId,
      cliente_rfc:        rfcTarget,
      ip_origen:          clientIp(event),
      timestamp_servidor: new Date().toISOString(),
      allsign_id:         allsignId,
      allsign_estado:     'pendiente',
      estado:             'pendiente',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok:                 true,
        allsign_id:         allsignId,
        firmantes_con_id:   firmantesConId,
        pdf_hash:           pdfHash,
        estado:             'pendiente',
      }),
    };

  } catch (err) {
    reportError('allsign-enviar', err, { cliente_rfc: rfcTarget, tipo }).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
