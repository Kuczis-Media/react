'use strict';

// Shared, server-only authorization helpers for administrative functions.
// A JWT present in clientContext has been verified by Netlify, but its role
// claims can be stale. Every protected request therefore resolves the caller
// again through Identity's canonical /user endpoint before making a decision.

const IDENTITY_TIMEOUT_MS = 8_000;
const COURSE_ROLES = Object.freeze([
  'admin',
  'active',
  'hour',
  'day',
  'week',
  'month',
  'halfyear',
  'year'
]);
const TIMED_ROLES = new Set(['hour', 'day', 'week', 'month', 'halfyear', 'year']);

async function authenticateCanonicalUser(event = {}, context = {}) {
  const headers = event.headers || {};
  const clientToken = bearerToken(headers);
  const clientContext = context.clientContext || event.clientContext || {};
  const tokenUser = clientContext.user;
  const identityUrl = normalizeIdentityUrl(clientContext.identity && clientContext.identity.url);

  if (!clientToken || !tokenUser) {
    return failure('AUTH_REQUIRED', 401);
  }
  if (!identityUrl) {
    return failure('IDENTITY_UNAVAILABLE', 503);
  }

  let response;
  try {
    response = await fetchWithTimeout(
      appendIdentityPath(identityUrl, '/user'),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${clientToken}`
        }
      },
      IDENTITY_TIMEOUT_MS
    );
  } catch (error) {
    console.error('Canonical Identity check failed', safeErrorName(error));
    return failure('SESSION_CHECK_UNAVAILABLE', 503);
  }

  if (response.status === 401 || response.status === 403) {
    return failure('AUTH_EXPIRED', 401);
  }
  if (!response.ok) {
    return failure('SESSION_CHECK_UNAVAILABLE', 503);
  }

  const currentUser = await readJson(response);
  const expectedId = userId(tokenUser);
  if (!currentUser || !expectedId || userId(currentUser) !== expectedId) {
    return failure('AUTH_EXPIRED', 401);
  }

  // identity-login rotates app_metadata.session_id on every successful
  // login. A JWT issued to the previous device can still be cryptographically
  // valid, so comparing only the user ID would leave administrative Functions
  // usable until that token expired. Once a canonical SID exists, require the
  // caller's verified JWT to carry exactly the same SID.
  const canonicalSessionId = sessionIdFrom(currentUser);
  if (canonicalSessionId && sessionIdFrom(tokenUser) !== canonicalSessionId) {
    return failure('SESSION_REPLACED', 401);
  }

  return {
    ok: true,
    user: currentUser,
    userId: expectedId,
    clientToken,
    identityUrl,
    roles: rolesFrom(currentUser)
  };
}

async function requireAdmin(event, context) {
  const auth = await authenticateCanonicalUser(event, context);
  if (!auth.ok) return auth;
  if (!auth.roles.includes('admin')) return failure('ADMIN_REQUIRED', 403);
  return auth;
}

async function requireCourseAccess(event, context, now = Date.now()) {
  const auth = await authenticateCanonicalUser(event, context);
  if (!auth.ok) return auth;
  if (auth.roles.includes('admin') || auth.roles.includes('active')) return auth;

  const timedRole = auth.roles.find((role) => TIMED_ROLES.has(role));
  if (!timedRole) return failure('ACCESS_REQUIRED', 403);

  const appMetadata = plainObject(auth.user.app_metadata) ? auth.user.app_metadata : {};
  const timedAccess = plainObject(appMetadata.timed_access) ? appMetadata.timed_access : {};
  const expiresAt = Date.parse(timedAccess.expires_at || '');
  if (
    timedAccess.role !== timedRole ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    timedAccess.active === false
  ) {
    return failure('ACCESS_EXPIRED', 403);
  }

  return auth;
}

function mutationGuard(event, options = {}) {
  const maxBodyBytes = Number.isSafeInteger(options.maxBodyBytes)
    ? options.maxBodyBytes
    : 16_384;
  if (!isJsonRequest(event.headers || {})) return failure('JSON_REQUIRED', 415);
  if (!isSameOriginRequest(event.headers || {})) return failure('SAME_ORIGIN_REQUIRED', 403);
  if (Buffer.byteLength(String(event.body || ''), 'utf8') > maxBodyBytes) {
    return failure('REQUEST_TOO_LARGE', 413);
  }
  return { ok: true };
}

function parseJsonBody(event) {
  try {
    const value = JSON.parse(event.body || '{}');
    return plainObject(value)
      ? { ok: true, value }
      : failure('INVALID_BODY', 400);
  } catch {
    return failure('INVALID_JSON', 400);
  }
}

function responseForFailure(result) {
  return json({ error: result.code }, result.status);
}

function failure(code, status) {
  return { ok: false, code, status };
}

function rolesFrom(user) {
  const appMetadata = plainObject(user && user.app_metadata) ? user.app_metadata : {};
  return uniqueStrings(appMetadata.roles);
}

function bearerToken(headers) {
  const raw = headerValue(headers, 'authorization');
  const match = /^Bearer\s+([^\s]+)$/i.exec(raw);
  return match ? match[1] : '';
}

function normalizeIdentityUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) return '';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function appendIdentityPath(baseUrl, path) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
  url.search = '';
  url.hash = '';
  return url;
}

function isSameOriginRequest(headers) {
  const rawOrigin = headerValue(headers, 'origin');
  if (!rawOrigin || rawOrigin === 'null') return false;

  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return false;
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) return false;
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLocalHost(origin.hostname))) return false;

  const allowedOrigins = new Set();
  for (const candidate of [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]) {
    if (!candidate) continue;
    try { allowedOrigins.add(new URL(candidate).origin); } catch {}
  }

  const forwardedHost = firstHeaderPart(headerValue(headers, 'x-forwarded-host'));
  const host = forwardedHost || firstHeaderPart(headerValue(headers, 'host'));
  const forwardedProtocol = firstHeaderPart(headerValue(headers, 'x-forwarded-proto'));
  if (host) {
    const hostname = host.split(':')[0];
    const protocol = forwardedProtocol || (isLocalHost(hostname) ? 'http' : 'https');
    if (protocol === 'https' || (protocol === 'http' && isLocalHost(hostname))) {
      allowedOrigins.add(`${protocol}://${host}`);
    }
  }

  return allowedOrigins.has(origin.origin);
}

function isJsonRequest(headers) {
  return /^application\/json(?:\s*;|$)/i.test(headerValue(headers, 'content-type'));
}

function headerValue(headers, wanted) {
  const key = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === wanted);
  const value = key ? headers[key] : '';
  return typeof value === 'string' ? value.trim() : '';
}

function firstHeaderPart(value) {
  return String(value || '').split(',')[0].trim();
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function userId(user) {
  const value = user && (user.id || user.sub);
  return typeof value === 'string' ? value : '';
}

function sessionIdFrom(user) {
  const appMetadata = plainObject(user && user.app_metadata) ? user.app_metadata : {};
  const value = appMetadata.session_id;
  return typeof value === 'string' ? value : '';
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeErrorName(error) {
  if (error && error.name === 'AbortError') return 'AbortError';
  return error && error.name ? String(error.name) : 'Error';
}

function json(body, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

module.exports = {
  COURSE_ROLES,
  TIMED_ROLES,
  authenticateCanonicalUser,
  bearerToken,
  headerValue,
  isSameOriginRequest,
  json,
  mutationGuard,
  parseJsonBody,
  plainObject,
  readJson,
  requireAdmin,
  requireCourseAccess,
  responseForFailure,
  rolesFrom,
  sessionIdFrom,
  userId
};
