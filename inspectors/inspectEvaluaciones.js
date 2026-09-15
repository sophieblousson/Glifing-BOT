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
const { buscarBotonesPlay, buscarTexto, leerFilasAlumnos } = require('../src/domScan');
const { guardarEvidencia } = require('../src/evidencia');
const { parseArgs } = require('../src/cliArgs');
const { cursoParaNivel } = require('../src/normalizacion');

/**
 * inspectEvaluaciones.js
 * -----------------------------------------------------------------------
 * Uso:
 *   npm run inspect:evaluaciones -- --colegio="Ameghino" --nivel=3N --grupo=A
 *
 * Si no se pasa --colegio, lista los colegios disponibles en Glifing y termina
 * (para poder copiar el nombre exacto a usar).
 *
 * No decide "esta evaluación está pendiente o no": junta evidencia (botones
 * tipo play, colores, textos "Pendiente" / "Saltear evaluación") para que
 * la revisemos antes de escribir el extractor definitivo (punto 10 y 5).
 * -----------------------------------------------------------------------
 */

const NIVELES_A_ANALIZAR = ['2N', '3N', '4N', '5N', '6N'];

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
      logger.info('Volvé a correr con: --colegio="NOMBRE_EXACTO" --nivel=3N --grupo=A');
      return;
    }

    await seleccionarColegio(page, args.colegio);

    const niveles = args.nivel ? [args.nivel] : NIVELES_A_ANALIZAR;
    const grupos = args.grupo ? [args.grupo] : ['A', 'B'];

    // Navegar a la sección de Entrenamiento (fuente de la columna C)
    logger.info(`Navegando a la sección de Entrenamiento: ${config.glifing.trainingUrl}`);
    await page.goto(config.glifing.trainingUrl, { waitUntil: 'domcontentloaded' });

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
        logger.info(`--- Inspeccionando ${args.colegio} | ${curso.texto} (${nivelCodigo}) | Grupo ${grupo} ---`);
        const resultadoGrupo = await seleccionarGrupo(page, grupo).catch((err) => ({ ok: false, motivo: err.message }));
        if (!resultadoGrupo.ok && resultadoGrupo.motivo !== 'SIN_SELECTOR_GRUPO') {
          logger.warn(`No se pudo seleccionar grupo ${grupo}: ${resultadoGrupo.motivo}`);
        }

        const filas = await leerFilasAlumnos(page);
        const alumnosPendientes = filas.filter((f) => f.evaluationPendiente);
        const botonesPlay = await buscarBotonesPlay(page);
        const textosPendiente = await buscarTexto(page, 'pendiente');
        const textosSaltear = await buscarTexto(page, 'saltear\\s+evaluaci[oó]n');

        const evidencia = await guardarEvidencia(page, `evaluaciones_${args.colegio}_${nivelCodigo}_${grupo}`);

        reporte.filas.push({
          nivel: nivelCodigo,
          curso: curso.texto,
          grupo,
          // Fuente principal (validada contra el HTML real, atributo evaluationpend del <tr>):
          totalAlumnos: filas.length,
          alumnosPendientes,
          // Evidencia secundaria/de respaldo, para contrastar:
          cantidadBotonesPlayCandidatos: botonesPlay.length,
          botonesPlay,
          cantidadTextosPendiente: textosPendiente.length,
          textosPendiente,
          cantidadTextosSaltearEvaluacion: textosSaltear.length,
          textosSaltear,
          evidencia
        });

        logger.info(
          `${curso.texto} (${nivelCodigo}) / Grupo ${grupo}: ${alumnosPendientes.length} alumno(s) con evaluación pendiente de ${filas.length} totales (atributo evaluationpend).`
        );
      }
    }

    fs.mkdirSync(config.paths.reports, { recursive: true });
    const nombreReporte = `inspectEvaluaciones_${DateTime.now().setZone(config.timezone).toFormat('yyyyLLdd_HHmmss')}.json`;
    const rutaReporte = path.join(config.paths.reports, nombreReporte);
    fs.writeFileSync(rutaReporte, JSON.stringify(reporte, null, 2), 'utf8');
    logger.success(`Reporte guardado en: ${rutaReporte}`);
    logger.info('Revisá el JSON y las capturas antes de decidir el selector definitivo (ver src/selectors.js).');
  } catch (err) {
    logger.error(`Error en inspectEvaluaciones: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();