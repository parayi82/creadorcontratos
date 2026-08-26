// netlify/functions/_nom151-mock.js
//
// Implementación mock del adaptador NOM-151.
// Produce una constancia determinista a partir del hash: sin red, sin credenciales.
// Activa cuando NOM_151_PROVIDER=mock (o variable no definida).
//
// NUNCA usar en producción para constancias con validez legal.

'use strict';

/**
 * Simula la emisión de una constancia de conservación NOM-151.
 *
 * @param {string} hash  SHA-256 del documento en HEX (64 chars)
 * @param {object} meta  { tablaOrigen, filaId } — solo trazabilidad local
 * @returns {{ idConstancia: string, selloTiempo: string, proveedor: string }}
 */
async function conservar(hash, meta) {
  if (!hash || hash.length !== 64) {
    throw new Error('hash debe ser SHA-256 en HEX (64 caracteres).');
  }
  // idConstancia determinista: prefijo fijo + primeros 16 chars del hash
  const idConstancia = `MOCK-NOM151-${hash.slice(0, 16).toUpperCase()}`;
  const selloTiempo  = new Date().toISOString();
  return { idConstancia, selloTiempo, proveedor: 'mock' };
}

module.exports = { conservar };
