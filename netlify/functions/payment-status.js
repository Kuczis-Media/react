'use strict';

const Stripe = require('stripe');
const {
  authenticateCanonicalUser,
  json,
  responseForFailure
} = require('../admin-common.js');
const {
  fulfillCheckoutSession,
  getPaymentStore,
  normalizeIdentityContext,
  stripeEnvironment
} = require('../payment-common.js');

let injectedStripeFactory = null;

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method !== 'GET') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
  }
  const auth = await authenticateCanonicalUser(event, context);
  if (!auth.ok) return responseForFailure(auth);

  const sessionId = String(event.queryStringParameters && event.queryStringParameters.session_id || '');
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9_]{8,240}$/.test(sessionId)) {
    return json({ error: 'INVALID_CHECKOUT_SESSION' }, 400);
  }
  const environment = stripeEnvironment();
  if (!environment.configured) return json({ error: 'STRIPE_NOT_CONFIGURED' }, 503);
  const identity = normalizeIdentityContext({
    clientContext: context.clientContext || event.clientContext || {}
  });
  if (!identity) return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);

  try {
    const stripe = createStripe(environment.secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.client_reference_id !== auth.userId) {
      return json({ error: 'CHECKOUT_SESSION_FORBIDDEN' }, 403);
    }
    if (session.payment_status !== 'paid') {
      return json({ status: 'pending', paymentStatus: session.payment_status || 'unpaid' }, 202);
    }

    const result = await fulfillCheckoutSession({
      session,
      store: getPaymentStore(),
      identity
    });
    return json({
      status: 'complete',
      duplicate: result.duplicate,
      plan: result.plan,
      access: result.access
    });
  } catch (error) {
    console.error('payment-status failed', safeStripeError(error));
    const status = Number(error && (error.status || error.statusCode));
    return json(
      { error: error.code || 'PAYMENT_STATUS_UNAVAILABLE' },
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503
    );
  }
};

function createStripe(secretKey) {
  if (injectedStripeFactory) return injectedStripeFactory(secretKey);
  return new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 10_000,
    appInfo: { name: 'ChemDisk', version: '1.0.0' }
  });
}

function safeStripeError(error) {
  if (!error) return 'Error';
  return String(error.type || error.code || error.name || 'Error').slice(0, 120);
}

exports._test = {
  setStripeFactory(factory) {
    injectedStripeFactory = typeof factory === 'function' ? factory : null;
  }
};
