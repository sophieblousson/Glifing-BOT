'use strict';

const selectors = require('./selectors');
const logger = require('./logger');
const { guardarEvidencia } = require('./evidencia');
const { limpiarTexto } = require('./normalizacion');

/**
 * seleccionarColegio.js
 * -----------------------------------------------------------------------
 * VALIDADO CONTRA EVIDENCIA REAL (04/08/2026): en Glifing, "seleccionar
 * colegio" es en realidad cambiar de CUENTA/ROL desde el menú de perfil
 * (arriba a la derecha). Al abrirlo aparece una lista de renglones tipo:
 *
 *   "gestor centro educativo (Active Learning - Colegio Huerto)"
 *   "gestor centro educativo (Gestor - Colegio Amundsen)"
 *   "gestor centro educativo (Active Learning - Marie Curie)"   <- sin prefijo "Colegio"
 *   "super usuario centro educativo"                            <- no es un colegio, se ignora
 *
 * El colegio ACTUALMENTE activo NO aparece en esa lista (aparece en el
 * encabezado, ej. "Active Learning - Tesla"), así que hay que leerlo aparte
 * y sumarlo al listado de colegios "disponibles".
 *
 * FIX 21/08/2026: el click final sobre el renglón de colegio a veces falla
 * con "element is not visible" aunque el renglón exista y el texto ya haya
 * sido leído correctamente (probablemente por una animación/transición del
 * menú desplegable con muchos colegios). Se agrega { force: true } al
 * click final, igual que se hizo antes con los <select> de Select2: ya
 * verificamos el contenido del renglón por separado (leerRenglonesDelMenu),
 * así que forzar el click es seguro acá.
 * -----------------------------------------------------------------------
 */

/**
 * Extrae el nombre de colegio desde un renglón de texto tipo:
 * "gestor centro educativo (Active Learning - Colegio Huerto)" -> "Huerto"
 * "gestor centro educativo (Active Learning - Marie Curie)"    -> "Marie Curie"
 * Devuelve null si el texto no tiene el formato esperado (ej. "super usuario centro educativo").
 */
function extraerNombreDesdeRenglon(textoRenglon) {
  const match = /\(([^)]*)\)/.exec(textoRenglon || '');
  if (!match) return null;
  const dentroDeParentesis = match[1].trim(); // "Active Learning - Colegio Huerto"
  const partes = dentroDeParentesis.split(' - ');
  let nombre = partes[partes.length - 1].trim(); // "Colegio Huerto" o "Marie Curie"
  nombre = nombre.replace(/^colegio\s+/i, '').trim(); // "Huerto" o "Marie Curie"
  return nombre || null;
}

/**
 * Extrae el nombre del colegio activo desde una línea de encabezado tipo:
 * "Active Learning - Tesla" o "Gestor - Colegio Amundsen".
 */
function extraerNombreDesdeLineaActiva(textoLinea) {
  const match = /^(.+?)\s-\s(.+)$/.exec((textoLinea || '').trim());
  if (!match) return null;
  return match[2].replace(/^colegio\s+/i, '').trim() || null;
}

/**
 * Busca en toda la página una línea de texto corta que matchee el patrón
 * "<Prefijo> - <Colegio>" (ej. "Active Learning - Tesla") para identificar
 * el colegio actualmente activo, sin depender de una clase/id específico.
 *
 * Reintenta tanto ante errores de navegación (contexto destruido) como
 * cuando todavía no aparece ningún candidato (la página puede tardar en
 * renderizar el encabezado tras un cambio de colegio/reload).
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function leerColegioActivo(page, intentos = 8) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const candidatos = await page.evaluate(() => {
        const regex = /^(Active Learning|Gestor)\s-\s.+$/i;
        const resultados = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let nodo;
        while ((nodo = walker.nextNode())) {
          const texto = (nodo.textContent || '').trim();
          if (texto && texto.length < 80 && regex.test(texto)) {
            resultados.push(texto);
          }
        }
        return [...new Set(resultados)];
      });

      if (candidatos.length === 0) {
        if (intento < intentos) {
          logger.info(`Todavía no aparece la línea "Active Learning - <colegio>" en la página (intento ${intento}/${intentos}), reintentando...`);
          await page.waitForTimeout(800);
          continue;
        }
        logger.warn('No se encontró en la página una línea tipo "Active Learning - <colegio>" para identificar el colegio activo, tras agotar los reintentos.');
        return null;
      }

      if (candidatos.length > 1) {
        logger.warn(`Se encontró más de una línea candidata a "colegio activo": ${JSON.stringify(candidatos)}. Se usa la primera.`);
      }

      const nombre = extraerNombreDesdeLineaActiva(candidatos[0]);
      logger.info(`Colegio activo detectado en el encabezado: "${nombre}" (texto completo: "${candidatos[0]}")`);
      return nombre;
    } catch (err) {
      const esNavegacion = /execution context was destroyed|context was destroyed|navigation/i.test(err.message || '');
      if (esNavegacion && intento < intentos) {
        logger.info(`La página seguía navegando al leer el colegio activo (intento ${intento}/${intentos}), reintentando...`);
        await page.waitForTimeout(800);
        continue;
      }
      throw err;
    }
  }
  return null;
}

/**
 * Abre el menú de perfil probando los selectores candidatos de togglePerfil,
 * y CONFIRMA que realmente quedó abierto (el contenedor desplegado se
 * vuelve visible) antes de devolver. Si el primer click no lo abrió
 * (puede pasar, el sitio no usa una clase "open" real para el toggle),
 * reintenta hasta un par de veces.
 */
async function abrirMenuPerfil(page, intentos = 3) {
  for (const sel of selectors.colegio.togglePerfil) {
    const locator = page.locator(sel).first();
    const cuenta = await locator.count().catch(() => 0);
    if (cuenta === 0) continue;

    for (let intento = 1; intento <= intentos; intento++) {
      logger.info(`Abriendo menú de perfil con selector: ${sel} (intento ${intento}/${intentos})`);
      await locator.click({ timeout: 3000 }).catch((err) => {
        logger.warn(`No se pudo hacer click en el toggle de perfil (${sel}): ${err.message}`);
      });
      await page.waitForTimeout(400); // el menú suele animarse al abrir

      const quedoAbierto = await estaMenuAbierto(page);
      if (quedoAbierto) {
        return sel;
      }
      logger.warn(`El menú no quedó visible tras el click (intento ${intento}/${intentos}); reintentando.`);
    }
  }
  return null;
}

/** Chequea si algún contenedor de menú desplegado está actualmente visible. */
async function estaMenuAbierto(page) {
  for (const sel of selectors.colegio.contenedorDesplegado) {
    const locator = page.locator(sel).first();
    const cuenta = await locator.count().catch(() => 0);
    if (cuenta === 0) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (visible) return true;
  }
  return false;
}

/**
 * Lee todos los renglones del menú de perfil ya abierto y devuelve los
 * nombres de colegio parseados (sin duplicados, sin el renglón "super usuario...").
 * @param {import('playwright').Page} page
 */
async function leerRenglonesDelMenu(page) {
  const textos = await page.evaluate(() => {
    const regex = /gestor centro educativo\s*\(/i;
    const nodos = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let nodo;
    while ((nodo = walker.nextNode())) {
      const texto = (nodo.textContent || '').trim();
      if (texto && regex.test(texto)) nodos.push(texto);
    }
    return [...new Set(nodos)];
  });
  return textos;
}

/**
 * Devuelve la lista de nombres de colegio disponibles: el colegio
 * actualmente activo + todos los que aparecen en el menú de perfil.
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function listarColegiosDisponibles(page) {
  const colegioActivo = await leerColegioActivo(page);

  const toggleUsado = await abrirMenuPerfil(page);
  if (!toggleUsado) {
    await guardarEvidencia(page, 'menu_perfil_no_encontrado');
    throw new Error(
      'No se encontró el toggle del menú de perfil (donde se cambia de colegio) con los candidatos de ' +
      'src/selectors.js -> colegio.togglePerfil. Se guardó evidencia en debug/.'
    );
  }

  const renglones = await leerRenglonesDelMenu(page);
  const nombresDelMenu = renglones.map(extraerNombreDesdeRenglon).filter(Boolean);

  // Cerrar el menú para dejar la página como estaba (Escape es no-destructivo).
  await page.keyboard.press('Escape').catch(() => {});

  const todos = [...new Set([colegioActivo, ...nombresDelMenu].filter(Boolean))];

  logger.info(`Colegios disponibles detectados: ${todos.length}`, { todos, colegioActivo, cantidadEnMenu: nombresDelMenu.length });

  if (todos.length === 0) {
    await guardarEvidencia(page, 'menu_colegios_vacio');
    throw new Error('El menú de perfil se abrió pero no se detectó ningún renglón de colegio ni colegio activo. Se guardó evidencia en debug/.');
  }

  return todos;
}

/**
 * Selecciona un colegio por nombre (debe ser uno de los devueltos por
 * listarColegiosDisponibles). Si ya es el colegio activo, no hace nada.
 * @param {import('playwright').Page} page
 * @param {string} nombreColegio
 */
async function seleccionarColegio(page, nombreColegio) {
  const activoActual = await leerColegioActivo(page);
  if (activoActual && limpiarTexto(activoActual) === limpiarTexto(nombreColegio)) {
    logger.info(`"${nombreColegio}" ya es el colegio activo, no hace falta cambiar.`);
    return;
  }

  const toggleUsado = await abrirMenuPerfil(page);
  if (!toggleUsado) {
    await guardarEvidencia(page, `menu_perfil_no_encontrado_al_seleccionar_${nombreColegio}`);
    throw new Error(`No se encontró el toggle del menú de perfil al intentar seleccionar "${nombreColegio}". Evidencia guardada.`);
  }

  const renglones = await leerRenglonesDelMenu(page);
  const renglonBuscado = renglones.find((r) => limpiarTexto(extraerNombreDesdeRenglon(r) || '') === limpiarTexto(nombreColegio));

  if (!renglonBuscado) {
    await guardarEvidencia(page, `colegio_no_encontrado_en_menu_${nombreColegio}`);
    throw new Error(`No se encontró "${nombreColegio}" entre los renglones del menú de perfil. Evidencia guardada. Renglones vistos: ${JSON.stringify(renglones)}`);
  }

  // Puede haber más de una copia de este texto en el DOM (ej. una versión
  // del menú para escritorio y otra para mobile, con la que no corresponde
  // oculta vía CSS). Buscar explícitamente la copia VISIBLE en vez de
  // tomar ciegamente la primera con .first(), que puede resolver a una
  // copia oculta y fallar con "Element is not visible" incluso con force.
  const candidatosRenglon = page.locator(`text="${renglonBuscado}"`);
  const totalCandidatos = await candidatosRenglon.count().catch(() => 0);

  if (totalCandidatos === 0) {
    await guardarEvidencia(page, `colegio_no_clickeable_${nombreColegio}`);
    throw new Error(`El renglón de "${nombreColegio}" se detectó como texto pero no se pudo ubicar como elemento clickeable. Evidencia guardada.`);
  }

  let locatorRenglon = null;
  for (let i = 0; i < totalCandidatos; i++) {
    const candidato = candidatosRenglon.nth(i);
    const esVisible = await candidato.isVisible().catch(() => false);
    if (esVisible) {
      locatorRenglon = candidato;
      break;
    }
  }

  if (!locatorRenglon) {
    logger.warn(`Ninguna de las ${totalCandidatos} copia(s) de "${nombreColegio}" en el menú está visible. Se reintenta con force:true sobre la primera de todas formas.`);
    locatorRenglon = candidatosRenglon.first();
  }

  logger.info(`Haciendo click en el renglón de colegio: "${renglonBuscado}"`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
      logger.info('No se detectó una navegación de página completa tras el click (puede que Glifing actualice el contenido sin recargar la URL).');
    }),
    // force: true porque el click a veces falla con "element is not visible"
    // debido a una animación/transición del menú desplegable, aunque el
    // renglón ya fue confirmado como el correcto por leerRenglonesDelMenu.
    locatorRenglon.click({ timeout: 5000, force: true })
  ]);

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
    logger.warn('networkidle no se alcanzó tras cambiar de colegio; se continúa igual.');
  });
  await page.waitForTimeout(500);

  const activoNuevo = await leerColegioActivo(page);
  if (!activoNuevo || limpiarTexto(activoNuevo) !== limpiarTexto(nombreColegio)) {
    await guardarEvidencia(page, `colegio_no_confirmado_${nombreColegio}`);
    throw new Error(
      `Se hizo click para seleccionar "${nombreColegio}" pero el encabezado ahora muestra "${activoNuevo}". ` +
      'No se puede confirmar el cambio de colegio. Evidencia guardada.'
    );
  }

  logger.success(`Colegio seleccionado y confirmado: ${nombreColegio}`);
}

module.exports = {
  listarColegiosDisponibles,
  seleccionarColegio,
  leerColegioActivo,
  extraerNombreDesdeRenglon
};