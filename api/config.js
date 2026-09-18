'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    backend: 'github-actions',
    ready: Boolean(process.env.GITHUB_ACTIONS_TOKEN),
    allowWrite: true,
    writeScope: 'single-school-only'
  });
};
