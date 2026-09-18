'use strict';

const { OWNER, REPO, WORKFLOW, githubHeaders } = require('./_github');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const headers = githubHeaders();
  if (!headers) {
    return res.status(503).json({ error: 'Falta configurar GITHUB_ACTIONS_TOKEN en Vercel.' });
  }

  const runsUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=10`;
  const runsRes = await fetch(runsUrl, { headers });

  if (!runsRes.ok) {
    return res.status(runsRes.status).json({ error: 'No se pudo consultar la ejecución activa.' });
  }

  const data = await runsRes.json();
  const run = (data.workflow_runs || []).find((r) => r.status === 'queued' || r.status === 'in_progress');

  if (!run) {
    return res.status(200).json({ ok: true, message: 'No hay una ejecución activa.' });
  }

  const cancelRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${run.id}/cancel`,
    { method: 'POST', headers }
  );

  if (!cancelRes.ok && cancelRes.status !== 409) {
    return res.status(cancelRes.status).json({ error: 'No se pudo cancelar la ejecución.' });
  }

  return res.status(200).json({ ok: true, runId: run.id });
};
