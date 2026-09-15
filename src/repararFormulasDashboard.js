'use strict';

const logger = require('../src/logger');
const { config, validarConfig } = require('../src/config');
const { listarPestanas, leerFormulasRango, escribirValoresRango } = require('../src/googleSheets');
const { parseArgs } = require('../src/cliArgs');

/**
 * herramientas/repararFormulasDashboard.js
 * -----------------------------------------------------------------------
 * Corrige el BUG 1 (referencias del dashboard desplazadas): lee las
 * fórmulas REALES de la hoja modelo (AMEGHINO por defecto, A12:J29 --
 * 18 filas, una por cada combinación NIVEL+GRUPO canónica del bloque
 * técnico, ver consolidarResultados.NIVELES_CANONICOS) y las copia TAL
 * CUAL a esa misma zona (A12:J29) del resto de las instituciones.
 *
 * Como las fórmulas de Sheets son relativas a su propia hoja (ej. "=N3"
 * en la fila 12 de AMEGHINO), copiar el texto literal de la fórmula a la
 * fila 12 de otra hoja hace que automáticamente apunte a la N3 de ESA
 * hoja -- no hace falta recalcular nada a mano.
 *
 * NUNCA toca nada fuera de A12:J29 (nada de A1:J11, nada del bloque
 * técnico N:U, nada de Detalle de Intervenciones).
 *
 * Uso:
 *   node herramientas/repararFormulasDashboard.js
 *   node herramientas/repararFormulasDashboard.js --dry-run          (solo mostrar, no escribir)
 *   node herramientas/repararFormulasDashboard.js --hoja-modelo=AMUNDSEN
 *   node herramientas/repararFormulasDashboard.js --solo=BIRÓ,GAUDÍ,TESLA
 *
 * IMPORTANTE: además del --dry-run propio de este script, para escribir de
 * verdad también hace falta DRY_RUN=false en el .env -- es la misma
 * barrera de seguridad que usa el resto del bot, a propósito.
 * -----------------------------------------------------------------------
 */

const RANGO_DASHBOARD = 'A12:J29'; // 18 filas (canónicas) x 10 columnas (A..J)

async function main() {
  const args = parseArgs();
  const hojaModelo = args['hoja-modelo'] || 'AMEGHINO';
  const soloEstas = args.solo ? args.solo.split(',').map((s) => s.trim().toUpperCase()) : null;
  const simular = Boolean(args['dry-run']);

  const { ok, errores } = validarConfig();
  if (!ok) {
    errores.forEach((e) => logger.error(e));
    process.exit(1);
  }

  logger.info(`=== Reparación de fórmulas del dashboard (hoja modelo: ${hojaModelo}, rango: ${RANGO_DASHBOARD}) ===`);
  if (simular) logger.info('Modo --dry-run: solo se va a MOSTRAR qué se escribiría, sin tocar el Sheet.');

  const pestanas = await listarPestanas();
  if (!pestanas.includes(hojaModelo)) {
    logger.error(`La hoja modelo "${hojaModelo}" no existe en el Spreadsheet. Pestañas disponibles: ${pestanas.join(', ')}`);
    process.exit(1);
  }

  logger.info(`Leyendo fórmulas maestras de "${hojaModelo}"!${RANGO_DASHBOARD}...`);
  const formulasMaestras = await leerFormulasRango(hojaModelo, RANGO_DASHBOARD);

  if (formulasMaestras.length === 0) {
    logger.error(`No se pudo leer ningún dato de "${hojaModelo}"!${RANGO_DASHBOARD}. Revisá que el rango sea correcto.`);
    process.exit(1);
  }
  logger.info(`Fórmulas maestras leídas: ${formulasMaestras.length} fila(s).`);
  logger.info(`Ejemplo (primera fila, A12:J12): ${JSON.stringify(formulasMaestras[0])}`);

  const objetivos = pestanas.filter((p) => {
    if (p === hojaModelo) return false;
    if (soloEstas && !soloEstas.includes(p.toUpperCase())) return false;
    return true;
  });

  logger.info(`Instituciones a reparar (${objetivos.length}): ${objetivos.join(', ')}`);

  let exitos = 0;
  let fallos = 0;

  for (const pestana of objetivos) {
    try {
      if (simular) {
        logger.info(`[DRY-RUN] Se escribiría en "${pestana}"!${RANGO_DASHBOARD} las mismas ${formulasMaestras.length} fila(s) de "${hojaModelo}".`);
      } else {
        await escribirValoresRango(pestana, RANGO_DASHBOARD, formulasMaestras);
        logger.success(`"${pestana}"!${RANGO_DASHBOARD} reparado (fórmulas copiadas de "${hojaModelo}").`);
      }
      exitos++;
    } catch (err) {
      logger.error(`No se pudo reparar "${pestana}": ${err.message}`);
      fallos++;
    }
  }

  logger.info(`=== Fin: ${exitos} institución(es) OK, ${fallos} con error ===`);
  if (fallos > 0) process.exitCode = 1;
}

main().catch((err) => {
  logger.error(`Error fatal: ${err.message}`);
  process.exit(1);
});
