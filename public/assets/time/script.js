(function () {
  'use strict';

  const TIMED_ROLES = new Set(['hour', 'day', 'week', 'month', 'halfyear', 'year']);
  const ROLE_LABELS = {
    hour: 'Dostęp na godzinę',
    day: 'Dostęp na 1 dzień',
    week: 'Dostęp na 7 dni',
    month: 'Dostęp na 1 miesiąc',
    halfyear: 'Dostęp na 6 miesięcy',
    year: 'Dostęp na 12 miesięcy'
  };
  const SUPPORT_HREF = 'mailto:kochamchemie2023@gmail.com?subject=Pomoc%20ze%20statusem%20dost%C4%99pu';
  const SESSION_REFRESH_INTERVAL_MS = 30000;

  const DATE_FORMATTER = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const parseTimestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };

  const timedAccessState = (user) => {
    const meta = user && user.app_metadata ? user.app_metadata.timed_access : undefined;
    const rawRole = meta && typeof meta.role === 'string' ? meta.role.trim() : '';
    const role = rawRole && TIMED_ROLES.has(rawRole) ? rawRole : '';
    return {
      role,
      assignedAt: meta ? parseTimestamp(meta.assigned_at) : 0,
      expiresAt: meta ? parseTimestamp(meta.expires_at) : 0,
      injectedActive: Boolean(meta && meta.injected_active)
    };
  };

  const normalizeName = (value) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
    : '';

  const profileFromUser = (user) => {
    const meta = user && user.user_metadata && typeof user.user_metadata === 'object'
      ? user.user_metadata
      : {};
    const firstName = normalizeName(meta.first_name || meta.firstName || meta.given_name);
    const lastName = normalizeName(meta.last_name || meta.lastName || meta.family_name);
    const fullName = normalizeName(meta.full_name || meta.name || [firstName, lastName].filter(Boolean).join(' '));
    const email = normalizeName(user && user.email);
    const displayName = fullName || email || 'Twoje konto';
    const nameParts = (fullName || email || 'U').split(/[\s@._-]+/).filter(Boolean);
    const initials = nameParts.length > 1
      ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`
      : (nameParts[0] || 'U').slice(0, 2);
    return { displayName, email, initials: initials.toUpperCase() };
  };

  const formatUnit = (value, forms) => {
    const abs = Math.abs(value) % 100;
    const mod10 = abs % 10;
    if (abs === 1) return forms[0];
    if (abs >= 12 && abs <= 14) return forms[2];
    if (mod10 >= 2 && mod10 <= 4) return forms[1];
    return forms[2];
  };

  const formatDuration = (milliseconds) => {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const values = [
      [days, ['dzień', 'dni', 'dni']],
      [hours, ['godzina', 'godziny', 'godzin']],
      [minutes, ['minuta', 'minuty', 'minut']],
      [seconds, ['sekunda', 'sekundy', 'sekund']]
    ];
    const parts = values
      .filter(([value], index) => value > 0 || index === values.length - 1)
      .map(([value, forms]) => `${value} ${formatUnit(value, forms)}`);
    return parts.join(' ');
  };

  const dateText = (timestamp) => timestamp ? DATE_FORMATTER.format(new Date(timestamp)) : 'Brak danych';
  const pad = (value) => String(value).padStart(2, '0');

  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.getElementById('access-content');
    const statusEl = document.getElementById('status');
    const titleEl = document.getElementById('page-title');
    const stateLabelEl = document.getElementById('state-label');
    const detailsEl = document.getElementById('details');
    const roleEl = document.getElementById('role');
    const accessChipEl = document.getElementById('access-chip');
    const countdownPanelEl = document.getElementById('countdown-panel');
    const countdownReadableEl = document.getElementById('countdown-readable');
    const expiresLabelEl = document.getElementById('expires-label');
    const expiresEl = document.getElementById('expires');
    const assignedRowEl = document.getElementById('assigned-row');
    const assignedEl = document.getElementById('assigned');
    const progressWrapEl = document.getElementById('progress-wrap');
    const progressTrackEl = document.getElementById('progress-track');
    const progressBarEl = document.getElementById('progress-bar');
    const progressLabelEl = document.getElementById('progress-label');
    const accountStripEl = document.getElementById('account-strip');
    const accountAvatarEl = document.getElementById('account-avatar');
    const accountNameEl = document.getElementById('account-name');
    const accountEmailEl = document.getElementById('account-email');
    const primaryActionEl = document.getElementById('primary-action');
    const supportActionEl = document.getElementById('support-action');
    const unitEls = {
      days: document.getElementById('countdown-days'),
      hours: document.getElementById('countdown-hours'),
      minutes: document.getElementById('countdown-minutes'),
      seconds: document.getElementById('countdown-seconds')
    };

    let countdownTimer = null;
    let sessionRefreshTimer = null;
    let sessionRefreshInFlight = null;
    let renderedUser = null;

    const stopTimer = () => {
      if (countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
    };

    const stopSessionRefresh = () => {
      if (sessionRefreshTimer !== null) {
        window.clearInterval(sessionRefreshTimer);
        sessionRefreshTimer = null;
      }
    };

    const setState = (state, label, title, message) => {
      document.body.dataset.state = state;
      page.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
      stateLabelEl.textContent = label;
      titleEl.textContent = title;
      statusEl.textContent = message;
    };

    const showAccount = (user) => {
      if (!user) {
        accountStripEl.hidden = true;
        return;
      }
      const profile = profileFromUser(user);
      accountNameEl.textContent = profile.displayName;
      accountEmailEl.textContent = profile.email;
      accountAvatarEl.textContent = profile.initials;
      accountStripEl.hidden = false;
    };

    const setActions = (primaryLabel, primaryHref, showSupport = true) => {
      primaryActionEl.textContent = primaryLabel;
      primaryActionEl.href = primaryHref;
      supportActionEl.hidden = !showSupport;
    };

    const updateProgress = (assignedAt, expiresAt, now) => {
      if (!assignedAt || !expiresAt || assignedAt >= expiresAt) {
        progressWrapEl.hidden = true;
        return;
      }
      const percentage = Math.max(0, Math.min(100, ((now - assignedAt) / (expiresAt - assignedAt)) * 100));
      const rounded = Math.round(percentage);
      progressWrapEl.hidden = false;
      progressBarEl.style.width = `${percentage}%`;
      progressLabelEl.textContent = `${rounded}%`;
      progressTrackEl.setAttribute('aria-valuenow', String(rounded));
    };

    const updateCountdownUnits = (milliseconds) => {
      const total = Math.max(0, Math.floor(milliseconds / 1000));
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      unitEls.days.textContent = pad(days);
      unitEls.hours.textContent = pad(hours);
      unitEls.minutes.textContent = pad(minutes);
      unitEls.seconds.textContent = pad(seconds);
      countdownReadableEl.textContent = formatDuration(milliseconds);
    };

    const showExpired = (timed) => {
      stopTimer();
      setState(
        'expired',
        'Dostęp zakończony',
        'Twój dostęp wygasł',
        timed.expiresAt
          ? `Pakiet zakończył się ${formatDuration(Date.now() - timed.expiresAt)} temu.`
          : 'Okres ważności tego pakietu dobiegł końca.'
      );
      roleEl.textContent = ROLE_LABELS[timed.role] || 'Dostęp czasowy';
      accessChipEl.textContent = 'Wygasł';
      countdownPanelEl.hidden = true;
      assignedRowEl.hidden = !timed.assignedAt;
      assignedEl.textContent = dateText(timed.assignedAt);
      expiresLabelEl.textContent = 'Wygasł';
      expiresEl.textContent = dateText(timed.expiresAt);
      updateProgress(timed.assignedAt, timed.expiresAt, Date.now());
      detailsEl.hidden = false;
      setActions('Napisz w sprawie dostępu', SUPPORT_HREF, false);
    };

    const showTimed = (timed) => {
      roleEl.textContent = ROLE_LABELS[timed.role] || timed.role;
      accessChipEl.textContent = 'Aktywny';
      countdownPanelEl.hidden = false;
      assignedRowEl.hidden = !timed.assignedAt;
      assignedEl.textContent = dateText(timed.assignedAt);
      expiresLabelEl.textContent = 'Wygasa';
      expiresEl.textContent = dateText(timed.expiresAt);
      detailsEl.hidden = false;
      setActions('Przejdź do materiałów', '/members/');

      const update = () => {
        const now = Date.now();
        const remaining = timed.expiresAt - now;
        if (remaining <= 0) {
          showExpired(timed);
          return;
        }
        setState(
          'timed',
          'Dostęp czasowy',
          'Twój pakiet jest aktywny',
          'Możesz korzystać ze wszystkich materiałów przypisanych do Twojego konta.'
        );
        updateCountdownUnits(remaining);
        updateProgress(timed.assignedAt, timed.expiresAt, now);
      };

      update();
      countdownTimer = window.setInterval(update, 1000);
    };

    const showResult = (user) => {
      stopTimer();
      renderedUser = user || null;
      showAccount(user);
      detailsEl.hidden = true;
      progressWrapEl.hidden = true;
      countdownPanelEl.hidden = false;

      if (!user) {
        setState(
          'no-access',
          'Wymagane logowanie',
          'Zaloguj się do konta',
          'Po zalogowaniu pokażemy rodzaj pakietu i pozostały czas dostępu.'
        );
        setActions('Przejdź do logowania', '/login/?returnTo=/time', false);
        return;
      }

      const roles = user.app_metadata && Array.isArray(user.app_metadata.roles)
        ? user.app_metadata.roles
        : [];
      const timed = timedAccessState(user);
      const hasPermanentAccess = roles.includes('admin') || (roles.includes('active') && !timed.injectedActive);

      if (hasPermanentAccess) {
        setState(
          'permanent',
          roles.includes('admin') ? 'Konto administratora' : 'Stały dostęp',
          'Masz stały dostęp',
          'Twój pakiet nie ma daty wygaśnięcia. Możesz bez ograniczeń korzystać z przypisanych materiałów.'
        );
        setActions('Przejdź do materiałów', '/members/', false);
        return;
      }

      if (timed.role && timed.expiresAt && timed.expiresAt <= Date.now()) {
        showExpired(timed);
        return;
      }

      if (timed.role && roles.includes(timed.role) && timed.expiresAt > Date.now()) {
        showTimed(timed);
        return;
      }

      setState(
        'no-access',
        'Brak aktywnego pakietu',
        'Nie masz obecnie dostępu',
        'Na tym koncie nie ma aktywnej roli kursanta. Jeśli pakiet został już opłacony, skontaktuj się z nami.'
      );
      setActions('Napisz w sprawie dostępu', SUPPORT_HREF, false);
    };

    const showUnavailable = () => {
      stopTimer();
      detailsEl.hidden = true;
      setState(
        'unavailable',
        'Problem z połączeniem',
        'Nie udało się sprawdzić dostępu',
        'Moduł konta jest chwilowo niedostępny. Odśwież stronę i spróbuj ponownie.'
      );
      setActions('Odśwież stronę', window.location.href, true);
    };

    if (typeof netlifyIdentity === 'undefined') {
      showUnavailable();
      return;
    }

    netlifyIdentity.on('init', (user) => showResult(user));
    netlifyIdentity.on('login', (user) => showResult(user));
    netlifyIdentity.on('logout', () => showResult(null));

    const refreshSessionView = () => {
      if (sessionRefreshInFlight || document.hidden) return sessionRefreshInFlight;
      const auth = window.ChemAuth;
      if (!auth || typeof auth.checkSession !== 'function') return null;
      sessionRefreshInFlight = Promise.resolve()
        .then(() => auth.checkSession())
        .then((session) => {
          const user = typeof auth.getUser === 'function' ? auth.getUser() : netlifyIdentity.currentUser();
          showResult(session && session.ok ? user : null);
        })
        .catch(() => {
          const user = typeof auth.getUser === 'function' ? auth.getUser() : netlifyIdentity.currentUser();
          if (user) showResult(user);
        })
        .finally(() => { sessionRefreshInFlight = null; });
      return sessionRefreshInFlight;
    };

    window.addEventListener('chem-auth-user-changed', (event) => {
      const authenticated = Boolean(event && event.detail && event.detail.authenticated);
      const auth = window.ChemAuth;
      const user = authenticated && auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
      showResult(user);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshSessionView();
    });
    window.addEventListener('pagehide', () => {
      stopTimer();
      stopSessionRefresh();
    }, { once: true });

    try {
      const authState = window.ChemAuth && window.ChemAuth.ready
        ? await window.ChemAuth.ready
        : null;
      const user = window.ChemAuth && typeof window.ChemAuth.getUser === 'function'
        ? window.ChemAuth.getUser()
        : netlifyIdentity.currentUser();

      if (authState && authState.available && (
        !authState.authenticated || !authState.session || !authState.session.ok
      )) {
        showResult(null);
        return;
      }
      showResult(user || renderedUser);
      sessionRefreshTimer = window.setInterval(refreshSessionView, SESSION_REFRESH_INTERVAL_MS);
    } catch {
      const fallbackUser = netlifyIdentity.currentUser();
      if (fallbackUser) showResult(fallbackUser);
      else showUnavailable();
    }
  });
})();
