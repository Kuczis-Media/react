'use strict';

const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');
const {
  defaultPriceConfig,
  getPaymentStore,
  PLANS,
  SUPPORTED_CURRENCIES,
  paymentStoreConfig,
  publicPriceConfig,
  readPriceConfig,
  stripeEnvironment,
  writePriceConfig
} = require('../payment-common.js');

const PUBLIC_CACHE_HEADERS = Object.freeze({
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  'Netlify-CDN-Cache-Control': 'public, durable, max-age=300, stale-while-revalidate=1800',
  'Netlify-Cache-Tag': 'nextmed-payment-config',
  Vary: 'Accept-Encoding'
});

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        Allow: 'GET, PUT, OPTIONS',
        'Cache-Control': 'no-store',
        Vary: 'Origin'
      },
      body: ''
    };
  }
  if (!['GET', 'PUT'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, OPTIONS' });
  }

  const adminView = method === 'PUT' ||
    String(event.queryStringParameters && event.queryStringParameters.admin || '') === '1';
  let auth = null;
  if (adminView) {
    auth = await requireAdmin(event, context);
    if (!auth.ok) return responseForFailure(auth);
  }

  if (method === 'PUT') {
    const guard = mutationGuard(event, { maxBodyBytes: 8_192 });
    if (!guard.ok) return responseForFailure(guard);
  }

  const environment = stripeEnvironment();
  let store;
  try {
    store = getPaymentStore();
  } catch (error) {
    if (method === 'GET' && !adminView) {
      return json(publicPriceConfig(defaultPriceConfig(), {
        checkoutAvailable: false,
        testMode: environment.testMode
      }), 200, PUBLIC_CACHE_HEADERS);
    }
    return json({ error: error.code || 'PAYMENT_STORAGE_UNAVAILABLE' }, error.status || 503);
  }

  try {
    if (method === 'GET') {
      const current = await readPriceConfig(store);
      return json({
        ...publicPriceConfig(current.config, {
          checkoutAvailable: environment.configured && current.config.paymentsEnabled,
          testMode: environment.testMode
        }),
        ...(adminView ? {
          etag: current.etag,
          source: current.source,
          stripeConfigured: environment.configured
        } : {})
      }, 200, adminView ? {} : PUBLIC_CACHE_HEADERS);
    }

    const parsed = parseJsonBody(event);
    if (!parsed.ok) return responseForFailure(parsed);
    const validation = validateUpdate(parsed.value);
    if (!validation.ok) return json({ error: validation.code }, validation.status || 400);
    const saved = await writePriceConfig(
      store,
      validation.value,
      validation.value.expectedEtag,
      auth.userId
    );
    return json({
      ...publicPriceConfig(saved.config, {
        checkoutAvailable: environment.configured && saved.config.paymentsEnabled,
        testMode: environment.testMode
      }),
      etag: saved.etag,
      source: saved.source,
      stripeConfigured: environment.configured
    });
  } catch (error) {
    console.error('payment-config failed', safeErrorName(error));
    const code = error && error.code ? error.code : 'PAYMENT_STORAGE_UNAVAILABLE';
    return json({ error: code }, error && error.status ? error.status : 503);
  }
};

function validateUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY' };
  }
  if (Object.keys(body).some((key) => ![
    'currency',
    'enabledPlans',
    'expectedEtag',
    'paymentsEnabled',
    'prices',
    'stackingEnabled'
  ].includes(key))) {
    return { ok: false, code: 'UNEXPECTED_FIELDS' };
  }
  if (!body.prices || typeof body.prices !== 'object' || Array.isArray(body.prices)) {
    return { ok: false, code: 'INVALID_PRICE' };
  }
  const allowedPlans = new Set(PLANS.map((plan) => plan.id));
  if (
    Object.keys(body.prices).length !== allowedPlans.size ||
    Object.keys(body.prices).some((key) => !allowedPlans.has(key))
  ) {
    return { ok: false, code: 'INVALID_PRICE' };
  }
  const prices = {};
  for (const id of allowedPlans) {
    const amount = body.prices[id];
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1_000_000) {
      return { ok: false, code: 'INVALID_PRICE' };
    }
    prices[id] = amount;
  }
  const currency = typeof body.currency === 'string' ? body.currency.trim().toLowerCase() : '';
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    return { ok: false, code: 'INVALID_CURRENCY' };
  }
  if (!Array.isArray(body.enabledPlans)) {
    return { ok: false, code: 'INVALID_ENABLED_PLANS' };
  }
  const enabledPlans = Array.from(new Set(body.enabledPlans));
  if (
    enabledPlans.length !== body.enabledPlans.length ||
    enabledPlans.some((id) => typeof id !== 'string' || !allowedPlans.has(id))
  ) {
    return { ok: false, code: 'INVALID_ENABLED_PLANS' };
  }
  if (typeof body.stackingEnabled !== 'boolean') {
    return { ok: false, code: 'INVALID_STACKING_SETTING' };
  }
  if (typeof body.paymentsEnabled !== 'boolean') {
    return { ok: false, code: 'INVALID_PAYMENT_ENABLED_SETTING' };
  }
  const expectedEtag = body.expectedEtag;
  if (expectedEtag !== null && (
    typeof expectedEtag !== 'string' ||
    !expectedEtag ||
    expectedEtag.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(expectedEtag)
  )) {
    return { ok: false, code: 'INVALID_ETAG' };
  }
  return {
    ok: true,
    value: {
      currency,
      enabledPlans,
      expectedEtag,
      paymentsEnabled: body.paymentsEnabled,
      prices,
      stackingEnabled: body.stackingEnabled
    }
  };
}

function safeErrorName(error) {
  return error && error.name ? String(error.name) : 'Error';
}

exports._test = {
  PUBLIC_CACHE_HEADERS,
  validateUpdate,
  paymentStoreConfig
};
