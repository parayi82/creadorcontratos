// netlify/functions/reporte-asistencias.js
//
// Genera un reporte COMPLETO de asistencias para el cliente autenticado.
// Garantiza cobertura día a día: si falta un registro lo rellena como 'sin_registro'.
// Soporta clientes directos y despachos (acceso a su cartera).
//
// POST { desde, hasta, trabajador_id? }         → cliente normal
// POST { desde, hasta, cliente_rfc, trabajador_id? } → despacho
//
// Respuesta:
// {
//   trabajadores: [{ id, nombre, puesto, hora_entrada_habitual, hora_salida_habitual }]
//   dias: ['YYYY-MM-DD', ...]
//   dias_laborales: ['YYYY-MM-DD', ...]   ← lunes a viernes
//   registros: { [trabajador_id]: { [fecha]: { status, hora_entrada, hora_salida, notas, fuente } } }
//   resumen: [{ trabajador_id, nombre, presentes, retrasos, faltas_injustificadas, ... pct_asistencia }]
//   meta_nom: { generado_en, periodo_desde, periodo_hasta, articulo_804_lft, ... }
// }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { handleCors, clientIp, reportError } = require('./_security');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limiter');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const corsResult = handleCors(event);
  if (corsResult.body !== undefined) return corsResult;
  const headers = corsResult._corsHeaders;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const rl = await checkRateLimit(clientIp(event), 'reporte-asistencias', 30, 60);
  if (rl.limited) return rateLimitResponse(headers, rl.resetAt);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Variables de entorno faltantes.' }) };
  }

  const token = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token de sesión requerido.' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: uData, error: uErr } = await sb.auth.getUser(token);
  if (uErr || !uData?.user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sesión no válida.' }) };
  }

  const user = uData.user;
  const meta = user.user_metadata || {};
  const esDespacho = meta.tipo === 'despacho';

  const ok  = (obj)       => ({ statusCode: 200, headers, body: JSON.stringify(obj) });
  const err = (code, msg) => ({ statusCode: code, headers, body: JSON.stringify({ error: msg }) });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err(400, 'JSON inválido.'); }

  const { desde, hasta, trabajador_id, cliente_rfc: rfcBody } = body;

  if (!desde || !hasta) return err(400, 'Faltan parámetros: desde, hasta.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return err(400, 'Formato de fecha inválido (YYYY-MM-DD).');
  }
  if (hasta < desde) return err(400, '"hasta" debe ser igual o posterior a "desde".');

  const diasRango = (new Date(hasta + 'T12:00:00Z') - new Date(desde + 'T12:00:00Z')) / 86400000;
  if (diasRango > 366) return err(400, 'El rango máximo es 1 año (366 días).');

  // ── Determinar RFC del cliente ──────────────────────────────────────────────
  let clienteRFC;
  try {
    if (esDespacho) {
      if (!rfcBody) return err(400, 'Falta cliente_rfc para operaciones de despacho.');
      clienteRFC = String(rfcBody).toUpperCase().trim();

      const { data: desp } = await sb.from('despachos').select('id').eq('auth_user_id', user.id).eq('activo', true).maybeSingle();
      if (!desp) return err(403, 'No se encontró perfil de despacho activo.');

      const { count } = await sb.from('despacho_clientes')
        .select('*', { count: 'exact', head: true })
        .eq('despacho_id', desp.id).eq('cliente_rfc', clienteRFC).eq('activo', true);
      if (!count) return err(403, 'El cliente no pertenece a su cartera.');
    } else {
      clienteRFC = String(meta.rfc || '').toUpperCase().trim();
      if (!clienteRFC) return err(401, 'Sin RFC en sesión.');
    }
  } catch (e) {
    return err(500, `Error verificando acceso: ${e?.message || e}`);
  }

  try {
    // ── 1. Trabajadores activos ────────────────────────────────────────────────
    let trabQ = sb.from('trabajadores')
      .select('id,nombre,puesto,fecha_ingreso,hora_entrada_habitual,hora_salida_habitual,nss')
      .eq('cliente_rfc', clienteRFC)
      .eq('activo', true)
      .order('nombre');
    if (trabajador_id) trabQ = trabQ.eq('id', trabajador_id);

    const { data: trabajadores, error: tErr } = await trabQ;
    if (tErr) throw tErr;

    if (!trabajadores?.length) {
      return ok({ trabajadores: [], dias: [], dias_laborales: [], registros: {}, resumen: [], meta_nom: {} });
    }

    // ── 2. Registros de asistencia en el rango ────────────────────────────────
    const trabIds = trabajadores.map(t => t.id);
    const { data: asistencias, error: aErr } = await sb.from('asistencias')
      .select('trabajador_id,fecha,status,hora_entrada,hora_salida,notas,fuente')
      .eq('cliente_rfc', clienteRFC)
      .gte('fecha', desde).lte('fecha', hasta)
      .in('trabajador_id', trabIds);
    if (aErr) throw aErr;

    // ── 3. Mapa de registros: trabId → fecha → datos ─────────────────────────
    const regMap = {};
    for (const t of trabajadores) regMap[t.id] = {};
    for (const a of (asistencias || [])) {
      if (regMap[a.trabajador_id]) {
        regMap[a.trabajador_id][a.fecha] = {
          status:       a.status,
          hora_entrada: a.hora_entrada,
          hora_salida:  a.hora_salida,
          notas:        a.notas,
          fuente:       a.fuente,
        };
      }
    }

    // ── 4. Generar lista de días en el rango ──────────────────────────────────
    const dias = [];
    const cur = new Date(desde + 'T12:00:00Z');
    const fin = new Date(hasta + 'T12:00:00Z');
    while (cur <= fin) {
      dias.push(cur.toISOString().split('T')[0]);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const diasLaborales = dias.filter(d => {
      const dow = new Date(d + 'T12:00:00Z').getUTCDay();
      return dow >= 1 && dow <= 5; // lunes-viernes
    });

    // ── 5. Completar registros — llenar gaps con 'sin_registro' ──────────────
    const registros = {};
    for (const t of trabajadores) {
      registros[t.id] = {};
      for (const dia of dias) {
        registros[t.id][dia] = regMap[t.id][dia] || { status: 'sin_registro' };
      }
    }

    // ── 6. Resumen por trabajador ─────────────────────────────────────────────
    const resumen = trabajadores.map(t => {
      const regs = Object.values(registros[t.id]);
      const cnt = (st) => regs.filter(r => r.status === st).length;
      const presentes        = cnt('presente');
      const retrasos         = cnt('retraso');
      const faltasInj        = cnt('falta_injustificada');
      const faltasJus        = cnt('falta_justificada');
      const vacaciones       = cnt('vacaciones');
      const permisos         = cnt('permiso');
      const incapacidades    = cnt('incapacidad');
      const festivos         = cnt('festivo');
      const sinRegistro      = cnt('sin_registro');

      // Días laborales desde que ingresó el trabajador (o desde el inicio del período)
      const ingreso = t.fecha_ingreso && t.fecha_ingreso > desde ? t.fecha_ingreso : desde;
      const diasLabTrab = diasLaborales.filter(d => d >= ingreso).length;

      // % asistencia = (presentes + retrasos) / días laborales desde su ingreso en el período
      const pctAsistencia = diasLabTrab > 0
        ? Math.round((presentes + retrasos) / diasLabTrab * 100)
        : null;

      return {
        trabajador_id: t.id,
        nombre:        t.nombre,
        puesto:        t.puesto,
        nss:           t.nss,
        dias_laborales:        diasLaborales.length,
        dias_laborales_propios: diasLabTrab,
        presentes,
        retrasos,
        faltas_injustificadas: faltasInj,
        faltas_justificadas:   faltasJus,
        vacaciones,
        permisos,
        incapacidades,
        festivos,
        sin_registro:  sinRegistro,
        pct_asistencia: pctAsistencia,
      };
    });

    // ── 7. Metadatos NOM / Art. 804 LFT ──────────────────────────────────────
    const meta_nom = {
      generado_en:           new Date().toISOString(),
      sistema:               'ClickLaboral.mx',
      version_reglamentaria: '2026',
      cliente_rfc:           clienteRFC,
      periodo_desde:         desde,
      periodo_hasta:         hasta,
      dias_calendario:       dias.length,
      dias_laborales:        diasLaborales.length,
      trabajadores_incluidos: trabajadores.length,
      articulo_804_lft:      'Art. 804 LFT — El patrón está obligado a conservar y exhibir en juicio las listas de asistencia, nóminas y recibos de salarios (fracción IV).',
      nom_035_stps:          'NOM-035-STPS-2018 — Factores de riesgo psicosocial en el trabajo — Identificación, análisis y prevención.',
      nom_019_stps:          'NOM-019-STPS-2023 — Comisiones de seguridad e higiene.',
      nota_trazabilidad:     'Este reporte fue generado digitalmente y cada registro de asistencia queda respaldado en la bitácora de la plataforma con sello de tiempo inmutable.',
    };

    return ok({
      trabajadores: trabajadores.map(t => ({
        id:                    t.id,
        nombre:                t.nombre,
        puesto:                t.puesto,
        nss:                   t.nss,
        fecha_ingreso:         t.fecha_ingreso,
        hora_entrada_habitual: t.hora_entrada_habitual,
        hora_salida_habitual:  t.hora_salida_habitual,
      })),
      dias,
      dias_laborales: diasLaborales,
      registros,
      resumen,
      meta_nom,
    });

  } catch (e) {
    console.error('reporte-asistencias:', e?.message || e);
    reportError('reporte-asistencias', e).catch(() => {});
    return err(500, e?.message || 'Error interno.');
  }
};
