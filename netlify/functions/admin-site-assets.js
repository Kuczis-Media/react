'use strict';

const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');
const siteAssets = require('../site-assets.js');

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'GET, PUT, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
  }
  if (!['GET', 'PUT'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, OPTIONS' });
  }
  if (method === 'PUT') {
    const guard = mutationGuard(event, { maxBodyBytes: 5_700_000 });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);
  try {
    if (method === 'GET') {
      if (Object.keys(event.queryStringParameters || {}).length) return json({ error: 'UNEXPECTED_QUERY' }, 400);
      return json(await siteAssets.listAssets());
    }
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return responseForFailure(parsed);
    const allowed = new Set(['filename', 'contentBase64', 'mimeType']);
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)
      || Object.keys(parsed.value).some((key) => !allowed.has(key))
      || typeof parsed.value.filename !== 'string'
      || typeof parsed.value.contentBase64 !== 'string'
      || typeof parsed.value.mimeType !== 'string') {
      return json({ error: 'INVALID_SITE_ASSET_REQUEST' }, 400);
    }
    return json({ asset: await siteAssets.uploadAsset(parsed.value) }, 201);
  } catch (error) {
    const known = error instanceof siteAssets.SiteAssetsError;
    return json({ error: known ? error.code : 'SITE_ASSETS_UNAVAILABLE' }, known && Number.isInteger(error.status) ? error.status : 503);
  }
};
