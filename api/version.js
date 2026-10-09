'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    version: '2026-10-09-write-unlocked',
    source: 'main',
    writeLocked: false
  });
};
