(() => {
  'use strict';

  // The editor must show exactly the label currently being edited.
  if (new URLSearchParams(location.search).get('landing-preview') === '1' && window.parent !== window) return;

  // A local presentation hint only. The protected course still validates the
  // canonical session and permissions; this file never refreshes or sends tokens.
  const cacheKey = 'gotrue.user';
  const originals = new WeakMap();
  let knownState = null;

  function localSessionHint() {
    try {
      if (window.ChemAuth?.getUser) { if (window.ChemAuth.getUser()) return true; }
      if (window.netlifyIdentity?.currentUser) { if (window.netlifyIdentity.currentUser()) return true; }
      // Routing hint only; members still verifies the signed cookie and account.
      const jwt = document.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('nf_jwt='))?.slice(7);
      if (jwt) {
        try {
          const payload = JSON.parse(window.atob(decodeURIComponent(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (typeof payload.sub === 'string' && payload.sub && Number.isFinite(payload.exp) && payload.exp * 1000 > Date.now()) return true;
        } catch (_) {}
      }
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw || raw.length > 100_000) return false;
      const user = JSON.parse(raw);
      if (!user || typeof user.id !== 'string' || !user.id.trim()) return false;
      if (typeof user.url !== 'string') return false;
      const identity = new URL(user.url);
      if (identity.origin !== location.origin || identity.pathname.replace(/\/$/, '') !== '/.netlify/identity') return false;
      const token = user.token;
      if (!token || typeof token.access_token !== 'string' || !token.access_token.trim()) return false;
      // An expired access token can still belong to a renewable, local session.
      // Actual renewal happens only when the visitor opens the protected course.
      return (typeof token.refresh_token === 'string' && Boolean(token.refresh_token.trim()))
        || (Number.isFinite(token.expires_at) && token.expires_at > Date.now());
    } catch { return false; }
  }

  function apply() {
    const signedIn = knownState === null ? localSessionHint() : knownState;
    for (const id of ['login-btn', 'login-cta']) {
      const link = document.getElementById(id);
      if (!link || link.hidden) continue;
      const href = link.getAttribute('href');
      let target;
      try { target = new URL(href || '', location.origin); } catch { continue; }
      if (!href || target.origin !== location.origin || !/^\/(?:members|login)\/?$/.test(target.pathname)) continue;
      let saved = originals.get(link);
      if (!saved || (link.textContent !== saved.renderedText || href !== saved.renderedHref)) {
        saved = { text: link.textContent, href };
        originals.set(link, saved);
      }
      const text = signedIn ? 'Przejdź do kursu' : saved.text;
      const destination = signedIn ? '/members/' : saved.href;
      link.textContent = text;
      link.setAttribute('href', destination);
      saved.renderedText = text;
      saved.renderedHref = destination;
    }
  }

  function acceptState(event) {
    if (typeof event?.detail?.authenticated !== 'boolean') return;
    knownState = event.detail.authenticated;
    apply();
  }
  window.addEventListener('chem-auth-user-changed', acceptState);
  window.addEventListener('chem-auth-ready', acceptState);
  window.addEventListener('storage', (event) => {
    if (event.key !== cacheKey && event.key !== null) return;
    knownState = null;
    apply();
  });
  window.addEventListener('pageshow', () => { knownState = null; apply(); });
  document.addEventListener('chemdisk-landing-applied', apply);
  if (window.ChemAuth?.ready?.then) {
    window.ChemAuth.ready.then((state) => acceptState({ detail: state })).catch(() => {});
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('#login-btn, #login-cta');
    if (!link) return;
    knownState = null;
    apply();
  }, true);
  apply();
})();
