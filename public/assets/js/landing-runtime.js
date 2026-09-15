(function applyPublishedLanding() {
  'use strict';

  const FUNCTION_ENDPOINT = '/.netlify/functions/landing';
  const CACHE_KEY = 'chem.landing.public.v3';
  const LEGACY_CACHE_KEY = 'chem.landing.public.v2';
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 3_000;
  const COPY_TARGETS = {
    home: { title: '.text-2', subtitle: '.text-1', body: '.text-3', image: 'background', cta: '#login-cta' },
    about: { title: '.title', subtitle: '.column.right .text', body: '.column.right p', image: '.column.left img', cta: '.column.right a' },
    services: { title: '.title', subtitle: '.landing-section-subtitle', body: '.landing-section-body', image: 'managed', cta: '.landing-section-cta' },
    pricing: { title: '.title', subtitle: '.landing-section-subtitle', body: '.pricing-intro', image: 'managed', cta: '.landing-section-cta' },
    skills: { title: '.title', subtitle: '.column.left .text', body: '.column.left p', image: 'managed', cta: '.column.left a' },
    contact: { title: '.title', subtitle: '.column.left .text', body: '.column.left > p', image: 'managed', cta: '.landing-section-cta' }
  };
  const SECTION_IDS = Object.keys(COPY_TARGETS);
  let currentModel = null;
  let resolvedConfigUrl = '';
  let publicationVersion = '';
  const previewMode = /(?:^|[?&])landing-preview=1(?:&|$)/.test(window.location?.search || '') && window.parent !== window;
  const exportMode = Boolean(document.querySelector('meta[name="nextmed-landing-export"]'));
  const exportOrigin = exportMode ? document.querySelector('meta[name="nextmed-landing-origin"]')?.content || '' : '';
  window.NextMedLanding = Object.freeze({ applyModel: safelyApply });
  if (window.NextMedUI?.renderLanding(document.querySelector('main'))) document.dispatchEvent(new CustomEvent('nextmed-landing-mounted'));

  if (previewMode) {
    initializePreview();
    return;
  }
  if (exportMode) {
    try { safelyApply(JSON.parse(document.getElementById('nextmed-landing-model')?.textContent || 'null')); } catch {}
    return;
  }

  if (window.NextMedLandingSource) void initializeFromSource();
  else {
    const cached = readCache();
    if (cached?.model) safelyApply(cached.model);
    if (!cached || Date.now() - cached.checkedAt >= CACHE_TTL_MS) void refresh();
  }

  async function initializeFromSource() {
    try {
      const route = await window.NextMedLandingSource.ready;
      publicationVersion = route.publication?.version || '';
      const blobPublication = route.publication?.mode === 'netlify-blobs' && usablePayload(route.publication);
      if (route.unavailable && !blobPublication) return;
      resolvedConfigUrl = blobPublication ? FUNCTION_ENDPOINT : window.NextMedLandingDelivery.rawUrl(route.target);
      if (route.externalEnabled && route.externalUrl) {
        const target = new URL(route.externalUrl);
        // Never forward login tokens, query strings or fragments to another domain.
        const authHash = /(?:^|[#&])(?:invite_token|recovery_token|confirmation_token|email_change_token|access_token|token|error|error_description|type)=/i.test(location.hash || '');
        if (target.hostname !== location.hostname && !authHash) { location.replace(target.href); return; }
      }
      if (blobPublication) {
        if (safelyApply(route.publication.model)) writeCache(route.publication.model, 'netlify-blobs');
        return;
      }
      const cached = readCache();
      if (cached?.model && Date.now() - cached.checkedAt < CACHE_TTL_MS
        && (!publicationVersion || cached.publicationVersion === publicationVersion)) safelyApply(cached.model);
      else {
        const inactive = await refresh(cached?.model);
        if (!inactive && !currentModel && cached?.model) safelyApply(cached.model);
      }
    } catch { /* Leave the checked-in page available if configuration is unavailable. */ }
    finally { delete document.documentElement.dataset.landingLoading; }
  }

  async function refresh(cachedModel = null) {
    const staticUrl = staticConfigUrl();
    let payload = staticUrl ? await fetchPayload(staticUrl, 'no-cache') : null;
    let source = 'static';
    // A configured public JSON is authoritative. A temporary CDN failure must
    // not roll back to a different Blob version or trigger a Function per view.
    if (!staticUrl) {
      payload = await fetchPayload(FUNCTION_ENDPOINT, 'default');
      source = 'function';
    }
    if (!payload) return;
    if (payload.active === false) {
      clearPublishedCache();
      return true;
    }
    if (!usablePayload(payload)) return;
    const incoming = payload.model;
    const previous = currentModel || cachedModel;
    if (previous && modelRevision(incoming) < modelRevision(previous)) {
      if (!currentModel) safelyApply(previous);
      writeCache(previous, source);
      return;
    }
    if (safelyApply(incoming)) writeCache(incoming, source);
  }

  function initializePreview() {
    let token = '';
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'nextmed:landing-preview:init' && typeof data.token === 'string' && data.token.length >= 16) {
        token = data.token;
        window.parent.postMessage({ type: 'nextmed:landing-preview:ready', token }, event.origin);
      } else if (token && data.token === token && data.type === 'nextmed:landing-preview:model') {
        if (!safelyApply(data.model)) return;
        if (SECTION_IDS.includes(data.selectedId) && data.scroll === true) document.getElementById(data.selectedId)?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      }
    });
    document.addEventListener('click', (event) => {
      const anchor = event.target?.closest?.('a');
      if (anchor && !String(anchor.getAttribute('href') || '').startsWith('#')) event.preventDefault();
    }, true);
    document.addEventListener('submit', (event) => event.preventDefault(), true);
  }

  async function fetchPayload(url, cacheMode) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        cache: cacheMode,
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function staticConfigUrl() {
    if (resolvedConfigUrl) return resolvedConfigUrl;
    const value = document.querySelector('meta[name="nextmed-landing-config"]')?.content;
    return safeImageUrl(value);
  }

  function usablePayload(payload) {
    return payload?.active === true && validModel(payload.model);
  }

  function validModel(model) {
    if (!model || typeof model !== 'object' || Array.isArray(model) || !Array.isArray(model.sections)) return false;
    const ids = new Set();
    for (const section of model.sections) {
      if (!section || typeof section !== 'object' || Array.isArray(section) || !SECTION_IDS.includes(section.id) || ids.has(section.id)) return false;
      ids.add(section.id);
    }
    return ids.size === SECTION_IDS.length;
  }

  function safelyApply(model) {
    if (!validModel(model)) return false;
    try {
      applyModel(model);
      currentModel = model;
      return true;
    } catch {
      return false;
    }
  }

  function applyModel(model) {
    const main = document.querySelector('main');
    const reactLanding = window.NextMedUI?.renderLanding(main, model);
    applyBranding(model.branding || {});
    const ordered = [...model.sections].sort((left, right) => safeOrder(left.order) - safeOrder(right.order));
    const enabledSectionIds = new Set(ordered.filter((section) => section.enabled !== false).map((section) => section.id));
    ordered.forEach((config) => {
      const section = document.getElementById(config.id);
      if (!section) return;
      section.hidden = config.enabled === false;
      section.dataset.landingManaged = 'true';
      setStyle(section, 'background-color', safeColor(config.backgroundColor));
      setStyle(section, 'color', safeColor(config.textColor));
      setStyle(section, '--landing-text', safeColor(config.textColor));
      setStyle(section, '--landing-background', safeColor(config.backgroundColor));
      setStyle(section, '--landing-accent', safeColor(config.accentColor));
      if (config.id === 'contact') {
        const fields = { formBackgroundColor: '--contact-form-background', fieldBackgroundColor: '--contact-field-background', fieldTextColor: '--contact-field-text', fieldBorderColor: '--contact-field-border', fieldFocusColor: '--contact-field-focus', labelTextColor: '--contact-label-text' };
        Object.entries(fields).forEach(([key, variable]) => setStyle(section, variable, safeColor(config[key])));
        // Set explicit field colors on the actual controls as well: neither a
        // page palette nor an older cached stylesheet may cover a custom value.
        section.querySelectorAll('form input:not([type="hidden"]):not([type="submit"]), form textarea').forEach((input) => {
          setStyle(input, 'background-color', safeColor(config.fieldBackgroundColor));
          setStyle(input, 'color', safeColor(config.fieldTextColor));
        });
      }
      const targets = COPY_TARGETS[config.id];
      if (!reactLanding) {
        setText(section, targets.title, config.title);
        setText(section, targets.subtitle, config.subtitle);
        setText(section, targets.body, config.body);
        applyImage(section, targets.image, config);
        applyCta(section, targets.cta, config, enabledSectionIds);
      }
      syncNavigation(config);
      if (main && !reactLanding) main.append(section);
    });
    reorderNavigation(ordered);
    const firstVisible = ordered.find((section) => section.enabled !== false);
    const navbar = document.querySelector('.navbar');
    navbar?.classList.toggle('landing-solid', needsSolidNavbar(firstVisible));
    navbar?.classList.toggle('over-hero-image', firstVisible?.id === 'home' && (firstVisible.heroVisual === 'biomolecule-banner' || (firstVisible.heroVisual === 'image' && Boolean(safeImageUrl(firstVisible.imageUrl)))));
    document.documentElement.dataset.landingPublished = 'true';
    document.dispatchEvent(new CustomEvent('chemdisk-landing-applied', { detail: { revision: modelRevision(model) } }));
  }

  function applyBranding(branding) {
    const brandName = cleanText(branding.brandName) || 'NextMed';
    if (typeof branding.siteTitle === 'string' && branding.siteTitle.trim()) document.title = branding.siteTitle.trim();
    const description = document.querySelector('meta[name="description"]');
    if (description && typeof branding.siteDescription === 'string' && branding.siteDescription.trim()) description.content = branding.siteDescription.trim();
    applyTheme(branding);
    applyFavicon(branding.faviconUrl);
    setAllText('[data-brand-name]', brandName);
    setAllText('[data-brand-tagline]', cleanText(branding.tagline));
    setAllText('[data-company-name]', cleanText(branding.companyName) || brandName);
    setAllText('[data-contact-address]', cleanText(branding.contactAddress));
    setAllText('[data-footer-text]', cleanText(branding.footerText) || `${brandName} · kursy maturalne`);
    applyContact(branding);

    const anchor = document.querySelector('.navbar .logo a');
    if (!anchor) return;
    anchor.dataset.logoFallbackName = brandName;
    const logoUrl = safeImageUrl(branding.logoUrl);
    if (!logoUrl) {
      renderTextBrand(anchor, brandName);
      return;
    }
    const previous = anchor.children[0];
    if (previous?.dataset.logoUrl === logoUrl) {
      previous.alt = cleanText(branding.logoAlt) || brandName;
      return;
    }
    const image = document.createElement('img');
    image.dataset.logoUrl = logoUrl;
    image.alt = cleanText(branding.logoAlt) || brandName;
    image.decoding = 'async';
    image.fetchPriority = 'high';
    image.addEventListener('load', () => {
      if (anchor.children[0] === image) anchor.dataset.logoState = 'ready';
    }, { once: true });
    image.addEventListener('error', () => {
      if (anchor.children[0] === image) renderTextBrand(anchor, anchor.dataset.logoFallbackName);
    }, { once: true });
    anchor.classList.add('has-brand-image');
    anchor.dataset.logoState = 'loading';
    anchor.replaceChildren(image);
    image.src = logoUrl;
  }

  function renderTextBrand(anchor, brandName) {
    anchor.classList.remove('has-brand-image');
    anchor.dataset.logoState = 'fallback';
    const name = document.createElement('span');
    const dot = document.createElement('i');
    name.textContent = brandName;
    name.dataset.brandName = '';
    dot.textContent = '.';
    dot.setAttribute('aria-hidden', 'true');
    anchor.replaceChildren(name, dot);
  }

  function applyTheme(branding) {
    const root = document.documentElement;
    if (!root?.style) return;
    root.dataset.motion = branding.motionEnabled === false ? 'off' : 'on';
    const fields = {
      primaryColor: '--brand-primary', secondaryColor: '--brand-secondary', accentColor: '--brand-accent',
      backgroundColor: '--brand-background', surfaceColor: '--brand-surface', textColor: '--brand-text', mutedColor: '--brand-muted'
    };
    Object.entries(fields).forEach(([field, variable]) => setStyle(root, variable, safeColor(branding[field])));
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor && safeColor(branding.primaryColor)) themeColor.content = safeColor(branding.primaryColor);
  }

  function applyFavicon(value) {
    const url = safeImageUrl(value);
    if (!url) return;
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head?.append?.(link);
    }
    link.href = url;
  }

  function applyContact(branding) {
    const email = cleanText(branding.contactEmail);
    const emailNode = document.querySelector('[data-contact-email]');
    if (emailNode) {
      emailNode.textContent = email;
      emailNode.hidden = !email;
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) emailNode.setAttribute('href', `mailto:${email}`);
      else emailNode.removeAttribute('href');
    }
    const phone = cleanText(branding.contactPhone);
    const phoneNode = document.querySelector('[data-contact-phone]');
    const phoneRow = document.querySelector('[data-phone-row]');
    if (phoneNode) {
      phoneNode.textContent = phone;
      if (phone) phoneNode.setAttribute('href', `tel:${phone.replace(/[^+\d]/g, '')}`);
      else phoneNode.removeAttribute('href');
    }
    if (phoneRow) phoneRow.hidden = !phone;
    const addressRow = document.querySelector('[data-address-row]');
    if (addressRow) addressRow.hidden = !cleanText(branding.contactAddress);
    const contactAction = document.querySelector('[data-contact-action]');
    if (contactAction) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        contactAction.setAttribute('href', `mailto:${email}`);
        contactAction.hidden = false;
      } else {
        contactAction.hidden = !exportMode;
        if (exportMode && exportOrigin) contactAction.setAttribute('href', `${exportOrigin}/#contact`);
      }
    }
  }

  function applyImage(section, target, config) {
    const model = target === 'background' && config.heroVisual !== 'image';
    const url = model ? '' : safeImageUrl(config.imageUrl);
    if (target === 'background') {
      const banner = config.heroVisual === 'biomolecule-banner';
      section.dataset.heroVisual = model ? (banner ? 'biomolecule-banner' : 'biomolecule') : 'image';
      section.classList.toggle('has-biomolecule', model);
      section.classList.toggle('has-biomolecule-banner', banner);
      if (url) section.style.backgroundImage = `linear-gradient(100deg, rgba(5,15,30,.72), rgba(5,15,30,.3)), url("${url.replace(/["\\]/g, '')}")`;
      else section.style.removeProperty('background-image');
      section.classList.toggle('has-hero-image', Boolean(url));
      return;
    }
    const image = target === 'managed' ? ensureManagedImage(section) : target ? section.querySelector(target) : null;
    if (!image) return;
    if (target === '.column.left img') section.classList.toggle('landing-no-image', !url);
    image.hidden = !url;
    image.alt = cleanText(config.imageAlt);
    if (url) {
      image.src = url;
      image.loading = section.id === 'home' ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.fetchPriority = section.id === 'home' ? 'high' : 'low';
    } else image.removeAttribute('src');
  }

  function ensureManagedImage(section) {
    let image = section.querySelector('.landing-section-image');
    if (image) return image;
    const container = section.querySelector('.max-width') || section;
    image = document.createElement('img');
    image.className = 'landing-section-image';
    image.hidden = true;
    image.width = 1200;
    image.height = 675;
    const lead = container.querySelector('.landing-section-body, .pricing-intro, .title');
    if (lead) lead.after(image);
    else container.prepend(image);
    return image;
  }

  function applyCta(section, selector, config, enabledSectionIds) {
    const cta = selector ? section.querySelector(selector) : null;
    if (!cta) return;
    const label = cleanText(config.ctaLabel);
    const href = safeHref(config.ctaHref, enabledSectionIds);
    cta.textContent = label;
    cta.hidden = !label || !href;
    cta.dataset.landingManaged = 'true';
    if (label && href) cta.setAttribute('href', href);
    else cta.removeAttribute('href');
  }

  function setText(root, selector, value) {
    const element = selector ? root.querySelector(selector) : null;
    if (!element) return;
    const text = typeof value === 'string' ? value : '';
    element.textContent = text;
    element.hidden = !text;
  }

  function setAllText(selector, value) {
    if (!document.querySelectorAll) return;
    document.querySelectorAll(selector).forEach((node) => { node.textContent = value; node.hidden = !value; });
  }

  function setStyle(element, property, value) {
    if (!element?.style) return;
    if (value) element.style.setProperty(property, value);
    else element.style.removeProperty(property);
  }

  function syncNavigation(config) {
    const link = document.querySelector(`.navbar .menu a[href="#${config.id}"]`);
    const item = link?.closest('li');
    if (item) item.hidden = config.enabled === false;
  }

  function reorderNavigation(ordered) {
    const menu = document.querySelector('.navbar .menu');
    if (!menu) return;
    const items = ordered.map((config) => document.querySelector(`.navbar .menu a[href="#${config.id}"]`)?.closest('li')).filter(Boolean);
    const fixedItem = Array.from(menu.children).find((item) => !items.includes(item)) || null;
    items.forEach((item) => menu.insertBefore(item, fixedItem));
  }

  function needsSolidNavbar(firstVisible) {
    if (!firstVisible || firstVisible.id !== 'home') return true;
    if (firstVisible.heroVisual === 'biomolecule-banner') return false;
    if (firstVisible.heroVisual === 'image' && safeImageUrl(firstVisible.imageUrl)) return false;
    const background = safeColor(firstVisible.backgroundColor);
    if (!background) return true;
    const value = Number.parseInt(background.slice(1), 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return (red * 299 + green * 587 + blue * 114) / 255000 > .56;
  }

  function safeHref(value, enabledSectionIds) {
    const raw = cleanText(value);
    const hash = /^#([A-Za-z][A-Za-z0-9_-]{0,79})$/.exec(raw);
    if (hash) return !enabledSectionIds || enabledSectionIds.has(hash[1]) ? raw : '';
    if (/^\/(?!\/)[^\s\\]*$/.test(raw)) return exportOrigin ? new URL(raw, exportOrigin).toString() : raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname ? url.toString() : '';
    } catch { return ''; }
  }

  function safeImageUrl(value) {
    const raw = cleanText(value);
    if (/^\/(?!\/)[^\s\\]*$/.test(raw)) return exportOrigin ? new URL(raw, exportOrigin).toString() : raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname ? url.toString() : '';
    } catch { return ''; }
  }

  function safeColor(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : ''; }
  function safeOrder(value) { return Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER; }
  function modelRevision(model) { return Number.isSafeInteger(model?.revision) && model.revision >= 0 ? model.revision : 0; }
  function cleanText(value) { return typeof value === 'string' ? value.trim() : ''; }

  function readCache() {
    for (const key of [CACHE_KEY, LEGACY_CACHE_KEY]) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        const defaultUrl = document.querySelector('meta[name="nextmed-landing-config"]')?.content || '';
        if (resolvedConfigUrl && (parsed?.configUrl || defaultUrl) !== resolvedConfigUrl) continue;
        const model = parsed?.model || parsed;
        if (!validModel(model)) continue;
        const checkedAt = Number(parsed?.checkedAt) || 0;
        return { model, checkedAt: checkedAt > 0 && checkedAt <= Date.now() ? checkedAt : 0, source: parsed?.source || 'legacy', publicationVersion: parsed?.publicationVersion || '' };
      } catch {}
    }
    return null;
  }

  function writeCache(model, source) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ model, checkedAt: Date.now(), source, configUrl: staticConfigUrl(), publicationVersion }));
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {}
  }

  function clearPublishedCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(LEGACY_CACHE_KEY);
      if (currentModel && !readCache() && typeof window.location?.reload === 'function') window.location.reload();
    } catch {}
  }
})();
