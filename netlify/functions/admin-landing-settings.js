'use strict';
const { json, mutationGuard, parseJsonBody, requireAdmin, responseForFailure } = require('../admin-common.js');
const assets = require('../site-assets.js');
const model = require('../../public/assets/js/landing-delivery-model.js');

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: { Allow: 'GET, PUT, OPTIONS', 'Cache-Control': 'no-store' }, body: '' };
  if (!['GET', 'PUT'].includes(method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);
  try {
    if (method === 'GET') {
      const route = await assets.readLandingRoute();
      return json({ ...route, configUrl: model.rawUrl(route.settings.target) });
    }
    const guard = mutationGuard(event, { maxBodyBytes: 5000 });
    if (!guard.ok) return responseForFailure(guard);
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return responseForFailure(parsed);
    if (!parsed.value?.settings || Object.keys(parsed.value).some((key) => !['settings', 'expectedSha'].includes(key))) return json({ error: 'INVALID_LANDING_DELIVERY' }, 400);
    const origin = Object.entries(event.headers || {}).find(([name]) => name.toLowerCase() === 'origin')?.[1] || '';
    return json(await assets.saveLandingRoute(parsed.value.settings, process.env, { expectedSha: parsed.value.expectedSha, origin }));
  } catch (error) { return json({ error: error.code || 'SITE_ASSETS_UNAVAILABLE' }, error.status || 503); }
};
