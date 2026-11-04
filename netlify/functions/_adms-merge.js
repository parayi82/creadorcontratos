// netlify/functions/_adms-merge.js
//
// Combina lo que trae un lote del ZKTeco (ATTLOG) con el renglón que ya existe
// en `asistencias` para ese trabajador y día.
//
// Bug que corrige (noviembre 2026): adms.js hacía upsert con lo que traía SOLO
// ese lote. El reloj manda las checadas en varios envíos durante el día, así
// que un lote con solo la salida escribía `hora_entrada = null` y BORRABA la
// entrada ya registrada (y uno con solo entrada borraba la salida). Además, una
// entrada posterior pisaba a la primera.
//
// Regla: entrada = la más temprana conocida, salida = la más tardía conocida,
// nunca se escribe null encima de un dato, y si nada cambia no se escribe (para
// no generar renglones vacíos en asistencias_bitacora).
//
// Sin dependencias: se prueba con `node tests/adms-merge.test.js`.

'use strict';

const TOLERANCIA_RETRASO_MIN = 15; // mismo valor que usaba adms.js

/** 'HH:MM' | 'HH:MM:SS' | 'HH:MM:SS.ffffff' → 'HH:MM:SS' (o null). */
function normHora(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
  if (/^\d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 8);
  return null;
}

function minutos(hhmmss) {
  const [h, m] = hhmmss.split(':').map(Number);
  return h * 60 + m;
}

/**
 * @param {{trab:{id:string,hora_entrada_habitual?:string|null}, fecha:string, entrada:string|null, salida:string|null}} grupo
 * @param {{hora_entrada?:string|null, hora_salida?:string|null, status?:string|null}|undefined} existente
 * @param {string} clienteRFC
 * @returns {object|null} renglón para upsert en asistencias, o null si no hay nada que escribir
 */
function combinarAsistencia(grupo, existente, clienteRFC) {
  const eNueva = normHora(grupo.entrada);
  const sNueva = normHora(grupo.salida);
  const eAnt   = normHora(existente && existente.hora_entrada);
  const sAnt   = normHora(existente && existente.hora_salida);

  const entradas = [eNueva, eAnt].filter(Boolean).sort();
  const salidas  = [sNueva, sAnt].filter(Boolean).sort();
  const entrada = entradas.length ? entradas[0] : null;
  const salida  = salidas.length ? salidas[salidas.length - 1] : null;

  if (!entrada && !salida) return null;
  if (existente && entrada === eAnt && salida === sAnt) return null; // nada nuevo

  // El status se recalcula solo si hay entrada; si el lote trae únicamente la
  // salida, se conserva el status que ya tenía el día.
  let status = (existente && existente.status) || 'presente';
  if (entrada) {
    status = 'presente';
    const hab = normHora(grupo.trab.hora_entrada_habitual);
    if (hab && minutos(entrada) > minutos(hab) + TOLERANCIA_RETRASO_MIN) status = 'retraso';
  }

  return {
    trabajador_id: grupo.trab.id,
    cliente_rfc:   clienteRFC,
    fecha:         grupo.fecha,
    status,
    hora_entrada:  entrada,
    hora_salida:   salida,
    fuente:        'adms',
  };
}

module.exports = { combinarAsistencia, normHora, TOLERANCIA_RETRASO_MIN };
