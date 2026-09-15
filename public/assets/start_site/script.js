(() => {
  'use strict';

  const navbar = document.querySelector('.navbar');
  const scrollButton = document.querySelector('.scroll-up-btn');
  const menu = document.querySelector('.navbar .menu');
  const menuToggle = document.querySelector('.navbar .menu-toggle');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionToggle = document.getElementById('motion-toggle');
  const progress = document.querySelector('.reading-progress span');
  let userMotionOff = false;
  try { userMotionOff = sessionStorage.getItem('nextmed.motion.off') === '1'; } catch {}
  let motionEnabled = false;
  let frame = 0;
  let revealObserver;
  let parallaxNodes = [];
  const typingLine = document.querySelector('.hero-typewriter');
  const typingCopy = typingLine?.querySelector('.typewriter-copy');
  const typingInk = typingLine?.querySelector('.typewriter-ink');
  let typingTimer = 0;
  let typingStarted = false;

  const finishTyping = () => {
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = 0;
    typingLine?.classList.remove('is-typing');
    typingLine?.classList.add('is-complete');
  };
  const configureTyping = () => {
    if (!typingLine || !typingCopy || !typingInk) return;
    if (!motionEnabled || document.hidden) { if (typingStarted) finishTyping(); return; }
    if (typingStarted || document.documentElement.dataset.landingLoading === 'true') return;
    typingStarted = true;
    const characters = Array.from(typingCopy.textContent || '');
    let position = 0;
    typingInk.textContent = '';
    typingLine.classList.add('is-typing');
    const type = () => {
      if (!motionEnabled || document.hidden || position >= characters.length) { finishTyping(); return; }
      typingInk.textContent += characters[position++];
      typingTimer = window.setTimeout(type, characters[position - 1] === '.' ? 200 : 35);
    };
    typingTimer = window.setTimeout(type, 250);
  };

  const updateScrollState = () => {
    frame = 0;
    const y = window.scrollY || document.documentElement.scrollTop;
    navbar?.classList.toggle('sticky', y > 20);
    scrollButton?.classList.toggle('show', y > 500);
    if (scrollButton) scrollButton.tabIndex = y > 500 ? 0 : -1;
    const range = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.transform = `scaleX(${range > 0 ? Math.min(1, Math.max(0, y / range)) : 0})`;
    if (!motionEnabled) return;
    const height = window.innerHeight;
    const scale = window.innerWidth < 860 ? .35 : 1;
    // Read before writing; do not animate off-screen decorations or poll at rest.
    const positions = parallaxNodes.map((node) => ({ node, rect: node.getBoundingClientRect() }));
    positions.forEach(({ node, rect }) => {
      if (rect.bottom < -150 || rect.top > height + 150) return;
      const phase = Math.max(-1, Math.min(1, (height / 2 - rect.top - rect.height / 2) / height));
      const offset = phase * Number(node.dataset.parallax || 0) * scale;
      node.style.setProperty('--parallax-y', `${offset.toFixed(1)}px`);
    });
  };

  const scheduleScroll = () => {
    if (!frame && !document.hidden) frame = window.requestAnimationFrame(updateScrollState);
  };
  const configureMotion = () => {
    motionEnabled = !motionPreference.matches && !userMotionOff && document.documentElement.dataset.motion !== 'off';
    document.documentElement.classList.toggle('motion-enabled', motionEnabled);
    revealObserver?.disconnect();
    parallaxNodes = Array.from(document.querySelectorAll('[data-parallax]'));
    parallaxNodes.forEach((node) => node.style.removeProperty('--parallax-y'));
    const reveals = document.querySelectorAll('[data-reveal]');
    if (motionEnabled && 'IntersectionObserver' in window) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -24px 0px', threshold: .04 });
      reveals.forEach((node) => revealObserver.observe(node));
    } else reveals.forEach((node) => node.classList.add('is-visible'));
    if (motionToggle) {
      motionToggle.hidden = motionPreference.matches || document.documentElement.dataset.motion === 'off';
      motionToggle.textContent = motionEnabled ? 'Wyłącz animacje' : 'Włącz animacje';
      motionToggle.setAttribute('aria-pressed', String(!motionEnabled));
    }
    configureTyping();
    scheduleScroll();
  };
  window.addEventListener('scroll', scheduleScroll, { passive: true });
  window.addEventListener('resize', scheduleScroll, { passive: true });
  document.addEventListener('chemdisk-landing-applied', configureMotion);
  document.addEventListener('nextmed-landing-mounted', configureMotion);
  motionPreference.addEventListener?.('change', configureMotion);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finishTyping();
    else configureTyping();
    if (document.hidden && frame) { window.cancelAnimationFrame(frame); frame = 0; }
    else scheduleScroll();
  });
  motionToggle?.addEventListener('click', () => {
    userMotionOff = !userMotionOff;
    try { sessionStorage.setItem('nextmed.motion.off', userMotionOff ? '1' : '0'); } catch {}
    configureMotion();
  });
  configureMotion();
  // The source-first renderer reveals the document only after resolving its model.
  // Start the one-shot writing effect then, not behind the loading screen.
  if ('MutationObserver' in window) {
    const loadingObserver = new MutationObserver(() => {
      if (document.documentElement.dataset.landingLoading === 'true') return;
      configureTyping();
      loadingObserver.disconnect();
    });
    loadingObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-landing-loading'] });
  }

  scrollButton?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: motionEnabled ? 'smooth' : 'auto' });
  });

  menuToggle?.addEventListener('click', () => {
    const open = menu?.classList.toggle('active') || false;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Zamknij menu' : 'Otwórz menu');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu?.classList.contains('active')) return;
    menu.classList.remove('active');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Otwórz menu');
    menuToggle?.focus();
  });

  document.querySelectorAll('.navbar .menu a').forEach((link) => {
    link.addEventListener('click', () => {
      menu?.classList.remove('active');
      menuToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  const year = document.getElementById('current-year');
  if (year) year.textContent = String(new Date().getFullYear());

  const preview = new URLSearchParams(location.search).get('landing-preview') === '1' && window.parent !== window;
  const exported = Boolean(document.querySelector('meta[name="nextmed-landing-export"]'));
  const offerButton = document.getElementById('load-offer');
  const offerStatus = document.getElementById('offer-status');
  let offerLoading = false;
  let offerAllowed = false;
  const loadOffer = () => {
    if (preview || exported) {
      if (offerStatus) offerStatus.textContent = preview
        ? 'Aktualne pakiety pojawią się automatycznie na opublikowanej stronie.'
        : 'Aktualne pakiety i ceny znajdziesz na stronie zakupu.';
      return;
    }
    if (!offerAllowed || offerLoading || !offerButton) return;
    offerLoading = true;
    offerButton.disabled = true;
    offerButton.hidden = true;
    if (offerStatus) offerStatus.textContent = 'Wczytuję aktualne ceny i dostępne pakiety…';
    const script = document.createElement('script');
    script.src = '/assets/payments/payments.js';
    script.async = true;
    const timeout = window.setTimeout(failed, 15000);
    function failed() {
      window.clearTimeout(timeout);
      script.remove();
      offerLoading = false;
      offerButton.disabled = false;
      offerButton.hidden = false;
      offerButton.textContent = 'Spróbuj ponownie';
      if (offerStatus) offerStatus.textContent = 'Nie udało się wczytać cen. Spróbuj ponownie lub otwórz stronę zakupu.';
    }
    script.onerror = failed;
    script.onload = () => { window.clearTimeout(timeout); };
    document.head.append(script);
  };
  offerButton?.addEventListener('click', loadOffer);
  const startOffer = (route) => {
    if (route?.externalEnabled && route.externalUrl) {
      try { if (new URL(route.externalUrl).hostname !== location.hostname) return; } catch { return; }
    }
    offerAllowed = true;
    loadOffer();
  };
  if (window.NextMedLandingSource?.ready) {
    window.NextMedLandingSource.ready.then(startOffer).catch(() => startOffer(null));
  } else {
    // script.js runs before deferred source/runtime scripts in the document.
    // Wait for DOMContentLoaded so redirects can be checked before pricing loads.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => {
      if (window.NextMedLandingSource?.ready) window.NextMedLandingSource.ready.then(startOffer).catch(() => startOffer(null));
      else startOffer(null);
    }, { once: true });
    else startOffer(null);
  }
})();
