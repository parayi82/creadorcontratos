// netlify/functions/subir-archivo-expediente.js
//
// Sube un archivo al bucket 'expedientes' de Supabase Storage usando la
// service_role key, evitando el bloqueo de políticas RLS cuando quien
// sube es un usuario despacho (que tiene un RFC distinto al cliente_rfc).
//
// POST multipart/form-data:
//   path        (campo texto)  → ruta dentro del bucket, ej: "RFC/trabId/ts-nombre.pdf"
//   cliente_rfc (campo texto)  → RFC del cliente dueño del archivo
//   file        (campo archivo) → el archivo binario
// Authorization: Bearer <access_token>
//
// Responde: { ok:true, path } | { error: '...' }
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC } = require('./_admin-auth');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  const rl = await checkRateLimit(clientIp(event), 'subir-archivo', 10, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };
  const meta = uData.user.user_metadata || {};

  // Parsear multipart manualmente (Netlify Functions no lo hace automáticamente)
  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Content-Type debe ser multipart/form-data.' }) };

  const boundary = '--' + boundaryMatch[1];
  const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  const parts = parseMultipart(bodyBuffer, boundary);

  const path       = parts.path?.text?.trim();
  const clienteRfc = parts.cliente_rfc?.text?.trim().toUpperCase();
  const filePart   = parts.file;

  if (!path || !clienteRfc || !filePart?.data) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan campos: path, cliente_rfc y file son obligatorios.' }) };
  }

  if (!await puedeAccederRFC(sb, uData.user, clienteRfc)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado para este cliente.' }) };
  }

  const fileContentType = filePart.contentType || 'application/octet-stream';
  const { error: upErr } = await sb.storage.from('expedientes').upload(path, filePart.data, {
    contentType: fileContentType,
    upsert: false,
  });

  if (upErr) {
    console.error('subir-archivo-expediente:', upErr.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: upErr.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, path }) };
};

// ── Parser de multipart/form-data sin dependencias externas ──
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from('\r\n' + boundary);
  const firstBoundary = Buffer.from(boundary + '\r\n');
  const parts = {};
  let pos = buffer.indexOf(firstBoundary);
  if (pos === -1) return parts;
  pos += firstBoundary.length;

  while (pos < buffer.length) {
    const headerEnd = indexOfSeq(buffer, Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(pos, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = indexOfSeq(buffer, Buffer.from('\r\n' + boundary), dataStart);
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary;
    const data = buffer.slice(dataStart, dataEnd);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const ctMatch   = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    if (nameMatch) {
      const name = nameMatch[1];
      if (ctMatch) {
        parts[name] = { data, contentType: ctMatch[1].trim() };
      } else {
        parts[name] = { text: data.toString('utf8') };
      }
    }
    if (nextBoundary === -1) break;
    pos = nextBoundary + Buffer.from('\r\n' + boundary + '\r\n').length;
    if (buffer.slice(nextBoundary + 2 + boundary.length, nextBoundary + 4 + boundary.length).toString() === '--') break;
  }
  return parts;
}

function indexOfSeq(buf, seq, start = 0) {
  for (let i = start; i <= buf.length - seq.length; i++) {
    if (buf.slice(i, i + seq.length).equals(seq)) return i;
  }
  return -1;
}
