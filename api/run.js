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

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const colegio = String(body.colegio || 'ALL').trim() || 'ALL';
  const mode = body.mode === 'write' ? 'write' : 'validate';

  if (mode === 'write' && colegio === 'ALL') {
    return res.status(403).json({
      error: 'Por seguridad, la primera escritura debe hacerse con un solo colegio. Elegí AMEGHINO y volvé a ejecutar.'
    });
  }

  const activosUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=10`;
  const activosRes = await fetch(activosUrl, { headers });

  if (activosRes.ok) {
    const activos = await activosRes.json();
    const enCurso = (activos.workflow_runs || []).find((r) => r.status === 'queued' || r.status === 'in_progress');
    if (enCurso) {
      return res.status(409).json({
        error: 'Ya hay una ejecución en curso.',
        runId: enCurso.id,
        status: enCurso.status
      });
    }
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  const ghRes = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: 'main',
      inputs: { colegio, mode }
    })
  });

  if (!ghRes.ok) {
    const detalle = await ghRes.text();
    return res.status(ghRes.status).json({
      error: 'GitHub no pudo iniciar la ejecución.',
      detalle: detalle.slice(0, 500)
    });
  }

  return res.status(202).json({ ok: true, colegio, mode });
};
