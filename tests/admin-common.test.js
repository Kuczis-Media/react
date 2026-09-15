const test = require('node:test');
const assert = require('node:assert/strict');

const adminCommon = require('../netlify/admin-common.js');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_URL = 'https://course.example/.netlify/identity';
const CLIENT_TOKEN = 'verified-client-jwt';

const responseJson = (body, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } }
);

const contextFor = (tokenUser = { id: USER_ID, app_metadata: { roles: ['admin'] } }) => ({
  clientContext: {
    user: tokenUser,
    identity: { url: IDENTITY_URL }
  }
});

const eventFor = (overrides = {}) => ({
  headers: { authorization: `Bearer ${CLIENT_TOKEN}` },
  ...overrides
});

function installFetch(t, implementation) {
  const original = global.fetch;
  global.fetch = implementation;
  t.after(() => { global.fetch = original; });
}

test('canonical authentication requires both a bearer token and verified token user', async (t) => {
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return responseJson({});
  });

  const noBearer = await adminCommon.authenticateCanonicalUser(
    eventFor({ headers: {} }),
    contextFor()
  );
  assert.deepEqual(noBearer, { ok: false, code: 'AUTH_REQUIRED', status: 401 });

  const noTokenUser = await adminCommon.authenticateCanonicalUser(
    eventFor(),
    { clientContext: { identity: { url: IDENTITY_URL } } }
  );
  assert.deepEqual(noTokenUser, { ok: false, code: 'AUTH_REQUIRED', status: 401 });
  assert.equal(calls, 0);
});

test('canonical authentication fails closed without a safe Identity URL', async (t) => {
  let calls = 0;
  installFetch(t, async () => {
    calls += 1;
    return responseJson({});
  });

  for (const url of ['', 'ftp://course.example/identity', 'http://course.example/identity', 'not a url']) {
    const result = await adminCommon.authenticateCanonicalUser(eventFor(), {
      clientContext: {
        user: { id: USER_ID },
        identity: { url }
      }
    });
    assert.deepEqual(result, { ok: false, code: 'IDENTITY_UNAVAILABLE', status: 503 });
  }
  assert.equal(calls, 0);
});

test('canonical authentication uses the client JWT and rejects expired or mismatched users', async (t) => {
  const requests = [];
  const replies = [
    responseJson({}, 401),
    responseJson({ id: 'different-user', app_metadata: { roles: ['admin'] } }),
    responseJson({ id: USER_ID, app_metadata: { roles: ['active'] } })
  ];
  installFetch(t, async (url, options) => {
    requests.push({ url: String(url), options });
    return replies.shift();
  });

  const expired = await adminCommon.authenticateCanonicalUser(eventFor(), contextFor());
  assert.deepEqual(expired, { ok: false, code: 'AUTH_EXPIRED', status: 401 });

  const mismatch = await adminCommon.authenticateCanonicalUser(eventFor(), contextFor());
  assert.deepEqual(mismatch, { ok: false, code: 'AUTH_EXPIRED', status: 401 });

  const accepted = await adminCommon.authenticateCanonicalUser(eventFor(), contextFor());
  assert.equal(accepted.ok, true);
  assert.equal(accepted.userId, USER_ID);
  assert.deepEqual(accepted.roles, ['active']);
  assert.equal(accepted.clientToken, CLIENT_TOKEN);
  assert.equal(requests[0].url, `${IDENTITY_URL}/user`);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${CLIENT_TOKEN}`);
});

test('canonical authentication rejects a JWT from the device replaced by a newer login', async (t) => {
  installFetch(t, async () => responseJson({
    id: USER_ID,
    app_metadata: { roles: ['admin'], session_id: 'new-device-session' }
  }));

  const result = await adminCommon.authenticateCanonicalUser(
    eventFor(),
    contextFor({
      id: USER_ID,
      app_metadata: { roles: ['admin'], session_id: 'old-device-session' }
    })
  );

  assert.deepEqual(result, { ok: false, code: 'SESSION_REPLACED', status: 401 });
});

test('Identity network, server and malformed JSON failures never authorize a caller', async (t) => {
  const replies = [
    new Error('network unavailable'),
    responseJson({}, 500),
    new Response('not-json', { status: 200 })
  ];
  installFetch(t, async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  });

  for (const expected of ['SESSION_CHECK_UNAVAILABLE', 'SESSION_CHECK_UNAVAILABLE', 'AUTH_EXPIRED']) {
    const result = await adminCommon.authenticateCanonicalUser(eventFor(), contextFor());
    assert.equal(result.ok, false);
    assert.equal(result.code, expected);
  }
});

test('administrator permission is decided by fresh canonical roles, not stale JWT claims', async (t) => {
  const canonicalUsers = [
    { id: USER_ID, app_metadata: { roles: ['active'] } },
    { id: USER_ID, app_metadata: { roles: ['admin'] } }
  ];
  installFetch(t, async () => responseJson(canonicalUsers.shift()));

  const staleAdmin = await adminCommon.requireAdmin(
    eventFor(),
    contextFor({ id: USER_ID, app_metadata: { roles: ['admin'] } })
  );
  assert.deepEqual(staleAdmin, { ok: false, code: 'ADMIN_REQUIRED', status: 403 });

  const staleNonAdmin = await adminCommon.requireAdmin(
    eventFor(),
    contextFor({ id: USER_ID, app_metadata: { roles: [] } })
  );
  assert.equal(staleNonAdmin.ok, true);
  assert.deepEqual(staleNonAdmin.roles, ['admin']);
});

test('course access accepts canonical admin/active roles and rejects a missing grant', async (t) => {
  const canonicalUsers = [
    { id: USER_ID, app_metadata: { roles: ['admin'] } },
    { id: USER_ID, app_metadata: { roles: ['active'] } },
    { id: USER_ID, app_metadata: { roles: ['unrelated'] } }
  ];
  installFetch(t, async () => responseJson(canonicalUsers.shift()));

  assert.equal((await adminCommon.requireCourseAccess(eventFor(), contextFor())).ok, true);
  assert.equal((await adminCommon.requireCourseAccess(eventFor(), contextFor())).ok, true);
  assert.deepEqual(
    await adminCommon.requireCourseAccess(eventFor(), contextFor()),
    { ok: false, code: 'ACCESS_REQUIRED', status: 403 }
  );
});

test('timed course access requires a matching, active and unexpired canonical grant', async (t) => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  const users = [
    {
      id: USER_ID,
      app_metadata: {
        roles: ['week'],
        timed_access: { role: 'week', active: true, expires_at: '2026-07-16T12:00:00.000Z' }
      }
    },
    {
      id: USER_ID,
      app_metadata: {
        roles: ['week'],
        timed_access: { role: 'day', active: true, expires_at: '2026-07-16T12:00:00.000Z' }
      }
    },
    {
      id: USER_ID,
      app_metadata: {
        roles: ['week'],
        timed_access: { role: 'week', active: false, expires_at: '2026-07-16T12:00:00.000Z' }
      }
    },
    {
      id: USER_ID,
      app_metadata: {
        roles: ['week'],
        timed_access: { role: 'week', active: true, expires_at: '2026-07-15T12:00:00.000Z' }
      }
    },
    {
      id: USER_ID,
      app_metadata: {
        roles: ['week'],
        timed_access: { role: 'week', active: true, expires_at: 'invalid' }
      }
    }
  ];
  installFetch(t, async () => responseJson(users.shift()));

  assert.equal((await adminCommon.requireCourseAccess(eventFor(), contextFor(), now)).ok, true);
  for (let index = 0; index < 4; index += 1) {
    assert.deepEqual(
      await adminCommon.requireCourseAccess(eventFor(), contextFor(), now),
      { ok: false, code: 'ACCESS_EXPIRED', status: 403 }
    );
  }
});

test('same-origin mutation guard accepts deployed/custom-domain origins and rejects unsafe requests', () => {
  const oldUrl = process.env.URL;
  process.env.URL = 'https://course.example';
  try {
    const valid = adminCommon.mutationGuard({
      headers: {
        'content-type': 'application/json; charset=utf-8',
        origin: 'https://course.example',
        host: 'course.example',
        'x-forwarded-proto': 'https'
      },
      body: '{"ok":true}'
    });
    assert.deepEqual(valid, { ok: true });

    const forwardedCustomDomain = adminCommon.mutationGuard({
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://chemdisk.pl',
        Host: 'internal.netlify.app',
        'X-Forwarded-Host': 'chemdisk.pl',
        'X-Forwarded-Proto': 'https'
      },
      body: '{}'
    });
    assert.deepEqual(forwardedCustomDomain, { ok: true });

    assert.equal(adminCommon.mutationGuard({
      headers: { 'content-type': 'text/plain', origin: 'https://course.example' },
      body: '{}'
    }).code, 'JSON_REQUIRED');
    assert.equal(adminCommon.mutationGuard({
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        host: 'course.example'
      },
      body: '{}'
    }).code, 'SAME_ORIGIN_REQUIRED');
    assert.equal(adminCommon.mutationGuard({
      headers: {
        'content-type': 'application/json',
        origin: 'https://course.example',
        host: 'course.example'
      },
      body: 'ą'.repeat(6)
    }, { maxBodyBytes: 10 }).code, 'REQUEST_TOO_LARGE');
  } finally {
    if (oldUrl === undefined) delete process.env.URL;
    else process.env.URL = oldUrl;
  }
});

test('origin validation fails closed for null, malformed, insecure and path-bearing origins', () => {
  const headers = { host: 'course.example', 'x-forwarded-proto': 'https' };
  for (const origin of [
    '',
    'null',
    'not a url',
    'http://course.example',
    'https://course.example/path',
    'https://course.example?x=1'
  ]) {
    assert.equal(adminCommon.isSameOriginRequest({ ...headers, origin }), false);
  }
  assert.equal(adminCommon.isSameOriginRequest({
    host: 'localhost:8888',
    origin: 'http://localhost:8888'
  }), true);
});

test('JSON parsing, role extraction and failure responses expose only normalized values', () => {
  assert.deepEqual(
    adminCommon.parseJsonBody({ body: '{"name":"Ada"}' }),
    { ok: true, value: { name: 'Ada' } }
  );
  assert.equal(adminCommon.parseJsonBody({ body: '[' }).code, 'INVALID_JSON');
  assert.equal(adminCommon.parseJsonBody({ body: '[]' }).code, 'INVALID_BODY');
  assert.deepEqual(adminCommon.rolesFrom({
    app_metadata: { roles: ['admin', ' admin ', '', 5, 'active', 'active'] }
  }), ['admin', 'active']);

  const response = adminCommon.responseForFailure({ code: 'DENIED', status: 403 });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: 'DENIED' });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
});
