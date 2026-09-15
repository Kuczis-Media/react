const test = require('node:test');
const assert = require('node:assert/strict');

const adminDashboard = require('../netlify/functions/admin-dashboard.js');
const withRequiredHelp = adminDashboard._test.ensureRequiredHelpSection;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_URL = 'https://course.example/.netlify/identity';
const CLIENT_TOKEN = 'verified-client-jwt';

const canonicalUser = (roles, appMetadata = {}) => ({
  id: USER_ID,
  email: 'user@example.com',
  app_metadata: { ...appMetadata, roles }
});

const contextFor = (tokenUser = canonicalUser(['admin'])) => ({
  clientContext: {
    user: tokenUser,
    identity: { url: IDENTITY_URL }
  }
});

const eventFor = (overrides = {}) => ({
  httpMethod: 'GET',
  headers: { authorization: `Bearer ${CLIENT_TOKEN}` },
  ...overrides
});

const mutationHeaders = (overrides = {}) => ({
  authorization: `Bearer ${CLIENT_TOKEN}`,
  'content-type': 'application/json; charset=utf-8',
  origin: 'https://course.example',
  host: 'course.example',
  'x-forwarded-proto': 'https',
  ...overrides
});

const responseJson = (body, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } }
);

function installFetch(t, implementation) {
  const original = global.fetch;
  global.fetch = implementation;
  t.after(() => { global.fetch = original; });
}

function installCanonicalFetch(t, user) {
  const requests = [];
  installFetch(t, async (url, options) => {
    requests.push({ url: String(url), options });
    return responseJson(user);
  });
  return requests;
}

function installStore(t, storeOrFactory) {
  const factory = typeof storeOrFactory === 'function'
    ? storeOrFactory
    : () => storeOrFactory;
  adminDashboard._test.setStoreFactory(factory);
  t.after(() => adminDashboard._test.setStoreFactory(null));
}

function withDashboardEnvironment(values, callback) {
  const originalToken = process.env.NETLIFY_API_TOKEN;
  const originalSiteId = process.env.SITE_ID;
  if (values.token == null) delete process.env.NETLIFY_API_TOKEN;
  else process.env.NETLIFY_API_TOKEN = values.token;
  if (values.siteId == null) delete process.env.SITE_ID;
  else process.env.SITE_ID = values.siteId;
  try {
    return callback();
  } finally {
    if (originalToken === undefined) delete process.env.NETLIFY_API_TOKEN;
    else process.env.NETLIFY_API_TOKEN = originalToken;
    if (originalSiteId === undefined) delete process.env.SITE_ID;
    else process.env.SITE_ID = originalSiteId;
  }
}

class MemoryStore {
  constructor(entry = null) {
    this.entry = entry && {
      data: entry.data,
      etag: entry.etag,
      metadata: { ...(entry.metadata || {}) }
    };
    this.sequence = 0;
    this.calls = [];
  }

  async getWithMetadata(key, options) {
    this.calls.push({ method: 'getWithMetadata', key, options });
    return this.entry && {
      data: this.entry.data,
      etag: this.entry.etag,
      metadata: { ...this.entry.metadata }
    };
  }

  async getMetadata(key, options) {
    this.calls.push({ method: 'getMetadata', key, options });
    return this.entry && {
      etag: this.entry.etag,
      metadata: { ...this.entry.metadata }
    };
  }

  async set(key, data, options = {}) {
    this.calls.push({ method: 'set', key, data, options });
    if (options.onlyIfNew && this.entry) {
      const error = new Error('precondition failed');
      error.status = 412;
      throw error;
    }
    if (options.onlyIfMatch && (!this.entry || this.entry.etag !== options.onlyIfMatch)) {
      const error = new Error('precondition failed');
      error.status = 412;
      throw error;
    }
    this.sequence += 1;
    this.entry = {
      data,
      etag: `etag-${this.sequence}`,
      metadata: { ...(options.metadata || {}) }
    };
    return { modified: true };
  }

  async delete(key) {
    this.calls.push({ method: 'delete', key });
    this.entry = null;
  }
}

test('dashboard Blob configuration uses server-side Netlify credentials', () => {
  withDashboardEnvironment({
    token: 'netlify-personal-token-for-tests',
    siteId: '11111111-2222-4333-8444-555555555555'
  }, () => {
    assert.deepEqual(adminDashboard._test.dashboardStoreConfig(), {
      token: 'netlify-personal-token-for-tests',
      siteId: '11111111-2222-4333-8444-555555555555'
    });
  });
});

test('dashboard Blob configuration rejects missing or malformed credentials', () => {
  for (const values of [
    {},
    { token: 'short', siteId: 'valid-site-id' },
    { token: 'netlify-personal-token-for-tests', siteId: 'bad/site/id' },
    { token: 'netlify token with spaces', siteId: 'valid-site-id' }
  ]) {
    withDashboardEnvironment(values, () => {
      assert.equal(adminDashboard._test.dashboardStoreConfig(), null);
    });
  }
});

test('GET dashboard override requires canonical course access, not stale token claims', async (t) => {
  const store = new MemoryStore({ data: '# Secret', etag: 'etag-secret' });
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser([]));

  const response = await adminDashboard.handler(
    eventFor(),
    contextFor(canonicalUser(['active']))
  );
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: 'ACCESS_REQUIRED' });
  assert.equal(store.calls.length, 0);
});

test('GET accepts active and valid timed canonical users and reads Blob strongly', async (t) => {
  const updatedAt = '2026-07-15T10:00:00.000Z';
  const store = new MemoryStore({
    data: '# Kurs\n\nTreść',
    etag: 'etag-live',
    metadata: { updatedAt }
  });
  installStore(t, store);
  const users = [
    canonicalUser(['active']),
    canonicalUser(['week'], {
      timed_access: {
        role: 'week',
        active: true,
        expires_at: '2099-07-22T10:00:00.000Z'
      }
    })
  ];
  installFetch(t, async () => responseJson(users.shift()));

  for (let index = 0; index < 2; index += 1) {
    const response = await adminDashboard.handler(eventFor(), contextFor());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      content: withRequiredHelp('# Kurs\n\nTreść'),
      source: 'blob',
      etag: 'etag-live',
      updatedAt
    });
  }
  assert.deepEqual(store.calls[0], {
    method: 'getWithMetadata',
    key: 'dashboard.md',
    options: { type: 'text', consistency: 'strong' }
  });
});

test('GET rejects expired timed access before opening Blob storage', async (t) => {
  const store = new MemoryStore({ data: '# Secret', etag: 'etag-secret' });
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['week'], {
    timed_access: {
      role: 'week',
      active: true,
      expires_at: '2020-01-01T00:00:00.000Z'
    }
  }));

  const response = await adminDashboard.handler(eventFor(), contextFor());
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, 'ACCESS_EXPIRED');
  assert.equal(store.calls.length, 0);
});

test('GET returns an explicit static fallback when no runtime override exists', async (t) => {
  const store = new MemoryStore();
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['active']));

  const response = await adminDashboard.handler(eventFor(), contextFor());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    source: 'static',
    fallbackUrl: '/members/dashboard.md'
  });
});

test('GET treats an atomic restore tombstone as the static fallback', async (t) => {
  const store = new MemoryStore({
    data: '',
    etag: 'etag-tombstone',
    metadata: { state: 'deleted', updatedAt: '2026-07-15T10:00:00.000Z' }
  });
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['active']));

  const response = await adminDashboard.handler(eventFor(), contextFor());
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).source, 'static');
});

test('GET treats malformed or oversized Blob records as invalid and preserves fallback', async (t) => {
  const stores = [
    new MemoryStore({ data: '# Missing ETag', etag: '' }),
    new MemoryStore({ data: 'x'.repeat(adminDashboard._test.MAX_MARKDOWN_BYTES + 1), etag: 'etag-big' })
  ];
  installStore(t, () => stores.shift());
  installFetch(t, async () => responseJson(canonicalUser(['active'])));

  for (let index = 0; index < 2; index += 1) {
    const response = await adminDashboard.handler(eventFor(), contextFor());
    assert.equal(response.statusCode, 502);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'DASHBOARD_STORAGE_INVALID',
      fallbackUrl: '/members/dashboard.md'
    });
  }
});

test('PUT requires canonical admin plus same-origin JSON before touching storage', async (t) => {
  const store = new MemoryStore();
  installStore(t, store);
  let canonicalCalls = 0;
  installFetch(t, async () => {
    canonicalCalls += 1;
    return responseJson(canonicalUser(['active']));
  });

  const crossOrigin = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders({ origin: 'https://evil.example' }),
    body: JSON.stringify({ content: '# Kurs', expectedEtag: null })
  }), contextFor());
  assert.equal(crossOrigin.statusCode, 403);
  assert.equal(JSON.parse(crossOrigin.body).error, 'SAME_ORIGIN_REQUIRED');
  assert.equal(canonicalCalls, 0);

  const staleAdmin = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({ content: '# Kurs', expectedEtag: null })
  }), contextFor(canonicalUser(['admin'])));
  assert.equal(staleAdmin.statusCode, 403);
  assert.equal(JSON.parse(staleAdmin.body).error, 'ADMIN_REQUIRED');
  assert.equal(store.calls.length, 0);
});

test('PUT creates a normalized Markdown override with an atomic only-if-new write', async (t) => {
  const store = new MemoryStore();
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['admin']));

  const response = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({
      content: '# Dashboard\r\n\r\nTreść',
      expectedEtag: null
    })
  }), contextFor());
  const payload = JSON.parse(response.body);
  const expectedContent = withRequiredHelp('# Dashboard\n\nTreść');

  assert.equal(response.statusCode, 200);
  assert.equal(payload.content, expectedContent);
  assert.equal(payload.source, 'blob');
  assert.equal(payload.etag, 'etag-1');
  assert.ok(Number.isFinite(Date.parse(payload.updatedAt)));

  const setCall = store.calls.find((call) => call.method === 'set');
  assert.equal(setCall.key, 'dashboard.md');
  assert.equal(setCall.data, expectedContent);
  assert.equal(setCall.options.onlyIfNew, true);
  assert.equal(setCall.options.onlyIfMatch, undefined);
  assert.equal(setCall.options.metadata.updatedBy, USER_ID);
  assert.equal(setCall.options.metadata.state, 'active');
  assert.ok(Number.isFinite(Date.parse(setCall.options.metadata.updatedAt)));
});

test('PUT atomically replaces a restore tombstone when the editor expects the static version', async (t) => {
  const store = new MemoryStore({
    data: '',
    etag: 'etag-tombstone',
    metadata: { state: 'deleted' }
  });
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['admin']));

  const response = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({ content: '# New override', expectedEtag: null })
  }), contextFor());

  assert.equal(response.statusCode, 200);
  const setCall = store.calls.find((call) => call.method === 'set');
  assert.equal(setCall.options.onlyIfNew, undefined);
  assert.equal(setCall.options.onlyIfMatch, 'etag-tombstone');
  assert.equal(store.entry.metadata.state, 'active');
});

test('PUT updates an existing override only with the exact current ETag', async (t) => {
  const store = new MemoryStore({
    data: '# Old',
    etag: 'etag-old',
    metadata: { updatedAt: '2026-01-01T00:00:00.000Z' }
  });
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['admin']));

  const response = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({ content: '# New', expectedEtag: 'etag-old' })
  }), contextFor());
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).content, withRequiredHelp('# New'));
  const setCall = store.calls.find((call) => call.method === 'set');
  assert.equal(setCall.options.onlyIfMatch, 'etag-old');
  assert.equal(setCall.options.onlyIfNew, undefined);
});

test('dashboard content always keeps the required Help and account section', () => {
  const withoutHelp = '# Dashboard\n\n## Materiały\n\n- [Lekcja](/members/module/lesson/)';
  const normalized = withRequiredHelp(withoutHelp);

  assert.match(normalized, /^## Pomoc i konto$/m);
  assert.match(normalized, /\[Status dostępu\]\(\/time\)/);
  assert.match(normalized, /\[Napisz do nas\]\(\/members\/module\/contact\//);
  assert.equal(withRequiredHelp(normalized), normalized);

  const commentOnly = `${withoutHelp}\n\n<!-- ## Pomoc i konto -->`;
  assert.match(withRequiredHelp(commentOnly), /\n## Pomoc i konto\n/);
});

test('PUT reports deterministic ETag conflicts without overwriting newer content', async (t) => {
  const store = new MemoryStore({ data: '# Newer', etag: 'etag-newer' });
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['admin']));

  const stale = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({ content: '# My edit', expectedEtag: 'etag-old' })
  }), contextFor());
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(JSON.parse(stale.body), {
    error: 'DASHBOARD_CONFLICT',
    currentEtag: 'etag-newer'
  });
  assert.equal(store.calls.some((call) => call.method === 'set'), false);
  assert.equal(store.entry.data, '# Newer');

  store.calls.length = 0;
  const assumedNew = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({ content: '# My edit', expectedEtag: null })
  }), contextFor());
  assert.equal(assumedNew.statusCode, 409);
  assert.equal(store.calls.some((call) => call.method === 'set'), false);
});

test('PUT treats a conditional Blob write returning modified=false as a conflict', async (t) => {
  const store = {
    async getMetadata() { return null; },
    async set() { return { modified: false }; },
    async getWithMetadata() { throw new Error('must not read a rejected write as success'); }
  };
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['admin']));

  const response = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({ content: '# My edit', expectedEtag: null })
  }), contextFor());

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'DASHBOARD_CONFLICT',
    currentEtag: null
  });
});

test('PUT validates Markdown, request shape, size and required ETag', async (t) => {
  const store = new MemoryStore();
  installStore(t, store);
  installFetch(t, async () => responseJson(canonicalUser(['admin'])));

  const cases = [
    [{ content: '# Missing etag' }, 'EXPECTED_ETAG_REQUIRED'],
    [{ content: '', expectedEtag: null }, 'INVALID_MARKDOWN'],
    [{ content: '# Null\u0000byte', expectedEtag: null }, 'INVALID_MARKDOWN'],
    [{ content: '# Fine', expectedEtag: 'bad\netag' }, 'INVALID_ETAG'],
    [{ content: '# Fine', expectedEtag: null, unknown: true }, 'UNEXPECTED_FIELDS']
  ];
  for (const [body, error] of cases) {
    const response = await adminDashboard.handler(eventFor({
      httpMethod: 'PUT',
      headers: mutationHeaders(),
      body: JSON.stringify(body)
    }), contextFor());
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error, error);
  }
  assert.equal(store.calls.some((call) => call.method === 'set'), false);

  const tooLarge = adminDashboard._test.validateWrite({
    content: 'ą'.repeat((adminDashboard._test.MAX_MARKDOWN_BYTES / 2) + 1),
    expectedEtag: null
  });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.code, 'MARKDOWN_TOO_LARGE');
});

test('DELETE atomically tombstones an override only with its current ETag and exposes static fallback', async (t) => {
  const store = new MemoryStore({ data: '# Runtime', etag: 'etag-current' });
  installStore(t, store);
  installFetch(t, async () => responseJson(canonicalUser(['admin'])));

  const conflict = await adminDashboard.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ expectedEtag: 'etag-stale' })
  }), contextFor());
  assert.equal(conflict.statusCode, 409);
  assert.equal(store.entry.data, '# Runtime');

  const removed = await adminDashboard.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ expectedEtag: 'etag-current' })
  }), contextFor());
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(JSON.parse(removed.body), {
    deleted: true,
    alreadyAbsent: false,
    source: 'static',
    fallbackUrl: '/members/dashboard.md'
  });
  assert.equal(store.entry.data, '');
  assert.equal(store.entry.metadata.state, 'deleted');
  assert.equal(store.entry.metadata.updatedBy, USER_ID);

  const fallback = await adminDashboard.handler(eventFor(), contextFor());
  assert.equal(fallback.statusCode, 200);
  assert.equal(JSON.parse(fallback.body).source, 'static');

  const alreadyAbsent = await adminDashboard.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ expectedEtag: null })
  }), contextFor());
  assert.equal(alreadyAbsent.statusCode, 200);
  assert.equal(JSON.parse(alreadyAbsent.body).alreadyAbsent, true);
});

test('DELETE does not erase a concurrent dashboard edit when its conditional write loses the race', async (t) => {
  const store = new MemoryStore({ data: '# Runtime', etag: 'etag-current' });
  const originalSet = store.set.bind(store);
  store.set = async (key, data, options) => {
    if (options && options.metadata && options.metadata.state === 'deleted') {
      store.entry = {
        data: '# Concurrent edit',
        etag: 'etag-concurrent',
        metadata: { state: 'active' }
      };
    }
    return originalSet(key, data, options);
  };
  installStore(t, store);
  installCanonicalFetch(t, canonicalUser(['admin']));

  const response = await adminDashboard.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ expectedEtag: 'etag-current' })
  }), contextFor());

  assert.equal(response.statusCode, 409);
  assert.equal(store.entry.data, '# Concurrent edit');
  assert.equal(store.entry.metadata.state, 'active');
});

test('DELETE rejects missing ETag and non-admin callers without changing content', async (t) => {
  const store = new MemoryStore({ data: '# Runtime', etag: 'etag-current' });
  installStore(t, store);
  const users = [canonicalUser(['admin']), canonicalUser(['active'])];
  installFetch(t, async () => responseJson(users.shift()));

  const missing = await adminDashboard.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: '{}'
  }), contextFor());
  assert.equal(missing.statusCode, 400);
  assert.equal(JSON.parse(missing.body).error, 'EXPECTED_ETAG_REQUIRED');

  const nonAdmin = await adminDashboard.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ expectedEtag: 'etag-current' })
  }), contextFor());
  assert.equal(nonAdmin.statusCode, 403);
  assert.equal(JSON.parse(nonAdmin.body).error, 'ADMIN_REQUIRED');
  assert.equal(store.entry.data, '# Runtime');
});

test('Blob initialization/read failures return safe fallback and Blob conflicts map to 409', async (t) => {
  const factories = [
    () => { throw new Error('Blobs unavailable'); },
    () => ({
      async getWithMetadata() { throw new Error('storage network error'); }
    }),
    () => ({
      async getMetadata() { return null; },
      async set() {
        const error = new Error('precondition conflict');
        error.statusCode = 412;
        throw error;
      }
    })
  ];
  installStore(t, () => factories.shift()());
  const users = [canonicalUser(['active']), canonicalUser(['active']), canonicalUser(['admin'])];
  installFetch(t, async () => responseJson(users.shift()));

  for (let index = 0; index < 2; index += 1) {
    const response = await adminDashboard.handler(eventFor(), contextFor());
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'DASHBOARD_STORAGE_UNAVAILABLE',
      source: 'static',
      fallbackUrl: '/members/dashboard.md'
    });
  }

  const conflict = await adminDashboard.handler(eventFor({
    httpMethod: 'PUT',
    headers: mutationHeaders(),
    body: JSON.stringify({ content: '# Runtime', expectedEtag: null })
  }), contextFor());
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(JSON.parse(conflict.body), {
    error: 'DASHBOARD_CONFLICT',
    currentEtag: null
  });
});

test('unsupported methods and preflight advertise only the intended contract', async () => {
  const options = await adminDashboard.handler({ httpMethod: 'OPTIONS' }, {});
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers.Allow, 'GET, PUT, DELETE, OPTIONS');

  const post = await adminDashboard.handler({ httpMethod: 'POST' }, {});
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.Allow, 'GET, PUT, DELETE, OPTIONS');
});
