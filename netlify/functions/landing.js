'use strict';

const { json } = require('../admin-common.js');
const landing = require('../landing-content.js');

const PUBLIC_CACHE_HEADERS = Object.freeze({
  'Cache-Control': 'public, max-age=60, must-revalidate',
  'Netlify-CDN-Cache-Control': 'public, durable, max-age=300, must-revalidate',
  'Netlify-Cache-Tag': 'chemdisk-landing',
  Vary: 'Accept-Encoding'
});

exports.handler = async (event = {}) => {
  if (String(event.httpMethod || '').toUpperCase() !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
  try {
    if (event.queryStringParameters?.source === 'route') {
      const settings = await require('../site-assets.js').readPublicLandingRoute();
      return json(settings, 200, PUBLIC_CACHE_HEADERS);
    }
    const store = landing.getLandingStore();
    const publication = await landing.readPublication(store);
    if (publication.version) return json({
      mode: publication.mode, version: publication.version,
      active: publication.mode === 'netlify-blobs',
      ...(publication.model ? { model: landing.publicModel(publication.model) } : {})
    }, 200, PUBLIC_CACHE_HEADERS);
    const result = await landing.readModel(store, landing.PUBLISHED_KEY);
    return json(result.exists ? {
      active: true,
      model: landing.publicModel(result.model)
    } : { active: false }, 200, PUBLIC_CACHE_HEADERS);
  } catch {
    // The checked-in landing page is the safe availability fallback.
    return json({ active: false, error: 'LANDING_STORAGE_UNAVAILABLE' }, 503);
  }
};
