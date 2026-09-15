// Normalize public profile metadata submitted during signup. Authorization is
// deliberately not assigned here; course access is managed through roles in
// app_metadata by an administrator.

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

const normalizePersonName = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
};

const sanitizeUserMetadata = (raw) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const safe = {};

  for (const [key, value] of Object.entries(source)) {
    if (BLOCKED_USER_METADATA_KEYS.has(String(key).toLowerCase())) continue;
    safe[key] = value;
  }

  const firstName = normalizePersonName(source.first_name || source.firstName || source.given_name);
  const lastName = normalizePersonName(source.last_name || source.lastName || source.family_name);
  const suppliedFullName = normalizePersonName(source.full_name || source.name);
  const fullName = normalizePersonName([firstName, lastName].filter(Boolean).join(' ')) || suppliedFullName;

  if (firstName) safe.first_name = firstName;
  if (lastName) safe.last_name = lastName;
  if (fullName) {
    safe.full_name = fullName;
    safe.name = fullName;
  }

  return safe;
};

exports.handler = async (event) => {
  try {
    const payload = JSON.parse((event && event.body) || '{}');
    const user = payload && payload.user && typeof payload.user === 'object' ? payload.user : {};
    const userMetadata = sanitizeUserMetadata(user.user_metadata);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ user_metadata: userMetadata })
    };
  } catch (error) {
    console.error('identity-signup failed', error && error.message ? error.message : error);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Nieprawidłowe dane rejestracji.' })
    };
  }
};

// Exported for small, dependency-free unit tests. Netlify only invokes handler.
exports.sanitizeUserMetadata = sanitizeUserMetadata;
