// netlify/functions/deteccion-faltas.js
//
// Detecta automáticamente faltas y retrasos del día anterior.
// Para cada trabajador activo con horario establecido (hora_entrada_habitual):
//   - Sin registro de asistencia → crea falta_injustificada + acta_inasistencia + alerta (alta)
//   - Registro con status retraso → crea alerta (media) para que el cliente levante acta
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
  // Las Netlify Scheduled Functions no envían httpMethod — se consideran confiables.
  // Las llamadas HTTP manuales (pruebas, cron externo) requieren CRON_SECRET.
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
    faltas_creadas:     0,
    actas_creadas:      0,
    alertas_faltas:     0,
    alertas_retrasos:   0,
    errores:            [],
  };

  try {
    // ── 1. Cargar trabajadores activos con horario establecido ──────
    const { data: trabajadores, error: errTrab } = await sb
      .from('trabajadores')
      .select('id, nombre, cliente_rfc, hora_entrada_habitual')
      .eq('activo', true)
      .not('hora_entrada_habitual', 'is', null);

    if (errTrab) throw errTrab;
    if (!trabajadores?.length) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, ...resumen, nota: 'Sin trabajadores con horario configurado.' }),
      };
    }

    // ── 2. Cargar registros de asistencia de ayer ───────────────────
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

    // ── 3. Procesar faltas injustificadas ───────────────────────────
    for (const t of sinRegistro) {
      try {
        // 3a. Registro de asistencia (upsert: no duplicar si ya existe)
        const { error: insAsis } = await sb.from('asistencias').upsert({
          trabajador_id: t.id,
          cliente_rfc:   t.cliente_rfc,
          fecha:         ayer,
          status:        'falta_injustificada',
          fuente:        'manual',
          notas:         'Falta detectada automáticamente — sin registro en checador.',
        }, { onConflict: 'trabajador_id,fecha' });
        if (insAsis) { resumen.errores.push(`asistencia ${t.nombre}: ${insAsis.message}`); continue; }
        resumen.faltas_creadas++;

        // 3b. Acta de inasistencia (provisional, editable por el cliente)
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

        // 3c. Alerta para el cliente
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

    // ── 4. Procesar retrasos → solo alerta (el acta la levanta el patrón) ──
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

// Fecha en zona horaria de México (America/Mexico_City), con offset en días
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
