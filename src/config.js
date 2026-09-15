'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');

function toBool(value, defecto) {
  if (value === undefined || value === null || value === '') return defecto;
  return String(value).trim().toLowerCase() === 'true';
}

const config = {
  glifing: {
    groupUrl: process.env.GLIFING_GROUP_URL || 'https://platform.glifing.com/school/group',
    trainingUrl: process.env.GLIFING_TRAINING_URL || 'https://platform.glifing.com/main',
    user: process.env.GLIFING_USER || '',
    password: process.env.GLIFING_PASSWORD || ''
  },
  googleSheets: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
    serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '',
    // Celda donde se escribe "Última actualización: DD/MM/AAAA HH:mm".
    // Default: W1, pegada al bloque técnico (N:U) pero afuera de él, para
    // no competir nunca con el dashboard visible en A:J.
    timestampCell: process.env.GOOGLE_TIMESTAMP_CELL || 'W1'
  },
  dryRun: toBool(process.env.DRY_RUN, true),
  headless: toBool(process.env.HEADLESS, false),
  port: parseInt(process.env.PORT, 10) || 3000,
  timezone: process.env.TZ_REPORTES || 'America/Argentina/Buenos_Aires',

  // Colegios que nunca deben procesarse, aunque existan como pestaña o en el menú.
  // FIX 22/08/2026: "Nuestra Señora del Carmen" estaba excluida por el
  // pedido original del proyecto. El usuario confirmó explícitamente que
  // ahora SÍ debe procesarse (nombre real de pestaña: "NUESTRA SEÑORA DEL
  // CARMEN"), así que se saca de acá. Si en el futuro hay que excluir
  // algún colegio puntual, agregarlo a esta lista (se compara sin
  // importar mayúsculas/acentos/prefijo "Colegio ", ver
  // normalizacion.estaExcluido).
  COLEGIOS_EXCLUIDOS: [],

  // --- Bloque técnico del bot (estructura real confirmada 21/08/2026) ---
  bloqueTecnico: {
    columnaInicio: 'N',
    columnaFin: 'U',
    filaTitulo: 1,
    filaEncabezados: 2,
    filaPrimerDato: 3,
    maxFilasDatos: 100,
    tituloBloque: 'BLOQUE TÉCNICO · NO EDITAR',
    encabezados: [
      'NIVEL',
      'GRUPO',
      'Evaluaciones pendientes',
      'Número de sesiones',
      'Promedio por alumno',
      'Alumnos para estar en alerta',
      'Sesiones Grupales',
      'Última sesión grupal'
    ]
  },

  // --- Detalle de Intervenciones (agregado 22/08/2026) ---
  // EXCEPCIÓN puntual a "el bot nunca toca A:J": esta tabla vive en A28:F
  // dentro del área del dashboard, pero el usuario confirmó que no existe
  // ninguna fórmula que la arme sola (era texto tipeado a mano una vez), y
  // pidió explícitamente que el bot la calcule y reescriba. El bot NUNCA
  // debe tocar ninguna otra celda de A:J fuera de este rango puntual.
  detalleIntervenciones: {
    columnaInicio: 'A',
    columnaFin: 'F',
    filaTitulo: 28,
    filaEncabezados: 29,
    filaPrimerDato: 30,
    // Generoso a propósito: alerta + pendientes de varios niveles y
    // grupos pueden sumar bastantes alumnos en un colegio grande.
    maxFilasDatos: 500,
    tituloBloque: 'DETALLE DE INTERVENCIONES',
    encabezados: ['PRIORIDAD', 'NIVEL', 'GRUPO', 'TIPO', 'ESTUDIANTE', 'MOTIVO / QUÉ REVISAR']
  },

  paths: {
    root: path.join(__dirname, '..'),
    debug: path.join(__dirname, '..', 'debug'),
    screenshots: path.join(__dirname, '..', 'debug', 'screenshots'),
    html: path.join(__dirname, '..', 'debug', 'html'),
    reports: path.join(__dirname, '..', 'debug', 'reports'),
    logs: path.join(__dirname, '..', 'debug', 'logs')
  }
};

function validarConfig() {
  const errores = [];

  if (!config.glifing.user) errores.push('Falta GLIFING_USER en .env');
  if (!config.glifing.password) errores.push('Falta GLIFING_PASSWORD en .env');
  if (!config.googleSheets.spreadsheetId) errores.push('Falta GOOGLE_SHEET_ID en .env');

  if (!config.googleSheets.serviceAccountKeyPath) {
    errores.push('Falta GOOGLE_SERVICE_ACCOUNT_KEY en .env (ruta al archivo .json)');
  } else if (!fs.existsSync(config.googleSheets.serviceAccountKeyPath)) {
    errores.push(
      `El archivo de service account no existe en la ruta indicada: ${config.googleSheets.serviceAccountKeyPath}`
    );
  }

  return { ok: errores.length === 0, errores };
}

function configPublica() {
  return {
    glifing: {
      groupUrl: config.glifing.groupUrl,
      trainingUrl: config.glifing.trainingUrl,
      userConfigured: Boolean(config.glifing.user),
      passwordConfigured: Boolean(config.glifing.password)
    },
    googleSheets: {
      spreadsheetIdConfigured: Boolean(config.googleSheets.spreadsheetId),
      serviceAccountKeyConfigured: Boolean(config.googleSheets.serviceAccountKeyPath),
      timestampCell: config.googleSheets.timestampCell
    },
    dryRun: config.dryRun,
    headless: config.headless,
    port: config.port,
    timezone: config.timezone
  };
}

module.exports = { config, validarConfig, configPublica };