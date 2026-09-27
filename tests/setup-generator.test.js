'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const dotenv = require('dotenv');
const envModel = require('../public/members/module/studio/env/env-model');
const setupModel = require('../public/members/module/studio/env/setup-model');
const { repositoryConfigs } = require('../netlify/content-repository');
const { renderSetupPage } = require('../scripts/setup.cjs');
const base = path.join(__dirname, '../public/members/module/studio/env');
const read = (name) => fs.readFileSync(path.join(base, name), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function configured(provider) {
  const entries = envModel.defaultEntries();
  const set = (name, value) => { const entry = entries.find((entry) => entry.name === name); if (entry) entry.value = value; else entries.push({ name, value, secret: envModel.looksSecret(name) }); };
  set('GIT_PROVIDER', provider); set('GITEA_BASE_URL', 'https://git.example.test'); set('NETLIFY_API_TOKEN', 'fixture-netlify'); set(setupModel.tokenFor(provider), 'fixture-content');
  const repos = [setupModel.blankRepository(provider), setupModel.blankRepository(provider, 1)];
  repos[0].repository = 'school/biology'; repos[1].repository = 'school/chemistry'; repos[1].ref = 'courses/2026'; repos[1].root = 'materialy/chemia';
  repos[1].tokenEnv = `${setupModel.tokenFor(provider)}_CHEMIA`;
  set(repos[1].tokenEnv, 'fixture-separate'); set(setupModel.repositoriesKey(provider), setupModel.repositoryJson(repos, provider));
  return { entries, set, repos };
}

for (const provider of ['gitea', 'github']) test(`generated ${provider} ENV and JSON are accepted by the actual repository backend`, () => {
  const { entries, repos } = configured(provider);
  const report = setupModel.inspect(entries);
  assert.deepEqual(report.errors, []); assert.equal(report.ready, true);
  const exported = dotenv.parse(envModel.serializeEnv(setupModel.selectedEntries(entries, { openai: false, gemini: false, payments: false, assets: false })));
  const configurations = repositoryConfigs(exported);
  assert.equal(configurations.length, 2); assert.ok(configurations.every((item) => item.configured));
  assert.equal(configurations[1].token, 'fixture-separate'); assert.equal(configurations[1].root, 'materialy/chemia');
  assert.equal(configurations[0].default, true); assert.equal(configurations[1].default, false);
  assert.equal(Object.keys(exported).some((name) => name.startsWith(provider === 'gitea' ? 'GITHUB_' : 'GITEA_')), false);
  assert.equal(Object.keys(exported).some((name) => /^(OPENAI|GEMINI|STRIPE)_/.test(name)), false);
  assert.equal(exported.SITE_ID, undefined, 'An empty optional local ID must not override the deployed Netlify project ID');
  assert.doesNotMatch(setupModel.repositoryJson(repos, provider), /fixture-/);
});

test('fresh defaults contain no installation-specific domains or repositories', () => {
  assert.doesNotMatch(envModel.serializeEnv(envModel.defaultEntries()), /nextmed\.edu|Kuczis|chemdisk-content/);
});

test('repository validation catches collisions, incompatible token names, unsafe paths and duplicate defaults', () => {
  const { repos } = configured('gitea');
  repos[1].id = repos[0].id; repos[1].default = true; repos[1].root = '../sekrety'; repos[1].tokenEnv = 'GITHUB_CONTENT_TOKEN';
  const errors = setupModel.validateRepositories(repos, 'gitea');
  assert.ok(errors.some((message) => /unikalny/.test(message)));
  assert.ok(errors.some((message) => /dokładnie jedno/.test(message)));
  assert.ok(errors.some((message) => /katalog/.test(message)));
  assert.ok(errors.some((message) => /dostawcy/.test(message)));
});

test('repository import preserves a missing default, custom token variables and legacy GitHub aliases', () => {
  const entries = envModel.mergeEntries(envModel.defaultEntries(), envModel.parseEnv('GITHUB_OWNER=school\nGITHUB_REPO=biology\nGITHUB_BRANCH=2026\nGITHUB_TOKEN=fixture-legacy\n').entries);
  assert.equal(setupModel.valuesOf(entries).GIT_PROVIDER, 'github');
  const [repo] = setupModel.readRepositories(entries, 'github');
  assert.equal(repo.repository, 'school/biology'); assert.equal(repo.ref, '2026'); assert.equal(repo.tokenEnv, 'GITHUB_TOKEN');
  entries.push({ name: 'GITEA_TOKEN_BIO', value: 'fixture-other' });
  const catalog = entries.find((entry) => entry.name === 'GITHUB_CONTENT_REPOSITORIES');
  catalog.value = '[{"id":"bio","label":"Biologia","repository":"school/biology","tokenEnv":"GITHUB_TOKEN_BIO"}]';
  assert.equal(setupModel.readRepositories(entries, 'github')[0].default, true);
  catalog.value = '[{"id":"bio","token":"do-not-render-this"}]';
  assert.throws(() => setupModel.readRepositories(entries, 'github'), /nieobsługiwane pola/);
  catalog.value = '{invalid'; assert.throws(() => setupModel.readRepositories(entries, 'github'), /niepoprawny JSON/);
});

test('repository links normalize only for the selected provider and trusted instance path', () => {
  assert.equal(setupModel.normalizeRepository('https://github.com/school/biology.git', 'github'), 'school/biology');
  assert.equal(setupModel.normalizeRepository('https://git.example.test/gitea/school/biology', 'gitea', 'https://git.example.test/gitea'), 'school/biology');
  for (const url of ['https://evil.test/school/biology', 'https://github.com/school/biology?token=secret', 'https://secret@github.com/school/biology']) assert.equal(setupModel.normalizeRepository(url, 'github'), url);
});

test('setup distinguishes missing deployment values from invalid configuration', () => {
  const { entries, set } = configured('github');
  set('NETLIFY_API_TOKEN', '');
  const incomplete = setupModel.inspect(entries, { payments: true, openai: true });
  assert.deepEqual(incomplete.errors, []); assert.equal(incomplete.ready, false);
  assert.ok(incomplete.missing.some((item) => item.label.includes('Netlify')));
  assert.ok(incomplete.missing.some((item) => item.label.includes('webhooka')));
  set('GITHUB_SITE_ASSETS_REPOSITORY', 'school/biology');
  assert.ok(setupModel.inspect(entries, { assets: true }).errors.some((message) => /oddzielone/.test(message)));
  set('GITHUB_SITE_ASSETS_REPOSITORY', 'school/public'); set('STRIPE_SECRET_KEY', 'pk_test_wrong');
  assert.ok(setupModel.inspect(entries, { payments: true }).errors.some((message) => /sk_test/.test(message)));
});

async function harness(t, { admin = true } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(read('index.html'), { url: 'https://course.example/members/module/studio/env/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window, d = w.document;
  let currentUser = { app_metadata: { roles: admin ? ['admin'] : ['active'] } }, copies = [], blobs = [];
  w.ChemAuth = { ready: Promise.resolve({ authenticated: true, session: { ok: true } }), getUser: () => currentUser };
  w.confirm = () => true;
  w.Blob = Blob; w.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:fixture'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (text) => copies.push(text) } });
  w.fetch = () => { throw new Error('Generator must never request a backend'); };
  await tick();
  for (const file of ['env-model.js', 'setup-model.js', 'setup.js', 'script.js']) w.eval(read(file));
  d.dispatchEvent(new w.Event('DOMContentLoaded')); await tick();
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  function input(selector, value) { const control = d.querySelector(selector); assert.ok(control, selector); control.value = value; control.dispatchEvent(new w.Event('input', { bubbles: true })); }
  const click = (selector) => { assert.ok(d.querySelector(selector), selector); d.querySelector(selector).click(); };
  function rawInput(name, value) {
    const row = [...d.querySelectorAll('.env-row')].find((row) => row.querySelector('.env-name').value === name);
    assert.ok(row, name);
    const control = row.querySelector('.env-value'); control.value = value;
    control.dispatchEvent(new w.Event('input', { bubbles: true }));
  }
  function importFile(source) {
    const control = d.getElementById('env-import');
    Object.defineProperty(control, 'files', { configurable: true, value: [{ size: 100, text: typeof source === 'function' ? source : async () => source }] });
    control.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  return { w, d, input, rawInput, importFile, click, copies, blobs, logout: () => { currentUser = null; w.dispatchEvent(new w.Event('chem-auth-user-changed')); } };
}

test('guided UI builds multi-repository JSON, preserves secrets across provider switches and exports only selected services', async (t) => {
  const h = await harness(t);
  h.click('[data-setup-provider="github"]'); h.input('#setup-content-token', 'fixture-github');
  h.input('[data-repository-field="repository"]', 'school/biology');
  h.click('#setup-add-repository'); h.input('[data-repository-index="1"] [data-repository-field="repository"]', 'school/chemistry');
  h.click('[data-repository-own="1"]'); h.input('[data-repository-index="1"] [data-repository-secret]', 'fixture-chemistry');
  h.input('[data-env-field="NETLIFY_API_TOKEN"]', 'fixture-netlify');
  h.click('[data-setup-feature="openai"]'); h.input('[data-env-field="OPENAI_API_KEY"]', 'fixture-openai');
  h.click('[data-setup-provider="gitea"]'); assert.equal(h.d.getElementById('setup-content-token').value, '');
  h.input('#setup-content-token', 'fixture-gitea');
  h.click('[data-setup-provider="github"]');
  assert.equal(h.d.getElementById('setup-content-token').value, 'fixture-github');
  assert.equal(h.d.querySelectorAll('.setup-repository').length, 2);
  assert.doesNotMatch(h.d.getElementById('env-output').value, /fixture-/);
  assert.equal(h.d.getElementById('env-copy').disabled, false);
  h.click('#env-copy'); await tick();
  const exported = dotenv.parse(h.copies[0]);
  assert.equal(exported.GITHUB_CONTENT_TOKEN, 'fixture-github'); assert.equal(exported.GITHUB_CONTENT_TOKEN_KURS_2, 'fixture-chemistry'); assert.equal(exported.OPENAI_API_KEY, 'fixture-openai');
  assert.equal(exported.GITEA_TOKEN, undefined); assert.equal(exported.GEMINI_API_KEY, undefined);
  assert.equal(repositoryConfigs(exported)[1].configured, true);
  h.click('#setup-download-json');
  const json = await h.blobs[0].text(); assert.doesNotMatch(json, /fixture-/); assert.equal(JSON.parse(json).length, 2);
});

test('invalid repository drafts block stale downloads and keep editable values', async (t) => {
  const h = await harness(t); h.click('[data-setup-provider="github"]'); h.input('[data-repository-field="repository"]', 'school/biology');
  assert.equal(h.d.getElementById('env-download').disabled, false);
  h.input('[data-repository-field="repository"]', 'invalid repo');
  assert.equal(h.d.getElementById('env-download').disabled, true); assert.equal(h.d.getElementById('env-output').value, '');
  assert.equal(h.d.querySelector('[data-repository-field="repository"]').value, 'invalid repo');
  assert.equal(h.d.getElementById('setup-download-json').disabled, true);
});

test('import replaces generated catalogs with legacy repository values and switches provider in both directions', async (t) => {
  const h = await harness(t);
  h.input('[data-repository-field="repository"]', 'previous/old');
  h.importFile('GITEA_BASE_URL=https://git.example.test\nGITEA_OWNER=school\nGITEA_REPO=biology\nGITEA_BRANCH=course-2026\nGITEA_TOKEN=fixture-gitea\n');
  await tick();
  assert.equal(h.d.querySelector('[data-repository-field="repository"]').value, 'school/biology');
  assert.equal(h.d.querySelector('[data-repository-field="ref"]').value, 'course-2026');
  h.click('[data-setup-provider="github"]'); h.input('#setup-content-token', 'fixture-old-github');
  h.importFile('GITHUB_OWNER=school\nGITHUB_REPO=chemistry\nGITHUB_BRANCH=semester\nGITHUB_TOKEN=fixture-legacy\n');
  await tick();
  assert.equal(h.d.querySelector('[data-repository-field="repository"]').value, 'school/chemistry');
  assert.equal(h.d.getElementById('setup-content-token').value, 'fixture-legacy');
  h.click('#env-copy'); await tick();
  assert.equal(repositoryConfigs(dotenv.parse(h.copies.at(-1)))[0].token, 'fixture-legacy');
  h.importFile('GITEA_BASE_URL=https://git.example.test\nGITEA_OWNER=school\nGITEA_REPO=physics\nGITEA_TOKEN=fixture-new\n');
  await tick();
  assert.equal(h.d.querySelector('[data-setup-provider="gitea"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.d.querySelector('[data-repository-field="repository"]').value, 'school/physics');
});

test('advanced editing immediately exports changed services while a round trip preserves disabled choices', async (t) => {
  const h = await harness(t);
  h.click('[data-setup-provider="github"]'); h.input('[data-repository-field="repository"]', 'school/biology');
  h.click('[data-setup-feature="openai"]'); h.input('[data-env-field="OPENAI_API_KEY"]', 'fixture-disabled');
  h.click('[data-setup-feature="openai"]');
  h.click('#env-advanced-mode'); h.click('#env-guided-mode');
  assert.equal(h.d.querySelector('[data-setup-feature="openai"]').checked, false);
  assert.doesNotMatch(h.d.getElementById('env-output').value, /OPENAI_API_KEY/);
  h.click('#env-advanced-mode'); h.rawInput('OPENAI_API_KEY', 'fixture-new');
  h.click('#env-copy'); await tick();
  assert.equal(dotenv.parse(h.copies.at(-1)).OPENAI_API_KEY, 'fixture-new');
  h.click('#env-guided-mode');
  assert.equal(h.d.querySelector('[data-setup-feature="openai"]').checked, true);
  assert.equal(h.d.querySelector('[data-env-field="OPENAI_API_KEY"]').value, 'fixture-new');
  h.click('#env-copy'); await tick();
  h.click('#env-advanced-mode'); h.click('#env-guided-mode');
  const unchanged = new h.w.Event('beforeunload', { cancelable: true }); h.w.dispatchEvent(unchanged);
  assert.equal(unchanged.defaultPrevented, false, 'Changing views alone must not invent an unsaved edit');
  h.click('[data-setup-feature="openai"]');
  const changed = new h.w.Event('beforeunload', { cancelable: true }); h.w.dispatchEvent(changed);
  assert.equal(changed.defaultPrevented, true, 'A changed service selection is part of the unsaved configuration');
});

test('older asynchronous imports cannot overwrite a newer file or reintroduce cleared secrets', async (t) => {
  const h = await harness(t);
  let complete;
  h.importFile(() => new Promise((resolve) => { complete = resolve; }));
  h.importFile('GITHUB_OWNER=school\nGITHUB_REPO=newest\nGITHUB_TOKEN=fixture-newest');
  await tick();
  complete('GITEA_OWNER=old\nGITEA_REPO=old\nGITEA_TOKEN=fixture-old'); await tick();
  assert.equal(h.d.querySelector('[data-repository-field="repository"]').value, 'school/newest');
  h.importFile(() => new Promise((resolve) => { complete = resolve; }));
  h.click('#env-clear'); complete('GITHUB_TOKEN=fixture-stale'); await tick();
  assert.equal(h.d.getElementById('setup-content-token').value, '');
  h.click('#env-advanced-mode');
  assert.ok([...h.d.querySelectorAll('.env-value')].every((input) => !input.value.includes('fixture-')));
});

test('session loss clears secrets and ordinary accounts never mount the generator', async (t) => {
  const denied = await harness(t, { admin: false }); assert.equal(denied.d.getElementById('env-app').hidden, true);
  const h = await harness(t); h.input('#setup-content-token', 'fixture-private'); h.logout();
  assert.equal(h.d.getElementById('env-app').hidden, true); assert.equal(h.d.querySelector('[type="password"]'), null);
  assert.doesNotMatch(h.d.body.textContent, /fixture-private/);
});

test('local setup page is self-contained and does not load authentication, analytics or external assets', () => {
  const html = renderSetupPage('test-nonce');
  assert.doesNotMatch(html, /<script[^>]+src=|<link\b|data-studio-page|identity\.netlify\.com|\/assets\/js\/auth\.js/);
  assert.match(html, /nonce="test-nonce"/); assert.match(html, /Działa lokalnie, bez logowania/);
  const source = fs.readFileSync(path.join(__dirname, '../scripts/setup.cjs'), 'utf8');
  assert.match(source, /connect-src 'none'/); assert.match(source, /server\.listen\(port, '127\.0\.0\.1'/);
  assert.doesNotMatch(source, /process\.env|readFileSync\([^)]*['"]\.env/);
});
