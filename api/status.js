'use strict';

const { OWNER, REPO, WORKFLOW, githubHeaders } = require('./_github');

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
      steps
    }
  });
};
