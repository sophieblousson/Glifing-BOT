'use strict';

const { OWNER, REPO, WORKFLOW, githubHeaders } = require('./_github');

function limpiarLinea(linea) {
  return String(linea || '')
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/##\[[^\]]+\]/g, '')
    .trim();
}

function extraerResumenError(logText) {
  if (!logText) return null;

  const lineas = String(logText)
    .split(/\r?\n/)
    .map(limpiarLinea)
    .filter(Boolean);

  const patrones = [
    /Falta el secret/i,
    /Configuración incompleta/i,
    /no contiene JSON válido/i,
    /Executable doesn't exist/i,
    /browserType\.launch/i,
    /Error general de la ejecución/i,
    /Error:/i,
    /failed/i
  ];

  for (let i = lineas.length - 1; i >= 0; i--) {
    if (patrones.some((p) => p.test(lineas[i]))) {
      return lineas[i].slice(0, 500);
    }
  }

  return lineas.slice(-1)[0]?.slice(0, 500) || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const headers = githubHeaders();
  if (!headers) {
    return res.status(503).json({ error: 'Falta configurar GITHUB_ACTIONS_TOKEN en Vercel.' });
  }

  const runsUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`;
  const runsRes = await fetch(runsUrl, { headers });

  if (!runsRes.ok) {
    return res.status(runsRes.status).json({ error: 'No se pudo consultar GitHub Actions.' });
  }

  const data = await runsRes.json();
  const run = data.workflow_runs?.[0];

  if (!run) {
    return res.status(200).json({ state: 'idle', run: null });
  }

  let currentStep = null;
  let steps = [];
  let failedStep = null;
  let errorSummary = null;

  if (run.status !== 'queued') {
    const jobsRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs?per_page=10`,
      { headers }
    );

    if (jobsRes.ok) {
      const jobs = await jobsRes.json();
      const job = jobs.jobs?.[0];

      steps = (job?.steps || []).map((s) => ({
        name: s.name,
        status: s.status,
        conclusion: s.conclusion
      }));

      currentStep = steps.find((s) => s.status === 'in_progress')?.name || null;
      failedStep = steps.find((s) => s.conclusion === 'failure')?.name || null;

      if (run.status === 'completed' && run.conclusion !== 'success' && job?.id) {
        try {
          const logsRes = await fetch(
            `https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`,
            { headers, redirect: 'follow' }
          );

          if (logsRes.ok) {
            const logText = await logsRes.text();
            errorSummary = extraerResumenError(logText);
          }
        } catch (_) {
          // Si no se pueden leer los logs, igual devolvemos el paso fallido.
        }
      }
    }
  }

  return res.status(200).json({
    state: run.status,
    run: {
      id: run.id,
      number: run.run_number,
      status: run.status,
      conclusion: run.conclusion,
      title: run.display_title,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      url: run.html_url,
      currentStep,
      failedStep,
      errorSummary,
      steps
    }
  });
};
