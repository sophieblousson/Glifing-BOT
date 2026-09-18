'use strict';

const DEFAULT_COLEGIOS = [
  'AMEGHINO',
  'AMUNDSEN',
  'BIRÓ',
  'CHESTERTON',
  'DICKENS',
  'GAUDÍ',
  'HUERTO DE TEMPERLEY',
  'IKASTOLA',
  'MARIE CURIE',
  'MOLISANO',
  'NUESTRA SEÑORA DEL CARMEN',
  'NUESTRA SEÑORA DEL HUERTO',
  'STEVENSON',
  'TESLA',
  'TOLKIEN'
];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  let pestanas = DEFAULT_COLEGIOS;

  if (process.env.COLEGIOS_JSON) {
    try {
      const parsed = JSON.parse(process.env.COLEGIOS_JSON);
      if (Array.isArray(parsed) && parsed.length) {
        pestanas = parsed.map(String);
      }
    } catch (_) {}
  }

  res.status(200).json({ pestanas });
};
