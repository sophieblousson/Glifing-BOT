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
const { leerFilasAlumnos, calcularSumaColumnaD } = require('../src/domScan');
const { guardarEvidencia } = require('../src/evidencia');
const { parseArgs } = require('../src/cliArgs');
const { cursoParaNivel } = require('../src/normalizacion');

/**
 * inspectEntrenamiento.js
 * -----------------------------------------------------------------------
 * Uso:
 *   npm run inspect:entrenamiento -- --colegio="Ameghino" --nivel=3N --grupo=A
 *
 * Junta evidencia para DOS columnas a la vez, porque comparten fuente
 * (Entrenamiento) y curso (regla general: solo 3.º Primaria = 3N, con la
 * excepción de Gaudí que también incluye 4.º Primaria = 4N):
 *
 *   - Columna D: número bajo el bloque "CURSO" (dentro de "15 DÍAS | CURSO | TOTALES").
 *     NO se debe confundir con "15 días" ni con "TOTALES" (punto 11).
 *   - Columna F: alumnos con un signo de exclamación naranja junto a "15 días" (punto 13).
 *
 * No decide sumas ni nombres definitivos: registra TODOS los números
 * candidatos cerca de cada etiqueta para revisarlos a mano.
 * -----------------------------------------------------------------------
 */

function nivelesParaColegio(nombreColegio) {
  const esGaudi = /gaud/i.test(nombreColegio || '');
  return esGaudi ? ['3N', '4N'] : ['3N'];
}

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
      logger.info('Volvé a correr con: --colegio="NOMBRE_EXACTO" --grupo=A');
      return;
    }

    await seleccionarColegio(page, args.colegio);

    const niveles = args.nivel ? [args.nivel] : nivelesParaColegio(args.colegio);
    const grupos = args.grupo ? [args.grupo] : ['A', 'B'];

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
        logger.info(`--- Inspeccionando (Entrenamiento) ${args.colegio} | ${curso.texto} (${nivelCodigo}) | Grupo ${grupo} ---`);
        const resultadoGrupo = await seleccionarGrupo(page, grupo).catch((err) => ({ ok: false, motivo: err.message }));
        if (!resultadoGrupo.ok && resultadoGrupo.motivo !== 'SIN_SELECTOR_GRUPO') {
          logger.warn(`No se pudo seleccionar grupo ${grupo}: ${resultadoGrupo.motivo}`);
        }

        const filas = await leerFilasAlumnos(page);
        const alumnosEnAlerta = filas.filter((f) => f.enAlerta15Dias);
        const columnaD = calcularSumaColumnaD(filas);

        const evidencia = await guardarEvidencia(page, `entrenamiento_${args.colegio}_${nivelCodigo}_${grupo}`);

        reporte.filas.push({
          nivel: nivelCodigo,
          curso: curso.texto,
          grupo,
          // Columna D: confirmada contra el HTML real (.vertical.resumen > div
          // con <span>Curso</span>/<p>N</p>), suma por alumno.
          columnaD_sesionesIndividuales: {
            ok: columnaD.ok,
            suma: columnaD.suma,
            valoresNoDetectados: columnaD.valoresNoDetectados,
            detallePorAlumno: filas.map((f) => ({ nombre: f.nombre, curso: f.sesionesCursoRaw, totales: f.sesionesTotalesRaw }))
          },
          // Columna F: fuente confirmada por el usuario (naranja "!" = alerta) y
          // validada contra el HTML real (.checkActivity[data-activity="0"]):
          columnaF_alumnosAlerta: {
            totalAlumnos: filas.length,
            alumnosEnAlerta
          },
          evidencia
        });

        logger.info(
          `${curso.texto} (${nivelCodigo}) / Grupo ${grupo}: columna D = ${columnaD.ok ? columnaD.suma : 'NO_DETECTADO (' + columnaD.valoresNoDetectados.length + ' valor(es))'}, ` +
          `${alumnosEnAlerta.length} alumno(s) en alerta de ${filas.length} totales.`
        );
      }
    }

    fs.mkdirSync(config.paths.reports, { recursive: true });
    const nombreReporte = `inspectEntrenamiento_${DateTime.now().setZone(config.timezone).toFormat('yyyyLLdd_HHmmss')}.json`;
    const rutaReporte = path.join(config.paths.reports, nombreReporte);
    fs.writeFileSync(rutaReporte, JSON.stringify(reporte, null, 2), 'utf8');
    logger.success(`Reporte guardado en: ${rutaReporte}`);
    logger.info('Revisá el JSON: columnas D y F ya usan fuentes confirmadas contra el HTML real. Si columna D dio NO_DETECTADO en algún alumno, revisar detallePorAlumno.');
  } catch (err) {
    logger.error(`Error en inspectEntrenamiento: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();