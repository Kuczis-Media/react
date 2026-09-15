'use strict';

const crypto = require('node:crypto');
const { getStore } = require('@netlify/blobs');
const { storageConfig } = require('./progress-storage.js');

const CONFIG_STORE_NAME = 'chemdisk-ai-limit-config';
const USAGE_STORE_NAME = 'chemdisk-ai-usage';
const SETTINGS_KEY = 'settings.json';
const GLOBAL_KEY = 'aggregate/global.json';
const PERIODS = Object.freeze(['hour', 'day', 'week', 'month', 'lifetime']);
const METRICS = Object.freeze([
  'requests', 'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostMicros'
]);
const USER_MODES = new Set(['inherit', 'custom', 'unlimited', 'disabled']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/;
const MAX_WRITE_RETRIES = 40;
const MAX_RECENT_EVENTS = 300;
const MAX_PENDING = 500;
const MAX_AGGREGATE_WINDOWS = 200;
const MAX_COMPLETION_ATTEMPTS = 3;
const RESERVATION_TTL_MS = 10 * 60 * 1000;
let injectedStoreFactory = null;

function getAiUsageStores() {
  if (injectedStoreFactory) return injectedStoreFactory();
  const config = storageConfig();
  if (!config) throw usageError('AI_LIMIT_STORAGE_UNAVAILABLE', 503);
  const options = { siteID: config.siteId, token: config.token, consistency: 'strong' };
  return {
    config: getStore({ name: CONFIG_STORE_NAME, ...options }),
    usage: getStore({ name: USAGE_STORE_NAME, ...options })
  };
}

function emptyLimitSet() {
  return Object.fromEntries(METRICS.map((metric) => [
    metric,
    Object.fromEntries(PERIODS.map((period) => [period, null]))
  ]));
}

function emptySettings() {
  return {
    version: 1,
    revision: 0,
    timezone: 'Europe/Warsaw',
    currency: 'USD',
    showUserLimits: true,
    warningThresholds: [70, 90, 100],
    global: emptyLimitSet(),
    defaultUser: emptyLimitSet(),
    providers: {},
    modules: {},
    configs: {},
    users: {},
    createdAt: null,
    updatedAt: null,
    updatedBy: null
  };
}

function normalizeSettings(raw, options = {}) {
  const strict = options.strict === true;
  const source = plainObject(raw) ? raw : {};
  const base = emptySettings();
  const timezone = cleanString(source.timezone, 80) || base.timezone;
  if (!validTimezone(timezone)) {
    if (strict) throw usageError('INVALID_AI_LIMIT_TIMEZONE', 400);
  } else base.timezone = timezone;
  const currency = cleanString(source.currency, 8).toUpperCase();
  if (currency) {
    if (!/^[A-Z]{3,8}$/.test(currency) && strict) throw usageError('INVALID_AI_LIMIT_CURRENCY', 400);
    if (/^[A-Z]{3,8}$/.test(currency)) base.currency = currency;
  }
  base.showUserLimits = source.showUserLimits !== false;
  base.warningThresholds = normalizeThresholds(source.warningThresholds, strict);
  base.global = normalizeLimitSet(source.global, strict);
  base.defaultUser = normalizeLimitSet(source.defaultUser, strict);
  base.providers = normalizeScopeMap(source.providers, strict, (value) => normalizeLimitSet(value, strict));
  base.modules = normalizeScopeMap(source.modules, strict, (value) => normalizeLimitSet(value, strict));
  base.configs = normalizeScopeMap(source.configs, strict, (value) => normalizeConfigPolicy(value, strict));
  base.users = normalizeScopeMap(source.users, strict, (value) => normalizeUserPolicy(value, strict));
  base.revision = safeNonNegativeInteger(source.revision, 0);
  base.createdAt = isoOrNull(source.createdAt);
  base.updatedAt = isoOrNull(source.updatedAt);
  base.updatedBy = cleanString(source.updatedBy, 160) || null;
  validateFallbackGraph(base.configs);
  return base;
}

function normalizeScopeMap(raw, strict, normalizer) {
  // IDs are administrator/user data. A null-prototype map prevents values such
  // as "toString" from resolving to inherited Object properties.
  const result = Object.create(null);
  if (!plainObject(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (!ID_PATTERN.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      if (strict) throw usageError('INVALID_AI_LIMIT_SCOPE_ID', 400);
      continue;
    }
    result[key] = normalizer(value);
  }
  return result;
}

function normalizeLimitSet(raw, strict = false) {
  const source = plainObject(raw) ? raw : {};
  const result = emptyLimitSet();
  for (const metric of METRICS) {
    const periods = plainObject(source[metric]) ? source[metric] : {};
    for (const period of PERIODS) result[metric][period] = normalizeLimit(periods[period], strict);
  }
  return result;
}

function normalizeLimit(value, strict) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    if (strict) throw usageError('INVALID_AI_LIMIT_VALUE', 400);
    return null;
  }
  return number;
}

function normalizeConfigPolicy(raw, strict) {
  const source = plainObject(raw) ? raw : {};
  return {
    global: normalizeLimitSet(source.global, strict),
    perUser: normalizeLimitSet(source.perUser, strict),
    pricing: {
      inputPerMillion: normalizePrice(source.pricing && source.pricing.inputPerMillion, strict),
      outputPerMillion: normalizePrice(source.pricing && source.pricing.outputPerMillion, strict)
    },
    fallbackConfigId: cleanOptionalId(source.fallbackConfigId, strict)
  };
}

function normalizeUserPolicy(raw, strict) {
  const source = plainObject(raw) ? raw : {};
  const mode = cleanString(source.mode, 20) || 'inherit';
  if (!USER_MODES.has(mode) && strict) throw usageError('INVALID_AI_USER_LIMIT_MODE', 400);
  return {
    mode: USER_MODES.has(mode) ? mode : 'inherit',
    limits: normalizeLimitSet(source.limits, strict)
  };
}

function normalizePrice(value, strict) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    if (strict) throw usageError('INVALID_AI_PRICING', 400);
    return null;
  }
  return Math.round(number * 1_000_000) / 1_000_000;
}

function cleanOptionalId(value, strict) {
  if (value == null || value === '') return null;
  const id = cleanString(value, 160);
  if (!ID_PATTERN.test(id) && strict) throw usageError('INVALID_AI_FALLBACK', 400);
  return ID_PATTERN.test(id) ? id : null;
}

function normalizeThresholds(raw, strict) {
  if (raw == null) return [70, 90, 100];
  if (!Array.isArray(raw) || raw.length !== 3) {
    if (strict) throw usageError('INVALID_AI_WARNING_THRESHOLDS', 400);
    return [70, 90, 100];
  }
  const values = raw.map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 100)
    || values[0] >= values[1] || values[1] >= values[2]) {
    if (strict) throw usageError('INVALID_AI_WARNING_THRESHOLDS', 400);
    return [70, 90, 100];
  }
  return values;
}

function validateFallbackGraph(configs, validConfigIds) {
  const allowed = validConfigIds ? new Set(validConfigIds) : null;
  for (const [id, policy] of Object.entries(configs)) {
    const fallback = policy.fallbackConfigId;
    if (!fallback) continue;
    if (fallback === id || (allowed && !allowed.has(fallback))) {
      throw usageError('INVALID_AI_FALLBACK', 400);
    }
    const visited = new Set([id]);
    let cursor = fallback;
    while (cursor) {
      if (visited.has(cursor)) throw usageError('AI_FALLBACK_CYCLE', 400);
      visited.add(cursor);
      cursor = configs[cursor] && configs[cursor].fallbackConfigId;
    }
  }
}

async function readSettings(configStore) {
  const entry = await readEntry(configStore, SETTINGS_KEY);
  return { settings: normalizeSettings(entry && entry.value), etag: entry && entry.etag || null };
}

function pruneStaleConfigPolicies(raw, staleConfigIds) {
  const stale = new Set(Array.from(staleConfigIds || [], (value) => String(value || '')).filter(Boolean));
  const next = structuredClone(plainObject(raw) ? raw : {});
  if (!stale.size || !plainObject(next.configs)) return next;
  stale.forEach((aiConfigId) => { delete next.configs[aiConfigId]; });
  Object.values(next.configs).forEach((policy) => {
    if (plainObject(policy) && stale.has(String(policy.fallbackConfigId || ''))) policy.fallbackConfigId = null;
  });
  return next;
}

async function saveSettings(stores, raw, adminId, validConfigIds = []) {
  const input = normalizeSettings(raw, { strict: true });
  const validIds = new Set(validConfigIds);
  if (Object.keys(input.configs).some((id) => !validIds.has(id))) {
    throw usageError('AI_CONFIG_NOT_FOUND', 404);
  }
  validateFallbackGraph(input.configs, validConfigIds);
  const result = await updateJson(stores.config, SETTINGS_KEY, emptySettings(), (current) => {
    const previous = normalizeSettings(current);
    const now = new Date().toISOString();
    return {
      value: {
        ...input,
        revision: previous.revision + 1,
        createdAt: previous.createdAt || now,
        updatedAt: now,
        updatedBy: cleanString(adminId, 160) || null
      },
      result: { previous }
    };
  }, (value) => ({ revision: String(value.revision), updatedAt: value.updatedAt }));
  await appendAudit(stores.config, {
    adminId,
    action: 'ai.limits.updated',
    previousValue: settingsAuditSnapshot(result.result.previous),
    newValue: settingsAuditSnapshot(result.value)
  });
  return result.value;
}

function settingsAuditSnapshot(settings) {
  return {
    revision: settings.revision,
    timezone: settings.timezone,
    currency: settings.currency,
    showUserLimits: settings.showUserLimits,
    warningThresholds: settings.warningThresholds
  };
}

function periodKeys(now = Date.now(), timezone = 'Europe/Warsaw') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimezone(timezone) ? timezone : 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(now)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    hour: `hour:${date}T${parts.hour}`,
    day: `day:${date}`,
    week: `week:${isoWeek(Number(parts.year), Number(parts.month), Number(parts.day))}`,
    month: `month:${parts.year}-${parts.month}`,
    lifetime: 'lifetime'
  };
}

function isoWeek(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - first) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function estimateRequest(input = {}, pricing = {}) {
  const textChars = String(input.system || '').length + (Array.isArray(input.messages) ? input.messages : [])
    .reduce((sum, message) => sum + String(message && message.content || '').length + 8, 0);
  const attachmentBytes = (Array.isArray(input.attachments) ? input.attachments : [])
    .reduce((sum, item) => sum + Math.floor(String(item && item.data || '').length * 0.75), 0);
  const inputTokens = Math.max(1, Math.ceil(textChars / 4) + Math.ceil(attachmentBytes / 768));
  const outputTokens = Number.isSafeInteger(input.maxOutputTokens) && input.maxOutputTokens >= 0
    ? input.maxOutputTokens : 4096;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostMicros: estimateCostMicros({ inputTokens, outputTokens }, pricing)
  };
}

function estimateCostMicros(usage, pricing = {}) {
  const inputPrice = finiteOrNull(pricing.inputPerMillion);
  const outputPrice = finiteOrNull(pricing.outputPerMillion);
  if (inputPrice == null || outputPrice == null) return null;
  return Math.max(0, Math.round(
    nonNegative(usage && usage.inputTokens) * inputPrice
    + nonNegative(usage && usage.outputTokens) * outputPrice
  ));
}

async function reserveRequest(stores, request, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const { settings } = options.settings
    ? { settings: normalizeSettings(options.settings) }
    : await readSettings(stores.config);
  const context = normalizeRequestContext(request);
  const userPolicy = settings.users[context.userId] || { mode: 'inherit', limits: emptyLimitSet() };
  if (userPolicy.mode === 'disabled') throw usageError('AI_DISABLED_FOR_USER', 403, { scope: 'user' });
  const configPolicy = settings.configs[context.aiConfigId] || normalizeConfigPolicy({}, false);
  const estimate = normalizeEstimate(request.estimate || estimateRequest(request, configPolicy.pricing));
  const keys = periodKeys(now, settings.timezone);
  const reservationId = crypto.randomUUID();
  const reservation = {
    reservationId,
    timestamp: new Date(now).toISOString(),
    userId: context.userId,
    moduleId: context.moduleId,
    aiConfigId: context.aiConfigId,
    provider: context.provider,
    model: context.model,
    keys,
    estimate,
    pricing: configPolicy.pricing
  };

  const globalChecks = [
    { scope: 'global', limits: settings.global, dimension: 'total' },
    { scope: 'provider', limits: settings.providers[context.provider], dimension: ['providers', context.provider] },
    { scope: 'config', limits: configPolicy.global, dimension: ['configs', context.aiConfigId] }
  ].filter((item) => item.limits);
  assertPricingAvailable(globalChecks, estimate);
  await updateJson(stores.usage, GLOBAL_KEY, emptyUsageDocument('global'), (raw) => {
    const document = normalizeUsageDocument(raw, 'global');
    purgeExpiredReservations(document, now);
    assertLimits(document, keys, globalChecks, estimate);
    applyReservation(document, reservation, 'add');
    document.revision += 1;
    document.updatedAt = new Date(now).toISOString();
    return { value: document };
  });

  const userLimits = userPolicy.mode === 'custom'
    ? userPolicy.limits
    : userPolicy.mode === 'unlimited' ? null : settings.defaultUser;
  const moduleLimits = settings.modules[context.moduleId]
    || (context.moduleId !== 'other' ? settings.modules.other : null);
  const userChecks = userPolicy.mode === 'unlimited' ? [] : [
    { scope: 'user', limits: userLimits, dimension: 'total' },
    { scope: 'module', limits: moduleLimits, dimension: ['modules', context.moduleId] },
    { scope: 'config', limits: configPolicy.perUser, dimension: ['configs', context.aiConfigId] }
  ].filter((item) => item.limits);
  try {
    assertPricingAvailable(userChecks, estimate);
    await updateJson(stores.usage, userKey(context.userId), emptyUsageDocument('user', context.userId), (raw) => {
      const document = normalizeUsageDocument(raw, 'user', context.userId);
      purgeExpiredReservations(document, now);
      assertLimits(document, keys, userChecks, estimate);
      applyReservation(document, reservation, 'add');
      document.revision += 1;
      document.updatedAt = new Date(now).toISOString();
      return { value: document };
    });
  } catch (error) {
    await rollbackReservation(stores.usage, GLOBAL_KEY, reservation, 'global').catch(() => {});
    throw error;
  }
  return { ...reservation, settingsRevision: settings.revision };
}

function assertPricingAvailable(checks, estimate) {
  if (estimate.estimatedCostMicros != null) return;
  if (checks.some((check) => hasAnyLimit(check.limits, 'estimatedCostMicros'))) {
    throw usageError('AI_COST_ESTIMATE_UNAVAILABLE', 503, { metric: 'estimatedCostMicros' });
  }
}

function assertLimits(document, keys, checks, estimate) {
  for (const check of checks) {
    for (const period of PERIODS) {
      const bucket = ensureWindow(document, keys[period]);
      const metrics = dimensionMetrics(bucket, check.dimension);
      for (const metric of METRICS) {
        const limit = check.limits[metric][period];
        if (limit == null) continue;
        const projected = projectedMetric(metrics, metric, estimate);
        // In the editor an explicit zero means "block this scope now" for
        // every metric. This must also hold for a rounded-to-zero cost estimate.
        if (limit === 0 || projected > limit) {
          const used = currentMetric(metrics, metric);
          throw limitError(check.scope, period, metric, limit, used);
        }
      }
    }
  }
}

function limitError(scope, period, metric, limit, used) {
  const metricName = metric === 'requests' ? ''
    : metric === 'inputTokens' ? '_INPUT_TOKEN'
      : metric === 'outputTokens' ? '_OUTPUT_TOKEN'
        : metric === 'totalTokens' ? '_TOKEN' : '_COST';
  const code = `AI_${scope.toUpperCase()}_${period.toUpperCase()}${metricName}_LIMIT_REACHED`;
  return usageError(code, 429, {
    scope,
    period,
    metric,
    limit,
    used,
    remaining: Math.max(0, limit - used)
  });
}

async function completeReservation(stores, reservation, outcome = {}, options = {}) {
  if (!reservation || !reservation.reservationId) throw usageError('AI_RESERVATION_INVALID', 500);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const actual = normalizeProviderUsage(outcome.usage);
  const canEstimateActualCost = actual
    && Number.isSafeInteger(outcome.usage && outcome.usage.inputTokens)
    && Number.isSafeInteger(outcome.usage && outcome.usage.outputTokens);
  const estimatedCostMicros = canEstimateActualCost
    ? estimateCostMicros(actual, reservation.pricing)
    : outcome.success === true ? reservation.estimate.estimatedCostMicros : null;
  const completion = {
    success: outcome.success === true,
    errorCode: outcome.success === true ? null : cleanString(outcome.errorCode, 100) || 'AI_PROVIDER_ERROR',
    usage: actual,
    estimatedCostMicros,
    completedAt: new Date(now).toISOString()
  };
  let lastError = null;
  for (let attempt = 0; attempt < MAX_COMPLETION_ATTEMPTS; attempt += 1) {
    try {
      // Both writes are idempotent by reservationId. Retrying the pair repairs
      // the only possible partial state without ever calling the provider again.
      await completeDocument(stores.usage, GLOBAL_KEY, 'global', null, reservation, completion, true);
      await completeDocument(stores.usage, userKey(reservation.userId), 'user', reservation.userId, reservation, completion, false);
      return completion;
    } catch (error) {
      lastError = error;
    }
  }
  const wrapped = usageError('AI_USAGE_RECORD_FAILED', 503);
  wrapped.cause = lastError;
  throw wrapped;
}

async function completeDocument(store, key, kind, userId, reservation, completion, keepRecent) {
  await updateJson(store, key, emptyUsageDocument(kind, userId), (raw) => {
    const document = normalizeUsageDocument(raw, kind, userId);
    if (!document.pending[reservation.reservationId]) return { abort: true, result: { duplicate: true } };
    applyCompletion(document, reservation, completion);
    delete document.pending[reservation.reservationId];
    if (keepRecent) {
      document.recent.unshift({
        userId: reservation.userId,
        moduleId: reservation.moduleId,
        aiConfigId: reservation.aiConfigId,
        provider: reservation.provider,
        model: reservation.model,
        timestamp: reservation.timestamp,
        completedAt: completion.completedAt,
        success: completion.success,
        errorCode: completion.errorCode,
        inputTokens: completion.usage && completion.usage.inputTokens,
        outputTokens: completion.usage && completion.usage.outputTokens,
        totalTokens: completion.usage && completion.usage.totalTokens,
        estimatedCostMicros: completion.estimatedCostMicros
      });
      document.recent = document.recent.slice(0, MAX_RECENT_EVENTS);
    }
    document.revision += 1;
    document.updatedAt = completion.completedAt;
    return { value: document };
  });
}

async function rollbackReservation(store, key, reservation, kind) {
  await updateJson(store, key, emptyUsageDocument(kind, reservation.userId), (raw) => {
    const document = normalizeUsageDocument(raw, kind, reservation.userId);
    if (!document.pending[reservation.reservationId]) return { abort: true };
    applyReservation(document, reservation, 'remove');
    document.revision += 1;
    document.updatedAt = new Date().toISOString();
    return { value: document };
  });
}

function applyReservation(document, reservation, direction) {
  const delta = direction === 'add' ? 1 : -1;
  const dimensions = document.kind === 'global'
    ? ['total', ['modules', reservation.moduleId], ['providers', reservation.provider], ['configs', reservation.aiConfigId], ['models', reservation.model]]
    : ['total', ['modules', reservation.moduleId], ['providers', reservation.provider], ['configs', reservation.aiConfigId], ['models', reservation.model]];
  for (const key of Object.values(reservation.keys)) {
    const bucket = ensureWindow(document, key);
    for (const dimension of dimensions) {
      const metrics = dimensionMetrics(bucket, dimension);
      metrics.requests = Math.max(0, metrics.requests + delta);
      metrics.reservedInputTokens = Math.max(0, metrics.reservedInputTokens + delta * reservation.estimate.inputTokens);
      metrics.reservedOutputTokens = Math.max(0, metrics.reservedOutputTokens + delta * reservation.estimate.outputTokens);
      metrics.reservedTotalTokens = Math.max(0, metrics.reservedTotalTokens + delta * reservation.estimate.totalTokens);
      if (reservation.estimate.estimatedCostMicros != null) {
        metrics.reservedCostMicros = Math.max(0, metrics.reservedCostMicros + delta * reservation.estimate.estimatedCostMicros);
      }
    }
  }
  if (direction === 'add') {
    document.pending[reservation.reservationId] = {
      createdAt: reservation.timestamp,
      keys: reservation.keys,
      estimate: reservation.estimate,
      moduleId: reservation.moduleId,
      provider: reservation.provider,
      aiConfigId: reservation.aiConfigId,
      model: reservation.model
    };
    trimPending(document);
  } else delete document.pending[reservation.reservationId];
}

function applyCompletion(document, reservation, completion) {
  const dimensions = ['total', ['modules', reservation.moduleId], ['providers', reservation.provider], ['configs', reservation.aiConfigId], ['models', reservation.model]];
  for (const key of Object.values(reservation.keys)) {
    const bucket = ensureWindow(document, key);
    for (const dimension of dimensions) {
      const metrics = dimensionMetrics(bucket, dimension);
      metrics.reservedInputTokens = Math.max(0, metrics.reservedInputTokens - reservation.estimate.inputTokens);
      metrics.reservedOutputTokens = Math.max(0, metrics.reservedOutputTokens - reservation.estimate.outputTokens);
      metrics.reservedTotalTokens = Math.max(0, metrics.reservedTotalTokens - reservation.estimate.totalTokens);
      if (reservation.estimate.estimatedCostMicros != null) {
        metrics.reservedCostMicros = Math.max(0, metrics.reservedCostMicros - reservation.estimate.estimatedCostMicros);
      }
      if (completion.usage) {
        metrics.inputTokens += completion.usage.inputTokens;
        metrics.outputTokens += completion.usage.outputTokens;
        metrics.totalTokens += completion.usage.totalTokens;
      }
      if (completion.estimatedCostMicros != null) metrics.estimatedCostMicros += completion.estimatedCostMicros;
      if (completion.success) metrics.successfulRequests += 1;
      else metrics.errors += 1;
    }
  }
}

function purgeExpiredReservations(document, now) {
  for (const [id, pending] of Object.entries(document.pending)) {
    const timestamp = Date.parse(pending.createdAt || '');
    if (Number.isFinite(timestamp) && timestamp + RESERVATION_TTL_MS > now) continue;
    const reservation = {
      reservationId: id,
      keys: pending.keys || {},
      estimate: normalizeEstimate(pending.estimate),
      moduleId: pending.moduleId || 'other',
      provider: pending.provider || 'unknown',
      aiConfigId: pending.aiConfigId || 'unknown',
      model: pending.model || 'unknown'
    };
    for (const key of Object.values(reservation.keys)) {
      const bucket = ensureWindow(document, key);
      for (const dimension of ['total', ['modules', reservation.moduleId], ['providers', reservation.provider], ['configs', reservation.aiConfigId], ['models', reservation.model]]) {
        const metrics = dimensionMetrics(bucket, dimension);
        metrics.reservedInputTokens = Math.max(0, metrics.reservedInputTokens - reservation.estimate.inputTokens);
        metrics.reservedOutputTokens = Math.max(0, metrics.reservedOutputTokens - reservation.estimate.outputTokens);
        metrics.reservedTotalTokens = Math.max(0, metrics.reservedTotalTokens - reservation.estimate.totalTokens);
        if (reservation.estimate.estimatedCostMicros != null) metrics.reservedCostMicros = Math.max(0, metrics.reservedCostMicros - reservation.estimate.estimatedCostMicros);
      }
    }
    delete document.pending[id];
  }
  retainCurrentWindows(document, now);
}

function retainCurrentWindows(document, now) {
  void now;
  // Bounded aggregate retention: enough hourly detail for two days, daily
  // history for a quarter and monthly history for trend reports.
  const caps = { hour: 48, day: 90, week: 26, month: 18, lifetime: 1 };
  for (const [prefix, cap] of Object.entries(caps)) {
    Object.keys(document.windows)
      .filter((key) => key === prefix || key.startsWith(`${prefix}:`))
      .sort().reverse().slice(cap)
      .forEach((key) => delete document.windows[key]);
  }
}

function emptyUsageDocument(kind, userId = null) {
  return {
    version: 1,
    revision: 0,
    kind,
    userId: userId || null,
    windows: {},
    pending: {},
    recent: [],
    createdAt: new Date().toISOString(),
    updatedAt: null
  };
}

function normalizeUsageDocument(raw, kind, userId = null) {
  const source = plainObject(raw) ? raw : {};
  const document = emptyUsageDocument(kind, userId);
  document.revision = safeNonNegativeInteger(source.revision, 0);
  document.createdAt = isoOrNull(source.createdAt) || document.createdAt;
  document.updatedAt = isoOrNull(source.updatedAt);
  if (plainObject(source.windows)) {
    for (const [key, value] of Object.entries(source.windows).slice(-MAX_AGGREGATE_WINDOWS)) {
      if (/^(?:hour|day|week|month):[A-Za-z0-9:T-]+$/.test(key) || key === 'lifetime') document.windows[key] = normalizeWindow(value);
    }
  }
  if (plainObject(source.pending)) {
    for (const [id, value] of Object.entries(source.pending).slice(-MAX_PENDING)) {
      if (/^[A-Fa-f0-9-]{20,50}$/.test(id) && plainObject(value)) document.pending[id] = value;
    }
  }
  document.recent = Array.isArray(source.recent) ? source.recent.filter(plainObject).slice(0, MAX_RECENT_EVENTS) : [];
  return document;
}

function normalizeWindow(raw) {
  const source = plainObject(raw) ? raw : {};
  return {
    total: normalizeMetrics(source.total),
    modules: normalizeDimensionMap(source.modules),
    providers: normalizeDimensionMap(source.providers),
    configs: normalizeDimensionMap(source.configs),
    models: normalizeDimensionMap(source.models)
  };
}

function normalizeDimensionMap(raw) {
  const result = Object.create(null);
  if (!plainObject(raw)) return result;
  for (const [key, value] of Object.entries(raw).slice(0, 500)) {
    if (ID_PATTERN.test(key)) result[key] = normalizeMetrics(value);
  }
  return result;
}

function emptyMetrics() {
  return {
    requests: 0,
    successfulRequests: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostMicros: 0,
    reservedInputTokens: 0,
    reservedOutputTokens: 0,
    reservedTotalTokens: 0,
    reservedCostMicros: 0
  };
}

function normalizeMetrics(raw) {
  const source = plainObject(raw) ? raw : {};
  const metrics = emptyMetrics();
  for (const key of Object.keys(metrics)) metrics[key] = nonNegative(source[key]);
  return metrics;
}

function ensureWindow(document, key) {
  if (!document.windows[key]) document.windows[key] = normalizeWindow({});
  return document.windows[key];
}

function dimensionMetrics(window, dimension) {
  if (dimension === 'total') return window.total;
  const [group, id] = dimension;
  if (!Object.prototype.hasOwnProperty.call(window[group], id)) window[group][id] = emptyMetrics();
  return window[group][id];
}

function projectedMetric(metrics, metric, estimate) {
  if (metric === 'requests') return metrics.requests + 1;
  if (metric === 'inputTokens') return metrics.inputTokens + metrics.reservedInputTokens + estimate.inputTokens;
  if (metric === 'outputTokens') return metrics.outputTokens + metrics.reservedOutputTokens + estimate.outputTokens;
  if (metric === 'totalTokens') return metrics.totalTokens + metrics.reservedTotalTokens + estimate.totalTokens;
  return metrics.estimatedCostMicros + metrics.reservedCostMicros + (estimate.estimatedCostMicros || 0);
}

function currentMetric(metrics, metric) {
  if (metric === 'requests') return metrics.requests;
  if (metric === 'inputTokens') return metrics.inputTokens + metrics.reservedInputTokens;
  if (metric === 'outputTokens') return metrics.outputTokens + metrics.reservedOutputTokens;
  if (metric === 'totalTokens') return metrics.totalTokens + metrics.reservedTotalTokens;
  return metrics.estimatedCostMicros + metrics.reservedCostMicros;
}

function normalizeRequestContext(raw) {
  const userId = cleanString(raw && raw.userId, 160);
  const moduleId = cleanString(raw && (raw.moduleId || raw.module), 160) || 'other';
  const aiConfigId = cleanString(raw && raw.aiConfigId, 160);
  const provider = cleanString(raw && raw.provider, 160);
  const model = cleanString(raw && raw.model, 160);
  if (![userId, moduleId, aiConfigId, provider, model].every((value) => ID_PATTERN.test(value))) {
    throw usageError('AI_USAGE_CONTEXT_INVALID', 500);
  }
  return { userId, moduleId, aiConfigId, provider, model };
}

function normalizeEstimate(raw) {
  return {
    inputTokens: nonNegative(raw && raw.inputTokens),
    outputTokens: nonNegative(raw && raw.outputTokens),
    totalTokens: nonNegative(raw && raw.totalTokens),
    estimatedCostMicros: raw && raw.estimatedCostMicros != null ? nonNegative(raw.estimatedCostMicros) : null
  };
}

function normalizeProviderUsage(raw) {
  if (!plainObject(raw)) return null;
  if (![raw.inputTokens, raw.outputTokens, raw.totalTokens].some((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  const inputTokens = nonNegative(raw.inputTokens);
  const outputTokens = nonNegative(raw.outputTokens);
  const suppliedTotal = nonNegative(raw.totalTokens);
  return { inputTokens, outputTokens, totalTokens: suppliedTotal || inputTokens + outputTokens };
}

async function readReport(stores, options = {}) {
  const { settings } = await readSettings(stores.config);
  const period = PERIODS.includes(options.period) ? options.period : 'day';
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const key = periodKeys(now, settings.timezone)[period];
  const globalEntry = await readEntry(stores.usage, GLOBAL_KEY);
  const globalDocument = normalizeUsageDocument(globalEntry && globalEntry.value, 'global');
  const window = globalDocument.windows[key] || normalizeWindow({});
  const listing = await listUserDocuments(stores.usage, options);
  const users = listing.documents
    .map((document) => userReportRow(settings, document, period, now))
    .sort((a, b) => b.requests - a.requests);
  return {
    period,
    key,
    timezone: settings.timezone,
    currency: settings.currency,
    totals: publicMetrics(window.total),
    providers: dimensionRows(window.providers),
    modules: dimensionRows(window.modules),
    configs: dimensionRows(window.configs),
    models: dimensionRows(window.models),
    users,
    recent: globalDocument.recent.slice(0, Math.max(1, Math.min(100, Number(options.recentLimit) || 50))),
    cursor: listing.cursor
  };
}

async function readUsersReport(stores, userIds, options = {}) {
  const rawIds = Array.isArray(userIds) ? userIds : [];
  if (rawIds.length > 50) throw usageError('INVALID_AI_USAGE_USERS', 400);
  const ids = [];
  const seen = new Set();
  for (const raw of rawIds) {
    const id = cleanString(raw, 160);
    if (!ID_PATTERN.test(id)) throw usageError('INVALID_AI_USAGE_USER', 400);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const { settings } = await readSettings(stores.config);
  const period = PERIODS.includes(options.period) ? options.period : 'day';
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const users = await Promise.all(ids.map(async (userId) => {
    const entry = await readEntry(stores.usage, userKey(userId));
    const document = normalizeUsageDocument(entry && entry.value, 'user', userId);
    return userReportRow(settings, document, period, now);
  }));
  return {
    period,
    key: periodKeys(now, settings.timezone)[period],
    timezone: settings.timezone,
    currency: settings.currency,
    users
  };
}

function userReportRow(settings, document, period, now) {
  const keys = periodKeys(now, settings.timezone);
  const userWindow = document.windows[keys[period]] || normalizeWindow({});
  const limits = effectiveUserLimits(settings, document.userId);
  const warning = warningLevel(userWindow.total, limits, period, settings.warningThresholds);
  const mode = (settings.users[document.userId] || {}).mode || 'inherit';
  return {
    userId: document.userId,
    mode,
    ...publicMetrics(userWindow.total),
    limit: limits ? limits.requests[period] : null,
    usagePercent: warning && warning.percent || 0,
    warning,
    periods: Object.fromEntries(PERIODS.map((name) => [
      name,
      publicMetrics((document.windows[keys[name]] || normalizeWindow({})).total)
    ])),
    breakdown: {
      providers: dimensionRows(userWindow.providers),
      modules: dimensionRows(userWindow.modules),
      configs: dimensionRows(userWindow.configs),
      models: dimensionRows(userWindow.models)
    }
  };
}

async function readOwnUsage(stores, userId, options = {}) {
  const { settings } = await readSettings(stores.config);
  if (!settings.showUserLimits) return { visible: false };
  const entry = await readEntry(stores.usage, userKey(userId));
  const document = normalizeUsageDocument(entry && entry.value, 'user', userId);
  const keys = periodKeys(Number.isFinite(options.now) ? options.now : Date.now(), settings.timezone);
  const limits = effectiveUserLimits(settings, userId);
  const periods = Object.fromEntries(PERIODS.map((period) => {
    const metrics = publicMetrics((document.windows[keys[period]] || normalizeWindow({})).total);
    return [period, { key: keys[period], usage: metrics, limits: Object.fromEntries(METRICS.map((metric) => [metric, limits ? limits[metric][period] : null])), warning: warningLevel(metrics, limits, period, settings.warningThresholds) }];
  }));
  return { visible: true, timezone: settings.timezone, currency: settings.currency, mode: (settings.users[userId] || {}).mode || 'inherit', periods };
}

function effectiveUserLimits(settings, userId) {
  const policy = settings.users[userId];
  if (!policy || policy.mode === 'inherit') return settings.defaultUser;
  if (policy.mode === 'custom') return policy.limits;
  return null;
}

async function resetUserUsage(stores, userId, adminId) {
  const id = cleanString(userId, 160);
  if (!ID_PATTERN.test(id)) throw usageError('INVALID_AI_USAGE_USER', 400);
  const key = userKey(id);
  const result = await updateJson(stores.usage, key, emptyUsageDocument('user', id), (raw) => {
    const previous = normalizeUsageDocument(raw, 'user', id);
    purgeExpiredReservations(previous, Date.now());
    if (Object.keys(previous.pending).length) throw usageError('AI_USAGE_RESET_BUSY', 409);
    const next = emptyUsageDocument('user', id);
    next.revision = previous.revision + 1;
    next.updatedAt = new Date().toISOString();
    return { value: next, result: { previousRevision: previous.revision } };
  });
  await appendAudit(stores.config, { adminId, action: 'ai.usage.user.reset', targetUserId: id, previousValue: result.result, newValue: { revision: result.value.revision } });
  return { userId: id, resetAt: result.value.updatedAt };
}

async function appendAudit(store, raw) {
  const timestamp = new Date().toISOString();
  const entry = {
    adminId: cleanString(raw.adminId, 160),
    targetUserId: cleanString(raw.targetUserId, 160) || null,
    action: cleanString(raw.action, 80),
    previousValue: raw.previousValue ?? null,
    newValue: raw.newValue ?? null,
    timestamp
  };
  const key = `audit/${String(9_999_999_999_999 - Date.now()).padStart(13, '0')}-${crypto.randomBytes(8).toString('hex')}.json`;
  const result = await store.set(key, JSON.stringify(entry), { onlyIfNew: true, metadata: { action: entry.action, timestamp } });
  if (!result || result.modified !== true) throw usageError('AI_AUDIT_WRITE_FAILED', 503);
  return entry;
}

async function listAudit(store, limit = 50) {
  const requested = Math.max(1, Math.min(100, Number(limit) || 50));
  const listing = await store.list({ prefix: 'audit/', paginate: true });
  const pages = listing && typeof listing[Symbol.asyncIterator] === 'function' ? listing : [await listing];
  const result = [];
  outer: for await (const page of pages) {
    for (const blob of Array.isArray(page) ? page : page && Array.isArray(page.blobs) ? page.blobs : []) {
      const key = typeof blob === 'string' ? blob : blob.key;
      const entry = key && await readEntry(store, key);
      if (entry && plainObject(entry.value)) result.push(entry.value);
      if (result.length >= requested) break outer;
    }
  }
  return result;
}

async function listUserDocuments(store, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
  const cursorMatch = String(options.cursor || '').match(/^offset:(\d{1,9})$/);
  const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
  const listing = await store.list({ prefix: 'users/', paginate: true });
  const pages = listing && typeof listing[Symbol.asyncIterator] === 'function' ? listing : [await listing];
  const keys = [];
  let seen = 0;
  let hasMore = false;
  outer: for await (const page of pages) {
    for (const blob of Array.isArray(page) ? page : page && Array.isArray(page.blobs) ? page.blobs : []) {
      const key = typeof blob === 'string' ? blob : blob.key;
      if (!key) continue;
      if (seen++ < offset) continue;
      if (keys.length >= limit) { hasMore = true; break outer; }
      keys.push(key);
    }
  }
  const documents = [];
  for (const key of keys) {
    const entry = await readEntry(store, key);
    if (entry) documents.push(normalizeUsageDocument(entry.value, 'user', entry.value && entry.value.userId));
  }
  return { documents, cursor: hasMore ? `offset:${offset + keys.length}` : null };
}

function dimensionRows(raw) {
  return Object.entries(raw || {}).map(([id, metrics]) => {
    const row = { id, ...publicMetrics(metrics) };
    row.avgTokensPerRequest = row.requests ? Math.round(row.totalTokens / row.requests) : 0;
    return row;
  }).sort((a, b) => b.requests - a.requests);
}

function publicMetrics(raw) {
  const metrics = normalizeMetrics(raw);
  return Object.fromEntries(Object.entries(metrics).filter(([key]) => !key.startsWith('reserved')));
}

function warningLevel(metrics, limits, period, thresholds) {
  if (!limits) return null;
  let maximum = 0;
  for (const metric of METRICS) {
    const limit = limits[metric][period];
    if (limit == null) continue;
    if (limit === 0) return { level: 'limit', percent: 100 };
    maximum = Math.max(maximum, Math.round((currentMetric(normalizeMetrics(metrics), metric) / limit) * 100));
  }
  if (maximum >= thresholds[2]) return { level: 'limit', percent: maximum };
  if (maximum >= thresholds[1]) return { level: 'critical', percent: maximum };
  if (maximum >= thresholds[0]) return { level: 'warning', percent: maximum };
  return maximum ? { level: 'ok', percent: maximum } : null;
}

function userKey(userId) {
  return `users/${Buffer.from(String(userId || ''), 'utf8').toString('base64url')}.json`;
}

async function readEntry(store, key) {
  const entry = await store.getWithMetadata(key, { type: 'text', consistency: 'strong' });
  if (!entry) return null;
  if (typeof entry.data !== 'string' || !entry.etag) throw usageError('AI_LIMIT_STORAGE_INVALID', 503);
  try { return { value: JSON.parse(entry.data), etag: entry.etag }; }
  catch { throw usageError('AI_LIMIT_STORAGE_INVALID', 503); }
}

async function updateJson(store, key, initialValue, updater, metadataFactory) {
  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt += 1) {
    const current = await readEntry(store, key);
    const outcome = await updater(current ? current.value : structuredClone(initialValue), current, attempt);
    if (outcome && outcome.abort) return { ...outcome, modified: false };
    const value = outcome && Object.prototype.hasOwnProperty.call(outcome, 'value') ? outcome.value : outcome;
    const metadata = typeof metadataFactory === 'function' ? metadataFactory(value) : metadataFactory || {};
    const result = await store.set(key, JSON.stringify(value), {
      ...(current ? { onlyIfMatch: current.etag } : { onlyIfNew: true }), metadata
    });
    if (result && result.modified === true) return { modified: true, value, result: outcome && outcome.result };
  }
  throw usageError('AI_LIMIT_CONFLICT', 409);
}

function trimPending(document) {
  const entries = Object.entries(document.pending);
  if (entries.length > MAX_PENDING) throw usageError('AI_CONCURRENT_REQUEST_LIMIT_REACHED', 429);
}

function hasAnyLimit(limits, metric) {
  return limits && PERIODS.some((period) => limits[metric][period] != null);
}

function validTimezone(value) {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
  catch { return false; }
}

function safeNonNegativeInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
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

function usageError(code, status, details) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

module.exports = {
  CONFIG_STORE_NAME,
  GLOBAL_KEY,
  METRICS,
  PERIODS,
  SETTINGS_KEY,
  USAGE_STORE_NAME,
  appendAudit,
  completeReservation,
  emptyLimitSet,
  emptySettings,
  estimateCostMicros,
  estimateRequest,
  getAiUsageStores,
  listAudit,
  normalizeLimitSet,
  normalizeSettings,
  periodKeys,
  readOwnUsage,
  readReport,
  readUsersReport,
  readSettings,
  pruneStaleConfigPolicies,
  reserveRequest,
  resetUserUsage,
  saveSettings,
  validateFallbackGraph,
  _test: {
    emptyUsageDocument,
    normalizeUsageDocument,
    readEntry,
    setStoreFactory(factory) { injectedStoreFactory = typeof factory === 'function' ? factory : null; },
    resetStoreFactory() { injectedStoreFactory = null; },
    updateJson,
    userKey
  }
};
