'use strict';

/**
 * normalizacion.js
 * -----------------------------------------------------------------------
 * Traducción de texto libre (Glifing o Sheet) hacia códigos internos
 * (I4, I5, 1N..7N) y de vuelta hacia el texto legible que pide el nuevo
 * dashboard ("1 Primaria", "1 ESO", etc.) para escribir en la columna U.
 * -----------------------------------------------------------------------
 */

function limpiarTexto(txt) {
  if (txt === null || txt === undefined) return '';
  return String(txt)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°º]/g, '.')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const NIVELES = [
  { codigo: 'I4', patrones: ['i4', 'infantil 4', '4 infantil'] },
  { codigo: 'I5', patrones: ['i5', 'infantil 5', '5 infantil'] },
  { codigo: '1N', patrones: ['1n', '1. primaria', '1 primaria', '1ero primaria', '1er primaria'] },
  { codigo: '2N', patrones: ['2n', '2. primaria', '2 primaria', '2do primaria'] },
  { codigo: '3N', patrones: ['3n', '3. primaria', '3 primaria', '3ro primaria', '3er primaria'] },
  { codigo: '4N', patrones: ['4n', '4. primaria', '4 primaria', '4to primaria'] },
  { codigo: '5N', patrones: ['5n', '5. primaria', '5 primaria', '5to primaria'] },
  { codigo: '6N', patrones: ['6n', '6. primaria', '6 primaria', '6to primaria'] },
  { codigo: '7N', patrones: ['7n', '1. eso', '1 eso', '1ero eso', '1er eso', '1. secundaria', '1 secundaria'] }
];

const NIVELES_SIN_EQUIVALENCIA = [
  '2. eso', '2 eso', '2. secundaria', '2 secundaria',
  '3. eso', '3 eso', '3. secundaria', '3 secundaria',
  '4. eso', '4 eso', '4. secundaria', '4 secundaria'
];

/** Nivel interno -> { texto legible en Glifing, valor real del <option> }. */
const CURSO_POR_NIVEL = {
  I4: { texto: 'Infantil 4', valor: 'I4' },
  I5: { texto: 'Infantil 5', valor: 'I5' },
  '1N': { texto: '1º Primaria', valor: '1' },
  '2N': { texto: '2º Primaria', valor: '2' },
  '3N': { texto: '3º Primaria', valor: '3' },
  '4N': { texto: '4º Primaria', valor: '4' },
  '5N': { texto: '5º Primaria', valor: '5' },
  '6N': { texto: '6º Primaria', valor: '6' },
  '7N': { texto: '1º Secundaria', valor: 'ESO 1' }
};

/**
 * Nivel interno -> etiqueta EXACTA que pide el dashboard nuevo para la
 * columna U (NIVEL). Distinto del texto de Glifing: acá se usa "1 ESO",
 * no "1º Secundaria", y sin el símbolo "º".
 */
const ETIQUETA_NIVEL_PARA_SHEET = {
  I4: 'I4',
  I5: 'I5',
  '1N': '1 Primaria',
  '2N': '2 Primaria',
  '3N': '3 Primaria',
  '4N': '4 Primaria',
  '5N': '5 Primaria',
  '6N': '6 Primaria',
  '7N': '1 ESO'
};

function cursoParaNivel(codigoNivel) {
  const datos = CURSO_POR_NIVEL[codigoNivel];
  return datos ? { codigo: codigoNivel, ...datos } : null;
}

/** Devuelve la etiqueta para escribir en la columna U del bloque técnico. */
function etiquetaNivelParaSheet(codigoNivel) {
  return ETIQUETA_NIVEL_PARA_SHEET[codigoNivel] || codigoNivel;
}

function nivelDesdeTexto(textoLibre) {
  const limpio = limpiarTexto(textoLibre);
  if (!limpio) return null;

  for (const noMapea of NIVELES_SIN_EQUIVALENCIA) {
    if (limpio.includes(noMapea)) return null;
  }

  for (const nivel of NIVELES) {
    for (const patron of nivel.patrones) {
      if (limpio === patron || limpio.includes(patron)) {
        return nivel.codigo;
      }
    }
  }
  return null;
}

const CODIGOS_NIVEL = NIVELES.map((n) => n.codigo);
const GRUPOS_VALIDOS = ['A', 'B'];

function grupoDesdeTexto(textoLibre) {
  const limpio = limpiarTexto(textoLibre);
  if (!limpio) return null;
  if (/\ba\b/.test(limpio) && !/\bb\b/.test(limpio)) return 'A';
  if (/\bb\b/.test(limpio) && !/\ba\b/.test(limpio)) return 'B';
  return null;
}

function sinPrefijoColegio(nombre) {
  return limpiarTexto(nombre).replace(/^colegio\s+/, '').trim();
}

function mismoColegio(nombreA, nombreB) {
  return sinPrefijoColegio(nombreA) === sinPrefijoColegio(nombreB);
}

function emparejarConPestana(nombreGlifing, nombresPestanas) {
  const limpio = sinPrefijoColegio(nombreGlifing);
  const match = nombresPestanas.find((p) => sinPrefijoColegio(p) === limpio);
  return match || null;
}

function estaExcluido(nombreColegio, listaExcluidos) {
  return listaExcluidos.some((excluido) => mismoColegio(excluido, nombreColegio));
}

/**
 * ¿Este nombre de alumno corresponde a la cuenta de prueba de la
 * plataforma ("Prueba Glifing")? Debe excluirse de evaluaciones y alertas.
 */
function esAlumnoDePrueba(nombre) {
  return limpiarTexto(nombre) === 'prueba glifing';
}

module.exports = {
  limpiarTexto,
  nivelDesdeTexto,
  CODIGOS_NIVEL,
  GRUPOS_VALIDOS,
  grupoDesdeTexto,
  mismoColegio,
  emparejarConPestana,
  estaExcluido,
  cursoParaNivel,
  CURSO_POR_NIVEL,
  etiquetaNivelParaSheet,
  ETIQUETA_NIVEL_PARA_SHEET,
  esAlumnoDePrueba
};
