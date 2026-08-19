// netlify/functions/mifiel-enviar.js
//
// Envía un documento PDF a Mifiel para firma electrónica avanzada (e.firma / FIEL).
//
// POST /api/mifiel-enviar
// Body JSON:
//   pdf_base64   string   — PDF en base64
//   filename     string   — nombre del archivo, ej: "Contrato-JUANP.pdf"
//   tipo         string   — tipo de documento, ej: "contrato_indeterminado"
//   folio        string   — folio interno del documento
//   firmantes    array    — [{ nombre, email, rfc }]
//   cliente_rfc  string   — RFC del cliente ClickLaboral dueño del doc
// Authorization: Bearer <access_token>
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY,
//                       MIFIEL_APP_ID, MIFIEL_APP_SECRET, MIFIEL_ENV (sandbox|production)

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

const MIFIEL_BASE = () =>
  process.env.MIFIEL_ENV === 'production'
    ? 'https://app.mifiel.com/api/v1'
    : 'https://app-sandbox.mifiel.com/api/v1';

function mifielAuth() {
  const creds = Buffer.from(`${process.env.MIFIEL_APP_ID}:${process.env.MIFIEL_APP_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = { ...corsResult._corsHeaders, 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };

  const rl = await checkRateLimit(clientIp(event), 'mifiel-enviar', 5, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (!process.env.MIFIEL_APP_ID || !process.env.MIFIEL_APP_SECRET) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Integración Mifiel no configurada.' }) };
  }

  // Autenticación de sesión
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };
  const meta = uData.user.user_metadata || {};

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) }; }

  const { pdf_base64, filename, tipo, folio, firmantes, cliente_rfc } = body;
  if (!pdf_base64 || !filename || !firmantes?.length || !cliente_rfc) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan campos requeridos: pdf_base64, filename, firmantes, cliente_rfc.' }) };
  }

  const rfcTarget = cliente_rfc.toUpperCase();
  if (!await puedeAccederRFC(sb, uData.user, rfcTarget)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado para este cliente.' }) };
  }

  try {
    // Convertir base64 → Blob para enviar como multipart
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');

    const externalId = `${rfcTarget}:${folio || Date.now()}`;

    // Construir multipart/form-data manualmente (Netlify Functions no tiene FormData nativo)
    const boundary = `----MifielBoundary${Date.now()}`;
    const CRLF = '\r\n';

    const buildPart = (name, value) =>
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`;

    let multipart = Buffer.from('');

    // Campo: file (PDF)
    const fileHeader = Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: application/pdf${CRLF}${CRLF}`
    );
    const fileFooter = Buffer.from(CRLF);
    multipart = Buffer.concat([multipart, fileHeader, pdfBuffer, fileFooter]);

    // Campos de texto
    const textFields = [
      ['external_id', externalId],
      ['send_invites', 'true'],
      ['remind_every', '3'],
    ];
    for (const [name, value] of textFields) {
      multipart = Buffer.concat([multipart, Buffer.from(buildPart(name, value))]);
    }

    // Firmantes (array de objetos → signatories[i][campo])
    for (let i = 0; i < firmantes.length; i++) {
      const f = firmantes[i];
      for (const [k, v] of Object.entries({ email: f.email, name: f.nombre, tax_id: f.rfc || '' })) {
        if (v) multipart = Buffer.concat([multipart, Buffer.from(buildPart(`signatories[${i}][${k}]`, v))]);
      }
    }

    // Cierre del multipart
    multipart = Buffer.concat([multipart, Buffer.from(`--${boundary}--${CRLF}`)]);

    const mifielRes = await fetch(`${MIFIEL_BASE()}/documents`, {
      method: 'POST',
      headers: {
        'Authorization': mifielAuth(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart,
    });

    const mifielData = await mifielRes.json();

    if (!mifielRes.ok) {
      console.error('Mifiel error:', JSON.stringify(mifielData));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Error al crear documento en Mifiel.', detalle: mifielData }) };
    }

    // Guardar registro en firmas_electronicas
    const firmantesConWidget = (mifielData.signers || []).map(s => ({
      mifiel_signer_id: s.id,
      widget_id: s.widget_id,
      email: s.email,
      nombre: s.name,
      rfc: s.tax_id,
      firmado: false,
    }));

    await sb.from('firmas_electronicas').insert({
      folio_firma: `MIF-${mifielData.id}`,
      documento_tipo: tipo || 'documento',
      documento_folio: folio || null,
      hash_documento: mifielData.original_hash || '',
      firmantes: firmantesConWidget,
      cliente_rfc: rfcTarget,
      ip_origen: clientIp(event),
      timestamp_servidor: new Date().toISOString(),
      mifiel_id: mifielData.id,
      estado: 'pendiente',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        mifiel_id: mifielData.id,
        firmantes_con_widget: firmantesConWidget,
        original_hash: mifielData.original_hash,
        estado: mifielData.state,
      }),
    };
  } catch (err) {
    reportError('mifiel-enviar', err, { cliente_rfc, tipo }).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
