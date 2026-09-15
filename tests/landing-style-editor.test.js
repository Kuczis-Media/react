'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const defaults = require('../public/assets/data/landing-default.json');

function editor() {
  const source = fs.readFileSync(require.resolve('../public/members/module/studio/landing/script.js'), 'utf8');
  const context = { URL, URLSearchParams, location: { search: '', origin: 'https://course.example' }, crypto: { randomUUID: () => 'editor-preview-token' },
    NextMedAppearance: require('../public/assets/js/site-appearance.js'),
    document: { getElementById: () => ({}), querySelector: () => ({}), addEventListener() {} }, defaults
  };
  context.window = context;
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'defaultModel = defaults; window.editorTest = {normalizeLocalModel, validationIssue, serializeEmbeddedModel}; })();');
  vm.runInNewContext(instrumented, context);
  return context.editorTest;
}

test('all three hero layouts round-trip through the editor and standalone export without losing the image', () => {
  const tools = editor();
  const html = fs.readFileSync(require.resolve('../public/members/module/studio/landing/index.html'), 'utf8');
  const input = structuredClone(defaults);
  input.sections[0].imageUrl = 'https://images.example/hero.webp';
  for (const choice of ['biomolecule', 'biomolecule-banner', 'image', 'biomolecule']) {
    input.sections[0].heroVisual = choice;
    const normalized = tools.normalizeLocalModel(input);
    assert.equal(tools.validationIssue(normalized), '');
    const exported = JSON.parse(tools.serializeEmbeddedModel(normalized));
    assert.equal(exported.sections[0].heroVisual, choice);
    assert.equal(exported.sections[0].imageUrl, input.sections[0].imageUrl);
    assert.ok(html.includes(`<option value="${choice}">`));
  }
});

test('editor keeps hero choice and independent form styles in imported JSON and standalone export model', () => {
  const tools = editor();
  const input = structuredClone(defaults);
  input.sections[0].heroVisual = 'image';
  const contact = input.sections.find((section) => section.id === 'contact');
  const values = { formBackgroundColor: '#112233', fieldBackgroundColor: '#223344', fieldTextColor: '#ffffff', fieldBorderColor: '#667788', fieldFocusColor: '#aabbcc', labelTextColor: '#ddeeff' };
  Object.assign(contact, values);
  const normalized = tools.normalizeLocalModel(input);
  assert.equal(tools.validationIssue(normalized), '');
  const exported = JSON.parse(tools.serializeEmbeddedModel(normalized));
  assert.equal(exported.sections[0].heroVisual, 'image');
  for (const [key, value] of Object.entries(values)) assert.equal(exported.sections.find((section) => section.id === 'contact')[key], value);
  assert.equal(exported.branding.backgroundColor, input.branding.backgroundColor);
  assert.equal(exported.sections[1].fieldBackgroundColor, undefined);
  contact.fieldBackgroundColor = '';
  assert.equal(tools.normalizeLocalModel(input).sections.find((section) => section.id === 'contact').fieldBackgroundColor, '');
});

test('editor rejects malformed scene/style settings and handles invalid imported sections safely', () => {
  const tools = editor();
  const input = structuredClone(defaults);
  assert.equal(tools.normalizeLocalModel(input).sections[0].heroVisual, 'biomolecule');
  input.sections[0].heroVisual = 'untrusted-model';
  assert.match(tools.validationIssue(input), /model 3D albo obraz/);
  input.sections[0].heroVisual = 'biomolecule';
  input.sections.find((section) => section.id === 'contact').fieldBackgroundColor = 'red;display:none';
  assert.match(tools.validationIssue(input), /niepoprawny kolor/);
  input.sections[0] = null;
  assert.match(tools.validationIssue(input), /sześć sekcji/);
});

test('contact controls are separate, resettable and mapped to the same saved fields', () => {
  const html = fs.readFileSync(require.resolve('../public/members/module/studio/landing/index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../public/assets/start_site/style.css'), 'utf8');
  for (const field of ['formBackgroundColor', 'fieldBackgroundColor', 'fieldTextColor', 'fieldBorderColor', 'fieldFocusColor', 'labelTextColor']) {
    assert.ok(html.includes(`data-clear-color="${field}"`));
  }
  assert.match(html, /id="contact-colors" hidden open/);
  assert.match(html, /id="section-hero-visual"/);
  assert.match(css, /background: var\(--contact-field-background, var\(--brand-surface\)\)/);
  assert.match(css, /color: var\(--contact-field-text, var\(--brand-text\)\)/);
  assert.match(css, /input:-webkit-autofill[^}]+--contact-field-background/);
  assert.match(css, /input:autofill[^}]+--contact-field-background/);
});

test('native field-color input and change events reach the live preview without editing the section or page background', () => {
  const source = fs.readFileSync(require.resolve('../public/members/module/studio/landing/script.js'), 'utf8');
  const nodes = new Map(), previews = [];
  const node = () => ({ value: '', dataset: {}, events: {}, children: [],
    style: { setProperty() {} }, setCustomValidity(message) { this.validationMessage = message; },
    addEventListener(name, callback) { this.events[name] = callback; },
    setAttribute() {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    contentWindow: { postMessage(message) { previews.push(message); } }
  });
  const byId = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = { URL, URLSearchParams, location: { search: '', origin: 'https://course.example' }, crypto: { randomUUID: () => 'color-test' }, defaults,
    NextMedAppearance: require('../public/assets/js/site-appearance.js'),
    document: { getElementById: byId, querySelector: () => node(), createElement: node, addEventListener() {} },
    setTimeout() {}, clearTimeout() {}, requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {}
  };
  context.window = context;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    defaultModel = defaults; model = normalizeLocalModel(defaults); selectedId = 'contact'; previewReady = true;
    bindContactColorEvents(); window.colorTest = { model, select: (id) => { selectedId = id; } }; })();`), context);
  for (const event of ['input', 'change']) {
    const input = byId('contact-field-background');
    input.value = event === 'input' ? '#123456' : '#654321';
    input.events[event]();
    const rendered = previews.at(-1).model;
    const contact = rendered.sections.find((section) => section.id === 'contact');
    assert.equal(contact.fieldBackgroundColor, input.value);
    assert.equal(contact.backgroundColor, '');
    assert.equal(rendered.branding.backgroundColor, defaults.branding.backgroundColor);
    assert.equal(rendered.sections[0].fieldBackgroundColor, undefined);
    assert.equal(contact.formBackgroundColor, '');
  }
  const count = previews.length;
  byId('contact-field-background').events.change();
  assert.equal(previews.length, count, 'Committing the same value does not render twice');
  const hex = byId('contact-field-background-hex');
  assert.equal(hex.value, '#654321');
  hex.value = '#ABCDEF'; hex.events.input();
  assert.equal(byId('contact-field-background').value, '#abcdef');
  assert.equal(previews.at(-1).model.sections.find((section) => section.id === 'contact').fieldBackgroundColor, '#abcdef');
  assert.equal(previews.at(-1).model.branding.backgroundColor, defaults.branding.backgroundColor);
  hex.value = 'red'; hex.events.input();
  assert.ok(hex.validationMessage);
  assert.equal(previews.length, count + 1, 'Incomplete or invalid codes never alter the saved model');
  context.colorTest.select('home');
  byId('contact-field-background').value = '#ffffff';
  byId('contact-field-background').events.change();
  assert.equal(previews.length, count + 1, 'A late picker event never edits another section');
});

test('contact submit buttons have breathing room after CAPTCHA on landing and dashboard forms', () => {
  const landing = fs.readFileSync(require.resolve('../public/assets/start_site/style.css'), 'utf8');
  const members = fs.readFileSync(require.resolve('../public/members/module/contact/style.css'), 'utf8');
  assert.match(landing, /\.contact form \.button-area\s*\{[^}]*margin-top: 24px/);
  assert.match(members, /\.right-side \.button\s*\{[^}]*margin-top: 24px/);
});

test('a pasted jsDelivr logo and reopening the image picker never require the optional repository', async () => {
  const source = fs.readFileSync(require.resolve('../public/members/module/studio/landing/script.js'), 'utf8');
  const nodes = new Map(), requests = [], previews = [];
  const node = () => ({ value: '', dataset: {}, events: {}, children: [], open: false,
    addEventListener(name, callback) { this.events[name] = callback; },
    setAttribute() {}, removeAttribute() {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    querySelector() { return this.child || (this.child = node()); },
    showModal() { this.open = true; }, close() { this.open = false; },
    contentWindow: { postMessage(message) { previews.push(message); } }
  });
  const byId = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = { URL, URLSearchParams, AbortController, location: { search: '', origin: 'https://course.example' }, crypto: { randomUUID: () => 'assets-test' }, defaults,
    NextMedAppearance: require('../public/assets/js/site-appearance.js'), ChemAuth: { getAccessToken: async () => 'test-token' },
    document: { getElementById: byId, querySelector: () => node(), createElement: node, addEventListener() {} },
    setTimeout() {}, clearTimeout() {},
    fetch: async (url) => { requests.push(url); return { ok: false, status: 503, json: async () => ({ error: 'SITE_ASSETS_NOT_CONFIGURED' }) }; }
  };
  context.window = context;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `defaultModel = defaults; model = normalizeLocalModel(defaults); previewReady = true;
    window.assetTest = {openAssetLibrary, useAssetUrl, loadAssets, renderBrandingPreview, model}; })();`), context);
  const tools = context.assetTest;
  await tools.openAssetLibrary('logo');
  assert.equal(requests.length, 0);
  const url = 'https://cdn.jsdelivr.net/gh/example/media@main/logo.svg';
  byId('asset-url').value = url; tools.useAssetUrl();
  assert.equal(tools.model.branding.logoUrl, url);
  assert.equal(previews.at(-1).model.branding.logoUrl, url);
  const image = byId('logo-preview').querySelector('img');
  image.onload();
  tools.renderBrandingPreview();
  assert.equal(byId('logo-preview').dataset.state, 'ready');
  assert.equal(byId('asset-dialog').open, false);
  assert.equal(requests.length, 0);
  await tools.openAssetLibrary('logo');
  assert.equal(byId('asset-url').value, url);
  assert.equal(requests.length, 0);
  await tools.loadAssets(true);
  assert.equal(requests.length, 1, 'Only an explicit library browse contacts its repository');
  assert.equal(byId('asset-status').dataset.state, 'error');
  await tools.openAssetLibrary('logo');
  assert.equal(requests.length, 1, 'A failed optional repository is not queried on every open');
  assert.equal(byId('asset-status').dataset.state, '');
  byId('asset-url').value = 'javascript:alert(1)'; tools.useAssetUrl();
  assert.equal(tools.model.branding.logoUrl, url);
});

test('landing logo reserves its own row and a positive gap before the tagline', () => {
  const css = fs.readFileSync(require.resolve('../public/assets/start_site/style.css'), 'utf8');
  assert.match(css, /\.navbar \.logo \{[^}]*row-gap: 8px/);
  assert.match(css, /\.navbar \.logo > small \{[^}]*margin: 0/);
  assert.match(css, /\.navbar \.logo a\.has-brand-image img \{[^}]*display: block;[^}]*max-height: 44px/);
});
