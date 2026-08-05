// netlify/functions/guardar-documento-expediente.js
//
// Guarda un registro en documentos_expediente usando la service_role,
// evitando el bloqueo de RLS cuando quien escribe es un usuario despacho
// (que tiene un RFC distinto al cliente_rfc del documento).
//
// Requiere sesión válida de Supabase (cliente normal O despacho autorizado).
// Para despachos, verifica que el cliente_rfc esté en su despacho_clientes.
//
// POST { cliente_rfc, tipo, nombre, generador, metadata?, fecha?, trabajador_id? }
// Authorization: Bearer <access_token>
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Verificar identidad del llamante
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };
  const user = uData.user;
  const meta = user.user_metadata || {};

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { cliente_rfc, tipo, nombre, generador, metadata, fecha, trabajador_id } = body;
  if (!cliente_rfc || !tipo || !nombre) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan campos: cliente_rfc, tipo y nombre son obligatorios.' }) };
  }

  // Verificar autorización:
  // · Cliente normal → su RFC debe coincidir con cliente_rfc
  // · Despacho → cliente_rfc debe estar en su lista de clientes autorizados
  const rfcU = String(cliente_rfc).toUpperCase().trim();
  if (meta.tipo === 'despacho') {
    const autorizados = (meta.despacho_clientes || []).map(c => String(c.rfc || '').toUpperCase());
    if (!autorizados.includes(rfcU)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'El despacho no está autorizado para gestionar este cliente.' }) };
    }
  } else {
    const rfcPropio = String(meta.rfc || '').toUpperCase().trim();
    if (!rfcPropio || rfcPropio !== rfcU) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado para guardar documentos de este cliente.' }) };
    }
  }

  // tabla puede ser 'documentos_expediente' (default) o 'documentos_identidad'
  const tabla = body.tabla === 'documentos_identidad' ? 'documentos_identidad' : 'documentos_expediente';

  let registro;
  if (tabla === 'documentos_identidad') {
    // Esquema de documentos_identidad (constancias y firmas del expediente)
    registro = {
      trabajador_id: body.trabajador_id,
      cliente_rfc:   rfcU,
      tipo,
      nombre_archivo: nombre,
      storage_path:  body.storage_path || null,
    };
  } else {
    registro = {
      cliente_rfc:    rfcU,
      tipo,
      nombre,
      generador:      generador       || null,
      metadata:       metadata        || null,
      fecha:          fecha           || new Date().toISOString().split('T')[0],
      generado_en:    new Date().toISOString(),
      contenido_html: body.contenido_html || null,
    };
    if (trabajador_id) registro.trabajador_id = trabajador_id;
  }


  const { error: insErr } = await sb.from(tabla).insert(registro);
  if (insErr) {
    console.error('guardar-documento-expediente:', insErr.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: insErr.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
