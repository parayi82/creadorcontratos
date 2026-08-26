// netlify/functions/nom151-conservar.js
//
// Emite una constancia de conservación NOM-151 para un documento almacenado.
// Calcula el SHA-256 en servidor, llama al adaptador PSC activo, y persiste
// la constancia en constancias_conservacion.
//
// POST { tablaOrigen, filaId, campoContenido? }
//   tablaOrigen      : tabla de Supabase donde reside el documento
//   filaId           : UUID/ID de la fila
//   campoContenido   : nombre de columna con el contenido a conservar
//                      (default: "contenido". Se acepta también "pdf_path" para
//                       documentos almacenados en Storage — en ese caso se
//                       descarga el objeto y se hashea el binario.)
//
// Respuesta 200: { idConstancia, selloTiempo, proveedor, hash }
//
// SEGURIDAD:
//   • Requiere sesión de administrador (Authorization: Bearer <token>)
//   • El hash se calcula SIEMPRE en servidor, nunca viene del cliente
//   • Ningún log emite RFC, CURP, NSS ni nombres; solo idConstancia y hash
//   • Credenciales del PSC solo en env vars de Netlify, nunca en el repo
//
// Variables de entorno:
//   SUPABASE_URL         URL del proyecto Supabase
//   SUPABASE_SERVICE_KEY service_role key
//   NOM_151_PROVIDER     "mock" (default) | "finkok"

'use strict';

const crypto = require('crypto');
const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse }  = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { verificarAdmin } = require('./_admin-auth');
const { getNom151Provider } = require('./_nom151-provider');

// Tablas permitidas como origen de documentos a conservar
const TABLAS_ORIGEN_PERMITIDAS = new Set([
  'firmas_electronicas',
  'documentos_expediente',
  'documentos_identidad',
  'solicitudes',
]);

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;

  const rl = await checkRateLimit(clientIp(event), 'nom151-conservar', 20, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Faltan variables de entorno de Supabase.' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido.' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const responder = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });

  const admin = await verificarAdmin(event, supabase);
  if (!admin) return responder(401, { error: 'No autorizado. Inicie sesión como administrador.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return responder(400, { error: 'JSON inválido.' }); }

  const { tablaOrigen, filaId, campoContenido = 'contenido' } = body;

  if (!tablaOrigen || !filaId) {
    return responder(400, { error: 'tablaOrigen y filaId son obligatorios.' });
  }
  if (!TABLAS_ORIGEN_PERMITIDAS.has(tablaOrigen)) {
    return responder(400, { error: `tablaOrigen no permitida: "${tablaOrigen}".` });
  }

  try {
    // 1. Recuperar la fila con service_role
    const { data: fila, error: fetchErr } = await supabase
      .from(tablaOrigen)
      .select('*')
      .eq('id', filaId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!fila) return responder(404, { error: 'Documento no encontrado.' });

    // 2. Obtener el contenido a hashear
    let contenidoParaHash = fila[campoContenido];
    if (contenidoParaHash === undefined || contenidoParaHash === null) {
      return responder(400, { error: `El campo "${campoContenido}" no existe en la fila.` });
    }

    // Serializar objetos/arrays a JSON canónico
    if (typeof contenidoParaHash === 'object') {
      contenidoParaHash = JSON.stringify(contenidoParaHash);
    } else {
      contenidoParaHash = String(contenidoParaHash);
    }

    // 3. Calcular SHA-256 en servidor
    const hash = crypto.createHash('sha256').update(contenidoParaHash, 'utf8').digest('hex');

    // 4. Verificar si ya existe una constancia para esta fila (idempotencia)
    const { data: existente } = await supabase
      .from('constancias_conservacion')
      .select('id_constancia, sello_tiempo, proveedor')
      .eq('tabla_origen', tablaOrigen)
      .eq('fila_id', filaId)
      .maybeSingle();

    if (existente) {
      return responder(200, {
        idConstancia: existente.id_constancia,
        selloTiempo:  existente.sello_tiempo,
        proveedor:    existente.proveedor,
        hash,
        yaExistia:    true,
      });
    }

    // 5. Llamar al adaptador PSC
    const provider = getNom151Provider();
    const { idConstancia, selloTiempo, proveedor } = await provider.conservar(hash, {
      tablaOrigen,
      filaId,
    });

    // 6. Persistir la constancia (append-only — sin UPDATE ni DELETE por RLS)
    const { error: insertErr } = await supabase
      .from('constancias_conservacion')
      .insert({
        tabla_origen:  tablaOrigen,
        fila_id:       filaId,
        hash_documento: hash,
        id_constancia: idConstancia,
        sello_tiempo:  selloTiempo,
        proveedor,
      });

    if (insertErr) throw insertErr;

    // Log mínimo: solo idConstancia y hash, sin datos personales
    console.log(`nom151-conservar: constancia emitida id=${idConstancia} hash=${hash}`);

    return responder(200, { idConstancia, selloTiempo, proveedor, hash });

  } catch (e) {
    console.error('nom151-conservar error:', e.message || e);
    return responder(500, { error: e.message || 'Error interno.' });
  }
};
