(function () {
  'use strict';

  const STATUS_URL = '/.netlify/functions/payment-status';
  const MAX_ATTEMPTS = 10;

  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  function sessionIdFromAddress() {
    try {
      return new URLSearchParams(location.search || '').get('session_id') || '';
    } catch {
      return '';
    }
  }

  function setState(type, title, message) {
    const mark = document.getElementById('success-mark');
    document.getElementById('success-title').textContent = title;
    document.getElementById('success-status').textContent = message;
    mark.className = `success-mark${type ? ` is-${type}` : ''}`;
    mark.textContent = type === 'complete' ? '✓' : type === 'error' ? '!' : '···';
  }

  async function setFreshAccessCookie() {
    const identity = window.netlifyIdentity;
    if (identity && typeof identity.refresh === 'function') await identity.refresh();
    const user = identity && typeof identity.currentUser === 'function' ? identity.currentUser() : null;
    if (!user || typeof user.jwt !== 'function') return false;
    const token = await user.jwt(true);
    if (!token) return false;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `nf_jwt=${token}; Path=/; SameSite=Lax${secure}`;
    const sid = user.app_metadata && user.app_metadata.session_id;
    if (sid) {
      try { localStorage.setItem('chem_session_id', sid); } catch (_) {}
    }
    return true;
  }

  async function verifyPayment(sessionId, token) {
    const response = await fetch(`${STATUS_URL}?session_id=${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (response.status === 202) return { pending: true };
    if (!response.ok || !payload) {
      const code = payload && payload.error;
      const messages = {
        AUTH_REQUIRED: 'Sesja wygasła. Zaloguj się ponownie i wróć do potwierdzenia płatności.',
        CHECKOUT_SESSION_FORBIDDEN: 'Ta płatność należy do innego konta.',
        INVALID_CHECKOUT_SESSION: 'Identyfikator płatności jest nieprawidłowy.',
        STRIPE_NOT_CONFIGURED: 'Stripe nie jest jeszcze poprawnie skonfigurowany.'
      };
      throw new Error(messages[code] || 'Nie udało się potwierdzić płatności. Jeśli środki zostały pobrane, nie płać ponownie — odśwież tę stronę lub skontaktuj się z administratorem.');
    }
    return payload;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const sessionId = sessionIdFromAddress();
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9_]{8,240}$/.test(sessionId)) {
      setState('error', 'Brak danych płatności', 'Otwórz tę stronę przez przekierowanie po zakończeniu Stripe Checkout.');
      return;
    }

    try {
      const auth = window.ChemAuth;
      if (!auth || !auth.ready) throw new Error('Moduł konta jest niedostępny.');
      const ready = await auth.ready;
      if (!ready || !ready.authenticated) throw new Error('Zaloguj się ponownie, aby przypisać płatność do konta.');

      let result = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const token = await auth.getAccessToken({ forceRefresh: attempt > 0 });
        result = await verifyPayment(sessionId, token);
        if (!result.pending) break;
        document.getElementById('success-status').textContent = 'Płatność jest jeszcze przetwarzana. Sprawdzamy ponownie…';
        await wait(1_500);
      }
      if (!result || result.pending) throw new Error('Stripe nadal przetwarza płatność. Odśwież tę stronę za chwilę.');

      await setFreshAccessCookie();
      const details = document.getElementById('success-details');
      const expires = result.access && result.access.expiresAt
        ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(result.access.expiresAt))
        : '';
      details.textContent = expires ? `Dostęp jest aktywny do ${expires}.` : 'Dostęp został aktywowany.';
      details.hidden = false;
      document.getElementById('success-primary').hidden = false;
      setState('complete', 'Płatność zakończona', 'Pakiet został dopisany do Twojego konta. Możesz już przejść do kursu.');
    } catch (error) {
      setState('error', 'Nie udało się zakończyć aktywacji', error && error.message ? error.message : 'Odśwież stronę lub skontaktuj się z administratorem.');
    }
  }, { once: true });
})();
