'use strict';

/**
 * app.js
 * -----------------------------------------------------------------------
 * Todo lo que hace el panel corre contra la API de server.js:
 *   - GET  /api/estado           -> config pública + estado del runner
 *   - GET  /api/colegios         -> pestañas reales del Sheet
 *   - POST /api/run              -> dispara una ejecución
 *   - POST /api/stop             -> pide detener (cierre controlado)
 *   - GET  /api/logs/stream      -> SSE con cada línea de log
 *   - POST /api/logs/clear       -> borra los logs persistidos
 *   - GET  /api/reportes         -> lista de reportes JSON generados
 *
 * Ninguna credencial ni dato sensible vive en este archivo: todo lo
 * relacionado a Glifing/Google Sheets se resuelve en Node.
 * -----------------------------------------------------------------------
 */

const MAX_LINEAS_LOG = 1000;

const el = {
  badgeModo: document.getElementById('badgeModo'),
  selectColegio: document.getElementById('selectColegio'),
  btnValidar: document.getElementById('btnValidar'),
  btnEscribir: document.getElementById('btnEscribir'),
  btnDetener: document.getElementById('btnDetener'),
  btnLimpiarLogs: document.getElementById('btnLimpiarLogs'),
  btnDescargarReporte: document.getElementById('btnDescargarReporte'),
  listaEstadoConfig: document.getElementById('listaEstadoConfig'),
  estadoRun: document.getElementById('estadoRun'),
  estadoRunTexto: document.getElementById('estadoRunTexto'),
  erroresGlobales: document.getElementById('erroresGlobales'),
  logs: document.getElementById('logs'),
  tablaColegios: document.getElementById('tablaColegios')
};

// ---------------------------------------------------------------------
// Config + estado
// ---------------------------------------------------------------------

async function cargarEstado() {
  try {
    const res = await fetch('/api/estado');
    const data = await res.json();
    pintarModo(data.config);
    pintarConfig(data.config);
    pintarRunner(data.runner);
  } catch (err) {
    console.error('No se pudo cargar /api/estado', err);
  }
}

function pintarModo(cfg) {
  if (cfg.dryRun) {
    el.badgeModo.textContent = 'Modo validación';
    el.badgeModo.className = 'badge-modo validacion';
  } else {
    el.badgeModo.textContent = 'Modo producción';
    el.badgeModo.className = 'badge-modo produccion';
  }
}

function itemEstado(ok, texto) {
  const clase = ok ? 'ok' : 'error';
  return `<li><span class="punto ${clase}"></span> ${texto}</li>`;
}

function pintarConfig(cfg) {
  const items = [
    itemEstado(cfg.glifing.userConfigured, 'Usuario de Glifing configurado'),
    itemEstado(cfg.glifing.passwordConfigured, 'Contraseña de Glifing configurada'),
    itemEstado(cfg.googleSheets.spreadsheetIdConfigured, 'GOOGLE_SHEET_ID configurado'),
    itemEstado(cfg.googleSheets.serviceAccountKeyConfigured, 'Archivo de service account encontrado'),
    `<li><span class="punto ${cfg.headless ? 'warn' : 'ok'}"></span> Chromium ${cfg.headless ? 'headless (sin ventana)' : 'visible'}</li>`
  ];
  el.listaEstadoConfig.innerHTML = items.join('');
}

function pintarRunner(runnerState) {
  const corriendo = runnerState.running;
  el.estadoRun.className = 'estado-run' + (corriendo ? ' corriendo' : '');
  el.estadoRunTexto.textContent = corriendo
    ? `Procesando: ${runnerState.colegioActual || '...'}`
    : (runnerState.finishedAt ? 'Última ejecución finalizada' : 'Inactivo');

  el.btnValidar.disabled = corriendo;
  el.btnEscribir.disabled = corriendo;
  el.btnDetener.disabled = !corriendo;

  if (runnerState.erroresGlobales && runnerState.erroresGlobales.length > 0) {
    el.erroresGlobales.innerHTML =
      '<table class="tabla"><thead><tr><th>Colegio</th><th>Error</th></tr></thead><tbody>' +
      runnerState.erroresGlobales
        .map((e) => `<tr><td>${e.colegio || '(general)'}</td><td>${escapeHtml(e.mensaje)}</td></tr>`)
        .join('') +
      '</tbody></table>';
  } else {
    el.erroresGlobales.innerHTML = '';
  }

  pintarTablaColegios(runnerState.colegiosProcesados || []);
}

function pintarTablaColegios(lista) {
  if (!lista.length) {
    el.tablaColegios.innerHTML = '<div class="vacio">Todavía no hay datos de esta ejecución.</div>';
    return;
  }
  el.tablaColegios.innerHTML =
    '<table class="tabla"><thead><tr><th>Colegio (pestaña)</th><th>Estado</th></tr></thead><tbody>' +
    lista.map((c) => `<tr><td>${escapeHtml(c.pestana)}</td><td><span class="chip ${c.estado}">${c.estado}</span></td></tr>`).join('') +
    '</tbody></table>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------
// Colegios (para el <select>)
// ---------------------------------------------------------------------

async function cargarColegios() {
  try {
    const res = await fetch('/api/colegios');
    if (!res.ok) throw new Error((await res.json()).error || 'Error al leer colegios');
    const data = await res.json();
    const opciones = ['<option value="ALL">Todos los colegios</option>']
      .concat(data.pestanas.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`));
    el.selectColegio.innerHTML = opciones.join('');
  } catch (err) {
    console.warn('No se pudieron cargar los colegios todavía:', err.message);
    // Puede fallar si falta configurar Google Sheets; no es bloqueante para ver el panel.
  }
}

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------

el.btnValidar.addEventListener('click', async () => {
  const colegio = el.selectColegio.value;
  el.btnValidar.disabled = true;
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegio, mode: 'validate' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar la ejecución');
    cargarEstado();
  } catch (err) {
    alert(err.message);
    el.btnValidar.disabled = false;
  }
});

el.btnEscribir.addEventListener('click', async () => {
  const colegio = el.selectColegio.value;
  const nombreColegio = colegio === 'ALL' ? 'TODOS los colegios' : colegio;
  const confirmado = confirm(
    `Vas a ESCRIBIR de verdad en Google Sheets para: ${nombreColegio}.\n\n` +
    'Esto modifica la planilla real (columnas C, D, F, G e I). ¿Confirmás que querés continuar?'
  );
  if (!confirmado) return;

  el.btnValidar.disabled = true;
  el.btnEscribir.disabled = true;
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegio, mode: 'write' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar la ejecución');
    cargarEstado();
  } catch (err) {
    alert(err.message);
  } finally {
    el.btnEscribir.disabled = false;
  }
});

el.btnDetener.addEventListener('click', async () => {
  el.btnDetener.disabled = true;
  await fetch('/api/stop', { method: 'POST' });
});

el.btnLimpiarLogs.addEventListener('click', async () => {
  await fetch('/api/logs/clear', { method: 'POST' });
  el.logs.innerHTML = '<div class="logs__vacio">Logs limpiados.</div>';
});

el.btnDescargarReporte.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/reportes');
    const data = await res.json();
    if (!data.archivos || data.archivos.length === 0) {
      alert('Todavía no hay ningún reporte generado.');
      return;
    }
    window.location.href = '/api/reportes/' + encodeURIComponent(data.archivos[0]);
  } catch (err) {
    alert('No se pudo obtener la lista de reportes: ' + err.message);
  }
});

// ---------------------------------------------------------------------
// Logs en vivo (SSE)
// ---------------------------------------------------------------------

function iniciarStreamLogs() {
  const origen = new EventSource('/api/logs/stream');
  let primerMensaje = true;

  origen.onmessage = (evento) => {
    if (primerMensaje) {
      el.logs.innerHTML = '';
      primerMensaje = false;
    }
    try {
      const entrada = JSON.parse(evento.data);
      const linea = document.createElement('div');
      linea.className = 'linea ' + entrada.nivel;
      linea.textContent = `[${entrada.timestamp}] [${entrada.nivel}] ${entrada.mensaje}`;
      el.logs.appendChild(linea);

      while (el.logs.children.length > MAX_LINEAS_LOG) {
        el.logs.removeChild(el.logs.firstChild);
      }
      el.logs.scrollTop = el.logs.scrollHeight;
    } catch (err) {
      // ignora líneas mal formadas
    }
  };

  origen.onerror = () => {
    // El navegador reintenta solo (retry: definido por el servidor).
  };
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

cargarEstado();
cargarColegios();
iniciarStreamLogs();
setInterval(cargarEstado, 3000);
