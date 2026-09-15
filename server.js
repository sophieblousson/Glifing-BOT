'use strict';

const fs = require('fs');
const path = require('path');

// En producción, la service account puede llegar como JSON en una variable
// de entorno. Se materializa de forma temporal fuera del repositorio ANTES
// de cargar config.js, que sigue funcionando igual en localhost con .env.
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  const secretPath = path.join('/tmp', 'glifing-service-account.json');
  try {
    JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    fs.writeFileSync(secretPath, process.env.GOOGLE_SERVICE_ACCOUNT_JSON, {
      encoding: 'utf8',
      mode: 0o600
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = secretPath;
  } catch (err) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON no contiene JSON válido:', err.message);
  }
}

const express = require('express');
const { config, validarConfig, configPublica } = require('./src/config');
const runner = require('./src/runner');
const logger = require('./src/logger');
const { listarPestanas } = require('./src/googleSheets');

const app = express();
const publicDir = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

function errorJson(res, status, err) {
  const mensaje = err instanceof Error ? err.message : String(err);
  return res.status(status).json({ error: mensaje });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'glifing-bot' });
});

app.get('/api/estado', (_req, res) => {
  res.json({
    config: configPublica(),
    runner: runner.state
  });
});

app.get('/api/colegios', async (_req, res) => {
  try {
    const { ok, errores } = validarConfig();
    if (!ok) return res.status(503).json({ error: errores.join(' | ') });

    const pestanas = await listarPestanas();
    res.json({ pestanas });
  } catch (err) {
    logger.error(`No se pudieron leer los colegios: ${err.message}`);
    errorJson(res, 500, err);
  }
});

app.post('/api/run', (req, res) => {
  try {
    const colegio = req.body?.colegio || 'ALL';
    const mode = req.body?.mode === 'write' ? 'write' : 'validate';

    if (runner.state.running) {
      return res.status(409).json({ error: 'Ya hay una ejecución en curso.' });
    }

    const { ok, errores } = validarConfig();
    if (!ok) return res.status(503).json({ error: errores.join(' | ') });

    if (mode === 'write' && config.dryRun) {
      return res.status(400).json({
        error: 'DRY_RUN=true. Para escribir en Google Sheets primero hay que cambiar DRY_RUN=false y reiniciar el servicio.'
      });
    }

    runner.ejecutar({ colegio, mode }).catch((err) => {
      logger.error(`La ejecución terminó con error: ${err.message}`);
    });

    res.status(202).json({ ok: true, colegio, mode });
  } catch (err) {
    errorJson(res, 500, err);
  }
});

app.post('/api/stop', (_req, res) => {
  runner.solicitarStop();
  res.json({ ok: true });
});

app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  const handler = (entrada) => {
    res.write(`data: ${JSON.stringify(entrada)}\n\n`);
  };

  logger.emitter.on('log', handler);

  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    logger.emitter.off('log', handler);
  });
});

app.post('/api/logs/clear', (_req, res) => {
  try {
    fs.mkdirSync(config.paths.logs, { recursive: true });
    const archivos = fs.readdirSync(config.paths.logs);
    for (const archivo of archivos) {
      const ruta = path.join(config.paths.logs, archivo);
      if (fs.statSync(ruta).isFile()) fs.unlinkSync(ruta);
    }
    res.json({ ok: true });
  } catch (err) {
    errorJson(res, 500, err);
  }
});

app.get('/api/reportes', (_req, res) => {
  try {
    fs.mkdirSync(config.paths.reports, { recursive: true });
    const archivos = fs
      .readdirSync(config.paths.reports)
      .filter((nombre) => nombre.toLowerCase().endsWith('.json'))
      .map((nombre) => ({
        nombre,
        mtime: fs.statSync(path.join(config.paths.reports, nombre)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.nombre);

    res.json({ archivos });
  } catch (err) {
    errorJson(res, 500, err);
  }
});

app.get('/api/reportes/:archivo', (req, res) => {
  try {
    const nombre = path.basename(req.params.archivo || '');
    if (!nombre || !nombre.toLowerCase().endsWith('.json')) {
      return res.status(400).json({ error: 'Nombre de reporte inválido.' });
    }

    const ruta = path.join(config.paths.reports, nombre);
    if (!fs.existsSync(ruta)) {
      return res.status(404).json({ error: 'Reporte no encontrado.' });
    }

    res.download(ruta, nombre);
  } catch (err) {
    errorJson(res, 500, err);
  }
});

// La interfaz vive en public/. Cualquier ruta web no-API vuelve al panel.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Ningún endpoint /api debe devolver HTML: esto evita el error
// "Unexpected token ... is not valid JSON" en el frontend.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Endpoint no encontrado: ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  errorJson(res, 500, err);
});

const host = '0.0.0.0';
app.listen(config.port, host, () => {
  console.log(`Glifing Bot disponible en http://${host}:${config.port}`);
  console.log(`Modo: ${config.dryRun ? 'VALIDACIÓN (DRY_RUN=true)' : 'PRODUCCIÓN (DRY_RUN=false)'}`);
});
