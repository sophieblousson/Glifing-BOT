'use strict';

const fs = require('fs');
const path = require('path');

const mode = process.env.RUN_MODE === 'write' ? 'write' : 'validate';
const colegio = process.env.COLEGIO || 'ALL';

// Barrera de seguridad durante la migración a GitHub Actions.
// Aunque un frontend viejo envíe "write", no se permite escribir hasta
// habilitarlo explícitamente después de una validación completa exitosa.
if (mode === 'write' && process.env.ENABLE_GITHUB_WRITE !== 'true') {
  throw new Error(
    'ESCRITURA_BLOQUEADA_MIGRACION: primero debe completarse una validación exitosa en GitHub Actions.'
  );
}

process.env.DRY_RUN = mode === 'write' ? 'false' : 'true';
process.env.HEADLESS = 'true';

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Falta el secret GOOGLE_SERVICE_ACCOUNT_JSON.');
}

const secretPath = path.join('/tmp', 'glifing-service-account.json');

try {
  const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  fs.writeFileSync(secretPath, JSON.stringify(parsed), {
    encoding: 'utf8',
    mode: 0o600
  });
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = secretPath;
} catch (err) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no contiene JSON válido: ' + err.message);
}

const runner = require('./runner');

(async () => {
  console.log(`GitHub Actions · colegio=${colegio} · mode=${mode}`);
  await runner.ejecutar({ colegio, mode });

  if (runner.state.erroresGlobales?.length) {
    console.error('La ejecución terminó con errores:', runner.state.erroresGlobales);
    process.exitCode = 1;
    return;
  }

  console.log('Ejecución finalizada correctamente.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
