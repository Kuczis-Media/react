'use strict';

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const {
  COURSE_ROLES,
  plainObject,
  readJson,
  rolesFrom,
  userId
} = require('./admin-common.js');

const STORE_NAME = 'chemdisk-payments';
const CONFIG_KEY = 'config/prices.json';
const LEDGER_VERSION = 1;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IDENTITY_TIMEOUT_MS = 8_000;
const MAX_LEDGER_EVENTS = 100;
const MAX_LEGACY_LEDGER_EVENTS = 2_000;
const MAX_CAS_ATTEMPTS = 8;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKOUT_ID_PATTERN = /^cs_(?:test_|live_)?[A-Za-z0-9_]{8,240}$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]{8,240}$/;
const COURSE_GRANT_ROLES = new Set(COURSE_ROLES.filter((role) => role !== 'admin'));
const SUPPORTED_CURRENCIES = Object.freeze(['pln', 'eur', 'usd', 'gbp', 'chf', 'czk', 'cad', 'aud']);
const SUPPORTED_CURRENCY_SET = new Set(SUPPORTED_CURRENCIES);

const PLANS = Object.freeze([
  Object.freeze({
    id: 'hour',
    label: 'Godzina',
    durationLabel: '1 godzina dostępu',
    durationDays: 1 / 24,
    durationMs: HOUR_MS,
    defaultAmount: 500,
    defaultEnabled: false
  }),
  Object.freeze({
    id: 'day',
    label: 'Dzień',
    durationLabel: '24 godziny dostępu',
    durationDays: 1,
    durationMs: DAY_MS,
    defaultAmount: 1_500,
    defaultEnabled: false
  }),
  Object.freeze({
    id: 'week',
    label: 'Tydzień',
    durationLabel: '7 dni dostępu',
    durationDays: 7,
    durationMs: 7 * DAY_MS,
    defaultAmount: 3_000,
    defaultEnabled: true
  }),
  Object.freeze({
    id: 'month',
    label: 'Miesiąc',
    durationLabel: '30 dni dostępu',
    durationDays: 30,
    durationMs: 30 * DAY_MS,
    defaultAmount: 5_000,
    defaultEnabled: true,
    featured: true
  }),
  Object.freeze({
    id: 'halfyear',
    label: 'Pół roku',
    durationLabel: '182 dni dostępu',
    durationDays: 182,
    durationMs: 182 * DAY_MS,
    defaultAmount: 30_000,
    defaultEnabled: true
  }),
  Object.freeze({
    id: 'year',
    label: 'Rok',
    durationLabel: '365 dni dostępu',
    durationDays: 365,
    durationMs: 365 * DAY_MS,
    defaultAmount: 50_000,
    defaultEnabled: true
  })
]);
const PLAN_BY_ID = new Map(PLANS.map((plan) => [plan.id, plan]));

let injectedStoreFactory = null;

function defaultPriceConfig() {
  return {
    version: 1,
    currency: 'pln',
    enabledPlans: PLANS.filter((plan) => plan.defaultEnabled).map((plan) => plan.id),
    paymentsEnabled: true,
    stackingEnabled: true,
    updatedAt: null,
    updatedBy: null,
    prices: Object.fromEntries(PLANS.map((plan) => [plan.id, plan.defaultAmount]))
  };
}

function publicPriceConfig(config, options = {}) {
  const normalized = normalizePriceConfig(config);
  if (!normalized.ok) throw paymentError('PAYMENT_CONFIG_INVALID');
  return {
    currency: normalized.value.currency,
    enabledPlans: [...normalized.value.enabledPlans],
    paymentsEnabled: normalized.value.paymentsEnabled,
    stackingEnabled: normalized.value.stackingEnabled,
    updatedAt: normalized.value.updatedAt,
    checkoutAvailable: Boolean(options.checkoutAvailable),
    testMode: Boolean(options.testMode),
    plans: PLANS.map((plan) => ({
      id: plan.id,
      label: plan.label,
      durationLabel: plan.durationLabel,
      durationDays: plan.durationDays,
      amount: normalized.value.prices[plan.id],
      enabled: normalized.value.enabledPlans.includes(plan.id),
      featured: Boolean(plan.featured)
    }))
  };
}

function normalizePriceConfig(value) {
  if (!plainObject(value)) return { ok: false, code: 'PAYMENT_CONFIG_INVALID' };
  if (!SUPPORTED_CURRENCY_SET.has(value.currency) || !plainObject(value.prices)) {
    return { ok: false, code: 'PAYMENT_CONFIG_INVALID' };
  }
  const legacyConfig = !Array.isArray(value.enabledPlans);
  const enabledPlans = legacyConfig
    ? PLANS.filter((plan) => plan.defaultEnabled).map((plan) => plan.id)
    : uniqueStrings(value.enabledPlans);
  if (enabledPlans.some((id) => !PLAN_BY_ID.has(id))) {
    return { ok: false, code: 'INVALID_ENABLED_PLANS' };
  }
  const prices = {};
  for (const plan of PLANS) {
    const amount = value.prices[plan.id] == null && legacyConfig
      ? plan.defaultAmount
      : value.prices[plan.id];
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1_000_000) {
      return { ok: false, code: 'INVALID_PRICE' };
    }
    prices[plan.id] = amount;
  }
  return {
    ok: true,
    value: {
      version: Number.isSafeInteger(value.version) && value.version > 0 ? value.version : 1,
      currency: value.currency,
      enabledPlans,
      paymentsEnabled: typeof value.paymentsEnabled === 'boolean' ? value.paymentsEnabled : true,
      stackingEnabled: typeof value.stackingEnabled === 'boolean' ? value.stackingEnabled : true,
      updatedAt: safeDateString(value.updatedAt),
      updatedBy: validUserId(value.updatedBy) ? value.updatedBy : null,
      prices
    }
  };
}

async function readPriceConfig(store) {
  const entry = await store.getWithMetadata(CONFIG_KEY, {
    type: 'text',
    consistency: 'strong'
  });
  if (!entry) return { config: defaultPriceConfig(), etag: null, source: 'default' };
  let parsed;
  try {
    parsed = JSON.parse(entry.data);
  } catch {
    throw paymentError('PAYMENT_CONFIG_INVALID');
  }
  const normalized = normalizePriceConfig(parsed);
  if (!normalized.ok || !validEtag(entry.etag)) throw paymentError(normalized.code || 'PAYMENT_CONFIG_INVALID');
  return {
    config: normalized.value,
    etag: entry.etag,
    source: 'blob'
  };
}

async function writePriceConfig(store, input, expectedEtag, actorId) {
  const validation = normalizePriceConfig({
    version: 1,
    currency: input.currency,
    prices: input.prices,
    enabledPlans: input.enabledPlans,
    paymentsEnabled: input.paymentsEnabled,
    stackingEnabled: input.stackingEnabled,
    updatedAt: new Date().toISOString(),
    updatedBy: actorId
  });
  if (!validation.ok) throw paymentError(validation.code);

  const current = await store.getMetadata(CONFIG_KEY, { consistency: 'strong' });
  const currentEtag = current && validEtag(current.etag) ? current.etag : null;
  if (expectedEtag !== currentEtag) throw paymentError('PAYMENT_CONFIG_CONFLICT', 409);

  const config = {
    ...validation.value,
    version: current && current.metadata && Number.isSafeInteger(current.metadata.version)
      ? current.metadata.version + 1
      : 1
  };
  const options = {
    metadata: {
      version: config.version,
      updatedAt: config.updatedAt,
      updatedBy: actorId
    },
    ...(currentEtag ? { onlyIfMatch: currentEtag } : { onlyIfNew: true })
  };
  const result = await store.set(CONFIG_KEY, JSON.stringify(config), options);
  if (!result || result.modified !== true) throw paymentError('PAYMENT_CONFIG_CONFLICT', 409);

  const saved = await readPriceConfig(store);
  return saved;
}

function emptyLedger(targetUserId) {
  return {
    schema: LEDGER_VERSION,
    userId: targetUserId,
    version: 0,
    access: {
      role: '',
      assignedAt: null,
      expiresAt: null
    },
    checkoutSessionsProcessedThrough: null,
    events: [],
    updatedAt: null
  };
}

function normalizeLedger(value, expectedUserId) {
  if (!plainObject(value) || value.schema !== LEDGER_VERSION || value.userId !== expectedUserId) {
    throw paymentError('PAYMENT_LEDGER_INVALID');
  }
  if (!Number.isSafeInteger(value.version) || value.version < 0 || !Array.isArray(value.events)) {
    throw paymentError('PAYMENT_LEDGER_INVALID');
  }
  if (value.events.length > MAX_LEGACY_LEDGER_EVENTS) throw paymentError('PAYMENT_LEDGER_TOO_LARGE');

  const access = plainObject(value.access) ? value.access : {};
  const role = PLAN_BY_ID.has(access.role) ? access.role : '';
  const assignedAt = safeDateString(access.assignedAt);
  const expiresAt = safeDateString(access.expiresAt);
  const events = value.events.map(normalizeLedgerEvent).filter(Boolean);
  if (events.length !== value.events.length) throw paymentError('PAYMENT_LEDGER_INVALID');
  const storedProcessedThrough = value.checkoutSessionsProcessedThrough == null
    ? null
    : safeDateString(value.checkoutSessionsProcessedThrough);
  if (value.checkoutSessionsProcessedThrough != null && !storedProcessedThrough) {
    throw paymentError('PAYMENT_LEDGER_INVALID');
  }
  const compacted = compactLedgerEvents(events, storedProcessedThrough);

  return {
    schema: LEDGER_VERSION,
    userId: expectedUserId,
    version: value.version,
    access: { role, assignedAt, expiresAt },
    checkoutSessionsProcessedThrough: compacted.checkoutSessionsProcessedThrough,
    events: compacted.events,
    updatedAt: safeDateString(value.updatedAt)
  };
}

function normalizeLedgerEvent(event) {
  if (!plainObject(event) || typeof event.id !== 'string' || event.id.length > 255) return null;
  if (event.type === 'purchase') {
    if (!CHECKOUT_ID_PATTERN.test(event.id) || !PLAN_BY_ID.has(event.plan)) return null;
    if (!Number.isSafeInteger(event.amount) || event.amount < 0 || !SUPPORTED_CURRENCY_SET.has(event.currency)) return null;
    return {
      id: event.id,
      type: 'purchase',
      plan: event.plan,
      durationDays: PLAN_BY_ID.get(event.plan).durationDays,
      amount: event.amount,
      currency: event.currency,
      paidAt: safeDateString(event.paidAt),
      recordedAt: safeDateString(event.recordedAt),
      accessBefore: safeDateString(event.accessBefore),
      accessAfter: safeDateString(event.accessAfter),
      paymentIntent: PAYMENT_INTENT_PATTERN.test(event.paymentIntent || '') ? event.paymentIntent : null
    };
  }
  if (event.type === 'revocation') {
    return {
      id: event.id,
      type: 'revocation',
      recordedAt: safeDateString(event.recordedAt),
      actorId: validUserId(event.actorId) ? event.actorId : null,
      accessBefore: safeDateString(event.accessBefore),
      accessAfter: safeDateString(event.accessAfter),
      reason: typeof event.reason === 'string' ? event.reason.slice(0, 160) : ''
    };
  }
  return null;
}

function applyPurchase(ledgerInput, purchase, now = Date.now()) {
  const targetUserId = purchase && purchase.userId;
  const ledger = normalizeLedger(ledgerInput || emptyLedger(targetUserId), targetUserId);
  const paidAt = safeDateString(purchase && purchase.paidAt);
  if (
    !purchase ||
    !CHECKOUT_ID_PATTERN.test(purchase.id || '') ||
    !PLAN_BY_ID.has(purchase.plan) ||
    !paidAt
  ) {
    throw paymentError('INVALID_CHECKOUT_SESSION');
  }
  const processedThrough = parseTimestamp(ledger.checkoutSessionsProcessedThrough);
  if (
    ledger.events.some((event) => event.type === 'purchase' && event.id === purchase.id) ||
    (processedThrough > 0 && Date.parse(paidAt) <= processedThrough)
  ) {
    return { ledger, changed: false, duplicate: true };
  }

  const plan = PLAN_BY_ID.get(purchase.plan);
  const recordedAt = new Date(now).toISOString();
  const currentExpiresAt = parseTimestamp(ledger.access.expiresAt);
  const base = Math.max(now, currentExpiresAt);
  const expiresAt = new Date(base + plan.durationMs).toISOString();
  const assignedAt = currentExpiresAt > now && ledger.access.assignedAt
    ? ledger.access.assignedAt
    : recordedAt;
  const event = normalizeLedgerEvent({
    id: purchase.id,
    type: 'purchase',
    plan: plan.id,
    amount: purchase.amount,
    currency: purchase.currency || 'pln',
    paidAt,
    recordedAt,
    accessBefore: currentExpiresAt > 0 ? new Date(currentExpiresAt).toISOString() : null,
    accessAfter: expiresAt,
    paymentIntent: purchase.paymentIntent
  });
  if (!event) throw paymentError('INVALID_CHECKOUT_SESSION');
  const compacted = compactLedgerEvents(
    [...ledger.events, event],
    ledger.checkoutSessionsProcessedThrough
  );

  return {
    changed: true,
    duplicate: false,
    ledger: {
      ...ledger,
      version: ledger.version + 1,
      access: {
        role: plan.id,
        assignedAt,
        expiresAt
      },
      checkoutSessionsProcessedThrough: compacted.checkoutSessionsProcessedThrough,
      events: compacted.events,
      updatedAt: recordedAt
    }
  };
}

function applyRevocation(ledgerInput, input, now = Date.now()) {
  const targetUserId = input && input.userId;
  const ledger = normalizeLedger(ledgerInput || emptyLedger(targetUserId), targetUserId);
  const recordedAt = new Date(now).toISOString();
  const previousExpiry = safeDateString(ledger.access.expiresAt);
  const event = normalizeLedgerEvent({
    id: `revoke_${crypto.randomUUID()}`,
    type: 'revocation',
    recordedAt,
    actorId: input.actorId,
    accessBefore: previousExpiry,
    accessAfter: recordedAt,
    reason: input.reason || 'Dostęp odebrany przez administratora'
  });
  const compacted = compactLedgerEvents(
    [...ledger.events, event],
    ledger.checkoutSessionsProcessedThrough
  );
  return {
    changed: true,
    duplicate: false,
    ledger: {
      ...ledger,
      version: ledger.version + 1,
      access: {
        role: ledger.access.role,
        assignedAt: ledger.access.assignedAt,
        expiresAt: recordedAt
      },
      checkoutSessionsProcessedThrough: compacted.checkoutSessionsProcessedThrough,
      events: compacted.events,
      updatedAt: recordedAt
    }
  };
}

function compactLedgerEvents(events, checkoutSessionsProcessedThrough) {
  if (events.length <= MAX_LEDGER_EVENTS) {
    return {
      events,
      checkoutSessionsProcessedThrough: safeDateString(checkoutSessionsProcessedThrough)
    };
  }

  const removed = events.slice(0, events.length - MAX_LEDGER_EVENTS);
  let processedThrough = parseTimestamp(checkoutSessionsProcessedThrough);
  for (const event of removed) {
    if (event.type !== 'purchase') continue;
    const checkoutCreatedAt = parseTimestamp(event.paidAt) || parseTimestamp(event.recordedAt);
    processedThrough = Math.max(processedThrough, checkoutCreatedAt);
  }
  return {
    events: events.slice(-MAX_LEDGER_EVENTS),
    checkoutSessionsProcessedThrough: processedThrough > 0
      ? new Date(processedThrough).toISOString()
      : null
  };
}

async function readUserLedger(store, targetUserId) {
  if (!validUserId(targetUserId)) throw paymentError('INVALID_USER_ID');
  const entry = await store.getWithMetadata(ledgerKey(targetUserId), {
    type: 'text',
    consistency: 'strong'
  });
  if (!entry) return { ledger: emptyLedger(targetUserId), etag: null };
  let parsed;
  try {
    parsed = JSON.parse(entry.data);
  } catch {
    throw paymentError('PAYMENT_LEDGER_INVALID');
  }
  if (!validEtag(entry.etag)) throw paymentError('PAYMENT_LEDGER_INVALID');
  return { ledger: normalizeLedger(parsed, targetUserId), etag: entry.etag };
}

async function mutateUserLedger(store, targetUserId, mutator) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await readUserLedger(store, targetUserId);
    const mutation = mutator(current.ledger);
    if (!mutation || !mutation.changed) return { ...mutation, etag: current.etag };

    try {
      const options = current.etag
        ? { onlyIfMatch: current.etag }
        : { onlyIfNew: true };
      const result = await store.set(
        ledgerKey(targetUserId),
        JSON.stringify(mutation.ledger),
        {
          ...options,
          metadata: {
            version: mutation.ledger.version,
            updatedAt: mutation.ledger.updatedAt
          }
        }
      );
      if (result && result.modified === true) return mutation;
    } catch (error) {
      if (!isBlobConflict(error)) throw error;
    }
  }
  throw paymentError('PAYMENT_LEDGER_CONFLICT', 409);
}

async function deleteUserLedger(store, targetUserId) {
  if (!validUserId(targetUserId)) throw paymentError('INVALID_USER_ID');
  if (!store || typeof store.delete !== 'function') {
    throw paymentError('PAYMENT_STORAGE_UNAVAILABLE', 503);
  }
  await store.delete(ledgerKey(targetUserId));
}

function validateCheckoutSession(session) {
  if (!plainObject(session) || !CHECKOUT_ID_PATTERN.test(session.id || '')) {
    return { ok: false, code: 'INVALID_CHECKOUT_SESSION' };
  }
  const metadata = plainObject(session.metadata) ? session.metadata : {};
  const targetUserId = typeof metadata.userId === 'string' ? metadata.userId : '';
  const plan = typeof metadata.plan === 'string' ? metadata.plan : '';
  const currency = String(session.currency || '').toLowerCase();
  const amount = Number(session.amount_total);
  const metadataAmount = Number(metadata.amount);
  const planDuration = PLAN_BY_ID.has(plan) ? PLAN_BY_ID.get(plan).durationDays : 0;
  if (
    session.mode !== 'payment' ||
    session.payment_status !== 'paid' ||
    !validUserId(targetUserId) ||
    session.client_reference_id !== targetUserId ||
    !PLAN_BY_ID.has(plan) ||
    metadata.durationDays !== String(planDuration) ||
    !SUPPORTED_CURRENCY_SET.has(currency) ||
    !Number.isSafeInteger(amount) ||
    amount < 100 ||
    !Number.isSafeInteger(metadataAmount) ||
    metadataAmount !== amount
  ) {
    return { ok: false, code: session.payment_status === 'paid' ? 'INVALID_CHECKOUT_SESSION' : 'PAYMENT_NOT_PAID' };
  }
  const paymentIntent = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent && session.payment_intent.id;
  return {
    ok: true,
    value: {
      id: session.id,
      userId: targetUserId,
      plan,
      amount,
      currency,
      paymentIntent: PAYMENT_INTENT_PATTERN.test(paymentIntent || '') ? paymentIntent : null,
      paidAt: Number.isFinite(Number(session.created))
        ? new Date(Number(session.created) * 1000).toISOString()
        : new Date().toISOString()
    }
  };
}

async function fulfillCheckoutSession({ session, store, identity }) {
  const validation = validateCheckoutSession(session);
  if (!validation.ok) throw paymentError(validation.code, validation.code === 'PAYMENT_NOT_PAID' ? 409 : 400);
  const purchase = validation.value;
  const target = await readIdentityTarget(identity, purchase.userId);
  const identityAccess = timedAccessFromIdentity(target);
  const mutation = await mutateUserLedger(
    store,
    purchase.userId,
    (ledger) => applyPurchase(mergeLedgerAccess(ledger, identityAccess), purchase)
  );
  await syncIdentityFromLedger({ store, identity, targetUserId: purchase.userId });
  const latest = await readUserLedger(store, purchase.userId);
  return {
    duplicate: Boolean(mutation.duplicate),
    userId: purchase.userId,
    plan: purchase.plan,
    access: publicAccess(latest.ledger)
  };
}

function mergeLedgerAccess(ledgerInput, access) {
  const ledger = normalizeLedger(ledgerInput, ledgerInput.userId);
  const storedExpiry = parseTimestamp(ledger.access.expiresAt);
  const externalExpiry = parseTimestamp(access && access.expiresAt);
  if (!externalExpiry || externalExpiry <= storedExpiry) return ledger;
  return {
    ...ledger,
    access: {
      role: PLAN_BY_ID.has(access.role) ? access.role : ledger.access.role,
      assignedAt: safeDateString(access.assignedAt) || ledger.access.assignedAt,
      expiresAt: access.expiresAt
    }
  };
}

function timedAccessFromIdentity(target) {
  const appMetadata = plainObject(target && target.app_metadata) ? target.app_metadata : {};
  const timed = plainObject(appMetadata.timed_access) ? appMetadata.timed_access : {};
  const role = typeof timed.role === 'string' ? timed.role : '';
  const expiresAt = safeDateString(timed.expires_at);
  const assignedAt = safeDateString(timed.assigned_at);
  if (!rolesFrom(target).includes(role) || !expiresAt || Date.parse(expiresAt) <= Date.now()) {
    return { role: '', assignedAt: null, expiresAt: null };
  }
  return {
    // Hour/day are valid manual grants but are not purchasable plans. The
    // expiry is still used as the stacking baseline; the new paid plan becomes
    // the role stored in the resulting ledger.
    role: PLAN_BY_ID.has(role) ? role : '',
    assignedAt,
    expiresAt
  };
}

async function syncIdentityFromLedger({ store, identity, targetUserId }) {
  if (!identity || !identity.url || !identity.token) throw paymentError('IDENTITY_ADMIN_UNAVAILABLE', 503);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const snapshot = await readUserLedger(store, targetUserId);
    const target = await readIdentityTarget(identity, targetUserId);

    const now = Date.now();
    const expiresAtMs = parseTimestamp(snapshot.ledger.access.expiresAt);
    const active = expiresAtMs > now && PLAN_BY_ID.has(snapshot.ledger.access.role);
    const currentAppMetadata = plainObject(target.app_metadata) ? target.app_metadata : {};
    const currentTimedAccess = plainObject(currentAppMetadata.timed_access)
      ? currentAppMetadata.timed_access
      : null;
    const hasManualPermanentAccess = rolesFrom(target).includes('active') &&
      !(currentTimedAccess && currentTimedAccess.injected_active === true);
    const unrelatedRoles = rolesFrom(target).filter((role) => !COURSE_GRANT_ROLES.has(role));
    const nextRoles = hasManualPermanentAccess
      ? uniqueStrings([...unrelatedRoles, 'active'])
      : active
        ? uniqueStrings([...unrelatedRoles, snapshot.ledger.access.role])
      : uniqueStrings(unrelatedRoles);
    const nextAppMetadata = {
      ...currentAppMetadata,
      roles: nextRoles,
      status: '',
      timed_access: hasManualPermanentAccess
        ? null
        : active
        ? {
            role: snapshot.ledger.access.role,
            assigned_at: snapshot.ledger.access.assignedAt,
            expires_at: snapshot.ledger.access.expiresAt,
            active: true,
            injected_active: false,
            source: 'stripe',
            ledger_version: snapshot.ledger.version
          }
        : null,
      payment_access: {
        ledger_version: snapshot.ledger.version,
        expires_at: snapshot.ledger.access.expiresAt,
        updated_at: snapshot.ledger.updatedAt
      }
    };

    const updateResponse = await identityFetch(
      identity.url,
      `/admin/users/${encodeURIComponent(targetUserId)}`,
      identity.token,
      {
        method: 'PUT',
        body: { app_metadata: nextAppMetadata }
      }
    );
    if (!updateResponse.ok) throw paymentError('IDENTITY_UPDATE_FAILED', 502);

    const latest = await readUserLedger(store, targetUserId);
    if (latest.ledger.version === snapshot.ledger.version) return latest.ledger;
  }
  throw paymentError('IDENTITY_SYNC_CONFLICT', 409);
}

async function readIdentityTarget(identity, targetUserId) {
  if (!identity || !identity.url || !identity.token) {
    throw paymentError('IDENTITY_ADMIN_UNAVAILABLE', 503);
  }
  const response = await identityFetch(
    identity.url,
    `/admin/users/${encodeURIComponent(targetUserId)}`,
    identity.token
  );
  if (response.status === 404) throw paymentError('USER_NOT_FOUND', 404);
  if (!response.ok) throw paymentError('IDENTITY_REQUEST_FAILED', 502);
  const target = await readJson(response);
  if (!target || userId(target) !== targetUserId) throw paymentError('IDENTITY_RESPONSE_INVALID', 502);
  return target;
}

function publicAccess(ledger, now = Date.now()) {
  const expiresAt = safeDateString(ledger && ledger.access && ledger.access.expiresAt);
  const expiresAtMs = parseTimestamp(expiresAt);
  return {
    role: ledger && ledger.access ? ledger.access.role : '',
    assignedAt: safeDateString(ledger && ledger.access && ledger.access.assignedAt),
    expiresAt,
    active: expiresAtMs > now,
    remainingMs: Math.max(0, expiresAtMs - now)
  };
}

function publicLedger(ledger) {
  return {
    version: ledger.version,
    access: publicAccess(ledger),
    history: [...ledger.events].reverse()
  };
}

function getPaymentStore() {
  if (injectedStoreFactory) return injectedStoreFactory();
  const config = paymentStoreConfig();
  if (!config) throw paymentError('PAYMENT_STORAGE_UNAVAILABLE', 503);
  return getStore({
    name: STORE_NAME,
    siteID: config.siteId,
    token: config.token,
    consistency: 'strong'
  });
}

function paymentStoreConfig() {
  const token = typeof process.env.NETLIFY_API_TOKEN === 'string'
    ? process.env.NETLIFY_API_TOKEN.trim()
    : '';
  const siteId = typeof process.env.SITE_ID === 'string' ? process.env.SITE_ID.trim() : '';
  if (
    token.length < 16 ||
    token.length > 4_096 ||
    /[\s\u0000-\u001f\u007f]/.test(token) ||
    !OPAQUE_ID_PATTERN.test(siteId)
  ) {
    return null;
  }
  return { token, siteId };
}

function stripeEnvironment() {
  const secretKey = typeof process.env.STRIPE_SECRET_KEY === 'string'
    ? process.env.STRIPE_SECRET_KEY.trim()
    : '';
  const webhookSecret = typeof process.env.STRIPE_WEBHOOK_SECRET === 'string'
    ? process.env.STRIPE_WEBHOOK_SECRET.trim()
    : '';
  const validKey = /^sk_(?:test|live)_[A-Za-z0-9_]{16,}$/.test(secretKey);
  const validWebhook = /^whsec_[A-Za-z0-9_]{16,}$/.test(webhookSecret);
  return {
    configured: validKey && validWebhook && Boolean(paymentStoreConfig()),
    secretKey: validKey ? secretKey : '',
    webhookSecret: validWebhook ? webhookSecret : '',
    testMode: secretKey.startsWith('sk_test_')
  };
}

function normalizeIdentityContext(context = {}) {
  const clientContext = context.clientContext || {};
  const source = clientContext.identity;
  if (!plainObject(source) || typeof source.token !== 'string' || !source.token) return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) return null;
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return { url: url.toString().replace(/\/$/, ''), token: source.token };
  } catch {
    return null;
  }
}

async function identityFetch(baseUrl, path, token, options = {}) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
  url.search = '';
  url.hash = '';
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`
  };
  const request = {
    method: options.method || 'GET',
    headers
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }
  return fetchWithTimeout(url, request, IDENTITY_TIMEOUT_MS);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function paymentError(code, status = 500) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function ledgerKey(targetUserId) {
  return `users/${targetUserId}.json`;
}

function validUserId(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validEtag(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeDateString(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value)));
}

function isBlobConflict(error) {
  const status = Number(error && (error.status || error.statusCode));
  return status === 409 || status === 412 || /conflict|condition|precondition/i.test(String(error && error.message || ''));
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

module.exports = {
  CONFIG_KEY,
  DAY_MS,
  HOUR_MS,
  MAX_LEDGER_EVENTS,
  PLAN_BY_ID,
  PLANS,
  SUPPORTED_CURRENCIES,
  STORE_NAME,
  applyPurchase,
  applyRevocation,
  defaultPriceConfig,
  deleteUserLedger,
  emptyLedger,
  fulfillCheckoutSession,
  getPaymentStore,
  mutateUserLedger,
  normalizeIdentityContext,
  mergeLedgerAccess,
  normalizePriceConfig,
  paymentError,
  paymentStoreConfig,
  publicAccess,
  publicLedger,
  publicPriceConfig,
  readPriceConfig,
  readUserLedger,
  stripeEnvironment,
  syncIdentityFromLedger,
  timedAccessFromIdentity,
  validateCheckoutSession,
  validUserId,
  writePriceConfig,
  _test: {
    setStoreFactory(factory) {
      injectedStoreFactory = typeof factory === 'function' ? factory : null;
    }
  }
};
