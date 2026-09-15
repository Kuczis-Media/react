'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/assets/js/landing-biomolecule.js'), 'utf8');

function setup({ motion = true, reduced = false, image = false, loading = false } = {}) {
  const nodes = [], timers = new Map(), docEvents = {}, winEvents = {}, mediaEvents = {};
  let sequence = 0, registered = false, intersect, mutate;
  function node(tag = 'div') {
    const item = { tag, dataset: {}, attrs: {}, events: {}, eventOptions: {}, children: [], textContent: '', hidden: false, loads: 0, unloads: 0,
      addEventListener(name, callback, options) { this.events[name] = callback; this.eventOptions[name] = options; },
      setAttribute(name, value) { this.attrs[name] = value; },
      append(child) { this.children.push(child); if (child.tag === 'spline-viewer') child.load(); },
      remove() { this.removed = true; },
      load() { this.loads++; this.events['load-start']?.(); }, unload() { this.unloads++; }
    };
    nodes.push(item); return item;
  }
  const stage = node(), status = node(), toggle = node('button'), retry = node('button'), host = node(), home = node();
  home.dataset.heroVisual = image ? 'image' : 'biomolecule';
  host.querySelector = (selector) => ({ '[data-model-stage]': stage, '[data-model-status]': status, '[data-model-toggle]': toggle, '[data-model-retry]': retry })[selector];
  const root = { dataset: loading ? { landingLoading: 'true' } : {}, classList: { contains: () => motion } };
  const media = { matches: reduced, addEventListener: (name, callback) => { mediaEvents[name] = callback; } };
  const context = {
    Promise, document: { documentElement: root, hidden: false, head: node('head'),
      getElementById: (id) => id === 'home' ? home : host, createElement: node,
      addEventListener: (name, callback) => { docEvents[name] = callback; }
    },
    matchMedia: () => media, customElements: { get: () => registered ? function Viewer() {} : undefined },
    setTimeout: (callback) => { timers.set(++sequence, callback); return sequence; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, callback) => { winEvents[name] = callback; },
    IntersectionObserver: class { constructor(callback) { intersect = callback; } observe() {} },
    MutationObserver: class { constructor(callback) { mutate = callback; } observe() {} }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { context, host, home, stage, status, toggle, retry, media, root, nodes, timers, docEvents, winEvents, mediaEvents, flush,
    visible(value = true) { intersect([{ isIntersecting: value }]); },
    async readyPlayer() { registered = true; nodes.findLast((item) => item.tag === 'script' && !item.removed)?.onload(); await flush(); },
    motion(value) { motion = value; mutate(); }, changed: () => mutate()
  };
}

test('biomolecule uses the exact reference player and scene, without a replacement physics implementation', () => {
  const original = fs.readFileSync(require.resolve('./fixtures/biomolecule-source.html'), 'utf8');
  const player = original.match(/https:\/\/unpkg.com\/@splinetool\/viewer@[^" ]+/)[0];
  const scene = original.match(/https:\/\/prod.spline.design\/[^" ]+scene.splinecode/)[0];
  assert.ok(source.includes(player)); assert.ok(source.includes(scene));
  assert.doesNotMatch(source, /\.netlify\/functions|requestAnimationFrame|setInterval|\.setVariable\(/);
  assert.doesNotMatch(source, /setAttribute\(['"](?:background|events-target|loading)['"]/);
});

test('wheel input is stopped before Spline controls without cancelling native scroll or browser zoom', () => {
  for (const heroVisual of ['biomolecule', 'biomolecule-banner']) {
    const env = setup(); env.home.dataset.heroVisual = heroVisual;
    assert.equal(env.stage.eventOptions.wheel.capture, true);
    assert.equal(env.stage.eventOptions.wheel.passive, true);
    for (const ctrlKey of [false, true]) {
      let stopped = false, cancelled = false;
      env.stage.events.wheel({ ctrlKey, deltaY: 45, stopPropagation() { stopped = true; }, preventDefault() { cancelled = true; } });
      assert.equal(stopped, true);
      assert.equal(cancelled, false);
    }
    assert.equal(env.stage.events.pointermove, undefined, 'Pointer interactions still reach the original model');
    assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 0);
  }
});
test('3D player loads only when visible and selected, once, without delaying page content', async () => {
  const env = setup({ loading: true });
  env.visible(); assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 0);
  delete env.root.dataset.landingLoading; env.changed();
  env.visible(); env.docEvents['chemdisk-landing-applied']();
  assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 1);
  await env.readyPlayer();
  const viewer = env.stage.children[0];
  assert.equal(viewer.attrs.unloadable, '');
  assert.match(viewer.attrs.url, /1gCKLbyQZHQvxlYX/);
  viewer.events['load-complete']();
  assert.equal(env.host.dataset.modelState, 'ready');
  assert.equal(env.timers.size, 0);
});

test('image mode, reduced motion and global animation settings avoid loading the WebGL engine', () => {
  for (const options of [{ image: true }, { reduced: true }, { motion: false }]) {
    const env = setup(options); env.visible();
    assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 0);
  }
});

test('banner and side-card share one unchanged scene and script, including switching back from an image', async () => {
  const env = setup(); env.visible(); await env.readyPlayer();
  const viewer = env.stage.children[0]; viewer.events['load-complete']();
  const originalAttributes = { ...viewer.attrs }, unloads = viewer.unloads;
  for (const choice of ['biomolecule-banner', 'biomolecule', 'biomolecule-banner']) {
    env.home.dataset.heroVisual = choice;
    env.docEvents['chemdisk-landing-applied']();
    viewer.events['load-complete']();
    assert.equal(env.host.hidden, false);
    assert.equal(env.host.dataset.modelState, 'ready');
    assert.equal(viewer.unloads, unloads);
    assert.deepEqual(viewer.attrs, originalAttributes);
  }
  env.home.dataset.heroVisual = 'image'; env.docEvents['chemdisk-landing-applied']();
  assert.equal(env.host.hidden, true);
  assert.ok(viewer.unloads > unloads);
  env.home.dataset.heroVisual = 'biomolecule-banner'; env.docEvents['chemdisk-landing-applied']();
  viewer.events['load-complete']();
  assert.equal(env.host.hidden, false);
  assert.equal(env.host.dataset.modelState, 'ready');
  assert.equal(env.stage.children.length, 1);
  assert.equal(env.stage.children[0], viewer);
  assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 1);
});

test('offscreen, hidden tab and pause release the scene; returning resumes it without reimporting the player', async () => {
  const env = setup(); env.visible(); await env.readyPlayer();
  const viewer = env.stage.children[0]; viewer.events['load-complete']();
  env.visible(false); assert.ok(viewer.unloads >= 1);
  env.visible(); assert.ok(viewer.loads >= 2);
  viewer.events['load-complete']();
  env.toggle.events.click(); assert.equal(env.host.dataset.modelState, 'paused');
  assert.equal(env.toggle.attrs['aria-pressed'], 'true');
  env.toggle.events.click(); viewer.events['load-complete']();
  env.context.document.hidden = true; env.docEvents.visibilitychange();
  assert.equal(env.host.dataset.modelState, 'paused');
  env.context.document.hidden = false; env.docEvents.visibilitychange();
  viewer.events['load-complete'](); assert.equal(env.host.dataset.modelState, 'ready');
  env.motion(false); assert.equal(env.host.dataset.modelState, 'paused');
  assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 1);
});

test('network errors and timeouts show fallback, require explicit retry, and do not leave an endless loading state', async () => {
  for (const timeout of [false, true]) {
    const env = setup(); env.visible();
    const script = env.nodes.find((item) => item.tag === 'script');
    if (timeout) [...env.timers.values()].forEach((callback) => callback());
    else script.onerror();
    await env.flush();
    assert.equal(env.host.dataset.modelState, 'error');
    assert.equal(env.retry.hidden, false);
    env.visible(); env.changed();
    assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 1);
    env.retry.events.click(); await env.readyPlayer();
    assert.equal(env.nodes.filter((item) => item.tag === 'script').length, 2);
    env.stage.children.at(-1).events['load-complete']();
    assert.equal(env.host.dataset.modelState, 'ready');
    assert.equal(env.timers.size, 0);
  }
});

test('late completion after disabling animation or retrying cannot restart the wrong scene', async () => {
  const env = setup(); env.visible(); await env.readyPlayer();
  const first = env.stage.children[0];
  env.motion(false); first.events['load-complete']();
  assert.equal(env.host.dataset.modelState, 'paused');
  env.motion(true); first.events['context-loss']();
  assert.equal(env.host.dataset.modelState, 'error');
  env.retry.events.click(); await env.flush();
  const second = env.stage.children.at(-1);
  assert.notEqual(first, second);
  const unloads = second.unloads;
  first.events['load-complete']();
  assert.equal(second.unloads, unloads);
  second.events['load-complete'](); assert.equal(env.host.dataset.modelState, 'ready');
});

test('standalone export keeps the model controller and the model does not overlay links or the pricing section', () => {
  const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
  const builder = fs.readFileSync(require.resolve('../public/members/module/studio/landing/script.js'), 'utf8');
  const css = fs.readFileSync(require.resolve('../public/assets/start_site/style.css'), 'utf8');
  assert.match(html, /src="\/assets\/js\/landing-biomolecule.js"/);
  assert.match(builder, /fetchStaticText\('\/assets\/js\/landing-biomolecule.js'\)/);
  assert.match(builder, /\[motionJs, runtimeJs, moleculeJs\]/);
  assert.match(css, /\.hero-model-canvas \{ position: relative/);
  assert.match(css, /\.hero-model-stage \{ position: absolute; inset: 0/);
  assert.match(css, /\.home\.has-biomolecule-banner \.hero-model \{ position: absolute; inset: 0; z-index: 0;/);
  assert.match(css, /\.home\.has-biomolecule-banner \.hero-model::after \{[^}]*pointer-events: none;/);
  assert.match(css, /\.home-content \{ position: relative; z-index: 2;/);
  assert.match(css, /\.home\.has-biomolecule-banner \.hero-bottom \{ position: relative; z-index: 2;/);
});
