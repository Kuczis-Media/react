'use strict';

const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  requireCourseAccess,
  responseForFailure
} = require('../admin-common.js');

const STORE_NAME = 'chemdisk-dashboard';
const STORE_KEY = 'dashboard.md';
const FALLBACK_URL = '/members/dashboard.md';
const MAX_MARKDOWN_BYTES = 256 * 1024;
const MAX_BODY_BYTES = MAX_MARKDOWN_BYTES + 16 * 1024;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REQUIRED_HELP_SECTION = [
  '## Pomoc i konto',
  '',
  'Zarządzaj dostępem albo skontaktuj się z prowadzącym.',
  '',
  '> Imię i nazwisko zmienisz po kliknięciu swojej karty konta w menu.',
  '',
  '- [Status dostępu](/time) — Sprawdź rolę i czas pozostały do końca dostępu.',
  '- [Napisz do nas](/members/module/contact/?internal=Wiadomo%C5%9B%C4%87%20z%20panelu%20kursanta) — Wyślij wiadomość bez opuszczania platformy.'
].join('\n');
let injectedStoreFactory = null;

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        Allow: 'GET, PUT, DELETE, OPTIONS',
        'Cache-Control': 'no-store',
        Vary: 'Origin'
      },
      body: ''
    };
  }
  if (!['GET', 'PUT', 'DELETE'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, {
      Allow: 'GET, PUT, DELETE, OPTIONS'
    });
  }

  if (method !== 'GET') {
    const guard = mutationGuard(event, { maxBodyBytes: MAX_BODY_BYTES });
    if (!guard.ok) return responseForFailure(guard);
  }

  const auth = method === 'GET'
    ? await requireCourseAccess(event, context)
    : await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);

  let store;
  try {
    store = getDashboardStore();
  } catch (error) {
    console.error('Dashboard Blob store initialization failed', safeErrorName(error));
    return storageUnavailable();
  }

  try {
    if (method === 'GET') return await readOverride(store);
    if (method === 'PUT') return await writeOverride(event, store, auth);
    return await deleteOverride(event, store, auth);
  } catch (error) {
    if (isBlobConflict(error)) return dashboardConflict();
    console.error('admin-dashboard failed', safeErrorName(error));
    return storageUnavailable();
  }
};

async function readOverride(store) {
  const entry = await store.getWithMetadata(STORE_KEY, {
    type: 'text',
    consistency: 'strong'
  });
  if (entry == null || isTombstone(entry)) return noOverride();
  if (
    typeof entry.data !== 'string' ||
    !validEtag(entry.etag) ||
    Buffer.byteLength(entry.data, 'utf8') > MAX_MARKDOWN_BYTES
  ) {
    return json({ error: 'DASHBOARD_STORAGE_INVALID', fallbackUrl: FALLBACK_URL }, 502);
  }

  const content = ensureRequiredHelpSection(entry.data);
  if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) {
    return json({ error: 'DASHBOARD_STORAGE_INVALID', fallbackUrl: FALLBACK_URL }, 502);
  }

  return json({
    content,
    source: 'blob',
    etag: entry.etag,
    updatedAt: safeDateString(entry.metadata && entry.metadata.updatedAt)
  });
}

async function writeOverride(event, store, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const validation = validateWrite(parsed.value);
  if (!validation.ok) return json({ error: validation.code }, validation.status || 400);
  const input = validation.value;

  const current = await store.getMetadata(STORE_KEY, { consistency: 'strong' });
  if (!etagMatchesExpected(current, input.expectedEtag)) return dashboardConflict(current);

  const updatedAt = new Date().toISOString();
  const options = {
    metadata: {
      state: 'active',
      updatedAt,
      updatedBy: auth.userId
    },
    ...(input.expectedEtag == null && current == null
      ? { onlyIfNew: true }
      : { onlyIfMatch: input.expectedEtag == null ? current.etag : input.expectedEtag })
  };
  const writeResult = await store.set(STORE_KEY, input.content, options);
  if (!writeResult || writeResult.modified !== true) {
    const latest = await store.getMetadata(STORE_KEY, { consistency: 'strong' });
    return dashboardConflict(latest);
  }

  const saved = await store.getWithMetadata(STORE_KEY, {
    type: 'text',
    consistency: 'strong'
  });
  if (!saved || typeof saved.data !== 'string' || !validEtag(saved.etag)) {
    return json({ error: 'DASHBOARD_STORAGE_INVALID', fallbackUrl: FALLBACK_URL }, 502);
  }

  console.info('Dashboard Markdown override saved by administrator', {
    actorId: auth.userId,
    bytes: Buffer.byteLength(input.content, 'utf8'),
    etag: saved.etag
  });
  return json({
    content: saved.data,
    source: 'blob',
    etag: saved.etag,
    updatedAt: safeDateString(saved.metadata && saved.metadata.updatedAt) || updatedAt
  });
}

async function deleteOverride(event, store, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const validation = validateDelete(parsed.value);
  if (!validation.ok) return json({ error: validation.code }, validation.status || 400);
  const expectedEtag = validation.value.expectedEtag;

  const current = await store.getMetadata(STORE_KEY, { consistency: 'strong' });
  if (!etagMatchesExpected(current, expectedEtag)) return dashboardConflict(current);
  const alreadyAbsent = current == null || isTombstone(current);
  if (!alreadyAbsent) {
    // Netlify Blobs has no conditional delete operation. Replacing the value
    // with a versioned tombstone gives the restore action the same atomic
    // only-if-match guarantee as an edit and avoids deleting a concurrent PUT.
    const writeResult = await store.set(STORE_KEY, '', {
      onlyIfMatch: expectedEtag,
      metadata: {
        state: 'deleted',
        updatedAt: new Date().toISOString(),
        updatedBy: auth.userId
      }
    });
    if (!writeResult || writeResult.modified !== true) {
      const latest = await store.getMetadata(STORE_KEY, { consistency: 'strong' });
      return dashboardConflict(latest);
    }
  }

  console.info('Dashboard Markdown override removed by administrator', {
    actorId: auth.userId,
    alreadyAbsent
  });
  return json({
    deleted: true,
    alreadyAbsent,
    source: 'static',
    fallbackUrl: FALLBACK_URL
  });
}

function getDashboardStore() {
  if (injectedStoreFactory) return injectedStoreFactory();
  const config = dashboardStoreConfig();
  if (!config) throw new Error('Dashboard Blob store is not configured');

  // Lambda compatibility exposes only the cached Blobs endpoint, which cannot
  // serve strong reads. Explicit server-only site credentials make the SDK use
  // Netlify's signed API and preserve reliable etag/read-after-write semantics.
  const { getStore } = require('@netlify/blobs');
  return getStore({
    name: STORE_NAME,
    siteID: config.siteId,
    token: config.token,
    consistency: 'strong'
  });
}

function dashboardStoreConfig() {
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

function validateWrite(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY' };
  }
  if (Object.keys(body).some((key) => !['content', 'expectedEtag'].includes(key))) {
    return { ok: false, code: 'UNEXPECTED_FIELDS' };
  }
  if (typeof body.content !== 'string') return { ok: false, code: 'INVALID_MARKDOWN' };
  const content = ensureRequiredHelpSection(body.content.replace(/\r\n?/g, '\n'));
  const size = Buffer.byteLength(content, 'utf8');
  if (!content.trim() || size > MAX_MARKDOWN_BYTES || /[\u0000\u000b\u000c]/.test(content)) {
    return { ok: false, code: size > MAX_MARKDOWN_BYTES ? 'MARKDOWN_TOO_LARGE' : 'INVALID_MARKDOWN' };
  }

  const expected = validateExpectedEtag(body);
  if (!expected.ok) return expected;
  return { ok: true, value: { content, expectedEtag: expected.value } };
}

function validateDelete(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY' };
  }
  if (Object.keys(body).some((key) => key !== 'expectedEtag')) {
    return { ok: false, code: 'UNEXPECTED_FIELDS' };
  }
  const expected = validateExpectedEtag(body);
  return expected.ok
    ? { ok: true, value: { expectedEtag: expected.value } }
    : expected;
}

function ensureRequiredHelpSection(content) {
  const text = String(content || '').trim();
  if (!text) return text;
  const visibleText = text.replace(/<!--[\s\S]*?-->/g, '');
  return /^##[ \t]+Pomoc i konto[ \t]*$/im.test(visibleText)
    ? text
    : `${text}\n\n${REQUIRED_HELP_SECTION}`;
}

function validateExpectedEtag(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedEtag')) {
    return { ok: false, code: 'EXPECTED_ETAG_REQUIRED' };
  }
  if (body.expectedEtag === null) return { ok: true, value: null };
  if (!validEtag(body.expectedEtag)) return { ok: false, code: 'INVALID_ETAG' };
  return { ok: true, value: body.expectedEtag };
}

function validEtag(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function etagMatchesExpected(current, expected) {
  if (expected == null) return current == null || isTombstone(current);
  return Boolean(current && !isTombstone(current) && current.etag === expected);
}

function isTombstone(entry) {
  return Boolean(
    entry &&
    entry.metadata &&
    entry.metadata.state === 'deleted'
  );
}

function dashboardConflict(current) {
  return json({
    error: 'DASHBOARD_CONFLICT',
    currentEtag: current && !isTombstone(current) && validEtag(current.etag) ? current.etag : null
  }, 409);
}

function noOverride() {
  return json({
    source: 'static',
    fallbackUrl: FALLBACK_URL
  });
}

function storageUnavailable() {
  return json({
    error: 'DASHBOARD_STORAGE_UNAVAILABLE',
    source: 'static',
    fallbackUrl: FALLBACK_URL
  }, 503);
}

function safeDateString(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function isBlobConflict(error) {
  const status = Number(error && (error.status || error.statusCode));
  const name = String(error && error.name || '');
  const message = String(error && error.message || '');
  return status === 409 || status === 412 || /conflict|condition|precondition/i.test(`${name} ${message}`);
}

function safeErrorName(error) {
  return error && error.name ? String(error.name) : 'Error';
}

exports._test = {
  FALLBACK_URL,
  MAX_MARKDOWN_BYTES,
  dashboardStoreConfig,
  ensureRequiredHelpSection,
  etagMatchesExpected,
  isTombstone,
  setStoreFactory(factory) {
    injectedStoreFactory = typeof factory === 'function' ? factory : null;
  },
  validateDelete,
  validateWrite
};
