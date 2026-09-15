'use strict';

const crypto = require('crypto');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');

const API_BASE = 'https://api.netlify.com/api/v1';
const API_TIMEOUT_MS = 10_000;
const DELETE_CAPABILITY_TTL_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 16_384;
const MAX_DATA_CHARACTERS = 40_000;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        Allow: 'GET, DELETE, OPTIONS',
        'Cache-Control': 'no-store',
        Vary: 'Origin'
      },
      body: ''
    };
  }
  if (method !== 'GET' && method !== 'DELETE') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, DELETE, OPTIONS' });
  }

  if (method === 'DELETE') {
    const guard = mutationGuard(event, { maxBodyBytes: MAX_BODY_BYTES });
    if (!guard.ok) return responseForFailure(guard);
  }

  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);

  const config = formsConfig();
  if (!config) return json({ error: 'NETLIFY_FORMS_NOT_CONFIGURED' }, 503);

  try {
    return method === 'GET'
      ? await listFormsAndSubmissions(event, config)
      : await deleteSubmission(event, config, auth);
  } catch (error) {
    console.error('admin-forms failed', safeErrorName(error));
    return json({ error: 'NETLIFY_FORMS_UNAVAILABLE' }, 503);
  }
};

async function listFormsAndSubmissions(event, config) {
  const query = event.queryStringParameters || {};
  const page = boundedInteger(query.page, 1, 10_000, 1);
  const perPage = boundedInteger(query.perPage || query.per_page, 1, 50, 25);
  const formId = normalizeOpaqueId(query.formId || query.form_id);
  const rawFilter = typeof query.q === 'string' ? query.q : '';
  const filter = normalizeFilter(rawFilter);

  if ((query.formId || query.form_id) && !formId) {
    return json({ error: 'INVALID_FORM_ID' }, 400);
  }
  if (rawFilter && !filter) {
    return json({ error: 'INVALID_FILTER' }, 400);
  }

  const formsResponse = await netlifyApiFetch(
    `/sites/${encodeURIComponent(config.siteId)}/forms`,
    config
  );
  const formsFailure = apiFailure(formsResponse);
  if (formsFailure) return formsFailure;

  const rawForms = await readJson(formsResponse);
  if (!Array.isArray(rawForms)) return json({ error: 'NETLIFY_FORMS_RESPONSE_INVALID' }, 502);
  const allForms = rawForms.map(normalizeForm).filter(Boolean);

  if (!formId) {
    const forms = filter
      ? allForms.filter((form) => searchable(form).includes(filter))
      : allForms;
    return json({
      forms,
      selectedForm: null,
      submissions: [],
      pagination: null,
      filter: rawFilter.trim()
    });
  }

  const selectedForm = allForms.find((form) => form.id === formId);
  if (!selectedForm) return json({ error: 'FORM_NOT_FOUND' }, 404);

  const submissionsResponse = await netlifyApiFetch(
    `/forms/${encodeURIComponent(formId)}/submissions`,
    config,
    { query: { page, per_page: perPage } }
  );
  const submissionsFailure = apiFailure(submissionsResponse);
  if (submissionsFailure) return submissionsFailure;

  const rawSubmissions = await readJson(submissionsResponse);
  if (!Array.isArray(rawSubmissions)) {
    return json({ error: 'NETLIFY_FORMS_RESPONSE_INVALID' }, 502);
  }

  const normalized = rawSubmissions.map(normalizeSubmission).filter(Boolean);
  const visible = filter
    ? normalized.filter((submission) => searchable(submission).includes(filter))
    : normalized;
  const submissions = visible.map((submission) => ({
    ...submission,
    deleteToken: createDeleteCapability(
      {
        siteId: config.siteId,
        formId,
        submissionId: submission.id,
        expiresAt: Date.now() + DELETE_CAPABILITY_TTL_MS
      },
      config.token
    )
  }));
  const total = nonNegativeHeaderInteger(submissionsResponse.headers, 'x-total-count');

  return json({
    forms: allForms,
    selectedForm,
    submissions,
    pagination: {
      page,
      perPage,
      count: normalized.length,
      visibleCount: submissions.length,
      hasMore: total == null ? normalized.length === perPage : page * perPage < total,
      ...(total == null ? {} : { total })
    },
    // Netlify's public list API has no search parameter. The filter is applied
    // safely to the current API page, which is made explicit to the client.
    filter: rawFilter.trim(),
    filterScope: 'current-page'
  });
}

async function deleteSubmission(event, config, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  if (Object.keys(body).some((key) => !['submissionId', 'submission_id', 'deleteToken'].includes(key))) {
    return json({ error: 'UNEXPECTED_FIELDS' }, 400);
  }

  const submissionId = normalizeOpaqueId(body.submissionId || body.submission_id);
  if (!submissionId) return json({ error: 'INVALID_SUBMISSION_ID' }, 400);
  if (typeof body.deleteToken !== 'string' || body.deleteToken.length > 2_048) {
    return json({ error: 'DELETE_CAPABILITY_REQUIRED' }, 403);
  }

  const capability = verifyDeleteCapability(body.deleteToken, config.token, Date.now());
  if (!capability.ok) return json({ error: capability.code }, 403);
  if (capability.value.siteId !== config.siteId || capability.value.submissionId !== submissionId) {
    return json({ error: 'DELETE_CAPABILITY_INVALID' }, 403);
  }

  const response = await netlifyApiFetch(
    `/submissions/${encodeURIComponent(submissionId)}`,
    config,
    { method: 'DELETE' }
  );
  if (response.status === 404) return json({ error: 'SUBMISSION_NOT_FOUND' }, 404);
  const failure = apiFailure(response);
  if (failure) return failure;
  if (response.status !== 204 && !response.ok) {
    return json({ error: 'NETLIFY_FORMS_DELETE_FAILED' }, 502);
  }

  console.info('Netlify Forms submission deleted by administrator', {
    actorId: auth.userId,
    siteId: config.siteId,
    formId: capability.value.formId,
    submissionId
  });
  return json({ deleted: true, submissionId });
}

function formsConfig() {
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

async function netlifyApiFetch(path, config, options = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.token}`
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function apiFailure(response) {
  if (response.status === 401 || response.status === 403) {
    return json({ error: 'NETLIFY_FORMS_TOKEN_REJECTED' }, 503);
  }
  if (response.status === 404) {
    return json({ error: 'NETLIFY_FORMS_RESOURCE_NOT_FOUND' }, 404);
  }
  if (!response.ok) return json({ error: 'NETLIFY_FORMS_REQUEST_FAILED' }, 502);
  return null;
}

function normalizeForm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeOpaqueId(raw.id);
  if (!id) return null;
  return {
    id,
    name: safeString(raw.name, 200),
    paths: Array.isArray(raw.paths)
      ? raw.paths.map((path) => safeString(path, 500)).filter(Boolean).slice(0, 50)
      : [],
    submissionCount: safeNonNegativeInteger(raw.submission_count),
    createdAt: safeDateString(raw.created_at)
  };
}

function normalizeSubmission(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = normalizeOpaqueId(raw.id);
  if (!id) return null;
  return {
    id,
    number: safeNonNegativeInteger(raw.number),
    email: safeString(raw.email, 320),
    name: safeString(raw.name, 300),
    firstName: safeString(raw.first_name, 150),
    lastName: safeString(raw.last_name, 150),
    company: safeString(raw.company, 300),
    summary: safeString(raw.summary, 5_000),
    body: safeString(raw.body, 20_000),
    data: sanitizeData(raw.data),
    createdAt: safeDateString(raw.created_at)
  };
}

function sanitizeData(value) {
  const budget = { remaining: MAX_DATA_CHARACTERS, entries: 0 };
  return sanitizeDataValue(value, budget, 0);
}

function sanitizeDataValue(value, budget, depth) {
  if (budget.remaining <= 0 || budget.entries >= 200 || depth > 5) return null;
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const output = value.slice(0, Math.max(0, Math.min(value.length, budget.remaining)));
    budget.remaining -= output.length;
    return output;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => {
      budget.entries += 1;
      return sanitizeDataValue(entry, budget, depth + 1);
    });
  }
  if (typeof value !== 'object') return null;

  const output = {};
  for (const [rawKey, entry] of Object.entries(value).slice(0, 100)) {
    if (budget.remaining <= 0 || budget.entries >= 200) break;
    const key = safeString(rawKey, 200);
    if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    budget.remaining -= key.length;
    budget.entries += 1;
    output[key] = sanitizeDataValue(entry, budget, depth + 1);
  }
  return output;
}

function createDeleteCapability(value, secret) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    s: value.siteId,
    f: value.formId,
    i: value.submissionId,
    e: value.expiresAt
  }), 'utf8').toString('base64url');
  const signature = signCapability(payload, secret);
  return `${payload}.${signature}`;
}

function verifyDeleteCapability(token, secret, now) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra || payload.length > 1_024 || signature.length > 128) {
    return { ok: false, code: 'DELETE_CAPABILITY_INVALID' };
  }

  const expected = signCapability(payload, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false, code: 'DELETE_CAPABILITY_INVALID' };
  }

  let value;
  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, code: 'DELETE_CAPABILITY_INVALID' };
  }
  if (
    !value ||
    value.v !== 1 ||
    !OPAQUE_ID_PATTERN.test(value.s || '') ||
    !OPAQUE_ID_PATTERN.test(value.f || '') ||
    !OPAQUE_ID_PATTERN.test(value.i || '') ||
    !Number.isSafeInteger(value.e)
  ) {
    return { ok: false, code: 'DELETE_CAPABILITY_INVALID' };
  }
  if (value.e <= now) return { ok: false, code: 'DELETE_CAPABILITY_EXPIRED' };
  if (value.e > now + DELETE_CAPABILITY_TTL_MS + 60_000) {
    return { ok: false, code: 'DELETE_CAPABILITY_INVALID' };
  }

  return {
    ok: true,
    value: {
      siteId: value.s,
      formId: value.f,
      submissionId: value.i,
      expiresAt: value.e
    }
  };
}

function signCapability(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update('chemdisk-admin-forms:v1\0')
    .update(payload)
    .digest('base64url');
}

function normalizeOpaqueId(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return OPAQUE_ID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeFilter(value) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pl');
  return normalized.length <= 100 ? normalized : '';
}

function searchable(value) {
  return JSON.stringify(value).normalize('NFKC').toLocaleLowerCase('pl');
}

function safeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, maxLength);
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeDateString(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function boundedInteger(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function nonNegativeHeaderInteger(headers, name) {
  if (!headers || typeof headers.get !== 'function') return null;
  const raw = headers.get(name);
  if (!/^\d+$/.test(String(raw || ''))) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeErrorName(error) {
  return error && error.name ? String(error.name) : 'Error';
}

exports._test = {
  createDeleteCapability,
  formsConfig,
  normalizeForm,
  normalizeSubmission,
  sanitizeData,
  verifyDeleteCapability
};
