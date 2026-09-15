const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const authSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'auth.js'), 'utf8');

const jwtFor = (appMetadata = {}) => {
  const encode = (value) => Buffer.from(JSON.stringify(value))
    .toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ app_metadata: appMetadata })}.test-signature`;
};

const loadChemAuth = (search, currentUser = null, overrides = {}) => {
  let activeUser = currentUser;
  const location = {
    hash: overrides.hash || '',
    origin: 'https://chemdisk.netlify.app',
    pathname: overrides.pathname || '/login/',
    protocol: 'https:',
    search,
    replace(value) { if (typeof overrides.onReplace === 'function') overrides.onReplace(value); }
  };
  const identityListeners = {};
  const identity = {
    currentUser: () => activeUser,
    on(name, callback) { identityListeners[name] = callback; },
    init() {},
    logout: async () => { if (typeof overrides.onIdentityLogout === 'function') overrides.onIdentityLogout(); },
    refresh: async () => {},
    gotrue: {
      async login(email, password, remember) {
        if (typeof overrides.identityLogin !== 'function') {
          throw new Error('identity login not configured');
        }
        const result = await overrides.identityLogin(email, password, remember);
        if (result) activeUser = result;
        return result;
      }
    }
  };
  const document = {
    title: 'Login',
    cookie: '',
    hidden: Boolean(overrides.documentHidden),
    addEventListener(name, callback) {
      if (typeof overrides.onDocumentListener === 'function') {
        overrides.onDocumentListener(name, callback);
      }
    },
    querySelector: () => null
  };
  const window = {
    netlifyIdentity: identity,
    addEventListener(name, callback) {
      if (typeof overrides.onWindowListener === 'function') {
        overrides.onWindowListener(name, callback);
      }
    },
    dispatchEvent() {},
    setInterval: () => 1,
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(authSource, {
    URL,
    URLSearchParams,
    CustomEvent: class CustomEvent {
      constructor(name, options) { this.type = name; this.detail = options && options.detail; }
    },
    Date,
    AbortController,
    Object,
    Promise,
    Set,
    String,
    atob,
    document,
    fetch: overrides.fetch || (async () => { throw new Error('not used'); }),
    history: { replaceState() {} },
    localStorage: overrides.localStorage || { getItem: () => null, removeItem() {}, setItem() {} },
    location,
    window
  });

  if (typeof overrides.onIdentityListeners === 'function') {
    overrides.onIdentityListeners(identityListeners);
  }
  return window.ChemAuth;
};

test('ChemAuth exposes the dashboard profile and session contract', () => {
  const auth = loadChemAuth('');

  assert.equal(typeof auth.getUser, 'function');
  assert.equal(typeof auth.getProfile, 'function');
  assert.equal(typeof auth.getAccessToken, 'function');
  assert.equal(typeof auth.updateProfile, 'function');
  assert.equal(typeof auth.changePassword, 'function');
  assert.equal(typeof auth.logout, 'function');
  assert.equal(typeof auth.checkSession, 'function');
  assert.equal(typeof auth.getSessionStatus, 'function');
  assert.equal(typeof auth.getReturnTo, 'function');
  assert.equal(typeof auth.ready.then, 'function');
});

test('getAccessToken can force a fresh JWT for authenticated function calls', async () => {
  let forceValue = null;
  const user = {
    app_metadata: { roles: ['active'], session_id: 'session-1' },
    user_metadata: {},
    async jwt(forceRefresh) {
      forceValue = forceRefresh;
      return 'fresh-signed-token';
    }
  };
  const auth = loadChemAuth('', user);

  const token = await auth.getAccessToken({ forceRefresh: true });

  assert.equal(token, 'fresh-signed-token');
  assert.equal(forceValue, true);
});

test('getReturnTo keeps module parameters but removes Identity control data', () => {
  const auth = loadChemAuth(
    '?returnTo=%2Fmembers%2Fmodule%2Ffilm%2F&id=CH50zuS8DD0&type=1&flow=recovery&token=secret&loggedout=1'
  );

  assert.equal(auth.getReturnTo(), '/members/module/film/?id=CH50zuS8DD0&type=1');
});

test('getReturnTo rejects external and protocol-relative redirects', () => {
  const external = loadChemAuth('?returnTo=https%3A%2F%2Fevil.example%2Fsteal');
  const protocolRelative = loadChemAuth('?returnTo=%2F%2Fevil.example%2Fsteal');

  assert.equal(external.getReturnTo(), '/members/');
  assert.equal(protocolRelative.getReturnTo(), '/members/');
});

test('getReturnTo allows the local access-status page', () => {
  const auth = loadChemAuth('?returnTo=%2Ftime');

  assert.equal(auth.getReturnTo(), '/time');
});

test('getReturnTo allows the separate purchase page with a selected plan', () => {
  const auth = loadChemAuth('?returnTo=%2Fpurchase%2F%3Fplan%3Dmonth');

  assert.equal(auth.getReturnTo(), '/purchase/?plan=month');
});

test('getReturnTo does not copy Identity type values into a module URL', () => {
  const auth = loadChemAuth('?returnTo=%2Fmembers%2F&type=recovery&error=denied');

  assert.equal(auth.getReturnTo(), '/members/');
});

test('Identity email tokens stay in the URL fragment while redirecting to login', () => {
  let redirect = '';
  loadChemAuth('?returnTo=%2Fmembers%2F', null, {
    pathname: '/',
    hash: '#recovery_token=secret-token&type=recovery',
    onReplace(value) { redirect = value; }
  });

  const target = new URL(redirect);
  assert.equal(target.pathname, '/login/');
  assert.equal(target.searchParams.has('token'), false);
  assert.equal(target.hash, '#recovery_token=secret-token&type=recovery');
});

test('updateProfile writes normalized names and drops authorization lookalikes', async () => {
  let updatePayload = null;
  const user = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'] },
    user_metadata: { locale: 'pl', status: 'active', roles: ['admin'] },
    async update(payload) {
      updatePayload = payload;
      this.user_metadata = payload.data;
      return this;
    }
  };
  const auth = loadChemAuth('', user);
  const profile = await auth.updateProfile({ firstName: '  Anna Maria ', lastName: ' Kowalska-Nowak ' });

  assert.equal(updatePayload.data.first_name, 'Anna Maria');
  assert.equal(updatePayload.data.last_name, 'Kowalska-Nowak');
  assert.equal(updatePayload.data.full_name, 'Anna Maria Kowalska-Nowak');
  assert.equal(updatePayload.data.locale, 'pl');
  assert.equal(Object.hasOwn(updatePayload.data, 'status'), false);
  assert.equal(Object.hasOwn(updatePayload.data, 'roles'), false);
  assert.equal(profile.firstName, 'Anna Maria');
  assert.equal(profile.lastName, 'Kowalska-Nowak');
  assert.equal(profile.fullName, 'Anna Maria Kowalska-Nowak');
  assert.equal(profile.email, 'kursant@example.com');
});

test('changePassword verifies the current password, updates it and synchronizes the rotated session', async () => {
  const storage = new Map([['chem_session_id', 'old-session']]);
  let updatePayload = null;
  const originalUser = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'old-session' },
    user_metadata: {},
    async jwt() {
      return jwtFor(this.app_metadata);
    }
  };
  const verifiedUser = {
    email: originalUser.email,
    app_metadata: { roles: ['active'], session_id: 'new-session' },
    user_metadata: {},
    async jwt() {
      return jwtFor(this.app_metadata);
    },
    async update(payload) {
      updatePayload = payload;
      return this;
    }
  };
  const auth = loadChemAuth('', originalUser, {
    pathname: '/members/',
    identityLogin: async (email, password, remember) => {
      assert.equal(email, originalUser.email);
      assert.equal(password, 'stare-haslo-123');
      assert.equal(remember, true);
      return verifiedUser;
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, value); }
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          email: verifiedUser.email,
          app_metadata: verifiedUser.app_metadata,
          user_metadata: verifiedUser.user_metadata
        };
      }
    })
  });

  const changed = await auth.changePassword({
    currentPassword: 'stare-haslo-123',
    newPassword: 'nowe-bezpieczne-456'
  });

  assert.equal(changed, true);
  assert.equal(updatePayload.password, 'nowe-bezpieczne-456');
  assert.deepEqual(Object.keys(updatePayload), ['password']);
  assert.equal(storage.get('chem_session_id'), 'new-session');
});

test('changePassword rejects an invalid current password and a too-short new password', async () => {
  const user = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'session-1' },
    user_metadata: {},
    async jwt() {
      return jwtFor(this.app_metadata);
    }
  };
  let loginCalls = 0;
  const auth = loadChemAuth('', user, {
    identityLogin: async () => {
      loginCalls += 1;
      throw new Error('invalid_grant');
    }
  });

  await assert.rejects(
    auth.changePassword({ currentPassword: 'stare-haslo-123', newPassword: 'krotkie' }),
    (error) => error && error.code === 'weak_password'
  );
  assert.equal(loginCalls, 0);

  await assert.rejects(
    auth.changePassword({
      currentPassword: 'bledne-haslo-123',
      newPassword: 'nowe-bezpieczne-456'
    }),
    (error) => error && error.code === 'invalid_current_password'
  );
  assert.equal(loginCalls, 1);
});

test('a canonical session mismatch invalidates only the old local device', async () => {
  const storage = new Map([
    ['chem_session_id', 'old-session'],
    ['gotrue.user', '{"token":"old"}']
  ]);
  let redirect = '';
  let identityLogoutCalls = 0;
  const user = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'old-session' },
    user_metadata: {},
    jwt: async () => 'signed-jwt'
  };
  const auth = loadChemAuth('', user, {
    pathname: '/members/module/forms/',
    onReplace(value) { redirect = value; },
    onIdentityLogout() { identityLogoutCalls += 1; },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, value); }
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          email: user.email,
          app_metadata: { roles: ['active'], session_id: 'new-session' },
          user_metadata: {}
        };
      }
    })
  });

  const status = await auth.checkSession();

  assert.equal(status.ok, false);
  assert.equal(status.reason, 'session_mismatch');
  assert.equal(storage.has('chem_session_id'), false);
  assert.equal(storage.has('gotrue.user'), false);
  assert.equal(identityLogoutCalls, 0, 'mismatch must not revoke the new device refresh token');
  assert.match(redirect, /^\/login\/\?loggedout=1&returnTo=/);
});

test('a refreshed JWT repairs stale local session state after sleep without logging out', async () => {
  const storage = new Map([
    ['chem_session_id', 'before-sleep-session'],
    ['gotrue.user', '{"token":"persisted"}']
  ]);
  let redirect = '';
  const user = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'before-sleep-session' },
    user_metadata: {},
    jwt: async () => jwtFor({ roles: ['active'], session_id: 'after-wake-session' })
  };
  const auth = loadChemAuth('', user, {
    pathname: '/members/',
    onReplace(value) { redirect = value; },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, value); }
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          email: user.email,
          app_metadata: { roles: ['active'], session_id: 'after-wake-session' },
          user_metadata: {}
        };
      }
    })
  });

  const status = await auth.checkSession();

  assert.equal(status.ok, true);
  assert.equal(status.reason, 'ok');
  assert.equal(storage.get('chem_session_id'), 'after-wake-session');
  assert.equal(storage.has('gotrue.user'), true);
  assert.equal(redirect, '');
});

test('a stale tab cannot erase a newer shared browser session', async () => {
  const storage = new Map([
    ['chem_session_id', 'current-tab-session'],
    ['gotrue.user', '{"token":"current"}']
  ]);
  let redirect = '';
  const staleUser = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'stale-tab-session' },
    user_metadata: {},
    jwt: async () => jwtFor({ roles: ['active'], session_id: 'stale-tab-session' })
  };
  const auth = loadChemAuth('', staleUser, {
    pathname: '/members/module/forms/',
    onReplace(value) { redirect = value; },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, value); }
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          email: staleUser.email,
          app_metadata: { roles: ['active'], session_id: 'current-tab-session' },
          user_metadata: {}
        };
      }
    })
  });

  const status = await auth.checkSession();

  assert.equal(status.ok, true);
  assert.equal(status.reason, 'ok');
  assert.equal(storage.get('chem_session_id'), 'current-tab-session');
  assert.equal(storage.has('gotrue.user'), true);
  assert.equal(redirect, '');
});

test('session invalidation rechecks shared storage before clearing another tab login', async () => {
  const storage = new Map([
    ['chem_session_id', 'old-session'],
    ['gotrue.user', '{"token":"current"}']
  ]);
  let sidReads = 0;
  let redirect = '';
  const user = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'old-session' },
    user_metadata: {},
    jwt: async () => jwtFor({ roles: ['active'], session_id: 'old-session' })
  };
  const auth = loadChemAuth('', user, {
    pathname: '/members/',
    onReplace(value) { redirect = value; },
    localStorage: {
      getItem(key) {
        if (key === 'chem_session_id') {
          sidReads += 1;
          return sidReads === 1 ? 'old-session' : 'new-session';
        }
        return storage.get(key) || null;
      },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, value); }
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          email: user.email,
          app_metadata: { roles: ['active'], session_id: 'new-session' },
          user_metadata: {}
        };
      }
    })
  });

  const status = await auth.checkSession();

  assert.equal(status.ok, true);
  assert.equal(status.reason, 'ok');
  assert.equal(storage.has('gotrue.user'), true);
  assert.equal(redirect, '');
});

test('opening a members page reuses a valid JWT instead of forcing a cross-tab refresh', async () => {
  const documentListeners = {};
  const jwtCalls = [];
  const token = jwtFor({ roles: ['active'], session_id: 'same-session' });
  const user = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'same-session' },
    user_metadata: {},
    async jwt(forceRefresh) {
      jwtCalls.push(forceRefresh);
      return token;
    }
  };
  let redirect = '';
  const auth = loadChemAuth('', user, {
    pathname: '/members/',
    onReplace(value) { redirect = value; },
    onDocumentListener(name, callback) { documentListeners[name] = callback; },
    localStorage: {
      getItem(key) { return key === 'chem_session_id' ? 'same-session' : null; },
      removeItem() {},
      setItem() {}
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          email: user.email,
          app_metadata: { roles: ['active'], session_id: 'same-session' },
          user_metadata: {}
        };
      }
    })
  });

  await documentListeners.DOMContentLoaded();
  const ready = await auth.ready;

  assert.equal(ready.authenticated, true);
  assert.equal(ready.session.ok, true);
  assert.equal(jwtCalls.includes(true), false);
  assert.deepEqual(jwtCalls, [undefined, false]);
  assert.equal(redirect, '');
});

test('a transient cookie refresh failure after wake stays authenticated and retries later', async () => {
  const documentListeners = {};
  const token = jwtFor({ roles: ['active'], session_id: 'same-session' });
  let jwtCalls = 0;
  const user = {
    email: 'kursant@example.com',
    app_metadata: { roles: ['active'], session_id: 'same-session' },
    user_metadata: {},
    async jwt() {
      jwtCalls += 1;
      if (jwtCalls === 1) return token;
      throw new Error('network unavailable');
    }
  };
  let redirect = '';
  const storage = new Map([
    ['chem_session_id', 'same-session'],
    ['gotrue.user', '{"token":"persisted"}']
  ]);
  const auth = loadChemAuth('', user, {
    pathname: '/members/',
    onReplace(value) { redirect = value; },
    onDocumentListener(name, callback) { documentListeners[name] = callback; },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, value); }
    },
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          email: user.email,
          app_metadata: { roles: ['active'], session_id: 'same-session' },
          user_metadata: {}
        };
      }
    })
  });

  await documentListeners.DOMContentLoaded();
  const ready = await auth.ready;

  assert.equal(ready.authenticated, true);
  assert.equal(ready.session.ok, true);
  assert.equal(ready.session.reason, 'token_refresh_pending');
  assert.equal(storage.has('gotrue.user'), true);
  assert.equal(redirect, '');
});

test('a hidden tab ignores token expiry and leaves shared refresh work to the visible tab', async () => {
  let listeners;
  let jwtCalls = 0;
  const user = {
    app_metadata: { roles: ['active'], session_id: 'same-session' },
    user_metadata: {},
    async jwt() {
      jwtCalls += 1;
      return jwtFor({ roles: ['active'], session_id: 'same-session' });
    }
  };
  loadChemAuth('', user, {
    pathname: '/members/',
    documentHidden: true,
    onIdentityListeners(value) { listeners = value; }
  });

  await listeners.tokenExpired();

  assert.equal(jwtCalls, 0);
});
