// netlify/functions/deteccion-faltas.js
//
// Cierre de jornada: garantiza que TODOS los trabajadores activos tengan un
// registro en `asistencias` para el día anterior.
//
// ⚠️  Esta función SOLO escribe en `asistencias`. Las actas de inasistencia y
//     las alertas las crea/resuelve el trigger fn_reconciliar_asistencia()
//     (migración 20260902000002_motor_asistencias.sql) — un solo cerebro para
//     que checador, ADMS, CSV, captura manual y cron queden siempre alineados.
//
// Modo diario (cron, 07:00 CDMX):
//   Para cada trabajador activo sin registro de ayer:
//     • Día cubierto por vacaciones autorizadas/gozadas → 'vacaciones'
//     • Día laboral (L-V) posterior a su alta en el sistema → 'falta_injustificada'
//     • Fin de semana                                   → 'sin_registro'
//   Trabajadores con status 'retraso' → alerta informativa.
//
// Modo backfill (POST { backfill: true } o ?backfill=1):
//   Reconciliación histórica: rellena huecos desde fecha_ingreso.
//     • Días anteriores al alta en el sistema (created_at) → 'presente' (política:
//       la asistencia se controla desde que el cliente empieza a usar ClickLaboral)
//     • Días posteriores al alta                            → 'falta_injustificada'
//
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

  let bodyJson = {};
  try { bodyJson = JSON.parse(event.body || '{}'); } catch {}
  const isBackfill = bodyJson.backfill === true || (event.queryStringParameters || {}).backfill === '1';
  if (isBackfill) return await runBackfill(sb, hoy, ayer);

  const resumen = {
    ayer, hoy,
    dias_cerrados:     0,
    faltas_creadas:    0,
    vacaciones_creadas: 0,
    alertas_retrasos:  0,
    errores:           [],
  };

  try {
    // ── 1. Trabajadores activos ───────────────────────────────────────────
    const { data: trabajadores, error: errTrab } = await sb
      .from('trabajadores')
      .select('id, nombre, cliente_rfc, fecha_ingreso, created_at, dias_descanso')
      .eq('activo', true);
    if (errTrab) throw errTrab;
    if (!trabajadores?.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...resumen, nota: 'Sin trabajadores activos.' }) };
    }

    // ── 2. Registros de ayer ──────────────────────────────────────────────
    const ids = trabajadores.map(t => t.id);
    const { data: asistenciasAyer, error: errAsis } = await sb
      .from('asistencias')
      .select('trabajador_id, status')
      .eq('fecha', ayer)
      .in('trabajador_id', ids);
    if (errAsis) throw errAsis;

    const asistenciaMap = {};
    (asistenciasAyer || []).forEach(a => { asistenciaMap[a.trabajador_id] = a.status; });

    // ── 3. Vacaciones autorizadas/gozadas que cubren ayer ─────────────────
    const { data: vacs } = await sb
      .from('vacaciones_programadas')
      .select('trabajador_id, incluye_finde')
      .in('estado', ['autorizada', 'gozada'])
      .lte('fecha_inicio', ayer)
      .gte('fecha_fin', ayer)
      .in('trabajador_id', ids);
    const ayerDow = new Date(ayer + 'T12:00:00Z').getUTCDay();
    const trabajadorMap = {};
    trabajadores.forEach(t => { trabajadorMap[t.id] = t; });
    const conVacaciones = new Set(
      (vacs || []).filter(v => v.incluye_finde || !esDiaDescanso(trabajadorMap[v.trabajador_id], ayerDow)).map(v => v.trabajador_id)
    );

    // ── 4. Cierre de día — un registro para CADA trabajador sin movimiento ─
    const ayerEsFeriado = esDiaFeriado(ayer);
    const registros = [];
    for (const t of trabajadores) {
      if (asistenciaMap[t.id]) continue;
      if (t.fecha_ingreso && t.fecha_ingreso > ayer) continue; // aún no ingresaba

      let status, fuente, notas;
      if (conVacaciones.has(t.id)) {
        status = 'vacaciones'; fuente = 'programacion';
        notas  = 'Periodo de vacaciones autorizado.';
        resumen.vacaciones_creadas++;
      } else if (ayerEsFeriado) {
        status = 'festivo'; fuente = 'control_diario';
        notas  = 'Día de descanso obligatorio — Art. 74 LFT.';
      } else if (esDiaDescanso(t, ayerDow)) {
        status = 'descanso'; fuente = 'control_diario';
        notas  = 'Día de descanso configurado del trabajador.';
      } else if (ayer >= altaEnSistema(t)) {
        status = 'falta_injustificada'; fuente = 'control_diario';
        notas  = 'Falta detectada automáticamente — sin registro en checador.';
        resumen.faltas_creadas++;
      } else {
        status = 'sin_registro'; fuente = 'control_diario';
        notas  = 'Cierre automático de jornada — sin movimiento registrado.';
      }
      registros.push({ trabajador_id: t.id, cliente_rfc: t.cliente_rfc, fecha: ayer, status, fuente, notas });
    }

    for (let i = 0; i < registros.length; i += 500) {
      const { error } = await sb.from('asistencias')
        .upsert(registros.slice(i, i + 500), { onConflict: 'trabajador_id,fecha', ignoreDuplicates: true });
      if (error) resumen.errores.push(`cierre batch ${i}: ${error.message}`);
      else resumen.dias_cerrados += Math.min(500, registros.length - i);
    }

    // ── 5. Retrasos → alerta informativa (el acta la levanta el patrón) ───
    const conRetraso = trabajadores.filter(t => asistenciaMap[t.id] === 'retraso');
    for (const t of conRetraso) {
      const { error } = await sb.from('alertas_laborales').upsert({
        cliente_rfc:       t.cliente_rfc,
        tipo:              'retraso',
        trabajador_nombre: t.nombre,
        trabajador_id:     t.id,
        fecha_evento:      ayer,
        fecha_alerta:      hoy,
        mensaje:           `${t.nombre} llegó tarde el ${fmtFecha(ayer)}. Si desea levantar un acta de amonestación, genérela en Herramientas → Acta Administrativa y seleccione el tipo "Retardo/Atraso".`,
        urgencia:          'media',
        leida:             false,
      }, { onConflict: 'cliente_rfc,tipo,trabajador_nombre,fecha_alerta' });
      if (error) resumen.errores.push(`retraso id:${t.id}: ${error.message}`);
      else resumen.alertas_retrasos++;
    }

    if (resumen.errores.length) {
      console.error('deteccion-faltas errores:', JSON.stringify(resumen.errores));
      reportError('deteccion-faltas', new Error(resumen.errores.join(' | '))).catch(() => {});
    }
    console.log('deteccion-faltas resultado:', JSON.stringify({ ...resumen, errores: resumen.errores.length }));
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...resumen }) };

  } catch (e) {
    console.error('deteccion-faltas:', e?.message || e);
    reportError('deteccion-faltas', e).catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || 'Error interno', ...resumen }) };
  }
};

// ── Backfill / reconciliación histórica ──────────────────────────────────────
async function runBackfill(sb, hoy, ayer) {
  const resumen = {
    modo: 'backfill', hoy, ayer,
    presentes_creados: 0,
    faltas_creadas:    0,
    vacaciones_creadas: 0,
    errores: [],
  };

  try {
    const { data: trabajadores, error: tErr } = await sb
      .from('trabajadores')
      .select('id, nombre, cliente_rfc, fecha_ingreso, created_at, dias_descanso')
      .eq('activo', true)
      .not('fecha_ingreso', 'is', null);
    if (tErr) throw tErr;
    if (!trabajadores?.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...resumen, nota: 'Sin trabajadores con fecha_ingreso.' }) };
    }

    const ids = trabajadores.map(t => t.id);

    // Registros existentes (paginado para no perder filas >1000)
    const existeSet = new Set();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('asistencias')
        .select('trabajador_id,fecha')
        .in('trabajador_id', ids)
        .range(from, from + 999);
      if (error) throw error;
      (data || []).forEach(a => existeSet.add(`${a.trabajador_id}|${a.fecha}`));
      if (!data || data.length < 1000) break;
    }

    // Vacaciones autorizadas/gozadas (todas)
    const { data: vacs } = await sb.from('vacaciones_programadas')
      .select('trabajador_id, fecha_inicio, fecha_fin, incluye_finde')
      .in('estado', ['autorizada', 'gozada'])
      .in('trabajador_id', ids);
    const vacPorTrab = {};
    (vacs || []).forEach(v => { (vacPorTrab[v.trabajador_id] ||= []).push(v); });

    const nuevos = [];
    for (const t of trabajadores) {
      const alta = altaEnSistema(t);
      const desde = t.fecha_ingreso > ayer ? null : t.fecha_ingreso;
      if (!desde) continue;

      for (const dia of diasArr(desde, ayer)) {
        if (existeSet.has(`${t.id}|${dia}`)) continue;
        const dow = new Date(dia + 'T12:00:00Z').getUTCDay();
        const esDescansoDia = esDiaDescanso(t, dow);
        const esFeriadoDia = esDiaFeriado(dia);
        const enVac = (vacPorTrab[t.id] || []).some(v =>
          dia >= v.fecha_inicio && dia <= v.fecha_fin && (v.incluye_finde || !esDescansoDia));

        let status, fuente, notas;
        if (enVac) {
          status = 'vacaciones'; fuente = 'programacion'; notas = 'Periodo de vacaciones autorizado.';
          resumen.vacaciones_creadas++;
        } else if (esFeriadoDia || esDescansoDia) {
          continue; // festivos y días de descanso históricos: no se rellenan (igual que antes con fines de semana)
        } else if (dia < alta) {
          status = 'presente'; fuente = 'sistema';
          notas  = 'Asistencia retroactiva — anterior al alta en ClickLaboral';
          resumen.presentes_creados++;
        } else {
          status = 'falta_injustificada'; fuente = 'control_diario';
          notas  = 'Falta detectada en revisión histórica — sin registro en checador.';
          resumen.faltas_creadas++;
        }
        nuevos.push({ trabajador_id: t.id, cliente_rfc: t.cliente_rfc, fecha: dia, status, fuente, notas });
      }
    }

    for (let i = 0; i < nuevos.length; i += 500) {
      const { error } = await sb.from('asistencias')
        .upsert(nuevos.slice(i, i + 500), { onConflict: 'trabajador_id,fecha', ignoreDuplicates: true });
      if (error) resumen.errores.push(`batch ${i}: ${error.message}`);
    }

    console.log('deteccion-faltas backfill:', JSON.stringify(resumen));
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...resumen }) };

  } catch (e) {
    console.error('deteccion-faltas backfill:', e?.message || e);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || 'Error', ...resumen }) };
  }
}

// ── Utilidades ───────────────────────────────────────────────────────────────

// ¿El trabajador descansa el día de la semana `dow` (0=domingo..6=sábado,
// convención Date.getUTCDay())? Si el trabajador tiene dias_descanso
// configurado, se respeta tal cual (puede ser cualquier combinación de días,
// no solo fin de semana). Si no lo tiene configurado (arreglo vacío o
// ausente), se usa el default histórico sábado/domingo para no cambiar el
// comportamiento de trabajadores que nunca lo configuraron.
function esDiaDescanso(t, dow) {
  if (t?.dias_descanso?.length) return t.dias_descanso.includes(dow);
  return dow === 0 || dow === 6;
}

// Días de descanso obligatorio — Art. 74 LFT (fracciones I-VIII). NO incluye la
// fracción IX (jornada electoral): esa fecha la determina el INE o el organismo
// electoral local caso por caso y no sigue una fórmula fija; se marca manualmente
// como 'festivo' desde el calendario cuando aplique.
//
// A diferencia de calendarios genéricos tipo banking-holiday (p.ej. workalendar),
// la LFT NO recorre estos días al viernes/lunes más cercano cuando caen en fin de
// semana — la fecha designada es la fecha designada, punto. Tampoco se le agrega
// aquí el "puente" del 31 de diciembre ni ningún otro ajuste: son 7 fechas fijas
// por año, más el 1 de octubre de años de transmisión del Poder Ejecutivo Federal
// (cada 6 años desde 2024, tras la reforma que movió la fecha del 1 de diciembre).
function feriadosObligatoriosMx(year) {
  const pad = n => String(n).padStart(2, '0');
  const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  // n-ésima ocurrencia de un día de la semana en un mes (1=enero..12=diciembre,
  // 0=domingo..6=sábado), replicando el patrón de Calendar.get_nth_weekday_in_month
  // de workalendar pero devolviendo directamente el string 'YYYY-MM-DD'.
  const nEsimoDiaSemana = (y, mes, diaSemana, n) => {
    const d = new Date(y, mes - 1, 1);
    let cuenta = 0;
    while (d.getMonth() === mes - 1) {
      if (d.getDay() === diaSemana) {
        cuenta++;
        if (cuenta === n) return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
      }
      d.setDate(d.getDate() + 1);
    }
    return null;
  };
  const dias = [
    fmt(year, 1, 1),                  // I.   Año nuevo
    nEsimoDiaSemana(year, 2, 1, 1),    // II.  Primer lunes de febrero (Día de la Constitución)
    nEsimoDiaSemana(year, 3, 1, 3),    // III. Tercer lunes de marzo (Natalicio de Benito Juárez)
    fmt(year, 5, 1),                  // IV.  Día del Trabajo
    fmt(year, 9, 16),                 // V.   Día de la Independencia
    nEsimoDiaSemana(year, 11, 1, 3),   // VI.  Tercer lunes de noviembre (Día de la Revolución)
    fmt(year, 12, 25),                // VIII. Navidad
  ];
  // VII. Transmisión del Poder Ejecutivo Federal — 1 de octubre cada 6 años desde 2024
  if (year >= 2024 && (year - 2024) % 6 === 0) dias.push(fmt(year, 10, 1));
  return dias.filter(Boolean);
}

const _feriadosCache = {};
function esDiaFeriado(fechaStr) {
  const year = parseInt(fechaStr.slice(0, 4), 10);
  if (!_feriadosCache[year]) _feriadosCache[year] = feriadosObligatoriosMx(year);
  return _feriadosCache[year].includes(fechaStr);
}

// Fecha (CDMX) en que el trabajador fue dado de alta en ClickLaboral.
// A partir de ese día la ausencia de registro sí es falta.
function altaEnSistema(t) {
  if (!t.created_at) return '1900-01-01';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = {};
  fmt.formatToParts(new Date(t.created_at)).forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}

function diasArr(desde, hasta) {
  const dias = [];
  const cur = new Date(desde + 'T12:00:00Z');
  const fin = new Date(hasta + 'T12:00:00Z');
  while (cur <= fin) {
    dias.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dias;
}

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
