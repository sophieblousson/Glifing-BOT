'use strict';

const MAX_LINEAS_LOG = 300;

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

let cloudConfig = { ready: false, allowWrite: false };
let colegiosDisponibles = [];
let ultimoRun = null;
let ultimaFirmaLog = '';

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

function agregarLog(mensaje, nivel = 'info') {
  if (!el.logs) return;

  if (el.logs.querySelector('.logs__vacio')) {
    el.logs.innerHTML = '';
  }

  const linea = document.createElement('div');
  linea.className = 'linea ' + nivel;
  const hora = new Date().toLocaleTimeString('es-AR', { hour12: false });
  linea.textContent = `[${hora}] [${nivel.toUpperCase()}] ${mensaje}`;
  el.logs.appendChild(linea);

  while (el.logs.children.length > MAX_LINEAS_LOG) {
    el.logs.removeChild(el.logs.firstChild);
  }

  el.logs.scrollTop = el.logs.scrollHeight;
}

function itemEstado(ok, texto, warn = false) {
  const clase = warn ? 'warn' : (ok ? 'ok' : 'error');
  return `<li><span class="punto ${clase}"></span>${escapeHtml(texto)}</li>`;
}

function parseRunTitle(title) {
  const partes = String(title || '').split('·').map((x) => x.trim());
  return {
    mode: partes[1] || '',
    colegio: partes[2] || ''
  };
}

function conclusionTexto(conclusion) {
  const mapa = {
    success: 'Finalizado',
    failure: 'Con errores',
    cancelled: 'Cancelado',
    timed_out: 'Tiempo agotado',
    skipped: 'Omitido'
  };
  return mapa[conclusion] || 'Finalizado';
}

async function cargarConfig() {
  try {
    cloudConfig = await fetchJson('/api/config');

    if (el.badgeModo) {
      el.badgeModo.textContent = 'Ejecución en la nube';
      el.badgeModo.className = 'badge-modo validacion';
    }

    if (el.listaEstadoConfig) {
      el.listaEstadoConfig.innerHTML = [
        itemEstado(true, 'Panel alojado en Vercel'),
        itemEstado(Boolean(cloudConfig.ready), 'Conexión con GitHub Actions configurada'),
        itemEstado(Boolean(cloudConfig.allowWrite), cloudConfig.allowWrite ? 'Escritura habilitada' : 'Escritura bloqueada por seguridad', !cloudConfig.allowWrite),
        itemEstado(true, 'Chromium se ejecuta en GitHub Actions')
      ].join('');
    }

    actualizarBotones(false);
  } catch (err) {
    cloudConfig = { ready: false, allowWrite: false };
    agregarLog('No se pudo leer la configuración de Vercel: ' + err.message, 'error');
  }
}

async function cargarColegios() {
  try {
    const data = await fetchJson('/api/colegios');
    colegiosDisponibles = Array.isArray(data.pestanas) ? data.pestanas : [];

    const opciones = ['<option value="ALL">Todos los colegios</option>']
      .concat(
        colegiosDisponibles.map(
          (p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`
        )
      );

    if (el.selectColegio) el.selectColegio.innerHTML = opciones.join('');
    if (el.kpiColegios) el.kpiColegios.textContent = String(colegiosDisponibles.length);
  } catch (err) {
    if (el.kpiColegios) el.kpiColegios.textContent = '—';
    agregarLog('No se pudo cargar la lista de colegios: ' + err.message, 'error');
  }
}

function actualizarBotones(corriendo) {
  if (el.btnValidar) el.btnValidar.disabled = corriendo || !cloudConfig.ready;
  if (el.btnEscribir) el.btnEscribir.disabled = corriendo || !cloudConfig.ready || !cloudConfig.allowWrite;
  if (el.btnDetener) el.btnDetener.disabled = !corriendo;
}

function pintarEstado(data) {
  const run = data?.run || null;
  ultimoRun = run;

  if (!run) {
    if (el.estadoRunTexto) el.estadoRunTexto.textContent = 'Inactivo';
    if (el.kpiEstado) el.kpiEstado.textContent = 'Inactivo';
    if (el.kpiEstadoSub) el.kpiEstadoSub.innerHTML = '<span class="status-dot"></span>Sin ejecución activa';
    if (el.kpiStatusCard) el.kpiStatusCard.className = 'kpi-card kpi-card--status';
    if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = '◷';
    if (el.kpiProcesados) el.kpiProcesados.textContent = '0';
    actualizarBotones(false);
    pintarTabla(null);
    return;
  }

  const corriendo = run.status === 'queued' || run.status === 'in_progress';
  const datosTitulo = parseRunTitle(run.title);
  const colegio = datosTitulo.colegio || '—';
  const ultima = formatearFechaHora(run.updatedAt || run.createdAt);

  if (el.kpiUltimaEjecucion) el.kpiUltimaEjecucion.textContent = ultima ? ultima.fecha : 'Sin datos';
  if (el.kpiUltimaHora) el.kpiUltimaHora.textContent = ultima ? ultima.hora : '—';

  if (corriendo) {
    const texto = run.status === 'queued'
      ? 'En cola…'
      : (run.currentStep || 'Procesando…');

    if (el.estadoRunTexto) el.estadoRunTexto.textContent = texto;
    if (el.kpiEstado) el.kpiEstado.textContent = run.status === 'queued' ? 'En cola…' : 'Procesando…';
    if (el.kpiEstadoSub) {
      el.kpiEstadoSub.innerHTML = `<span class="status-dot"></span>${escapeHtml(colegio)}`;
    }
    if (el.kpiStatusCard) el.kpiStatusCard.className = 'kpi-card kpi-card--status running';
    if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = '◷';
    if (el.kpiProcesados) el.kpiProcesados.textContent = '0';

    actualizarBotones(true);
  } else {
    const ok = run.conclusion === 'success';
    const estado = conclusionTexto(run.conclusion);

    if (el.estadoRunTexto) el.estadoRunTexto.textContent = estado;
    if (el.kpiEstado) el.kpiEstado.textContent = estado;
    if (el.kpiEstadoSub) {
      el.kpiEstadoSub.innerHTML = `<span class="status-dot"></span>${escapeHtml(colegio)}`;
    }
    if (el.kpiStatusCard) {
      el.kpiStatusCard.className = 'kpi-card kpi-card--status ' + (ok ? 'running' : 'error');
    }
    if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = ok ? '✓' : '!';
    if (el.kpiProcesados) {
      el.kpiProcesados.textContent = ok
        ? (colegio === 'ALL' ? String(colegiosDisponibles.length || '—') : '1')
        : '0';
    }

    actualizarBotones(false);
  }

  pintarTabla(run);
  registrarCambioEstado(run);
}

function registrarCambioEstado(run) {
  if (!run) return;

  const firma = [run.id, run.status, run.conclusion, run.currentStep, run.failedStep, run.errorSummary].join('|');
  if (firma === ultimaFirmaLog) return;
  ultimaFirmaLog = firma;

  const { colegio, mode } = parseRunTitle(run.title);

  if (run.status === 'queued') {
    agregarLog(`Ejecución enviada a GitHub Actions · ${colegio || 'ALL'} · ${mode || 'validate'}`);
  } else if (run.status === 'in_progress') {
    agregarLog(run.currentStep ? `GitHub Actions: ${run.currentStep}` : 'GitHub Actions está procesando la ejecución.');
  } else if (run.conclusion === 'success') {
    agregarLog('Ejecución finalizada correctamente.', 'ok');
  } else if (run.conclusion === 'cancelled') {
    agregarLog('Ejecución cancelada.', 'warn');
  } else {
    const detalle = run.errorSummary
      ? ` Motivo: ${run.errorSummary}`
      : (run.failedStep ? ` Falló en: ${run.failedStep}.` : '');
    agregarLog(`La ejecución terminó con estado: ${conclusionTexto(run.conclusion)}.${detalle}`, 'error');
  }
}

function pintarTabla(run) {
  if (!el.tablaColegios) return;

  if (!run) {
    el.tablaColegios.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">▤</div>
        <strong>Todavía no hay datos de esta ejecución.</strong>
        <span>Cuando ejecutes el bot, vas a ver el estado acá.</span>
      </div>`;
    return;
  }

  const { colegio, mode } = parseRunTitle(run.title);
  const estado = run.status === 'completed'
    ? conclusionTexto(run.conclusion)
    : (run.status === 'queued' ? 'En cola' : 'Procesando');

  el.tablaColegios.innerHTML = `
    <table class="tabla">
      <thead>
        <tr><th>Colegio</th><th>Modo</th><th>Estado</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(colegio || 'ALL')}</td>
          <td>${escapeHtml(mode === 'write' ? 'Escritura' : 'Validación')}</td>
          <td><span class="chip ${run.conclusion === 'success' ? 'PROCESADO' : ''}">${escapeHtml(estado)}</span></td>
        </tr>
      </tbody>
    </table>`;
}

async function cargarEstado() {
  try {
    const data = await fetchJson('/api/status');
    pintarEstado(data);

    if (el.erroresGlobales) {
      el.erroresGlobales.innerHTML = '';
    }
  } catch (err) {
    actualizarBotones(false);

    if (el.kpiEstado) el.kpiEstado.textContent = 'Sin conexión';
    if (el.kpiEstadoSub) {
      el.kpiEstadoSub.innerHTML = '<span class="status-dot"></span>Falta conectar Vercel con GitHub';
    }
    if (el.kpiStatusCard) el.kpiStatusCard.className = 'kpi-card kpi-card--status error';
    if (el.kpiStatusIcon) el.kpiStatusIcon.textContent = '!';
  }
}

async function ejecutar(mode) {
  const colegio = el.selectColegio?.value || 'ALL';

  if (mode === 'write') {
    const nombre = colegio === 'ALL' ? 'TODOS los colegios' : colegio;
    const confirmado = confirm(
      `Vas a ESCRIBIR de verdad en Google Sheets para: ${nombre}.\n\n¿Confirmás que querés continuar?`
    );
    if (!confirmado) return;
  }

  actualizarBotones(true);
  agregarLog(`Solicitando ejecución para ${colegio}…`);

  try {
    await fetchJson('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegio, mode })
    });

    agregarLog('Solicitud aceptada por Vercel. GitHub Actions va a iniciar la ejecución.');
    setTimeout(cargarEstado, 1800);
  } catch (err) {
    agregarLog(err.message, 'error');
    alert(err.message);
    actualizarBotones(false);
  }
}

el.btnValidar?.addEventListener('click', () => ejecutar('validate'));
el.btnEscribir?.addEventListener('click', () => ejecutar('write'));

el.btnDetener?.addEventListener('click', async () => {
  el.btnDetener.disabled = true;

  try {
    await fetchJson('/api/stop', { method: 'POST' });
    agregarLog('Se solicitó cancelar la ejecución en GitHub Actions.', 'warn');
    setTimeout(cargarEstado, 1200);
  } catch (err) {
    alert(err.message);
  }
});

function limpiarLogs() {
  if (el.logs) el.logs.innerHTML = '<div class="logs__vacio">Sin actividad todavía.</div>';
  ultimaFirmaLog = '';
}

el.btnLimpiarLogs?.addEventListener('click', limpiarLogs);
el.btnLimpiarLogsTop?.addEventListener('click', limpiarLogs);

function abrirUltimaEjecucion() {
  if (!ultimoRun?.url) {
    alert('Todavía no hay una ejecución disponible.');
    return;
  }
  window.open(ultimoRun.url, '_blank', 'noopener,noreferrer');
}

el.btnDescargarReporte?.addEventListener('click', abrirUltimaEjecucion);
el.btnVerReporte?.addEventListener('click', abrirUltimaEjecucion);

(async function iniciar() {
  await cargarConfig();
  await cargarColegios();
  await cargarEstado();
  setInterval(cargarEstado, 5000);
})();
