'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { DateTime } = require('luxon');
const { config } = require('./config');

/**
 * logger.js
 * -----------------------------------------------------------------------
 * Logger único compartido por todo el proceso. Emite un evento 'log' por
 * cada línea, que server.js reenvía al panel por Server-Sent Events (SSE).
 * También persiste todo en debug/logs/<fecha>.log para poder revisar
 * ejecuciones pasadas sin depender de que el panel haya estado abierto.
 * -----------------------------------------------------------------------
 */

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

function rutaArchivoDeHoy() {
  const fecha = DateTime.now().setZone(config.timezone).toFormat('yyyy-LL-dd');
  return path.join(config.paths.logs, `${fecha}.log`);
}

const NIVELES = { info: 'INFO', warn: 'WARN', error: 'ERROR', success: 'OK' };

function log(nivel, mensaje, meta = {}) {
  const timestamp = DateTime.now().setZone(config.timezone).toFormat('dd/LL/yyyy HH:mm:ss');
  const nivelTxt = NIVELES[nivel] || 'INFO';
  const linea = `[${timestamp}] [${nivelTxt}] ${mensaje}`;

  // Nunca loguear password ni el JSON de la service account.
  const metaSegura = { ...meta };
  delete metaSegura.password;
  delete metaSegura.serviceAccountKey;

  const entrada = { timestamp, nivel: nivelTxt, mensaje, meta: metaSegura };

  // Consola del proceso Node (útil si se corre sin el panel abierto)
  const consolaFn = nivel === 'error' ? console.error : console.log;
  consolaFn(linea, Object.keys(metaSegura).length ? metaSegura : '');

  // Archivo de log del día
  try {
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.appendFileSync(rutaArchivoDeHoy(), linea + (Object.keys(metaSegura).length ? ' ' + JSON.stringify(metaSegura) : '') + '\n');
  } catch (err) {
    console.error('No se pudo escribir el archivo de log:', err.message);
  }

  // Panel (SSE)
  emitter.emit('log', entrada);
}

module.exports = {
  emitter,
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  success: (msg, meta) => log('success', msg, meta)
};
