/*
  Unified auth/session helper for Netlify Identity.
  - Access to `/members/*` is based only on roles stored in app_metadata.
  - Rotates a per-login session_id in identity-login function to enforce a single active session.
  - Checks the canonical session periodically and when the page regains focus.
  - Sets the `nf_jwt` cookie after login to enable role-based redirects.
  - Exposes window.ChemAuth for the members dashboard/profile UI.
*/

(function () {
  if (typeof window === 'undefined') return;

  const NF_JWT_COOKIE = 'nf_jwt';
  const LOCAL_SESSION_KEY = 'chem_session_id';
  const GOTRUE_STORAGE_KEY = 'gotrue.user';
  const MEMBERS_PATH = '/members/';
  const LOGIN_PATH = '/login/';
  const SESSION_CHECK_INTERVAL_MS = 30000;
  const IDENTITY_REQUEST_TIMEOUT_MS = 8000;
  const MIN_PASSWORD_LENGTH = 10;

  const withTimeout = async (factory, timeoutMs = IDENTITY_REQUEST_TIMEOUT_MS) => {
    let timeoutId = null;
    try {
      return await Promise.race([
        Promise.resolve().then(factory),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('identity_timeout')), timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  };

  const parseHashParams = () => {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return {};
    return hash.split('&').reduce((acc, piece) => {
      if (!piece) return acc;
      const eqIndex = piece.indexOf('=');
      const rawKey = eqIndex === -1 ? piece : piece.slice(0, eqIndex);
      const rawValue = eqIndex === -1 ? '' : piece.slice(eqIndex + 1);
      let keyDecoded = rawKey || '';
      let valueDecoded = rawValue || '';
      try { keyDecoded = decodeURIComponent(rawKey || ''); } catch {}
      try { valueDecoded = decodeURIComponent(rawValue || ''); } catch {}
      if (!keyDecoded) return acc;
      acc[keyDecoded] = valueDecoded;
      return acc;
    }, {});
  };

  const normalizeTokenValue = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const spacesFixed = trimmed.replace(/ /g, '+');
    return spacesFixed.replace(/[\r\n\t\f\v\u00a0]+/gi, '');
  };

  const decodeEmailFromToken = (token) => {
    token = normalizeTokenValue(token);
    if (!token || token.indexOf('.') === -1) return '';
    try {
      const base = token.split('.')[1];
      if (!base) return '';
      const normalized = base.replace(/-/g, '+').replace(/_/g, '/');
      const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
      const json = atob(normalized + padding);
      const payload = JSON.parse(json);
      const email = payload.email || payload.email_new || payload.new_email || payload.sub;
      return typeof email === 'string' ? email : '';
    } catch (e) {
      return '';
    }
  };

  const detectIdentityFlowFromHash = () => {
    const hashParams = parseHashParams();
    const typeParam = (hashParams.type || '').toLowerCase();
    const error = hashParams.error || '';
    const errorDescription = hashParams.error_description || '';

    const pickToken = (keys) => {
      for (const key of keys) {
        if (hashParams[key]) return hashParams[key];
      }
      return '';
    };

    let flow = '';
    if (hashParams.invite_token || (hashParams.token && typeParam === 'invite')) flow = 'invite';
    else if (hashParams.recovery_token || typeParam === 'recovery') flow = 'recovery';
    else if (hashParams.email_change_token || typeParam === 'email_change' || typeParam === 'email_change_confirm') flow = 'email-change';
    else if (hashParams.confirmation_token || typeParam === 'confirmation' || typeParam === 'signup') flow = 'confirm';

    let token = '';
    if (flow === 'invite') token = pickToken(['invite_token', 'token']);
    else if (flow === 'recovery') token = pickToken(['recovery_token', 'token']);
    else if (flow === 'email-change') token = pickToken(['email_change_token', 'token']);
    else if (flow === 'confirm') token = pickToken(['confirmation_token', 'token']);
    else if (!flow) token = pickToken(['token']);
    token = normalizeTokenValue(token);

    const email = hashParams.email || hashParams.new_email || hashParams.email_new || decodeEmailFromToken(token);

    return { type: flow, token, email, rawType: typeParam, error, errorDescription };
  };

  const redirectIdentityHashToLogin = () => {
    if (!location.hash) return;
    const flow = detectIdentityFlowFromHash();
    if (!flow.type && !flow.token && !flow.error && !flow.errorDescription) return;
    const onLoginPage = location.pathname.startsWith(LOGIN_PATH);
    // Fragment URL nie jest wysyłany w żądaniu HTTP ani nagłówku Referer.
    // Na stronie logowania odczyta go login/script.js i od razu wyczyści.
    if (onLoginPage) return;

    const target = new URL(LOGIN_PATH, location.origin);
    try {
      const currentParams = new URLSearchParams(location.search || '');
      currentParams.forEach((value, key) => {
        target.searchParams.set(key, value);
      });
    } catch {}
    target.hash = location.hash;
    location.replace(target.toString());
  };

  redirectIdentityHashToLogin();

  const ID = window.netlifyIdentity;
  if (!ID) {
    const unavailable = { available: false, authenticated: false, profile: null };
    window.ChemAuth = {
      ready: Promise.resolve(unavailable),
      getUser: () => null,
      getProfile: () => null,
      getAccessToken: async () => { throw new Error('Netlify Identity jest niedostępne.'); },
      updateProfile: async () => { throw new Error('Netlify Identity jest niedostępne.'); },
      changePassword: async () => { throw new Error('Netlify Identity jest niedostępne.'); },
      logout: async () => false,
      checkSession: async () => ({ ok: false, verified: false, reason: 'identity_unavailable' }),
      getSessionStatus: () => ({ ok: false, verified: false, reason: 'identity_unavailable' }),
      getReturnTo: () => MEMBERS_PATH
    };
    return;
  }

  let resolveAuthReady;
  const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });
  let authReadySettled = false;
  let sessionCheckInFlight = null;
  let sessionMonitorId = null;
  let jwtCookieRefreshPending = false;
  let jwtClaimsRefreshRequired = false;
  let credentialUpdateInProgress = false;
  let redirectInProgress = false;
  let lastSessionStatus = {
    ok: false,
    verified: false,
    active: false,
    reason: 'not_checked',
    checkedAt: null
  };

  const dispatchAuthEvent = (name, detail) => {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {}
  };

  const isMembersPage = () => {
    try {
      // Prefer explicit marker when URL gets cleaned to '/'
      if (document.querySelector('meta[name="x-members"][content="1"]')) return true;
    } catch {}
    return location.pathname.startsWith(MEMBERS_PATH);
  };
  const isLoginPage = () => location.pathname.startsWith(LOGIN_PATH);
  const isPaymentReturnPage = () => location.pathname.startsWith('/payment-success/');
  const isPurchasePage = () => location.pathname.startsWith('/purchase/');

  const safeAppReturnTo = (value) => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '';
    try {
      const target = new URL(value, location.origin);
      const isMembersTarget = target.pathname.startsWith(MEMBERS_PATH);
      const isAccessStatusTarget = target.pathname === '/time';
      const isPurchaseTarget = target.pathname.startsWith('/purchase/');
      if (target.origin !== location.origin || (!isMembersTarget && !isAccessStatusTarget && !isPurchaseTarget)) return '';
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return '';
    }
  };

  const getReturnTo = () => {
    try {
      const params = new URLSearchParams(location.search || '');
      const base = safeAppReturnTo(params.get('returnTo') || '') || MEMBERS_PATH;
      const target = new URL(base, location.origin);
      const reserved = new Set([
        'confirmation_token',
        'email',
        'email_change_token',
        'email_new',
        'error',
        'error_description',
        'flow',
        'inactive',
        'invite_token',
        'loggedout',
        'new_email',
        'recovery_token',
        'returnTo',
        'signup',
        'token',
        'view'
      ]);
      const identityTypes = new Set(['confirmation', 'email_change', 'email_change_confirm', 'invite', 'recovery', 'signup']);

      params.forEach((value, key) => {
        if (reserved.has(key)) return;
        if (key === 'type' && identityTypes.has(String(value).toLowerCase())) return;
        if (!target.searchParams.has(key)) target.searchParams.append(key, value);
      });

      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return MEMBERS_PATH;
    }
  };

  const TIMED_ROLE_NAMES = ['hour', 'day', 'week', 'month', 'halfyear', 'year'];
  const TIMED_ROLES = new Set(TIMED_ROLE_NAMES);

  const parseTimestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };

  const timedAccessState = (source) => {
    const meta = source && source.app_metadata ? source.app_metadata.timed_access : undefined;
    const rawRole = meta && typeof meta.role === 'string' ? meta.role.trim() : '';
    const role = rawRole && TIMED_ROLES.has(rawRole) ? rawRole : '';
    const assignedAt = meta ? parseTimestamp(meta.assigned_at) : 0;
    const expiresAt = meta ? parseTimestamp(meta.expires_at) : 0;
    return {
      role,
      assignedAt,
      expiresAt,
      injectedActive: Boolean(meta && meta.injected_active)
    };
  };

  const timedAccessIsActive = (user, now = Date.now()) => {
    if (!user) return false;
    const state = timedAccessState(user);
    if (!state.role) return false;
    const roles = getRoles(user);
    if (!Array.isArray(roles) || !roles.includes(state.role)) return false;
    return state.expiresAt > now;
  };

  const timedAccessEqual = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    const keys = ['role', 'assigned_at', 'expires_at', 'active', 'injected_active'];
    for (const key of keys) {
      const va = Object.prototype.hasOwnProperty.call(a, key) ? a[key] : null;
      const vb = Object.prototype.hasOwnProperty.call(b, key) ? b[key] : null;
      if (va !== vb) return false;
    }
    return true;
  };

  const getUser = () => {
    try { return ID.currentUser(); } catch { return null; }
  };

  const getRoles = (user) => {
    const roles = (user && user.app_metadata && Array.isArray(user.app_metadata.roles))
      ? user.app_metadata.roles
      : [];
    return roles;
  };

  const isActiveUser = (user) => {
    if (!user) return false;
    const roles = getRoles(user);
    if (Array.isArray(roles) && roles.includes('admin')) return true;
    const now = Date.now();
    const timedState = timedAccessState(user);
    if (timedState.role && timedState.expiresAt > now && Array.isArray(roles) && roles.includes(timedState.role)) {
      return true;
    }
    if (Array.isArray(roles) && roles.includes('active') && !timedState.injectedActive) {
      return true;
    }
    return false;
  };

  const rolesEqual = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return false;
    }
    return true;
  };

  const sessionIdFrom = (source) => {
    if (!source || !source.app_metadata) return '';
    const sid = source.app_metadata.session_id;
    return typeof sid === 'string' && sid ? sid : '';
  };

  const jwtPayloadFrom = (token) => {
    if (typeof token !== 'string') return null;
    const pieces = token.split('.');
    if (pieces.length < 2 || !pieces[1]) return null;
    try {
      const normalized = pieces[1].replace(/-/g, '+').replace(/_/g, '/');
      const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
      const payload = JSON.parse(atob(normalized + padding));
      return payload && typeof payload === 'object' ? payload : null;
    } catch {
      return null;
    }
  };

  const normalizeProfileName = (value) => {
    if (typeof value !== 'string') return '';
    return value
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const profileFromUser = (user) => {
    if (!user) return null;
    const meta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
    let firstName = normalizeProfileName(meta.first_name || meta.firstName || meta.given_name);
    let lastName = normalizeProfileName(meta.last_name || meta.lastName || meta.family_name);
    let fullName = normalizeProfileName(meta.full_name || meta.name || [firstName, lastName].filter(Boolean).join(' '));

    if ((!firstName || !lastName) && fullName) {
      const parts = fullName.split(' ').filter(Boolean);
      if (!firstName) firstName = parts.shift() || '';
      if (!lastName) lastName = parts.join(' ');
    }
    fullName = normalizeProfileName([firstName, lastName].filter(Boolean).join(' ')) || fullName;

    return {
      firstName,
      lastName,
      fullName,
      email: typeof user.email === 'string' ? user.email : ''
    };
  };

  const getProfile = () => profileFromUser(getUser());

  const getAccessToken = async ({ forceRefresh = false } = {}) => {
    const user = getUser();
    if (!user || typeof user.jwt !== 'function') {
      const error = new Error('Sesja wygasła. Zaloguj się ponownie.');
      error.code = 'not_authenticated';
      throw error;
    }

    const token = await withTimeout(() => user.jwt(Boolean(forceRefresh)));
    if (!token) {
      const error = new Error('Nie udało się odświeżyć sesji.');
      error.code = 'token_unavailable';
      throw error;
    }
    return token;
  };

  const assertValidProfileName = (value, label) => {
    const normalized = normalizeProfileName(value);
    const validCharacters = /^[\p{L}\p{M}](?:[\p{L}\p{M} .'’\-]*[\p{L}\p{M}.])?$/u;
    if (normalized.length < 2 || normalized.length > 80 || !validCharacters.test(normalized)) {
      const error = new Error(`${label} musi mieć od 2 do 80 znaków i może zawierać tylko litery, spacje, apostrof, kropkę lub łącznik.`);
      error.code = 'invalid_profile_name';
      throw error;
    }
    return normalized;
  };

  const updateProfile = async (changes = {}) => {
    const user = getUser();
    if (!user) {
      const error = new Error('Musisz być zalogowany, aby zmienić profil.');
      error.code = 'not_authenticated';
      throw error;
    }

    const current = profileFromUser(user) || {};
    const firstName = assertValidProfileName(
      typeof changes.firstName === 'string' ? changes.firstName : changes.first_name || current.firstName,
      'Imię'
    );
    const lastName = assertValidProfileName(
      typeof changes.lastName === 'string' ? changes.lastName : changes.last_name || current.lastName,
      'Nazwisko'
    );
    const fullName = `${firstName} ${lastName}`;
    const sourceMeta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
    const nextMeta = {};
    const blockedKeys = new Set(['admin', 'app_metadata', 'is_admin', 'role', 'roles', 'session_id', 'status', 'timed_access']);

    for (const [key, value] of Object.entries(sourceMeta)) {
      if (!blockedKeys.has(String(key).toLowerCase())) nextMeta[key] = value;
    }
    nextMeta.first_name = firstName;
    nextMeta.last_name = lastName;
    nextMeta.full_name = fullName;
    nextMeta.name = fullName;

    const updatedUser = await user.update({ data: nextMeta });
    const profile = profileFromUser(updatedUser || getUser() || user);
    dispatchAuthEvent('chem-auth-profile-updated', { profile });
    dispatchAuthEvent('chem-auth-user-changed', { authenticated: true, profile });
    return profile;
  };

  const identityErrorMessage = (error) => String(
    error && (error.message || error.msg || error.error_description)
      ? error.message || error.msg || error.error_description
      : error || ''
  );

  const changePassword = async ({ currentPassword, newPassword } = {}) => {
    const user = getUser();
    if (!user || !user.email) {
      const error = new Error('Musisz być zalogowany, aby zmienić hasło.');
      error.code = 'not_authenticated';
      throw error;
    }
    if (typeof currentPassword !== 'string' || !currentPassword) {
      const error = new Error('Wpisz obecne hasło.');
      error.code = 'current_password_required';
      throw error;
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      const error = new Error(`Nowe hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`);
      error.code = 'weak_password';
      throw error;
    }
    if (newPassword === currentPassword) {
      const error = new Error('Nowe hasło musi być inne niż obecne.');
      error.code = 'password_unchanged';
      throw error;
    }
    if (!ID.gotrue || typeof ID.gotrue.login !== 'function') {
      const error = new Error('Usługa zmiany hasła jest chwilowo niedostępna.');
      error.code = 'identity_unavailable';
      throw error;
    }

    if (sessionCheckInFlight) {
      try { await sessionCheckInFlight; } catch {}
    }
    credentialUpdateInProgress = true;
    try {
      let verifiedUser;
      try {
        verifiedUser = await withTimeout(() => ID.gotrue.login(user.email, currentPassword, true));
      } catch (error) {
        const message = identityErrorMessage(error).toLowerCase();
        if (
          message.includes('invalid_grant')
          || message.includes('invalid login')
          || message.includes('password invalid')
          || message.includes('no user found')
        ) {
          const invalid = new Error('Obecne hasło jest nieprawidłowe.');
          invalid.code = 'invalid_current_password';
          throw invalid;
        }
        const unavailable = new Error('Nie udało się sprawdzić obecnego hasła. Spróbuj ponownie.');
        unavailable.code = 'reauthentication_failed';
        throw unavailable;
      }

      const verifiedSessionId = sessionIdFrom(verifiedUser);
      if (verifiedSessionId) saveLocalSessionId(verifiedSessionId);
      try {
        await setNFJwtCookie(verifiedUser, { forceRefresh: true });
      } catch {}

      let updatedUser;
      try {
        if (!verifiedUser || typeof verifiedUser.update !== 'function') {
          throw new Error('identity_update_unavailable');
        }
        updatedUser = await withTimeout(() => verifiedUser.update({ password: newPassword }));
      } catch (error) {
        const message = identityErrorMessage(error).toLowerCase();
        if (
          message.includes('weak')
          || message.includes('short')
          || message.includes('minimum')
          || message.includes('at least')
        ) {
          const weak = new Error(`Nowe hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków i spełniać zasady Netlify Identity.`);
          weak.code = 'weak_password';
          throw weak;
        }
        const failed = new Error('Nie udało się zapisać nowego hasła. Spróbuj ponownie.');
        failed.code = 'password_update_failed';
        throw failed;
      }

      const activeUser = updatedUser || getUser() || verifiedUser;
      const activeSessionId = sessionIdFrom(activeUser) || verifiedSessionId;
      if (activeSessionId) saveLocalSessionId(activeSessionId);
      await setNFJwtCookie(activeUser, { forceRefresh: true });
      credentialUpdateInProgress = false;
      const session = await checkSingleSessionOrLogout();
      if (!session.ok) {
        const error = new Error('Hasło zmieniono, ale sesja wymaga ponownego zalogowania.');
        error.code = 'password_changed_session_refresh_failed';
        throw error;
      }
      dispatchAuthEvent('chem-auth-user-changed', {
        authenticated: true,
        profile: profileFromUser(activeUser)
      });
      return true;
    } finally {
      credentialUpdateInProgress = false;
    }
  };

  const setCookie = (name, value, opts = {}) => {
    const p = [
      `${name}=${value}`,
      'Path=/'
    ];
    if (opts.maxAge) p.push(`Max-Age=${opts.maxAge}`);
    if (opts.sameSite) p.push(`SameSite=${opts.sameSite}`); else p.push('SameSite=Lax');
    if (location.protocol === 'https:') p.push('Secure');
    document.cookie = p.join('; ');
  };

  const clearCookie = (name) => {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax` + (location.protocol === 'https:' ? '; Secure' : '');
  };

  const setNFJwtCookie = async (user, { forceRefresh = false } = {}) => {
    try {
      if (!user || !isActiveUser(user)) {
        jwtCookieRefreshPending = false;
        clearNFJwtCookie();
        return false;
      }
      // Reuse a still-valid JWT. Forcing a refresh on every page load makes
      // several tabs race over the same persisted refresh token.
      const token = await withTimeout(() => user.jwt(Boolean(forceRefresh || jwtClaimsRefreshRequired)));
      if (!token) {
        jwtCookieRefreshPending = true;
        return false;
      }
      setCookie(NF_JWT_COOKIE, token, { sameSite: 'Lax' });
      jwtCookieRefreshPending = false;
      jwtClaimsRefreshRequired = false;
      return true;
    } catch {
      // A sleeping laptop can regain focus before the network is usable. Keep
      // the last cookie and retry instead of turning a transient refresh error
      // into a local logout.
      jwtCookieRefreshPending = true;
      return false;
    }
  };

  const clearNFJwtCookie = () => clearCookie(NF_JWT_COOKIE);

  const localSessionId = () => {
    try { return localStorage.getItem(LOCAL_SESSION_KEY) || ''; } catch { return ''; }
  };
  const saveLocalSessionId = (sid) => {
    try { if (sid) localStorage.setItem(LOCAL_SESSION_KEY, sid); } catch {}
  };
  const clearLocalSessionId = () => { try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch {} };
  const clearLocalIdentity = () => {
    try { localStorage.removeItem(GOTRUE_STORAGE_KEY); } catch {}
  };

  const setSessionStatus = (next) => {
    lastSessionStatus = {
      ok: Boolean(next && next.ok),
      verified: Boolean(next && next.verified),
      active: Boolean(next && next.active),
      reason: next && typeof next.reason === 'string' ? next.reason : 'unknown',
      checkedAt: new Date().toISOString()
    };
    dispatchAuthEvent('chem-auth-session', { ...lastSessionStatus });
    return { ...lastSessionStatus };
  };

  const redirectToLoginWithParam = (key) => {
    if (redirectInProgress) return;
    redirectInProgress = true;
    try {
      const target = new URL(LOGIN_PATH, location.origin);
      if (key) target.searchParams.set(key, '1');
      const returnTo = safeAppReturnTo(`${location.pathname}${location.search}`);
      if (returnTo) target.searchParams.set('returnTo', returnTo);
      location.replace(target.pathname + target.search);
    } catch {
      const fallback = key ? `${LOGIN_PATH}?${key}=1` : LOGIN_PATH;
      location.replace(fallback);
    }
  };

  const logoutAsInactive = async () => {
    // Local invalidation is intentional. Calling GoTrue logout here could
    // revoke refresh tokens belonging to the newly active device as well.
    clearNFJwtCookie();
    clearLocalSessionId();
    clearLocalIdentity();
    setSessionStatus({ ok: false, verified: true, active: false, reason: 'inactive' });
    dispatchAuthEvent('chem-auth-user-changed', { authenticated: false, profile: null });
    redirectToLoginWithParam('inactive');
  };

  const fetchServerUser = async (user) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId = null;
    try {
      const request = (async () => {
        const token = await user.jwt();
        const res = await fetch('/.netlify/identity/user', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          ...(controller ? { signal: controller.signal } : {})
        });
        if (!res.ok) throw new Error('user fetch failed');
        const serverUser = await res.json();
        const tokenPayload = jwtPayloadFrom(token);
        return {
          serverUser,
          tokenPayload,
          // A decoded, Identity-accepted JWT is a more reliable view than the
          // widget's in-memory user object, which can lag after sleep/refresh.
          tokenSessionId: tokenPayload ? sessionIdFrom(tokenPayload) : sessionIdFrom(user)
        };
      });

      const timeout = new Promise((resolve) => {
        timeoutId = window.setTimeout(() => {
          if (controller) controller.abort();
          resolve(null);
        }, IDENTITY_REQUEST_TIMEOUT_MS);
      });

      return await Promise.race([request(), timeout]);
    } catch {
      return null;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  };

  const ensureFreshUserState = async (user, { enforceLogout = false } = {}) => {
    if (!user) return { active: false, user: null, serverUser: null, serverRoles: [], tokenSessionId: '' };
    const serverState = await fetchServerUser(user);
    const serverUser = serverState ? serverState.serverUser : null;
    const tokenSessionId = serverState ? serverState.tokenSessionId : '';
    const tokenRoles = serverState && serverState.tokenPayload
      ? getRoles(serverState.tokenPayload)
      : getRoles(user);
    let serverRoles = serverUser ? getRoles(serverUser) : null;
    const now = Date.now();
    const serverTimedState = timedAccessState(serverUser);
    const timedExpired = Boolean(
      serverTimedState.role &&
      serverTimedState.expiresAt &&
      serverTimedState.expiresAt <= now
    );

    if (Array.isArray(serverRoles)) {
      const timedRolePresent = Boolean(
        serverTimedState.role &&
        serverRoles.includes(serverTimedState.role)
      );
      const shouldDropInjectedActive = Boolean(
        serverTimedState.injectedActive &&
        (!timedRolePresent || timedExpired)
      );
      if (timedExpired || !timedRolePresent || shouldDropInjectedActive) {
        let adjustedRoles = serverRoles;
        if (timedRolePresent) {
          adjustedRoles = adjustedRoles.filter((role) => role !== serverTimedState.role);
        }
        if (shouldDropInjectedActive) {
          adjustedRoles = adjustedRoles.filter((role) => role !== 'active');
        }
        if (!rolesEqual(adjustedRoles, serverRoles)) {
          serverRoles = adjustedRoles;
        }
        if (serverUser && serverUser.app_metadata) {
          const appMeta = Object.assign({}, serverUser.app_metadata);
          appMeta.roles = Array.isArray(serverRoles) ? [...serverRoles] : [];
          if ((timedExpired || !timedRolePresent) && appMeta.timed_access && typeof appMeta.timed_access === 'object') {
            appMeta.timed_access = Object.assign({}, appMeta.timed_access, { active: false });
          }
          serverUser.app_metadata = appMeta;
        }
      }
    }

    if (Array.isArray(serverRoles) && !rolesEqual(serverRoles, getRoles(user))) {
      const appMeta = Object.assign({}, user.app_metadata || {});
      appMeta.roles = serverRoles;
      user.app_metadata = appMeta;
    }
    if (Array.isArray(serverRoles) && !rolesEqual(serverRoles, tokenRoles)) {
      // A canonical role change is the exceptional case that really requires
      // a refreshed JWT before updating Netlify's role cookie.
      jwtClaimsRefreshRequired = true;
    }

    const hasTimedField = serverUser && serverUser.app_metadata && Object.prototype.hasOwnProperty.call(serverUser.app_metadata, 'timed_access');
    if (hasTimedField) {
      const serverTimedMeta = serverUser.app_metadata.timed_access;
      const appMeta = Object.assign({}, user.app_metadata || {});
      const currentTimedMeta = appMeta.timed_access;
      if (!timedAccessEqual(currentTimedMeta, serverTimedMeta)) {
        if (serverTimedMeta === null || typeof serverTimedMeta === 'undefined') {
          if (Object.prototype.hasOwnProperty.call(appMeta, 'timed_access')) delete appMeta.timed_access;
        } else {
          appMeta.timed_access = serverTimedMeta;
        }
        user.app_metadata = appMeta;
      }
    }

    if (!hasTimedField && user && user.app_metadata && Object.prototype.hasOwnProperty.call(user.app_metadata, 'timed_access')) {
      const appMeta = Object.assign({}, user.app_metadata);
      delete appMeta.timed_access;
      user.app_metadata = appMeta;
    }

    const timedRolePresentAfter = Boolean(
      serverTimedState.role &&
      Array.isArray(serverRoles) &&
      serverRoles.includes(serverTimedState.role)
    );

    const serverTimedActive = Boolean(
      serverTimedState.role &&
      serverTimedState.expiresAt > now &&
      timedRolePresentAfter
    );

    const hasAdminRole = Array.isArray(serverRoles) && serverRoles.includes('admin');
    let hasActiveRoleFlag = Array.isArray(serverRoles) && serverRoles.includes('active');
    if (hasActiveRoleFlag && !hasAdminRole && serverTimedState.injectedActive && (timedExpired || !timedRolePresentAfter)) {
      hasActiveRoleFlag = false;
    }

    const active = serverRoles
      ? (hasAdminRole || serverTimedActive || hasActiveRoleFlag)
      : isActiveUser(user);
    if (!active) {
      if (enforceLogout) await logoutAsInactive();
      return { active: false, user: null, serverUser, serverRoles: serverRoles || [], tokenSessionId };
    }

    return { active: true, user, serverUser, serverRoles: serverRoles || getRoles(user), tokenSessionId };
  };

  const handleSessionMismatch = async (reason = 'session_mismatch', serverSid = '') => {
    // Another tab may have completed the current login while this tab was
    // waiting for /identity/user. Never let the stale tab erase the newer
    // shared GoTrue/local session.
    if (serverSid && localSessionId() === serverSid) return false;
    clearNFJwtCookie();
    clearLocalSessionId();
    clearLocalIdentity();
    setSessionStatus({ ok: false, verified: true, active: false, reason });
    dispatchAuthEvent('chem-auth-user-changed', { authenticated: false, profile: null });
    redirectToLoginWithParam('loggedout');
    return true;
  };

  const ensureAuthenticatedOrRedirect = async () => {
    const user = getUser();
    if (!user) {
      setSessionStatus({ ok: false, verified: false, active: false, reason: 'no_user' });
      redirectToLoginWithParam();
      return false;
    }

    const session = await checkSingleSessionOrLogout();
    if (!session.ok) return false;
    const cookieReady = await setNFJwtCookie(getUser() || user);
    if (!cookieReady) {
      // Do not discard an otherwise verified session only because the machine
      // woke before Wi-Fi (or another tab's refresh) became ready.
      setSessionStatus({ ok: true, verified: session.verified, active: true, reason: 'token_refresh_pending' });
    }
    return Boolean(getUser() || user);
  };

  const performSessionCheck = async () => {
    const user = getUser();
    if (!user) return setSessionStatus({ ok: false, verified: false, active: false, reason: 'no_user' });

    try {
      // An inactive but authenticated account must remain signed in on the
      // purchase and payment-return screens so Checkout can be assigned to it.
      const state = await ensureFreshUserState(user, {
        enforceLogout: !isLoginPage() && !isPaymentReturnPage() && !isPurchasePage()
      });
      if (!state.active) return setSessionStatus({ ok: false, verified: Boolean(state.serverUser), active: false, reason: 'inactive' });

      const serverUser = state.serverUser;
      if (!serverUser) {
        return setSessionStatus({ ok: true, verified: false, active: true, reason: 'server_unavailable' });
      }

      const serverSid = sessionIdFrom(serverUser);
      const localSid = localSessionId();
      const tokenSid = state.tokenSessionId;
      const clientSid = tokenSid || localSid;

      if (serverSid && !clientSid) {
        const invalidated = await handleSessionMismatch('session_missing', serverSid);
        if (!invalidated) {
          return setSessionStatus({ ok: true, verified: true, active: true, reason: 'ok' });
        }
        return { ...lastSessionStatus };
      }
      if (serverSid && tokenSid !== serverSid && localSid !== serverSid) {
        const invalidated = await handleSessionMismatch('session_mismatch', serverSid);
        if (!invalidated) {
          return setSessionStatus({ ok: true, verified: true, active: true, reason: 'ok' });
        }
        return { ...lastSessionStatus };
      }
      if (serverSid && tokenSid !== serverSid && localSid === serverSid) {
        jwtClaimsRefreshRequired = true;
      }
      if (serverSid && tokenSid === serverSid && localSid !== serverSid) saveLocalSessionId(serverSid);
      if (!serverSid && tokenSid && !localSid) saveLocalSessionId(tokenSid);

      return setSessionStatus({
        ok: true,
        verified: Boolean(serverSid),
        active: true,
        reason: serverSid ? 'ok' : 'session_not_configured'
      });
    } catch {
      const active = isActiveUser(user);
      return setSessionStatus({ ok: active, verified: false, active, reason: 'check_failed' });
    }
  };

  const checkSingleSessionOrLogout = () => {
    if (credentialUpdateInProgress) {
      const user = getUser();
      return Promise.resolve({
        ok: Boolean(user && isActiveUser(user)),
        verified: false,
        active: Boolean(user && isActiveUser(user)),
        reason: 'credentials_updating',
        checkedAt: new Date().toISOString()
      });
    }
    if (sessionCheckInFlight) return sessionCheckInFlight;
    sessionCheckInFlight = performSessionCheck().finally(() => {
      sessionCheckInFlight = null;
    });
    return sessionCheckInFlight;
  };

  const startSessionMonitor = () => {
    if (sessionMonitorId || isLoginPage()) return;
    const rescan = () => {
      // Hidden tabs share the same GoTrue/localStorage session. Let the visible
      // tab refresh it, avoiding a refresh-token stampede after sleep/wake.
      if (document.hidden) return;
      checkSingleSessionOrLogout()
        .then((session) => {
          if (session.ok && (jwtCookieRefreshPending || jwtClaimsRefreshRequired)) {
            return setNFJwtCookie(getUser());
          }
          return null;
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rescan(); });
    window.addEventListener('focus', rescan);
    window.addEventListener('online', rescan);
    window.addEventListener('pageshow', rescan);
    sessionMonitorId = window.setInterval(rescan, SESSION_CHECK_INTERVAL_MS);
  };

  const onMembersPageInit = async () => {
    const ok = await ensureAuthenticatedOrRedirect();
    if (!ok) return;
    startSessionMonitor();
  };

  const onLoginPageInit = async () => {
    let identityFlowInQuery = Boolean(window.__CHEM_IDENTITY_FLOW_ACTIVE__);
    try {
      const qp = new URLSearchParams(location.search || '');
      if (qp.get('flow')) identityFlowInQuery = true;
      if (qp.has('token') || qp.has('error') || qp.has('error_description')) identityFlowInQuery = true;
    } catch {}

    // If already logged and active, jump to members (unless handling a special flow)
    const user = getUser();
    if (!identityFlowInQuery && user) {
      const session = await checkSingleSessionOrLogout();
      if (session.ok) {
        const cookieReady = await setNFJwtCookie(getUser() || user);
        if (cookieReady) {
          location.replace(getReturnTo());
        } else {
          setSessionStatus({ ok: false, verified: session.verified, active: true, reason: 'token_unavailable' });
          const flashBox = document.getElementById('flash');
          if (flashBox) {
            flashBox.textContent = 'Nie udało się odświeżyć sesji. Zaloguj się ponownie.';
            flashBox.className = 'flash error';
          }
        }
      } else {
        return;
      }
    }

    // Show informational messages based on query params
    try {
      const p = new URLSearchParams(location.search);
      const flashBox = document.getElementById('flash');
      if (flashBox) {
        if (p.has('inactive')) {
          flashBox.textContent = 'Konto nie ma aktywnego pakietu. Zaloguj się i wybierz dostęp.';
          flashBox.className = 'flash warn';
        }
        if (p.has('loggedout')) {
          flashBox.textContent = 'Poprzednia sesja została zakończona. Mogło nastąpić logowanie na innym urządzeniu.';
          flashBox.className = 'flash';
        }
        if (p.has('sessionerror')) {
          flashBox.textContent = 'Nie udało się odświeżyć sesji. Zaloguj się ponownie.';
          flashBox.className = 'flash error';
        }
      }
    } catch {}
  };

  const logout = async (options = {}) => {
    const shouldRedirect = !options || options.redirect !== false;
    try {
      await ID.logout();
    } finally {
      clearNFJwtCookie();
      clearLocalSessionId();
      clearLocalIdentity();
      setSessionStatus({ ok: false, verified: true, active: false, reason: 'logged_out' });
      dispatchAuthEvent('chem-auth-user-changed', { authenticated: false, profile: null });
      if (shouldRedirect) redirectToLoginWithParam('loggedout');
    }
    return true;
  };

  const getSessionStatus = () => ({ ...lastSessionStatus });

  const markAuthReady = () => {
    if (authReadySettled) return;
    authReadySettled = true;
    const user = getUser();
    const detail = {
      available: true,
      authenticated: Boolean(user),
      profile: profileFromUser(user),
      session: getSessionStatus()
    };
    resolveAuthReady(detail);
    dispatchAuthEvent('chem-auth-ready', detail);
  };

  // Public dashboard contract. `ready` resolves once initial Identity/session
  // checks finish. The same payload is emitted in the `chem-auth-ready` event.
  window.ChemAuth = {
    ready: authReady,
    getUser,
    getProfile,
    getAccessToken,
    updateProfile,
    changePassword,
    logout,
    checkSession: checkSingleSessionOrLogout,
    getSessionStatus,
    getReturnTo
  };

  // Wire identity events to keep cookie/session in sync
  const wireIdentityEvents = () => {
    try {
      ID.on('init', (user) => {
        dispatchAuthEvent('chem-auth-user-changed', {
          authenticated: Boolean(user),
          profile: profileFromUser(user)
        });
      });
    } catch {}
    try {
      ID.on('login', async (user) => {
        const sid = sessionIdFrom(user);
        if (sid) saveLocalSessionId(sid);
        const session = await checkSingleSessionOrLogout();
        if (!session.ok) return;
        const current = getUser() || user;
        await setNFJwtCookie(current);
        dispatchAuthEvent('chem-auth-user-changed', {
          authenticated: true,
          profile: profileFromUser(current)
        });
      });
    } catch {}
    try {
      ID.on('logout', () => {
        clearNFJwtCookie();
        clearLocalSessionId();
        clearLocalIdentity();
        setSessionStatus({ ok: false, verified: true, active: false, reason: 'logged_out' });
        dispatchAuthEvent('chem-auth-user-changed', { authenticated: false, profile: null });
      });
    } catch {}
    try {
      ID.on('tokenExpired', async () => {
        // Only the visible tab refreshes the shared browser session. Hidden
        // tabs reconcile when they become visible.
        if (document.hidden) return;
        const user = getUser();
        if (user) {
          const session = await checkSingleSessionOrLogout();
          if (session.ok) {
            try { await setNFJwtCookie(getUser()); } catch {}
          }
        }
      });
    } catch {}
  };

  // Bind before DOMContentLoaded: some pages also initialize the widget in an
  // inline DOMContentLoaded handler.
  wireIdentityEvents();

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // netlify-identity-widget initializes itself on DOMContentLoaded. Calling
      // init() again would append a second widget iframe and duplicate events.
      if (isMembersPage()) {
        await onMembersPageInit();
      } else if (isLoginPage()) {
        await onLoginPageInit();
      } else {
        const user = getUser();
        if (user) {
          const session = await checkSingleSessionOrLogout();
          if (!session.ok) return;
          await setNFJwtCookie(getUser() || user);
          startSessionMonitor();
        }
      }
    } finally {
      markAuthReady();
    }
  });
})();
