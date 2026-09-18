'use strict';

const MIGRATION_WRITE_LOCK = true;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    backend: 'github-actions',
    ready: Boolean(process.env.GITHUB_ACTIONS_TOKEN),
    allowWrite:
      !MIGRATION_WRITE_LOCK &&
      String(process.env.ALLOW_WRITE || '').toLowerCase() === 'true',
    migrationWriteLock: MIGRATION_WRITE_LOCK
  });
};
