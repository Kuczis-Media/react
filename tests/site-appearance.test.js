'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const appearance = require('../public/assets/js/site-appearance.js');
const landing = require('../netlify/landing-content.js');

test('legacy branding migrates to complete independent palettes without changing existing colors', () => {
  const original = landing.defaultModel();
  original.branding.primaryColor = '#ABCDEF';
  original.branding.backgroundColor = '#123456';
  const model = landing.normalizeModel(original, true);
  for (const scope of appearance.SCOPES) {
    assert.deepEqual(model.branding.palettes[scope], appearance.paletteFor(model.branding, 'landing'));
  }
  assert.notEqual(model.branding.palettes.dashboard, model.branding.palettes.studio);
  assert.equal(original.branding.palettes, undefined, 'Normalization never mutates the caller');
  assert.deepEqual(landing.normalizeModel(model, true), model, 'Normalization is idempotent');
});

test('every palette edit including the landing leaves other areas and shared identity intact', () => {
  for (const scope of ['landing', ...appearance.SCOPES]) {
    const model = landing.defaultModel();
    const before = structuredClone(model.branding);
    appearance.updatePalette(model.branding, scope, { textColor: '#123456', backgroundColor: '#abcdef' });
    for (const other of ['landing', ...appearance.SCOPES]) {
      const palette = appearance.paletteFor(model.branding, other);
      assert.equal(palette.textColor, other === scope ? '#123456' : before.textColor);
      assert.equal(palette.backgroundColor, other === scope ? '#abcdef' : before.backgroundColor);
    }
    assert.equal(model.branding.brandName, before.brandName);
    assert.equal(model.branding.faviconUrl, before.faviconUrl);
  }
});

test('scope matching handles direct documents and never treats course modules as dashboard or Studio', () => {
  const paths = {
    '/': 'landing', '/index.html': 'landing', '/members': 'dashboard', '/members/': 'dashboard', '/members/index.html': 'dashboard',
    '/members/module/studio': 'studio', '/members/module/studio/': 'studio', '/members/module/studio/env/index.html': 'studio', '/members/module/studio/landing/': 'studio',
    '/login/index.html': 'account', '/purchase/': 'account', '/payment-success/': 'account', '/time': 'account', '/time.html': 'account',
    '/members/module/lesson/': 'landing', '/members/module/studio-copy/': 'landing', '/membership/': 'landing'
  };
  for (const [path, scope] of Object.entries(paths)) assert.equal(appearance.scopeForPath(path), scope, path);
});

test('invalid palette shapes and CSS are rejected on save and never interpolated by readers', () => {
  for (const palettes of [null, [], 'red', { unknown: {} }, { studio: [] }, { dashboard: { textColor: 'red;}body{display:none' } }, { account: { primaryColor: 123 } }]) {
    const model = landing.defaultModel(); model.branding.palettes = palettes;
    assert.throws(() => landing.normalizeModel(model, true), { code: 'INVALID_SITE_PALETTE', status: 400 });
  }
  const branding = { primaryColor: '#112233', palettes: { dashboard: { textColor: 'red;}body{display:none', primaryColor: '#445566' } } };
  assert.deepEqual(appearance.paletteFor(branding, 'dashboard'), { primaryColor: '#445566' });
  assert.throws(() => appearance.updatePalette(branding, '__proto__', { textColor: '#123456' }), { code: 'INVALID_SITE_PALETTE' });
  assert.throws(() => appearance.updatePalette(branding, 'studio', { arbitraryCss: '#123456' }), { code: 'INVALID_SITE_PALETTE' });
});

test('scoped palettes survive public serialization and participate in conflict detection', () => {
  const model = landing.defaultModel();
  appearance.updatePalette(model.branding, 'studio', { primaryColor: '#334455' });
  const published = landing.publicModel(model);
  const restored = landing.normalizeModel(JSON.parse(JSON.stringify(published)), true);
  assert.deepEqual(restored.branding.palettes, model.branding.palettes);
  assert.notEqual(landing.comparableModel(model), landing.comparableModel(landing.defaultModel()));
  assert.equal(published.updatedBy, undefined);
});

function builderFixture(search = '') {
  const nodes = new Map();
  const timers = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', hidden: false, textContent: '', dataset: {}, events: {},
      style: { properties: {}, setProperty(key, value) { this.properties[key] = value; } },
      addEventListener(name, fn) { this.events[name] = fn; }
    });
    return nodes.get(id);
  }
  const context = {
    document: { getElementById: node, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    URL, URLSearchParams, crypto: { randomUUID: () => 'test-preview-token' },
    location: { search, origin: 'https://course.example' },
    NextMedAppearance: appearance, addEventListener() {}, clearTimeout() {},
    setTimeout(fn) { timers.push(fn); return timers.length; }
  };
  context.window = context;
  const source = fs.readFileSync(require.resolve('../public/members/module/studio/landing/script.js'), 'utf8');
  // Expose existing closure functions only inside this VM, not in shipped code.
  const hooks = `
    window.testBuilder = {
      setup(value) { defaultModel = clone(value); model = normalizeLocalModel(value); bindEvents(); renderPalette(); },
      snapshot() { return clone(model); }, normalizeLocalModel, applyPalette,
      import(value) { model = normalizeLocalModel(value); renderPalette(); },
      selected() { return selectedPalette; }
    };
  `;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `${hooks}})();`), context);
  context.testBuilder.setup(landing.defaultModel());
  return { node, timers, api: context.testBuilder, snapshot: () => JSON.parse(JSON.stringify(context.testBuilder.snapshot())) };
}

test('builder deep link, color inputs and presets edit only the selected dashboard palette without network', () => {
  const fixture = builderFixture('?palette=dashboard');
  assert.equal(fixture.api.selected(), 'dashboard');
  assert.equal(fixture.node('palette-scope').value, 'dashboard');
  const before = fixture.snapshot();
  fixture.node('branding-text').value = '#112233';
  fixture.node('branding-text').events.input();
  let model = fixture.snapshot();
  assert.equal(model.branding.palettes.dashboard.textColor, '#112233');
  assert.equal(model.branding.textColor, before.branding.textColor);
  assert.deepEqual(model.branding.palettes.studio, before.branding.palettes.studio);
  assert.equal(fixture.node('palette-sample').style.properties['--sample-textColor'], '#112233');
  assert.match(fixture.node('status').textContent, /Dashboard/);
  fixture.api.applyPalette('violet');
  model = fixture.snapshot();
  assert.equal(model.branding.palettes.dashboard.primaryColor, '#6d28d9');
  assert.deepEqual(model.sections, before.sections);
  assert.deepEqual(model.branding.palettes.account, before.branding.palettes.account);
  assert.equal(fixture.timers.length, 2, 'Only two local recovery writes are scheduled; no landing render or network');
});

test('switching scope is read-only; explicit copy, reset and JSON reload retain independent palettes', () => {
  const fixture = builderFixture('?palette=dashboard');
  fixture.api.applyPalette('ocean');
  const before = fixture.snapshot();
  fixture.node('palette-scope').value = 'studio';
  fixture.node('palette-scope').events.change();
  assert.deepEqual(fixture.snapshot(), before);
  fixture.node('branding-background').value = '#abcdef';
  fixture.node('branding-background').events.input();
  const saved = fixture.snapshot();
  fixture.api.import(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(fixture.snapshot(), saved);
  assert.equal(fixture.node('branding-background').value, '#abcdef');
  fixture.node('palette-copy-landing').events.click();
  assert.deepEqual(fixture.snapshot().branding.palettes.studio, appearance.paletteFor(saved.branding, 'landing'));
  assert.deepEqual(fixture.snapshot().branding.palettes.dashboard, saved.branding.palettes.dashboard);
  fixture.node('palette-reset').events.click();
  assert.deepEqual(fixture.snapshot().branding.palettes.dashboard, saved.branding.palettes.dashboard);
  assert.equal(builderFixture('?palette=__proto__').api.selected(), 'landing');
});

test('all branded entry points load the shared palette model and dashboard links directly to its scope', () => {
  for (const path of ['public/members/index.html', 'public/members/module/studio/index.html', 'public/members/module/studio/env/index.html', 'public/members/module/studio/landing/index.html', 'public/login/index.html', 'public/purchase/index.html', 'public/payment-success/index.html', 'public/time.html']) {
    const html = fs.readFileSync(require.resolve(`../${path}`), 'utf8');
    assert.ok(html.indexOf('src="/assets/js/site-appearance.js"') > 0, path);
    assert.ok(html.indexOf('src="/assets/js/site-appearance.js"') < html.indexOf('src="/assets/js/site-brand.js"'), path);
  }
  const studio = fs.readFileSync(require.resolve('../public/members/module/studio/index.html'), 'utf8');
  assert.match(studio, /href="\/members\/module\/studio\/landing\/\?palette=dashboard#appearance"/);
});
