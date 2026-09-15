const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const identityLogin = require('../netlify/functions/identity-login.js');
const identitySignup = require('../netlify/functions/identity-signup.js');

test('netlify.toml grants the same course roles handled by the login hook', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const membersRule = config.match(
    /\[\[redirects\]\]\s+from\s*=\s*"\/members"\s+to\s*=\s*"\/members\/index\.html"[\s\S]*?(?=\n\[\[redirects\]\])/
  );

  assert.ok(membersRule, 'missing exact members redirect');
  const roleCondition = membersRule[0].match(/conditions\s*=\s*\{\s*Role\s*=\s*\[([^\]]+)]\s*}/);
  assert.ok(roleCondition, 'missing Role redirect condition on the members route');
  const configuredRoles = Array.from(roleCondition[1].matchAll(/"([^"]+)"/g), (match) => match[1]).sort();
  assert.deepEqual(configuredRoles, ['active', 'admin', 'day', 'halfyear', 'hour', 'month', 'week', 'year']);
});

const invokeLogin = async (user) => {
  const response = await identityLogin.handler({ body: JSON.stringify({ user }) });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body).app_metadata;
};

test('user_metadata.status cannot grant course access', async () => {
  const metadata = await invokeLogin({
    app_metadata: { roles: [] },
    user_metadata: { status: 'active', roles: ['admin'] }
  });

  assert.deepEqual(metadata.roles, []);
  assert.equal(metadata.status, '');
  assert.equal(metadata.session_id, '');
});

test('trusted app_metadata.status can preserve the legacy active mapping', async () => {
  const metadata = await invokeLogin({
    app_metadata: { roles: [], status: 'active' },
    user_metadata: { status: 'inactive' }
  });

  assert.deepEqual(metadata.roles, ['active']);
  assert.match(metadata.session_id, /^[0-9a-f-]{32,36}$/i);
});

test('each successful active login rotates the canonical session id', async () => {
  const user = { app_metadata: { roles: ['active'] }, user_metadata: {} };
  const first = await invokeLogin(user);
  const second = await invokeLogin(user);

  assert.notEqual(first.session_id, second.session_id);
  assert.deepEqual(first.roles, ['active']);
  assert.deepEqual(second.roles, ['active']);
});

test('admin grants access without injecting a redundant active role', async () => {
  const metadata = await invokeLogin({
    app_metadata: { roles: ['admin'], status: '' },
    user_metadata: {}
  });

  assert.deepEqual(metadata.roles, ['admin']);
  assert.match(metadata.session_id, /^[0-9a-f-]{32,36}$/i);
});

test('timed role starts a window without injecting the active role', async () => {
  const before = Date.now();
  const metadata = await invokeLogin({
    app_metadata: { roles: ['week'] },
    user_metadata: {}
  });
  const after = Date.now();
  const assignedAt = Date.parse(metadata.timed_access.assigned_at);
  const expiresAt = Date.parse(metadata.timed_access.expires_at);

  assert.deepEqual(metadata.roles, ['week']);
  assert.equal(metadata.timed_access.role, 'week');
  assert.equal(metadata.timed_access.active, true);
  assert.equal(metadata.timed_access.injected_active, false);
  assert.ok(assignedAt >= before && assignedAt <= after);
  assert.equal(expiresAt - assignedAt, 7 * 24 * 60 * 60 * 1000);
  assert.match(metadata.session_id, /^[0-9a-f-]{32,36}$/i);
});

test('expired legacy timed access drops both timed and injected active roles', async () => {
  const metadata = await invokeLogin({
    app_metadata: {
      roles: ['week', 'active'],
      session_id: 'previous-session',
      timed_access: {
        role: 'week',
        assigned_at: '2020-01-01T00:00:00.000Z',
        expires_at: '2020-01-08T00:00:00.000Z',
        injected_active: true
      }
    },
    user_metadata: {}
  });

  assert.deepEqual(metadata.roles, []);
  assert.equal(metadata.timed_access, null);
  assert.equal(metadata.session_id, 'previous-session');
});

test('signup metadata keeps profile fields and removes authorization lookalikes', async () => {
  const response = await identitySignup.handler({
    body: JSON.stringify({
      user: {
        user_metadata: {
          first_name: '  Łukasz  ',
          last_name: '  Żółć-Kowalski ',
          status: 'active',
          roles: ['admin'],
          session_id: 'forged',
          locale: 'pl'
        }
      }
    })
  });
  const metadata = JSON.parse(response.body).user_metadata;

  assert.equal(response.statusCode, 200);
  assert.equal(metadata.first_name, 'Łukasz');
  assert.equal(metadata.last_name, 'Żółć-Kowalski');
  assert.equal(metadata.full_name, 'Łukasz Żółć-Kowalski');
  assert.equal(metadata.name, 'Łukasz Żółć-Kowalski');
  assert.equal(metadata.locale, 'pl');
  assert.equal(Object.hasOwn(metadata, 'status'), false);
  assert.equal(Object.hasOwn(metadata, 'roles'), false);
  assert.equal(Object.hasOwn(metadata, 'session_id'), false);
});
