'use strict';

const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');
const usage = require('../ai-usage.js');
const manager = require('../ai-provider-manager.js');
const router = require('../ai-router.js');

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'GET, PUT, POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
  }
  if (!['GET', 'PUT', 'POST'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, POST, OPTIONS' });
  }
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);

  let stores;
  try { stores = usage.getAiUsageStores(); }
  catch (error) { return errorResponse(error); }

  try {
    if (method === 'GET') {
      const query = event.queryStringParameters || {};
      const view = String(query.view || 'report');
      if (view === 'settings') {
        const { settings } = await usage.readSettings(stores.config);
        return json(settings);
      }
      if (view === 'audit') return json({ audit: await usage.listAudit(stores.config, query.limit) });
      if (view === 'users') {
        const userIds = String(query.ids || '').split(',').map((value) => value.trim()).filter(Boolean);
        return json(await usage.readUsersReport(stores, userIds, {
          period: String(query.period || 'day')
        }));
      }
      if (view !== 'report') throw apiError('INVALID_VIEW', 400);
      return json(await usage.readReport(stores, {
        period: String(query.period || 'day'),
        cursor: String(query.cursor || ''),
        limit: Number(query.limit) || 100
      }));
    }

    const guard = mutationGuard(event, { maxBodyBytes: 100_000 });
    if (!guard.ok) return responseForFailure(guard);
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return responseForFailure(parsed);
    const body = parsed.value;

    if (method === 'PUT') {
      assertOnlyFields(body, ['settings']);
      const aiStores = manager.getAiStores();
      const { settings: providerSettings } = await manager.readSettings(aiStores.metadata);
      const validConfigIds = [
        ...providerSettings.configs.map((config) => config.aiConfigId),
        ...router.environmentConfigs().map((config) => config.aiConfigId)
      ];
      const { settings: currentUsageSettings } = await usage.readSettings(stores.config);
      const referencedConfigIds = new Set(Object.keys(currentUsageSettings.configs));
      Object.values(currentUsageSettings.configs).forEach((policy) => {
        if (policy.fallbackConfigId) referencedConfigIds.add(policy.fallbackConfigId);
      });
      const validSet = new Set(validConfigIds);
      const staleConfigIds = Array.from(referencedConfigIds).filter((aiConfigId) => !validSet.has(aiConfigId));
      const settings = usage.pruneStaleConfigPolicies(body.settings, staleConfigIds);
      return json(await usage.saveSettings(stores, settings, auth.userId, validConfigIds));
    }

    assertOnlyFields(body, ['action', 'userId', 'confirmed']);
    if (body.action !== 'reset-user' || body.confirmed !== true) throw apiError('RESET_CONFIRMATION_REQUIRED', 400);
    return json(await usage.resetUserUsage(stores, body.userId, auth.userId));
  } catch (error) {
    return errorResponse(error);
  }
};

function assertOnlyFields(value, allowed) {
  const set = new Set(allowed);
  if (!value || Object.keys(value).some((key) => !set.has(key))) throw apiError('UNEXPECTED_FIELDS', 400);
}

function errorResponse(error) {
  const code = error && typeof error.code === 'string' ? error.code : 'AI_LIMIT_STORAGE_UNAVAILABLE';
  const status = Number.isInteger(error && error.status) ? error.status : 503;
  return json({ error: code, ...(error && error.details ? { details: error.details } : {}) }, status);
}

function apiError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

exports._test = { assertOnlyFields };
