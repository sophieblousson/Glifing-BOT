'use strict';

const selectors = require('./selectors');
const logger = require('./logger');
const { guardarEvidencia } = require('./evidencia');
const { limpiarTexto } = require('./normalizacion');

/**
 * seleccionarCursoGrupo.js
 * -----------------------------------------------------------------------
 * Validado contra evidencia real: <select id="course">/<select id="group">
 * dentro de "#filterForm .curso-grupo", envueltos por Select2 (por eso
 * selectOption necesita force:true). Al cambiar, dispara
 * $('#filterForm').submit() -> recarga completa de página.
 *
 * Los <option> de curso usan valores internos fijos (I4, I5, '1'..'6',
 * 'ESO 1'..'ESO 4'). Se intenta por ese value primero (más robusto), con
 * respaldo por texto. Para GRUPO se usa siempre texto (nunca asumir
 * Grupo A = value 1, Grupo B = value 2, por pedido explícito).
 * -----------------------------------------------------------------------
 */

async function encontrarContenedor(page, listaSelectores) {
  for (const sel of listaSelectores) {
    const locator = page.locator(sel).first();
    const cuenta = await locator.count().catch(() => 0);
    if (cuenta > 0) return { locator, selector: sel };
  }
  return null;
}

async function leerConReintento(fnEvaluate, intentos = 5, esperaMs = 600) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await fnEvaluate();
    } catch (err) {
      const esNavegacion = /execution context was destroyed|context was destroyed|navigation/i.test(err.message || '');
      if (esNavegacion && intento < intentos) {
        await new Promise((resolve) => setTimeout(resolve, esperaMs));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function leerTextoVisibleActual(locator) {
  return leerConReintento(async () => {
    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      return locator.evaluate((el) => el.options[el.selectedIndex]?.text?.trim() || '');
    }
    return ((await locator.textContent()) || '').trim();
  });
}

async function conEsperaDeNavegacion(page, accionAsync, etiqueta) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
      logger.info(`No se detectó una navegación de página completa tras "${etiqueta}" (puede que no haga falta recargar).`);
    }),
    accionAsync()
  ]);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
    logger.warn(`networkidle no se alcanzó tras "${etiqueta}"; se continúa igual.`);
  });
  await page.waitForTimeout(300);
}

async function seleccionarCurso(page, curso) {
  const info = typeof curso === 'string' ? { texto: curso, valor: null } : curso;

  const contenedor = await encontrarContenedor(page, selectors.cursoGrupo.contenedorCurso);
  if (!contenedor) {
    await guardarEvidencia(page, `curso_selector_no_encontrado_${info.texto}`);
    throw new Error(`No se encontró el selector de curso para "${info.texto}". Evidencia guardada.`);
  }

  const tagName = await contenedor.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => null);
  if (tagName !== 'select') {
    await guardarEvidencia(page, `curso_no_es_select_${info.texto}`);
    throw new Error(`El contenedor de curso encontrado (${contenedor.selector}) no es un <select>. Evidencia guardada.`);
  }

  let seleccionadoPorValor = false;
  if (info.valor) {
    const tieneEseValor = await contenedor.locator.locator(`option[value="${info.valor}"]`).count().catch(() => 0);
    if (tieneEseValor > 0) {
      logger.info(`Seleccionando curso "${info.texto}" por value="${info.valor}"`);
      await conEsperaDeNavegacion(page, () => contenedor.locator.selectOption(info.valor, { force: true }), `seleccionar curso ${info.texto} (por value)`);
      seleccionadoPorValor = true;
    } else {
      logger.warn(`El <select> de curso no tiene una opción con value="${info.valor}". Se intenta por texto.`);
    }
  }

  if (!seleccionadoPorValor) {
    const options = await contenedor.locator.locator('option').all();
    let valueEncontrado = null;
    for (const opt of options) {
      const texto = (await opt.textContent()) || '';
      if (limpiarTexto(texto).includes(limpiarTexto(info.texto))) {
        valueEncontrado = await opt.getAttribute('value');
        break;
      }
    }
    if (valueEncontrado === null) {
      await guardarEvidencia(page, `curso_opcion_no_encontrada_${info.texto}`);
      const textosDisponibles = await contenedor.locator.locator('option').allTextContents();
      throw new Error(`No se encontró la opción de curso "${info.texto}" (ni por value ni por texto). Opciones vistas: ${JSON.stringify(textosDisponibles)}. Evidencia guardada.`);
    }
    logger.info(`Seleccionando curso "${info.texto}" por texto (value resuelto: "${valueEncontrado}")`);
    await conEsperaDeNavegacion(page, () => contenedor.locator.selectOption(valueEncontrado, { force: true }), `seleccionar curso ${info.texto} (por texto)`);
  }

  const contenedorPostNav = await encontrarContenedor(page, selectors.cursoGrupo.contenedorCurso);
  if (contenedorPostNav) {
    const textoActual = await leerTextoVisibleActual(contenedorPostNav.locator);
    if (limpiarTexto(textoActual || '') !== limpiarTexto(info.texto)) {
      logger.warn(`Tras seleccionar, el <select> de curso muestra "${textoActual}" en vez de "${info.texto}". Puede ser una diferencia menor de formato; revisar si se repite.`);
    } else {
      logger.info(`Curso confirmado: "${textoActual}"`);
    }
  }
}

async function seleccionarGrupo(page, grupo) {
  const contenedor = await encontrarContenedor(page, selectors.cursoGrupo.contenedorGrupo);
  if (!contenedor) {
    logger.warn(`No se encontró selector de grupo para intentar seleccionar "${grupo}". Puede que el colegio no separe por grupos.`);
    return { ok: false, motivo: 'SIN_SELECTOR_GRUPO' };
  }

  const tagName = await contenedor.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => null);
  if (tagName !== 'select') {
    logger.warn(`El contenedor de grupo (${contenedor.selector}) no es un <select>; se omite selección de grupo.`);
    return { ok: false, motivo: 'GRUPO_NO_ES_SELECT' };
  }

  const options = await contenedor.locator.locator('option').all();
  let valueEncontrado = null;
  for (const opt of options) {
    const texto = (await opt.textContent()) || '';
    const limpio = limpiarTexto(texto);
    const esGrupoBuscado = grupo === 'A' ? /\ba\b/.test(limpio) : /\bb\b/.test(limpio);
    if (esGrupoBuscado) {
      valueEncontrado = await opt.getAttribute('value');
      break;
    }
  }

  if (valueEncontrado === null) return { ok: false, motivo: 'OPCION_GRUPO_NO_ENCONTRADA' };

  await conEsperaDeNavegacion(page, () => contenedor.locator.selectOption(valueEncontrado, { force: true }), `seleccionar grupo ${grupo}`);

  const contenedorPostNav = await encontrarContenedor(page, selectors.cursoGrupo.contenedorGrupo);
  const valorSeleccionado = contenedorPostNav ? await leerTextoVisibleActual(contenedorPostNav.locator) : null;
  logger.info(`Grupo seleccionado: ${grupo} (control muestra: "${valorSeleccionado}")`);

  return { ok: true, valorSeleccionado };
}

function listaIdentica(listaAnterior, listaActual) {
  if (listaAnterior.length === 0) return false;
  if (listaAnterior.length !== listaActual.length) return false;
  const a = [...listaAnterior].sort();
  const b = [...listaActual].sort();
  return a.every((val, idx) => val === b[idx]);
}

module.exports = { seleccionarCurso, seleccionarGrupo, listaIdentica };
