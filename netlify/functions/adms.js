// netlify/functions/adms.js
//
// Implementa el protocolo ADMS de ZKTeco para recibir registros de asistencia
// en tiempo real desde checadores biométricos en red (Ethernet/WiFi).
//
// Endpoints que maneja (mapeados desde /iclock/* via netlify.toml):
//   GET  /iclock/cdata?SN=xxx&options=all   → configuración del dispositivo
//   POST /iclock/cdata?SN=xxx&table=ATTLOG  → procesa registros de asistencia
//   GET  /iclock/getrequest?SN=xxx          → comandos pendientes (vacío)
//   POST /iclock/devicecmd?SN=xxx           → acuse de recibo de comandos
//
// Seguridad: solo se procesan datos de dispositivos registrados en la tabla
// `checadores` con un cliente_rfc asignado. El registro lo hace el cliente
// desde la pestaña "Checador en Red" de asistencias-vacaciones.html.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');

const TXT = { 'Content-Type': 'text/plain; charset=utf-8' };
const ok  = (body) => ({ statusCode: 200, headers: TXT, body: String(body) });
const err = (code, body) => ({ statusCode: code, headers: TXT, body: String(body) });

exports.handler = async (event) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return err(500, 'Config error');
  }

  const path   = (event.path || '').toLowerCase();
  const method = (event.httpMethod || 'GET').toUpperCase();
  const qs     = event.queryStringParameters || {};
  const sn     = (qs.SN || qs.sn || '').trim();

  if (!sn) return err(400, 'Missing SN');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Actualizar último contacto del dispositivo (upsert solo sn y timestamp)
  await sb.from('checadores').upsert(
    { sn, ultimo_contacto: new Date().toISOString() },
    { onConflict: 'sn', ignoreDuplicates: false }
  ).then(() => {}).catch(() => {});  // silencioso si checadores no existe aún

  // ── Routing ─────────────────────────────────────────────────────────────────

  // GET /iclock/cdata?options=all → configuración del dispositivo
  if (method === 'GET' && path.includes('cdata')) {
    return ok(buildConfig(sn));
  }

  // GET /iclock/getrequest → sin comandos pendientes
  if (method === 'GET' && path.includes('getrequest')) {
    return ok('OK');
  }

  // POST /iclock/cdata?table=ATTLOG → procesar registros de asistencia
  if (method === 'POST' && path.includes('cdata') && qs.table === 'ATTLOG') {
    return await processAttlog(sb, sn, event.body || '');
  }

  // POST /iclock/cdata (otras tablas: OPERLOG, BIODATA, etc.) → ignorar
  if (method === 'POST' && path.includes('cdata')) {
    return ok('OK: 0');
  }

  // POST /iclock/devicecmd → acuse de comandos
  if (method === 'POST' && path.includes('devicecmd')) {
    return ok('OK');
  }

  return ok('OK');
};

// ── Configuración para el dispositivo ────────────────────────────────────────
function buildConfig(sn) {
  return [
    `GET OPTION FROM: ${sn}`,
    'ATTLOGStamp=0',
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=11111000001000',
    'TimeZone=6',
    'Realtime=1',
    'Encrypt=None',
    'ServerVer=2.4.1',
    'PushProtVer=2.4.1',
    'PushOptionsFlag=1',
  ].join('\n');
}

// ── Procesar ATTLOG ────────────────────────────────────────────────────────────
async function processAttlog(sb, sn, body) {
  // Verificar que el dispositivo esté registrado y asociado a un cliente
  const { data: device } = await sb
    .from('checadores')
    .select('cliente_rfc')
    .eq('sn', sn)
    .maybeSingle();

  if (!device?.cliente_rfc) {
    console.warn(`adms: SN ${sn} no registrado o sin cliente asignado`);
    return ok('OK: 0');
  }
  const clienteRFC = device.cliente_rfc;

  // Parsear líneas del ATTLOG
  // Formato: PIN\tDatetime\tStatus\tVerify\t...\n
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return ok('OK: 0');

  // Cargar trabajadores con pin_checador asignado para este cliente
  const { data: trabs } = await sb
    .from('trabajadores')
    .select('id, nombre, hora_entrada_habitual, pin_checador')
    .eq('cliente_rfc', clienteRFC)
    .eq('activo', true)
    .not('pin_checador', 'is', null);

  if (!trabs?.length) {
    console.warn(`adms: sin trabajadores con pin_checador en ${clienteRFC}`);
    return ok('OK: 0');
  }

  const pinMap = {};  // pin → trabajador
  for (const t of trabs) {
    if (t.pin_checador) pinMap[String(t.pin_checador).trim()] = t;
  }

  // Agrupar registros por trabajador + fecha (para resolver check-in/check-out)
  // { "trabId|2026-08-20": { trabId, clienteRFC, fecha, entrada?, salida?, trabajador } }
  const groups = {};

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;

    const pin        = (parts[0] || '').trim();
    const datetimeStr = (parts[1] || '').trim();
    const statusCode = parseInt(parts[2] ?? '0', 10);

    if (!pin || !datetimeStr) continue;

    const spaceIdx = datetimeStr.indexOf(' ');
    if (spaceIdx < 0) continue;
    const fecha    = datetimeStr.slice(0, spaceIdx);
    const timePart = datetimeStr.slice(spaceIdx + 1, spaceIdx + 6);  // HH:MM

    const trab = pinMap[pin];
    if (!trab) continue;

    const key = `${trab.id}|${fecha}`;
    if (!groups[key]) {
      groups[key] = { trab, fecha, entrada: null, salida: null };
    }

    // 0=entrada, 4=OT-entrada → registrar hora de entrada (más temprana del día)
    if (statusCode === 0 || statusCode === 4) {
      if (!groups[key].entrada || timePart < groups[key].entrada) {
        groups[key].entrada = timePart;
      }
    }
    // 1=salida, 5=OT-salida → registrar hora de salida (más tardía del día)
    if (statusCode === 1 || statusCode === 5) {
      if (!groups[key].salida || timePart > groups[key].salida) {
        groups[key].salida = timePart;
      }
    }
  }

  // Upsert de asistencias
  const registros = [];
  for (const { trab, fecha, entrada, salida } of Object.values(groups)) {
    if (!entrada && !salida) continue;

    let status = 'presente';
    if (entrada && trab.hora_entrada_habitual) {
      const [eh, em] = trab.hora_entrada_habitual.split(':').map(Number);
      const [ch, cm] = entrada.split(':').map(Number);
      if ((ch * 60 + cm) > (eh * 60 + em) + 15) status = 'retraso';
    }

    registros.push({
      trabajador_id: trab.id,
      cliente_rfc:   clienteRFC,
      fecha,
      status,
      hora_entrada:  entrada || null,
      hora_salida:   salida  || null,
      fuente:        'adms',
    });
  }

  if (!registros.length) return ok('OK: 0');

  const { error } = await sb.from('asistencias').upsert(registros, {
    onConflict: 'trabajador_id,fecha',
    ignoreDuplicates: false,
  });

  if (error) {
    console.error('adms upsert error:', error.message);
    return ok('OK: 0');
  }

  console.log(`adms: ${registros.length} registros procesados para ${clienteRFC} (SN:${sn})`);
  return ok(`OK: ${registros.length}`);
}
