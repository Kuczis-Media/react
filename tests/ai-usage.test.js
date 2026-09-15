'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const usage = require('../netlify/ai-usage.js');
const manager = require('../netlify/ai-provider-manager.js');
const router = require('../netlify/ai-router.js');
const ownUsageEndpoint = require('../netlify/functions/ai-usage.js');
const adminUsageEndpoint = require('../netlify/functions/admin-ai-usage.js');
const fs = require('node:fs');
const path = require('node:path');

class MemoryStore {
  constructor() { this.entries = new Map(); this.revision = 0; }
  async getWithMetadata(key) {
    const entry = this.entries.get(key);
    return entry ? { data: entry.data, etag: entry.etag, metadata: entry.metadata || {} } : null;
  }
  async get(key) { return this.entries.get(key)?.data ?? null; }
  async set(key, data, options = {}) {
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && (!current || current.etag !== options.onlyIfMatch)) return { modified: false };
    this.revision += 1;
    this.entries.set(key, { data, etag: `etag-${this.revision}`, metadata: options.metadata || {} });
    return { modified: true, etag: `etag-${this.revision}` };
  }
  async delete(key) { this.entries.delete(key); }
  async list(options = {}) {
    return { blobs: Array.from(this.entries.keys()).filter((key) => key.startsWith(options.prefix || '')).sort().map((key) => ({ key })) };
  }
}

function usageStores() { return { config: new MemoryStore(), usage: new MemoryStore() }; }
function providerStores() { return { metadata: new MemoryStore(), secrets: new MemoryStore() }; }
function request(overrides = {}) {
  return {
    userId: 'user-1', moduleId: 'chat', aiConfigId: 'ai-primary',
    provider: 'gemini', model: 'gemini-test',
    estimate: { inputTokens: 20, outputTokens: 30, totalTokens: 50, estimatedCostMicros: 10 },
    ...overrides
  };
}

test.afterEach(() => {
  usage._test.resetStoreFactory();
  manager._test.resetStoreFactory();
});

test('AI limit settings cover all metrics, periods, timezone and configurable pricing', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.timezone = 'America/New_York';
  settings.currency = 'PLN';
  settings.warningThresholds = [65, 85, 100];
  settings.global.requests.hour = 10;
  settings.defaultUser.totalTokens.month = 50_000;
  settings.configs['ai-primary'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: 2.5, outputPerMillion: 7.5 }, fallbackConfigId: null
  };
  const saved = await usage.saveSettings(stores, settings, 'admin-1', ['ai-primary']);
  assert.equal(saved.timezone, 'America/New_York');
  assert.equal(saved.global.requests.hour, 10);
  assert.equal(saved.defaultUser.totalTokens.month, 50_000);
  assert.equal(saved.configs['ai-primary'].pricing.outputPerMillion, 7.5);
  assert.equal(usage.estimateCostMicros({ inputTokens: 1000, outputTokens: 2000 }, saved.configs['ai-primary'].pricing), 17_500);
  assert.throws(() => usage.normalizeSettings({ timezone: 'Mars/Olympus' }, { strict: true }), /INVALID_AI_LIMIT_TIMEZONE/);
});

test('admin and student interfaces expose AI limits without a client-side security counter', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/members/module/studio/manage/index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public/members/module/studio/manage/management.js'), 'utf8');
  const chatHtml = fs.readFileSync(path.join(root, 'public/members/module/chat/index.html'), 'utf8');
  const chatScript = fs.readFileSync(path.join(root, 'public/members/module/chat/script.js'), 'utf8');
  assert.match(html, /data-admin-tab="ai-usage"/);
  assert.match(html, /id="admin-ai-limit-grid"/);
  assert.match(html, /id="admin-ai-users-search"/);
  assert.match(html, /Każdy użytkownik — limit bazowy/);
  assert.match(html, /Konfiguracja — na użytkownika/);
  assert.match(html, /id="admin-ai-usage-period"[\s\S]*value="hour"/);
  assert.match(dashboard, /admin-ai-usage/);
  assert.match(dashboard, /Limit bazowy/);
  assert.match(fs.readFileSync(path.join(root, 'public/members/dashboard.js'), 'utf8'), /billing_required/);
  assert.match(dashboard, /view=users/);
  assert.match(chatHtml, /id="ai-own-usage"/);
  assert.match(chatScript, /\.netlify\/functions\/ai-usage/);
  assert.match(chatScript, /'hour', 'day', 'week', 'month', 'lifetime'/);
  assert.match(chatScript, /AI_CREDIT_BALANCE_EXHAUSTED/);
  assert.doesNotMatch(chatScript, /USER_RATE_LIMIT|userRateBuckets/);
});

test('logical time buckets respect the configured timezone and ISO weeks', () => {
  const timestamp = Date.parse('2026-01-01T00:30:00Z');
  const warsaw = usage.periodKeys(timestamp, 'Europe/Warsaw');
  const newYork = usage.periodKeys(timestamp, 'America/New_York');
  assert.equal(warsaw.day, 'day:2026-01-01');
  assert.equal(newYork.day, 'day:2025-12-31');
  assert.match(warsaw.week, /^week:2026-W01$/);
  assert.equal(warsaw.lifetime, 'lifetime');
});

test('CAS reservations prevent twenty simultaneous requests from exceeding a limit of ten', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.global.requests.day = 10;
  await usage.saveSettings(stores, settings, 'admin', []);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => usage.reserveRequest(stores, request({ userId: `user-${index}` }))));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 10);
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(rejected.length, 10);
  assert.equal(rejected.every((result) => result.reason.code === 'AI_GLOBAL_DAY_LIMIT_REACHED'), true);
  const report = await usage.readReport(stores, { period: 'day' });
  assert.equal(report.totals.requests, 10);
});

test('all applicable global, provider, module, config and per-user limits are checked', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.providers.gemini = usage.emptyLimitSet();
  settings.modules.chat = usage.emptyLimitSet();
  settings.configs['ai-primary'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: 1, outputPerMillion: 1 }, fallbackConfigId: null
  };
  settings.users['user-1'] = { mode: 'custom', limits: usage.emptyLimitSet() };
  settings.providers.gemini.requests.day = 1;
  await usage.saveSettings(stores, settings, 'admin', ['ai-primary']);
  const reserved = await usage.reserveRequest(stores, request());
  await usage.completeReservation(stores, reserved, { success: true, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } });
  await assert.rejects(usage.reserveRequest(stores, request()), (error) => error.code === 'AI_PROVIDER_DAY_LIMIT_REACHED');

  const next = structuredClone(settings);
  next.providers.gemini.requests.day = null;
  next.modules.chat.inputTokens.day = 21;
  await usage.saveSettings(stores, next, 'admin', ['ai-primary']);
  await assert.rejects(usage.reserveRequest(stores, request()), (error) => error.code === 'AI_MODULE_DAY_INPUT_TOKEN_LIMIT_REACHED');
});

test('usage detail contains required routing and token fields but never stores prompts', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.configs['ai-primary'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: 2, outputPerMillion: 4 }, fallbackConfigId: null
  };
  await usage.saveSettings(stores, settings, 'admin', ['ai-primary']);
  const reservation = await usage.reserveRequest(stores, request({ prompt: 'NIE ZAPISUJ TEGO' }));
  await usage.completeReservation(stores, reservation, { success: true, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
  const report = await usage.readReport(stores, { period: 'day' });
  assert.equal(report.totals.requests, 1);
  assert.equal(report.totals.totalTokens, 150);
  assert.equal(report.recent[0].userId, 'user-1');
  assert.equal(report.recent[0].moduleId, 'chat');
  assert.equal(report.recent[0].aiConfigId, 'ai-primary');
  assert.equal(report.recent[0].provider, 'gemini');
  assert.equal(report.recent[0].model, 'gemini-test');
  assert.equal(report.recent[0].success, true);
  assert.equal(JSON.stringify(Array.from(stores.usage.entries.values())).includes('NIE ZAPISUJ TEGO'), false);
});

test('usage completion repairs a transient partial global/user write without a second provider call', async () => {
  const stores = usageStores();
  const reservation = await usage.reserveRequest(stores, request());
  const originalSet = stores.usage.set.bind(stores.usage);
  let failedUserWrite = false;
  stores.usage.set = async (key, data, options) => {
    if (key.startsWith('users/') && !failedUserWrite) {
      failedUserWrite = true;
      throw new Error('temporary user ledger failure');
    }
    return originalSet(key, data, options);
  };
  await usage.completeReservation(stores, reservation, {
    success: true,
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
  });
  const report = await usage.readReport(stores, { period: 'day' });
  const user = await usage.readUsersReport(stores, ['user-1'], { period: 'day' });
  assert.equal(failedUserWrite, true);
  assert.equal(report.totals.requests, 1);
  assert.equal(report.totals.successfulRequests, 1);
  assert.equal(user.users[0].successfulRequests, 1);
  assert.equal(user.users[0].totalTokens, 5);
});

test('user policies support inherit, custom, unlimited and disabled modes', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.defaultUser.requests.day = 0;
  settings.users.disabled = { mode: 'disabled', limits: usage.emptyLimitSet() };
  settings.users.unlimited = { mode: 'unlimited', limits: usage.emptyLimitSet() };
  settings.users.custom = { mode: 'custom', limits: usage.emptyLimitSet() };
  settings.users.custom.limits.requests.day = 1;
  await usage.saveSettings(stores, settings, 'admin', []);
  await assert.rejects(usage.reserveRequest(stores, request({ userId: 'user-1' })), (error) => error.code === 'AI_USER_DAY_LIMIT_REACHED');
  await assert.rejects(usage.reserveRequest(stores, request({ userId: 'disabled' })), (error) => error.code === 'AI_DISABLED_FOR_USER');
  assert.ok(await usage.reserveRequest(stores, request({ userId: 'unlimited' })));
  assert.ok(await usage.reserveRequest(stores, request({ userId: 'custom' })));
  await assert.rejects(usage.reserveRequest(stores, request({ userId: 'custom' })), (error) => error.code === 'AI_USER_DAY_LIMIT_REACHED');
});

test('hourly per-user limits persist, are reported before first use and block the next request', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.users.student = { mode: 'custom', limits: usage.emptyLimitSet() };
  settings.users.student.limits.requests.hour = 1;
  await usage.saveSettings(stores, settings, 'admin', []);

  const before = await usage.readUsersReport(stores, ['student'], { period: 'hour' });
  assert.equal(before.users.length, 1);
  assert.equal(before.users[0].mode, 'custom');
  assert.equal(before.users[0].requests, 0);
  assert.equal(before.users[0].limit, 1);

  const reservation = await usage.reserveRequest(stores, request({ userId: 'student' }));
  await usage.completeReservation(stores, reservation, {
    success: true,
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
  });
  const after = await usage.readUsersReport(stores, ['student'], { period: 'hour' });
  assert.equal(after.users[0].requests, 1);
  assert.equal(after.users[0].limit, 1);
  assert.equal(after.users[0].usagePercent, 100);
  await assert.rejects(
    usage.reserveRequest(stores, request({ userId: 'student' })),
    (error) => error.code === 'AI_USER_HOUR_LIMIT_REACHED'
  );
});

test('batched user report includes accounts without an existing usage document', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.defaultUser.requests.hour = 20;
  await usage.saveSettings(stores, settings, 'admin', []);
  const report = await usage.readUsersReport(stores, ['never-used'], { period: 'hour' });
  assert.equal(report.users[0].userId, 'never-used');
  assert.equal(report.users[0].mode, 'inherit');
  assert.equal(report.users[0].requests, 0);
  assert.equal(report.users[0].limit, 20);
});

test('a zero user limit is reported as immediately exhausted', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.defaultUser.requests.hour = 0;
  await usage.saveSettings(stores, settings, 'admin', []);
  const report = await usage.readUsersReport(stores, ['never-used'], { period: 'hour' });
  assert.equal(report.users[0].limit, 0);
  assert.equal(report.users[0].usagePercent, 100);
  assert.equal(report.users[0].warning.level, 'limit');
});

test('a zero cost limit blocks immediately even when the estimated cost rounds to zero', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.defaultUser.estimatedCostMicros.hour = 0;
  settings.configs['ai-primary'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: 0, outputPerMillion: 0 }, fallbackConfigId: null
  };
  await usage.saveSettings(stores, settings, 'admin', ['ai-primary']);
  await assert.rejects(
    usage.reserveRequest(stores, request({
      estimate: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostMicros: 0 }
    })),
    (error) => error.code === 'AI_USER_HOUR_COST_LIMIT_REACHED' && error.details.limit === 0
  );
});

test('default user and configuration-per-user hourly limits are enforced independently', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.defaultUser.requests.hour = 20;
  settings.configs['env-openai'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: null
  };
  settings.configs['env-openai'].perUser.requests.hour = 5;
  await usage.saveSettings(stores, settings, 'admin', ['env-openai']);

  for (let index = 0; index < 5; index += 1) {
    const reservation = await usage.reserveRequest(stores, request({
      userId: 'student-a', aiConfigId: 'env-openai', provider: 'openai', model: 'gpt-test'
    }));
    await usage.completeReservation(stores, reservation, { success: true, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
  }
  await assert.rejects(
    usage.reserveRequest(stores, request({ userId: 'student-a', aiConfigId: 'env-openai', provider: 'openai', model: 'gpt-test' })),
    (error) => error.code === 'AI_CONFIG_HOUR_LIMIT_REACHED' && error.details.limit === 5
  );
  assert.ok(await usage.reserveRequest(stores, request({
    userId: 'student-b', aiConfigId: 'env-openai', provider: 'openai', model: 'gpt-test'
  })));

  for (let index = 0; index < 15; index += 1) {
    const reservation = await usage.reserveRequest(stores, request({
      userId: 'student-a', aiConfigId: 'env-gemini', provider: 'gemini', model: 'gemini-test'
    }));
    await usage.completeReservation(stores, reservation, { success: true, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
  }
  await assert.rejects(
    usage.reserveRequest(stores, request({ userId: 'student-a', aiConfigId: 'env-gemini', provider: 'gemini', model: 'gemini-test' })),
    (error) => error.code === 'AI_USER_HOUR_LIMIT_REACHED' && error.details.limit === 20
  );
});

test('configuration IDs matching inherited object names cannot bypass their limits', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.configs.toString = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: null
  };
  settings.configs.toString.perUser.requests.hour = 1;
  await usage.saveSettings(stores, settings, 'admin', ['toString']);

  const first = await usage.reserveRequest(stores, request({ aiConfigId: 'toString', model: 'toString' }));
  await usage.completeReservation(stores, first, {
    success: true,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
  });
  await assert.rejects(
    usage.reserveRequest(stores, request({ aiConfigId: 'toString', model: 'toString' })),
    (error) => error.code === 'AI_CONFIG_HOUR_LIMIT_REACHED'
  );
  const report = await usage.readReport(stores, { period: 'hour' });
  assert.equal(report.configs.some((row) => row.id === 'toString' && row.requests === 1), true);
  assert.equal(report.models.some((row) => row.id === 'toString' && row.requests === 1), true);
});

test('saving a default hourly user limit removes only previously orphaned AI policies', async (t) => {
  const ledger = usageStores();
  const aiStores = providerStores();
  const oldSettings = usage.emptySettings();
  oldSettings.configs['deleted-ai'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: null
  };
  await usage.saveSettings(ledger, oldSettings, 'admin', ['deleted-ai']);
  await manager.saveConfig(aiStores, { aiConfigId: 'current-ai', name: 'Current', provider: 'openai', model: 'gpt-test' }, 'admin');
  usage._test.setStoreFactory(() => ledger);
  manager._test.setStoreFactory(() => aiStores);

  const submitted = structuredClone(oldSettings);
  submitted.defaultUser.requests.hour = 20;
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({
    id: 'admin-1', app_metadata: { roles: ['admin'], session_id: 's1' }
  }), { status: 200 });
  const response = await adminUsageEndpoint.handler({
    httpMethod: 'PUT',
    headers: {
      authorization: 'Bearer token',
      'content-type': 'application/json',
      origin: 'https://example.netlify.app',
      host: 'example.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ settings: submitted }),
    clientContext: {
      user: { id: 'admin-1', app_metadata: { roles: ['admin'], session_id: 's1' } },
      identity: { url: 'https://example.netlify.app/.netlify/identity' }
    }
  });
  assert.equal(response.statusCode, 200);
  const saved = JSON.parse(response.body);
  assert.equal(saved.defaultUser.requests.hour, 20);
  assert.equal(Object.hasOwn(saved.configs, 'deleted-ai'), false);
});

test('stale-policy cleanup does not allow a newly invented AI configuration ID', async () => {
  const ledger = usageStores();
  const current = usage.emptySettings();
  current.configs['old-ai'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: null
  };
  const cleaned = usage.pruneStaleConfigPolicies(current, ['old-ai']);
  cleaned.configs['invented-ai'] = {
    global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(),
    pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: null
  };
  await assert.rejects(
    usage.saveSettings(ledger, cleaned, 'admin', ['current-ai']),
    (error) => error.code === 'AI_CONFIG_NOT_FOUND'
  );
});

test('module request limits apply per user and cost limits fail closed without pricing', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.modules.chat = usage.emptyLimitSet();
  settings.modules.chat.requests.day = 1;
  await usage.saveSettings(stores, settings, 'admin', []);
  assert.ok(await usage.reserveRequest(stores, request({ userId: 'first-user' })));
  assert.ok(await usage.reserveRequest(stores, request({ userId: 'second-user' })));
  await assert.rejects(usage.reserveRequest(stores, request({ userId: 'first-user' })), (error) => error.code === 'AI_MODULE_DAY_LIMIT_REACHED');

  const priced = structuredClone(settings);
  priced.global.estimatedCostMicros.day = 100;
  await usage.saveSettings(stores, priced, 'admin', []);
  await assert.rejects(
    usage.reserveRequest(stores, request({ userId: 'third-user', estimate: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostMicros: null } })),
    (error) => error.code === 'AI_COST_ESTIMATE_UNAVAILABLE'
  );
});

test('the other module limit covers unregistered future module IDs', async () => {
  const stores = usageStores();
  const settings = usage.emptySettings();
  settings.modules.other = usage.emptyLimitSet();
  settings.modules.other.requests.hour = 1;
  await usage.saveSettings(stores, settings, 'admin', []);
  const first = await usage.reserveRequest(stores, request({ userId: 'student', moduleId: 'future-tutor' }));
  await usage.completeReservation(stores, first, { success: true, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
  await assert.rejects(
    usage.reserveRequest(stores, request({ userId: 'student', moduleId: 'future-tutor' })),
    (error) => error.code === 'AI_MODULE_HOUR_LIMIT_REACHED'
  );
});

test('only an explicit fallback can call a second provider and both calls are counted', async () => {
  const aiStores = providerStores();
  const ledger = usageStores();
  await manager.saveConfig(aiStores, { aiConfigId: 'ai-primary', name: 'Primary', provider: 'gemini', model: 'gemini-test' }, 'admin');
  await manager.saveConfig(aiStores, { aiConfigId: 'ai-secondary', name: 'Secondary', provider: 'openai', model: 'gpt-test' }, 'admin');
  await manager.setConfigSecret(aiStores, 'ai-primary', 'gemini-secret-key', 'admin');
  await manager.setConfigSecret(aiStores, 'ai-secondary', 'openai-secret-key', 'admin');
  await manager.setModuleAssignment(aiStores, 'chat', 'ai-primary', 'admin');
  const settings = usage.emptySettings();
  settings.configs['ai-primary'] = { global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(), pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: 'ai-secondary' };
  settings.configs['ai-secondary'] = { global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(), pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: null };
  await usage.saveSettings(ledger, settings, 'admin', ['ai-primary', 'ai-secondary']);
  let calls = 0;
  const response = await router.sendRequest({ userId: 'user-1', module: 'chat', messages: [{ role: 'user', content: 'Hej' }], maxOutputTokens: 20 }, {
    getStores: () => aiStores,
    getUsageStores: () => ledger,
    fetchImpl: async (url) => {
      calls += 1;
      if (String(url).includes('googleapis.com')) return new Response('{}', { status: 429 });
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Fallback OK' }] }], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } }), { status: 200 });
    }
  });
  assert.equal(response.text, 'Fallback OK');
  assert.equal(response.aiConfigId, 'ai-secondary');
  assert.equal(response.fallbackFrom, 'ai-primary');
  assert.equal(calls, 2);
  const report = await usage.readReport(ledger, { period: 'day' });
  assert.equal(report.totals.requests, 2);
  assert.equal(report.totals.errors, 1);
  assert.equal(report.totals.successfulRequests, 1);
});

test('provider management operations also pass through limit check and usage recording', async () => {
  const aiStores = providerStores();
  const ledger = usageStores();
  await manager.saveConfig(aiStores, { aiConfigId: 'ai-primary', name: 'Primary', provider: 'gemini', model: 'gemini-test' }, 'admin');
  await manager.setConfigSecret(aiStores, 'ai-primary', 'gemini-secret-key', 'admin');
  const operation = await router.runProviderOperation({ userId: 'admin-1', aiConfigId: 'ai-primary', operation: 'testConnection' }, {
    getStores: () => aiStores,
    getUsageStores: () => ledger,
    fetchImpl: async () => new Response('{}', { status: 200 })
  });
  assert.equal(operation.result.status, 'ok');
  const report = await usage.readReport(ledger, { period: 'day' });
  assert.equal(report.totals.requests, 1);
  assert.equal(report.modules[0].id, 'admin-ai');
});

test('fallback checks the new configuration limit before making its provider call', async () => {
  const aiStores = providerStores();
  const ledger = usageStores();
  await manager.saveConfig(aiStores, { aiConfigId: 'ai-primary', name: 'Primary', provider: 'gemini', model: 'gemini-test' }, 'admin');
  await manager.saveConfig(aiStores, { aiConfigId: 'ai-secondary', name: 'Secondary', provider: 'openai', model: 'gpt-test' }, 'admin');
  await manager.setConfigSecret(aiStores, 'ai-primary', 'gemini-secret-key', 'admin');
  await manager.setConfigSecret(aiStores, 'ai-secondary', 'openai-secret-key', 'admin');
  await manager.setModuleAssignment(aiStores, 'chat', 'ai-primary', 'admin');
  const settings = usage.emptySettings();
  settings.configs['ai-primary'] = { global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(), pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: 'ai-secondary' };
  settings.configs['ai-secondary'] = { global: usage.emptyLimitSet(), perUser: usage.emptyLimitSet(), pricing: { inputPerMillion: null, outputPerMillion: null }, fallbackConfigId: null };
  settings.configs['ai-secondary'].global.requests.day = 0;
  await usage.saveSettings(ledger, settings, 'admin', ['ai-primary', 'ai-secondary']);
  let calls = 0;
  await assert.rejects(router.sendRequest({ userId: 'user-1', module: 'chat', messages: [{ role: 'user', content: 'Hej' }], maxOutputTokens: 20 }, {
    getStores: () => aiStores,
    getUsageStores: () => ledger,
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 429 }); }
  }), (error) => error.code === 'AI_CONFIG_DAY_LIMIT_REACHED');
  assert.equal(calls, 1);
});

test('an assigned config without a key does not fall through to the default config', async () => {
  const stores = providerStores();
  await manager.saveConfig(stores, { aiConfigId: 'ai-primary', name: 'Primary', provider: 'gemini', model: 'gemini-test' }, 'admin');
  await manager.saveConfig(stores, { aiConfigId: 'ai-default', name: 'Default', provider: 'openai', model: 'gpt-test' }, 'admin');
  await manager.setConfigSecret(stores, 'ai-default', 'openai-secret-key', 'admin');
  await manager.setDefaultConfig(stores, 'ai-default', 'admin');
  await manager.setModuleAssignment(stores, 'chat', 'ai-primary', 'admin');
  assert.equal(await router.resolveConfig('chat', { getStores: () => stores }), null);
});

test('manual user reset clears only that user and writes an audit event', async () => {
  const stores = usageStores();
  const reservation = await usage.reserveRequest(stores, request());
  await usage.completeReservation(stores, reservation, { success: false, errorCode: 'AI_PROVIDER_ERROR' });
  const reset = await usage.resetUserUsage(stores, 'user-1', 'admin-1');
  assert.equal(reset.userId, 'user-1');
  const own = await usage.readOwnUsage(stores, 'user-1');
  assert.equal(own.periods.day.usage.requests, 0);
  const audit = await usage.listAudit(stores.config);
  assert.equal(audit.some((entry) => entry.action === 'ai.usage.user.reset' && entry.targetUserId === 'user-1'), true);
  const report = await usage.readReport(stores, { period: 'day' });
  assert.equal(report.totals.requests, 1);
});

test('manual reset refuses to erase an in-flight provider reservation', async () => {
  const stores = usageStores();
  await usage.reserveRequest(stores, request());
  await assert.rejects(usage.resetUserUsage(stores, 'user-1', 'admin'), (error) => error.code === 'AI_USAGE_RESET_BUSY');
});

test('detailed usage retention is bounded and settings/report reads do not count as provider requests', async () => {
  const stores = usageStores();
  const raw = usage._test.emptyUsageDocument('global');
  raw.recent = Array.from({ length: 450 }, (_, index) => ({ index }));
  assert.equal(usage._test.normalizeUsageDocument(raw, 'global').recent.length, 300);
  await usage.readSettings(stores.config);
  await usage.readReport(stores, { period: 'day' });
  const report = await usage.readReport(stores, { period: 'day' });
  assert.equal(report.totals.requests, 0);
});

test('usage normalization preserves every aggregate window allowed by the retention policy', () => {
  const raw = usage._test.emptyUsageDocument('global');
  for (let index = 0; index < 48; index += 1) raw.windows[`hour:2026-01-${String(1 + Math.floor(index / 24)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}`] = {};
  for (let index = 0; index < 90; index += 1) raw.windows[`day:2026-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`] = {};
  for (let index = 0; index < 26; index += 1) raw.windows[`week:2026-W${String(index + 1).padStart(2, '0')}`] = {};
  for (let index = 0; index < 18; index += 1) raw.windows[`month:${2025 + Math.floor(index / 12)}-${String(1 + (index % 12)).padStart(2, '0')}`] = {};
  raw.windows.lifetime = {};
  assert.equal(Object.keys(usage._test.normalizeUsageDocument(raw, 'global').windows).length, 183);
});

test('AI usage administration is protected by fresh admin authorization', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ id: 'user-1', app_metadata: { roles: ['active'], session_id: 's1' } }), { status: 200 });
  const response = await adminUsageEndpoint.handler({
    httpMethod: 'GET', headers: { authorization: 'Bearer token' },
    clientContext: { user: { id: 'user-1', app_metadata: { roles: ['admin'], session_id: 's1' } }, identity: { url: 'https://example.netlify.app/.netlify/identity' } }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, 'ADMIN_REQUIRED');
});

test('own-usage endpoint always derives the user ID from the canonical session', async (t) => {
  const stores = usageStores();
  usage._test.setStoreFactory(() => stores);
  const first = await usage.reserveRequest(stores, request({ userId: 'user-1' }));
  await usage.completeReservation(stores, first, { success: true, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
  const second = await usage.reserveRequest(stores, request({ userId: 'other-user' }));
  await usage.completeReservation(stores, second, { success: true, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ id: 'user-1', app_metadata: { roles: ['active'], session_id: 's1' } }), { status: 200 });
  const response = await ownUsageEndpoint.handler({
    httpMethod: 'GET',
    queryStringParameters: { userId: 'other-user' },
    headers: { authorization: 'Bearer token' },
    clientContext: {
      user: { id: 'user-1', app_metadata: { roles: ['active'], session_id: 's1' } },
      identity: { url: 'https://example.netlify.app/.netlify/identity' }
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).periods.day.usage.totalTokens, 2);
});
