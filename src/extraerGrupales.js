'use strict';

const logger = require('./logger');
const { seleccionarCurso, seleccionarGrupo } = require('./seleccionarCursoGrupo');
const { leerSesionesRealizadasResumen, calcularSumaSesionesRealizadas, leerCajasGrupales, fechaMasReciente } = require('./domScan');
const { cursoParaNivel } = require('./normalizacion');

/**
 * extraerGrupales.js
 * -----------------------------------------------------------------------
 * Extractor definitivo de AA (sesiones grupales realizadas) y AB (última
 * sesión grupal) del nuevo bloque técnico U:AB. Niveles: I4, I5, 1N..6N, 7N.
 *
 *   - AA: resumen "Sesiones Realizadas" de la tabla superior de Grupales
 *     (#rewardsTable), ACUMULATIVO. Confirmado con el usuario: nunca debe
 *     bajar entre corridas.
 *   - AB: la fecha "Última sesión" más reciente entre las cajas por
 *     equipo/itinerario (.vertical.resumen), en formato DD/MM/AAAA.
 *
 * NO se compara Grupo A vs B para detectar ERROR_GRUPO_NO_CAMBIO acá (a
 * diferencia de Entrenamiento): con un solo número agregado, dos grupos
 * reales pueden coincidir legítimamente (ej. ambos en 0) y esa comparación
 * daría falsos positivos. seleccionarGrupo() ya confirma que el <select>
 * cambió de letra correctamente.
 * -----------------------------------------------------------------------
 */

const NIVELES_GRUPALES = ['I4', 'I5', '1N', '2N', '3N', '4N', '5N', '6N', '7N'];

async function extraerGrupales(page) {
  const filas = [];

  for (const nivelCodigo of NIVELES_GRUPALES) {
    const curso = cursoParaNivel(nivelCodigo);
    if (!curso) continue;

    try {
      await seleccionarCurso(page, curso);
    } catch (err) {
      logger.warn(`extraerGrupales: "${curso.texto}" (${nivelCodigo}) no disponible en este colegio o no se pudo seleccionar: ${err.message}`);
      continue; // se deja vacío, no es necesariamente un error (punto 14: "si no existe, dejar vacío")
    }

    const primerIntento = await seleccionarGrupo(page, 'A').catch((err) => ({ ok: false, motivo: err.message }));

    if (!primerIntento.ok && primerIntento.motivo === 'SIN_SELECTOR_GRUPO') {
      const fila = await leerDatosGrupales(page, nivelCodigo, '');
      filas.push(fila);
      continue;
    }

    for (const grupo of ['A', 'B']) {
      const rGrupo = grupo === 'A' ? primerIntento : await seleccionarGrupo(page, grupo).catch((err) => ({ ok: false, motivo: err.message }));

      if (!rGrupo.ok) {
        logger.warn(`Grupales: no se pudo seleccionar Grupo ${grupo} en "${curso.texto}" (${nivelCodigo}): ${rGrupo.motivo}`);
        continue;
      }

      const fila = await leerDatosGrupales(page, nivelCodigo, grupo);
      filas.push(fila);
    }
  }

  return filas;
}

async function leerDatosGrupales(page, nivelCodigo, grupo) {
  const valoresRealizadas = await leerSesionesRealizadasResumen(page);
  const cajas = await leerCajasGrupales(page);

  const columnaAA = calcularSumaSesionesRealizadas(valoresRealizadas);
  const ultimaSesion = fechaMasReciente(cajas.map((c) => c.ultimaSesionRaw));

  return {
    nivel: nivelCodigo,
    grupo,
    estado: 'OK',
    columnaAA: columnaAA.ok ? columnaAA.suma : 'NO_DETECTADO',
    columnaAB: ultimaSesion || ''
  };
}

module.exports = { extraerGrupales, NIVELES_GRUPALES };