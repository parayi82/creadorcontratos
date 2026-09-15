// netlify/functions/repse-invitacion.js
//
// Endpoint PÚBLICO (sin sesión) para el flujo de invitación a proveedores
// REPSE. Punto #6 del resumen ejecutivo de puntos ciegos: el contratante
// responde solidariamente por sus contratistas de servicios especializados
// (Art. 15-A LFT / Ley REPSE), así que necesita que ELLOS compartan su
// propia información — no solo llenarla él a mano sobre cada uno.
//
//   GET  /api/repse-invitacion?token=xxx
//     → { estado: 'pendiente'|'completado', empresa }
//       Para que invitacion-repse.html sepa qué mostrar antes de pedir datos.
//
//   POST /api/repse-invitacion
//     Body: { token, nombre, rfc_proveedor, num_repse, vigencia_repse,
//             actividad, domicilio, rep_legal, email, telefono }
//     → crea el registro en repse_proveedores del cliente que invitó, y
//       marca la invitación como completada.
//
// Usa service_role porque quien llama nunca tiene sesión de Supabase — es
// un tercero externo al sistema (el proveedor invitado). El único control
// de acceso es conocer el token, que solo vive en el link que el cliente
// le compartió por su cuenta (WhatsApp, email, etc.) — igual de sensible
// que cualquier link de invitación de este tipo, por eso lleva rate
// limiting y el token es aleatorio de 16 bytes (ver migración
// 20260915000000_repse_invitaciones.sql).

'use strict';

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');

const RFC_REGEX = /^[A-ZÑ&]{3,4}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$/i;
const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = { ...corsResult._corsHeaders, 'Content-Type': 'application/json' };

  const rl = await checkRateLimit(clientIp(event), 'repse-invitacion', 20, 600);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'El servidor no está configurado correctamente.' }) };
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET: validar el link antes de mostrar el formulario ───────────────────
  if (event.httpMethod === 'GET') {
    const { token } = event.queryStringParameters || {};
    if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta el token de invitación.' }) };

    const { data: inv } = await sb.from('repse_invitaciones').select('estado, cliente_rfc').eq('token', token).maybeSingle();
    if (!inv) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Este link de invitación no es válido.' }) };

    const { data: cliente } = await sb.from('clientes').select('empresa').eq('rfc', inv.cliente_rfc).maybeSingle();
    return { statusCode: 200, headers, body: JSON.stringify({ estado: inv.estado, empresa: cliente?.empresa || inv.cliente_rfc }) };
  }

  // ── POST: el proveedor invitado manda su información ──────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) };
    }

    const { token, nombre, rfc_proveedor, num_repse, vigencia_repse, actividad, domicilio, rep_legal, email, telefono } = body;

    if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta el token de invitación.' }) };
    if (!nombre || !num_repse || !vigencia_repse) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Complete los campos obligatorios: nombre, número REPSE y vigencia.' }) };
    }
    if (String(nombre).length > 200) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nombre demasiado largo (máximo 200 caracteres).' }) };
    }
    if (rfc_proveedor && !RFC_REGEX.test(rfc_proveedor)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'RFC del proveedor inválido. Verifique el formato (ej: XAXX010101000).' }) };
    }
    if (email && !EMAIL_REGEX.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Correo electrónico inválido.' }) };
    }

    const { data: inv, error: invErr } = await sb
      .from('repse_invitaciones').select('id, cliente_rfc, estado').eq('token', token).maybeSingle();
    if (invErr || !inv) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Este link de invitación no es válido.' }) };
    if (inv.estado === 'completado') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Esta invitación ya fue completada anteriormente.' }) };
    }

    try {
      const { data: proveedor, error: provErr } = await sb.from('repse_proveedores').insert({
        cliente_rfc:   inv.cliente_rfc,
        nombre:        String(nombre).trim(),
        rfc_proveedor: rfc_proveedor ? String(rfc_proveedor).trim().toUpperCase() : null,
        num_repse:     String(num_repse).trim(),
        vigencia_repse,
        actividad:     actividad ? String(actividad).trim() : null,
        domicilio:     domicilio ? String(domicilio).trim() : null,
        rep_legal:     rep_legal ? String(rep_legal).trim() : null,
        email:         email ? String(email).trim() : null,
        telefono:      telefono ? String(telefono).trim() : null,
        notas: 'Alta vía invitación pública (autoservicio del proveedor).',
      }).select().single();
      if (provErr) throw provErr;

      await sb.from('repse_invitaciones').update({
        estado: 'completado',
        completado_at: new Date().toISOString(),
        proveedor_id: proveedor.id,
      }).eq('id', inv.id);

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      reportError('repse-invitacion', err, { cliente_rfc: inv.cliente_rfc }).catch(() => {});
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo guardar la información. Intente de nuevo.' }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido.' }) };
};
