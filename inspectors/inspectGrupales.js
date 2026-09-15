'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');

const { config, validarConfig } = require('../src/config');
const logger = require('../src/logger');
const { login } = require('../src/login');
const { listarColegiosDisponibles, seleccionarColegio } = require('../src/seleccionarColegio');
const { seleccionarCurso, seleccionarGrupo } = require('../src/seleccionarCursoGrupo');
const { leerSesionesRealizadasResumen, calcularSumaSesionesRealizadas } = require('../src/domScan');
const { guardarEvidencia } = require('../src/evidencia');
const { parseArgs } = require('../src/cliArgs');
const { cursoParaNivel } = require('../src/normalizacion');

/**
 * inspectGrupales.js
 * -----------------------------------------------------------------------
 * Uso:
 *   npm run inspect:grupales -- --colegio="Ameghino" --nivel=I4 --grupo=A
 *
 * Fuente: GLIFING_GROUP_URL (https://platform.glifing.com/school/group)
 * Niveles a analizar (punto 14): I4, I5, 2N..6N, 7N (1.º ESO / "1º Secundaria").
 *
 * Junta evidencia de los números que aparecen bajo la etiqueta "REALIZADAS",
 * incluyendo el caso de que haya más de una caja/actividad (punto 14.2:
 * "si hay más de una caja o actividad visible, sumar todas" - la suma la
 * hará el extractor definitivo, acá solo se listan los candidatos).
 * -----------------------------------------------------------------------
 */

const NIVELES_A_ANALIZAR = ['I4', 'I5', '2N', '3N', '4N', '5N', '6N', '7N'];

async function main() {
  const args = parseArgs();
  const { ok, errores } = validarConfig();
  if (!ok) {
    errores.forEach((e) => logger.error(e));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: config.headless });
  const page = await browser.newPage();

  try {
    await login(page);

    if (!args.colegio) {
      const colegios = await listarColegiosDisponibles(page);
      logger.info('No se pasó --colegio. Colegios disponibles en Glifing:');
      colegios.forEach((c) => console.log(' -', c));
      logger.info('Volvé a correr con: --colegio="NOMBRE_EXACTO" --nivel=I4 --grupo=A');
      return;
    }

    await seleccionarColegio(page, args.colegio);

    const niveles = args.nivel ? [args.nivel] : NIVELES_A_ANALIZAR;
    const grupos = args.grupo ? [args.grupo] : ['A', 'B'];

    logger.info(`Navegando a la sección de Grupales: ${config.glifing.groupUrl}`);
    await page.goto(config.glifing.groupUrl, { waitUntil: 'domcontentloaded' });

    const reporte = { generadoEn: DateTime.now().setZone(config.timezone).toISO(), colegio: args.colegio, filas: [] };

    for (const nivelCodigo of niveles) {
      const curso = cursoParaNivel(nivelCodigo);
      if (!curso) {
        logger.warn(`Nivel "${nivelCodigo}" no está en normalizacion.CURSO_POR_NIVEL. Se omite.`);
        continue;
      }

      try {
        await seleccionarCurso(page, curso);
      } catch (err) {
        logger.error(`No se pudo seleccionar el curso "${curso.texto}" (${nivelCodigo}): ${err.message}`);
        continue;
      }

      for (const grupo of grupos) {
        logger.info(`--- Inspeccionando (Grupales) ${args.colegio} | ${curso.texto} (${nivelCodigo}) | Grupo ${grupo} ---`);
        const resultadoGrupo = await seleccionarGrupo(page, grupo).catch((err) => ({ ok: false, motivo: err.message }));
        if (!resultadoGrupo.ok && resultadoGrupo.motivo !== 'SIN_SELECTOR_GRUPO') {
          logger.warn(`No se pudo seleccionar grupo ${grupo}: ${resultadoGrupo.motivo}`);
        }

        const valoresRealizadas = await leerSesionesRealizadasResumen(page);
        const columnaG = calcularSumaSesionesRealizadas(valoresRealizadas);
        const evidencia = await guardarEvidencia(page, `grupales_${args.colegio}_${nivelCodigo}_${grupo}`);

        reporte.filas.push({
          nivel: nivelCodigo,
          curso: curso.texto,
          grupo,
          // Fuente correcta (corregida 04/08/2026): resumen "Sesiones
          // Realizadas" de la tabla superior (#rewardsTable), acumulativo.
          columnaG_sesionesGrupales: {
            ok: columnaG.ok,
            suma: columnaG.suma,
            valoresNoDetectados: columnaG.valoresNoDetectados,
            valoresCrudos: valoresRealizadas
          },
          evidencia
        });

        logger.info(
          `${curso.texto} (${nivelCodigo}) / Grupo ${grupo}: columna G = ${columnaG.ok ? columnaG.suma : 'NO_DETECTADO (' + columnaG.valoresNoDetectados.length + ' valor(es))'} (${valoresRealizadas.length} fila(s) en el resumen).`
        );
      }
    }

    fs.mkdirSync(config.paths.reports, { recursive: true });
    const nombreReporte = `inspectGrupales_${DateTime.now().setZone(config.timezone).toFormat('yyyyLLdd_HHmmss')}.json`;
    const rutaReporte = path.join(config.paths.reports, nombreReporte);
    fs.writeFileSync(rutaReporte, JSON.stringify(reporte, null, 2), 'utf8');
    logger.success(`Reporte guardado en: ${rutaReporte}`);
    logger.info('Revisá el JSON: columna G ya usa la fuente confirmada. Si dio NO_DETECTADO, revisar detallePorCaja.');
  } catch (err) {
    logger.error(`Error en inspectGrupales: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
