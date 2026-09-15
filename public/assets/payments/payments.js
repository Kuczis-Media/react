(function () {
  'use strict';

  const CONFIG_URL = '/.netlify/functions/payment-config';
  const CHECKOUT_URL = '/.netlify/functions/create-checkout';
  const CONFIG_CACHE_KEY = 'nextmed.payments.public-config.v1';
  const CONFIG_CACHE_TTL_MS = 5 * 60_000;
  const VALID_PLANS = new Set(['hour', 'day', 'week', 'month', 'halfyear', 'year']);
  const VALID_CURRENCIES = new Set(['pln', 'eur', 'usd', 'gbp', 'chf', 'czk', 'cad', 'aud']);
  const ERROR_MESSAGES = Object.freeze({
    ACTIVE_ACCESS_EXISTS: 'Masz już aktywny dostęp. Kolejny pakiet kupisz po jego wygaśnięciu.',
    AUTH_EXPIRED: 'Sesja wygasła. Zaloguj się ponownie.',
    AUTH_REQUIRED: 'Zaloguj się, aby kupić dostęp.',
    IDENTITY_ADMIN_UNAVAILABLE: 'Usługa kont jest chwilowo niedostępna.',
    INVALID_PLAN: 'Wybrany pakiet jest nieprawidłowy.',
    PAYMENT_CONFIG_INVALID: 'Konfiguracja cen jest nieprawidłowa.',
    PAYMENTS_DISABLED: 'Administrator tymczasowo wyłączył płatności.',
    PAYMENT_STORAGE_UNAVAILABLE: 'Magazyn płatności jest chwilowo niedostępny.',
    PLAN_UNAVAILABLE: 'Ten pakiet nie jest teraz dostępny. Odśwież ofertę i wybierz inny.',
    SAME_ORIGIN_REQUIRED: 'Odśwież stronę i spróbuj ponownie.',
    SESSION_REPLACED: 'To konto zalogowało się na innym urządzeniu.',
    STRIPE_CHECKOUT_FAILED: 'Stripe nie utworzył płatności. Spróbuj ponownie.',
    STRIPE_NOT_CONFIGURED: 'Płatności nie zostały jeszcze skonfigurowane przez administratora.'
  });

  let configPromise = null;
  let configLoadedAt = 0;
  let checkoutInFlight = false;

  window.addEventListener('storage', (event) => {
    // Another tab may update the offer while this tab is already fetching it.
    // Keep the shared in-flight promise; only invalidate a settled memory copy.
    if ((event.key === CONFIG_CACHE_KEY || event.key === null) && configLoadedAt !== 0) {
      configPromise = null;
      configLoadedAt = 0;
    }
  });

  function loadConfig(force) {
    const memoryAge = Date.now() - configLoadedAt;
    if (!force && configPromise && (configLoadedAt === 0 || (memoryAge >= 0 && memoryAge <= CONFIG_CACHE_TTL_MS))) {
      return configPromise;
    }
    const cached = force ? null : readCachedConfig();
    if (cached) {
      configLoadedAt = cached.savedAt;
      configPromise = Promise.resolve(cached.config);
      return configPromise;
    }
    configLoadedAt = 0;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    configPromise = fetch(CONFIG_URL, {
      method: 'GET',
      cache: force ? 'no-store' : 'default',
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    }).then(async (response) => {
      let payload = null;
      try { payload = await response.json(); } catch (_) {}
      if (!response.ok || !validPublicConfig(payload)) {
        throw new Error('Nie udało się wczytać aktualnych cen.');
      }
      configLoadedAt = Date.now();
      writeCachedConfig(payload, configLoadedAt);
      return payload;
    }).catch((error) => {
      configPromise = null;
      configLoadedAt = 0;
      throw error;
    }).finally(() => window.clearTimeout(timeout));
    return configPromise;
  }

  function readCachedConfig() {
    try {
      const entry = JSON.parse(window.localStorage.getItem(CONFIG_CACHE_KEY) || 'null');
      const savedAt = entry?.savedAt;
      const age = Date.now() - savedAt;
      if (!Number.isSafeInteger(savedAt) || age < 0 || age > CONFIG_CACHE_TTL_MS || !validPublicConfig(entry?.config)) {
        window.localStorage.removeItem(CONFIG_CACHE_KEY);
        return null;
      }
      return { config: entry.config, savedAt };
    } catch (_) {
      return null;
    }
  }

  function writeCachedConfig(config, savedAt = Date.now()) {
    if (!validPublicConfig(config)) return;
    try {
      window.localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ savedAt, config }));
    } catch (_) {}
  }

  function validPublicConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !VALID_CURRENCIES.has(value.currency)
      || !Array.isArray(value.enabledPlans)
      || !Array.isArray(value.plans)
      || value.plans.length !== VALID_PLANS.size
      || typeof value.paymentsEnabled !== 'boolean'
      || typeof value.stackingEnabled !== 'boolean'
      || typeof value.checkoutAvailable !== 'boolean'
      || typeof value.testMode !== 'boolean') return false;

    const enabled = new Set();
    for (const id of value.enabledPlans) {
      if (typeof id !== 'string' || !VALID_PLANS.has(id) || enabled.has(id)) return false;
      enabled.add(id);
    }
    const seen = new Set();
    for (const plan of value.plans) {
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)
        || typeof plan.id !== 'string' || !VALID_PLANS.has(plan.id) || seen.has(plan.id)
        || typeof plan.label !== 'string' || !plan.label || plan.label.length > 120
        || typeof plan.durationLabel !== 'string' || !plan.durationLabel || plan.durationLabel.length > 160
        || !Number.isFinite(plan.durationDays) || plan.durationDays <= 0 || plan.durationDays > 366
        || !Number.isSafeInteger(plan.amount) || plan.amount < 100 || plan.amount > 1_000_000
        || typeof plan.enabled !== 'boolean' || plan.enabled !== enabled.has(plan.id)
        || typeof plan.featured !== 'boolean') return false;
      seen.add(plan.id);
    }
    return seen.size === VALID_PLANS.size;
  }

  function formatMoney(amount, currency) {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: String(currency || 'pln').toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(Number(amount || 0) / 100);
  }

  function selectedPlanFromAddress() {
    try {
      const plan = new URLSearchParams(location.search || '').get('plan') || '';
      return VALID_PLANS.has(plan) ? plan : '';
    } catch {
      return '';
    }
  }

  function currentUser() {
    const auth = window.ChemAuth;
    return auth && typeof auth.getUser === 'function'
      ? auth.getUser()
      : window.netlifyIdentity && typeof window.netlifyIdentity.currentUser === 'function'
        ? window.netlifyIdentity.currentUser()
        : null;
  }

  function hasActiveCourseAccess(user) {
    const appMetadata = user && user.app_metadata && typeof user.app_metadata === 'object'
      ? user.app_metadata
      : {};
    const roles = Array.isArray(appMetadata.roles) ? appMetadata.roles : [];
    if (roles.includes('active')) return true;
    const timed = appMetadata.timed_access && typeof appMetadata.timed_access === 'object'
      ? appMetadata.timed_access
      : null;
    return Boolean(
      timed &&
      VALID_PLANS.has(timed.role) &&
      roles.includes(timed.role) &&
      Number.isFinite(Date.parse(timed.expires_at || '')) &&
      Date.parse(timed.expires_at) > Date.now()
    );
  }

  function renderContainer(container, config) {
    const mode = container.dataset.pricingMode || 'public';
    const compact = container.hasAttribute('data-pricing-compact');
    const selectedPlan = selectedPlanFromAddress();
    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = `chem-pricing-grid${compact ? ' is-compact' : ''}`;
    const stackingBlocked = config.stackingEnabled === false && hasActiveCourseAccess(currentUser());
    let renderedPlans = 0;

    config.plans.forEach((plan) => {
      if (!plan || !VALID_PLANS.has(plan.id) || plan.enabled === false) return;
      renderedPlans += 1;
      const card = document.createElement('article');
      card.className = `chem-price-card${plan.featured ? ' is-featured' : ''}${selectedPlan === plan.id ? ' is-selected' : ''}`;
      card.dataset.plan = plan.id;

      if (plan.featured) {
        const badge = document.createElement('span');
        badge.className = 'chem-price-badge';
        badge.textContent = 'Najczęściej wybierany';
        card.append(badge);
      }

      const label = document.createElement('h3');
      label.textContent = plan.label;
      const duration = document.createElement('p');
      duration.className = 'chem-price-duration';
      duration.textContent = plan.durationLabel;
      const price = document.createElement('p');
      price.className = 'chem-price-value';
      const amount = document.createElement('strong');
      amount.textContent = formatMoney(plan.amount, config.currency);
      const suffix = document.createElement('span');
      suffix.textContent = 'jednorazowo';
      price.append(amount, suffix);
      const feature = document.createElement('p');
      feature.className = 'chem-price-feature';
      feature.textContent = 'Pełny dostęp do wszystkich materiałów';

      const button = document.createElement('button');
      button.className = 'chem-price-button';
      button.type = 'button';
      button.dataset.checkoutPlan = plan.id;
      button.textContent = config.paymentsEnabled === false
        ? 'Płatności wyłączone'
        : config.checkoutAvailable
          ? (mode === 'public' ? 'Wybieram pakiet' : 'Kup i przedłuż dostęp')
          : 'Płatności w przygotowaniu';
      button.disabled = !config.checkoutAvailable || stackingBlocked;
      button.addEventListener('click', () => startCheckout(plan.id, button, container));

      card.append(label, duration, price, feature, button);
      grid.append(card);
    });

    if (!renderedPlans) {
      const empty = document.createElement('p');
      empty.className = 'chem-pricing-load-error';
      empty.textContent = 'Administrator chwilowo nie udostępnia żadnego pakietu.';
      fragment.append(empty);
    } else {
      fragment.append(grid);
    }

    const status = document.createElement('p');
    status.className = 'chem-pricing-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.dataset.pricingStatus = 'true';
    fragment.append(status);

    if (config.testMode) {
      const testNote = document.createElement('p');
      testNote.className = 'chem-test-card';
      testNote.innerHTML = '<strong>Tryb testowy Stripe:</strong> karta <code>4242 4242 4242 4242</code>, dowolna przyszła data i dowolne 3 cyfry CVC.';
      fragment.append(testNote);
    }

    if (config.paymentsEnabled === false) {
      const disabledNote = document.createElement('p');
      disabledNote.className = 'chem-pricing-disabled';
      disabledNote.textContent = 'Płatności są obecnie wyłączone przez administratora. Wróć później lub skontaktuj się z obsługą kursu.';
      fragment.append(disabledNote);
    }

    const stacking = document.createElement('p');
    stacking.className = 'chem-pricing-stacking';
    stacking.textContent = config.stackingEnabled === false
      ? (stackingBlocked
          ? 'Masz aktywny dostęp. Administrator wyłączył dokupowanie pakietów przed jego wygaśnięciem.'
          : 'Kolejny pakiet można kupić dopiero po wygaśnięciu bieżącego dostępu.')
      : 'Każdy kolejny zakup dodaje czas do obecnego terminu. Ta sama płatność nigdy nie nalicza pakietu drugi raz.';
    fragment.append(stacking);
    container.replaceChildren(fragment);

    if (selectedPlan) {
      const selected = container.querySelector(`[data-plan="${selectedPlan}"]`);
      if (selected) window.setTimeout(() => selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }

  function renderFailure(container, error) {
    const message = document.createElement('p');
    message.className = 'chem-pricing-load-error';
    message.textContent = error && error.message ? error.message : 'Nie udało się wczytać pakietów.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chem-price-button';
    retry.textContent = 'Spróbuj ponownie';
    retry.addEventListener('click', () => renderAll(true));
    container.replaceChildren(message, retry);
  }

  async function renderAll(force) {
    const containers = Array.from(document.querySelectorAll('[data-pricing]'));
    if (!containers.length) return null;
    containers.forEach((container) => {
      if (!container.children.length || force) {
        container.innerHTML = '<p class="chem-pricing-loading">Wczytywanie aktualnych cen…</p>';
      }
    });
    try {
      const config = await loadConfig(force);
      containers.forEach((container) => renderContainer(container, config));
      window.dispatchEvent(new CustomEvent('chem-pricing-ready', { detail: { config } }));
      return config;
    } catch (error) {
      containers.forEach((container) => renderFailure(container, error));
      return null;
    }
  }

  async function startCheckout(plan, button, container) {
    if (!VALID_PLANS.has(plan) || checkoutInFlight) return;
    const auth = window.ChemAuth;
    const user = currentUser();

    if (!user) {
      const target = new URL('/login/', location.origin);
      target.searchParams.set('plan', plan);
      target.searchParams.set('returnTo', `/purchase/?plan=${encodeURIComponent(plan)}`);
      location.assign(`${target.pathname}${target.search}`);
      return;
    }

    const status = container && container.querySelector('[data-pricing-status]');
    const original = button ? button.textContent : '';
    checkoutInFlight = true;
    document.querySelectorAll('[data-checkout-plan]').forEach((candidate) => { candidate.disabled = true; });
    if (button) button.textContent = 'Przechodzę do Stripe…';
    if (status) {
      status.textContent = 'Tworzymy bezpieczną stronę płatności…';
      status.className = 'chem-pricing-status';
    }

    try {
      const token = auth && typeof auth.getAccessToken === 'function'
        ? await auth.getAccessToken({ forceRefresh: false })
        : await user.jwt();
      const response = await fetch(CHECKOUT_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ plan })
      });
      let payload = null;
      try { payload = await response.json(); } catch (_) {}
      if (!response.ok || !payload || typeof payload.url !== 'string') {
        const code = payload && typeof payload.error === 'string' ? payload.error : '';
        throw new Error(ERROR_MESSAGES[code] || `Nie udało się rozpocząć płatności (${response.status}).`);
      }
      location.assign(payload.url);
    } catch (error) {
      checkoutInFlight = false;
      document.querySelectorAll('[data-checkout-plan]').forEach((candidate) => { candidate.disabled = false; });
      if (button) button.textContent = original;
      if (status) {
        status.textContent = error && error.message ? error.message : 'Nie udało się rozpocząć płatności.';
        status.className = 'chem-pricing-status is-error';
      }
    }
  }

  window.ChemPayments = {
    loadConfig,
    renderAll,
    startCheckout
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderAll(false), { once: true });
  } else {
    renderAll(false);
  }
})();
