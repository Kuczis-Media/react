const test = require('node:test');
const assert = require('node:assert/strict');

const adminUsers = require('../netlify/functions/admin-users.js');
const payments = require('../netlify/payment-common.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const IDENTITY_URL = 'https://example.netlify.app/.netlify/identity';
const OPERATOR_TOKEN = 'operator-token-must-stay-server-side';
const CLIENT_TOKEN = 'signed-user-jwt';

const canonicalAdmin = {
  id: ADMIN_ID,
  email: 'admin@example.com',
  app_metadata: { roles: ['admin', 'active'] },
  user_metadata: { first_name: 'Ada', last_name: 'Admin' }
};

const contextFor = (user = canonicalAdmin) => ({
  clientContext: {
    user,
    identity: { url: IDENTITY_URL, token: OPERATOR_TOKEN }
  }
});

const eventFor = (overrides = {}) => ({
  httpMethod: 'GET',
  headers: { authorization: `Bearer ${CLIENT_TOKEN}` },
  queryStringParameters: {},
  ...overrides
});

const responseJson = (body, status = 200, headers = {}) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } }
);

test('admin endpoint requires both bearer JWT and verified Identity context', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseJson({}); };
  t.after(() => { global.fetch = originalFetch; });

  const noBearer = await adminUsers.handler(eventFor({ headers: {} }), contextFor());
  assert.equal(noBearer.statusCode, 401);
  assert.equal(JSON.parse(noBearer.body).error, 'AUTH_REQUIRED');

  const noUser = await adminUsers.handler(eventFor(), { clientContext: { identity: contextFor().clientContext.identity } });
  assert.equal(noUser.statusCode, 401);
  assert.equal(calls, 0);
});

test('fresh /user record, not stale JWT claims, decides administrator access', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return responseJson({
      id: ADMIN_ID,
      app_metadata: { roles: ['active'] }
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const response = await adminUsers.handler(eventFor(), contextFor());
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, 'ADMIN_REQUIRED');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${IDENTITY_URL}/user`);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${CLIENT_TOKEN}`);
});

test('admin endpoint rejects a valid old JWT after another device rotates the session', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return responseJson({
      ...canonicalAdmin,
      app_metadata: {
        ...canonicalAdmin.app_metadata,
        session_id: 'new-device-session'
      }
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const response = await adminUsers.handler(eventFor(), contextFor({
    ...canonicalAdmin,
    app_metadata: {
      ...canonicalAdmin.app_metadata,
      session_id: 'old-device-session'
    }
  }));

  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error, 'SESSION_REPLACED');
  assert.equal(calls, 1);
});

test('GET lists only normalized user fields and never exposes operator data', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    return responseJson({
      aud: 'netlify',
      users: [{
        id: TARGET_ID,
        email: 'jan@example.com',
        encrypted_password: 'must-not-leak',
        identities: [{ provider_token: 'must-not-leak' }],
        user_metadata: {
          first_name: 'Jan',
          last_name: 'Kowalski',
          private_note: 'must-not-leak'
        },
        app_metadata: {
          roles: ['active', 'billing-secret-role'],
          provider: 'email',
          internal_secret: 'must-not-leak'
        },
        created_at: '2026-01-01T00:00:00.000Z'
      }]
    }, 200, { 'x-total-count': '1' });
  };
  t.after(() => { global.fetch = originalFetch; });

  const response = await adminUsers.handler(eventFor({
    queryStringParameters: { page: '1', perPage: '20' }
  }), contextFor());
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload.users, [{
    id: TARGET_ID,
    email: 'jan@example.com',
    firstName: 'Jan',
    lastName: 'Kowalski',
    fullName: 'Jan Kowalski',
    roles: ['active'],
    timedAccess: null,
    confirmedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    lastSignInAt: null
  }]);
  assert.deepEqual(payload.pagination, {
    page: 1,
    perPage: 20,
    count: 1,
    hasMore: false,
    total: 1
  });
  assert.match(requests[1].url, /\/admin\/users\?page=1&per_page=20$/);
  assert.equal(requests[1].options.headers.Authorization, `Bearer ${OPERATOR_TOKEN}`);
  assert.equal(response.body.includes(OPERATOR_TOKEN), false);
  assert.equal(response.body.includes('must-not-leak'), false);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('PATCH safely merges profile and replaces access roles without destroying session metadata', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  const target = {
    id: TARGET_ID,
    email: 'old@example.com',
    user_metadata: {
      first_name: 'Stare',
      last_name: 'Nazwisko',
      locale: 'pl',
      roles: ['admin'],
      status: 'active'
    },
    app_metadata: {
      provider: 'email',
      roles: ['active', 'billing'],
      status: 'active',
      session_id: 'old-session',
      timed_access: { role: 'week', expires_at: '2020-01-01T00:00:00.000Z' }
    }
  };

  global.fetch = async (url, options) => {
    const request = { url: String(url), options };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (options.method === 'PUT') {
      const update = JSON.parse(options.body);
      return responseJson({
        ...target,
        user_metadata: update.user_metadata,
        app_metadata: update.app_metadata
      });
    }
    return responseJson(target);
  };
  t.after(() => { global.fetch = originalFetch; });

  const response = await adminUsers.handler(eventFor({
    httpMethod: 'PATCH',
    headers: {
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
      origin: 'https://example.netlify.app',
      host: 'example.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({
      id: TARGET_ID,
      firstName: '  Łukasz ',
      lastName: ' Żółć-Kowalski  ',
      roles: ['week']
    })
  }), contextFor());

  assert.equal(response.statusCode, 200);
  const put = requests.find((request) => request.options.method === 'PUT');
  assert.ok(put, 'Identity update request was not sent');
  assert.equal(put.options.headers.Authorization, `Bearer ${OPERATOR_TOKEN}`);
  const update = JSON.parse(put.options.body);
  assert.deepEqual(update.user_metadata, {
    first_name: 'Łukasz',
    last_name: 'Żółć-Kowalski',
    locale: 'pl',
    full_name: 'Łukasz Żółć-Kowalski',
    name: 'Łukasz Żółć-Kowalski'
  });
  assert.deepEqual(update.app_metadata.roles, ['billing', 'week']);
  assert.equal(update.app_metadata.status, '');
  assert.equal(update.app_metadata.timed_access, null);
  assert.equal(update.app_metadata.session_id, 'old-session');
  assert.equal(update.app_metadata.provider, 'email');
  assert.equal(JSON.parse(response.body).sessionRefreshRequired, true);
  assert.equal(JSON.parse(response.body).rolesChanged, true);
});

test('saving profile with the same active timed role preserves its access window', () => {
  const timedAccess = {
    role: 'month',
    assigned_at: '2098-01-01T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    active: true,
    injected_active: false
  };
  const target = {
    id: TARGET_ID,
    user_metadata: { first_name: 'Jan', last_name: 'Kowalski' },
    app_metadata: {
      roles: ['month', 'billing'],
      status: '',
      timed_access: timedAccess,
      session_id: 'same-session'
    }
  };

  const update = adminUsers._test.buildIdentityUpdate(target, {
    id: TARGET_ID,
    firstName: 'Janusz',
    lastName: 'Kowalski',
    roles: ['month']
  });

  assert.equal(update.ok, true);
  assert.equal(update.rolesChanged, false);
  assert.equal(update.accessMetadataChanged, false);
  assert.deepEqual(update.value.app_metadata.timed_access, timedAccess);
  assert.equal(update.value.app_metadata.session_id, 'same-session');
  assert.equal(update.value.app_metadata.status, '');
});

test('re-assigning the same expired timed role clears its old window', () => {
  const update = adminUsers._test.buildIdentityUpdate({
    id: TARGET_ID,
    app_metadata: {
      roles: ['week'],
      timed_access: {
        role: 'week',
        assigned_at: '2020-01-01T00:00:00.000Z',
        expires_at: '2020-01-08T00:00:00.000Z'
      }
    }
  }, {
    id: TARGET_ID,
    firstName: null,
    lastName: null,
    roles: ['week']
  });

  assert.equal(update.rolesChanged, false);
  assert.equal(update.accessMetadataChanged, true);
  assert.equal(update.value.app_metadata.timed_access, null);
});

test('PATCH rejects cross-origin/non-JSON mutations before calling Identity', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseJson(canonicalAdmin); };
  t.after(() => { global.fetch = originalFetch; });

  const crossOrigin = await adminUsers.handler(eventFor({
    httpMethod: 'PATCH',
    headers: {
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'content-type': 'application/json',
      origin: 'https://evil.example',
      host: 'example.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: '{}'
  }), contextFor());
  assert.equal(crossOrigin.statusCode, 403);
  assert.equal(JSON.parse(crossOrigin.body).error, 'SAME_ORIGIN_REQUIRED');

  const nonJson = await adminUsers.handler(eventFor({
    httpMethod: 'PATCH',
    headers: {
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'content-type': 'text/plain',
      origin: 'https://example.netlify.app',
      host: 'example.netlify.app'
    },
    body: '{}'
  }), contextFor());
  assert.equal(nonJson.statusCode, 415);
  assert.equal(calls, 0);
});

test('administrator cannot accidentally remove their own admin role', async (t) => {
  const originalFetch = global.fetch;
  let putCalls = 0;
  global.fetch = async (url, options) => {
    if (options.method === 'PUT') putCalls += 1;
    return responseJson(canonicalAdmin);
  };
  t.after(() => { global.fetch = originalFetch; });

  const response = await adminUsers.handler(eventFor({
    httpMethod: 'PATCH',
    headers: {
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'content-type': 'application/json',
      origin: 'https://example.netlify.app',
      host: 'example.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ id: ADMIN_ID, roles: ['active'] })
  }), contextFor());

  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error, 'CANNOT_REMOVE_OWN_ADMIN');
  assert.equal(putCalls, 0);
});

test('deleting an Identity user also deletes their payment ledger', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  const deletedKeys = [];
  payments._test.setStoreFactory(() => ({
    async delete(key) {
      deletedKeys.push(key);
    }
  }));
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    return responseJson({ id: TARGET_ID, email: 'jan@example.com' });
  };
  t.after(() => {
    global.fetch = originalFetch;
    payments._test.setStoreFactory(null);
  });

  const response = await adminUsers.handler(eventFor({
    httpMethod: 'DELETE',
    headers: {
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'content-type': 'application/json',
      origin: 'https://example.netlify.app',
      host: 'example.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ id: TARGET_ID })
  }), contextFor());
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.deleted, true);
  assert.equal(payload.paymentHistoryDeleted, true);
  assert.deepEqual(deletedKeys, [`users/${TARGET_ID}.json`]);
  assert.equal(requests.filter((request) => request.options.method === 'DELETE').length, 1);
});

test('repeating deletion after Identity is already gone still cleans up the payment ledger', async (t) => {
  const originalFetch = global.fetch;
  const deletedKeys = [];
  let identityDeleteCalls = 0;
  payments._test.setStoreFactory(() => ({
    async delete(key) {
      deletedKeys.push(key);
    }
  }));
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    if (options.method === 'DELETE') identityDeleteCalls += 1;
    return responseJson({ error: 'not found' }, 404);
  };
  t.after(() => {
    global.fetch = originalFetch;
    payments._test.setStoreFactory(null);
  });

  const response = await adminUsers.handler(eventFor({
    httpMethod: 'DELETE',
    headers: {
      authorization: `Bearer ${CLIENT_TOKEN}`,
      'content-type': 'application/json',
      origin: 'https://example.netlify.app',
      host: 'example.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ id: TARGET_ID })
  }), contextFor());
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.identityAlreadyDeleted, true);
  assert.equal(payload.paymentHistoryDeleted, true);
  assert.deepEqual(deletedKeys, [`users/${TARGET_ID}.json`]);
  assert.equal(identityDeleteCalls, 0);
});

test('role validation allows admin plus one grant and rejects ambiguous access roles', () => {
  assert.deepEqual(
    adminUsers._test.validateUpdate({ id: TARGET_ID, roles: ['superadmin'] }),
    { ok: false, code: 'INVALID_ROLES' }
  );
  assert.deepEqual(
    adminUsers._test.validateUpdate({ id: TARGET_ID, roles: ['day', 'week'] }),
    { ok: false, code: 'MULTIPLE_ACCESS_ROLES' }
  );
  assert.deepEqual(
    adminUsers._test.validateUpdate({ id: TARGET_ID, roles: ['active', 'week'] }),
    { ok: false, code: 'MULTIPLE_ACCESS_ROLES' }
  );
  assert.equal(
    adminUsers._test.validateUpdate({ id: TARGET_ID, roles: ['admin', 'month'] }).ok,
    true
  );
});

test('profile validation matches signup character and length rules', () => {
  assert.equal(
    adminUsers._test.validateUpdate({ id: TARGET_ID, firstName: 'A', lastName: 'Nowak' }).code,
    'INVALID_FIRST_NAME'
  );
  assert.equal(
    adminUsers._test.validateUpdate({ id: TARGET_ID, firstName: 'Anna🙂', lastName: 'Nowak' }).code,
    'INVALID_FIRST_NAME'
  );
  assert.equal(
    adminUsers._test.validateUpdate({ id: TARGET_ID, firstName: 'Anna', lastName: 'N'.repeat(81) }).code,
    'INVALID_LAST_NAME'
  );
  assert.equal(
    adminUsers._test.validateUpdate({ id: TARGET_ID, firstName: "O'Neil", lastName: 'Żółć-Kowalski' }).ok,
    true
  );
});
