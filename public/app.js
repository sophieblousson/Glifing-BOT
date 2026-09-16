'use strict';

const MAX_LINEAS_LOG = 1000;

const el = {
  badgeModo: document.getElementById('badgeModo'),
  selectColegio: document.getElementById('selectColegio'),
  btnValidar: document.getElementById('btnValidar'),
  btnEscribir: document.getElementById('btnEscribir'),
  btnDetener: document.getElementById('btnDetener'),
  btnLimpiarLogs: document.getElementById('btnLimpiarLogs'),
  btnLimpiarLogsTop: document.getElementById('btnLimpiarLogsTop'),
  btnDescargarReporte: document.getElementById('btnDescargarReporte'),
  btnVerReporte: document.getElementById('btnVerReporte'),
  listaEstadoConfig: document.getElementById('listaEstadoConfig'),
  estadoRun: document.getElementById('estadoRun'),
  estadoRunTexto: document.getElementById('estadoRunTexto'),
  erroresGlobales: document.getElementById('erroresGlobales'),
  logs: document.getElementById('logs'),
  tablaColegios: document.getElementById('tablaColegios'),
  kpiColegios: document.getElementById('kpiColegios'),
  kpiUltimaEjecucion: document.getElementById('kpiUltimaEjecucion'),
  kpiUltimaHora: document.getElementById('kpiUltimaHora'),
  kpiProcesados: document.getElementById('kpiProcesados'),
  kpiEstado: document.getElementById('kpiEstado'),
  kpiEstadoSub: document.getElementById('kpiEstadoSub'),
  kpiStatusCard: document.getElementById('kpiStatusCard'),
  kpiStatusIcon: document.getElementById('kpiStatusIcon')
};

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const raw = await res.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error(`El servidor respondió con un formato inesperado (${res.status}).`);
    }
  }

  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }

  return data;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearFechaHora(iso) {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;

  return {
    fecha: fecha.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }),
    hora: fecha.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit'
    }) + ' hs'
  };
}

// ---------------------------------------------------------------------
// Config + estado
// ---------------------------------------------------------------------

async function cargarEstado() {
  try {
    const data = await fetchJson('/api/estado');
    pintarModo(data.config || {});
    pintarConfig(data.config || {});
    pintarRunner(data.runner || {});
  } catch (err) {
    console.error('No se pudo cargar /api/estado', err);
    if (el.kpiEstado) el.kpiEstado.textContent = 'Sin conexión';
    if (el.kpiEstadoSub) {
      el.kpiEstadoSub.innerHTML = '<span class="status-dot"></span>No se pudo leer el servidor';
    }
    if (el.kpiStatusCard) el.kpiStatusCard.className = 'kpi-card kpi-card--status error';
  }
}

function pintarModo(cfg) {
  if (!el.badgeModo) return;

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
  return `<li><span class="punto ${clase}"></span>${escapeHtml(texto)}</li>`;
}

function pintarConfig(cfg) {
  if (!el.listaEstadoConfig) return;

  const glifing = cfg.glifing || {};
  const googleSheets = cfg.googleSheets || {};

  const items = [
    itemEstado(Boolean(glifing.userConfigured), 'Usuario de Glifing configurado'),
    itemEstado(Boolean(glifing.passwordConfigured), 'Contraseña de Glifing configurada'),
    itemEstado(Boolean(googleSheets.spreadsheetIdConfigured), 'Google Sheet configurado'),
    itemEstado(Boolean(googleSheets.serviceAccountKeyConfigured), 'Service account configurada'),
    `<li><span class="punto ${cfg.headless ? 'ok' : 'warn'}"></span>Chromium ${cfg.headless ? 'headless' : 'visible'}</li>`
  ];

  el.listaEstadoConfig.innerHTML = items.join('');
}

function pintarRunner(runnerState) {
  const corriendo = Boolean(runnerState.running);
  const procesados = Array.isArray(runnerState.colegiosProcesados)
    ? runnerState.colegiosProcesados
    : [];
  const errores = Array.isArray(runnerState.erroresGlobales)
    ? runnerState.erroresGlobales
    : [];

  if (el.estadoRun) {
    el.estadoRun.className = 'status-accessible' + (corriendo ? ' corriendo' : '');
  }

  if (el.estadoRunTexto) {
    el.estadoRunTexto.textContent = corriendo
      ? `Procesando: ${runnerState.colegioActual || '...'}`
      : (runnerState.finishedAt ? 'Última ejecución finalizada' : 'Inactivo');
  }

  if (el.btnValidar) el.btnValidar.disabled = corriendo;
  if (el.btnEscribir) el.btnEscribir.disabled = corriendo;
  if (el.btnDetener) el.btnDetener.disabled = !corriendo;

  pintarKpis(runnerState, procesados, errores);
  pintarErrores(errores);
  pintarTablaColegios(procesados);
}

function pintarKpis(runnerState, procesados, errores) {
  if (el.kpiProcesados) el.kpiProcesados.textContent = String(procesados.length);

  const referencia = runnerState.finishedAt || runnerState.startedAt;
  const ultima = formatearFechaHora(referencia);

  if (el.kpiUltimaEjecucion) {
    el.kpiUltimaEjecucion.textContent = ultima ? ultima.fecha : 'Sin datos';
  }
  if (el.kpiUltimaHora) {
    el.kpiUltimaHora.textContent = ultima ? ultima.hora : '—';
  }

  if (!el.kpiEstado || !el.kpiEstadoSub || !el.kpiStatusCard) return;

  if (runnerState.running) {
    el.kpiEstado.textContent = 'Procesando…';
    el.kpiEstadoSub.innerHTML = `<span class="status-dot"></span>${escapeHtml(runnerState.colegioActual || 'En ejecución')}`;
    el.kpiStatusCard.className = 'kpi-card kpi-card--status running';
    if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = '◷';
    return;
  }

  if (errores.length > 0) {
    el.kpiEstado.textContent = 'Con alertas';
    el.kpiEstadoSub.innerHTML = `<span class="status-dot"></span>${errores.length} error${errores.length === 1 ? '' : 'es'} registrado${errores.length === 1 ? '' : 's'}`;
    el.kpiStatusCard.className = 'kpi-card kpi-card--status error';
    if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = '!';
    return;
  }

  if (runnerState.finishedAt) {
    el.kpiEstado.textContent = 'Finalizado';
    el.kpiEstadoSub.innerHTML = '<span class="status-dot"></span>Ejecución completada';
    el.kpiStatusCard.className = 'kpi-card kpi-card--status running';
    if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = '✓';
    return;
  }

  el.kpiEstado.textContent = 'Inactivo';
  el.kpiEstadoSub.innerHTML = '<span class="status-dot"></span>Sin ejecución activa';
  el.kpiStatusCard.className = 'kpi-card kpi-card--status';
  if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = '◷';
}

function pintarErrores(errores) {
  if (!el.erroresGlobales) return;

  if (!errores.length) {
    el.erroresGlobales.innerHTML = '';
    return;
  }

  el.erroresGlobales.innerHTML =
    '<table class="tabla"><thead><tr><th>Colegio</th><th>Error</th></tr></thead><tbody>' +
    errores
      .map((e) => `<tr><td>${escapeHtml(e.colegio || '(general)')}</td><td>${escapeHtml(e.mensaje)}</td></tr>`)
      .join('') +
    '</tbody></table>';
}

function pintarTablaColegios(lista) {
  if (!el.tablaColegios) return;

  if (!lista.length) {
    el.tablaColegios.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">▤</div>
        <strong>Todavía no hay datos de esta ejecución.</strong>
        <span>Cuando se procesen colegios, vas a ver el detalle acá.</span>
      </div>`;
    return;
  }

  el.tablaColegios.innerHTML =
    '<table class="tabla"><thead><tr><th>Colegio</th><th>Estado</th></tr></thead><tbody>' +
    lista
      .map((c) => `<tr><td>${escapeHtml(c.pestana)}</td><td><span class="chip ${escapeHtml(c.estado)}">${escapeHtml(c.estado)}</span></td></tr>`)
      .join('') +
    '</tbody></table>';
}

// ---------------------------------------------------------------------
// Colegios
// ---------------------------------------------------------------------

async function cargarColegios() {
  try {
    const data = await fetchJson('/api/colegios');
    const pestanas = Array.isArray(data.pestanas) ? data.pestanas : [];

    const opciones = ['<option value="ALL">Todos los colegios</option>']
      .concat(
        pestanas.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
      );

    el.selectColegio.innerHTML = opciones.join('');
    if (el.kpiColegios) el.kpiColegios.textContent = String(pestanas.length);
  } catch (err) {
    console.warn('No se pudieron cargar los colegios todavía:', err.message);
    if (el.kpiColegios) el.kpiColegios.textContent = '—';
  }
}

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------

el.btnValidar?.addEventListener('click', async () => {
  const colegio = el.selectColegio.value;
  el.btnValidar.disabled = true;

  try {
    await fetchJson('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegio, mode: 'validate' })
    });
    await cargarEstado();
  } catch (err) {
    alert(err.message);
    el.btnValidar.disabled = false;
  }
});

el.btnEscribir?.addEventListener('click', async () => {
  const colegio = el.selectColegio.value;
  const nombreColegio = colegio === 'ALL' ? 'TODOS los colegios' : colegio;
  const confirmado = confirm(
    `Vas a ESCRIBIR de verdad en Google Sheets para: ${nombreColegio}.\n\n` +
    'Esto modifica la planilla real. ¿Confirmás que querés continuar?'
  );

  if (!confirmado) return;

  el.btnValidar.disabled = true;
  el.btnEscribir.disabled = true;

  try {
    await fetchJson('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegio, mode: 'write' })
    });
    await cargarEstado();
  } catch (err) {
    alert(err.message);
    el.btnValidar.disabled = false;
    el.btnEscribir.disabled = false;
  }
});

el.btnDetener?.addEventListener('click', async () => {
  el.btnDetener.disabled = true;
  try {
    await fetchJson('/api/stop', { method: 'POST' });
  } catch (err) {
    alert(err.message);
  }
});

async function limpiarLogs() {
  try {
    await fetchJson('/api/logs/clear', { method: 'POST' });
    el.logs.innerHTML = '<div class="logs__vacio">Logs limpiados.</div>';
  } catch (err) {
    alert('No se pudieron limpiar los logs: ' + err.message);
  }
}

el.btnLimpiarLogs?.addEventListener('click', limpiarLogs);
el.btnLimpiarLogsTop?.addEventListener('click', limpiarLogs);

async function descargarUltimoReporte() {
  try {
    const data = await fetchJson('/api/reportes');
    if (!data.archivos || data.archivos.length === 0) {
      alert('Todavía no hay ningún reporte generado.');
      return;
    }
    window.location.href = '/api/reportes/' + encodeURIComponent(data.archivos[0]);
  } catch (err) {
    alert('No se pudo obtener el último reporte: ' + err.message);
  }
}

el.btnDescargarReporte?.addEventListener('click', descargarUltimoReporte);
el.btnVerReporte?.addEventListener('click', descargarUltimoReporte);

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
      const nivel = String(entrada.nivel || 'info').toLowerCase();
      const linea = document.createElement('div');
      linea.className = 'linea ' + nivel;
      linea.textContent = `[${entrada.timestamp}] [${String(entrada.nivel || 'INFO').toUpperCase()}] ${entrada.mensaje}`;
      el.logs.appendChild(linea);

      while (el.logs.children.length > MAX_LINEAS_LOG) {
        el.logs.removeChild(el.logs.firstChild);
      }

      el.logs.scrollTop = el.logs.scrollHeight;
    } catch (_) {
      // Se ignoran mensajes SSE que no sean JSON válido.
    }
  };

  origen.onerror = () => {
    // EventSource reintenta automáticamente.
  };
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

cargarEstado();
cargarColegios();
iniciarStreamLogs();
setInterval(cargarEstado, 3000);
