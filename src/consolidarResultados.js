'use strict';

const { etiquetaNivelParaSheet } = require('./normalizacion');

/**
 * consolidarResultados.js
 * -----------------------------------------------------------------------
 * NUEVA ARQUITECTURA (bloque técnico U:AB, no depende de filas
 * preexistentes en el Sheet): junta lo que devuelven extraerEntrenamiento()
 * (W, X, Z) y extraerGrupales() (AA, AB) por NIVEL+GRUPO, y arma la lista
 * final de filas a escribir -- el número de fila lo asigna quien escribe
 * (googleSheets.escribirBloqueTecnico), no depende de que el Sheet ya
 * tuviera esa combinación.
 *
 * Reglas de bloqueo (por CELDA, no por fila completa): un error real de
 * extracción (ERROR_GRUPO_NO_CAMBIO, ERROR_CURSO_INCORRECTO, ERROR_SELECTOR)
 * en Entrenamiento deja W/X/Z en blanco para esa fila, pero si Grupales sí
 * tiene datos para ese mismo nivel+grupo, AA/AB igual se escriben (y
 * viceversa). Nunca se inventa un "NO_DETECTADO" a mano: si una celda no
 * aplica, se deja vacía.
 * -----------------------------------------------------------------------
 */

const ESTADOS_DE_ERROR = ['ERROR_GRUPO_NO_CAMBIO', 'ERROR_CURSO_INCORRECTO', 'ERROR_SELECTOR'];

// Niveles y grupos canónicos: el bloque técnico SIEMPRE tiene estas 18
// combinaciones (9 niveles x 2 grupos), en este orden exacto, en TODOS
// los colegios -- aunque algunas queden vacías porque ese colegio no
// tiene ese nivel/grupo. Esto es a propósito (corregido 22/08/2026): así
// el dashboard puede usar un mapeo de fila FIJO ("fila 12 del dashboard
// = fila 3 del técnico, fila 13 = fila 4, ...") igual en las 14
// instituciones, sin depender de cuántas combinaciones tenía cada una.
const NIVELES_CANONICOS = ['I4', 'I5', '1N', '2N', '3N', '4N', '5N', '6N', '7N'];
const GRUPOS_CANONICOS = ['A', 'B'];

/**
 * @param {Array} filasEntrenamiento resultado de extraerEntrenamiento()
 * @param {Array} filasGrupales resultado de extraerGrupales()
 * @returns {{filas: Array<object>, huboErroresCriticos: boolean, erroresDetalle: Array}}
 */
function consolidar(filasEntrenamiento, filasGrupales) {
  const mapa = new Map();
  const clave = (nivel, grupo) => `${nivel}|${(grupo || '').toUpperCase()}`;

  const erroresDetalle = [];
  let huboErroresCriticos = false;

  const obtenerOCrear = (nivel, grupo) => {
    const k = clave(nivel, grupo);
    if (!mapa.has(k)) {
      mapa.set(k, {
        nivel,
        grupo: (grupo || '').toUpperCase(),
        etiquetaNivel: etiquetaNivelParaSheet(nivel),
        columnaW: '',
        columnaX: '',
        columnaY: '', // Promedio por alumno (sesiones ÷ cantidad de alumnos), se completa si Entrenamiento lo calculó
        columnaZ: '',
        columnaAA: '',
        columnaAB: ''
      });
    }
    return mapa.get(k);
  };

  // Pre-sembrar las 18 combinaciones canónicas ANTES de procesar los
  // resultados reales, para que toda fila exista aunque no haya datos.
  for (const nivel of NIVELES_CANONICOS) {
    for (const grupo of GRUPOS_CANONICOS) {
      obtenerOCrear(nivel, grupo);
    }
  }

  for (const f of filasEntrenamiento || []) {
    const actual = obtenerOCrear(f.nivel, f.grupo);
    if (f.estado !== 'OK') {
      if (ESTADOS_DE_ERROR.includes(f.estado)) {
        huboErroresCriticos = true;
        erroresDetalle.push({ seccion: 'entrenamiento', nivel: f.nivel, grupo: f.grupo, motivo: f.estado });
      }
      continue;
    }
    actual.columnaW = f.columnaW ?? '';
    if ('columnaX' in f) {
      actual.columnaX = f.columnaX === 'NO_DETECTADO' ? '' : f.columnaX;
      if (f.columnaX === 'NO_DETECTADO') {
        erroresDetalle.push({ seccion: 'entrenamiento', nivel: f.nivel, grupo: f.grupo, motivo: 'NO_DETECTADO (columna X)' });
      }
    }
    if ('columnaY' in f) {
      actual.columnaY = f.columnaY ?? '';
    }
    if ('columnaZ' in f) {
      actual.columnaZ = f.columnaZ ?? '';
    }
  }

  for (const f of filasGrupales || []) {
    const actual = obtenerOCrear(f.nivel, f.grupo);
    if (f.estado !== 'OK') {
      if (ESTADOS_DE_ERROR.includes(f.estado)) {
        huboErroresCriticos = true;
        erroresDetalle.push({ seccion: 'grupales', nivel: f.nivel, grupo: f.grupo, motivo: f.estado });
      }
      continue;
    }
    actual.columnaAA = f.columnaAA === 'NO_DETECTADO' ? '' : f.columnaAA;
    if (f.columnaAA === 'NO_DETECTADO') {
      erroresDetalle.push({ seccion: 'grupales', nivel: f.nivel, grupo: f.grupo, motivo: 'NO_DETECTADO (columna AA)' });
    }
    actual.columnaAB = f.columnaAB || '';
  }

  // Orden estable y SIEMPRE completo: por nivel canónico y luego grupo.
  const filas = Array.from(mapa.values()).sort((a, b) => {
    const iA = NIVELES_CANONICOS.indexOf(a.nivel);
    const iB = NIVELES_CANONICOS.indexOf(b.nivel);
    if (iA !== iB) return (iA === -1 ? 999 : iA) - (iB === -1 ? 999 : iB);
    return a.grupo.localeCompare(b.grupo);
  });

  return { filas, huboErroresCriticos, erroresDetalle };
}

/**
 * Arma "Detalle de Intervenciones": una fila por ALUMNO (no por
 * nivel+grupo), separando las listas W (evaluaciones pendientes) y Z
 * (alerta) que vienen como texto con saltos de línea. Orden: primero
 * todas las ALTA (alerta), después todas las MEDIA (evaluación
 * pendiente); dentro de cada grupo, por nivel/grupo/nombre (igual al
 * orden que ya tenía la tabla armada a mano por el usuario).
 * @param {Array} filasConsolidadas resultado de consolidar().filas
 * @returns {Array<{prioridad:string, nivel:string, grupo:string, tipo:string, estudiante:string, motivo:string}>}
 */
function prepararDetalleIntervenciones(filasConsolidadas) {
  const MOTIVO_ALERTA = 'Menos de 5 sesiones en los últimos 15 días. Revisar continuidad.';
  const MOTIVO_PENDIENTE = 'Completar la evaluación pendiente para actualizar el seguimiento.';

  const ordenar = (a, b) => {
    const iA = NIVELES_CANONICOS.indexOf(a.nivel);
    const iB = NIVELES_CANONICOS.indexOf(b.nivel);
    if (iA !== iB) return (iA === -1 ? 999 : iA) - (iB === -1 ? 999 : iB);
    if (a.grupo !== b.grupo) return a.grupo.localeCompare(b.grupo);
    return a.estudiante.localeCompare(b.estudiante, 'es');
  };

  const filasAlerta = [];
  const filasPendientes = [];

  for (const f of filasConsolidadas) {
    const nombresAlerta = (f.columnaZ || '').split('\n').map((n) => n.trim()).filter(Boolean);
    for (const nombre of nombresAlerta) {
      filasAlerta.push({ nivel: f.nivel, etiquetaNivel: f.etiquetaNivel, grupo: f.grupo, estudiante: nombre });
    }

    const nombresPendientes = (f.columnaW || '').split('\n').map((n) => n.trim()).filter(Boolean);
    for (const nombre of nombresPendientes) {
      filasPendientes.push({ nivel: f.nivel, etiquetaNivel: f.etiquetaNivel, grupo: f.grupo, estudiante: nombre });
    }
  }

  filasAlerta.sort(ordenar);
  filasPendientes.sort(ordenar);

  const detalle = [
    ...filasAlerta.map((f) => ({
      prioridad: 'ALTA',
      nivel: f.etiquetaNivel,
      grupo: f.grupo,
      tipo: 'Alerta de práctica',
      estudiante: f.estudiante,
      motivo: MOTIVO_ALERTA
    })),
    ...filasPendientes.map((f) => ({
      prioridad: 'MEDIA',
      nivel: f.etiquetaNivel,
      grupo: f.grupo,
      tipo: 'Evaluación pendiente',
      estudiante: f.estudiante,
      motivo: MOTIVO_PENDIENTE
    }))
  ];

  return detalle;
}

module.exports = { consolidar, prepararDetalleIntervenciones, ESTADOS_DE_ERROR, NIVELES_CANONICOS, GRUPOS_CANONICOS };