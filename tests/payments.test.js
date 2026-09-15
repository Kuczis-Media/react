'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const payments = require('../netlify/payment-common.js');
const paymentConfig = require('../netlify/functions/payment-config.js');
const paymentAdmin = require('../netlify/functions/payment-admin.js');
const createCheckout = require('../netlify/functions/create-checkout.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-07-17T10:00:00.000Z');

function publicOffer(overrides = {}) {
  return {
    ...payments.publicPriceConfig(payments.defaultPriceConfig(), {
      checkoutAvailable: true,
      testMode: false
    }),
    ...overrides
  };
}

function loadPaymentsClient({ storage = new Map(), fetchImpl, schedule = setTimeout, cancel = clearTimeout }) {
  const events = {};
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  const localStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const window = {
    document,
    localStorage,
    addEventListener(name, callback) { events[name] = callback; },
    setTimeout: schedule,
    clearTimeout: cancel,
    dispatchEvent() {},
    location: { assign() {} }
  };
  const context = {
    AbortController,
    console,
    CustomEvent: class CustomEvent {},
    Date,
    document,
    fetch: fetchImpl,
    Intl,
    location: { origin: 'https://nextmed.example', search: '' },
    Promise,
    localStorage,
    setTimeout,
    URL,
    window
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'payments', 'payments.js'), 'utf8'),
    context,
    { filename: 'payments.js' }
  );
  return { api: window.ChemPayments, storage, events };
}

test('price requests time out, release the shared pending request and can be retried', async () => {
  let expire; let attempts = 0; let cancelled = 0;
  const client = loadPaymentsClient({
    schedule: (callback, delay) => { assert.equal(delay, 10_000); expire = callback; return 1; },
    cancel: () => { cancelled++; },
    fetchImpl: async (url, options) => {
      attempts++;
      if (attempts === 1) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted'))));
      return { ok: true, json: async () => publicOffer() };
    }
  });
  const first = client.api.loadConfig(false);
  assert.equal(client.api.loadConfig(false), first);
  expire();
  await assert.rejects(first, /Aborted/);
  assert.equal(attempts, 1);
  await client.api.loadConfig(false);
  assert.equal(attempts, 2);
  assert.equal(cancelled, 2);
});

function purchase(id, plan = 'month', amount = 5_000) {
  return {
    id,
    userId: USER_ID,
    plan,
    amount,
    paidAt: new Date(NOW).toISOString(),
    paymentIntent: `pi_${id.replace(/^cs_(?:test_)?/, '')}`
  };
}

test('default Stripe offer contains every timed role and keeps the original four plans enabled', () => {
  const config = payments.defaultPriceConfig();
  assert.deepEqual(config.prices, {
    hour: 500,
    day: 1_500,
    week: 3_000,
    month: 5_000,
    halfyear: 30_000,
    year: 50_000
  });
  assert.deepEqual(
    payments.PLANS.map(({ id, durationDays }) => [id, durationDays]),
    [['hour', 1 / 24], ['day', 1], ['week', 7], ['month', 30], ['halfyear', 182], ['year', 365]]
  );
  assert.deepEqual(config.enabledPlans, ['week', 'month', 'halfyear', 'year']);
  assert.equal(config.paymentsEnabled, true);
  assert.equal(config.stackingEnabled, true);
});

test('public payment config is CDN-cacheable while authenticated admin reads stay private', async (t) => {
  payments._test.setStoreFactory(() => ({
    async getWithMetadata() { return null; }
  }));
  t.after(() => payments._test.setStoreFactory(null));

  const publicResponse = await paymentConfig.handler({
    httpMethod: 'GET',
    queryStringParameters: {}
  });
  assert.equal(publicResponse.statusCode, 200);
  assert.match(publicResponse.headers['Cache-Control'], /public, max-age=60/);
  assert.match(publicResponse.headers['Netlify-CDN-Cache-Control'], /durable/);
  assert.match(publicResponse.headers['Netlify-CDN-Cache-Control'], /max-age=300/);
  assert.match(publicResponse.headers['Netlify-CDN-Cache-Control'], /stale-while-revalidate=1800/);
  assert.equal(publicResponse.headers['Netlify-Cache-Tag'], 'nextmed-payment-config');

  const admin = { id: ADMIN_ID, app_metadata: { roles: ['admin'] } };
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify(admin), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }));
  const adminResponse = await paymentConfig.handler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer admin-token' },
    queryStringParameters: { admin: '1' }
  }, {
    clientContext: {
      user: admin,
      identity: { url: 'https://identity.example' }
    }
  });
  assert.equal(adminResponse.statusCode, 200);
  assert.equal(adminResponse.headers['Cache-Control'], 'no-store');
  assert.equal(adminResponse.headers['Netlify-CDN-Cache-Control'], undefined);
  assert.equal(JSON.parse(adminResponse.body).source, 'default');
});

test('safe public fallback is cached briefly when payment storage is unavailable', async (t) => {
  payments._test.setStoreFactory(() => { throw new Error('offline'); });
  t.after(() => payments._test.setStoreFactory(null));
  const response = await paymentConfig.handler({ httpMethod: 'GET', queryStringParameters: {} });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['Cache-Control'], /max-age=60/);
  assert.match(response.headers['Netlify-CDN-Cache-Control'], /max-age=300/);
  assert.equal(JSON.parse(response.body).checkoutAvailable, false);
});

test('browser payment config reuses only a fresh validated public cache across pages and force bypasses it', async () => {
  const storage = new Map();
  const requests = [];
  const firstOffer = publicOffer();
  const refreshedOffer = publicOffer({ currency: 'eur' });
  let responseOffer = firstOffer;
  const fetchImpl = async (_url, options) => {
    requests.push(options);
    return { ok: true, json: async () => responseOffer };
  };

  const firstPage = loadPaymentsClient({ storage, fetchImpl });
  const first = await firstPage.api.loadConfig(false);
  assert.equal(first.currency, 'pln');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].cache, 'default');
  assert.equal(requests[0].credentials, 'omit', 'Public offers must not forward a visitor session');

  const secondPage = loadPaymentsClient({ storage, fetchImpl });
  const cached = await secondPage.api.loadConfig(false);
  assert.equal(cached.currency, 'pln');
  assert.equal(requests.length, 1);

  responseOffer = refreshedOffer;
  const refreshed = await secondPage.api.loadConfig(true);
  assert.equal(refreshed.currency, 'eur');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].cache, 'no-store');
});

test('browser payment config rejects malformed or expired public cache entries', async () => {
  const cacheKey = 'nextmed.payments.public-config.v1';
  const malformedStorage = new Map([[cacheKey, JSON.stringify({
    savedAt: Date.now(),
    config: publicOffer({ plans: [{ id: 'month', amount: 'free' }] })
  })]]);
  let malformedFetches = 0;
  const malformedPage = loadPaymentsClient({
    storage: malformedStorage,
    fetchImpl: async () => {
      malformedFetches += 1;
      return { ok: true, json: async () => publicOffer() };
    }
  });
  await malformedPage.api.loadConfig(false);
  assert.equal(malformedFetches, 1);

  const expiredStorage = new Map([[cacheKey, JSON.stringify({
    savedAt: Date.now() - 300_001,
    config: publicOffer()
  })]]);
  let expiredFetches = 0;
  const expiredPage = loadPaymentsClient({
    storage: expiredStorage,
    fetchImpl: async () => {
      expiredFetches += 1;
      return { ok: true, json: async () => publicOffer() };
    }
  });
  await expiredPage.api.loadConfig(false);
  assert.equal(expiredFetches, 1);
});

test('price cache changes in another tab invalidate settled copies but keep an in-flight request shared', async () => {
  const key = 'nextmed.payments.public-config.v1';
  let finish; let requests = 0;
  const client = loadPaymentsClient({ fetchImpl: async () => {
    requests++;
    if (requests === 1) await new Promise((resolve) => { finish = resolve; });
    return { ok: true, json: async () => publicOffer() };
  } });
  const first = client.api.loadConfig(false);
  client.events.storage({ key });
  assert.equal(client.api.loadConfig(false), first);
  finish(); await first;
  client.storage.set(key, JSON.stringify({ savedAt: Date.now(), config: publicOffer({ currency: 'eur' }) }));
  client.events.storage({ key });
  assert.equal((await client.api.loadConfig(false)).currency, 'eur');
  assert.equal(requests, 1, 'A fresh public offer from another tab needs no additional request');
  client.storage.delete(key);
  client.events.storage({ key });
  await client.api.loadConfig(false);
  assert.equal(requests, 2, 'Removing the public cache after a price edit also invalidates the in-memory copy');
});

test('an existing four-price configuration migrates without changing its public offer', () => {
  const normalized = payments.normalizePriceConfig({
    version: 1,
    currency: 'pln',
    prices: { week: 3_000, month: 5_000, halfyear: 30_000, year: 50_000 }
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.prices.hour, 500);
  assert.equal(normalized.value.prices.day, 1_500);
  assert.deepEqual(normalized.value.enabledPlans, ['week', 'month', 'halfyear', 'year']);
  assert.equal(normalized.value.paymentsEnabled, true);
  assert.equal(normalized.value.stackingEnabled, true);
});

test('hour and day purchases grant the exact durations represented in netlify.toml roles', () => {
  const hour = payments.applyPurchase(
    payments.emptyLedger(USER_ID),
    purchase('cs_test_hourpurchase123', 'hour', 500),
    NOW
  );
  assert.equal(Date.parse(hour.ledger.access.expiresAt) - NOW, payments.HOUR_MS);

  const day = payments.applyPurchase(
    payments.emptyLedger(USER_ID),
    purchase('cs_test_daypurchase1234', 'day', 1_500),
    NOW
  );
  assert.equal(Date.parse(day.ledger.access.expiresAt) - NOW, payments.DAY_MS);
});

test('a second purchase extends the existing expiry instead of resetting it', () => {
  const first = payments.applyPurchase(
    payments.emptyLedger(USER_ID),
    purchase('cs_test_firstpayment123'),
    NOW
  );
  const second = payments.applyPurchase(
    first.ledger,
    purchase('cs_test_secondpayment12'),
    NOW + payments.DAY_MS
  );

  assert.equal(first.ledger.access.expiresAt, '2026-08-16T10:00:00.000Z');
  assert.equal(second.ledger.access.expiresAt, '2026-09-15T10:00:00.000Z');
  assert.equal(second.ledger.access.assignedAt, '2026-07-17T10:00:00.000Z');
  assert.equal(second.ledger.events.length, 2);
});

test('replaying the same Checkout Session is idempotent', () => {
  const checkout = purchase('cs_test_idempotent12345', 'week', 3_000);
  const first = payments.applyPurchase(payments.emptyLedger(USER_ID), checkout, NOW);
  const replay = payments.applyPurchase(first.ledger, checkout, NOW + 5_000);

  assert.equal(replay.changed, false);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.ledger, first.ledger);
});

test('payment history keeps the latest 100 events without replaying a pruned Checkout Session', () => {
  let ledger = payments.emptyLedger(USER_ID);
  for (let index = 0; index < 105; index += 1) {
    const timestamp = NOW + index * 1_000;
    const checkout = purchase(`cs_test_retention${String(index).padStart(4, '0')}`);
    checkout.paidAt = new Date(timestamp).toISOString();
    ledger = payments.applyPurchase(ledger, checkout, timestamp).ledger;
  }

  assert.equal(payments.MAX_LEDGER_EVENTS, 100);
  assert.equal(ledger.events.length, 100);
  assert.equal(ledger.events[0].id, 'cs_test_retention0005');
  assert.equal(ledger.checkoutSessionsProcessedThrough, new Date(NOW + 4_000).toISOString());
  assert.equal(payments.publicLedger(ledger).history.length, 100);

  const accessBeforeReplay = ledger.access.expiresAt;
  const oldCheckout = purchase('cs_test_retention0000');
  oldCheckout.paidAt = new Date(NOW).toISOString();
  const replay = payments.applyPurchase(ledger, oldCheckout, NOW + 200_000);
  assert.equal(replay.changed, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.ledger.access.expiresAt, accessBeforeReplay);

  const newCheckout = purchase('cs_test_retention0105');
  newCheckout.paidAt = new Date(NOW + 105_000).toISOString();
  const next = payments.applyPurchase(ledger, newCheckout, NOW + 105_000);
  assert.equal(next.changed, true);
  assert.equal(next.ledger.events.length, 100);
  assert.equal(next.ledger.events.at(-1).id, 'cs_test_retention0105');
});

test('a legacy ledger above the new history limit is compacted on its next mutation', () => {
  let ledger = payments.emptyLedger(USER_ID);
  for (let index = 0; index < 100; index += 1) {
    const timestamp = NOW + index * 1_000;
    const checkout = purchase(`cs_test_legacy${String(index).padStart(4, '0')}`);
    checkout.paidAt = new Date(timestamp).toISOString();
    ledger = payments.applyPurchase(ledger, checkout, timestamp).ledger;
  }
  const oldest = {
    ...ledger.events[0],
    id: 'cs_test_legacyhistorical00',
    paidAt: new Date(NOW - 1_000).toISOString(),
    recordedAt: new Date(NOW - 1_000).toISOString()
  };
  const legacyLedger = {
    ...ledger,
    events: [oldest, ...ledger.events]
  };
  delete legacyLedger.checkoutSessionsProcessedThrough;

  const compacted = payments.applyRevocation(legacyLedger, {
    userId: USER_ID,
    actorId: ADMIN_ID,
    reason: 'migration test'
  }, NOW + 200_000).ledger;

  assert.equal(compacted.events.length, 100);
  assert.equal(compacted.events.at(-1).type, 'revocation');
  assert.equal(compacted.checkoutSessionsProcessedThrough, new Date(NOW).toISOString());
});

test('a new purchase after expiry starts from now while a mixed plan stacks exactly once', () => {
  const old = payments.applyPurchase(
    payments.emptyLedger(USER_ID),
    purchase('cs_test_oldweekpayment1', 'week', 3_000),
    NOW - 20 * payments.DAY_MS
  );
  const renewed = payments.applyPurchase(
    old.ledger,
    purchase('cs_test_newyearpayment1', 'year', 50_000),
    NOW
  );
  assert.equal(renewed.ledger.access.role, 'year');
  assert.equal(
    Date.parse(renewed.ledger.access.expiresAt) - NOW,
    365 * payments.DAY_MS
  );
});

test('paid time also stacks on top of a later manually granted Identity window', () => {
  const ledger = payments.emptyLedger(USER_ID);
  const manualExpiry = '2026-08-01T10:00:00.000Z';
  const merged = payments.mergeLedgerAccess(ledger, {
    role: 'week',
    assignedAt: '2026-07-10T10:00:00.000Z',
    expiresAt: manualExpiry
  });
  const paid = payments.applyPurchase(
    merged,
    purchase('cs_test_manualstack1234', 'month', 5_000),
    NOW
  );

  assert.equal(paid.ledger.access.assignedAt, '2026-07-10T10:00:00.000Z');
  assert.equal(
    Date.parse(paid.ledger.access.expiresAt) - Date.parse(manualExpiry),
    30 * payments.DAY_MS
  );
});

test('administrator revocation expires access and records an audit event', () => {
  const paid = payments.applyPurchase(
    payments.emptyLedger(USER_ID),
    purchase('cs_test_revokeexample12'),
    NOW
  );
  const revoked = payments.applyRevocation(paid.ledger, {
    userId: USER_ID,
    actorId: ADMIN_ID,
    reason: 'test'
  }, NOW + payments.DAY_MS);

  assert.equal(revoked.ledger.access.expiresAt, '2026-07-18T10:00:00.000Z');
  assert.equal(revoked.ledger.events.at(-1).type, 'revocation');
  assert.equal(payments.publicAccess(revoked.ledger, NOW + 2 * payments.DAY_MS).active, false);
});

test('Checkout fulfillment validation binds paid session to user, plan, amount and supported currency', () => {
  const valid = payments.validateCheckoutSession({
    id: 'cs_test_checkoutvalid123',
    mode: 'payment',
    payment_status: 'paid',
    client_reference_id: USER_ID,
    currency: 'pln',
    amount_total: 5_000,
    created: NOW / 1000,
    payment_intent: 'pi_checkoutvalid123',
    metadata: { userId: USER_ID, plan: 'month', amount: '5000', durationDays: '30' }
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.userId, USER_ID);
  assert.equal(valid.value.currency, 'pln');

  const euro = payments.validateCheckoutSession({
    id: 'cs_test_checkouteuro1234',
    mode: 'payment',
    payment_status: 'paid',
    client_reference_id: USER_ID,
    currency: 'eur',
    amount_total: 5_000,
    metadata: { userId: USER_ID, plan: 'month', amount: '5000', durationDays: '30' }
  });
  assert.equal(euro.ok, true);
  assert.equal(euro.value.currency, 'eur');

  for (const override of [
    { payment_status: 'unpaid' },
    { client_reference_id: ADMIN_ID },
    { currency: 'nzd' },
    { metadata: { userId: USER_ID, plan: 'minute' } }
  ]) {
    const invalid = payments.validateCheckoutSession({
      id: 'cs_test_checkoutvalid123',
      mode: 'payment',
      payment_status: 'paid',
      client_reference_id: USER_ID,
      currency: 'pln',
      amount_total: 5_000,
      metadata: { userId: USER_ID, plan: 'month', amount: '5000', durationDays: '30' },
      ...override
    });
    assert.equal(invalid.ok, false);
  }
});

test('price and admin action inputs are strictly validated', () => {
  const validPrices = {
    hour: 500,
    day: 1_500,
    week: 3_000,
    month: 5_000,
    halfyear: 30_000,
    year: 50_000
  };
  assert.equal(paymentConfig._test.validateUpdate({
    currency: 'eur',
    enabledPlans: ['day', 'month'],
    expectedEtag: null,
    paymentsEnabled: false,
    prices: validPrices,
    stackingEnabled: false
  }).ok, true);
  assert.equal(paymentConfig._test.validateUpdate({
    currency: 'pln',
    enabledPlans: ['week'],
    expectedEtag: null,
    paymentsEnabled: true,
    prices: { ...validPrices, week: 0 },
    stackingEnabled: true
  }).code, 'INVALID_PRICE');
  assert.equal(paymentConfig._test.validateUpdate({
    currency: 'nzd',
    enabledPlans: [],
    expectedEtag: null,
    paymentsEnabled: true,
    prices: validPrices,
    stackingEnabled: true
  }).code, 'INVALID_CURRENCY');
  assert.equal(paymentAdmin._test.validateAction({ action: 'revoke', userId: USER_ID }).ok, true);
  assert.equal(paymentAdmin._test.validateAction({ action: 'refund', userId: USER_ID }).code, 'INVALID_PAYMENT_ACTION');
  assert.equal(createCheckout._test.validatePlanRequest({ plan: 'month' }), 'month');
  assert.equal(createCheckout._test.validatePlanRequest({ plan: 'hour' }), 'hour');
  assert.equal(createCheckout._test.hasTimedOrPermanentAccess({
    app_metadata: { roles: ['month'], timed_access: { role: 'month', expires_at: '2099-01-01T00:00:00.000Z' } }
  }), true);
  assert.equal(createCheckout._test.hasTimedOrPermanentAccess({
    app_metadata: { roles: ['month'], timed_access: { role: 'month', expires_at: '2020-01-01T00:00:00.000Z' } }
  }), false);
  assert.equal(paymentConfig._test.validateUpdate({
    currency: 'pln',
    enabledPlans: ['month'],
    expectedEtag: null,
    paymentsEnabled: 'yes',
    prices: validPrices,
    stackingEnabled: true
  }).code, 'INVALID_PAYMENT_ENABLED_SETTING');
});

test('payment offer has a separate purchase page and admin users remain collapsible', () => {
  const root = path.join(__dirname, '..');
  const home = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const login = fs.readFileSync(path.join(root, 'public', 'login', 'index.html'), 'utf8');
  const members = fs.readFileSync(path.join(root, 'public', 'members', 'index.html'), 'utf8');
  const purchasePage = fs.readFileSync(path.join(root, 'public', 'purchase', 'index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');

  assert.match(home, /data-pricing-mode=["']public["']/);
  assert.match(login, /id=["']inactive-account["']/);
  assert.match(login, /data-pricing-mode=["']inactive["']/);
  assert.doesNotMatch(members, /data-pricing-mode=["']authenticated["']/);
  assert.match(members, /href=["']\/purchase\/["'][\s\S]*Kup lub przedłuż/);
  assert.match(purchasePage, /data-pricing-mode=["']authenticated["']/);
  const management = fs.readFileSync(path.join(root, 'public/members/module/studio/manage/index.html'), 'utf8');
  assert.match(management, /id=["']admin-payment-disabled["']/);
  assert.match(management, /data-admin-tab=["']payments["']/);
  assert.doesNotMatch(members, /data-admin-tab=["']payments["']/);
  assert.match(members, /Kup lub przedłuż[\s\S]*Status dostępu/);
  assert.match(dashboard, /document\.createElement\('details'\)/);
  assert.match(dashboard, /PAYMENT_ADMIN_URL/);
});
