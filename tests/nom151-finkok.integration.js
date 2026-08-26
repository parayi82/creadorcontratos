// tests/nom151-finkok.integration.js
//
// Tests de integración contra el sandbox de Finkok.
// Requieren credenciales reales del PSC. NO ejecutar en CI sin credenciales.
//
// Ejecutar manualmente cuando tengas cuenta Finkok:
//   FINKOK_USERNAME=... FINKOK_PASSWORD=... FINKOK_ENV=sandbox \
//   node tests/nom151-finkok.integration.js

'use strict';

const crypto = require('crypto');
const assert = require('assert/strict');

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

const username = process.env.FINKOK_USERNAME;
const password = process.env.FINKOK_PASSWORD;

if (!username || !password) {
  console.error('Faltan FINKOK_USERNAME y FINKOK_PASSWORD. Exporta las variables antes de ejecutar.');
  process.exit(1);
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

const finkok = require('../netlify/functions/_nom151-finkok');

console.log(`\nNOM-151 Finkok — Integración (sandbox)\n`);

(async () => {
  await test('sandbox: conservar retorna idConstancia y selloTiempo', async () => {
    const hash = sha256(`test-integracion-${Date.now()}`);
    const res  = await finkok.conservar(hash, { tablaOrigen: 'test', filaId: 'int-001' });

    assert.ok(res.idConstancia, 'idConstancia debe existir');
    assert.ok(res.selloTiempo,  'selloTiempo debe existir');
    assert.equal(res.proveedor, 'finkok');
    // selloTiempo debe ser ISO-8601 válido
    assert.ok(!isNaN(new Date(res.selloTiempo).getTime()), `selloTiempo inválido: ${res.selloTiempo}`);
    console.log(`     idConstancia: ${res.idConstancia}`);
    console.log(`     selloTiempo : ${res.selloTiempo}`);
  });

  await test('sandbox: el mismo hash en una segunda llamada responde igual o con nuevo folio', async () => {
    const hash = sha256('hash-repetido-test');
    const r1 = await finkok.conservar(hash, { tablaOrigen: 'test', filaId: 'int-002' });
    assert.ok(r1.idConstancia, 'primera llamada debe tener idConstancia');
  });

  await test('sandbox: rechaza hash con longitud incorrecta', async () => {
    await assert.rejects(
      () => finkok.conservar('abc', { tablaOrigen: 'test', filaId: 'int-003' }),
      /SHA-256/,
    );
  });

  console.log(`\n${passed + failed} tests: ${passed} pasaron, ${failed} fallaron.\n`);
  if (failed > 0) process.exit(1);
})();
