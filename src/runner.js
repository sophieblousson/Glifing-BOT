'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const { config, validarConfig } = require('./config');
const logger = require('./logger');
const { login } = require('./login');
const { listarColegiosDisponibles, seleccionarColegio } = require('./seleccionarColegio');
const { extraerEntrenamiento } = require('./extraerEntrenamiento');
const { extraerGrupales } = require('./extraerGrupales');
const { consolidar, prepararDetalleIntervenciones } = require('./consolidarResultados');
const { listarPestanas, escribirBloqueTecnico, escribirDetalleIntervenciones, escribirTimestamp } = require('./googleSheets');
const { emparejarConPestana, estaExcluido } = require('./normalizacion');

/**
 * runner.js — Nueva arquitectura (bloque técnico U:AB)
 * -----------------------------------------------------------------------
 * Por cada colegio:
 *   1. Extraer TODO de Glifing (Entrenamiento + Grupales) sin tocar Sheets.
 *   2. Consolidar en filas listas para escribir (COLEGIO+NIVEL+GRUPO como
 *      unidad lógica, sin depender de filas preexistentes).
 *   3. Si la extracción no reventó con una excepción: escribir el bloque
 *      técnico completo (U:AB) de una sola vez. Si SÍ reventó, no se
 *      escribe nada y el bloque técnico anterior de ese colegio queda
 *      intacto (regla de seguridad: nunca dejar una hoja a medio escribir).
 *   4. Marcar timestamp de "Última actualización" solo si no hubo errores
 *      críticos de extracción (ERROR_GRUPO_NO_CAMBIO / ERROR_CURSO_INCORRECTO
 *      / ERROR_SELECTOR) en ningún nivel+grupo de ese colegio.
 *
 * Un colegio que falla no detiene a los demás (try/catch por colegio).
 * -----------------------------------------------------------------------
 */

class Runner {
  constructor() {
    this.state = {
      running: false,
      stopRequested: false,
      mode: null,
      colegioActual: null,
      colegiosProcesados: [],
      erroresGlobales: [],
      reportePath: null,
      startedAt: null,
      finishedAt: null
    };
    this.browser = null;
  }

  solicitarStop() {
    if (this.state.running) {
      this.state.stopRequested = true;
      logger.warn('Se solicitó detener la ejecución. Se cerrará de forma controlada al terminar el colegio actual.');
    }
  }

  async ejecutar({ colegio = 'ALL', mode = 'validate' } = {}) {
    if (this.state.running) {
      throw new Error('Ya hay una ejecución en curso. Esperá a que termine o usá "Detener".');
    }

    const modoEscritura = mode === 'write';

    if (modoEscritura && config.dryRun) {
      throw new Error(
        'Pediste modo "Ejecutar y escribir" pero DRY_RUN=true en tu .env. ' +
        'Es una barrera de seguridad intencional: cambiá DRY_RUN=false ahí si estás seguro, y reiniciá el servidor.'
      );
    }

    const { ok, errores } = validarConfig();
    if (!ok) {
      throw new Error('Configuración incompleta:\n' + errores.join('\n'));
    }

    this.state = {
      running: true,
      stopRequested: false,
      mode: modoEscritura ? 'write' : 'validate',
      colegioActual: null,
      colegiosProcesados: [],
      erroresGlobales: [],
      reportePath: null,
      startedAt: DateTime.now().setZone(config.timezone).toISO(),
      finishedAt: null
    };

    logger.info(`=== Inicio de ejecución en MODO ${modoEscritura ? 'ESCRITURA' : 'VALIDACIÓN'} (DRY_RUN=${config.dryRun}) ===`, {
      colegioSolicitado: colegio
    });

    const reporteGlobal = {
      generadoEn: this.state.startedAt,
      modo: this.state.mode,
      dryRun: config.dryRun,
      colegioSolicitado: colegio,
      colegios: []
    };

    try {
      logger.info('Leyendo pestañas del Google Sheet...');
      const pestanas = await listarPestanas();

      this.browser = await chromium.launch({ headless: config.headless });
      const page = await this.browser.newPage();

      await login(page);

      logger.info('Leyendo colegios disponibles en el menú de Glifing...');
      const colegiosGlifing = await listarColegiosDisponibles(page);

      const colegiosAProcesar =
        colegio === 'ALL'
          ? pestanas
          : [pestanas.find((p) => p.toUpperCase() === String(colegio).toUpperCase()) || colegio];

      for (const nombrePestana of colegiosAProcesar) {
        if (this.state.stopRequested) {
          logger.warn('Ejecución detenida por el usuario antes de continuar con el siguiente colegio.');
          break;
        }

        if (estaExcluido(nombrePestana, config.COLEGIOS_EXCLUIDOS)) {
          logger.warn(`Colegio excluido explícitamente, se omite: ${nombrePestana}`);
          continue;
        }

        this.state.colegioActual = nombrePestana;
        logger.info(`>>> Procesando colegio (pestaña): ${nombrePestana}`);

        const nombreEnGlifing = colegiosGlifing.find((g) => emparejarConPestana(g, [nombrePestana]));

        if (!nombreEnGlifing) {
          logger.warn(`COLEGIO_NO_DISPONIBLE: "${nombrePestana}" no aparece en el menú actual de Glifing. Se omite.`);
          reporteGlobal.colegios.push({ pestana: nombrePestana, estado: 'COLEGIO_NO_DISPONIBLE' });
          this.state.colegiosProcesados.push({ pestana: nombrePestana, estado: 'COLEGIO_NO_DISPONIBLE' });
          continue;
        }

        try {
          const resultadoColegio = await this._procesarColegio(page, nombrePestana, nombreEnGlifing, modoEscritura);
          reporteGlobal.colegios.push(resultadoColegio);
          this.state.colegiosProcesados.push({ pestana: nombrePestana, estado: 'PROCESADO' });
        } catch (err) {
          // Regla de seguridad: si la extracción/escritura de un colegio
          // revienta, NO se toca su bloque técnico -- los datos de la
          // corrida anterior quedan como estaban.
          logger.error(`Error procesando "${nombrePestana}" (colegio: ${nombrePestana}, etapa: ver mensaje, hora: ${DateTime.now().setZone(config.timezone).toFormat('dd/LL/yyyy HH:mm:ss')}): ${err.message}`);
          this.state.erroresGlobales.push({ colegio: nombrePestana, mensaje: err.message });
          reporteGlobal.colegios.push({ pestana: nombrePestana, estado: 'ERROR', mensaje: err.message });
        }
      }

      fs.mkdirSync(config.paths.reports, { recursive: true });
      const prefijo = modoEscritura ? 'escritura' : 'validacion';
      const nombreReporte = `${prefijo}_${DateTime.now().setZone(config.timezone).toFormat('yyyyLLdd_HHmmss')}.json`;
      const rutaReporte = path.join(config.paths.reports, nombreReporte);
      fs.writeFileSync(rutaReporte, JSON.stringify(reporteGlobal, null, 2), 'utf8');
      this.state.reportePath = rutaReporte;
      logger.success(`Reporte guardado en: ${rutaReporte}`);
      if (!modoEscritura) {
        logger.info('MODO VALIDACIÓN: no se escribió nada en Google Sheets.');
      }
    } catch (err) {
      logger.error(`Error general de la ejecución: ${err.message}`);
      this.state.erroresGlobales.push({ colegio: null, mensaje: err.message });
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      this.state.running = false;
      this.state.finishedAt = DateTime.now().setZone(config.timezone).toISO();
      logger.info('=== Fin de la ejecución ===');
    }
  }

  /**
   * Procesa un colegio completo: extrae Entrenamiento (W,X,Z) y Grupales
   * (AA,AB), consolida, y si corresponde escribe el bloque técnico U:AB
   * completo + el timestamp del dashboard.
   */
  async _procesarColegio(page, nombrePestana, nombreEnGlifing, modoEscritura) {
    await seleccionarColegio(page, nombreEnGlifing);

    logger.info(`Navegando a Entrenamiento (columnas W, X, Z): ${nombrePestana}`);
    await page.goto(config.glifing.trainingUrl, { waitUntil: 'domcontentloaded' });
    const filasEntrenamiento = this.state.stopRequested ? [] : await extraerEntrenamiento(page, nombreEnGlifing);

    logger.info(`Navegando a Grupales (columnas AA, AB): ${nombrePestana}`);
    await page.goto(config.glifing.groupUrl, { waitUntil: 'domcontentloaded' });
    const filasGrupales = this.state.stopRequested ? [] : await extraerGrupales(page);

    const { filas, huboErroresCriticos, erroresDetalle } = consolidar(filasEntrenamiento, filasGrupales);

    logger.info(`--- Bloque técnico a escribir para "${nombrePestana}" (${filas.length} fila(s)) ---`);
    for (const f of filas) {
      const wCorto = f.columnaW && f.columnaW.length > 40 ? f.columnaW.slice(0, 40) + '…' : f.columnaW;
      const zCorto = f.columnaZ && f.columnaZ.length > 40 ? f.columnaZ.slice(0, 40) + '…' : f.columnaZ;
      logger.info(
        `${nombrePestana} | ${f.etiquetaNivel} | ${f.grupo || '(sin grupo)'} | W="${wCorto}" X=${f.columnaX} Y=${f.columnaY} Z="${zCorto}" AA=${f.columnaAA} AB="${f.columnaAB}"`
      );
    }
    for (const err of erroresDetalle) {
      logger.warn(`${nombrePestana} | ${err.nivel} | ${err.grupo || '(sin grupo)'} | [${err.seccion}] ${err.motivo}`);
    }

    let bloqueEscrito = false;
    let detalleEscrito = false;

    if (modoEscritura) {
      await escribirBloqueTecnico(nombrePestana, filas);
      bloqueEscrito = true;

      const detalle = prepararDetalleIntervenciones(filas);
      logger.info(`--- Detalle de Intervenciones a escribir para "${nombrePestana}" (${detalle.length} fila(s)) ---`);
      await escribirDetalleIntervenciones(nombrePestana, detalle);
      detalleEscrito = true;

      if (!huboErroresCriticos) {
        const timestamp = DateTime.now().setZone(config.timezone).toFormat('dd/LL/yyyy HH:mm');
        await escribirTimestamp(nombrePestana, config.googleSheets.timestampCell, `Última actualización: ${timestamp}`);
      } else {
        logger.warn(
          `"${nombrePestana}": bloque técnico y detalle escritos, pero NO se actualizó el timestamp (hubo errores críticos de extracción en ${erroresDetalle.length} combinación(es) nivel+grupo).`
        );
      }
    }

    return {
      pestana: nombrePestana,
      nombreEnGlifing,
      estado: 'PROCESADO',
      modoEscritura,
      bloqueEscrito,
      detalleEscrito,
      huboErroresCriticos,
      erroresDetalle,
      filas
    };
  }
}

module.exports = new Runner();