'use strict';

const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');
const {
  applyRevocation,
  getPaymentStore,
  mutateUserLedger,
  normalizeIdentityContext,
  publicLedger,
  readUserLedger,
  syncIdentityFromLedger,
  validUserId
} = require('../payment-common.js');

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        Allow: 'GET, POST, OPTIONS',
        'Cache-Control': 'no-store',
        Vary: 'Origin'
      },
      body: ''
    };
  }
  if (!['GET', 'POST'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, OPTIONS' });
  }
  if (method === 'POST') {
    const guard = mutationGuard(event, { maxBodyBytes: 4_096 });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);

  try {
    const store = getPaymentStore();
    if (method === 'GET') {
      const targetUserId = String(event.queryStringParameters && event.queryStringParameters.userId || '');
      if (!validUserId(targetUserId)) return json({ error: 'INVALID_USER_ID' }, 400);
      const { ledger } = await readUserLedger(store, targetUserId);
      return json(publicLedger(ledger));
    }

    const parsed = parseJsonBody(event);
    if (!parsed.ok) return responseForFailure(parsed);
    const validation = validateAction(parsed.value);
    if (!validation.ok) return json({ error: validation.code }, 400);
    const targetUserId = validation.value.userId;
    await mutateUserLedger(
      store,
      targetUserId,
      (ledger) => applyRevocation(ledger, {
        userId: targetUserId,
        actorId: auth.userId,
        reason: 'Dostęp płatny odebrany w panelu administratora'
      })
    );
    const identity = normalizeIdentityContext({
      clientContext: context.clientContext || event.clientContext || {}
    });
    if (!identity) return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
    await syncIdentityFromLedger({ store, identity, targetUserId });
    const { ledger } = await readUserLedger(store, targetUserId);
    return json({ revoked: true, ...publicLedger(ledger) });
  } catch (error) {
    console.error('payment-admin failed', safeErrorName(error));
    return json({ error: error.code || 'PAYMENT_STORAGE_UNAVAILABLE' }, error.status || 503);
  }
};

function validateAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY' };
  }
  if (Object.keys(body).some((key) => !['action', 'userId'].includes(key))) {
    return { ok: false, code: 'UNEXPECTED_FIELDS' };
  }
  if (body.action !== 'revoke' || !validUserId(body.userId)) {
    return { ok: false, code: body.action !== 'revoke' ? 'INVALID_PAYMENT_ACTION' : 'INVALID_USER_ID' };
  }
  return { ok: true, value: { action: 'revoke', userId: body.userId } };
}

function safeErrorName(error) {
  return error && error.name ? String(error.name) : 'Error';
}

exports._test = { validateAction };
