// Administrative Identity API for the members dashboard.
//
// The browser sends only its own Identity JWT. Netlify injects the Identity
// service URL and a short-lived operator token into clientContext; that token
// is used only for server-to-server calls and is never returned to the client.

const {
  deleteUserLedger,
  getPaymentStore
} = require('../payment-common.js');

const ACCESS_ROLES = Object.freeze([
  'admin',
  'active',
  'hour',
  'day',
  'week',
  'month',
  'halfyear',
  'year'
]);
const ACCESS_ROLE_SET = new Set(ACCESS_ROLES);
const TIMED_ROLE_SET = new Set(['hour', 'day', 'week', 'month', 'halfyear', 'year']);
const COURSE_ROLE_SET = new Set(['active', ...TIMED_ROLE_SET]);
const BLOCKED_USER_METADATA_KEYS = new Set([
  'admin',
  'app_metadata',
  'is_admin',
  'role',
  'roles',
  'session_id',
  'status',
  'timed_access'
]);
const IDENTITY_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 16_384;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        Allow: 'GET, POST, PATCH, DELETE, OPTIONS',
        'Cache-Control': 'no-store',
        Vary: 'Origin'
      },
      body: ''
    };
  }

  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, {
      Allow: 'GET, POST, PATCH, DELETE, OPTIONS'
    });
  }

  const headers = event.headers || {};
  const clientToken = bearerToken(headers);
  const clientContext = context.clientContext || event.clientContext || {};
  const tokenUser = clientContext.user;
  const identity = normalizeIdentityContext(clientContext.identity);

  if (!clientToken || !tokenUser) {
    return json({ error: 'AUTH_REQUIRED' }, 401);
  }
  if (!identity) {
    return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
  }

  if (method !== 'GET') {
    if (!isJsonRequest(headers)) {
      return json({ error: 'JSON_REQUIRED' }, 415);
    }
    if (!isSameOriginRequest(headers)) {
      return json({ error: 'SAME_ORIGIN_REQUIRED' }, 403);
    }
    if (Buffer.byteLength(String(event.body || ''), 'utf8') > MAX_BODY_BYTES) {
      return json({ error: 'REQUEST_TOO_LARGE' }, 413);
    }
  }

  try {
    // clientContext contains verified JWT claims, but those claims may be stale
    // after an administrator role is removed. /user is the canonical Identity
    // record for the caller's JWT and is checked on every admin request.
    const currentResponse = await identityFetch(identity.url, '/user', clientToken);
    if (currentResponse.status === 401 || currentResponse.status === 403) {
      return json({ error: 'AUTH_EXPIRED' }, 401);
    }
    if (!currentResponse.ok) {
      return json({ error: 'SESSION_CHECK_UNAVAILABLE' }, 503);
    }

    const currentUser = await readJson(currentResponse);
    const tokenUserId = userId(tokenUser);
    const currentUserId = userId(currentUser);
    if (!currentUser || !tokenUserId || currentUserId !== tokenUserId) {
      return json({ error: 'AUTH_EXPIRED' }, 401);
    }
    const canonicalSessionId = sessionIdFrom(currentUser);
    if (canonicalSessionId && sessionIdFrom(tokenUser) !== canonicalSessionId) {
      return json({ error: 'SESSION_REPLACED' }, 401);
    }
    if (!rolesFrom(currentUser).includes('admin')) {
      return json({ error: 'ADMIN_REQUIRED' }, 403);
    }

    if (method === 'GET') {
      return await listUsers(event, identity);
    }
    if (method === 'POST') {
      return await inviteUser(event, identity, currentUser);
    }
    if (method === 'DELETE') {
      return await deleteUser(event, identity, currentUser);
    }
    return await updateUser(event, identity, currentUser);
  } catch (error) {
    console.error('admin-users failed', safeErrorName(error));
    return json({ error: 'IDENTITY_UNAVAILABLE' }, 503);
  }
};

async function listUsers(event, identity) {
  const query = event.queryStringParameters || {};
  const page = boundedInteger(query.page, 1, 10_000, 1);
  const perPage = boundedInteger(query.perPage || query.per_page, 1, 100, 50);
  const response = await identityFetch(identity.url, '/admin/users', identity.token, {
    query: { page, per_page: perPage }
  });

  if (response.status === 401 || response.status === 403) {
    return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
  }
  if (!response.ok) {
    return json({ error: 'IDENTITY_REQUEST_FAILED' }, 502);
  }

  const payload = await readJson(response);
  if (!payload || !Array.isArray(payload.users)) {
    return json({ error: 'IDENTITY_RESPONSE_INVALID' }, 502);
  }

  const users = payload.users.map(normalizePublicUser).filter(Boolean);
  const total = positiveHeaderInteger(response.headers, 'x-total-count');
  return json({
    users,
    pagination: {
      page,
      perPage,
      count: users.length,
      hasMore: total == null ? users.length === perPage : page * perPage < total,
      ...(total == null ? {} : { total })
    },
    allowedRoles: ACCESS_ROLES
  });
}

async function inviteUser(event, identity, currentAdmin) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }

  const validation = validateInvite(body);
  if (!validation.ok) {
    return json({ error: validation.code }, validation.status || 400);
  }
  const input = validation.value;
  const fullName = input.firstName && input.lastName
    ? normalizePersonName(`${input.firstName} ${input.lastName}`)
    : '';
  const inviteData = fullName
    ? {
        first_name: input.firstName,
        last_name: input.lastName,
        full_name: fullName,
        name: fullName
      }
    : {};

  // /invite creates an account without accepting or transporting a password.
  // Identity sends its normal invitation email, where the participant chooses
  // their own password. The operator token never leaves this function.
  const inviteResponse = await identityFetch(identity.url, '/invite', identity.token, {
    method: 'POST',
    body: {
      email: input.email,
      ...(Object.keys(inviteData).length ? { data: inviteData } : {})
    }
  });

  if (inviteResponse.status === 400 || inviteResponse.status === 409 || inviteResponse.status === 422) {
    return json({ error: 'USER_ALREADY_EXISTS_OR_INVITE_REJECTED' }, 409);
  }
  if (inviteResponse.status === 401 || inviteResponse.status === 403) {
    return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
  }
  if (!inviteResponse.ok) {
    return json({ error: 'IDENTITY_INVITE_FAILED' }, 502);
  }

  const invited = await readJson(inviteResponse);
  const invitedId = userId(invited);
  if (!invited || !invitedId) {
    return json({ error: 'IDENTITY_RESPONSE_INVALID' }, 502);
  }

  // Apply the whitelisted profile and roles through the admin endpoint. This
  // intentionally replaces only ChemDisk access roles and preserves any
  // unrelated provider metadata returned by Identity.
  const update = buildIdentityUpdate(invited, {
    id: invitedId,
    firstName: input.firstName,
    lastName: input.lastName,
    roles: input.roles
  });
  if (!update.ok) {
    return json({ error: update.code }, 400);
  }

  const updateResponse = await identityFetch(
    identity.url,
    `/admin/users/${encodeURIComponent(invitedId)}`,
    identity.token,
    { method: 'PUT', body: update.value }
  );
  if (updateResponse.status === 401 || updateResponse.status === 403) {
    return json({
      error: 'INVITE_CREATED_PROFILE_UPDATE_FAILED',
      invited: true,
      id: invitedId
    }, 502);
  }
  if (!updateResponse.ok) {
    return json({
      error: 'INVITE_CREATED_PROFILE_UPDATE_FAILED',
      invited: true,
      id: invitedId
    }, 502);
  }

  const updated = normalizePublicUser(await readJson(updateResponse));
  if (!updated) {
    return json({ error: 'IDENTITY_RESPONSE_INVALID' }, 502);
  }

  console.info('Identity user invited by administrator', {
    actorId: userId(currentAdmin),
    targetId: invitedId,
    roles: input.roles
  });

  return json({ user: updated, invited: true }, 201);
}

async function deleteUser(event, identity, currentAdmin) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }

  const validation = validateDelete(body);
  if (!validation.ok) {
    return json({ error: validation.code }, validation.status || 400);
  }
  const id = validation.value.id;
  if (id === userId(currentAdmin)) {
    return json({ error: 'CANNOT_DELETE_SELF' }, 409);
  }

  let paymentStore;
  try {
    paymentStore = getPaymentStore();
  } catch (error) {
    return json({ error: error.code || 'PAYMENT_STORAGE_UNAVAILABLE' }, error.status || 503);
  }

  const targetResponse = await identityFetch(
    identity.url,
    `/admin/users/${encodeURIComponent(id)}`,
    identity.token
  );
  const identityAlreadyDeleted = targetResponse.status === 404;
  if (!identityAlreadyDeleted) {
    if (targetResponse.status === 401 || targetResponse.status === 403) {
      return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
    }
    if (!targetResponse.ok || !userId(await readJson(targetResponse))) {
      return json({ error: 'IDENTITY_REQUEST_FAILED' }, 502);
    }

    const deleteResponse = await identityFetch(
      identity.url,
      `/admin/users/${encodeURIComponent(id)}`,
      identity.token,
      { method: 'DELETE' }
    );
    if (deleteResponse.status !== 404) {
      if (deleteResponse.status === 401 || deleteResponse.status === 403) {
        return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
      }
      if (!deleteResponse.ok) {
        return json({ error: 'IDENTITY_DELETE_FAILED' }, 502);
      }
    }
  }

  try {
    await deleteUserLedger(paymentStore, id);
  } catch (error) {
    console.error('Payment history cleanup after Identity deletion failed', safeErrorName(error));
    return json({
      error: 'PAYMENT_HISTORY_DELETE_FAILED',
      identityDeleted: true,
      id
    }, error.status || 502);
  }

  console.info('Identity user deleted by administrator', {
    actorId: userId(currentAdmin),
    targetId: id,
    paymentHistoryDeleted: true
  });
  return json({
    deleted: true,
    id,
    paymentHistoryDeleted: true,
    identityAlreadyDeleted
  });
}

async function updateUser(event, identity, currentAdmin) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }

  const validation = validateUpdate(body);
  if (!validation.ok) {
    return json({ error: validation.code }, validation.status || 400);
  }

  const input = validation.value;
  const targetResponse = await identityFetch(
    identity.url,
    `/admin/users/${encodeURIComponent(input.id)}`,
    identity.token
  );
  if (targetResponse.status === 404) {
    return json({ error: 'USER_NOT_FOUND' }, 404);
  }
  if (targetResponse.status === 401 || targetResponse.status === 403) {
    return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
  }
  if (!targetResponse.ok) {
    return json({ error: 'IDENTITY_REQUEST_FAILED' }, 502);
  }

  const target = await readJson(targetResponse);
  if (!target || userId(target) !== input.id) {
    return json({ error: 'IDENTITY_RESPONSE_INVALID' }, 502);
  }

  if (input.roles && input.id === userId(currentAdmin) && !input.roles.includes('admin')) {
    return json({ error: 'CANNOT_REMOVE_OWN_ADMIN' }, 409);
  }

  const update = buildIdentityUpdate(target, input);
  if (!update.ok) {
    return json({ error: update.code }, 400);
  }

  const updateResponse = await identityFetch(
    identity.url,
    `/admin/users/${encodeURIComponent(input.id)}`,
    identity.token,
    { method: 'PUT', body: update.value }
  );
  if (updateResponse.status === 404) {
    return json({ error: 'USER_NOT_FOUND' }, 404);
  }
  if (updateResponse.status === 401 || updateResponse.status === 403) {
    return json({ error: 'IDENTITY_ADMIN_UNAVAILABLE' }, 503);
  }
  if (!updateResponse.ok) {
    return json({ error: 'IDENTITY_UPDATE_FAILED' }, 502);
  }

  const updatedUser = await readJson(updateResponse);
  const normalized = normalizePublicUser(updatedUser);
  if (!normalized) {
    return json({ error: 'IDENTITY_RESPONSE_INVALID' }, 502);
  }

  console.info('Identity user updated by administrator', {
    actorId: userId(currentAdmin),
    targetId: input.id,
    rolesChanged: update.rolesChanged,
    accessMetadataChanged: update.accessMetadataChanged,
    profileChanged: input.firstName != null || input.lastName != null
  });

  return json({
    user: normalized,
    rolesChanged: update.rolesChanged,
    sessionRefreshRequired: update.accessMetadataChanged
  });
}

function buildIdentityUpdate(target, input) {
  const update = {};

  if (input.firstName != null || input.lastName != null) {
    const existing = safeUserMetadata(target.user_metadata);
    const firstName = input.firstName != null
      ? input.firstName
      : validatedPersonName(existing.first_name || existing.firstName || existing.given_name);
    const lastName = input.lastName != null
      ? input.lastName
      : validatedPersonName(existing.last_name || existing.lastName || existing.family_name);

    if (!firstName || !lastName) {
      return { ok: false, code: 'FIRST_AND_LAST_NAME_REQUIRED' };
    }

    const fullName = normalizePersonName(`${firstName} ${lastName}`);
    update.user_metadata = {
      ...existing,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      name: fullName
    };
  }

  let rolesChanged = false;
  let accessMetadataChanged = false;
  if (input.roles) {
    const existing = plainObject(target.app_metadata) ? target.app_metadata : {};
    const currentAccessRoles = rolesFrom(target).filter((role) => ACCESS_ROLE_SET.has(role));
    rolesChanged = !sameStringSet(currentAccessRoles, input.roles);
    const unrelatedRoles = rolesFrom(target).filter((role) => !ACCESS_ROLE_SET.has(role));
    const nextRoles = uniqueStrings([...unrelatedRoles, ...input.roles]);
    const selectedTimedRole = input.roles.find((role) => TIMED_ROLE_SET.has(role)) || '';
    const currentTimedAccess = plainObject(existing.timed_access) ? existing.timed_access : null;
    const expiresAt = currentTimedAccess ? Date.parse(currentTimedAccess.expires_at || '') : 0;
    const activeTimedWindow = Boolean(
      !rolesChanged &&
      selectedTimedRole &&
      currentTimedAccess &&
      currentTimedAccess.role === selectedTimedRole &&
      Number.isFinite(expiresAt) &&
      expiresAt > Date.now()
    );
    const shouldResetTimedAccess = Boolean(
      !activeTimedWindow && (rolesChanged || selectedTimedRole || currentTimedAccess)
    );
    const hadLegacyStatus = typeof existing.status === 'string'
      ? Boolean(existing.status.trim())
      : existing.status != null;
    accessMetadataChanged = rolesChanged || shouldResetTimedAccess || hadLegacyStatus;

    update.app_metadata = {
      ...existing,
      roles: nextRoles,
      // The login hook still understands the old app_metadata.status field.
      // Clearing it prevents a former `active` status from silently restoring
      // permanent access after an administrator selects no role or a timed role.
      status: ''
    };

    // Saving a profile must not extend an active timed grant merely because
    // the UI also posted the unchanged role. A genuinely changed role or the
    // explicit re-assignment of an expired/missing timed grant starts a fresh
    // window in identity-login on the user's next login.
    if (shouldResetTimedAccess) {
      update.app_metadata.timed_access = null;
    }
  }

  return { ok: true, value: update, rolesChanged, accessMetadataChanged };
}

function validateUpdate(body) {
  if (!plainObject(body)) return { ok: false, code: 'INVALID_BODY' };

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!UUID_PATTERN.test(id)) return { ok: false, code: 'INVALID_USER_ID' };

  const profile = plainObject(body.profile) ? body.profile : {};
  const first = firstPresent(body, profile, ['firstName', 'first_name']);
  const last = firstPresent(body, profile, ['lastName', 'last_name']);
  const hasRoles = Object.prototype.hasOwnProperty.call(body, 'roles');

  let firstName = null;
  let lastName = null;
  if (first.found) {
    if (typeof first.value !== 'string') return { ok: false, code: 'INVALID_FIRST_NAME' };
    firstName = validatedPersonName(first.value);
    if (!firstName) return { ok: false, code: 'INVALID_FIRST_NAME' };
  }
  if (last.found) {
    if (typeof last.value !== 'string') return { ok: false, code: 'INVALID_LAST_NAME' };
    lastName = validatedPersonName(last.value);
    if (!lastName) return { ok: false, code: 'INVALID_LAST_NAME' };
  }

  let roles = null;
  if (hasRoles) {
    const roleValidation = validateRoleList(body.roles);
    if (!roleValidation.ok) return roleValidation;
    roles = roleValidation.value;
  }

  if (!first.found && !last.found && !hasRoles) {
    return { ok: false, code: 'NO_CHANGES' };
  }

  return { ok: true, value: { id, firstName, lastName, roles } };
}

function validateInvite(body) {
  if (!plainObject(body)) return { ok: false, code: 'INVALID_BODY' };
  const allowed = new Set([
    'email',
    'firstName',
    'first_name',
    'lastName',
    'last_name',
    'profile',
    'roles'
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return { ok: false, code: 'UNEXPECTED_FIELDS' };
  }

  const profile = body.profile == null ? {} : body.profile;
  if (!plainObject(profile)) return { ok: false, code: 'INVALID_PROFILE' };
  const profileAllowed = new Set(['firstName', 'first_name', 'lastName', 'last_name']);
  if (Object.keys(profile).some((key) => !profileAllowed.has(key))) {
    return { ok: false, code: 'UNEXPECTED_PROFILE_FIELDS' };
  }

  const email = normalizeEmail(body.email);
  if (!email) return { ok: false, code: 'INVALID_EMAIL' };

  const first = firstPresent(body, profile, ['firstName', 'first_name']);
  const last = firstPresent(body, profile, ['lastName', 'last_name']);
  if (first.found !== last.found) {
    return { ok: false, code: 'FIRST_AND_LAST_NAME_REQUIRED' };
  }

  let firstName = null;
  let lastName = null;
  if (first.found) {
    if (typeof first.value !== 'string' || typeof last.value !== 'string') {
      return { ok: false, code: 'FIRST_AND_LAST_NAME_REQUIRED' };
    }
    firstName = validatedPersonName(first.value);
    lastName = validatedPersonName(last.value);
    if (!firstName || !lastName) {
      return { ok: false, code: 'FIRST_AND_LAST_NAME_REQUIRED' };
    }
  }

  const roleValidation = validateRoleList(
    Object.prototype.hasOwnProperty.call(body, 'roles') ? body.roles : []
  );
  if (!roleValidation.ok) return roleValidation;

  return {
    ok: true,
    value: {
      email,
      firstName,
      lastName,
      roles: roleValidation.value
    }
  };
}

function validateDelete(body) {
  if (!plainObject(body)) return { ok: false, code: 'INVALID_BODY' };
  if (Object.keys(body).some((key) => key !== 'id')) {
    return { ok: false, code: 'UNEXPECTED_FIELDS' };
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!UUID_PATTERN.test(id)) return { ok: false, code: 'INVALID_USER_ID' };
  return { ok: true, value: { id } };
}

function validateRoleList(value) {
  if (!Array.isArray(value) || value.length > ACCESS_ROLES.length) {
    return { ok: false, code: 'INVALID_ROLES' };
  }
  const roles = uniqueStrings(value);
  if (roles.length !== value.length || roles.some((role) => !ACCESS_ROLE_SET.has(role))) {
    return { ok: false, code: 'INVALID_ROLES' };
  }
  // `admin` is an administrative flag and may coexist with one course grant.
  // Combining active with a timed role (or two timed roles) is ambiguous and
  // could accidentally turn temporary access into permanent access.
  if (roles.filter((role) => COURSE_ROLE_SET.has(role)).length > 1) {
    return { ok: false, code: 'MULTIPLE_ACCESS_ROLES' };
  }
  return { ok: true, value: roles };
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.normalize('NFKC').trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || /[\u0000-\u0020\u007f]/.test(email)) return '';
  if (!/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(email)) return '';
  return email;
}

function normalizePublicUser(raw) {
  if (!plainObject(raw)) return null;
  const id = userId(raw);
  if (!id) return null;

  const metadata = plainObject(raw.user_metadata) ? raw.user_metadata : {};
  const firstName = normalizePersonName(metadata.first_name || metadata.firstName || metadata.given_name).slice(0, 80);
  const lastName = normalizePersonName(metadata.last_name || metadata.lastName || metadata.family_name).slice(0, 80);
  const fullName = normalizePersonName(
    metadata.full_name || metadata.name || [firstName, lastName].filter(Boolean).join(' ')
  ).slice(0, 161);
  const timed = normalizeTimedAccess(raw.app_metadata && raw.app_metadata.timed_access);

  return {
    id,
    email: typeof raw.email === 'string' ? raw.email : '',
    firstName,
    lastName,
    fullName,
    roles: rolesFrom(raw).filter((role) => ACCESS_ROLE_SET.has(role)),
    timedAccess: timed,
    confirmedAt: safeDateString(raw.confirmed_at),
    createdAt: safeDateString(raw.created_at),
    updatedAt: safeDateString(raw.updated_at),
    lastSignInAt: safeDateString(raw.last_sign_in_at)
  };
}

function normalizeTimedAccess(value) {
  if (!plainObject(value) || !TIMED_ROLE_SET.has(value.role)) return null;
  return {
    role: value.role,
    assignedAt: safeDateString(value.assigned_at),
    expiresAt: safeDateString(value.expires_at),
    active: Boolean(value.active)
  };
}

async function identityFetch(baseUrl, path, token, options = {}) {
  const url = appendIdentityPath(baseUrl, path);
  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, String(value));
  }

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

function normalizeIdentityContext(identity) {
  if (!plainObject(identity) || typeof identity.token !== 'string' || !identity.token) return null;
  try {
    const url = new URL(identity.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) return null;
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return { url: url.toString().replace(/\/$/, ''), token: identity.token };
  } catch {
    return null;
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
    const protocol = forwardedProtocol || (isLocalHost(host.split(':')[0]) ? 'http' : 'https');
    if (protocol === 'https' || (protocol === 'http' && isLocalHost(host.split(':')[0]))) {
      allowedOrigins.add(`${protocol}://${host}`);
    }
  }

  return allowedOrigins.has(origin.origin);
}

function isJsonRequest(headers) {
  return /^application\/json(?:\s*;|$)/i.test(headerValue(headers, 'content-type'));
}

function bearerToken(headers) {
  const raw = headerValue(headers, 'authorization');
  const match = /^Bearer\s+([^\s]+)$/i.exec(raw);
  return match ? match[1] : '';
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

function boundedInteger(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function positiveHeaderInteger(headers, name) {
  if (!headers || typeof headers.get !== 'function') return null;
  const raw = headers.get(name);
  if (!/^\d+$/.test(String(raw || ''))) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function rolesFrom(user) {
  const appMetadata = plainObject(user && user.app_metadata) ? user.app_metadata : {};
  return uniqueStrings(appMetadata.roles);
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const role = value.trim();
    if (!role || seen.has(role)) continue;
    seen.add(role);
    result.push(role);
  }
  return result;
}

function normalizePersonName(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUserMetadata(value) {
  if (!plainObject(value)) return {};
  const safe = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!BLOCKED_USER_METADATA_KEYS.has(String(key).toLowerCase())) safe[key] = entry;
  }
  return safe;
}

function validatedPersonName(value) {
  const normalized = normalizePersonName(value);
  const validCharacters = /^[\p{L}\p{M}](?:[\p{L}\p{M} .'’\-]*[\p{L}\p{M}.])?$/u;
  if (normalized.length < 2 || normalized.length > 80 || !validCharacters.test(normalized)) return '';
  return normalized;
}

function sameStringSet(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
  const values = new Set(first);
  return second.every((value) => values.has(value));
}

function safeDateString(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
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

function firstPresent(primary, secondary, keys) {
  for (const source of [primary, secondary]) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        return { found: true, value: source[key] };
      }
    }
  }
  return { found: false, value: undefined };
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

exports._test = {
  ACCESS_ROLES,
  bearerToken,
  buildIdentityUpdate,
  isSameOriginRequest,
  normalizePublicUser,
  validateDelete,
  validateInvite,
  validateUpdate
};
