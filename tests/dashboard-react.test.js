'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { JSDOM } = require('jsdom');
const parser = require('../public/members/dashboard-parser');
const studio = require('../public/members/module/studio/dashboard-model');
const modelApi = require('../app/dashboard/model.cjs');
const { options: buildOptions } = require('../scripts/build-dashboard.cjs');
const project = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(project, 'public/members/dashboard.js'), 'utf8');
// Test the actual production bundle, without committing generated assets.
const bundle = buildSync({ ...buildOptions, write: false, logLevel: 'silent' }).outputFiles[0].text;
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

function adaptersFor(window, overrides = {}) {
  const functions = ['safeUrl', 'classifyResource', 'resourceLabel'].map((name) => {
    const match = new RegExp(`  (function ${name}\\([^]*?\\n  \\})\\n`).exec(source);
    assert.ok(match, name);
    return match[1];
  }).join('\n');
  const helpers = Function('window', `${functions}\nreturn { safeUrl, classifyResource, resourceLabel };`)(window);
  return { ...helpers, origin: window.location.origin, onFiltered() {}, onMessage() {}, navigate() {},
    progressView(value) {
      const node = window.document.createElement('div');
      node.className = 'chem-progress'; node.textContent = `${value.progressPercent || 0}%`;
      return node;
    },
    resetButton(label, id) {
      const button = window.document.createElement('button');
      button.className = 'student-progress-reset'; button.textContent = label; button.dataset.resetId = id;
      return button;
    }, ...overrides };
}

function harness(t, markdown, overrides = {}) {
  const dom = new JSDOM('<div id="content"></div>', { url: 'https://course.example/members/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(bundle);
  const content = window.document.getElementById('content');
  const model = typeof markdown === 'string' ? parser.parse(markdown) : markdown;
  const adapters = adaptersFor(window, overrides);
  const controller = window.NextMedDashboardReact.mount(content, model, adapters);
  t.after(() => { controller.destroy(); window.close(); });
  return { window, content, model, controller, adapters };
}

function lessons(count) {
  return Array.from({ length: count }, (_, i) => `- [Komórka ${i + 1}](/members/module/lesson/?repo=glowne&file=cell${i + 1}.md) — opis ${i + 1}`).join('\n');
}

test('React lazily mounts closed organizers and searches every one of 1500 materials', async (t) => {
  let opens = 0, sends = 0;
  const h = harness(t, `# Kurs\n## Biologia\n### Komórki\n${lessons(1500)}`, {
    openGroup() { opens++; }, sendProgress() { sends++; }
  });
  assert.equal(h.controller.total, 1500);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 0);
  assert.equal(h.content.querySelectorAll('.accordion-body').length, 0);
  h.controller.search('Komórka 1500', true);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 1);
  assert.match(h.content.textContent, /Komórka 1500/);
  assert.equal(opens, 0, 'Search expansion must not record group opens');
  assert.equal(sends, 0);
  h.controller.search('', true);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 0);
  h.content.querySelector('summary').click();
  await tick();
  assert.equal(h.content.querySelectorAll('.resource-card').length, 24);
  assert.equal(opens, 1);
  h.content.querySelector('.dashboard-more button').click();
  await tick();
  assert.equal(h.content.querySelectorAll('.resource-card').length, 48);
  assert.equal(sends, 0);
});

test('flat lists mount in bounded batches; search finds unmounted results and resets pagination', async (t) => {
  let stats;
  const h = harness(t, `# Kurs\n## Biologia\n${lessons(1200)}`, { onFiltered(...args) { stats = args; } });
  assert.deepEqual(stats, [1200, 1200, false]);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 24);
  h.controller.search('Komórka 1199', true);
  assert.deepEqual(stats, [1, 1200, true]);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 1);
  assert.match(h.content.querySelector('.card-link').href, /file=cell1199\.md&material=/);
  h.controller.search('Brak dopasowania', true);
  assert.deepEqual(stats, [0, 1200, true]);
  assert.equal(h.content.querySelector('section').hidden, true);
  h.controller.search('', true);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 24);
  h.controller.search('stary filtr');
  h.controller.search('', true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(stats, [1200, 1200, false], 'Clearing cancels a pending search');
});

test('Studio publication keeps all module URLs, IDs, descriptions and sequence settings in React', (t) => {
  const draft = studio.createModel({ title: 'Moja biologia', sections: [{ title: 'Start', blocks: [
    { kind: 'group', title: 'Nauka po kolei', navigation: 'sequential', blocks: [
      { kind: 'module', module: 'lesson', title: 'Komórka', file: 'cell.md', repositoryId: 'glowne' },
      { kind: 'module', module: 'quiz', title: 'Quiz', quizId: 'sprawdzian', repositoryId: 'glowne' },
      { kind: 'module', module: 'exam', title: 'Egzamin', examId: 'egzamin', repositoryId: 'glowne' }
    ] }
  ] }] });
  assert.equal(studio.validate(draft).valid, true);
  const published = studio.serialize(draft);
  const model = parser.parse(published);
  const h = harness(t, model);
  const compiled = modelApi.compileDashboard(model, h.adapters);
  assert.equal(compiled.sections[0].groups[0].navigation, 'sequential');
  assert.equal(compiled.sections[0].anchor, 'start-2', 'Course anchor must not duplicate the hero anchor');
  for (const item of model.sections[0].groups[0].items) {
    const node = h.content.querySelector(`[data-progress-id="${item.id}"]`);
    assert.ok(node, item.title);
    assert.ok(node.textContent.includes(item.title));
    const saved = compiled.sections[0].groups[0].items.find((candidate) => candidate.id === item.id);
    const original = new URL(item.href, h.adapters.origin);
    const target = new URL(saved.href, h.adapters.origin);
    for (const [key, value] of original.searchParams) assert.equal(target.searchParams.get(key), value);
    assert.equal(target.searchParams.get('material'), item.id);
  }
});

test('sequence access uses all steps, including unmounted and filtered ones; raw progress unlocks the next step', async (t) => {
  let message = '', sends = 0;
  const parsed = parser.parse(`# Kurs\n## Biologia\n### Kolejno\n${lessons(40)}`);
  parsed.sections[0].groups[0].navigation = 'sequential';
  const h = harness(t, parsed, { onMessage(value) { message = value; }, sendProgress() { sends++; } });
  const group = parsed.sections[0].groups[0];
  const records = Object.fromEntries(group.items.slice(0, 24).map((item) => [item.id, { status: 'completed', progressPercent: 100 }]));
  h.controller.setProgress({ records });
  await tick();
  h.content.querySelector('.dashboard-more button').click();
  await tick();
  const cards = h.content.querySelectorAll('.resource-card');
  assert.equal(cards.length, 40);
  assert.equal(cards[24].dataset.sequenceLocked, 'false');
  assert.equal(cards[25].dataset.sequenceLocked, 'true');
  h.controller.search('Komórka 40', true);
  const last = h.content.querySelector('.resource-card');
  assert.equal(last.dataset.sequenceIndex, '39');
  assert.equal(last.querySelector('.card-link').hasAttribute('href'), false);
  last.querySelector('.card-link').click();
  assert.match(message, /Komórka 25/);
  assert.equal(sends, 0);
  const access = Object.fromEntries(group.items.map((item, index) => [item.id, { sequenceId: group.id, step: index + 1, totalSteps: 40, allowed: true }]));
  h.controller.setProgress({ access, records });
  await tick();
  assert.equal(last.dataset.sequenceLocked, 'false', 'A complete server access map can grant administrator/explicit access');
  delete access[group.items[0].id];
  h.controller.setProgress({ access, records });
  await tick();
  assert.equal(last.dataset.sequenceLocked, 'true', 'Incomplete/stale catalog must fall back to full local sequence');
});

test('safe URLs and plain text remain safe, with tracked internal links and external isolation', (t) => {
  const parsed = parser.parse('# Kurs\n## Dział\n- [Link](https://example.com/)\n- [Film](/members/module/filmv1/?id=test)\n- [Zły](javascript:alert%281%29)');
  parsed.sections[0].items[0].title = '<img src=x onerror=alert(1)>';
  const h = harness(t, parsed);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 2);
  assert.equal(h.content.querySelectorAll('img, script').length, 0);
  const links = h.content.querySelectorAll('.card-link');
  assert.equal(links[0].target, '_blank');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.match(links[1].href, /\/members\/module\/film\/\?id=test&material=/);
});

test('progress widgets survive filtering and pagination without further progress loads', async (t) => {
  const h = harness(t, `# Kurs\n## Biologia\n${lessons(60)}`);
  const item = h.model.sections[0].items[59];
  const aggregate = { title: item.title, tracked: true, showProgress: true, trackedCount: 1, record: { progressPercent: 42 } };
  h.controller.setProgress({ aggregate: { nodes: { [item.id]: aggregate } } });
  await tick();
  h.controller.search('Komórka 60', true);
  const host = h.content.querySelector('.card-progress-host');
  assert.equal(host.hidden, false);
  assert.match(host.textContent, /42%/);
  assert.equal(host.querySelector('button').dataset.resetId, item.id);
  h.controller.setProgress({ aggregate: { nodes: { [item.id]: { ...aggregate, showProgress: false } } } });
  await tick();
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
});

test('nested sequential groups stay lazy under a closed parent and do not send automatic open events', async (t) => {
  let opens = 0;
  const parsed = parser.parse(`# Kurs\n## Biologia\n### Rodzic\n#### Kolejne kroki\n${lessons(100)}`);
  parsed.sections[0].groups[0].groups[0].navigation = 'sequential';
  const h = harness(t, parsed, { openGroup() { opens++; } });
  assert.equal(h.content.querySelectorAll('details').length, 1);
  h.content.querySelector('summary').click();
  await tick();
  assert.equal(h.content.querySelectorAll('details').length, 2);
  assert.equal(h.content.querySelectorAll('.resource-card').length, 24);
  assert.equal(opens, 1);
  assert.equal(h.content.querySelectorAll('.resource-card')[1].dataset.sequenceLocked, 'true');
});

test('sequential presentations record completion on click before navigating, never on render', async (t) => {
  const parsed = parser.parse('# Kurs\n## Biologia\n### Kolejno\n- [Slajdy](/members/module/presentation/?presentation=test)');
  parsed.sections[0].groups[0].navigation = 'sequential';
  const events = [];
  const h = harness(t, parsed, {
    sendProgress(value, options) { events.push({ action: value.action, keepalive: options.keepalive }); return Promise.resolve(); },
    navigate(href) { events.push({ href }); }
  });
  assert.equal(events.length, 0);
  h.content.querySelector('.card-link').click();
  await tick();
  assert.equal(events[0].action, 'complete');
  assert.equal(events[0].keepalive, true);
  assert.match(events[1].href, /presentation=test&material=/);
});

test('production bundle is local, does not embed ENV, and loads before dashboard integration', () => {
  const html = fs.readFileSync(path.join(project, 'public/members/index.html'), 'utf8');
  const pkg = require('../package.json');
  assert.ok(html.indexOf('/assets/build/dashboard-react.js') < html.indexOf('/members/dashboard.js'));
  assert.equal(pkg.scripts.build, 'npm run build:dashboard && node scripts/run-tests.cjs', 'Generate published assets before checking HTML references, including on a clean Netlify checkout');
  assert.equal(pkg.scripts.pretest, 'npm run build:dashboard', 'npm test also needs fresh generated assets on a clean checkout');
  assert.equal(buildOptions.sourcemap, false);
  assert.deepEqual(buildOptions.define, { 'process.env.NODE_ENV': '"production"' });
  assert.doesNotMatch(bundle, /GITEA_TOKEN|GITHUB_CONTENT_TOKEN|NETLIFY_API_TOKEN|OPENAI_API_KEY/);
  assert.ok(Buffer.byteLength(bundle) < 300 * 1024, 'Keep the complete production renderer below 300 kB');
});

async function bootDashboard(t, { renderer = 'react', markdown, loadProgress } = {}) {
  const html = fs.readFileSync(path.join(project, 'public/members/index.html'), 'utf8');
  const dom = new JSDOM(html, { url: `https://course.example/members/${renderer === 'legacy' ? '?dashboardRenderer=legacy' : ''}`,
    runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => window.close());
  await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const user = { id: 'student', email: 'student@example.com', app_metadata: { roles: ['active'] }, user_metadata: {}, jwt: async () => 'fixture-jwt' };
  window.ChemAuth = { ready: Promise.resolve({ available: true, authenticated: true, session: { ok: true } }), getUser: () => user, getProfile: () => null };
  const calls = { fetch: [], progress: 0, open: 0 };
  window.ChemProgress = {
    load: (...args) => { calls.progress++; return loadProgress ? loadProgress(...args) : Promise.resolve({ records: {}, aggregate: {} }); },
    progressView: adaptersFor(window).progressView,
    open: async () => { calls.open++; }, send: async () => {}
  };
  window.fetch = async (url, options) => {
    calls.fetch.push(String(url));
    assert.equal(url, '/.netlify/functions/admin-dashboard');
    assert.equal(options.headers.Authorization, 'Bearer fixture-jwt');
    return new Response(JSON.stringify({ source: 'blob', content: markdown || `# Kurs\n## Biologia\n### Komórki\n${lessons(80)}` }));
  };
  window.eval(fs.readFileSync(path.join(project, 'public/members/dashboard-parser.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(project, 'public/members/dashboard-navigation.js'), 'utf8'));
  if (renderer !== 'missing') window.eval(bundle);
  window.eval(source);
  await tick();
  return { window, document: window.document, calls };
}

test('complete member page mounts React from the published Blob and filters without extra requests', async (t) => {
  const h = await bootDashboard(t);
  const content = h.document.getElementById('markdown-sections');
  assert.equal(content.dataset.renderer, 'react');
  assert.equal(h.document.getElementById('dashboard-title').textContent, 'Kurs');
  assert.equal(h.calls.progress, 1);
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.calls.open, 0);
  assert.equal(content.querySelectorAll('.resource-card').length, 2, 'Only the required help cards mount before opening a group');
  assert.equal(h.document.getElementById('admin-panel-button').hidden, true);
  const search = h.document.getElementById('resource-search');
  search.value = 'Komórka 80';
  search.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(content.querySelectorAll('.resource-card').length, 1);
  assert.match(h.document.getElementById('resource-count').textContent, /1 materiał z 82/);
  assert.equal(h.calls.progress, 1);
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.calls.open, 0);

  search.value = 'Nic nie pasuje';
  search.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(content.hidden, true);
  h.document.querySelector('#course-nav [href="#biologia"]').click();
  assert.equal(search.value, '');
  assert.equal(content.hidden, false, 'Sidebar navigation clears filters synchronously');
  assert.equal(h.document.getElementById('biologia').hidden, false);
});

for (const renderer of ['legacy', 'missing']) {
  test(`dashboard keeps a working legacy fallback when React is ${renderer}`, async (t) => {
    const h = await bootDashboard(t, { renderer });
    const content = h.document.getElementById('markdown-sections');
    assert.equal(content.dataset.renderer, 'legacy');
    assert.equal(content.querySelectorAll('.resource-card').length, 82);
    assert.equal(h.calls.fetch.length, 1);
  });
}

test('a slow initial progress response cannot overwrite a fresher back-navigation update', async (t) => {
  const pending = [];
  const markdown = `# Kurs\n## Biologia\n${lessons(2)}`;
  const id = parser.parse(markdown).sections[0].items[0].id;
  const h = await bootDashboard(t, { markdown, loadProgress: () => new Promise((resolve) => pending.push(resolve)) });
  assert.equal(pending.length, 1);
  h.window.dispatchEvent(new h.window.Event('pageshow'));
  assert.equal(pending.length, 2);
  pending[1]({ records: { [id]: { progressPercent: 75 } } });
  await tick();
  const host = h.document.querySelector(`.card-progress-host[data-progress-host="${id}"]`);
  assert.match(host.textContent, /75%/);
  pending[0]({ records: { [id]: { progressPercent: 10 } } });
  await tick();
  assert.match(host.textContent, /75%/);
});
