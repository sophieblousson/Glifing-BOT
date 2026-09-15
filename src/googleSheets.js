'use strict';

const { google } = require('googleapis');
const fs = require('fs');
const { config } = require('./config');
const logger = require('./logger');

/**
 * googleSheets.js
 * -----------------------------------------------------------------------
 * NUEVA ARQUITECTURA (bloque técnico U:AB, exclusivo del bot):
 *
 *   - listarPestanas(): nombres reales de las hojas del Spreadsheet.
 *   - escribirBloqueTecnico(pestana, filas): escribe TODO el bloque
 *     U1:AB{N} de una sola vez (título + encabezados + datos + relleno en
 *     blanco hasta maxFilasDatos), sin tocar A:J para nada. No depende de
 *     que la fila ya exista: la arma desde cero cada corrida a partir de
 *     lo que se encontró en Glifing (COLEGIO+NIVEL+GRUPO como unidad
 *     lógica, no el número de fila).
 *   - escribirTimestamp(pestana, celda, texto): escribe la marca de
 *     "Última actualización" en una celda puntual del dashboard (fuera
 *     del bloque técnico, pero definida por el usuario -- default I2).
 *
 * Por qué UN SOLO write (no celda por celda como en la versión anterior):
 * en el esquema viejo, C:I compartían columnas con un dashboard editado a
 * mano, así que había que tocar celdas puntuales para no pisar nada
 * ajeno. Ahora TODO el rango U:AB es propiedad exclusiva del bot (nunca
 * editado a mano), así que escribir el bloque entero de una vez es más
 * simple, más rápido, y evita dejar filas viejas "huérfanas" si un
 * colegio tiene menos combinaciones nivel+grupo que la corrida anterior
 * (se pisan con celdas vacías hasta maxFilasDatos).
 * -----------------------------------------------------------------------
 */

let clienteCache = null;

function obtenerCredencialesServiceAccount() {
  const ruta = config.googleSheets.serviceAccountKeyPath;
  if (!ruta || !fs.existsSync(ruta)) {
    throw new Error(
      `No se encontró el archivo de service account en: ${ruta || '(vacío)'}. Revisá GOOGLE_SERVICE_ACCOUNT_KEY en .env`
    );
  }
  const contenido = fs.readFileSync(ruta, 'utf8');
  try {
    return JSON.parse(contenido);
  } catch (err) {
    throw new Error('El archivo de service account no es un JSON válido.');
  }
}

async function obtenerClienteSheets() {
  if (clienteCache) return clienteCache;
  const credenciales = obtenerCredencialesServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const authClient = await auth.getClient();
  clienteCache = google.sheets({ version: 'v4', auth: authClient });
  return clienteCache;
}

async function listarPestanas() {
  const sheets = await obtenerClienteSheets();
  const respuesta = await sheets.spreadsheets.get({ spreadsheetId: config.googleSheets.spreadsheetId });
  const pestanas = (respuesta.data.sheets || []).map((s) => s.properties.title);
  logger.info(`Pestañas leídas del Spreadsheet: ${pestanas.length}`, { pestanas });
  return pestanas;
}

/**
 * Arma el bloque completo U1:AB{N} (título + encabezados + filas de datos
 * + relleno en blanco) y lo escribe en UNA sola llamada. Nunca toca nada
 * fuera de las columnas U:AB.
 *
 * @param {string} nombrePestana
 * @param {Array<{nivel:string, grupo:string, etiquetaNivel:string, columnaW:string, columnaX:string, columnaY:string, columnaZ:string, columnaAA:string, columnaAB:string}>} filas
 *        ya vienen ordenadas y consolidadas (ver consolidarResultados.js).
 */
async function escribirBloqueTecnico(nombrePestana, filas) {
  if (config.dryRun) {
    throw new Error('escribirBloqueTecnico() llamado con DRY_RUN=true. Esto no debería pasar nunca; se aborta por seguridad.');
  }

  const { columnaInicio, columnaFin, filaTitulo, encabezados, maxFilasDatos } = config.bloqueTecnico;

  if (filas.length > maxFilasDatos) {
    throw new Error(
      `"${nombrePestana}" tiene ${filas.length} combinaciones NIVEL+GRUPO, más que el límite configurado ` +
      `(maxFilasDatos=${maxFilasDatos} en src/config.js). Aumentá ese límite antes de escribir, para no perder filas.`
    );
  }

  const filaTituloArr = [config.bloqueTecnico.tituloBloque, '', '', '', '', '', '', ''];
  const filaEncabezadosArr = [...encabezados];

  const filasDatos = filas.map((f) => [
    f.etiquetaNivel,
    f.grupo || '',
    f.columnaW || '',
    f.columnaX === 0 ? 0 : f.columnaX || '',
    f.columnaY || '',
    f.columnaZ || '',
    f.columnaAA === 0 ? 0 : f.columnaAA || '',
    f.columnaAB || ''
  ]);

  // Relleno en blanco hasta maxFilasDatos, para pisar cualquier fila vieja
  // que haya quedado de una corrida anterior con más combinaciones.
  const filasRelleno = Array.from({ length: maxFilasDatos - filas.length }, () => ['', '', '', '', '', '', '', '']);

  const valores = [filaTituloArr, filaEncabezadosArr, ...filasDatos, ...filasRelleno];
  const filaFinal = filaTitulo + valores.length - 1;
  const rango = `'${nombrePestana}'!${columnaInicio}${filaTitulo}:${columnaFin}${filaFinal}`;

  const sheets = await obtenerClienteSheets();
  logger.info(`Escribiendo bloque técnico en "${nombrePestana}" (${rango}), ${filas.length} fila(s) de datos.`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range: rango,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: valores }
  });

  logger.success(`Bloque técnico escrito en "${nombrePestana}": ${filas.length} fila(s) de datos + relleno hasta fila ${filaFinal}.`);
}

/**
 * Escribe la marca de "Última actualización" en una celda puntual del
 * dashboard (fuera del bloque técnico). Solo se llama cuando la corrida
 * de ese colegio terminó sin errores críticos.
 * @param {string} nombrePestana
 * @param {string} celda ej. "I2"
 * @param {string} textoCompleto ej. "Última actualización: 21/08/2026 14:30"
 */
async function escribirTimestamp(nombrePestana, celda, textoCompleto) {
  if (config.dryRun) {
    throw new Error('escribirTimestamp() llamado con DRY_RUN=true. Se aborta por seguridad.');
  }
  const sheets = await obtenerClienteSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range: `'${nombrePestana}'!${celda}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[textoCompleto]] }
  });
  logger.success(`Timestamp escrito en "${nombrePestana}"!${celda}: "${textoCompleto}"`);
}

/**
 * Escribe "Detalle de Intervenciones" (A28:F, ver config.detalleIntervenciones).
 * EXCEPCIÓN puntual a "nunca tocar A:J": este es el único rango dentro del
 * dashboard visible que el bot escribe, porque el usuario confirmó que no
 * hay una fórmula que lo arme solo. Mismo patrón que escribirBloqueTecnico:
 * un solo write con título + encabezados + datos + relleno en blanco.
 * @param {string} nombrePestana
 * @param {Array<{prioridad:string, nivel:string, grupo:string, tipo:string, estudiante:string, motivo:string}>} filasDetalle
 */
async function escribirDetalleIntervenciones(nombrePestana, filasDetalle) {
  if (config.dryRun) {
    throw new Error('escribirDetalleIntervenciones() llamado con DRY_RUN=true. Se aborta por seguridad.');
  }

  const { columnaInicio, columnaFin, filaTitulo, encabezados, maxFilasDatos, tituloBloque } = config.detalleIntervenciones;

  if (filasDetalle.length > maxFilasDatos) {
    throw new Error(
      `"${nombrePestana}" tiene ${filasDetalle.length} intervenciones, más que el límite configurado ` +
      `(maxFilasDatos=${maxFilasDatos} en src/config.js -> detalleIntervenciones). Aumentá ese límite antes de escribir.`
    );
  }

  const filaTituloArr = [tituloBloque, '', '', '', '', ''];
  const filaEncabezadosArr = [...encabezados];

  const filasDatos = filasDetalle.map((f) => [f.prioridad, f.nivel, f.grupo, f.tipo, f.estudiante, f.motivo]);
  const filasRelleno = Array.from({ length: maxFilasDatos - filasDetalle.length }, () => ['', '', '', '', '', '']);

  const valores = [filaTituloArr, filaEncabezadosArr, ...filasDatos, ...filasRelleno];
  const filaFinal = filaTitulo + valores.length - 1;
  const rango = `'${nombrePestana}'!${columnaInicio}${filaTitulo}:${columnaFin}${filaFinal}`;

  const sheets = await obtenerClienteSheets();
  logger.info(`Escribiendo Detalle de Intervenciones en "${nombrePestana}" (${rango}), ${filasDetalle.length} fila(s).`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range: rango,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: valores }
  });

  logger.success(`Detalle de Intervenciones escrito en "${nombrePestana}": ${filasDetalle.length} fila(s) + relleno hasta fila ${filaFinal}.`);
}

/**
 * Lee un rango tal cual está definido, incluyendo el TEXTO LITERAL de las
 * fórmulas (no el valor calculado). Ej: si A12 tiene "=N3", devuelve la
 * cadena "=N3", no el valor de N3.
 *
 * SOLO para las herramientas de reparación/auditoría del dashboard
 * (herramientas/repararFormulasDashboard.js, herramientas/auditarDashboards.js).
 * El pipeline normal del bot (runner.js) NUNCA debe llamar a esta función
 * ni a escribirValoresRango para tocar A:J.
 * @param {string} nombrePestana
 * @param {string} rangoA1 ej. "A12:J29"
 * @returns {Promise<Array<Array<string>>>}
 */
async function leerFormulasRango(nombrePestana, rangoA1) {
  const sheets = await obtenerClienteSheets();
  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range: `'${nombrePestana}'!${rangoA1}`,
    valueRenderOption: 'FORMULA'
  });
  return respuesta.data.values || [];
}

/**
 * Escribe un rango arbitrario tal cual (fórmulas o valores). SOLO para las
 * herramientas de reparación del dashboard -- ver advertencia en
 * leerFormulasRango. Nunca se llama desde el pipeline normal del bot.
 * @param {string} nombrePestana
 * @param {string} rangoA1 ej. "A12:J29"
 * @param {Array<Array<string>>} valores
 */
async function escribirValoresRango(nombrePestana, rangoA1, valores) {
  if (config.dryRun) {
    throw new Error('escribirValoresRango() llamado con DRY_RUN=true. Se aborta por seguridad.');
  }
  const sheets = await obtenerClienteSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheets.spreadsheetId,
    range: `'${nombrePestana}'!${rangoA1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: valores }
  });
}

module.exports = {
  obtenerClienteSheets,
  listarPestanas,
  escribirBloqueTecnico,
  escribirDetalleIntervenciones,
  escribirTimestamp,
  leerFormulasRango,
  escribirValoresRango
};