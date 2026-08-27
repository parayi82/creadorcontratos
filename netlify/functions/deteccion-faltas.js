// netlify/functions/deteccion-faltas.js
//
// Cierra la jornada del día anterior y detecta faltas/retrasos.
//
// Modo diario (cron):
//   Paso 1 — Cierre de día: trabajadores sin registro de ayer → inserta 'sin_registro'.
//   Paso 2 — Detección de faltas: sin_registro en día laboral → falta_injustificada + acta + alerta.
//   Paso 3 — Detección de retrasos: status 'retraso' → alerta.
//
// Modo backfill (POST { backfill: true } o ?backfill=1):
//   Procesa todos los días laborales históricos desde fecha_ingreso de cada trabajador.
//   Inserta 'falta_injustificada' para cada día sin registro.
//   Crea UNA alerta resumen por trabajador (no una por día).
//
// Ejecutar una vez al día, p.ej. a las 07:00 hora CDMX.
//   GET /api/deteccion-faltas?secret=CRON_SECRET
//   POST igual, o con header: Authorization: Bearer CRON_SECRET
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET

const { reportError } = require('./_security');
const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Access-Control-Allow-Origin': 'https://clicklaboral.mx',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  const isScheduled = !event.httpMethod;
  if (!isScheduled) {
    const secret = process.env.CRON_SECRET;
    const q = event.queryStringParameters || {};
    const authH = (event.headers || {})['authorization'] || (event.headers || {})['Authorization'] || '';
    if (!secret || (q.secret !== secret && authH !== `Bearer ${secret}`)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado' }) };
    }
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Variables de entorno faltantes' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const ayer = fechaMexico(-1);
  const hoy  = fechaMexico(0);

  // ── Modo backfill ─────────────────────────────────────────────────────────
  let bodyJson = {};
  try { bodyJson = JSON.parse(event.body || '{}'); } catch {}
  const isBackfill = bodyJson.backfill === true || (event.queryStringParameters || {}).backfill === '1';
  if (isBackfill) return await runBackfill(sb, hoy, ayer, headers);

  const resumen = {
    ayer,
    hoy,
    dias_cerrados:    0,
    faltas_creadas:   0,
    actas_creadas:    0,
    alertas_faltas:   0,
    alertas_retrasos: 0,
    errores:          [],
  };

  try {
    // ── 1. Cargar TODOS los trabajadores activos ────────────────────────────
    const { data: trabajadores, error: errTrab } = await sb
      .from('trabajadores')
      .select('id, nombre, cliente_rfc, hora_entrada_habitual, fecha_ingreso')
      .eq('activo', true);

    if (errTrab) throw errTrab;
    if (!trabajadores?.length) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, ...resumen, nota: 'Sin trabajadores activos.' }),
      };
    }

    // ── 2. Cargar registros de asistencia de ayer ───────────────────────────
    const ids = trabajadores.map(t => t.id);
    const { data: asistenciasAyer, error: errAsis } = await sb
      .from('asistencias')
      .select('trabajador_id, status')
      .eq('fecha', ayer)
      .in('trabajador_id', ids);

    if (errAsis) throw errAsis;

    const asistenciaMap = {};
    (asistenciasAyer || []).forEach(a => { asistenciaMap[a.trabajador_id] = a.status; });

    const sinRegistro = trabajadores.filter(t => !asistenciaMap[t.id]);
    const conRetraso  = trabajadores.filter(t => asistenciaMap[t.id] === 'retraso');

    // ── 3. Cierre de día — insertar 'sin_registro' para TODOS sin registro ──
    // Garantiza cobertura día a día en la tabla de asistencias.
    for (const t of sinRegistro) {
      try {
        const { error: insSR } = await sb.from('asistencias').upsert({
          trabajador_id: t.id,
          cliente_rfc:   t.cliente_rfc,
          fecha:         ayer,
          status:        'sin_registro',
          fuente:        'control_diario',
          notas:         'Cierre automático de jornada — sin movimiento registrado.',
        }, { onConflict: 'trabajador_id,fecha' });
        if (!insSR) resumen.dias_cerrados++;
      } catch (e) {
        resumen.errores.push(`cierre id:${t.id}: ${e?.message || e}`);
        console.error(`deteccion-faltas cierre id:${t.id}:`, e?.message);
      }
    }

    // ── 4. Procesar faltas: TODOS los trabajadores sin registro en día laboral
    // Se excluyen fines de semana; festivos deben marcarse manualmente.
    const ayerDow = new Date(ayer + 'T12:00:00Z').getUTCDay();
    const esLaboralAyer = ayerDow >= 1 && ayerDow <= 5;
    const candidatosFalta = esLaboralAyer ? sinRegistro : [];

    for (const t of candidatosFalta) {
      try {
        // Actualizar sin_registro → falta_injustificada (solo si no fue modificado ya)
        const { error: updAsis } = await sb.from('asistencias')
          .update({
            status: 'falta_injustificada',
            notas:  'Falta detectada automáticamente — sin registro en checador.',
          })
          .eq('trabajador_id', t.id)
          .eq('fecha', ayer)
          .eq('status', 'sin_registro');

        if (updAsis) {
          resumen.errores.push(`falta upd ${t.nombre}: ${updAsis.message}`);
          continue;
        }
        resumen.faltas_creadas++;

        // Acta de inasistencia provisional
        const { error: insActa } = await sb.from('actas_inasistencia').upsert({
          trabajador_id: t.id,
          cliente_rfc:   t.cliente_rfc,
          fecha:         ayer,
          tipo:          'injustificada',
          motivo:        'No se registró entrada en el checador digital.',
          observaciones: `Generada automáticamente el ${hoy}. Actualice el motivo si la ausencia fue justificada.`,
          estado:        'provisional',
        }, { onConflict: 'trabajador_id,fecha' });
        if (!insActa) resumen.actas_creadas++;

        // Alerta para el cliente
        const { error: insAlFalta } = await sb.from('alertas_laborales').upsert({
          cliente_rfc:       t.cliente_rfc,
          tipo:              'falta_injustificada',
          trabajador_nombre: t.nombre,
          fecha_alerta:      hoy,
          mensaje:           `${t.nombre} no registró entrada el ${fmtFecha(ayer)}. Se generó un acta de inasistencia provisional. Si la ausencia fue justificada, actualice el registro en Control de Asistencias → seleccione la fecha y cambie el status.`,
          urgencia:          'alta',
          leida:             false,
        }, { onConflict: 'cliente_rfc,tipo,trabajador_nombre,fecha_alerta' });
        if (!insAlFalta) resumen.alertas_faltas++;

      } catch (e) {
        resumen.errores.push(`falta id:${t.id}: ${e?.message || e}`);
        console.error(`deteccion-faltas falta id:${t.id}:`, e?.message);
      }
    }

    // ── 5. Procesar retrasos → solo alerta (el acta la levanta el patrón) ───
    for (const t of conRetraso) {
      try {
        const { error: insAlRet } = await sb.from('alertas_laborales').upsert({
          cliente_rfc:       t.cliente_rfc,
          tipo:              'retraso',
          trabajador_nombre: t.nombre,
          fecha_alerta:      hoy,
          mensaje:           `${t.nombre} llegó tarde el ${fmtFecha(ayer)}. Si desea levantar un acta de amonestación, genérela en Herramientas → Acta Administrativa y seleccione el tipo "Retardo/Atraso".`,
          urgencia:          'media',
          leida:             false,
        }, { onConflict: 'cliente_rfc,tipo,trabajador_nombre,fecha_alerta' });
        if (!insAlRet) resumen.alertas_retrasos++;
      } catch (e) {
        resumen.errores.push(`retraso id:${t.id}: ${e?.message || e}`);
        console.error(`deteccion-faltas retraso id:${t.id}:`, e?.message);
      }
    }

    console.log('deteccion-faltas resultado:', JSON.stringify(resumen));
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...resumen }) };

  } catch (e) {
    console.error('deteccion-faltas:', e?.message || e);
    reportError('deteccion-faltas', e).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || 'Error interno', ...resumen }) };
  }
};

// ── Backfill histórico ────────────────────────────────────────────────────────
async function runBackfill(sb, hoy, ayer, headers) {
  const resumen = {
    modo: 'backfill',
    hoy,
    ayer,
    registros_creados: 0,
    alertas_creadas:   0,
    trabajadores_con_faltas: 0,
    errores: [],
  };

  try {
    const { data: trabajadores, error: tErr } = await sb
      .from('trabajadores')
      .select('id, nombre, cliente_rfc, fecha_ingreso')
      .eq('activo', true)
      .not('fecha_ingreso', 'is', null);

    if (tErr) throw tErr;
    if (!trabajadores?.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...resumen, nota: 'Sin trabajadores con fecha_ingreso.' }) };
    }

    const ids = trabajadores.map(t => t.id);

    // Cargar TODOS los registros existentes (solo trabaj_id + fecha para eficiencia)
    const { data: existentes, error: eErr } = await sb
      .from('asistencias')
      .select('trabajador_id,fecha')
      .in('trabajador_id', ids);
    if (eErr) throw eErr;

    const existeSet = new Set((existentes || []).map(a => `${a.trabajador_id}|${a.fecha}`));

    // Calcular días laborales faltantes por trabajador
    const nuevosRegistros = [];
    const alertasDatos = [];

    for (const t of trabajadores) {
      const diasFaltantes = diasLaboralesArr(t.fecha_ingreso, ayer)
        .filter(d => !existeSet.has(`${t.id}|${d}`));

      if (!diasFaltantes.length) continue;

      for (const dia of diasFaltantes) {
        nuevosRegistros.push({
          trabajador_id: t.id,
          cliente_rfc:   t.cliente_rfc,
          fecha:         dia,
          status:        'falta_injustificada',
          fuente:        'control_diario',
          notas:         'Falta detectada en revisión histórica — sin registro en checador.',
        });
      }

      alertasDatos.push({
        cliente_rfc:       t.cliente_rfc,
        tipo:              'faltas_historicas',
        trabajador_nombre: t.nombre,
        fecha_alerta:      hoy,
        mensaje:           `Revisión histórica: ${t.nombre} tiene ${diasFaltantes.length} día${diasFaltantes.length > 1 ? 's' : ''} sin registro desde su ingreso (${t.fecha_ingreso}). Verifique si las ausencias son justificadas y actualice los registros en Control de Asistencias.`,
        urgencia:          diasFaltantes.length >= 10 ? 'alta' : diasFaltantes.length >= 3 ? 'media' : 'baja',
        leida:             false,
      });
    }

    // Upsert en lotes de 500
    const CHUNK = 500;
    for (let i = 0; i < nuevosRegistros.length; i += CHUNK) {
      const { error: upErr } = await sb.from('asistencias')
        .upsert(nuevosRegistros.slice(i, i + CHUNK), { onConflict: 'trabajador_id,fecha' });
      if (upErr) resumen.errores.push(`asistencias batch ${i}: ${upErr.message}`);
      else resumen.registros_creados += Math.min(CHUNK, nuevosRegistros.length - i);
    }

    // Una alerta resumen por trabajador
    for (const alerta of alertasDatos) {
      const { error: aErr } = await sb.from('alertas_laborales')
        .upsert(alerta, { onConflict: 'cliente_rfc,tipo,trabajador_nombre,fecha_alerta' });
      if (aErr) resumen.errores.push(`alerta ${alerta.trabajador_nombre}: ${aErr.message}`);
      else resumen.alertas_creadas++;
    }

    resumen.trabajadores_con_faltas = alertasDatos.length;
    console.log('deteccion-faltas backfill:', JSON.stringify(resumen));
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...resumen }) };

  } catch (e) {
    console.error('deteccion-faltas backfill:', e?.message || e);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || 'Error', ...resumen }) };
  }
}

function diasLaboralesArr(desde, hasta) {
  const dias = [];
  const cur = new Date(desde + 'T12:00:00Z');
  const fin = new Date(hasta + 'T12:00:00Z');
  while (cur <= fin) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) dias.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dias;
}

// ── Utilidades ───────────────────────────────────────────────────────────────

function fechaMexico(offsetDias) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const partes = {};
  fmt.formatToParts(new Date()).forEach(p => { partes[p.type] = p.value; });
  const base = new Date(`${partes.year}-${partes.month}-${partes.day}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDias);
  return base.toISOString().split('T')[0];
}

function fmtFecha(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    weekday: 'long', day: 'numeric', month: 'long',
  });
}
