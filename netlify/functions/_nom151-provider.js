// netlify/functions/_nom151-provider.js
//
// Contrato de adaptador NOM-151 conservación de mensajes de datos.
// Selecciona la implementación activa según NOM_151_PROVIDER env var.
//
// Implementaciones disponibles:
//   mock   — respuesta determinista, sin red (default en development)
//   finkok — PSC Finkok (pendiente de credenciales)
//
// Interfaz que todo provider debe cumplir:
//
//   conservar(hash, meta) → Promise<{ idConstancia, selloTiempo, proveedor }>
//
//   @param {string} hash        SHA-256 del documento en HEX (64 chars)
//   @param {object} meta        { tablaOrigen, filaId }  — solo para trazabilidad local
//   @returns {{ idConstancia: string, selloTiempo: string, proveedor: string }}
//            idConstancia  — folio único emitido por el PSC
//            selloTiempo   — ISO-8601 UTC del momento de conservación
//            proveedor     — identificador del PSC ("mock", "finkok", …)

'use strict';

const PROVIDER_ID = (process.env.NOM_151_PROVIDER || 'mock').toLowerCase();

function getNom151Provider() {
  switch (PROVIDER_ID) {
    case 'mock':
      return require('./_nom151-mock');
    case 'finkok':
      return require('./_nom151-finkok');
    default:
      throw new Error(`NOM_151_PROVIDER desconocido: "${PROVIDER_ID}". Valores válidos: mock, finkok.`);
  }
}

module.exports = { getNom151Provider, PROVIDER_ID };
