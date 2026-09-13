// netlify/functions/firmas-admin-resumen.js
//
// GET /api/firmas-admin-resumen → panel admin de "Firmas electrónicas".
// Devuelve, para TODOS los clientes, su saldo de créditos AllSign,
// el conteo de firmas por estado y (opcionalmente) el detalle de un
// cliente puntual (historial de firmas + movimientos de créditos).
//
//   GET  ?cliente_rfc=XXX   → agrega detalle: firmas y log de créditos de ese cliente
//   GET  (sin cliente_rfc) → solo el resumen agregado por cliente
//
// Usa la service_role key porque firmas_creditos/firmas_creditos_log no
// tienen RLS (ver CLAUDE.md) y firmas_electronicas solo deja ver al
// dueño del RFC o a un admin autenticado como cliente — este dashboard
// no tiene sesión de cliente, solo la de administrador.
//
// Authorization: Bearer <access_token> (debe ser un admin)

'use strict';

const { handleCors, clientIp } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { verificarAdmin } = require('./_admin-auth');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;
  const rl = await checkRateLimit(clientIp(event), 'firmas-admin-resumen', 30, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase no está configurado en el servidor (SUPABASE_URL / SUPABASE_SERVICE_KEY).' }) };
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const admin = await verificarAdmin(event, supabase);
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado. Inicie sesión como administrador.' }) };

  try {
    const { cliente_rfc } = event.queryStringParameters || {};

    // ── Detalle de un cliente puntual ──────────────────────────────────────
    if (cliente_rfc) {
      const rfcTarget = cliente_rfc.toUpperCase();
      const [firmasRes, logRes] = await Promise.all([
        supabase.from('firmas_electronicas')
          .select('id, documento_tipo, documento_folio, allsign_estado, estado, created_at, signed_at')
          .eq('cliente_rfc', rfcTarget)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('firmas_creditos_log')
          .select('id, tipo, cantidad, saldo_previo, saldo_nuevo, referencia, created_at')
          .eq('cliente_rfc', rfcTarget)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (firmasRes.error) throw firmasRes.error;
      if (logRes.error) throw logRes.error;
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ firmas: firmasRes.data || [], movimientos: logRes.data || [] }),
      };
    }

    // ── Resumen agregado de todos los clientes ─────────────────────────────
    const [creditosRes, firmasRes] = await Promise.all([
      supabase.from('firmas_creditos').select('cliente_rfc, saldo, updated_at'),
      supabase.from('firmas_electronicas').select('cliente_rfc, allsign_estado, estado'),
    ]);
    if (creditosRes.error) throw creditosRes.error;
    if (firmasRes.error) throw firmasRes.error;

    const porCliente = {};
    const obtener = (rfc) => {
      if (!porCliente[rfc]) {
        porCliente[rfc] = { cliente_rfc: rfc, saldo: 0, total: 0, pendientes: 0, firmadas: 0, expiradas: 0 };
      }
      return porCliente[rfc];
    };

    for (const c of (creditosRes.data || [])) {
      obtener(c.cliente_rfc).saldo = c.saldo;
    }
    for (const f of (firmasRes.data || [])) {
      const row = obtener(f.cliente_rfc);
      row.total++;
      const estado = f.allsign_estado || f.estado || 'pendiente';
      if (estado === 'firmado') row.firmadas++;
      else if (estado === 'expirado') row.expiradas++;
      else row.pendientes++;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ clientes: Object.values(porCliente) }) };
  } catch (err) {
    console.error('Error en firmas-admin-resumen:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Error al consultar firmas' }) };
  }
};
