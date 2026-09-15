'use strict';

const { json, requireCourseAccess, responseForFailure } = require('../admin-common.js');
const usage = require('../ai-usage.js');

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'GET, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
  }
  if (method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, OPTIONS' });
  const auth = await requireCourseAccess(event, context);
  if (!auth.ok) return responseForFailure(auth);
  try {
    const stores = usage.getAiUsageStores();
    return json(await usage.readOwnUsage(stores, auth.userId));
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : 'AI_LIMIT_STORAGE_UNAVAILABLE';
    const status = Number.isInteger(error && error.status) ? error.status : 503;
    return json({ error: code }, status);
  }
};
