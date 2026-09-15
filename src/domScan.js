'use strict';

/**
 * domScan.js
 * -----------------------------------------------------------------------
 * Funciones de lectura del DOM real de Glifing. Las marcadas "validado"
 * son las que usan los extractores definitivos; el resto son utilidades
 * de evidencia que usan los inspectores sueltos (inspectors/*.js).
 * -----------------------------------------------------------------------
 */

function recortar(texto, max = 600) {
  if (!texto) return texto;
  return texto.length > max ? texto.slice(0, max) + `...[recortado, ${texto.length} chars totales]` : texto;
}

async function buscarBotonesPlay(page) {
  return page.evaluate(() => {
    function colorComputado(el) {
      const estilo = window.getComputedStyle(el);
      return { color: estilo.color, backgroundColor: estilo.backgroundColor, fill: estilo.fill || null };
    }
    function contenedorConTexto(el, maxSaltos = 6) {
      let actual = el;
      for (let i = 0; i < maxSaltos && actual; i++) {
        const texto = (actual.textContent || '').trim();
        if (texto.length > 2) return actual;
        actual = actual.parentElement;
      }
      return el.parentElement || el;
    }
    const candidatos = Array.from(
      document.querySelectorAll(
        'button, [class*="play" i], svg[class*="play" i], [class*="icon-play" i], [aria-label*="play" i], [aria-label*="reproducir" i]'
      )
    );
    return candidatos.slice(0, 200).map((el) => {
      const contenedor = contenedorConTexto(el);
      return {
        tag: el.tagName.toLowerCase(),
        clases: el.className ? String(el.className) : '',
        ariaLabel: el.getAttribute('aria-label') || null,
        colorPropio: colorComputado(el),
        outerHTML: el.outerHTML,
        contenedorTexto: (contenedor.textContent || '').trim().slice(0, 300),
        contenedorOuterHTML: contenedor.outerHTML,
        contieneTextoPendiente: /pendiente/i.test(contenedor.textContent || ''),
        contieneTextoSaltearEvaluacion: /saltear\s+evaluaci[oó]n/i.test(contenedor.textContent || '')
      };
    });
  }).then((resultados) =>
    resultados.map((r) => ({ ...r, outerHTML: recortar(r.outerHTML), contenedorOuterHTML: recortar(r.contenedorOuterHTML) }))
  );
}

async function buscarTexto(page, textoBuscado) {
  return page
    .evaluate((texto) => {
      const regex = new RegExp(texto, 'i');
      const nodos = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let nodo;
      while ((nodo = walker.nextNode())) {
        if (nodo.textContent && regex.test(nodo.textContent)) {
          const el = nodo.parentElement;
          if (el) nodos.push(el);
        }
      }
      const unicos = Array.from(new Set(nodos));
      return unicos.slice(0, 100).map((el) => ({
        tag: el.tagName.toLowerCase(),
        clases: el.className ? String(el.className) : '',
        texto: (el.textContent || '').trim().slice(0, 200),
        outerHTML: el.outerHTML
      }));
    }, textoBuscado)
    .then((resultados) => resultados.map((r) => ({ ...r, outerHTML: recortar(r.outerHTML) })));
}

async function buscarNumerosCercaDeEtiqueta(page, etiqueta) {
  return page
    .evaluate((etiquetaBuscada) => {
      const regexEtiqueta = new RegExp(etiquetaBuscada, 'i');
      const regexNumero = /-?\d+([.,]\d+)?/g;
      const nodos = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let nodo;
      while ((nodo = walker.nextNode())) {
        if (nodo.textContent && regexEtiqueta.test(nodo.textContent)) {
          const el = nodo.parentElement;
          if (el) nodos.push(el);
        }
      }
      const unicos = Array.from(new Set(nodos));
      return unicos.slice(0, 100).map((el) => {
        let contenedor = el;
        for (let i = 0; i < 4 && contenedor.parentElement; i++) contenedor = contenedor.parentElement;
        const textoContenedor = (contenedor.textContent || '').trim();
        const numerosEncontrados = textoContenedor.match(regexNumero) || [];
        return {
          etiquetaEncontradaEn: el.tagName.toLowerCase(),
          textoEtiqueta: (el.textContent || '').trim().slice(0, 100),
          contenedorOuterHTML: contenedor.outerHTML,
          numerosCandidatos: numerosEncontrados.slice(0, 20)
        };
      });
    }, etiqueta)
    .then((resultados) => resultados.map((r) => ({ ...r, contenedorOuterHTML: recortar(r.contenedorOuterHTML, 900) })));
}

async function buscarIconosAlertaCerca(page, textoReferencia) {
  return page
    .evaluate((texto) => {
      const regex = new RegExp(texto, 'i');
      const nodos = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let nodo;
      while ((nodo = walker.nextNode())) {
        if (nodo.textContent && regex.test(nodo.textContent)) {
          const el = nodo.parentElement;
          if (el) nodos.push(el);
        }
      }
      const unicos = Array.from(new Set(nodos));
      return unicos.slice(0, 100).map((el) => {
        let contenedor = el;
        for (let i = 0; i < 3 && contenedor.parentElement; i++) contenedor = contenedor.parentElement;
        const iconos = Array.from(
          contenedor.querySelectorAll('[class*="alert" i], [class*="warning" i], [class*="exclam" i], svg, i')
        );
        const iconosInfo = iconos.slice(0, 10).map((ic) => {
          const estilo = window.getComputedStyle(ic);
          return { tag: ic.tagName.toLowerCase(), clases: ic.className ? String(ic.className) : '', color: estilo.color, fill: estilo.fill || null, outerHTML: ic.outerHTML };
        });
        return {
          textoReferenciaEncontrado: (el.textContent || '').trim().slice(0, 100),
          contenedorOuterHTML: contenedor.outerHTML,
          nombreAlumnoCandidato: (contenedor.textContent || '').trim().split('\n')[0].slice(0, 100),
          iconosCandidatos: iconosInfo
        };
      });
    }, textoReferencia)
    .then((resultados) =>
      resultados.map((r) => ({
        ...r,
        contenedorOuterHTML: recortar(r.contenedorOuterHTML, 900),
        iconosCandidatos: r.iconosCandidatos.map((ic) => ({ ...ic, outerHTML: recortar(ic.outerHTML, 300) }))
      }))
    );
}

async function filtrarPendientesYLeerNombres(page) {
  const candidatosToggle = ['.evalBtn', 'button:has-text("Pendiente")', 'text="Pendiente"'];
  let toggleUsado = null;
  for (const sel of candidatosToggle) {
    const locator = page.locator(sel).first();
    const cuenta = await locator.count().catch(() => 0);
    if (cuenta > 0) {
      toggleUsado = { locator, selector: sel };
      break;
    }
  }
  if (!toggleUsado) return { ok: false, motivo: 'TOGGLE_PENDIENTE_NO_ENCONTRADO', filas: [] };

  await toggleUsado.locator.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);

  const resultado = await page.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('.divtrained'));
    if (filas.length === 0) return { totalFilas: 0, filasVisibles: [] };
    const visibles = filas.filter((el) => {
      const estilo = window.getComputedStyle(el);
      return estilo.display !== 'none' && el.offsetParent !== null;
    });
    return {
      totalFilas: filas.length,
      filasVisibles: visibles.map((el) => {
        const texto = (el.textContent || '').trim();
        const primeraLinea = texto.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
        return { nombreCandidato: primeraLinea, textoCompleto: texto.slice(0, 200) };
      })
    };
  });

  await toggleUsado.locator.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);

  return { ok: true, selectorUsado: toggleUsado.selector, ...resultado };
}

/**
 * Lee TODAS las filas de alumnos (<tr class="divtrained">) de Entrenamiento
 * de una sola vez, usando atributos reales del HTML (validado 04/08/2026):
 *   - evaluationpend="True"/"False" -> columna C (evaluaciones pendientes)
 *   - .vertical.resumen > div con <span>Curso</span>/<p>N</p> -> columna D
 *   - .checkActivity[data-activity="0"] -> columna F (alerta)
 *   - id del <tr> = "NOMBRE COMPLETO username" -> nombre limpio
 */
async function leerFilasAlumnos(page) {
  return page.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('tr.divtrained'));
    return filas.map((el) => {
      const idAttr = el.getAttribute('id') || '';
      const username = el.getAttribute('data-username') || '';
      let nombre = idAttr;
      if (username && idAttr.toLowerCase().endsWith(username.toLowerCase())) {
        nombre = idAttr.slice(0, idAttr.length - username.length).trim();
      }

      const evaluationPendRaw = el.getAttribute('evaluationpend');
      const evaluationPendiente = (evaluationPendRaw || '').toLowerCase() === 'true';

      const checkActivity = el.querySelector('.checkActivity');
      const dataActivityRaw = checkActivity ? checkActivity.getAttribute('data-activity') : null;
      const tituloActivity = checkActivity ? checkActivity.getAttribute('title') : null;
      const estiloActivity = checkActivity ? checkActivity.getAttribute('style') : null;
      const enAlerta15Dias = dataActivityRaw === '0';

      let sesionesCursoRaw = null;
      let sesionesTotalesRaw = null;
      let quinceDiasRaw = null;
      const resumenDivs = el.querySelectorAll('.vertical.resumen > div');
      resumenDivs.forEach((div) => {
        const spanEl = div.querySelector('span');
        const pEl = div.querySelector('p');
        if (!spanEl || !pEl) return;
        const etiqueta = spanEl.textContent.trim();
        const valor = pEl.textContent.trim();
        if (etiqueta === 'Curso') sesionesCursoRaw = valor;
        else if (etiqueta === 'Totales') sesionesTotalesRaw = valor;
        else if (etiqueta === '15 días') quinceDiasRaw = valor;
      });

      return {
        nombre,
        username,
        trainedId: el.getAttribute('data-trained') || null,
        evaluationPendRaw,
        evaluationPendiente,
        sesionesCursoRaw,
        sesionesTotalesRaw,
        quinceDiasRaw,
        dataActivityRaw,
        tituloActivity,
        estiloActivity,
        enAlerta15Dias
      };
    });
  });
}

function calcularSumaColumnaD(filas) {
  const valoresNoDetectados = [];
  let suma = 0;
  for (const fila of filas) {
    const numero = Number(fila.sesionesCursoRaw);
    if (fila.sesionesCursoRaw === null || fila.sesionesCursoRaw === '' || Number.isNaN(numero)) {
      valoresNoDetectados.push({ nombre: fila.nombre, valor: fila.sesionesCursoRaw });
      continue;
    }
    suma += numero;
  }
  if (valoresNoDetectados.length > 0) return { ok: false, suma: null, valoresNoDetectados };
  return { ok: true, suma, valoresNoDetectados: [] };
}

/**
 * Lee las "cajas" de sesiones grupales por equipo/itinerario (ej. "Bufanda
 * I4A"), estructura ".vertical.resumen" con Realizadas/Pendientes/Última
 * sesión. NO se usa para el número acumulativo de la columna G (eso lo da
 * leerSesionesRealizadasResumen), pero SÍ es la única fuente de la fecha
 * de "Última sesión grupal".
 */
async function leerCajasGrupales(page) {
  return page.evaluate(() => {
    const bloques = Array.from(document.querySelectorAll('.vertical.resumen'));
    const resultado = [];
    bloques.forEach((bloque) => {
      const divs = bloque.querySelectorAll(':scope > div');
      let realizadasRaw = null;
      let pendientesRaw = null;
      let ultimaSesionRaw = null;
      divs.forEach((div) => {
        const spanEl = div.querySelector('span');
        const pEl = div.querySelector('p');
        if (!spanEl || !pEl) return;
        const etiqueta = spanEl.textContent.trim();
        const valor = pEl.textContent.trim();
        if (etiqueta === 'Realizadas') realizadasRaw = valor;
        else if (etiqueta === 'Pendientes') pendientesRaw = valor;
        else if (etiqueta === 'Última sesión') ultimaSesionRaw = valor;
      });
      if (realizadasRaw === null) return;

      let contenedorFila = bloque.closest('tr') || bloque.closest('.divtrained');
      const nombreEl = contenedorFila ? contenedorFila.querySelector('.name, td.name, .nombre') : null;
      const nombreGrupoCandidato = nombreEl
        ? nombreEl.textContent.trim()
        : (contenedorFila ? contenedorFila.textContent.trim().slice(0, 80) : null);

      resultado.push({ nombreGrupoCandidato, realizadasRaw, pendientesRaw, ultimaSesionRaw });
    });
    return resultado;
  });
}

function calcularSumaColumnaG(cajas) {
  const valoresNoDetectados = [];
  let suma = 0;
  for (const caja of cajas) {
    const numero = Number(caja.realizadasRaw);
    if (caja.realizadasRaw === null || caja.realizadasRaw === '' || Number.isNaN(numero)) {
      valoresNoDetectados.push({ nombreGrupoCandidato: caja.nombreGrupoCandidato, valor: caja.realizadasRaw });
      continue;
    }
    suma += numero;
  }
  if (valoresNoDetectados.length > 0) return { ok: false, suma: null, valoresNoDetectados };
  return { ok: true, suma, valoresNoDetectados: [] };
}

/**
 * Lee el resumen "Sesiones Realizadas" de la tabla superior de Grupales
 * (id="rewardsTable"), ACUMULATIVO -- fuente correcta para la columna G
 * (corregido 04/08/2026, no confundir con el "Realizadas" por equipo).
 */
async function leerSesionesRealizadasResumen(page) {
  return page.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('#rewardsTable tbody tr'));
    return filas
      .map((fila) => {
        const celda = fila.querySelector('td.ses');
        return celda ? celda.textContent.trim() : null;
      })
      .filter((v) => v !== null);
  });
}

function calcularSumaSesionesRealizadas(valoresRaw) {
  const valoresNoDetectados = [];
  let suma = 0;
  for (const valor of valoresRaw) {
    const numero = Number(valor);
    if (valor === null || valor === '' || Number.isNaN(numero)) {
      valoresNoDetectados.push({ valor });
      continue;
    }
    suma += numero;
  }
  if (valoresNoDetectados.length > 0) return { ok: false, suma: null, valoresNoDetectados };
  return { ok: true, suma, valoresNoDetectados: [] };
}

/**
 * Entre varias fechas DD/MM/AAAA (o "-" si no hay), devuelve la más
 * reciente en el mismo formato, o null si ninguna es una fecha válida.
 */
function fechaMasReciente(fechasRaw) {
  let mejor = null;
  let mejorTs = -Infinity;
  for (const raw of fechasRaw) {
    if (!raw || raw === '-') continue;
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
    if (!match) continue;
    const [, d, m, y] = match;
    const ts = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
    if (ts > mejorTs) {
      mejorTs = ts;
      mejor = raw.trim();
    }
  }
  return mejor;
}

module.exports = {
  buscarBotonesPlay,
  buscarTexto,
  buscarNumerosCercaDeEtiqueta,
  buscarIconosAlertaCerca,
  filtrarPendientesYLeerNombres,
  leerFilasAlumnos,
  calcularSumaColumnaD,
  leerCajasGrupales,
  calcularSumaColumnaG,
  leerSesionesRealizadasResumen,
  calcularSumaSesionesRealizadas,
  fechaMasReciente,
  recortar
};
