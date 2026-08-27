// netlify/functions/firmas-creditos.js
//
// GET  /api/firmas-creditos?cliente_rfc=xxx   → { saldo }
// POST /api/firmas-creditos                    → admin: ajuste manual de créditos
//   Body: { accion:'ajuste_admin', cliente_rfc, cantidad }
//
// Authorization: Bearer <access_token>

'use strict';

const { handleCors } = require('./_security');
const { createClient } = require('@supabase/supabase-js');
const { puedeAccederRFC, esAdmin } = require('./_admin-auth');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = { ...corsResult._corsHeaders, 'Content-Type': 'application/json' };

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token requerido.' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };

  // ── GET: consultar saldo ───────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { cliente_rfc } = event.queryStringParameters || {};
    if (!cliente_rfc) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta cliente_rfc.' }) };

    const rfcTarget = cliente_rfc.toUpperCase();
    if (!await puedeAccederRFC(sb, uData.user, rfcTarget)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'No autorizado.' }) };
    }

    const { data } = await sb
      .from('firmas_creditos')
      .select('saldo')
      .eq('cliente_rfc', rfcTarget)
      .maybeSingle();

    return { statusCode: 200, headers, body: JSON.stringify({ saldo: data?.saldo ?? 0 }) };
  }

  // ── POST: ajuste admin ────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    if (!await esAdmin(sb, uData.user)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo administradores.' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) };
    }

    const { accion, cliente_rfc, cantidad } = body;
    if (accion !== 'ajuste_admin' || !cliente_rfc || !Number.isInteger(cantidad)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos requeridos: accion="ajuste_admin", cliente_rfc, cantidad (entero).' }) };
    }

    const rfcTarget = cliente_rfc.toUpperCase();
    const { data: result, error: rpcErr } = await sb.rpc('agregar_firma_creditos', {
      p_rfc:      rfcTarget,
      p_cantidad: cantidad,
      p_tipo:     'ajuste_admin',
      p_ref:      `admin:${uData.user.id}`,
    });

    if (rpcErr) {
      console.error('[firmas-creditos] rpc error:', rpcErr.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: rpcErr.message }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, saldo: result.saldo }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido.' }) };
};
