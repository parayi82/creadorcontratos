// netlify/functions/deteccion-faltas.js
//
// Cierra la jornada del día anterior y detecta faltas/retrasos.
//
// Paso 1 — Cierre de día: para TODOS los trabajadores activos sin registro
//   de ayer → inserta 'sin_registro'. Garantiza cobertura día a día en la tabla.
//
// Paso 2 — Detección de faltas: para los que tienen hora_entrada_habitual y
//   quedaron como 'sin_registro' → actualiza a 'falta_injustificada' + acta + alerta.
//
// Paso 3 — Detección de retrasos: para los con status 'retraso' → alerta.
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
      .select('id, nombre, cliente_rfc, hora_entrada_habitual')
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
          fuente:        'sistema',
          notas:         'Cierre automático de jornada — sin movimiento registrado.',
        }, { onConflict: 'trabajador_id,fecha' });
        if (!insSR) resumen.dias_cerrados++;
      } catch (e) {
        resumen.errores.push(`cierre ${t.nombre}: ${e?.message || e}`);
        console.error(`deteccion-faltas cierre ${t.nombre}:`, e?.message);
      }
    }

    // ── 4. Procesar faltas: trabajadores CON horario que quedaron sin registro
    const conHorarioSinRegistro = sinRegistro.filter(t => !!t.hora_entrada_habitual);

    for (const t of conHorarioSinRegistro) {
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
        resumen.errores.push(`falta ${t.nombre}: ${e?.message || e}`);
        console.error(`deteccion-faltas falta ${t.nombre}:`, e?.message);
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
        resumen.errores.push(`retraso ${t.nombre}: ${e?.message || e}`);
        console.error(`deteccion-faltas retraso ${t.nombre}:`, e?.message);
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
