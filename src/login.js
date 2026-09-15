'use strict';

const { config } = require('./config');
const selectors = require('./selectors');
const logger = require('./logger');
const { guardarEvidencia } = require('./evidencia');

/**
 * login.js
 * -----------------------------------------------------------------------
 * Flujo:
 *   1. Ir a GLIFING_GROUP_URL (redirige a login si no hay sesión).
 *   2. Cerrar cualquier modal/aviso de cookies que tape el formulario.
 *   3. Completar usuario/contraseña.
 *   4. FIX 15/09/2026: volver a chequear modales justo ANTES del click en
 *      "Entrar" -- el aviso de cookies (Cookiebot) puede aparecer con
 *      demora, después del primer chequeo, y termina bloqueando el click
 *      ("subtree intercepts pointer events") aunque el botón ya sea
 *      visible. Chequear de nuevo acá lo evita sin tener que adivinar
 *      cuánto tarda en aparecer.
 *   5. Enviar el formulario y confirmar que la URL cambió.
 * -----------------------------------------------------------------------
 */

async function primerSelectorVisible(page, listaSelectores, timeoutPorIntento = 1500) {
  for (const sel of listaSelectores) {
    try {
      const locator = page.locator(sel).first();
      await locator.waitFor({ state: 'visible', timeout: timeoutPorIntento });
      return { locator, selector: sel };
    } catch (_) {
      // este candidato no matcheó a tiempo, probar el siguiente
    }
  }
  return null;
}

/** Cierra banners de cookies / modales si aparecen. No falla si no hay ninguno. */
async function cerrarModalesSiExisten(page) {
  const encontrado = await primerSelectorVisible(page, selectors.modalesGenericos.botonesCierre, 1200);
  if (encontrado) {
    logger.info(`Cerrando modal/aviso con selector: ${encontrado.selector}`);
    try {
      await encontrado.locator.click({ timeout: 2000 });
      await page.waitForTimeout(300);
      return true;
    } catch (err) {
      logger.warn(`No se pudo hacer click en el modal detectado (${encontrado.selector}): ${err.message}`);
      return false;
    }
  }
  return false;
}

/**
 * Hace click en un locator y, si falla porque algo lo tapa ("intercepts
 * pointer events"), intenta cerrar modales y reintenta un par de veces
 * antes de rendirse. Evita tener que adivinar de antemano cuándo aparece
 * un aviso con demora (como Cookiebot).
 */
async function clickConReintentoAntiModal(page, locator, descripcion, intentos = 3) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      await locator.click({ timeout: 5000 });
      return;
    } catch (err) {
      const tapado = /intercepts pointer events|element is not visible/i.test(err.message || '');
      if (tapado && intento < intentos) {
        logger.warn(`Click en "${descripcion}" bloqueado por otro elemento (intento ${intento}/${intentos}); intentando cerrar modales y reintentando...`);
        await cerrarModalesSiExisten(page);
        await page.waitForTimeout(400);
        continue;
      }
      throw err;
    }
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function login(page) {
  logger.info(`Navegando a ${config.glifing.groupUrl} (posible redirección a login)`);
  await page.goto(config.glifing.groupUrl, { waitUntil: 'domcontentloaded' });

  await cerrarModalesSiExisten(page);

  const campoUsuario = await primerSelectorVisible(page, selectors.login.campoUsuario, 4000);
  const campoPassword = await primerSelectorVisible(page, selectors.login.campoPassword, 4000);

  if (!campoUsuario || !campoPassword) {
    await guardarEvidencia(page, 'login_formulario_no_encontrado');
    throw new Error(
      'No se encontraron los campos de usuario/contraseña con los selectores candidatos de src/selectors.js. ' +
      'Se guardó screenshot + HTML en debug/ para poder ajustar los selectores.'
    );
  }

  logger.info(`Completando usuario (selector: ${campoUsuario.selector})`);
  await campoUsuario.locator.fill(config.glifing.user);

  logger.info(`Completando contraseña (selector: ${campoPassword.selector})`);
  await campoPassword.locator.fill(config.glifing.password);

  const botonSubmit = await primerSelectorVisible(page, selectors.login.botonSubmit, 3000);
  if (!botonSubmit) {
    await guardarEvidencia(page, 'login_boton_submit_no_encontrado');
    throw new Error('No se encontró el botón de submit del login. Se guardó evidencia en debug/.');
  }

  // Chequeo extra justo antes del click: un aviso de cookies con demora
  // (Cookiebot) puede haber aparecido recién ahora, después de completar
  // usuario/contraseña.
  await cerrarModalesSiExisten(page);

  logger.info(`Enviando formulario de login (selector: ${botonSubmit.selector})`);
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      logger.warn('networkidle no se alcanzó en 15s tras el login; se continúa igual.');
    }),
    clickConReintentoAntiModal(page, botonSubmit.locator, 'botón de login')
  ]);

  await cerrarModalesSiExisten(page);

  const urlActual = page.url();
  const pareceHaberEntrado =
    urlActual.includes('/main') ||
    urlActual.includes('/school') ||
    urlActual !== config.glifing.groupUrl;

  if (!pareceHaberEntrado) {
    await guardarEvidencia(page, 'login_no_confirmado');
    throw new Error(
      `Tras enviar el formulario la URL sigue siendo ${urlActual}. No se puede confirmar el login. ` +
      'Se guardó evidencia en debug/ (puede haber un mensaje de error de credenciales en pantalla).'
    );
  }

  logger.success(`Login aparentemente exitoso. URL actual: ${urlActual}`);
  return { urlActual };
}

module.exports = { login, cerrarModalesSiExisten };