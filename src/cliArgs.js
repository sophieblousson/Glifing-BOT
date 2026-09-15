'use strict';

/**
 * Parser mínimo de argumentos tipo --clave=valor o --clave "valor".
 * Ej: node inspectors/inspectEvaluaciones.js --colegio="AMEGHINO" --curso="3.º Primaria" --grupo=A
 */
function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const sinGuiones = token.slice(2);
    if (sinGuiones.includes('=')) {
      const [clave, ...resto] = sinGuiones.split('=');
      args[clave] = resto.join('=').replace(/^"|"$/g, '');
    } else {
      const siguiente = argv[i + 1];
      if (siguiente && !siguiente.startsWith('--')) {
        args[sinGuiones] = siguiente;
        i++;
      } else {
        args[sinGuiones] = true;
      }
    }
  }
  return args;
}

module.exports = { parseArgs };
