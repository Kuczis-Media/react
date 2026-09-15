'use strict';

const Stripe = require('stripe');
const { headerValue, json } = require('../admin-common.js');
const {
  fulfillCheckoutSession,
  getPaymentStore,
  normalizeIdentityContext,
  stripeEnvironment
} = require('../payment-common.js');

let injectedStripeFactory = null;

exports.handler = async (event = {}, context = {}) => {
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }

  const environment = stripeEnvironment();
  if (!environment.configured) return json({ error: 'STRIPE_NOT_CONFIGURED' }, 503);
  const signature = headerValue(event.headers || {}, 'stripe-signature');
  if (!signature) return json({ error: 'STRIPE_SIGNATURE_REQUIRED' }, 400);

  const stripe = createStripe(environment.secretKey);
  let stripeEvent;
  try {
    const payload = event.isBase64Encoded
      ? Buffer.from(String(event.body || ''), 'base64')
      : String(event.body || '');
    stripeEvent = stripe.webhooks.constructEvent(payload, signature, environment.webhookSecret);
  } catch (error) {
    console.warn('Stripe webhook signature rejected', safeStripeError(error));
    return json({ error: 'STRIPE_SIGNATURE_INVALID' }, 400);
  }

  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(stripeEvent.type)) {
    return json({ received: true, ignored: true });
  }

  const session = stripeEvent.data && stripeEvent.data.object;
  if (!session || session.payment_status !== 'paid') {
    return json({ received: true, pending: true });
  }

  const identity = normalizeIdentityContext({
    clientContext: context.clientContext || event.clientContext || {}
  });
  if (!identity) return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);

  try {
    const result = await fulfillCheckoutSession({
      session,
      store: getPaymentStore(),
      identity
    });
    return json({ received: true, fulfilled: true, duplicate: result.duplicate });
  } catch (error) {
    console.error('stripe-webhook fulfillment failed', safeStripeError(error));
    return json({ error: error.code || 'PAYMENT_FULFILLMENT_FAILED' }, error.status || 503);
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
