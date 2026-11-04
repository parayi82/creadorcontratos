// tests/adms-merge.test.js
//
// Tests del bug del ZKTeco (ADMS): un lote con solo la salida borraba la
// entrada ya registrada. No requieren red, credenciales ni node_modules.
// Ejecutar con:
//   node tests/adms-merge.test.js
//
// Parte 1: combinarAsistencia() (netlify/functions/_adms-merge.js)
// Parte 2: netlify/functions/adms.js completo contra un Supabase simulado que
//          imita el upsert real de PostgREST (sobrescribe cada columna enviada,
//          incluidos los null). Con ADMS_PATH=<ruta> se puede correr contra
//          otra versión del handler (p. ej. la anterior, para ver el bug).

'use strict';

const assert = require('assert');
const path   = require('path');
const Module = require('module');

let fallos = 0, pasaron = 0;
async function test(nombre, fn) {
  try { await fn(); pasaron++; console.log('  ✓', nombre); }
  catch (e) { fallos++; console.log('  ✗', nombre, '\n     ', e.message); }
}

(async () => {
  // ── Parte 1 ────────────────────────────────────────────────────────────────
  console.log('combinarAsistencia');
  const { combinarAsistencia, normHora } = require('../netlify/functions/_adms-merge');
  const trab = { id: 't1', hora_entrada_habitual: '08:00' };

  await test('normHora acepta HH:MM, HH:MM:SS y microsegundos', () => {
    assert.strictEqual(normHora('08:05'), '08:05:00');
    assert.strictEqual(normHora('08:05:07'), '08:05:07');
    assert.strictEqual(normHora('08:05:07.123456'), '08:05:07');
    assert.strictEqual(normHora(null), null);
    assert.strictEqual(normHora('basura'), null);
  });

  await test('lote con SOLO salida conserva la entrada existente (el bug)', () => {
    const r = combinarAsistencia({ trab, fecha: '2026-11-04', entrada: null, salida: '17:02:00' },
      { hora_entrada: '07:58:00', hora_salida: null, status: 'presente' }, 'AAA');
    assert.strictEqual(r.hora_entrada, '07:58:00');
    assert.strictEqual(r.hora_salida, '17:02:00');
    assert.strictEqual(r.status, 'presente');
  });

  await test('lote con SOLO entrada conserva la salida existente', () => {
    const r = combinarAsistencia({ trab, fecha: '2026-11-04', entrada: '07:58:00', salida: null },
      { hora_entrada: null, hora_salida: '17:02:00', status: 'presente' }, 'AAA');
    assert.strictEqual(r.hora_entrada, '07:58:00');
    assert.strictEqual(r.hora_salida, '17:02:00');
  });

  await test('una entrada posterior no pisa a la primera; gana la más temprana', () => {
    const r = combinarAsistencia({ trab, fecha: '2026-11-04', entrada: '13:30:00', salida: null },
      { hora_entrada: '07:58:00', hora_salida: null, status: 'presente' }, 'AAA');
    assert.strictEqual(r, null, 'no hay nada nuevo que escribir');
  });

  await test('una salida más tardía sí reemplaza; una más temprana no', () => {
    const ex = { hora_entrada: '07:58:00', hora_salida: '14:00:00', status: 'presente' };
    assert.strictEqual(combinarAsistencia({ trab, fecha: 'f', entrada: null, salida: '18:00:00' }, ex, 'AAA').hora_salida, '18:00:00');
    assert.strictEqual(combinarAsistencia({ trab, fecha: 'f', entrada: null, salida: '13:00:00' }, ex, 'AAA'), null);
  });

  await test('reenvío idéntico del reloj no escribe nada (no llena la bitácora)', () => {
    const r = combinarAsistencia({ trab, fecha: 'f', entrada: '07:58:00', salida: '17:02:00' },
      { hora_entrada: '07:58:00', hora_salida: '17:02:00', status: 'presente' }, 'AAA');
    assert.strictEqual(r, null);
  });

  await test('retraso con tolerancia de 15 min sobre la entrada combinada', () => {
    assert.strictEqual(combinarAsistencia({ trab, fecha: 'f', entrada: '08:15:00', salida: null }, undefined, 'AAA').status, 'presente');
    assert.strictEqual(combinarAsistencia({ trab, fecha: 'f', entrada: '08:16:00', salida: null }, undefined, 'AAA').status, 'retraso');
    // si luego llega una entrada más temprana, el retraso se corrige
    assert.strictEqual(combinarAsistencia({ trab, fecha: 'f', entrada: '07:50:00', salida: null },
      { hora_entrada: '08:30:00', status: 'retraso' }, 'AAA').status, 'presente');
  });

  await test('sin registro previo: crea el renglón con lo que trae el lote', () => {
    const r = combinarAsistencia({ trab, fecha: '2026-11-04', entrada: null, salida: '17:02:00' }, undefined, 'AAA');
    assert.deepStrictEqual(r, { trabajador_id: 't1', cliente_rfc: 'AAA', fecha: '2026-11-04', status: 'presente',
      hora_entrada: null, hora_salida: '17:02:00', fuente: 'adms' });
  });

  // ── Parte 2 ────────────────────────────────────────────────────────────────
  console.log('adms.js (handler completo, Supabase simulado)');
  const DB = {
    checadores:   [{ sn: 'SN1', cliente_rfc: 'AAA' }],
    trabajadores: [{ id: 't1', cliente_rfc: 'AAA', activo: true, nombre: 'X', hora_entrada_habitual: '08:00', pin_checador: '7' }],
    asistencias:  [],
    marcaciones:  [],
  };
  function q(tabla) {
    const filtros = [];
    const o = {
      select() { return o; },
      eq(c, v) { filtros.push(r => r[c] === v); return o; },
      in(c, v) { filtros.push(r => v.includes(r[c])); return o; },
      not() { return o; },
      maybeSingle() { return Promise.resolve({ data: DB[tabla].filter(r => filtros.every(f => f(r)))[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: DB[tabla].filter(r => filtros.every(f => f(r))), error: null }).then(res, rej); },
      upsert(rows, opts) {
        rows = Array.isArray(rows) ? rows : [rows];
        if (tabla === 'asistencias') {
          for (const row of rows) {
            const ex = DB.asistencias.find(a => a.trabajador_id === row.trabajador_id && a.fecha === row.fecha);
            if (ex) Object.assign(ex, row);          // PostgREST: SET col = EXCLUDED.col para cada columna enviada
            else DB.asistencias.push({ ...row });
          }
        } else if (tabla === 'marcaciones') {
          for (const row of rows) {
            const dup = DB.marcaciones.find(m => m.trabajador_id === row.trabajador_id && m.tipo === row.tipo && m.hora_dispositivo === row.hora_dispositivo);
            if (!dup || !opts?.ignoreDuplicates) DB.marcaciones.push({ ...row });
          }
        }
        return Promise.resolve({ error: null });
      },
    };
    return o;
  }
  const fakeSupabase = { createClient: () => ({ from: q }) };
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === '@supabase/supabase-js') return fakeSupabase;
    return origLoad.call(this, req, ...rest);
  };
  process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_KEY = 'k';
  const adms = require(process.env.ADMS_PATH ? path.resolve(process.env.ADMS_PATH) : '../netlify/functions/adms.js');
  const silenciar = console.log; const enviar = async (lineas) => {
    console.log = () => {};
    try {
      return await adms.handler({ path: '/iclock/cdata', httpMethod: 'POST',
        queryStringParameters: { SN: 'SN1', table: 'ATTLOG' }, body: lineas.join('\n') });
    } finally { console.log = silenciar; }
  };
  const dia = () => DB.asistencias.find(a => a.fecha === '2026-11-04');
  const h = v => (v == null ? null : normHora(v).slice(0, 5));   // HH:MM, sin importar el formato

  await test('lote 1 (entrada) y lote 2 (solo salida): el día queda con ambas', async () => {
    await enviar(['7\t2026-11-04 07:58:12\t0\t1']);
    assert.strictEqual(h(dia().hora_entrada), '07:58');
    await enviar(['7\t2026-11-04 17:02:40\t1\t1']);
    assert.strictEqual(h(dia().hora_entrada), '07:58', 'la entrada se borró');
    assert.strictEqual(h(dia().hora_salida), '17:02');
  });

  await test('lote 3 con una entrada posterior (13:30) no pisa la de las 07:58', async () => {
    await enviar(['7\t2026-11-04 13:30:00\t0\t1']);
    assert.strictEqual(h(dia().hora_entrada), '07:58', 'la entrada posterior pisó a la primera');
    assert.strictEqual(h(dia().hora_salida), '17:02', 'la salida se borró');
  });

  await test('las checadas crudas siguen llegando a marcaciones (con pausas)', async () => {
    await enviar(['7\t2026-11-04 14:00:00\t2\t1', '7\t2026-11-04 14:45:00\t3\t1']);
    const tipos = DB.marcaciones.map(m => m.tipo);
    assert.deepStrictEqual(tipos, ['entrada', 'salida', 'entrada', 'inicio_pausa', 'fin_pausa']);
  });

  Module._load = origLoad;
  console.log(`\n${pasaron} pasaron, ${fallos} fallaron`);
  process.exit(fallos ? 1 : 0);
})();
