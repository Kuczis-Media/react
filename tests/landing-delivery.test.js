'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const delivery = require('../public/assets/js/landing-delivery-model.js');
const assets = require('../netlify/site-assets.js');
const landing = require('../netlify/landing-content.js');
const settingsEndpoint = require('../netlify/functions/admin-landing-settings.js');
const publisher = require('../netlify/functions/admin-landing.js');

const env = { GITHUB_SITE_ASSETS_TOKEN: 'private-test-token' };
const SHA = 'a'.repeat(40), NEW_SHA = 'b'.repeat(40);
const custom = { repository: 'NextMed/site', ref: 'release/site', path: 'pages/start.json' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const file = (body, sha = SHA) => ({ sha, type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(body)).toString('base64') });
const routePath = '/repos/Kuczis-Media/logo/contents/landing/route.json';
const oldPath = '/repos/Kuczis-Media/logo/contents/landing/config.json';
const newPath = '/repos/NextMed/site/contents/pages/start.json';
function github({ route, destination, privateRepo = false, rejectRoute = false } = {}) {
  const requests = [], writes = [];
  const currentModel = landing.defaultModel(); currentModel.branding.brandName = 'Current published brand';
  const files = new Map([[oldPath, file({ active: true, model: currentModel })]]);
  if (route) files.set(routePath, file(route));
  if (destination) files.set(newPath, file(destination));
  return {
    requests, writes, files, currentModel,
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url); requests.push({ url: String(url), options });
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body);
        writes.push({ path: parsed.pathname, body });
        if (parsed.pathname === routePath && rejectRoute) return response({}, 409);
        const decoded = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
        files.set(parsed.pathname, file(decoded, NEW_SHA));
        return response({ content: { sha: NEW_SHA }, commit: { sha: NEW_SHA } });
      }
      if (parsed.pathname.includes('/contents/')) return files.has(parsed.pathname) ? response(files.get(parsed.pathname)) : response({}, 404);
      if (parsed.pathname.includes('/branches/')) return response({ commit: { sha: SHA } });
      return response({ private: privateRepo && parsed.pathname === '/repos/NextMed/site' });
    }
  };
}
test.afterEach(() => assets._test.resetPublicCheck());

test('landing destinations normalize branch paths and reject traversal, reserved paths and redirect loops', () => {
  assert.equal(delivery.normalize().target.path, 'landing/config.json');
  assert.equal(delivery.normalize({ externalEnabled: true, externalUrl: 'start.netlify.app' }).externalUrl, 'https://start.netlify.app/');
  assert.equal(delivery.rawUrl(custom), 'https://raw.githubusercontent.com/NextMed/site/release%2Fsite/pages/start.json');
  for (const target of [
    { ...custom, repository: '../repo' }, { ...custom, ref: '../main' }, { ...custom, path: '../file.json' },
    { ...custom, path: '/config.json' }, { ...custom, path: 'secret.env' }, { ...delivery.DEFAULT_TARGET, path: delivery.ROUTE_PATH }
  ]) assert.throws(() => delivery.target(target));
  for (const externalUrl of ['javascript:alert(1)', 'http://start.example', 'https://user:secret@start.example', 'https://start.example:8080']) {
    assert.throws(() => delivery.normalize({ externalEnabled: true, externalUrl }), { code: 'INVALID_EXTERNAL_LANDING_URL' });
  }
  assert.throws(() => delivery.normalize({ externalEnabled: true, externalUrl: 'course.example' }, 'https://course.example'), { code: 'LANDING_REDIRECT_LOOP' });
  assert.equal(delivery.normalize({ externalEnabled: false, externalUrl: 'course.example' }, 'https://course.example').externalEnabled, false);
});

test('absent routing settings preserve the existing landing without writes', async () => {
  const api = github();
  const result = await assets.readLandingRoute(env, api);
  assert.deepEqual(result, { settings: delivery.normalize(), sha: null });
  assert.equal(api.writes.length, 0);
});

test('changing to a new location copies the publication before switching the route; old content remains intact', async () => {
  const api = github();
  const result = await assets.saveLandingRoute({ target: custom }, env, { ...api, expectedSha: null });
  assert.deepEqual(api.writes.map((item) => item.path), [newPath, routePath]);
  assert.equal(api.writes[0].body.branch, 'release/site');
  assert.equal(api.writes[0].body.sha, undefined);
  assert.equal(api.files.get(oldPath).sha, SHA);
  const copied = JSON.parse(Buffer.from(api.writes[0].body.content, 'base64').toString());
  assert.equal(copied.model.branding.brandName, 'Current published brand');
  assert.equal(result.configUrl, delivery.rawUrl(custom));
  assert.equal(result.sha, NEW_SHA);
  assert.doesNotMatch(JSON.stringify(result), /private-test-token/);
  assert.ok(api.requests.some((entry) => entry.url.includes('/branches/release%2Fsite')));
  assert.ok(api.requests.some((entry) => entry.url.includes('/pages/start.json?ref=release%2Fsite')));
});

test('an existing valid destination is selected without overwriting its content', async () => {
  const api = github({ destination: { active: true, model: landing.defaultModel() }, route: delivery.normalize() });
  await assets.saveLandingRoute({ target: custom }, env, { ...api, expectedSha: SHA });
  assert.deepEqual(api.writes.map((item) => item.path), [routePath]);
  assert.equal(api.writes[0].body.sha, SHA);
  assert.equal(api.files.get(newPath).sha, SHA);
});

test('private or invalid destinations cannot replace the current route or any file', async () => {
  for (const options of [{ privateRepo: true }, { destination: { unrelated: 'JSON data' } }]) {
    assets._test.resetPublicCheck();
    const api = github(options);
    await assert.rejects(() => assets.saveLandingRoute({ target: custom }, env, { ...api, expectedSha: null }),
      { code: options.privateRepo ? 'SITE_ASSETS_REPOSITORY_NOT_PUBLIC' : 'LANDING_STATIC_CONFIG_INVALID' });
    assert.equal(api.writes.length, 0);
  }
});

test('stale settings and races during the route write never change the active destination', async () => {
  const stale = github({ route: delivery.normalize() });
  await assert.rejects(() => assets.saveLandingRoute({ target: custom }, env, { ...stale, expectedSha: null }), { code: 'LANDING_CONFLICT' });
  assert.equal(stale.writes.length, 0);
  const race = github({ route: delivery.normalize(), rejectRoute: true });
  await assert.rejects(() => assets.saveLandingRoute({ target: custom }, env, { ...race, expectedSha: SHA }), { code: 'LANDING_CONFLICT' });
  assert.equal(race.files.get(routePath).sha, SHA);
  assert.ok(race.files.has(newPath)); // A safe copy may remain; the original and pointer are unchanged.
});

const user = { id: 'admin-1', app_metadata: { roles: ['admin'] } };
const context = { clientContext: { user, identity: { url: 'https://course.example/.netlify/identity' } } };
const headers = { authorization: 'Bearer test', 'content-type': 'application/json', origin: 'https://course.example', host: 'course.example', 'x-forwarded-proto': 'https' };

test('settings endpoint requires admin and same-origin mutation and passes the exact revision', async (t) => {
  t.mock.method(global, 'fetch', async () => response(user));
  const save = t.mock.method(assets, 'saveLandingRoute', async (settings, env, options) => ({ settings, sha: options.expectedSha }));
  assert.equal((await settingsEndpoint.handler({ httpMethod: 'PUT' })).statusCode, 401);
  const body = JSON.stringify({ settings: delivery.normalize(), expectedSha: SHA });
  const forbidden = await settingsEndpoint.handler({ httpMethod: 'PUT', headers: { ...headers, origin: 'https://evil.example' }, body }, context);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(save.mock.callCount(), 0);
  const saved = await settingsEndpoint.handler({ httpMethod: 'PUT', headers, body }, context);
  assert.equal(saved.statusCode, 200);
  assert.match(saved.headers['Cache-Control'], /no-store/);
  assert.equal(save.mock.calls[0].arguments[2].expectedSha, SHA);
  assert.equal(save.mock.calls[0].arguments[2].origin, 'https://course.example');
});

for (const storageAvailable of [false, true]) {
  test(`a builder opened before a destination change cannot publish to the newly selected file (${storageAvailable ? 'with' : 'without'} Blobs)`, async (t) => {
    const fetch = t.mock.method(global, 'fetch', async () => response(user));
    const store = {
      getWithMetadata: t.mock.fn(async () => null),
      set: t.mock.fn(async () => { throw new Error('Must not write Blobs'); })
    };
    // Netlify builds inherit SITE_ID and NETLIFY_API_TOKEN. Isolate storage
    // explicitly so those variables cannot open a real Blobs client whose
    // requests would accidentally receive the Identity-only fetch fixture.
    t.mock.method(landing, 'getLandingStore', () => {
      if (!storageAvailable) throw Object.assign(new Error('Storage not configured'), { code: 'LANDING_STORAGE_UNAVAILABLE' });
      return store;
    });
    const route = t.mock.method(assets, 'readLandingRoute', async () => ({ settings: delivery.normalize({ target: custom }), sha: NEW_SHA }));
    const save = t.mock.method(assets, 'publishLandingConfig', async () => { throw new Error('Must not write GitHub'); });
    const result = await publisher.handler({ httpMethod: 'POST', headers, body: JSON.stringify({
      action: 'publish', model: landing.defaultModel(), expectedPublishedSha: SHA, expectedRouteSha: SHA
    }) }, context);
    assert.equal(result.statusCode, 409);
    assert.equal(JSON.parse(result.body).error, 'LANDING_DESTINATION_CHANGED');
    assert.equal(route.mock.callCount(), 1);
    assert.equal(save.mock.callCount(), 0);
    assert.equal(store.set.mock.callCount(), 0);
    assert.deepEqual(store.getWithMetadata.mock.calls.map((call) => call.arguments[0]), storageAvailable ? [landing.PUBLICATION_KEY, landing.DRAFT_KEY] : []);
    assert.deepEqual(fetch.mock.calls.map((call) => String(call.arguments[0])), ['https://course.example/.netlify/identity/user']);
  });
}

async function sourceRun({ cache, publicationCache, publicationPayload = { active: false }, status = 200, payload = delivery.normalize({ target: custom }), offline = false, preview = false } = {}) {
  const storage = new Map(cache ? [['nextmed.landing.route.v2', JSON.stringify(cache)]] : []);
  if (publicationCache) storage.set('nextmed.landing.publication.v1', JSON.stringify(publicationCache));
  const calls = [];
  const context = {
    NextMedLandingDelivery: delivery, URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { search: preview ? '?landing-preview=1' : '' }, document: { querySelector: () => null },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => { calls.push({ url, options }); if (offline) throw new Error('offline'); return response(url === '/.netlify/functions/landing' ? publicationPayload : payload, status); }
  };
  context.window = context; context.parent = preview ? {} : context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/landing-source.js'), 'utf8'), context);
  return { settings: JSON.parse(JSON.stringify(await context.NextMedLandingSource.ready)), calls, storage };
}

test('public route resolves alongside one cached publication request, without credentials or polling', async () => {
  const result = await sourceRun();
  assert.deepEqual(result.settings.target, custom);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].url, delivery.ROUTE_URL);
  assert.equal(result.calls[0].options.credentials, 'omit');
  assert.equal(result.calls[0].options.headers, undefined);
  assert.equal(result.calls[1].url, '/.netlify/functions/landing');
  assert.equal(result.calls[1].options.cache, 'default');
  assert.equal(result.calls[1].options.credentials, 'omit');
  const cached = await sourceRun({ cache: { settings: result.settings, checkedAt: Date.now() }, publicationCache: { publication: null, checkedAt: Date.now() } });
  assert.equal(cached.calls.length, 0);
});

test('only an explicit Blob mode overrides GitHub; historical published data does not', async () => {
  const model = landing.defaultModel();
  const legacy = await sourceRun({ publicationPayload: { active: true, model } });
  assert.equal(legacy.settings.publication, undefined);
  const publication = { mode: 'netlify-blobs', version: '11111111-1111-4111-8111-111111111111', active: true, model };
  const active = await sourceRun({ publicationPayload: publication });
  assert.equal(active.settings.publication.mode, 'netlify-blobs');
  assert.equal(active.settings.publication.model.branding.brandName, 'NextMed');
  const offline = await sourceRun({ offline: true, publicationCache: { publication, checkedAt: Date.now() - 300_001 } });
  assert.equal(offline.settings.publication.mode, 'netlify-blobs');
});

test('route loading handles old installations, network failure and editor previews without blocking', async () => {
  assert.deepEqual((await sourceRun({ status: 404 })).settings, delivery.normalize());
  const settings = delivery.normalize({ target: custom });
  assert.deepEqual((await sourceRun({ offline: true, cache: { settings, checkedAt: Date.now() - 300_001 } })).settings, settings);
  assert.deepEqual((await sourceRun({ offline: true })).settings, { ...delivery.normalize(), unavailable: true });
  assert.equal((await sourceRun({ preview: true })).calls.length, 0);
});

test('landing route and publication reuse the cache after one minute and refresh after five minutes', async () => {
  const settings = delivery.normalize({ target: custom });
  const recent = Date.now() - 120_000;
  const warm = await sourceRun({ cache: { settings, checkedAt: recent }, publicationCache: { publication: null, checkedAt: recent } });
  assert.equal(warm.calls.length, 0, 'Another page visit needs no Function request while the cache is fresh');
  const expired = Date.now() - 300_001;
  const cold = await sourceRun({ cache: { settings, checkedAt: expired }, publicationCache: { publication: null, checkedAt: expired } });
  assert.equal(cold.calls.length, 2);
  assert.equal(cold.calls.filter((call) => call.url.startsWith('/.netlify/functions/')).length, 2);
});

test('route and publication outages do not cause another request on each page navigation', async () => {
  const failed = await sourceRun({ offline: true });
  assert.equal(failed.calls.length, 2);
  const nextPage = await sourceRun({ offline: true,
    cache: JSON.parse(failed.storage.get('nextmed.landing.route.v2')),
    publicationCache: JSON.parse(failed.storage.get('nextmed.landing.publication.v1'))
  });
  assert.equal(nextPage.calls.length, 0);
  assert.deepEqual(nextPage.settings, { ...delivery.normalize(), unavailable: true });
});
