(function () {
  'use strict';

  function initials(user) {
    const metadata = user && user.user_metadata && typeof user.user_metadata === 'object'
      ? user.user_metadata
      : {};
    const source = `${metadata.first_name || ''} ${metadata.last_name || ''}`.trim() ||
      metadata.full_name ||
      (user && user.email) ||
      'U';
    const parts = String(source).trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part.charAt(0).toLocaleUpperCase('pl')).join('') || 'U';
  }

  function renderAccount() {
    const auth = window.ChemAuth;
    const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
    const account = document.getElementById('purchase-account');
    const notice = document.getElementById('purchase-login-notice');
    const back = document.getElementById('back-link');

    if (!user) {
      account.hidden = true;
      notice.hidden = false;
      back.href = '/';
      back.textContent = 'Wróć na stronę główną';
      return;
    }

    const metadata = user.user_metadata && typeof user.user_metadata === 'object'
      ? user.user_metadata
      : {};
    const fullName = `${metadata.first_name || ''} ${metadata.last_name || ''}`.trim() ||
      metadata.full_name ||
      'Twoje konto';
    document.getElementById('purchase-avatar').textContent = initials(user);
    document.getElementById('purchase-name').textContent = fullName;
    document.getElementById('purchase-email').textContent = user.email || '';
    account.hidden = false;
    notice.hidden = true;
  }

  async function initialize() {
    try {
      const params = new URLSearchParams(location.search || '');
      if (params.get('checkout') === 'cancelled') {
        const message = document.getElementById('purchase-message');
        message.textContent = 'Płatność została anulowana. Nie pobrano pieniędzy — możesz wybrać pakiet ponownie.';
        message.hidden = false;
      }
    } catch (_) {}
    if (window.ChemAuth && window.ChemAuth.ready) {
      try { await window.ChemAuth.ready; } catch (_) {}
    }
    renderAccount();
    if (window.ChemPayments && typeof window.ChemPayments.renderAll === 'function') {
      window.ChemPayments.renderAll(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
  window.addEventListener('chem-auth-user-changed', renderAccount);
})();
