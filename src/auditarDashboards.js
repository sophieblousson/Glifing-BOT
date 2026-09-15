'use strict';

const logger = require('../src/logger');
const { config, validarConfig } = require('../src/config');
const { listarPestanas, leerFormulasRango } = require('../src/googleSheets');
const { parseArgs } = require('../src/cliArgs');

/**
 * herramientas/auditarDashboards.js
 * -----------------------------------------------------------------------
 * Chequea, para cada institución, que:
 *   1. La hoja existe (ya lo garantiza listarPestanas()).
 *   2. N2 == "NIVEL" (encabezado del bloque técnico).
 *   3. N3 no está vacío (hay datos técnicos).
 *   4-11. A12, B12, D12, E12, F12, G12, H12, I12 tienen la MISMA fórmula
 *      (texto literal) que la hoja modelo, ej. si el modelo tiene A12="=N3",
 *      toda institución debe tener A12="=N3" también.
 *
 * Imprime:
 *   AMEGHINO → OK
 *   ERROR BIRÓ → A12 está apuntando a "=AJ3" en vez de "=N3"
 *
 * Uso:
 *   node herramientas/auditarDashboards.js
 *   node herramientas/auditarDashboards.js --hoja-modelo=AMUNDSEN
 * -----------------------------------------------------------------------
 */

const COLUMNAS_A_CHEQUEAR = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I'];
const INDICE_COLUMNA = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9 };

async function main() {
  const args = parseArgs();
  const hojaModelo = args['hoja-modelo'] || 'AMEGHINO';

  const { ok, errores } = validarConfig();
  if (!ok) {
    errores.forEach((e) => logger.error(e));
    process.exit(1);
  }

  logger.info(`=== Auditoría de dashboards (hoja modelo: ${hojaModelo}) ===`);

  const pestanas = await listarPestanas();
  if (!pestanas.includes(hojaModelo)) {
    logger.error(`La hoja modelo "${hojaModelo}" no existe en el Spreadsheet.`);
    process.exit(1);
  }

  const filaModelo = (await leerFormulasRango(hojaModelo, 'A12:J12'))[0] || [];
  const formulaEsperada = {};
  for (const col of COLUMNAS_A_CHEQUEAR) {
    formulaEsperada[col] = filaModelo[INDICE_COLUMNA[col]] || '';
  }
  logger.info(`Fórmulas esperadas (de "${hojaModelo}"): ${JSON.stringify(formulaEsperada)}`);

  let totalOk = 0;
  let totalError = 0;
  const resumen = [];

  for (const pestana of pestanas) {
    const erroresPestana = [];

    try {
      const n2 = (await leerFormulasRango(pestana, 'N2'))[0]?.[0] || '';
      if (n2.trim().toUpperCase() !== 'NIVEL') {
        erroresPestana.push(`N2 dice "${n2 || '(vacío)'}" en vez de "NIVEL"`);
      }

      const n3 = (await leerFormulasRango(pestana, 'N3'))[0]?.[0] || '';
      if (!n3.trim()) {
        erroresPestana.push('N3 está vacío (no hay datos técnicos todavía; correr el bot para esta institución)');
      }

      const fila12 = (await leerFormulasRango(pestana, 'A12:J12'))[0] || [];
      for (const col of COLUMNAS_A_CHEQUEAR) {
        const actual = fila12[INDICE_COLUMNA[col]] || '';
        const esperado = formulaEsperada[col];
        if (actual !== esperado) {
          erroresPestana.push(`${col}12 está apuntando a "${actual || '(vacío)'}" en vez de "${esperado}"`);
        }
      }
    } catch (err) {
      erroresPestana.push(`No se pudo leer la hoja: ${err.message}`);
    }

    if (erroresPestana.length === 0) {
      console.log(`${pestana} → OK`);
      totalOk++;
    } else {
      erroresPestana.forEach((e) => console.log(`ERROR ${pestana} → ${e}`));
      totalError++;
    }
    resumen.push({ pestana, ok: erroresPestana.length === 0, errores: erroresPestana });
  }

  logger.info(`=== Fin de la auditoría: ${totalOk} OK, ${totalError} con error, de ${pestanas.length} pestaña(s) totales ===`);
  if (totalError > 0) process.exitCode = 1;
}

main().catch((err) => {
  logger.error(`Error fatal: ${err.message}`);
  process.exit(1);
});
