'use strict';

const crypto = require('node:crypto');
const { getStore } = require('@netlify/blobs');
const { storageConfig } = require('./progress-storage.js');

const METADATA_STORE_NAME = 'chemdisk-ai-config';
const SECRET_STORE_NAME = 'chemdisk-ai-secrets';
const SETTINGS_KEY = 'settings.json';
const MAX_WRITE_RETRIES = 8;
const PROVIDERS = new Set(['openai', 'gemini']);
const MODULES = Object.freeze(['chat', 'aiGrader', 'aiForms', 'other']);
const ENV_CONFIG_IDS = new Set(['env-gemini', 'env-openai']);
const CONFIG_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
let injectedStoreFactory = null;

function getAiStores() {
  if (injectedStoreFactory) return injectedStoreFactory();
  const config = storageConfig();
  if (!config) throw aiError('AI_STORAGE_UNAVAILABLE', 503);
  const options = { siteID: config.siteId, token: config.token, consistency: 'strong' };
  return {
    metadata: getStore({ name: METADATA_STORE_NAME, ...options }),
    secrets: getStore({ name: SECRET_STORE_NAME, ...options })
  };
}

function emptySettings() {
  return {
    version: 1,
    revision: 0,
    configs: [],
    moduleAssignments: Object.fromEntries(MODULES.map((name) => [name, null])),
    createdAt: null,
    updatedAt: null,
    updatedBy: null
  };
}

function normalizeSettings(raw) {
  const source = plainObject(raw) ? raw : {};
  const configs = [];
  const seen = new Set();
  for (const value of Array.isArray(source.configs) ? source.configs : []) {
    if (!plainObject(value)) continue;
    const aiConfigId = cleanString(value.aiConfigId, 96);
    const provider = cleanString(value.provider, 24).toLowerCase();
    const model = cleanString(value.model, 160);
    if (!CONFIG_ID.test(aiConfigId) || !PROVIDERS.has(provider) || !MODEL_ID.test(model) || seen.has(aiConfigId)) continue;
    seen.add(aiConfigId);
    configs.push({
      aiConfigId,
      name: cleanString(value.name, 100) || aiConfigId,
      provider,
      model,
      description: cleanString(value.description, 500),
      isDefault: value.isDefault === true,
      secretConfigured: value.secretConfigured === true,
      secretHint: value.secretConfigured === true ? cleanString(value.secretHint, 8) : '',
      secretDigest: value.secretConfigured === true && /^[a-f0-9]{64}$/.test(String(value.secretDigest || ''))
        ? String(value.secretDigest) : '',
      connectionStatus: ['ok', 'invalid_key', 'permission_denied', 'model_unavailable', 'rate_limited', 'timeout', 'billing_required', 'provider_error', 'untested'].includes(value.connectionStatus)
        ? value.connectionStatus : 'untested',
      lastTestedAt: isoOrNull(value.lastTestedAt),
      createdAt: isoOrNull(value.createdAt),
      updatedAt: isoOrNull(value.updatedAt)
    });
  }
  if (configs.length && !configs.some((item) => item.isDefault)) configs[0].isDefault = true;
  let foundDefault = false;
  configs.forEach((item) => {
    if (!item.isDefault) return;
    if (foundDefault) item.isDefault = false;
    foundDefault = true;
  });
  const ids = new Set(configs.map((item) => item.aiConfigId));
  const sourceAssignments = plainObject(source.moduleAssignments) ? source.moduleAssignments : {};
  const moduleAssignments = Object.fromEntries(MODULES.map((name) => {
    const value = cleanString(sourceAssignments[name], 96);
    return [name, ids.has(value) || ENV_CONFIG_IDS.has(value) ? value : null];
  }));
  return {
    version: 1,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    configs,
    moduleAssignments,
    createdAt: isoOrNull(source.createdAt),
    updatedAt: isoOrNull(source.updatedAt),
    updatedBy: cleanString(source.updatedBy, 160) || null
  };
}

async function readEntry(store, key) {
  const entry = await store.getWithMetadata(key, { type: 'text', consistency: 'strong' });
  if (!entry) return null;
  if (typeof entry.data !== 'string' || !entry.etag) throw aiError('AI_STORAGE_INVALID', 503);
  let value;
  try { value = JSON.parse(entry.data); } catch { throw aiError('AI_STORAGE_INVALID', 503); }
  return { value, etag: entry.etag };
}

async function readSettings(metadataStore) {
  const entry = await readEntry(metadataStore, SETTINGS_KEY);
  return { settings: normalizeSettings(entry && entry.value), etag: entry && entry.etag || null };
}

async function updateSettings(metadataStore, adminId, updater) {
  for (let retry = 0; retry < MAX_WRITE_RETRIES; retry += 1) {
    const current = await readSettings(metadataStore);
    const settings = structuredClone(current.settings);
    const outcome = await updater(settings);
    if (outcome && outcome.abort) return { settings, result: outcome.result, modified: false };
    const next = normalizeSettings(outcome && outcome.settings ? outcome.settings : settings);
    const now = new Date().toISOString();
    next.revision = settings.revision + 1;
    next.createdAt = settings.createdAt || now;
    next.updatedAt = now;
    next.updatedBy = String(adminId || '').slice(0, 160) || null;
    const result = await metadataStore.set(SETTINGS_KEY, JSON.stringify(next), {
      ...(current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true }),
      metadata: { updatedAt: now, revision: String(next.revision) }
    });
    if (result && result.modified === true) return { settings: next, result: outcome && outcome.result, modified: true };
  }
  throw aiError('AI_CONFIG_CONFLICT', 409);
}

function validateConfigInput(raw, existingId) {
  if (!plainObject(raw)) throw aiError('INVALID_AI_CONFIG', 400);
  const aiConfigId = cleanString(raw.aiConfigId, 96) || existingId || `ai-${crypto.randomUUID()}`;
  const provider = cleanString(raw.provider, 24).toLowerCase();
  const model = normalizeModelId(provider, cleanString(raw.model, 160));
  const name = cleanString(raw.name, 100);
  const description = cleanString(raw.description, 500);
  if (ENV_CONFIG_IDS.has(aiConfigId)) throw aiError('AI_CONFIG_ID_RESERVED', 400);
  if (!CONFIG_ID.test(aiConfigId) || !PROVIDERS.has(provider) || !MODEL_ID.test(model) || !name) {
    throw aiError('INVALID_AI_CONFIG', 400);
  }
  return { aiConfigId, provider, model, name, description };
}

async function saveConfig(stores, raw, adminId) {
  const requestedId = cleanString(raw && raw.aiConfigId, 96);
  const input = validateConfigInput(raw, requestedId);
  const now = new Date().toISOString();
  const result = await updateSettings(stores.metadata, adminId, (settings) => {
    const index = settings.configs.findIndex((item) => item.aiConfigId === input.aiConfigId);
    const previous = index >= 0 ? settings.configs[index] : null;
    const providerChanged = Boolean(previous && previous.provider !== input.provider);
    const next = {
      ...previous,
      ...input,
      isDefault: previous ? previous.isDefault : settings.configs.length === 0,
      secretConfigured: previous && !providerChanged ? previous.secretConfigured : false,
      secretHint: previous && !providerChanged ? previous.secretHint : '',
      secretDigest: previous && !providerChanged ? previous.secretDigest : '',
      connectionStatus: previous && previous.provider === input.provider && previous.model === input.model
        ? previous.connectionStatus : 'untested',
      lastTestedAt: previous && previous.provider === input.provider && previous.model === input.model
        ? previous.lastTestedAt : null,
      createdAt: previous && previous.createdAt || now,
      updatedAt: now
    };
    if (index >= 0) settings.configs[index] = next;
    else settings.configs.push(next);
    return { settings, result: { previous, config: next, providerChanged } };
  });
  if (result.result.providerChanged) await stores.secrets.delete(secretKey(input.aiConfigId));
  const auditAction = result.result.previous && result.result.previous.model !== input.model
    ? 'ai.model.changed'
    : result.result.previous ? 'ai.config.updated' : 'ai.config.created';
  await appendAudit(stores.metadata, {
    adminId,
    action: auditAction,
    aiConfigId: input.aiConfigId,
    previousValue: safeConfigSnapshot(result.result.previous),
    newValue: safeConfigSnapshot(result.result.config)
  });
  return result.settings;
}

function secretKey(aiConfigId) {
  if (!CONFIG_ID.test(String(aiConfigId || ''))) throw aiError('INVALID_AI_CONFIG_ID', 400);
  return `configs/${Buffer.from(aiConfigId, 'utf8').toString('base64url')}.key`;
}

function validateSecret(value) {
  if (typeof value !== 'string') throw aiError('INVALID_AI_SECRET', 400);
  const secret = value.trim();
  if (secret.length < 12 || secret.length > 4096 || /[\u0000-\u001f\u007f]/.test(secret)) {
    throw aiError('INVALID_AI_SECRET', 400);
  }
  return secret;
}

async function setConfigSecret(stores, aiConfigId, rawSecret, adminId) {
  const secret = validateSecret(rawSecret);
  const current = await readSettings(stores.metadata);
  const config = current.settings.configs.find((item) => item.aiConfigId === aiConfigId);
  if (!config) throw aiError('AI_CONFIG_NOT_FOUND', 404);
  const previousSecret = await readSecret(stores.secrets, aiConfigId);
  await stores.secrets.set(secretKey(aiConfigId), secret, {
    metadata: { aiConfigId, updatedAt: new Date().toISOString() }
  });
  let result;
  try {
    result = await updateSettings(stores.metadata, adminId, (settings) => {
      const item = settings.configs.find((candidate) => candidate.aiConfigId === aiConfigId);
      if (!item) throw aiError('AI_CONFIG_NOT_FOUND', 404);
      item.secretConfigured = true;
      item.secretHint = secret.slice(-4);
      item.secretDigest = digestSecret(secret);
      item.connectionStatus = 'untested';
      item.lastTestedAt = null;
      item.updatedAt = new Date().toISOString();
      return { settings };
    });
  } catch (error) {
    try {
      if (previousSecret) await stores.secrets.set(secretKey(aiConfigId), previousSecret, { metadata: { aiConfigId, restoredAt: new Date().toISOString() } });
      else await stores.secrets.delete(secretKey(aiConfigId));
    } catch {}
    throw error;
  }
  await appendAudit(stores.metadata, { adminId, action: 'ai.secret.changed', aiConfigId, previousValue: { configured: config.secretConfigured }, newValue: { configured: true } });
  return result.settings;
}

async function removeConfigSecret(stores, aiConfigId, adminId) {
  const current = await readSettings(stores.metadata);
  const config = current.settings.configs.find((item) => item.aiConfigId === aiConfigId);
  if (!config) throw aiError('AI_CONFIG_NOT_FOUND', 404);
  await stores.secrets.delete(secretKey(aiConfigId));
  const result = await updateSettings(stores.metadata, adminId, (settings) => {
    const item = settings.configs.find((candidate) => candidate.aiConfigId === aiConfigId);
    if (!item) throw aiError('AI_CONFIG_NOT_FOUND', 404);
    item.secretConfigured = false;
    item.secretHint = '';
    item.secretDigest = '';
    item.connectionStatus = 'untested';
    item.lastTestedAt = null;
    item.updatedAt = new Date().toISOString();
    return { settings };
  });
  await appendAudit(stores.metadata, { adminId, action: 'ai.secret.removed', aiConfigId, previousValue: { configured: config.secretConfigured }, newValue: { configured: false } });
  return result.settings;
}

async function readSecret(secretStore, aiConfigId) {
  const value = await secretStore.get(secretKey(aiConfigId), { type: 'text', consistency: 'strong' });
  return typeof value === 'string' ? value : '';
}

async function setDefaultConfig(stores, aiConfigId, adminId) {
  const result = await updateSettings(stores.metadata, adminId, (settings) => {
    if (!settings.configs.some((item) => item.aiConfigId === aiConfigId)) throw aiError('AI_CONFIG_NOT_FOUND', 404);
    const previous = settings.configs.find((item) => item.isDefault)?.aiConfigId || null;
    settings.configs.forEach((item) => { item.isDefault = item.aiConfigId === aiConfigId; });
    return { settings, result: { previous } };
  });
  await appendAudit(stores.metadata, { adminId, action: 'ai.default.changed', aiConfigId, previousValue: result.result.previous, newValue: aiConfigId });
  return result.settings;
}

async function setModuleAssignment(stores, moduleName, aiConfigId, adminId) {
  if (!MODULES.includes(moduleName)) throw aiError('INVALID_AI_MODULE', 400);
  const result = await updateSettings(stores.metadata, adminId, (settings) => {
    if (aiConfigId && !ENV_CONFIG_IDS.has(aiConfigId) && !settings.configs.some((item) => item.aiConfigId === aiConfigId)) {
      throw aiError('AI_CONFIG_NOT_FOUND', 404);
    }
    const previous = settings.moduleAssignments[moduleName] || null;
    settings.moduleAssignments[moduleName] = aiConfigId || null;
    return { settings, result: { previous } };
  });
  await appendAudit(stores.metadata, { adminId, action: 'ai.module.changed', aiConfigId: aiConfigId || null, module: moduleName, previousValue: result.result.previous, newValue: aiConfigId || null });
  return result.settings;
}

async function updateConnectionStatus(stores, aiConfigId, status, adminId) {
  const normalized = ['ok', 'invalid_key', 'permission_denied', 'model_unavailable', 'rate_limited', 'timeout', 'billing_required', 'provider_error'].includes(status) ? status : 'provider_error';
  const result = await updateSettings(stores.metadata, adminId, (settings) => {
    const item = settings.configs.find((candidate) => candidate.aiConfigId === aiConfigId);
    if (!item) throw aiError('AI_CONFIG_NOT_FOUND', 404);
    item.connectionStatus = normalized;
    item.lastTestedAt = new Date().toISOString();
    return { settings };
  });
  return result.settings;
}

async function deleteConfig(stores, aiConfigId, adminId) {
  const current = await readSettings(stores.metadata);
  const previous = current.settings.configs.find((item) => item.aiConfigId === aiConfigId);
  if (!previous) throw aiError('AI_CONFIG_NOT_FOUND', 404);
  await stores.secrets.delete(secretKey(aiConfigId));
  const result = await updateSettings(stores.metadata, adminId, (settings) => {
    settings.configs = settings.configs.filter((item) => item.aiConfigId !== aiConfigId);
    Object.keys(settings.moduleAssignments).forEach((moduleName) => {
      if (settings.moduleAssignments[moduleName] === aiConfigId) settings.moduleAssignments[moduleName] = null;
    });
    if (settings.configs.length && !settings.configs.some((item) => item.isDefault)) settings.configs[0].isDefault = true;
    return { settings };
  });
  await appendAudit(stores.metadata, { adminId, action: 'ai.config.removed', aiConfigId, previousValue: safeConfigSnapshot(previous), newValue: null });
  return result.settings;
}

function publicSettings(settings) {
  const normalized = normalizeSettings(settings);
  return {
    ...normalized,
    configs: normalized.configs.map(({ secretDigest: _secretDigest, ...item }) => item)
  };
}

function digestSecret(secret) {
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest('hex');
}

function secretMatchesConfig(config, secret) {
  if (!config || config.secretConfigured !== true || typeof secret !== 'string' || !secret) return false;
  if (config.secretDigest) {
    const actual = Buffer.from(digestSecret(secret), 'hex');
    const expected = Buffer.from(config.secretDigest, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  // Legacy records used the last four characters as their commit marker.
  // Missing both markers is an incomplete record, not permission to activate
  // whichever orphaned value happens to exist in the secret store.
  return Boolean(config.secretHint) && secret.endsWith(config.secretHint);
}

async function appendAudit(metadataStore, raw) {
  const timestamp = new Date().toISOString();
  const key = `audit/${String(9_999_999_999_999 - Date.now()).padStart(13, '0')}-${crypto.randomBytes(8).toString('hex')}.json`;
  const entry = {
    adminId: cleanString(raw.adminId, 160),
    action: cleanString(raw.action, 80),
    aiConfigId: cleanString(raw.aiConfigId, 96) || null,
    module: cleanString(raw.module, 40) || null,
    previousValue: raw.previousValue ?? null,
    newValue: raw.newValue ?? null,
    timestamp
  };
  await metadataStore.set(key, JSON.stringify(entry), { onlyIfNew: true, metadata: { action: entry.action, timestamp } });
}

async function listAudit(metadataStore, limit = 30) {
  const requested = Math.max(1, Math.min(100, Number(limit) || 30));
  const listing = metadataStore.list({ prefix: 'audit/', paginate: true });
  const pages = listing && typeof listing[Symbol.asyncIterator] === 'function' ? listing : [await listing];
  const keys = [];
  outer: for await (const page of pages) {
    const blobs = Array.isArray(page) ? page : Array.isArray(page?.blobs) ? page.blobs : [];
    for (const blob of blobs) {
      const key = typeof blob === 'string' ? blob : blob?.key;
      if (key) keys.push(key);
      if (keys.length >= requested) break outer;
    }
  }
  const entries = [];
  for (const key of keys) {
    const entry = await readEntry(metadataStore, key);
    if (entry && plainObject(entry.value)) entries.push(entry.value);
  }
  return entries;
}

function safeConfigSnapshot(config) {
  if (!config) return null;
  return { aiConfigId: config.aiConfigId, name: config.name, provider: config.provider, model: config.model, isDefault: config.isDefault, secretConfigured: config.secretConfigured };
}

function normalizeModelId(provider, model) {
  if (provider === 'gemini') return model.replace(/^models\//, '');
  return model;
}

function aiError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function cleanString(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

function isoOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  ENV_CONFIG_IDS,
  MODULES,
  PROVIDERS,
  appendAudit,
  deleteConfig,
  emptySettings,
  getAiStores,
  listAudit,
  normalizeSettings,
  publicSettings,
  readSecret,
  readSettings,
  removeConfigSecret,
  saveConfig,
  secretMatchesConfig,
  setConfigSecret,
  setDefaultConfig,
  setModuleAssignment,
  updateConnectionStatus,
  validateConfigInput,
  _test: {
    setStoreFactory(factory) { injectedStoreFactory = factory; },
    resetStoreFactory() { injectedStoreFactory = null; },
    secretKey
  }
};
