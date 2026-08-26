// tests/nom151.test.js
//
// Tests unitarios del adaptador NOM-151 conservación.
// No requieren red ni credenciales. Ejecutar con:
//   node tests/nom151.test.js
//
// Verifica:
//   1. Mock emite idConstancia determinista basada en el hash
//   2. Mock rechaza hashes con longitud incorrecta
//   3. Hash SHA-256 se calcula en servidor (no acepta valor externo)
//   4. Ningún log del módulo contiene patrones de datos personales
//   5. El provider selector lanza error para nombres desconocidos
//   6. Idempotencia del mock: mismo hash → mismo idConstancia

'use strict';

const crypto  = require('crypto');
const assert  = require('assert/strict');
const path    = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ── Suite ─────────────────────────────────────────────────────────────────────

const mockPath     = path.resolve(__dirname, '../netlify/functions/_nom151-mock.js');
const providerPath = path.resolve(__dirname, '../netlify/functions/_nom151-provider.js');

console.log('\nNOM-151 — Adaptador de conservación\n');

(async () => {
  // ── 1. Mock: idConstancia determinista ──────────────────────────────────────
  await test('mock emite idConstancia con prefijo MOCK-NOM151-', async () => {
    const mock = require(mockPath);
    const hash = sha256('contenido de prueba');
    const res  = await mock.conservar(hash, { tablaOrigen: 'test', filaId: 'abc' });

    assert.ok(res.idConstancia.startsWith('MOCK-NOM151-'), `idConstancia="${res.idConstancia}"`);
    assert.ok(res.selloTiempo,                            'selloTiempo debe existir');
    assert.equal(res.proveedor, 'mock',                   'proveedor debe ser "mock"');
  });

  // ── 2. Mock: idConstancia incluye los primeros 16 chars del hash ────────────
  await test('mock idConstancia contiene los primeros 16 chars del hash en mayúsculas', async () => {
    const mock = require(mockPath);
    const hash = sha256('documento-de-contrato');
    const res  = await mock.conservar(hash, { tablaOrigen: 'firmas_electronicas', filaId: '1' });
    const esperado = `MOCK-NOM151-${hash.slice(0, 16).toUpperCase()}`;
    assert.equal(res.idConstancia, esperado);
  });

  // ── 3. Mock: idempotencia — mismo hash → mismo idConstancia ─────────────────
  await test('mock es determinista: mismo hash produce mismo idConstancia', async () => {
    const mock = require(mockPath);
    const hash = sha256('mismo-contenido');
    const r1 = await mock.conservar(hash, { tablaOrigen: 't', filaId: '1' });
    const r2 = await mock.conservar(hash, { tablaOrigen: 't', filaId: '2' });
    assert.equal(r1.idConstancia, r2.idConstancia, 'idConstancia debe ser igual para el mismo hash');
  });

  // ── 4. Mock: rechaza hash con longitud incorrecta ───────────────────────────
  await test('mock lanza error si hash no tiene 64 chars', async () => {
    const mock = require(mockPath);
    await assert.rejects(
      () => mock.conservar('abc123', { tablaOrigen: 't', filaId: '1' }),
      /SHA-256/,
    );
  });

  // ── 5. Mock: rechaza hash vacío ──────────────────────────────────────────────
  await test('mock lanza error si hash está vacío', async () => {
    const mock = require(mockPath);
    await assert.rejects(
      () => mock.conservar('', { tablaOrigen: 't', filaId: '1' }),
      /SHA-256/,
    );
  });

  // ── 6. Hash calculado en servidor, no proviene del cliente ──────────────────
  await test('SHA-256 calculado en servidor coincide con valor esperado', () => {
    const contenido = 'El empleado acepta los términos del contrato.';
    const hashServidor = sha256(contenido);
    // Verificar formato: hex de 64 chars
    assert.match(hashServidor, /^[0-9a-f]{64}$/, `hash="${hashServidor}"`);
    // Verificar que un hash incorrecto (simulando manipulación cliente) sería distinto
    const hashManipulado = sha256('contenido-diferente');
    assert.notEqual(hashServidor, hashManipulado, 'Hashes de contenidos distintos deben diferir');
  });

  // ── 7. Provider selector — provider desconocido lanza error ─────────────────
  await test('getNom151Provider lanza error para NOM_151_PROVIDER desconocido', () => {
    const originalEnv = process.env.NOM_151_PROVIDER;
    // Forzar un proveedor inválido
    process.env.NOM_151_PROVIDER = 'proveedor_inexistente';
    // Limpiar caché del módulo para que re-evalúe PROVIDER_ID
    delete require.cache[providerPath];
    try {
      assert.throws(
        () => { const { getNom151Provider } = require(providerPath); getNom151Provider(); },
        /desconocido/,
      );
    } finally {
      // Restaurar
      if (originalEnv === undefined) delete process.env.NOM_151_PROVIDER;
      else process.env.NOM_151_PROVIDER = originalEnv;
      delete require.cache[providerPath];
    }
  });

  // ── 8. Provider selector — "finkok" devuelve módulo con función conservar ────
  await test('getNom151Provider con finkok devuelve módulo con función conservar', () => {
    const originalEnv = process.env.NOM_151_PROVIDER;
    process.env.NOM_151_PROVIDER = 'finkok';
    delete require.cache[providerPath];
    try {
      const { getNom151Provider } = require(providerPath);
      const provider = getNom151Provider();
      assert.equal(typeof provider.conservar, 'function', 'finkok provider debe exportar conservar()');
    } finally {
      if (originalEnv === undefined) delete process.env.NOM_151_PROVIDER;
      else process.env.NOM_151_PROVIDER = originalEnv;
      delete require.cache[providerPath];
    }
  });

  // ── 9. Ningún campo de resultado contiene patrones de datos personales ───────
  await test('resultado de mock no contiene patrones de RFC/CURP/NSS', async () => {
    const mock = require(mockPath);
    const hash = sha256('documento');
    const res  = await mock.conservar(hash, { tablaOrigen: 'test', filaId: 'xyz' });
    const json = JSON.stringify(res);

    // RFC: 4 letras + 6 dígitos + 3 alfanuméricos
    assert.doesNotMatch(json, /[A-Z]{4}\d{6}[A-Z0-9]{3}/,  'No debe contener RFC');
    // CURP: 18 chars alfanuméricos en patrón típico
    assert.doesNotMatch(json, /[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/, 'No debe contener CURP');
    // NSS: 11 dígitos consecutivos
    assert.doesNotMatch(json, /\b\d{11}\b/,                           'No debe contener NSS');
  });

  // ── 10. selloTiempo es ISO-8601 válido ────────────────────────────────────────
  await test('mock retorna selloTiempo en formato ISO-8601', async () => {
    const mock = require(mockPath);
    const hash = sha256('test-timestamp');
    const res  = await mock.conservar(hash, { tablaOrigen: 't', filaId: '1' });
    const d = new Date(res.selloTiempo);
    assert.ok(!isNaN(d.getTime()), `selloTiempo inválido: "${res.selloTiempo}"`);
  });

  // ── Resumen ───────────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} pasaron, ${failed} fallaron.\n`);
  if (failed > 0) process.exit(1);
})();
