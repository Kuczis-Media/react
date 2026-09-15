'use strict';

const manager = require('./ai-provider-manager.js');
const usage = require('./ai-usage.js');
const { getAdapter } = require('./ai-providers.js');

const LEGACY_DEFAULTS = Object.freeze({
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini'
});
const PROVIDER_FAILURES = new Set([
  'AI_INVALID_KEY', 'AI_PERMISSION_DENIED', 'AI_MODEL_UNAVAILABLE', 'AI_RATE_LIMITED', 'AI_PROVIDER_TIMEOUT',
  'AI_CREDIT_BALANCE_EXHAUSTED', 'AI_ORGANIZATION_SPEND_LIMIT_REACHED',
  'AI_PROJECT_SPEND_LIMIT_REACHED', 'AI_ORGANIZATION_USAGE_LIMIT_REACHED',
  'AI_QUOTA_EXHAUSTED', 'AI_PROVIDER_ERROR', 'EMPTY_MODEL_RESPONSE'
]);

async function resolveConfig(moduleName = 'chat', options = {}) {
  const storesFactory = options.getStores || manager.getAiStores;
  let stores;
  let settings;
  try {
    stores = storesFactory();
    ({ settings } = await manager.readSettings(stores.metadata));
  } catch {
    // ENV is the deployment migration path when the configuration store itself
    // is unavailable. Once a panel config is selected, failures are fail-closed.
    return legacyEnvironmentConfig();
  }
  const assignmentName = manager.MODULES.includes(moduleName) ? moduleName : 'other';
  const assignedId = settings.moduleAssignments[assignmentName];
  if (manager.ENV_CONFIG_IDS.has(assignedId)) return resolveConfigById(assignedId, options);
  if (!settings.configs.length) return legacyEnvironmentConfig();
  const config = assignedId
    ? settings.configs.find((item) => item.aiConfigId === assignedId)
    : settings.configs.find((item) => item.isDefault);
  if (!config || config.secretConfigured !== true) return null;
  const apiKey = await manager.readSecret(stores.secrets, config.aiConfigId);
  return manager.secretMatchesConfig(config, apiKey) ? { ...config, apiKey, source: 'panel' } : null;
}

async function resolveConfigById(aiConfigId, options = {}) {
  const id = String(aiConfigId || '');
  if (id === 'env-gemini' || id === 'env-openai') {
    const legacy = legacyEnvironmentConfig(id.slice(4));
    return legacy && legacy.aiConfigId === id ? legacy : null;
  }
  const storesFactory = options.getStores || manager.getAiStores;
  const stores = storesFactory();
  const { settings } = await manager.readSettings(stores.metadata);
  const config = settings.configs.find((item) => item.aiConfigId === id);
  if (!config || config.secretConfigured !== true) return null;
  const apiKey = await manager.readSecret(stores.secrets, id);
  return manager.secretMatchesConfig(config, apiKey) ? { ...config, apiKey, source: 'panel' } : null;
}

function legacyEnvironmentConfig(requestedProvider = '') {
  const geminiKey = cleanEnv('GEMINI_API_KEY');
  if ((!requestedProvider || requestedProvider === 'gemini') && geminiKey) return {
    aiConfigId: 'env-gemini',
    name: 'Gemini (ENV)',
    provider: 'gemini',
    model: cleanEnv('GEMINI_MODEL') || LEGACY_DEFAULTS.gemini,
    apiKey: geminiKey,
    source: 'env'
  };
  const openAiKey = cleanEnv('OPENAI_API_KEY');
  if ((!requestedProvider || requestedProvider === 'openai') && openAiKey) return {
    aiConfigId: 'env-openai',
    name: 'OpenAI (ENV)',
    provider: 'openai',
    model: cleanEnv('OPENAI_MODEL') || LEGACY_DEFAULTS.openai,
    apiKey: openAiKey,
    source: 'env'
  };
  return null;
}

function environmentConfigs() {
  return ['gemini', 'openai'].map((provider) => legacyEnvironmentConfig(provider)).filter(Boolean).map((config) => ({
    aiConfigId: config.aiConfigId,
    name: config.name,
    provider: config.provider,
    model: config.model,
    description: 'Konfiguracja z bezpiecznych zmiennych środowiskowych serwera.',
    source: 'env',
    secretConfigured: true,
    connectionStatus: 'untested'
  }));
}

async function sendRequest(input, options = {}) {
  const userId = String(input && input.userId || '');
  if (!userId) throw routerError('AI_USER_REQUIRED', 401);
  const moduleId = String(input.moduleId || input.module || 'chat');
  const usageStores = getUsageStores(options);
  const settingsResult = await usage.readSettings(usageStores.config);
  let config = await resolveConfig(moduleId, options);
  if (!config) throw routerError('AI_NOT_CONFIGURED', 503);
  const request = providerRequest(input);
  const visited = new Set();
  let fallbackFrom = null;

  while (config) {
    if (visited.has(config.aiConfigId)) throw routerError('AI_FALLBACK_CYCLE', 503);
    visited.add(config.aiConfigId);
    const configPolicy = settingsResult.settings.configs[config.aiConfigId];
    const estimate = usage.estimateRequest(request, configPolicy && configPolicy.pricing);
    let reservation;
    try {
      reservation = await usage.reserveRequest(usageStores, {
        userId,
        moduleId,
        aiConfigId: config.aiConfigId,
        provider: config.provider,
        model: config.model,
        estimate
      }, { settings: settingsResult.settings });
    } catch (error) {
      const fallbackId = fallbackFor(error, config.aiConfigId, settingsResult.settings);
      if (!fallbackId) throw error;
      fallbackFrom = fallbackFrom || config.aiConfigId;
      config = await resolveConfigById(fallbackId, options);
      if (!config) throw routerError('AI_FALLBACK_NOT_CONFIGURED', 503);
      continue;
    }

    let response;
    try {
      response = await getAdapter(config.provider).sendRequest(config, request, options);
    } catch (error) {
      await usage.completeReservation(usageStores, reservation, {
        success: false,
        errorCode: error && error.code,
        usage: error && error.usage || null
      });
      const fallbackId = fallbackFor(error, config.aiConfigId, settingsResult.settings);
      if (!fallbackId) throw error;
      fallbackFrom = fallbackFrom || config.aiConfigId;
      config = await resolveConfigById(fallbackId, options);
      if (!config) throw routerError('AI_FALLBACK_NOT_CONFIGURED', 503);
      continue;
    }
    await usage.completeReservation(usageStores, reservation, {
      success: true,
      usage: response.usage || null
    });
    return {
      text: response.text,
      usage: response.usage || null,
      provider: config.provider,
      model: config.model,
      aiConfigId: config.aiConfigId,
      source: config.source,
      fallbackFrom
    };
  }
  throw routerError('AI_NOT_CONFIGURED', 503);
}

async function runProviderOperation(input, options = {}) {
  const userId = String(input && input.userId || '');
  const aiConfigId = String(input && input.aiConfigId || '');
  const operation = String(input && input.operation || '');
  if (!userId) throw routerError('AI_USER_REQUIRED', 401);
  if (!['listModels', 'testConnection'].includes(operation)) throw routerError('INVALID_AI_OPERATION', 400);
  const config = await resolveConfigById(aiConfigId, options);
  if (!config) throw routerError('AI_NOT_CONFIGURED', 503);
  const usageStores = getUsageStores(options);
  const { settings } = await usage.readSettings(usageStores.config);
  const reservation = await usage.reserveRequest(usageStores, {
    userId,
    moduleId: 'admin-ai',
    aiConfigId: config.aiConfigId,
    provider: config.provider,
    model: config.model,
    estimate: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostMicros: 0 }
  }, { settings });
  let result;
  try {
    result = await getAdapter(config.provider)[operation](config, options);
  } catch (error) {
    await usage.completeReservation(usageStores, reservation, { success: false, errorCode: error && error.code, usage: null });
    throw error;
  }
  await usage.completeReservation(usageStores, reservation, { success: true, usage: null });
  return { result, config };
}

async function applyPolicy(input = {}, options = {}) {
  try {
    const stores = getUsageStores(options);
    const { settings } = await usage.readSettings(stores.config);
    const user = settings.users[String(input.userId || '')];
    return user && user.mode === 'disabled'
      ? { ok: false, code: 'AI_DISABLED_FOR_USER' }
      : { ok: true };
  } catch (error) {
    return { ok: false, code: error && error.code || 'AI_LIMIT_STORAGE_UNAVAILABLE' };
  }
}

function fallbackFor(error, aiConfigId, settings) {
  const policy = settings.configs[aiConfigId];
  const fallbackId = policy && policy.fallbackConfigId;
  if (!fallbackId) return null;
  if (PROVIDER_FAILURES.has(error && error.code)) return fallbackId;
  const scope = error && error.details && error.details.scope;
  return scope === 'config' || scope === 'provider' || error && error.code === 'AI_COST_ESTIMATE_UNAVAILABLE'
    ? fallbackId : null;
}

function providerRequest(input) {
  return {
    system: typeof input.system === 'string' ? input.system : '',
    messages: Array.isArray(input.messages) ? input.messages : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    temperature: Number.isFinite(input.temperature) ? input.temperature : 0.2,
    maxOutputTokens: Number.isSafeInteger(input.maxOutputTokens) ? input.maxOutputTokens : 4096
  };
}

function getUsageStores(options) {
  try { return (options.getUsageStores || usage.getAiUsageStores)(); }
  catch (error) {
    if (error && error.code) throw error;
    throw routerError('AI_LIMIT_STORAGE_UNAVAILABLE', 503);
  }
}

function cleanEnv(name) {
  return typeof process.env[name] === 'string' ? process.env[name].trim() : '';
}

function routerError(code, status, details) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

module.exports = {
  applyPolicy,
  environmentConfigs,
  legacyEnvironmentConfig,
  resolveConfig,
  resolveConfigById,
  runProviderOperation,
  sendRequest,
  _test: { LEGACY_DEFAULTS, fallbackFor, providerRequest }
};
