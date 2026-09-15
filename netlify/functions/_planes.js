// netlify/functions/_planes.js
//
// Catálogo de planes compartido entre los dos caminos de cobro
// (crear-suscripcion.js para tarjeta, crear-checkout-spei.js para
// transferencia SPEI) y el aprovisionamiento del cliente
// (_provisionar-cliente.js). Centralizado para que un price_id o una
// cuota nunca puedan divergir entre un método de pago y otro.

// Planes vigentes por tamaño de empresa. Acceso total al software en todos;
// cambian los tickets de asesoría legal incluidos.
const PRICE_IDS = {
  // PLANES MENSUALES VIGENTES
  micro:    'price_1TzPquBEbjDXzIvUfsSiAvon',    // $899 MXN/mes, IVA incl. (1-15 trabajadores)
  pyme:     'price_1TzPrdBEbjDXzIvUirhfcDOI',     // $1,999 MXN/mes, IVA incl. (16-50 trabajadores)
  mediana:  'price_1TzPsBBEbjDXzIvUGbz5Sstv',  // $4,499 MXN/mes, IVA incl. (51-150 trabajadores)
  empresa:  'price_1TzPsnBEbjDXzIvU37MZPwYV',  // $9,999 MXN/mes, IVA incl. (151-500 trabajadores)
  // LEGACY — clientes existentes de planes anteriores (no borrar)
  basico:   'price_1TnpmfBEbjDXzIvUgXP6EZb0',
  estandar: 'price_1TscfDBEbjDXzIvU3ABI9mp8',
  pro:      'price_1Tscg1BEbjDXzIvUSsgy1kyo',
};
const NOMBRES_PLAN = {
  micro:'Plan Micro', pyme:'Plan PyME', mediana:'Plan Mediana', empresa:'Plan Empresa',
  basico:'Plan Básico', estandar:'Plan Estándar', pro:'Plan Pro',
};
const CUOTAS_PLAN = {
  micro:899, pyme:1999, mediana:4499, empresa:9999,
  basico:499, estandar:799, pro:2399,
};
// Ya no hay planes anuales de pago único; todos los planes vigentes son suscripción mensual.
const ES_PAGO_UNICO = {};

module.exports = { PRICE_IDS, NOMBRES_PLAN, CUOTAS_PLAN, ES_PAGO_UNICO };
