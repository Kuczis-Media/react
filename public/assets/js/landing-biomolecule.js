(function initializeBiomolecule() {
  'use strict';
  // Exact scene and player used by generatebiomedicine/index.html. Do not
  // override its camera, events, materials or physics with a second animation.
  const PLAYER_URL = 'https://unpkg.com/@splinetool/viewer@1.10.31/build/spline-viewer.js';
  const SCENE_URL = 'https://prod.spline.design/1gCKLbyQZHQvxlYX/scene.splinecode';
  const host = document.getElementById('hero-biomolecule');
  if (!host) return;
  const home = document.getElementById('home');
  const stage = host.querySelector('[data-model-stage]');
  const status = host.querySelector('[data-model-status]');
  const toggle = host.querySelector('[data-model-toggle]');
  const retry = host.querySelector('[data-model-retry]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let viewer = null, playerPromise = null, timer = 0;
  let visible = !('IntersectionObserver' in window), paused = false, failed = false, starting = false;
  const motionAllowed = () => !reduced.matches && document.documentElement.classList.contains('motion-enabled');
  const selected = () => !home.hidden && home.dataset.heroVisual !== 'image';
  const shouldRun = () => selected() && visible && !document.hidden && !paused && motionAllowed()
    && document.documentElement.dataset.landingLoading !== 'true';

  // Spline's canvas cancels wheel events for its camera/page-scroll controls.
  // Keep native page scrolling (including trackpad momentum and Ctrl+zoom),
  // while leaving pointer movement, dragging and the scene physics untouched.
  stage.addEventListener('wheel', (event) => event.stopPropagation(), { capture: true, passive: true });

  function clearTimer() { window.clearTimeout(timer); timer = 0; }
  function message(state, copy) {
    host.dataset.modelState = state;
    if (status.textContent !== copy) status.textContent = copy;
    retry.hidden = state !== 'error';
  }
  function fail() {
    clearTimer(); failed = true;
    viewer?.unload?.();
    message('error', 'Model jest chwilowo niedostępny. Pozostała część strony działa normalnie.');
  }
  function loadPlayer() {
    if (window.customElements?.get('spline-viewer')) return Promise.resolve();
    if (playerPromise) return playerPromise;
    playerPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.type = 'module'; script.src = PLAYER_URL;
      const timeout = window.setTimeout(() => finish(false), 30_000);
      function finish(ok) {
        window.clearTimeout(timeout); script.onload = null; script.onerror = null;
        if (ok) resolve();
        else { script.remove(); reject(new Error('Player unavailable')); }
      }
      script.onload = () => finish(Boolean(window.customElements?.get('spline-viewer')));
      script.onerror = () => finish(false);
      document.head.append(script);
    }).catch((error) => { playerPromise = null; throw error; });
    return playerPromise;
  }
  function mountViewer() {
    if (viewer) return;
    viewer = document.createElement('spline-viewer');
    const instance = viewer;
    viewer.setAttribute('url', SCENE_URL);
    viewer.setAttribute('unloadable', '');
    viewer.setAttribute('aria-label', 'Interaktywny model biomolekuły');
    viewer.addEventListener('load-start', () => {
      if (viewer !== instance || !shouldRun() || failed) return;
      message('loading', 'Wczytywanie modelu 3D…');
      clearTimer(); timer = window.setTimeout(fail, 30_000);
    });
    viewer.addEventListener('load-complete', () => {
      if (viewer !== instance) { instance.unload?.(); return; }
      clearTimer();
      // A request can finish after the visitor disables motion or leaves the
      // page. Release the completed scene as well, not just its DOM element.
      if (!shouldRun() || failed) { viewer.unload?.(); return; }
      message('ready', 'Model 3D · porusz kursorem i odkrywaj');
    });
    viewer.addEventListener('context-loss', () => { if (viewer === instance && shouldRun()) fail(); });
    stage.append(viewer);
  }
  async function configure() {
    host.hidden = !selected();
    toggle.hidden = !motionAllowed();
    toggle.textContent = paused ? 'Włącz model' : 'Zatrzymaj model';
    toggle.setAttribute('aria-pressed', String(paused));
    if (!shouldRun()) {
      clearTimer(); viewer?.unload?.();
      if (!failed) message('paused', 'Model 3D jest zatrzymany.');
      return;
    }
    if (failed || starting) return;
    if (viewer) { viewer.load?.(); return; }
    starting = true;
    message('loading', 'Wczytywanie modelu 3D…');
    clearTimer(); timer = window.setTimeout(fail, 30_000);
    try {
      await loadPlayer();
      if (shouldRun() && !failed) mountViewer();
    } catch { fail(); }
    finally { starting = false; }
  }
  toggle.addEventListener('click', () => { paused = !paused; void configure(); });
  retry.addEventListener('click', () => {
    // Retry is explicit: neither scrolling nor editing text repeats a failed
    // scene download. No Netlify Function or AI request is involved.
    if (starting) return;
    viewer?.unload?.(); viewer?.remove(); viewer = null;
    failed = false; void configure();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      void configure();
    }, { threshold: .01 }).observe(host);
  }
  if ('MutationObserver' in window) {
    new MutationObserver(() => { void configure(); }).observe(document.documentElement, {
      attributes: true, attributeFilter: ['class', 'data-motion', 'data-landing-loading']
    });
  }
  document.addEventListener('chemdisk-landing-applied', () => { void configure(); });
  document.addEventListener('visibilitychange', () => { void configure(); });
  reduced.addEventListener?.('change', () => { void configure(); });
  window.addEventListener('pagehide', () => { clearTimer(); viewer?.unload?.(); });
  window.addEventListener('pageshow', () => { void configure(); });
  void configure();
})();
