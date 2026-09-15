const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/members/module/studio/manage/index.html');
const source = read('public/members/module/studio/manage/management.js');
const clone = (value) => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
    this.events = new Map(); this.value = ''; this.hidden = false; this.checked = false;
    this.style = {}; this.disabled = false; this._text = '';
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  get childElementCount() { return this.children.length; }
  get textContent() { return this._text + this.children.map((c) => c.textContent ?? String(c)).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(name, fn) { this.events.set(name, [...(this.events.get(name) || []), fn]); }
  async fire(name, event = {}) { for (const fn of this.events.get(name) || []) await fn({ target: this, currentTarget: this, preventDefault() {}, ...event }); }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => child instanceof Element
      ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
  matches(selector) {
    const tag = selector.match(/^[a-z]+/)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const attr = selector.match(/\[([^\]=]+)\]/)?.[1];
    if (attr?.startsWith('data-')) return attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) in this.dataset;
    return !attr || attr in this.attributes;
  }
  focus() { this.focused = true; }
  scrollIntoView() {}
}

function harness({ tab = 'progress', admin = true, authenticated = true, userCount = 2, fail } = {}) {
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Element(match[1]);
    node.id = match[3];
    for (const attr of match[2].matchAll(/([a-z-]+)="([^"]*)"/g)) node.setAttribute(attr[1], attr[2]);
    node.hidden = /\bhidden\b/.test(match[2]);
    node.value = node.attributes.value || '';
    if (node.tagName === 'SELECT') {
      const options = html.slice(match.index).split('</select>')[0];
      node.value = options.match(/<option value="([^"]*)" selected/)?.[1] || options.match(/<option value="([^"]*)"/)?.[1] || '';
    }
    nodes.set(node.id, node);
  }
  const listeners = new Map();
  const document = {
    readyState: 'loading', getElementById: (id) => nodes.get(id) || null,
    querySelectorAll: (selector) => [...nodes.values()].filter((n) => n.matches(selector)),
    createElement: (tag) => new Element(tag), addEventListener: (name, fn) => listeners.set(name, fn)
  };
  let currentUser = authenticated ? { id: 'admin-1', app_metadata: { roles: admin ? ['admin'] : ['active'] }, jwt: async () => 'test-admin-token' } : null;
  const calls = [];
  const users = Array.from({ length: userCount }, (_, index) => ({ id: `student-${index}`, email: `student${index}@example.test`, user_metadata: { first_name: 'Uczeń', last_name: String(index) } }));
  const periods = ['hour', 'day', 'week', 'month', 'lifetime'];
  const emptyLimits = () => Object.fromEntries(['requests', 'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostMicros'].map((metric) => [metric, Object.fromEntries(periods.map((p) => [p, null]))]));
  let settings = { global: emptyLimits(), defaultUser: emptyLimits(), users: {}, configs: {}, providers: {}, modules: {}, timezone: 'Europe/Warsaw', currency: 'USD', warningThresholds: [70, 90, 100] };
  let prices = { etag: 'prices-1', currency: 'pln', paymentsEnabled: true, stackingEnabled: true, checkoutAvailable: true, plans: ['hour', 'day', 'week', 'month', 'halfyear', 'year'].map((id) => ({ id, amount: 2500, enabled: true })) };
  let catalog = { global: { tracking: 'ON', showProgress: 'ON', recordOpens: true }, nodes: [] };
  const window = {
    ChemAuth: { ready: Promise.resolve({ authenticated, session: { ok: authenticated } }), getUser: () => currentUser },
    location: { href: `https://course.test/members/module/studio/manage/?tab=${tab}`, replace(url) { this.redirect = url; } },
    history: { replaceState(_state, _title, url) { window.location.href = String(url); } },
    addEventListener: (name, fn) => listeners.set(name, fn), confirm: () => true
  };
  async function fetch(url, options = {}) {
    const parsed = new URL(url, window.location.href);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: parsed, ...options, body });
    assert.equal(options.headers.Authorization, 'Bearer test-admin-token');
    if (fail?.(parsed, options)) return { ok: false, status: 409, json: async () => ({ message: 'Konfiguracja została zmieniona. Wczytaj ją ponownie.' }) };
    let payload;
    if (parsed.pathname.endsWith('/admin-users')) payload = { users, pagination: { hasMore: false } };
    else if (parsed.pathname.endsWith('/payment-config')) {
      if (body) prices = { ...prices, ...body, etag: 'prices-2', plans: prices.plans.map((p) => ({ ...p, amount: body.prices[p.id], enabled: body.enabledPlans.includes(p.id) })) };
      payload = prices;
    } else if (parsed.pathname.endsWith('/admin-progress')) {
      if (body?.action === 'catalog') catalog = body.catalog;
      payload = { users: [], cursor: '', catalog, audit: [], report: { users: 0, distribution: {}, mostUnopened: [] } };
    } else if (parsed.pathname.endsWith('/admin-ai')) payload = { configs: [], environmentConfigs: [{ aiConfigId: 'env-openai', name: 'OpenAI (ENV)', provider: 'openai' }, { aiConfigId: 'env-gemini', name: 'Gemini (ENV)', provider: 'gemini' }] };
    else if (parsed.pathname.endsWith('/admin-ai-usage')) {
      if (body?.settings) { settings = body.settings; payload = settings; }
      else if (parsed.searchParams.get('view') === 'settings') payload = settings;
      else if (parsed.searchParams.get('view') === 'users') payload = { users: parsed.searchParams.get('ids').split(',').map((userId) => ({ userId, requests: 0 })) };
      else payload = { period: parsed.searchParams.get('period') || 'day', key: 'day:2026-09-08', timezone: 'Europe/Warsaw', currency: 'USD', totals: {}, users: [], providers: [], models: [], configs: [], modules: [] };
    } else throw Error(`Unexpected endpoint ${parsed}`);
    return { ok: true, status: 200, json: async () => clone(payload) };
  }
  const exposed = source.replace(/\n\}\)\(\);\s*$/, '\nwindow.testManagement = { startManagement, activateAdminTab, loadAdminUsers, loadAdminProgress, loadAdminAiUsage, loadAdminPrices, openAdminAiUserLimits, saveAdminAiUsageSettings, saveAdminProgressSettings, saveAdminPrices, adminMaterialStatusLabel };\n})();');
  vm.runInNewContext(exposed, { window, document, URL, console, fetch });
  return { api: window.testManagement, nodes, calls, users, settings: () => settings, prices: () => prices, window, listeners, logout: () => { currentUser = null; } };
}

test('management panels are moved, not duplicated or embedded, and retain role protection', () => {
  const members = read('public/members/index.html');
  const dashboard = read('public/members/dashboard.js');
  const studio = read('public/members/module/studio/index.html');
  for (const tab of ['progress', 'ai-usage', 'payments']) {
    assert.doesNotMatch(members, new RegExp(`data-admin-(?:tab|panel)="${tab}"`));
    assert.equal((html.match(new RegExp(`data-admin-panel="${tab}"`, 'g')) || []).length, 1);
    assert.match(studio, new RegExp(`/members/module/studio/manage/\\?tab=${tab}`));
  }
  assert.doesNotMatch(html, /<iframe|src="\/members\/dashboard.js|dashboard\.md/);
  assert.doesNotMatch(dashboard, /function (?:loadAdminAiUsage|loadAdminPrices|loadAdminProgress)\(/);
  assert.match(dashboard, /window\.location\.replace\(`\/members\/module\/studio\/manage\/\?tab=\$\{encodeURIComponent\(requestedAdminTab\)\}`\)/);
  assert.match(read('netlify.toml'), /from = "\/members\/module\/studio\/\*"[\s\S]*?conditions = \{ Role = \["admin"\] \}/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate control IDs');
});

test('management stays hidden and makes no requests for guests or ordinary students', async () => {
  for (const options of [{ admin: false }, { authenticated: false }]) {
    const page = harness(options);
    await page.api.startManagement();
    assert.equal(page.calls.length, 0);
    assert.equal(page.nodes.get('management-app').hidden, true);
    assert.match(page.nodes.get('management-access').textContent, /konto administratora/);
  }
});

test('payments load only their configuration and preserve conditional save and money units', async () => {
  const page = harness({ tab: 'payments' });
  await page.api.startManagement();
  assert.equal(page.nodes.get('management-app').hidden, false);
  assert.deepEqual(page.calls.map((c) => c.url.pathname), ['/.netlify/functions/payment-config']);
  page.nodes.get('admin-price-hour').value = '39.99';
  await page.api.saveAdminPrices({ preventDefault() {} });
  const saved = page.calls.find((c) => c.method === 'PUT');
  assert.equal(saved.body.prices.hour, 3999);
  assert.equal(saved.body.expectedEtag, 'prices-1');
  assert.equal(page.nodes.get('admin-price-hour').value, '39.99');
});

test('failed payment saves preserve the edited fields and show a recoverable error', async () => {
  const page = harness({ tab: 'payments', fail: (_url, options) => options.method === 'PUT' });
  await page.api.startManagement();
  page.nodes.get('admin-price-hour').value = '39.99';
  await page.api.saveAdminPrices({ preventDefault() {} });
  assert.equal(page.nodes.get('admin-price-hour').value, '39.99');
  assert.match(page.nodes.get('admin-prices-status').textContent, /Wczytaj ją ponownie/);
  assert.equal(page.nodes.get('admin-prices-save').disabled, false);
});

test('progress loads ordinary accounts, paginates locally, filters and saves tracking settings', async () => {
  const page = harness({ userCount: 65 });
  await page.api.startManagement();
  assert.match(page.nodes.get('admin-progress-status').textContent, /Wczytano/);
  assert.equal(page.nodes.get('admin-progress-user-list').children.length, 30);
  assert.equal(page.nodes.get('admin-progress-more').hidden, false);
  const count = page.calls.length;
  await page.nodes.get('admin-progress-more').fire('click');
  assert.equal(page.nodes.get('admin-progress-user-list').children.length, 60);
  assert.equal(page.calls.length, count, 'cached accounts need no extra Functions request');
  page.nodes.get('admin-progress-search').value = 'student64@';
  await page.nodes.get('admin-progress-search').fire('input');
  assert.equal(page.nodes.get('admin-progress-user-list').children.length, 1);
  page.nodes.get('admin-progress-global-tracking').value = 'OFF';
  await page.api.saveAdminProgressSettings();
  assert.equal(page.calls.find((c) => c.method === 'PUT').body.catalog.global.tracking, 'OFF');
  assert.equal(page.api.adminMaterialStatusLabel({ status: 'in_progress' }), 'W trakcie');
});

test('AI controls save hourly default, ENV configuration and student-specific limits together', async () => {
  const page = harness({ tab: 'ai-usage', userCount: 32 });
  await page.api.startManagement();
  const get = (id) => page.nodes.get(id);
  assert.match(get('admin-ai-users-count').textContent, /25 z 32/);
  assert.match(get('admin-ai-usage-users').textContent, /Uczeń/);
  const scope = get('admin-ai-limit-scope');
  const setHour = (value) => { get('admin-ai-limit-grid').querySelectorAll('input').find((n) => n.dataset.aiLimitMetric === 'requests' && n.dataset.aiLimitPeriod === 'hour').value = value; };
  scope.value = 'defaultUser'; await scope.fire('change'); setHour('20');
  scope.value = 'configUser'; await scope.fire('change');
  assert.equal(get('admin-ai-limit-scope-id').value, 'env-openai');
  assert.match(get('admin-ai-limit-scope-id').textContent, /Gemini/);
  setHour('5');
  scope.value = 'user'; await scope.fire('change');
  get('admin-ai-limit-scope-id').value = 'student-0'; await get('admin-ai-limit-scope-id').fire('change');
  setHour('9');
  const input = get('admin-ai-limit-grid').querySelectorAll('input')[0];
  await get('admin-ai-limit-grid').fire('input', { target: input });
  await page.api.saveAdminAiUsageSettings();
  assert.equal(page.settings().defaultUser.requests.hour, 20);
  assert.equal(page.settings().configs['env-openai'].perUser.requests.hour, 5);
  assert.equal(page.settings().users['student-0'].limits.requests.hour, 9);
  assert.equal(page.settings().users['student-0'].mode, 'custom');
  assert.match(get('admin-ai-usage-status').textContent, /Limity AI zostały zapisane/);
});

test('concurrent opens share in-flight reads and reopening panels uses the cache', async () => {
  const page = harness({ tab: 'payments' });
  await page.api.startManagement();
  await Promise.all([page.api.activateAdminTab('progress'), page.api.activateAdminTab('progress'), page.api.loadAdminProgress(true)]);
  assert.equal(page.calls.filter((c) => c.url.pathname.endsWith('/admin-progress')).length, 3);
  assert.equal(page.calls.filter((c) => c.url.pathname.endsWith('/admin-users')).length, 1);
  const count = page.calls.length;
  await page.api.activateAdminTab('payments'); await page.api.activateAdminTab('progress');
  assert.equal(page.calls.length, count);
  assert.doesNotMatch(source, /setInterval\(|localStorage\.setItem|sessionStorage\.setItem/);
});

test('session loss redirects away from management', async () => {
  const page = harness({ tab: 'payments' });
  await page.api.startManagement();
  page.logout(); page.listeners.get('chem-auth-user-changed')();
  assert.equal(page.window.location.redirect, '/members/');
  assert.equal(page.nodes.get('management-app').hidden, true);
});

test('unsaved settings survive refused reload and stop warning after successful save', async () => {
  const page = harness({ tab: 'payments' });
  await page.api.startManagement();
  await page.nodes.get('admin-prices-form').fire('input');
  let prevented = false;
  page.listeners.get('beforeunload')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const count = page.calls.length;
  page.window.confirm = () => false;
  await page.nodes.get('admin-prices-reload').fire('click');
  assert.equal(page.calls.length, count);
  await page.api.saveAdminPrices({ preventDefault() {} });
  prevented = false;
  page.listeners.get('beforeunload')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test('changing the AI report period cannot silently discard an edited limit', async () => {
  const page = harness({ tab: 'ai-usage' });
  await page.api.startManagement();
  await page.nodes.get('admin-ai-limit-grid').fire('input');
  page.window.confirm = () => false;
  page.nodes.get('admin-ai-usage-period').value = 'hour';
  await page.nodes.get('admin-ai-usage-period').fire('change');
  assert.equal(page.nodes.get('admin-ai-usage-period').value, 'day');
});

test('Studio tool categories, Polish search and the native selector work without requests', async () => {
  const studioHtml = read('public/members/module/studio/index.html');
  const nodes = new Map(['studio-tool-select', 'studio-tool-search', 'studio-tool-count', 'studio-tools-empty', 'content-explorer'].map((id) => [id, new Element()]));
  const cards = [...studioHtml.matchAll(/<(button|a) class="project-card\b([^>]*)>([\s\S]*?)<\/(?:button|a)>/g)].map((match) => {
    const node = new Element(match[1]);
    node.dataset.toolGroup = match[2].match(/data-tool-group="([^"]+)"/)?.[1];
    node.textContent = match[3].replace(/<[^>]+>/g, ' ');
    assert.ok(['content', 'appearance', 'management'].includes(node.dataset.toolGroup));
    return node;
  });
  const filters = ['all', 'content', 'appearance', 'management'].map((name) => Object.assign(new Element('button'), { dataset: { toolFilter: name } }));
  const events = [], navigations = [];
  let init;
  vm.runInNewContext(read('public/members/module/studio/tool-picker.js'), {
    document: {
      getElementById: (id) => nodes.get(id),
      querySelectorAll: (selector) => selector.includes('project-card') ? cards : filters,
      addEventListener(_name, fn) { init = fn; }, dispatchEvent: (event) => events.push(event)
    },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    window: { location: { assign: (url) => navigations.push(url) } },
    fetch() { throw Error('Tool search must not use a Function'); }
  });
  init();
  assert.ok(cards.length >= 14);
  assert.equal(cards.some((n) => n.hidden), false);
  await filters[3].fire('click');
  assert.ok(cards.filter((n) => !n.hidden).every((n) => n.dataset.toolGroup === 'management'));
  assert.equal(nodes.get('content-explorer').hidden, true, 'management selection must not trigger a content-library bootstrap');
  nodes.get('studio-tool-search').value = 'PLATNOSCI';
  await nodes.get('studio-tool-search').fire('input');
  assert.equal(cards.filter((n) => !n.hidden).length, 1);
  nodes.get('studio-tool-search').value = 'nieistniejące narzędzie';
  await nodes.get('studio-tool-search').fire('input');
  assert.equal(nodes.get('studio-tools-empty').hidden, false);
  nodes.get('studio-tool-select').value = 'lesson'; await nodes.get('studio-tool-select').fire('change');
  assert.equal(events.at(-1).detail, 'lesson');
  nodes.get('studio-tool-select').value = 'payments'; await nodes.get('studio-tool-select').fire('change');
  assert.equal(navigations.at(-1), '/members/module/studio/manage/?tab=payments');
  nodes.get('studio-tool-select').value = 'https://evil.test'; await nodes.get('studio-tool-select').fire('change');
  assert.equal(navigations.length, 1, 'only hard-coded internal routes can be selected');
});
