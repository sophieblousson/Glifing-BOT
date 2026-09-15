'use strict';

const logger = require('./logger');
const { seleccionarCurso, seleccionarGrupo, listaIdentica } = require('./seleccionarCursoGrupo');
const { leerFilasAlumnos, calcularSumaColumnaD } = require('./domScan');
const { cursoParaNivel, esAlumnoDePrueba } = require('./normalizacion');

/**
 * extraerEntrenamiento.js
 * -----------------------------------------------------------------------
 * Extractor definitivo de W (evaluaciones pendientes), X (sesiones
 * individuales) y Z (alerta) del nuevo bloque técnico U:AB.
 *
 *   - W: TODOS los niveles 1N..6N, siempre.
 *   - X y Z: solo 3N (o 3N+4N para Gaudí).
 *
 * FIX (pedido del usuario, nuevo dashboard): se excluye "Prueba Glifing"
 * de los listados de W y Z -- es la cuenta de prueba de la plataforma, no
 * un alumno real.
 * -----------------------------------------------------------------------
 */

const NIVELES_EVALUACIONES = ['1N', '2N', '3N', '4N', '5N', '6N'];

function nivelesConSesionesYAlerta(nombreColegioEnGlifing) {
  const esGaudi = /gaud/i.test(nombreColegioEnGlifing || '');
  return esGaudi ? ['3N', '4N'] : ['3N'];
}

async function extraerEntrenamiento(page, nombreColegioEnGlifing) {
  const nivelesDF = nivelesConSesionesYAlerta(nombreColegioEnGlifing);
  const filas = [];

  for (const nivelCodigo of NIVELES_EVALUACIONES) {
    const curso = cursoParaNivel(nivelCodigo);
    if (!curso) continue;

    try {
      await seleccionarCurso(page, curso);
    } catch (err) {
      logger.error(`extraerEntrenamiento: no se pudo seleccionar curso "${curso.texto}" (${nivelCodigo}): ${err.message}`);
      filas.push({ nivel: nivelCodigo, grupo: 'A', estado: 'ERROR_CURSO_INCORRECTO' });
      filas.push({ nivel: nivelCodigo, grupo: 'B', estado: 'ERROR_CURSO_INCORRECTO' });
      continue;
    }

    const primerIntento = await seleccionarGrupo(page, 'A').catch((err) => ({ ok: false, motivo: err.message }));

    if (!primerIntento.ok && primerIntento.motivo === 'SIN_SELECTOR_GRUPO') {
      logger.info(`"${curso.texto}" (${nivelCodigo}) no tiene selector de grupo; se lee como grupo único.`);
      const filasAlumnos = await leerFilasAlumnos(page);
      filas.push(construirFila(nivelCodigo, '', filasAlumnos, nivelesDF.includes(nivelCodigo)));
      continue;
    }

    const nombresPorGrupo = {};

    for (const grupo of ['A', 'B']) {
      const rGrupo = grupo === 'A' ? primerIntento : await seleccionarGrupo(page, grupo).catch((err) => ({ ok: false, motivo: err.message }));

      if (!rGrupo.ok) {
        logger.warn(`No se pudo seleccionar Grupo ${grupo} en "${curso.texto}" (${nivelCodigo}): ${rGrupo.motivo}`);
        filas.push({ nivel: nivelCodigo, grupo, estado: 'ERROR_SELECTOR' });
        continue;
      }

      const filasAlumnos = await leerFilasAlumnos(page);
      const nombres = filasAlumnos.map((f) => f.nombre);
      nombresPorGrupo[grupo] = nombres;

      if (grupo === 'B' && nombresPorGrupo.A && listaIdentica(nombresPorGrupo.A, nombres)) {
        logger.warn(`ERROR_GRUPO_NO_CAMBIO en "${curso.texto}" (${nivelCodigo}): Grupo A y B devuelven los mismos alumnos.`);
        filas.push({ nivel: nivelCodigo, grupo, estado: 'ERROR_GRUPO_NO_CAMBIO' });
        continue;
      }

      filas.push(construirFila(nivelCodigo, grupo, filasAlumnos, nivelesDF.includes(nivelCodigo)));
    }
  }

  return filas;
}

function construirFila(nivelCodigo, grupo, filasAlumnos, incluirDyZ) {
  const pendientes = filasAlumnos
    .filter((f) => f.evaluationPendiente && !esAlumnoDePrueba(f.nombre))
    .map((f) => f.nombre);

  const fila = {
    nivel: nivelCodigo,
    grupo,
    estado: 'OK',
    columnaW: pendientes.join('\n')
  };

  if (incluirDyZ) {
    const columnaD = calcularSumaColumnaD(filasAlumnos);
    const alerta = filasAlumnos
      .filter((f) => f.enAlerta15Dias && !esAlumnoDePrueba(f.nombre))
      .map((f) => f.nombre);
    fila.columnaX = columnaD.ok ? columnaD.suma : 'NO_DETECTADO';
    fila.columnaZ = alerta.join('\n');

    // Promedio por alumno: confirmado con datos reales del usuario
    // (21/08/2026) -- sesiones individuales ÷ cantidad de alumnos del
    // curso+grupo. Ej: 460 sesiones / 20 alumnos = 23. Solo se calcula
    // cuando la suma de sesiones se pudo detectar bien (columnaD.ok) y
    // hay al menos un alumno, para no dividir por cero ni escribir un
    // promedio basado en datos parciales.
    if (columnaD.ok && filasAlumnos.length > 0) {
      fila.columnaY = columnaD.suma / filasAlumnos.length;
    } else {
      fila.columnaY = '';
    }
  }

  return fila;
}

module.exports = { extraerEntrenamiento, NIVELES_EVALUACIONES, nivelesConSesionesYAlerta };