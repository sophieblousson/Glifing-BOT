'use strict';

const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { config } = require('./config');
const logger = require('./logger');

/**
 * evidencia.js
 * -----------------------------------------------------------------------
 * Guarda, de forma consistente, un screenshot + el HTML completo de la
 * página en el momento en que se llama. Se usa tanto en errores (login,
 * navegación) como en los inspectores (para dejar registro de lo que se
 * encontró, sea correcto o no).
 *
 * Nombre de archivo: <slug>_<timestamp>.png / .html
 * -----------------------------------------------------------------------
 */

function slugify(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * @param {import('playwright').Page} page
 * @param {string} etiqueta descripción corta de qué se está evidenciando
 * @returns {Promise<{screenshot: string, html: string}>} rutas absolutas generadas
 */
async function guardarEvidencia(page, etiqueta) {
  const timestamp = DateTime.now().setZone(config.timezone).toFormat('yyyyLLdd_HHmmss');
  const base = `${slugify(etiqueta)}_${timestamp}`;

  fs.mkdirSync(config.paths.screenshots, { recursive: true });
  fs.mkdirSync(config.paths.html, { recursive: true });

  const rutaScreenshot = path.join(config.paths.screenshots, `${base}.png`);
  const rutaHtml = path.join(config.paths.html, `${base}.html`);

  try {
    await page.screenshot({ path: rutaScreenshot, fullPage: true });
  } catch (err) {
    logger.warn(`No se pudo tomar screenshot (${etiqueta}): ${err.message}`);
  }

  try {
    const html = await page.content();
    fs.writeFileSync(rutaHtml, html, 'utf8');
  } catch (err) {
    logger.warn(`No se pudo guardar el HTML (${etiqueta}): ${err.message}`);
  }

  logger.info(`Evidencia guardada: ${base} (.png / .html)`, { rutaScreenshot, rutaHtml });
  return { screenshot: rutaScreenshot, html: rutaHtml };
}

module.exports = { guardarEvidencia, slugify };
