// Normalize role-based access and rotate a per-login session identifier.
//
// Security boundary: only app_metadata is trusted for authorization. Identity
// users can edit user_metadata themselves, so it must never grant a role or an
// active status.

const crypto = require('crypto');

const TIMED_ROLE_DURATIONS_MS = Object.freeze({
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  halfyear: 182 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000
});

const ACCESS_ROLES = new Set([
  'admin',
  'active',
  ...Object.keys(TIMED_ROLE_DURATIONS_MS)
]);

const isTimedRole = (role) => typeof role === 'string' && Object.prototype.hasOwnProperty.call(TIMED_ROLE_DURATIONS_MS, role);

const normalizeStatus = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const pickStatus = (user) => {
  if (!user) return '';
  const appMeta = user.app_metadata || {};
  return typeof appMeta.status === 'string' ? appMeta.status.trim() : '';
};

const ACTIVE_STATUS_VALUES = new Set(['active', 'aktywny', 'approved', 'enabled', 'admin']);

const uniqueStrings = (values) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

const parseTimestamp = (input) => {
  if (!input && input !== 0) return 0;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'string') return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTimestamp = (ms) => {
  if (!ms || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const value = date.getTime();
  if (!Number.isFinite(value)) return null;
  return date.toISOString();
};

const parseTimedAccess = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return { role: '', assignedAt: 0, expiresAt: 0, injectedActive: false };
  }
  const role = typeof raw.role === 'string' ? raw.role.trim() : '';
  return {
    role,
    assignedAt: parseTimestamp(raw.assigned_at),
    expiresAt: parseTimestamp(raw.expires_at),
    injectedActive: Boolean(raw.injected_active)
  };
};

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}');
    const user = payload && payload.user ? payload.user : {};
    const appMeta = user.app_metadata || {};
    const roles = uniqueStrings(appMeta.roles);

    const statusRaw = pickStatus(user);
    const statusNormalized = normalizeStatus(statusRaw);
    const isAdmin = roles.includes('admin');
    const statusActive = ACTIVE_STATUS_VALUES.has(statusNormalized);

    const existingTimed = parseTimedAccess(appMeta.timed_access);
    const timedRoles = roles.filter((role) => isTimedRole(role));
    const hasActiveRole = roles.includes('active');
    const manualActiveBefore = hasActiveRole && !existingTimed.injectedActive;
    let selectedTimedRole = '';
    if (timedRoles.length) {
      selectedTimedRole = timedRoles.reduce((current, role) => {
        if (!current) return role;
        const currentDuration = TIMED_ROLE_DURATIONS_MS[current];
        const candidateDuration = TIMED_ROLE_DURATIONS_MS[role];
        return candidateDuration >= currentDuration ? role : current;
      }, '');
    }

    const now = Date.now();
    let assignedAtMs = existingTimed.assignedAt;
    let expiresAtMs = existingTimed.expiresAt;
    let grantedTimedRole = '';

    if (selectedTimedRole) {
      const duration = TIMED_ROLE_DURATIONS_MS[selectedTimedRole];
      const sameRole = existingTimed.role === selectedTimedRole;
      const hasStoredWindow = sameRole && assignedAtMs && expiresAtMs;
      const storedWindowValid = Boolean(hasStoredWindow && expiresAtMs > assignedAtMs);
      const windowExpired = Boolean(storedWindowValid && expiresAtMs <= now);

      // Only create a fresh window when metadata is missing or the role actually changed.
      if (!sameRole || !storedWindowValid) {
        assignedAtMs = now;
        expiresAtMs = now + duration;
        grantedTimedRole = selectedTimedRole;
      } else if (windowExpired) {
        // Expired timed access should be cleared instead of silently extending.
        grantedTimedRole = '';
      } else {
        grantedTimedRole = selectedTimedRole;
      }
    } else {
      assignedAtMs = 0;
      expiresAtMs = 0;
    }

    const timedActive = Boolean(grantedTimedRole && expiresAtMs && expiresAtMs > now);

    if (!timedActive) {
      grantedTimedRole = '';
    }

    let nextRoles = roles.filter((role) => !isTimedRole(role) && role !== 'active');
    if (timedActive && grantedTimedRole) {
      nextRoles.push(grantedTimedRole);
    }

    // Timed roles are listed directly in netlify.toml, so they do not need an
    // extra `active` role. Keeping them separate makes expiry/administration
    // easier to reason about and cleans up `active` injected by older versions.
    const activeInjectedNow = false;
    // `admin` is already a permanent access role in netlify.toml. Do not add a
    // redundant `active` role, otherwise role management becomes ambiguous.
    const shouldHaveActive = statusActive || manualActiveBefore;
    if (shouldHaveActive) {
      nextRoles.push('active');
    }

    nextRoles = uniqueStrings(nextRoles);

    // Keep unrelated application roles intact, but access is granted only by
    // the role names mirrored in netlify.toml.
    const hasAccessRole = nextRoles.some((role) => ACCESS_ROLES.has(role));

    const sessionId = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');

    const responseMeta = {
      ...appMeta,
      status: statusRaw || appMeta.status || '',
      roles: nextRoles,
      // Do not rotate the canonical session for an inactive account. This
      // avoids an unsuccessful/inactive login attempt kicking out a valid
      // session while still allowing the client to explain account status.
      session_id: hasAccessRole ? sessionId : (typeof appMeta.session_id === 'string' ? appMeta.session_id : '')
    };

    if (timedActive && grantedTimedRole) {
      responseMeta.timed_access = {
        role: grantedTimedRole,
        assigned_at: formatTimestamp(assignedAtMs),
        expires_at: formatTimestamp(expiresAtMs),
        active: timedActive,
        injected_active: activeInjectedNow
      };
    } else if (appMeta.timed_access) {
      responseMeta.timed_access = null;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_metadata: responseMeta
      })
    };
  } catch (e) {
    console.error('identity-login failed', e && e.message ? e.message : e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Błąd logowania.' })
    };
  }
};
