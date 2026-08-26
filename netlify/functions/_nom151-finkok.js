// netlify/functions/_nom151-finkok.js
//
// Provider NOM-151 usando Finkok — PSC acreditado por la SE de México.
// Solo se envía el hash SHA-256 al proveedor. NUNCA el documento.
//
// Variables de entorno requeridas (configurar en Netlify → Site settings → Env vars):
//
//   FINKOK_USERNAME   Usuario registrado en Finkok (p.ej. "miempresa@ejemplo.com")
//   FINKOK_PASSWORD   Contraseña de la cuenta Finkok
//   FINKOK_ENV        "sandbox" | "production"  (default: "sandbox")
//
// Endpoints Finkok NOM-151:
//   sandbox    : https://demo-facturacion.finkok.com/servicios/nom151
//   production : https://facturacion.finkok.com/servicios/nom151
//
// ── Activación ───────────────────────────────────────────────────────────────
// Pasos para poner en producción:
//   1. Contrata el servicio NOM-151 en https://www.finkok.com
//   2. Obtén usuario, contraseña y acepta los términos del PSC
//   3. Agrega en Netlify:
//        FINKOK_USERNAME = <tu_usuario>
//        FINKOK_PASSWORD = <tu_password>
//        FINKOK_ENV      = production
//        NOM_151_PROVIDER = finkok
//   4. Ejecuta los tests de integración: node tests/nom151-finkok.integration.js

'use strict';

// URL base según entorno
function baseUrl() {
  const env = (process.env.FINKOK_ENV || 'sandbox').toLowerCase();
  return env === 'production'
    ? 'https://facturacion.finkok.com/servicios/nom151'
    : 'https://demo-facturacion.finkok.com/servicios/nom151';
}

/**
 * Emite constancia de conservación NOM-151 a través de Finkok.
 *
 * @param {string} hash  SHA-256 del documento en HEX (64 chars) — calculado en servidor
 * @param {object} meta  { tablaOrigen, filaId } — trazabilidad local únicamente
 * @returns {{ idConstancia: string, selloTiempo: string, proveedor: string }}
 */
async function conservar(hash, meta) {
  const username = process.env.FINKOK_USERNAME;
  const password = process.env.FINKOK_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Faltan credenciales Finkok. Configure FINKOK_USERNAME y FINKOK_PASSWORD en las variables de entorno de Netlify.'
    );
  }

  if (!hash || hash.length !== 64) {
    throw new Error('hash debe ser SHA-256 en HEX (64 caracteres).');
  }

  const url = `${baseUrl()}/stamp`;

  // Payload: solo hash + credenciales. NUNCA el documento original.
  const payload = {
    username,
    password,
    hash,                      // SHA-256 HEX del documento
    algorithm: 'SHA256',
    // referencia local para correlacionar en el dashboard Finkok (no es dato personal)
    reference: `${meta.tablaOrigen}:${meta.filaId}`.slice(0, 100),
  };

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch (netErr) {
    throw new Error(`Finkok no respondió: ${netErr.message}`);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    const text = await response.text().catch(() => '');
    throw new Error(`Finkok devolvió respuesta no-JSON (${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    // Finkok devuelve { error, message } o { CodError, Mensaje }
    const msg = result.message || result.Mensaje || result.error || JSON.stringify(result);
    throw new Error(`Finkok error ${response.status}: ${msg}`);
  }

  // Finkok devuelve: { id, fecha, constancia_xml, ... }
  // Los nombres exactos se confirman en la documentación del PSC al activar la cuenta.
  const idConstancia = result.id || result.IdConstancia || result.constancia_id;
  const selloTiempo  = result.fecha || result.FechaSello || result.timestamp;

  if (!idConstancia || !selloTiempo) {
    throw new Error(`Finkok devolvió respuesta incompleta: ${JSON.stringify(result).slice(0, 300)}`);
  }

  return {
    idConstancia: String(idConstancia),
    selloTiempo:  new Date(selloTiempo).toISOString(),
    proveedor:    'finkok',
  };
}

module.exports = { conservar };
