const test = require('node:test');
const assert = require('node:assert/strict');

const adminForms = require('../netlify/functions/admin-forms.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_URL = 'https://course.example/.netlify/identity';
const CLIENT_TOKEN = 'verified-client-jwt';
const API_TOKEN = 'netlify-api-token-long-enough-for-tests';
const SITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const canonicalAdmin = {
  id: ADMIN_ID,
  email: 'admin@example.com',
  app_metadata: { roles: ['admin', 'active'] }
};

const contextFor = (tokenUser = canonicalAdmin) => ({
  clientContext: {
    user: tokenUser,
    identity: { url: IDENTITY_URL }
  }
});

const eventFor = (overrides = {}) => ({
  httpMethod: 'GET',
  headers: { authorization: `Bearer ${CLIENT_TOKEN}` },
  queryStringParameters: {},
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

const responseJson = (body, status = 200, headers = {}) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } }
);

function installFetch(t, implementation) {
  const original = global.fetch;
  global.fetch = implementation;
  t.after(() => { global.fetch = original; });
}

function installFormsEnv(t, values = { token: API_TOKEN, siteId: SITE_ID }) {
  const originalToken = process.env.NETLIFY_API_TOKEN;
  const originalSite = process.env.SITE_ID;
  if (values.token == null) delete process.env.NETLIFY_API_TOKEN;
  else process.env.NETLIFY_API_TOKEN = values.token;
  if (values.siteId == null) delete process.env.SITE_ID;
  else process.env.SITE_ID = values.siteId;
  t.after(() => {
    if (originalToken === undefined) delete process.env.NETLIFY_API_TOKEN;
    else process.env.NETLIFY_API_TOKEN = originalToken;
    if (originalSite === undefined) delete process.env.SITE_ID;
    else process.env.SITE_ID = originalSite;
  });
}

test('forms administration requires a freshly verified canonical administrator', async (t) => {
  installFormsEnv(t);
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return responseJson({ id: ADMIN_ID, app_metadata: { roles: ['active'] } });
  });

  const response = await adminForms.handler(
    eventFor(),
    contextFor({ id: ADMIN_ID, app_metadata: { roles: ['admin'] } })
  );
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: 'ADMIN_REQUIRED' });
  assert.equal(calls, 1, 'Netlify Forms API must not be called after canonical denial');
});

test('missing or malformed server-only Forms configuration fails safely after authentication', async (t) => {
  installFormsEnv(t, { token: null, siteId: null });
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return responseJson(canonicalAdmin);
  });

  const missing = await adminForms.handler(eventFor(), contextFor());
  assert.equal(missing.statusCode, 503);
  assert.deepEqual(JSON.parse(missing.body), { error: 'NETLIFY_FORMS_NOT_CONFIGURED' });
  assert.equal(calls, 1);

  process.env.NETLIFY_API_TOKEN = 'short';
  process.env.SITE_ID = SITE_ID;
  assert.equal(adminForms._test.formsConfig(), null);
  process.env.NETLIFY_API_TOKEN = API_TOKEN;
  process.env.SITE_ID = '../foreign-site';
  assert.equal(adminForms._test.formsConfig(), null);
});

test('GET lists only normalized forms belonging to the configured site', async (t) => {
  installFormsEnv(t);
  const requests = [];
  installFetch(t, async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    return responseJson([
      {
        id: 'form-one',
        name: 'Kontakt',
        paths: ['/kontakt', 7, '/members/contact'],
        submission_count: 3,
        created_at: '2026-07-01T10:00:00.000Z',
        private_setting: 'must-not-leak'
      },
      { id: '../../invalid', name: 'Invalid' },
      null
    ]);
  });

  const response = await adminForms.handler(eventFor(), contextFor());
  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload, {
    forms: [{
      id: 'form-one',
      name: 'Kontakt',
      paths: ['/kontakt', '/members/contact'],
      submissionCount: 3,
      createdAt: '2026-07-01T10:00:00.000Z'
    }],
    selectedForm: null,
    submissions: [],
    pagination: null,
    filter: ''
  });
  assert.equal(requests[1].url, `https://api.netlify.com/api/v1/sites/${SITE_ID}/forms`);
  assert.equal(requests[1].options.headers.Authorization, `Bearer ${API_TOKEN}`);
  assert.equal(response.body.includes('private_setting'), false);
  assert.equal(response.body.includes(API_TOKEN), false);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('selected form is scoped through the site form list before submissions are requested', async (t) => {
  installFormsEnv(t);
  const requests = [];
  installFetch(t, async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    return responseJson([{ id: 'allowed-form', name: 'Allowed' }]);
  });

  const response = await adminForms.handler(eventFor({
    queryStringParameters: { formId: 'foreign-form' }
  }), contextFor());
  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'FORM_NOT_FOUND' });
  assert.equal(requests.some((url) => url.includes('/forms/foreign-form/submissions')), false);
});

test('GET submissions applies safe page scoping and returns signed delete capabilities', async (t) => {
  installFormsEnv(t);
  const requests = [];
  installFetch(t, async (url, options) => {
    const request = { url: String(url), options };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.endsWith(`/sites/${SITE_ID}/forms`)) {
      return responseJson([
        { id: 'form-one', name: 'Kontakt', submission_count: 30 },
        { id: 'form-two', name: 'Zapisy', submission_count: 2 }
      ]);
    }
    return responseJson([
      {
        id: 'submission-one',
        number: 21,
        email: 'jan@example.com',
        name: 'Jan Kowalski',
        data: {
          email: 'jan@example.com',
          message: 'Proszę o kontakt',
          constructor: 'must-not-be-copied'
        },
        created_at: '2026-07-15T10:00:00.000Z',
        ip: 'must-not-leak'
      },
      {
        id: 'submission-two',
        email: 'anna@example.com',
        data: { message: 'Inna wiadomość' }
      }
    ], 200, { 'x-total-count': '30' });
  });

  const response = await adminForms.handler(eventFor({
    queryStringParameters: {
      formId: 'form-one',
      page: '2',
      perPage: '10',
      q: 'JAN'
    }
  }), contextFor());
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.selectedForm.id, 'form-one');
  assert.equal(payload.submissions.length, 1);
  assert.equal(payload.submissions[0].id, 'submission-one');
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.submissions[0].data, 'constructor'),
    false
  );
  assert.equal(payload.submissions[0].ip, undefined);
  assert.equal(typeof payload.submissions[0].deleteToken, 'string');
  assert.equal(payload.submissions[0].deleteToken.split('.').length, 2);
  assert.equal(adminForms._test.verifyDeleteCapability(
    payload.submissions[0].deleteToken,
    API_TOKEN,
    Date.now()
  ).ok, true);
  assert.deepEqual(payload.pagination, {
    page: 2,
    perPage: 10,
    count: 2,
    visibleCount: 1,
    hasMore: true,
    total: 30
  });
  assert.equal(payload.filterScope, 'current-page');
  assert.match(requests[2].url, /\/forms\/form-one\/submissions\?page=2&per_page=10$/);
});

test('invalid form IDs and filters are rejected before the submission API call', async (t) => {
  installFormsEnv(t);
  let formsCalls = 0;
  installFetch(t, async (url) => {
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    formsCalls += 1;
    return responseJson([]);
  });

  const invalidId = await adminForms.handler(eventFor({
    queryStringParameters: { formId: '../secret' }
  }), contextFor());
  assert.equal(invalidId.statusCode, 400);
  assert.equal(JSON.parse(invalidId.body).error, 'INVALID_FORM_ID');

  const invalidFilter = await adminForms.handler(eventFor({
    queryStringParameters: { q: 'a'.repeat(101) }
  }), contextFor());
  assert.equal(invalidFilter.statusCode, 400);
  assert.equal(JSON.parse(invalidFilter.body).error, 'INVALID_FILTER');
  assert.equal(formsCalls, 0);
});

test('DELETE rejects cross-origin and non-JSON requests before authentication or API access', async (t) => {
  installFormsEnv(t);
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return responseJson(canonicalAdmin);
  });

  const crossOrigin = await adminForms.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders({ origin: 'https://evil.example' }),
    body: '{}'
  }), contextFor());
  assert.equal(crossOrigin.statusCode, 403);
  assert.equal(JSON.parse(crossOrigin.body).error, 'SAME_ORIGIN_REQUIRED');

  const nonJson = await adminForms.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders({ 'content-type': 'text/plain' }),
    body: '{}'
  }), contextFor());
  assert.equal(nonJson.statusCode, 415);
  assert.equal(JSON.parse(nonJson.body).error, 'JSON_REQUIRED');
  assert.equal(calls, 0);
});

test('signed delete capability is bound to site and submission and detects tampering/expiry', () => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  const token = adminForms._test.createDeleteCapability({
    siteId: SITE_ID,
    formId: 'form-one',
    submissionId: 'submission-one',
    expiresAt: now + (10 * 60 * 1000)
  }, API_TOKEN);

  const verified = adminForms._test.verifyDeleteCapability(token, API_TOKEN, now);
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.value, {
    siteId: SITE_ID,
    formId: 'form-one',
    submissionId: 'submission-one',
    expiresAt: now + (10 * 60 * 1000)
  });

  const [payload, signature] = token.split('.');
  assert.equal(adminForms._test.verifyDeleteCapability(
    `${payload}.${signature.slice(0, -1)}x`,
    API_TOKEN,
    now
  ).code, 'DELETE_CAPABILITY_INVALID');
  assert.equal(adminForms._test.verifyDeleteCapability(
    token,
    'different-server-secret-token',
    now
  ).code, 'DELETE_CAPABILITY_INVALID');
  assert.equal(adminForms._test.verifyDeleteCapability(
    token,
    API_TOKEN,
    now + (11 * 60 * 1000)
  ).code, 'DELETE_CAPABILITY_EXPIRED');
});

test('valid signed capability permanently deletes only its bound submission', async (t) => {
  installFormsEnv(t);
  const requests = [];
  installFetch(t, async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    return new Response(null, { status: 204 });
  });

  const deleteToken = adminForms._test.createDeleteCapability({
    siteId: SITE_ID,
    formId: 'form-one',
    submissionId: 'submission-one',
    expiresAt: Date.now() + (10 * 60 * 1000)
  }, API_TOKEN);
  const response = await adminForms.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ submissionId: 'submission-one', deleteToken })
  }), contextFor());

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    deleted: true,
    submissionId: 'submission-one'
  });
  const deletion = requests.find((request) => request.options.method === 'DELETE');
  assert.ok(deletion);
  assert.equal(
    deletion.url,
    'https://api.netlify.com/api/v1/submissions/submission-one'
  );
  assert.equal(deletion.options.headers.Authorization, `Bearer ${API_TOKEN}`);

  requests.length = 0;
  const mismatch = await adminForms.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ submissionId: 'submission-two', deleteToken })
  }), contextFor());
  assert.equal(mismatch.statusCode, 403);
  assert.equal(JSON.parse(mismatch.body).error, 'DELETE_CAPABILITY_INVALID');
  assert.equal(requests.some((request) => request.options.method === 'DELETE'), false);
});

test('DELETE rejects missing capability, unexpected fields and upstream token failures safely', async (t) => {
  installFormsEnv(t);
  let apiCalls = 0;
  installFetch(t, async (url) => {
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    apiCalls += 1;
    return responseJson({ message: 'token rejected' }, 401);
  });

  const missing = await adminForms.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ submissionId: 'submission-one' })
  }), contextFor());
  assert.equal(missing.statusCode, 403);
  assert.equal(JSON.parse(missing.body).error, 'DELETE_CAPABILITY_REQUIRED');

  const unexpected = await adminForms.handler(eventFor({
    httpMethod: 'DELETE',
    headers: mutationHeaders(),
    body: JSON.stringify({ submissionId: 'submission-one', deleteToken: 'x', admin: true })
  }), contextFor());
  assert.equal(unexpected.statusCode, 400);
  assert.equal(JSON.parse(unexpected.body).error, 'UNEXPECTED_FIELDS');
  assert.equal(apiCalls, 0);

  const list = await adminForms.handler(eventFor(), contextFor());
  assert.equal(list.statusCode, 503);
  assert.equal(JSON.parse(list.body).error, 'NETLIFY_FORMS_TOKEN_REJECTED');
});

test('submission sanitizer bounds nested untrusted data and strips prototype keys', () => {
  const malicious = JSON.parse(`{
    "safe": "value",
    "__proto__": {"polluted": true},
    "prototype": "bad",
    "constructor": "bad",
    "nested": {"answer": "${'x'.repeat(50000)}"}
  }`);
  const sanitized = adminForms._test.sanitizeData(malicious);
  assert.equal(sanitized.safe, 'value');
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, 'prototype'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, 'constructor'), false);
  assert.ok(sanitized.nested.answer.length < 50_000);
  assert.equal({}.polluted, undefined);
});
