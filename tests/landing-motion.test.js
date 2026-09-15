'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ reduced = false, preview = false, exported = false, route, typing = false, loading = false } = {}) {
  const listeners = {}; const documentListeners = {}; const scheduled = new Map();
  const mediaListeners = {}; const appended = []; const removed = []; const timers = new Map(); let sequence = 0;
  function node() {
    const events = {}; const properties = {}; const classes = new Set();
    return {
      events, dataset: {}, attributes: {}, style: { setProperty: (key, value) => { properties[key] = value; }, removeProperty: (key) => { delete properties[key]; }, properties },
      classList: { toggle: (key, on) => { if (on) classes.add(key); else classes.delete(key); return on; }, add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key) },
      setAttribute(key, value) { this.attributes[key] = value; }, addEventListener: (name, cb) => { events[name] = cb; },
      remove() { removed.push(this); }, getBoundingClientRect: () => ({ top: 100, bottom: 300, height: 200 })
    };
  }
  const offer = node(), toggle = node(), progress = node(), parallax = node(), reveal = node(), offerStatus = node();
  const typingLine = node(), typingCopy = node(), typingInk = node();
  typingCopy.textContent = 'Plan. Praktyka.';
  typingLine.querySelector = (selector) => ({ '.typewriter-copy': typingCopy, '.typewriter-ink': typingInk })[selector];
  parallax.dataset.parallax = '80';
  const root = node(); root.scrollHeight = 2400; root.scrollTop = 0;
  if (loading) root.dataset.landingLoading = 'true';
  const media = { matches: reduced, addEventListener: (event, listener) => { mediaListeners[event] = listener; } };
  const context = {
    URL, URLSearchParams, location: { search: preview ? '?landing-preview=1' : '', hostname: 'nextmed.example' },
    sessionStorage: { getItem: () => null, setItem() {} },
    innerHeight: 800, innerWidth: 1280, scrollY: 400,
    matchMedia: () => media,
    requestAnimationFrame: (callback) => { scheduled.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id) => scheduled.delete(id),
    addEventListener: (event, listener) => { listeners[event] = listener; },
    setTimeout: (callback) => { timers.set(++sequence, callback); return sequence; }, clearTimeout: (id) => timers.delete(id),
    document: {
      documentElement: root, hidden: false,
      getElementById: (id) => ({ 'motion-toggle': toggle, 'load-offer': offer, 'offer-status': offerStatus })[id] || null,
      querySelector: (selector) => selector === '.reading-progress span' ? progress : selector === '.hero-typewriter' && typing ? typingLine : selector === 'meta[name="nextmed-landing-export"]' && exported ? node() : null,
      querySelectorAll: (selector) => selector === '[data-parallax]' ? [parallax] : selector === '[data-reveal]' ? [reveal] : [],
      addEventListener: (event, listener) => { documentListeners[event] = listener; },
      createElement: node, head: { append: (item) => appended.push(item) }
    },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} }
  };
  if (route) context.NextMedLandingSource = { ready: Promise.resolve(route) };
  context.window = context; context.parent = preview ? {} : context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/start_site/script.js'), 'utf8'), context);
  function flush() { const pending = [...scheduled.values()]; scheduled.clear(); pending.forEach((callback) => callback()); }
  function tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); }
  return { context, listeners, documentListeners, scheduled, media, mediaListeners, appended, removed, offer, offerStatus, toggle, progress, parallax, reveal, root, flush, timers, tick, typingLine, typingInk };
}

test('landing parallax batches scroll events into one frame and has no idle animation loop', () => {
  const scene = setup(); scene.flush();
  assert.equal(scene.scheduled.size, 0);
  scene.listeners.scroll(); scene.listeners.scroll(); scene.listeners.scroll();
  assert.equal(scene.scheduled.size, 1);
  scene.flush();
  assert.equal(scene.scheduled.size, 0);
  assert.equal(scene.progress.style.transform, 'scaleX(0.25)');
  assert.ok(scene.parallax.style.properties['--parallax-y']);
  assert.equal(scene.appended.length, 1, 'Only pricing loads automatically; no Identity scripts or session polling');
  assert.equal(scene.appended[0].src, '/assets/payments/payments.js');
});

test('reduced motion, page setting and reader toggle disable movement', () => {
  const scene = setup({ reduced: true }); scene.flush();
  assert.equal(scene.root.classList.contains('motion-enabled'), false);
  assert.equal(scene.parallax.style.properties['--parallax-y'], undefined);
  assert.equal(scene.reveal.classList.contains('is-visible'), true);
  scene.media.matches = false; scene.mediaListeners.change(); scene.flush();
  assert.equal(scene.root.classList.contains('motion-enabled'), true);
  scene.toggle.events.click(); scene.flush();
  assert.equal(scene.root.classList.contains('motion-enabled'), false);
  scene.root.dataset.motion = 'off'; scene.documentListeners['chemdisk-landing-applied']();
  assert.equal(scene.toggle.hidden, true);
});

test('public pricing loads without a click, stays deduplicated and offers an explicit retry', () => {
  const scene = setup();
  assert.equal(scene.appended.length, 1);
  scene.offer.events.click(); scene.offer.events.click();
  assert.equal(scene.appended.length, 1);
  assert.equal(scene.appended[0].src, '/assets/payments/payments.js');
  scene.appended[0].onerror();
  assert.equal(scene.offer.disabled, false);
  assert.equal(scene.offer.hidden, false);
  scene.offer.events.click(); assert.equal(scene.appended.length, 2);
});

test('editor preview never fetches live pricing, even when the offer button is clicked', () => {
  const scene = setup({ preview: true }); scene.offer.events.click();
  assert.equal(scene.appended.length, 0);
});

test('external landing redirect does not load pricing and same-domain landing does', async () => {
  const redirected = setup({ route: { externalEnabled: true, externalUrl: 'https://start.example' } });
  await Promise.resolve();
  assert.equal(redirected.appended.length, 0);
  redirected.offer.events.click();
  assert.equal(redirected.appended.length, 0);
  const local = setup({ route: { externalEnabled: true, externalUrl: 'https://nextmed.example' } });
  await Promise.resolve();
  assert.equal(local.appended.length, 1);
});

test('static export keeps its real purchase link instead of requesting a foreign-domain Function', () => {
  const scene = setup({ exported: true });
  assert.equal(scene.appended.length, 0);
  assert.match(scene.offerStatus.textContent, /stronie zakupu/);
});

test('typewriter finishes once, preserves a full accessible copy and does not loop', () => {
  const scene = setup({ typing: true, preview: true });
  assert.equal(scene.typingLine.classList.contains('is-typing'), true);
  for (let count = 0; count < 30; count++) scene.tick();
  assert.equal(scene.typingInk.textContent, 'Plan. Praktyka.');
  assert.equal(scene.typingLine.classList.contains('is-typing'), false);
  assert.equal(scene.timers.size, 0);
  scene.documentListeners['chemdisk-landing-applied']();
  assert.equal(scene.timers.size, 0, 'Unrelated published model events do not restart typing');
});

test('typewriter respects reduced motion, page settings and source-first loading', () => {
  const reduced = setup({ reduced: true, typing: true, preview: true });
  assert.equal(reduced.typingLine.classList.contains('is-typing'), false);
  assert.equal(reduced.timers.size, 0);
  const loading = setup({ loading: true, typing: true, preview: true });
  assert.equal(loading.timers.size, 0);
  delete loading.root.dataset.landingLoading;
  loading.documentListeners['chemdisk-landing-applied']();
  assert.equal(loading.typingLine.classList.contains('is-typing'), true);
  loading.root.dataset.motion = 'off';
  loading.documentListeners['chemdisk-landing-applied']();
  assert.equal(loading.typingLine.classList.contains('is-typing'), false);
  assert.equal(loading.timers.size, 0);
});
