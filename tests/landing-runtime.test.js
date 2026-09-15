'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STATIC_CONFIG_URL = 'https://raw.githubusercontent.com/Kuczis-Media/logo/main/landing/config.json';
const SECTION_IDS = ['home', 'about', 'services', 'pricing', 'skills', 'contact'];

function runtimeModel(revision, prefix = 'Model') {
  return {
    version: 3,
    revision,
    branding: {
      brandName: 'NextMed',
      logoUrl: '',
      logoAlt: 'NextMed',
      siteTitle: `${prefix} — NextMed`,
      siteDescription: `${prefix} opis`,
      primaryColor: '#0f766e'
    },
    sections: SECTION_IDS.map((id, order) => ({
      id,
      order,
      enabled: true,
      title: `${prefix} ${id}`,
      subtitle: '',
      body: '',
      imageUrl: '',
      imageAlt: '',
      backgroundColor: '',
      textColor: '',
      accentColor: '',
      ctaLabel: '',
      ctaHref: ''
    }))
  };
}

function routedRuntime({ route, payload, cache, hash = '', hostname = 'course.example' } = {}) {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const dom = landingDom({ staticConfigUrl: STATIC_CONFIG_URL });
  dom.document.documentElement.dataset.landingLoading = 'true';
  const calls = [], redirects = [];
  const storage = new Map(cache ? [['chem.landing.public.v3', JSON.stringify(cache)]] : []);
  const context = {
    document: dom.document, URL, AbortController, setTimeout, clearTimeout, CustomEvent: class {},
    NextMedLandingSource: { ready: Promise.resolve(route || delivery.normalize()) }, NextMedLandingDelivery: delivery,
    location: { search: '?private=query', hash, hostname, replace: (url) => redirects.push(url) },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => payload }; }
  };
  context.window = context; context.parent = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/landing-runtime.js'), 'utf8'), context);
  return { ...dom, calls, redirects, storage, settled: () => new Promise((resolve) => setImmediate(resolve)) };
}

test('runtime applies and resets contact field colors locally without recoloring the page or other sections', async () => {
  const result = routedRuntime(); await result.settled();
  const model = runtimeModel(1);
  const contact = model.sections.find((section) => section.id === 'contact');
  const fields = { formBackgroundColor: '--contact-form-background', fieldBackgroundColor: '--contact-field-background', fieldTextColor: '--contact-field-text', fieldBorderColor: '--contact-field-border', fieldFocusColor: '--contact-field-focus', labelTextColor: '--contact-label-text' };
  Object.keys(fields).forEach((key) => { contact[key] = '#112233'; });
  const context = { window: null, document: result.document, URL, CustomEvent: class {}, location: { search: '?landing-preview=1' }, parent: {}, addEventListener() {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/landing-runtime.js'), 'utf8'), context);
  assert.equal(context.NextMedLanding.applyModel(model), true);
  for (const variable of Object.values(fields)) {
    assert.equal(result.sections.contact.style.values[variable], '#112233');
    assert.equal(result.sections.home.style.values[variable], undefined);
    assert.equal(result.document.documentElement.style.values[variable], undefined);
  }
  const controls = result.sections.contact.querySelectorAll('form input:not([type="hidden"]):not([type="submit"]), form textarea');
  assert.equal(controls.length, 4);
  for (const input of controls) {
    assert.equal(input.style.values['background-color'], '#112233');
    assert.equal(input.style.values.color, '#112233');
  }
  model.branding.backgroundColor = '#abcdef';
  context.NextMedLanding.applyModel(model);
  for (const input of controls) assert.equal(input.style.values['background-color'], '#112233', 'Changing the page background preserves the chosen field background');
  Object.keys(fields).forEach((key) => { contact[key] = ''; });
  context.NextMedLanding.applyModel(model);
  for (const variable of Object.values(fields)) assert.equal(result.sections.contact.style.values[variable], undefined);
  for (const input of controls) {
    assert.equal(input.style.values['background-color'], undefined);
    assert.equal(input.style.values.color, undefined);
  }
});

test('3D hero replaces a previously configured background and image mode restores it without losing the URL', async () => {
  const model = runtimeModel(2); model.sections[0].imageUrl = 'https://images.example/hero.webp';
  const result = routedRuntime({ payload: { active: true, model } }); await result.settled();
  assert.equal(result.sections.home.dataset.heroVisual, 'biomolecule');
  assert.equal(result.sections.home.classList.contains('has-biomolecule'), true);
  assert.equal(result.sections.home.classList.contains('has-hero-image'), false);
  assert.equal(result.sections.home.style.backgroundImage, undefined);
  model.sections[0].heroVisual = 'image';
  const restored = routedRuntime({ payload: { active: true, model } }); await restored.settled();
  assert.equal(restored.sections.home.classList.contains('has-biomolecule'), false);
  assert.equal(restored.sections.home.classList.contains('has-hero-image'), true);
  assert.match(restored.sections.home.style.backgroundImage, /hero.webp/);
  assert.equal(restored.navbar.classList.contains('over-hero-image'), true);
});

test('live preview switches banner, image and side-card on the same DOM, restoring classes and navigation', () => {
  const dom = landingDom();
  const context = { window: null, document: dom.document, URL, CustomEvent: class {}, location: { search: '?landing-preview=1' }, parent: {}, addEventListener() {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/landing-runtime.js'), 'utf8'), context);
  const model = runtimeModel(1);
  const hero = model.sections[0];
  Object.assign(hero, { imageUrl: 'https://images.example/hero.webp', backgroundColor: '#ffffff', textColor: '#ff0088' });
  for (const mode of ['biomolecule', 'biomolecule-banner', 'image', 'biomolecule-banner', 'biomolecule', 'image']) {
    hero.heroVisual = mode;
    assert.equal(context.NextMedLanding.applyModel(model), true);
    assert.equal(dom.sections.home.dataset.heroVisual, mode);
    assert.equal(dom.sections.home.classList.contains('has-biomolecule-banner'), mode === 'biomolecule-banner');
    assert.equal(dom.sections.home.classList.contains('has-biomolecule'), mode !== 'image');
    assert.equal(dom.sections.home.classList.contains('has-hero-image'), mode === 'image');
    assert.equal(dom.navbar.classList.contains('over-hero-image'), mode !== 'biomolecule');
    assert.equal(dom.navbar.classList.contains('landing-solid'), mode === 'biomolecule');
    assert.equal(dom.sections.home.style.values['--landing-text'], '#ff0088');
    if (mode === 'image') assert.match(dom.sections.home.style.backgroundImage, /hero.webp/);
    else assert.equal(dom.sections.home.style.backgroundImage, undefined);
  }
  hero.heroVisual = 'biomolecule-banner';
  hero.enabled = false;
  context.NextMedLanding.applyModel(model);
  assert.equal(dom.navbar.classList.contains('over-hero-image'), false);
  assert.equal(dom.navbar.classList.contains('landing-solid'), true);
});

test('editing landing copy reuses the loaded logo and removing it restores only the text brand', () => {
  const dom = landingDom();
  const context = { window: null, document: dom.document, URL, CustomEvent: class {}, location: { search: '?landing-preview=1' }, parent: {}, addEventListener() {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/landing-runtime.js'), 'utf8'), context);
  const model = runtimeModel(1);
  model.branding.logoUrl = 'https://cdn.jsdelivr.net/gh/example/media@main/logo.svg';
  context.NextMedLanding.applyModel(model);
  const image = dom.brand.children[0];
  image.onload();
  assert.equal(dom.brand.dataset.logoState, 'ready');
  model.branding.brandName = 'New Name';
  model.sections[0].title = 'New title';
  context.NextMedLanding.applyModel(model);
  assert.equal(dom.brand.children.length, 1);
  assert.equal(dom.brand.children[0], image);
  assert.equal(dom.brand.dataset.logoState, 'ready');
  model.branding.logoUrl = '';
  context.NextMedLanding.applyModel(model);
  image.onerror();
  assert.equal(dom.brand.dataset.logoState, 'fallback');
  assert.equal(dom.brand.classList.contains('has-brand-image'), false);
  assert.equal(dom.brand.children[0].textContent, 'New Name');
});

test('landing waits for the selected JSON before rendering and isolates cache from another repository', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const route = delivery.normalize({ target: { repository: 'NextMed/web', path: 'start.json', ref: 'main' } });
  let resolveSource, resolvePayload;
  const source = new Promise((resolve) => { resolveSource = resolve; });
  const payload = new Promise((resolve) => { resolvePayload = resolve; });
  const result = routedRuntime({ route: source, payload, cache: { model: runtimeModel(99, 'Wrong repository'), checkedAt: Date.now(), configUrl: STATIC_CONFIG_URL } });
  await result.settled();
  assert.equal(result.calls.length, 0);
  assert.equal(result.document.title, 'Tytuł statyczny');
  resolveSource(route);
  await result.settled();
  assert.equal(result.calls[0].url, delivery.rawUrl(route.target));
  assert.equal(result.calls[0].options.credentials, 'omit');
  assert.equal(result.document.documentElement.dataset.landingLoading, 'true');
  assert.equal(result.document.title, 'Tytuł statyczny');
  resolvePayload({ active: true, model: runtimeModel(1, 'Selected') });
  await result.settled();
  assert.equal(result.document.title, 'Selected — NextMed');
  assert.equal(result.document.documentElement.dataset.landingLoading, undefined);
  assert.equal(result.calls.length, 1);
  assert.equal(JSON.parse(result.storage.get('chem.landing.public.v3')).configUrl, delivery.rawUrl(route.target));
});

test('fresh cache from the selected file renders without another config request', async () => {
  const result = routedRuntime({ cache: { model: runtimeModel(5, 'Cached'), checkedAt: Date.now(), configUrl: STATIC_CONFIG_URL } });
  await result.settled();
  assert.equal(result.document.title, 'Cached — NextMed');
  assert.equal(result.calls.length, 0);
  assert.equal(result.document.documentElement.dataset.landingLoading, undefined);
});

test('an explicit Blob publication renders without a GitHub request even if a fresh GitHub cache has a higher revision', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const route = { ...delivery.normalize(), publication: { mode: 'netlify-blobs', version: 'new-publication', active: true, model: runtimeModel(1, 'Blobs live') } };
  const result = routedRuntime({ route, cache: { model: runtimeModel(90, 'Stale GitHub'), checkedAt: Date.now(), configUrl: STATIC_CONFIG_URL } });
  await result.settled();
  assert.equal(result.document.title, 'Blobs live — NextMed');
  assert.equal(result.calls.length, 0);
  assert.equal(JSON.parse(result.storage.get('chem.landing.public.v3')).configUrl, '/.netlify/functions/landing');
});

test('a changed GitHub publication version refreshes an otherwise fresh cache', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const route = { ...delivery.normalize(), publication: { mode: 'static-github', version: 'new-publication', active: false } };
  const result = routedRuntime({ route, payload: { active: true, model: runtimeModel(3, 'Published now') }, cache: {
    model: runtimeModel(2, 'Previous'), checkedAt: Date.now(), configUrl: STATIC_CONFIG_URL, publicationVersion: 'previous-publication'
  } });
  await result.settled();
  assert.equal(result.document.title, 'Published now — NextMed');
  assert.equal(result.calls.length, 1);
  assert.equal(JSON.parse(result.storage.get('chem.landing.public.v3')).publicationVersion, 'new-publication');
});

test('an inactive publication clears an expired cache without reapplying it', async () => {
  const result = routedRuntime({ payload: { active: false }, cache: { model: runtimeModel(5, 'Retired'), checkedAt: 1, configUrl: STATIC_CONFIG_URL } });
  await result.settled();
  assert.equal(result.document.title, 'Tytuł statyczny');
  assert.equal(result.storage.has('chem.landing.public.v3'), false);
  assert.equal(result.document.documentElement.dataset.landingLoading, undefined);
});

test('an older CDN response for the same destination cannot roll back a newer cached publication', async () => {
  const result = routedRuntime({ payload: { active: true, model: runtimeModel(3, 'Old CDN') }, cache: { model: runtimeModel(9, 'Latest'), checkedAt: 1, configUrl: STATIC_CONFIG_URL } });
  await result.settled();
  assert.equal(result.document.title, 'Latest — NextMed');
  assert.equal(JSON.parse(result.storage.get('chem.landing.public.v3')).model.revision, 9);
});

test('external landing redirect does not forward the incoming query or fragment and does not fetch content', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const result = routedRuntime({ route: delivery.normalize({ externalEnabled: true, externalUrl: 'https://start.netlify.app/welcome' }), hash: '#private-fragment' });
  await result.settled();
  assert.deepEqual(result.redirects, ['https://start.netlify.app/welcome']);
  assert.equal(result.calls.length, 0);
});

test('external redirect skips login tokens and the destination domain itself', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const route = delivery.normalize({ externalEnabled: true, externalUrl: 'https://start.netlify.app/' });
  for (const options of [{ hash: '#access_token=private' }, { hostname: 'start.netlify.app' }]) {
    const result = routedRuntime({ ...options, route, payload: { active: true, model: runtimeModel(1, 'Local') } });
    await result.settled();
    assert.equal(result.redirects.length, 0);
    assert.equal(result.document.title, 'Local — NextMed');
  }
});

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeStyle {
  constructor() { this.values = {}; }
  setProperty(name, value) { this.values[name] = value; }
  removeProperty(name) {
    delete this.values[name];
    delete this[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.dataset = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.className = '';
    this.children = [];
    this.attributes = new Map();
    this.selectors = new Map();
    this.textContent = '';
    this.parent = null;
  }
  addEventListener(name, listener) { this[`on${name}`] = listener; }
  append(...nodes) { nodes.forEach((node) => this.insert(node, false)); }
  prepend(...nodes) { [...nodes].reverse().forEach((node) => this.insert(node, true)); }
  insert(node, first) {
    if (node && typeof node === 'object' && node.parent) {
      const previousIndex = node.parent.children.indexOf(node);
      if (previousIndex >= 0) node.parent.children.splice(previousIndex, 1);
    }
    if (node && typeof node === 'object') node.parent = this;
    if (first) this.children.unshift(node);
    else this.children.push(node);
  }
  insertBefore(node, reference) {
    if (node && typeof node === 'object' && node.parent) {
      const previousIndex = node.parent.children.indexOf(node);
      if (previousIndex >= 0) node.parent.children.splice(previousIndex, 1);
    }
    if (node && typeof node === 'object') node.parent = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }
  after(node) {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (node && typeof node === 'object') node.parent = this.parent;
    this.parent.children.splice(index < 0 ? this.parent.children.length : index + 1, 0, node);
  }
  before(node) { this.beforeCalls = [...(this.beforeCalls || []), node]; }
  replaceChildren(...nodes) {
    this.children = [];
    this.textContent = '';
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) {
    if (this.selectors.has(selector)) return this.selectors.get(selector);
    if (selector === '.landing-section-image') return this.findByClass('landing-section-image');
    return null;
  }
  querySelectorAll(selector) {
    assert.equal(selector, 'form input:not([type="hidden"]):not([type="submit"]), form textarea');
    const descendants = (element) => element.children.flatMap((child) => child instanceof FakeElement ? [child, ...descendants(child)] : []);
    return descendants(this).filter((child) => child.tagName === 'TEXTAREA'
      || (child.tagName === 'INPUT' && !['hidden', 'submit'].includes(child.attributes.get('type'))));
  }
  findByClass(name) {
    for (const child of this.children) {
      if (!child || typeof child !== 'object') continue;
      if (String(child.className || '').split(/\s+/).includes(name)) return child;
      const nested = typeof child.findByClass === 'function' ? child.findByClass(name) : null;
      if (nested) return nested;
    }
    return null;
  }
  closest(selector) { return selector === 'li' ? this.listItem || null : null; }
}

function landingDom(options = {}) {
  const main = new FakeElement('main');
  const ids = SECTION_IDS;
  const targetSelectors = {
    home: ['.text-2', '.text-1', '.text-3', '#login-cta'],
    about: ['.title', '.column.right .text', '.column.right p', '.column.left img', '.column.right a'],
    services: ['.title', '.landing-section-subtitle', '.landing-section-body', '.landing-section-cta'],
    pricing: ['.title', '.landing-section-subtitle', '.pricing-intro', '.landing-section-cta'],
    skills: ['.title', '.column.left .text', '.column.left p', '.column.left a'],
    contact: ['.title', '.column.left .text', '.column.left > p', '.landing-section-cta']
  };
  const sections = {};
  ids.forEach((id) => {
    const section = new FakeElement('section');
    section.id = id;
    const container = new FakeElement('div');
    section.children.push(container);
    container.parent = section;
    section.selectors.set('.max-width', container);
    targetSelectors[id].forEach((selector) => {
      const element = new FakeElement(selector.includes('img') ? 'img' : selector.includes('a') || selector.includes('cta') ? 'a' : 'div');
      element.textContent = 'wartość statyczna';
      element.setAttribute('src', '/old.png');
      section.selectors.set(selector, element);
      container.children.push(element);
      element.parent = container;
    });
    const lead = section.selectors.get('.landing-section-body')
      || section.selectors.get('.pricing-intro')
      || section.selectors.get('.title');
    if (lead) container.selectors.set('.landing-section-body, .pricing-intro, .title', lead);
    if (id === 'contact') {
      const form = new FakeElement('form');
      for (const type of ['text', 'email', 'text', 'hidden', 'submit', 'textarea']) {
        const control = new FakeElement(type === 'textarea' ? 'textarea' : 'input');
        control.setAttribute('type', type);
        form.append(control);
      }
      container.append(form);
    }
    sections[id] = section;
  });

  const footer = new FakeElement('footer');
  const navbar = new FakeElement('nav');
  const menu = new FakeElement('ul');
  const brand = new FakeElement('a');
  const description = { content: 'opis statyczny' };
  const staticConfig = { content: options.staticConfigUrl || '' };
  const themeColor = { content: '#ffffff' };
  const head = new FakeElement('head');
  const links = Object.fromEntries(ids.map((id) => {
    const link = new FakeElement('a');
    link.listItem = new FakeElement('li');
    link.listItem.id = `nav-${id}`;
    link.listItem.append(link);
    menu.append(link.listItem);
    return [id, link];
  }));
  const fixedMenuItem = new FakeElement('li');
  fixedMenuItem.id = 'nav-login';
  menu.append(fixedMenuItem);
  const document = {
    title: 'Tytuł statyczny',
    documentElement: { dataset: {}, style: new FakeStyle() },
    head,
    events: [],
    getElementById: (id) => id === 'nextmed-landing-model' && options.embeddedModel ? { textContent: JSON.stringify(options.embeddedModel) } : sections[id] || null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (value) => ({ nodeType: 3, textContent: String(value) }),
    dispatchEvent(event) { this.events.push(event); },
    addEventListener() {},
    querySelector(selector) {
      if (selector === 'main') return main;
      if (selector === 'meta[name="nextmed-landing-export"]' && options.embeddedModel) return { content: '1' };
      if (selector === 'meta[name="nextmed-landing-origin"]' && options.embeddedModel) return { content: 'https://course.example' };
      if (selector === 'footer') return footer;
      if (selector === '.navbar') return navbar;
      if (selector === '.navbar .menu') return menu;
      if (selector === '.navbar .logo a') return brand;
      if (selector === 'meta[name="description"]') return description;
      if (selector === 'meta[name="theme-color"]') return themeColor;
      if (selector === 'meta[name="nextmed-landing-config"]') return staticConfig;
      const match = /^\.navbar \.menu a\[href="#([a-z]+)"\]$/.exec(selector);
      return match ? links[match[1]] || null : null;
    },
    querySelectorAll() { return []; }
  };
  return { document, main, sections, footer, navbar, menu, brand, description, staticConfig, themeColor, links };
}

test('live preview accepts only a matching parent, origin and handshake token without network calls', () => {
  const dom = landingDom();
  const messages = []; const handlers = {};
  const parent = { postMessage: (message) => messages.push(message) };
  let requests = 0;
  const context = {
    document: dom.document, parent, location: { origin: 'https://course.example', search: '?landing-preview=1' },
    URL, CustomEvent: class { constructor(type) { this.type = type; } },
    addEventListener: (type, callback) => { handlers[type] = callback; },
    fetch: () => { requests++; throw new Error('Preview must stay local'); }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/landing-runtime.js'), 'utf8'), context);
  const token = '12345678-12345678';
  const send = (data, source = parent, origin = 'https://course.example') => handlers.message({ source, origin, data });
  send({ type: 'nextmed:landing-preview:init', token }, {}, 'https://attacker.example');
  assert.equal(messages.length, 0);
  send({ type: 'nextmed:landing-preview:init', token });
  assert.equal(messages[0].type, 'nextmed:landing-preview:ready');
  send({ type: 'nextmed:landing-preview:model', token: 'wrong-token', model: runtimeModel(1) });
  assert.equal(dom.main.children.length, 0);
  send({ type: 'nextmed:landing-preview:model', token, model: runtimeModel(1, 'Preview') });
  assert.equal(dom.document.title, 'Preview — NextMed');
  assert.equal(dom.main.children.length, 6);
  assert.equal(requests, 0);
});

test('standalone HTML uses only its embedded model, not the live GitHub or Function configuration', () => {
  const model = runtimeModel(2, 'Offline');
  model.branding.motionEnabled = false;
  const dom = landingDom({ embeddedModel: model });
  let requests = 0;
  const context = { document: dom.document, URL, location: { search: '' }, CustomEvent: class {}, fetch: () => { requests++; } };
  context.window = context; context.parent = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/landing-runtime.js'), 'utf8'), context);
  assert.equal(dom.document.title, 'Offline — NextMed');
  assert.equal(dom.document.documentElement.dataset.motion, 'off');
  assert.equal(dom.main.children.length, 6);
  assert.equal(requests, 0);
});

test('published landing runtime applies a fresh v3 cache without any network request', () => {
  const dom = landingDom();
  const model = {
    version: 3,
    revision: 7,
    branding: {
      brandName: 'NextMed', logoUrl: '', logoAlt: 'NextMed', siteTitle: 'NextMed — test', siteDescription: 'Opis NextMed', primaryColor: '#0f766e'
    },
    sections: [
      { id: 'home', order: 2, enabled: false, title: '', subtitle: '', body: '', imageUrl: '', imageAlt: '', backgroundColor: '', textColor: '', accentColor: '', ctaLabel: '', ctaHref: '' },
      { id: 'about', order: 1, enabled: true, title: '', subtitle: '', body: '', imageUrl: '', imageAlt: '', backgroundColor: '', textColor: '', accentColor: '', ctaLabel: 'Bez linku', ctaHref: '' },
      { id: 'services', order: 0, enabled: true, title: 'Nowe usługi', subtitle: 'Podtytuł', body: 'Opis', imageUrl: 'https://cdn.example/service.webp', imageAlt: 'Usługi', backgroundColor: '#123456', textColor: '#ffffff', accentColor: '#abcdef', ctaLabel: 'Więcej', ctaHref: '/members/' },
      { id: 'pricing', order: 3, enabled: true, title: 'Cennik', subtitle: '', body: '', imageUrl: '', imageAlt: '', backgroundColor: '', textColor: '', accentColor: '', ctaLabel: '', ctaHref: '' },
      { id: 'skills', order: 4, enabled: true, title: 'Start', subtitle: '', body: '', imageUrl: '', imageAlt: '', backgroundColor: '', textColor: '', accentColor: '', ctaLabel: '', ctaHref: '' },
      { id: 'contact', order: 5, enabled: true, title: 'Kontakt', subtitle: '', body: '', imageUrl: '', imageAlt: '', backgroundColor: '', textColor: '', accentColor: '', ctaLabel: '', ctaHref: '' }
    ]
  };
  const storage = new Map([['chem.landing.public.v3', JSON.stringify({ model, checkedAt: Date.now(), source: 'static' })]]);
  let fetchCalls = 0;
  const context = {
    console,
    document: dom.document,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    fetch: async () => { fetchCalls += 1; return { ok: false }; },
    AbortController,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    URL
  };
  context.window = context;
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};

  const script = fs.readFileSync(path.join(__dirname, '../public/assets/js/landing-runtime.js'), 'utf8');
  vm.runInNewContext(script, context, { filename: 'landing-runtime.js' });

  assert.equal(dom.sections.home.hidden, true);
  assert.equal(dom.sections.home.style.backgroundImage, undefined);
  assert.equal(dom.sections.about.selectors.get('.title').textContent, '');
  assert.equal(dom.sections.about.selectors.get('.title').hidden, true);
  assert.equal(dom.sections.about.selectors.get('.column.left img').hidden, true);
  assert.equal(dom.sections.about.classList.contains('landing-no-image'), true);
  assert.equal(dom.sections.about.selectors.get('.column.right a').hidden, true);
  assert.equal(dom.sections.about.selectors.get('.column.right a').attributes.has('href'), false);
  assert.equal(dom.sections.services.selectors.get('.title').textContent, 'Nowe usługi');
  assert.equal(dom.sections.services.style.values['background-color'], '#123456');
  assert.equal(dom.sections.services.style.values['--landing-accent'], '#abcdef');
  assert.equal(dom.sections.services.querySelector('.landing-section-image').attributes.get('src'), undefined);
  assert.equal(dom.sections.services.querySelector('.landing-section-image').src, 'https://cdn.example/service.webp');
  assert.equal(dom.sections.services.selectors.get('.landing-section-cta').attributes.get('href'), '/members/');
  assert.equal(dom.links.home.listItem.hidden, true);
  assert.equal(dom.links.about.listItem.hidden, false);
  assert.equal(dom.navbar.classList.contains('landing-solid'), true);
  assert.deepEqual(dom.menu.children.map((item) => item.id), ['nav-services', 'nav-about', 'nav-home', 'nav-pricing', 'nav-skills', 'nav-contact', 'nav-login']);
  assert.deepEqual(dom.main.children.map((section) => section.id), ['services', 'about', 'home', 'pricing', 'skills', 'contact']);
  assert.equal(dom.document.title, 'NextMed — test');
  assert.equal(dom.description.content, 'Opis NextMed');
  assert.equal(dom.document.documentElement.style.values['--brand-primary'], '#0f766e');
  assert.equal(dom.brand.classList.contains('has-brand-image'), false);
  assert.equal(dom.brand.children[0].textContent, 'NextMed');
  assert.equal(dom.document.documentElement.dataset.landingPublished, 'true');
  assert.equal(dom.document.events[0].detail.revision, 7);
  assert.equal(fetchCalls, 0);
});

test('landing runtime uses a solid navbar over a light hero without an image', () => {
  const dom = landingDom();
  const model = {
    revision: 1,
    branding: {},
    sections: [
      { id: 'home', order: 0, enabled: true, title: '', subtitle: '', body: '', imageUrl: '', backgroundColor: '#ffffff', ctaLabel: '', ctaHref: '' },
      ...['about', 'services', 'pricing', 'skills', 'contact'].map((id, index) => ({ id, order: index + 1, enabled: true, title: '', subtitle: '', body: '', imageUrl: '', ctaLabel: '', ctaHref: '' }))
    ]
  };
  const context = {
    console,
    document: dom.document,
    localStorage: { getItem: () => JSON.stringify(model), setItem: () => {}, removeItem: () => {} },
    fetch: async () => ({ ok: false }),
    AbortController,
    CustomEvent: class CustomEvent {},
    URL
  };
  context.window = context;
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/landing-runtime.js'), 'utf8'), context);
  assert.equal(dom.navbar.classList.contains('landing-solid'), true);
});

test('landing runtime leaves checked-in HTML untouched when neither cache nor Function is available', async () => {
  const dom = landingDom();
  const context = {
    console,
    document: dom.document,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async () => { throw new Error('offline'); },
    AbortController,
    CustomEvent: class CustomEvent {},
    URL
  };
  context.window = context;
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};

  const script = fs.readFileSync(path.join(__dirname, '../public/assets/js/landing-runtime.js'), 'utf8');
  vm.runInNewContext(script, context, { filename: 'landing-runtime.js' });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(dom.document.title, 'Tytuł statyczny');
  assert.equal(dom.sections.about.selectors.get('.title').textContent, 'wartość statyczna');
  assert.equal(dom.document.documentElement.dataset.landingPublished, undefined);
  assert.equal(dom.footer.beforeCalls, undefined);
});

test('an error from an obsolete logo request cannot replace the newer logo', async () => {
  const dom = landingDom();
  const sections = ['home', 'about', 'services', 'pricing', 'skills', 'contact'].map((id, order) => ({
    id, order, enabled: true, title: id, subtitle: '', body: '', imageUrl: '', imageAlt: '', ctaLabel: '', ctaHref: ''
  }));
  const cached = { revision: 1, branding: { logoUrl: 'https://cdn.example/old.svg', logoAlt: 'Stare' }, sections };
  const fresh = { revision: 2, branding: { logoUrl: 'https://cdn.example/new.svg', logoAlt: 'Nowe' }, sections };
  const context = {
    console,
    document: dom.document,
    localStorage: { getItem: () => JSON.stringify(cached), setItem: () => {}, removeItem: () => {} },
    fetch: async () => ({ ok: true, json: async () => ({ active: true, model: fresh }) }),
    AbortController,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    URL,
    location: { reload() {} }
  };
  context.window = context;
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/landing-runtime.js'), 'utf8'), context);
  const obsoleteImage = dom.brand.children[0];
  await new Promise((resolve) => setImmediate(resolve));
  const currentImage = dom.brand.children[0];
  assert.equal(currentImage.src, 'https://cdn.example/new.svg');
  obsoleteImage.onerror();
  assert.equal(dom.brand.children[0], currentImage);
  assert.equal(dom.brand.classList.contains('has-brand-image'), true);
});

test('an inactive server model clears a previously applied cache and restores static HTML once', async () => {
  const dom = landingDom();
  const model = {
    revision: 1,
    branding: {},
    sections: ['home', 'about', 'services', 'pricing', 'skills', 'contact'].map((id, order) => ({
      id, order, enabled: true, title: `Cache ${id}`, subtitle: '', body: '', imageUrl: '', ctaLabel: '', ctaHref: ''
    }))
  };
  const storage = new Map([['chem.landing.public.v2', JSON.stringify(model)]]);
  let reloads = 0;
  const context = {
    console,
    document: dom.document,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    fetch: async () => ({ ok: true, json: async () => ({ active: false }) }),
    AbortController,
    CustomEvent: class CustomEvent {},
    URL,
    location: { reload: () => { reloads += 1; } }
  };
  context.window = context;
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/landing-runtime.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.has('chem.landing.public.v2'), false);
  assert.equal(reloads, 1);
});

test('a blocked landing cache cannot cause an endless reload loop', async () => {
  const dom = landingDom();
  const model = {
    revision: 1,
    branding: {},
    sections: ['home', 'about', 'services', 'pricing', 'skills', 'contact'].map((id, order) => ({
      id, order, enabled: true, title: id, subtitle: '', body: '', imageUrl: '', ctaLabel: '', ctaHref: ''
    }))
  };
  let reloads = 0;
  const context = {
    console,
    document: dom.document,
    localStorage: {
      getItem: () => JSON.stringify(model),
      setItem: () => {},
      removeItem: () => { throw new Error('storage blocked'); }
    },
    fetch: async () => ({ ok: true, json: async () => ({ active: false }) }),
    AbortController,
    CustomEvent: class CustomEvent {},
    URL,
    location: { reload: () => { reloads += 1; } }
  };
  context.window = context;
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/landing-runtime.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloads, 0);
});

test('a malformed active response keeps the last valid landing cache', async () => {
  const dom = landingDom();
  const model = {
    revision: 8,
    branding: {},
    sections: ['home', 'about', 'services', 'pricing', 'skills', 'contact'].map((id, order) => ({
      id, order, enabled: true, title: `Cached ${id}`, subtitle: '', body: '', imageUrl: '', ctaLabel: '', ctaHref: ''
    }))
  };
  const cachedText = JSON.stringify(model);
  const storage = new Map([['chem.landing.public.v2', cachedText]]);
  let reloads = 0;
  const context = {
    console,
    document: dom.document,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    fetch: async () => ({ ok: true, json: async () => ({ active: true, model: { revision: 9 } }) }),
    AbortController,
    CustomEvent: class CustomEvent {},
    URL,
    location: { reload: () => { reloads += 1; } }
  };
  context.window = context;
  context.window.setTimeout = () => 1;
  context.window.clearTimeout = () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/landing-runtime.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.get('chem.landing.public.v2'), cachedText);
  assert.equal(dom.sections.home.selectors.get('.text-2').textContent, 'Cached home');
  assert.equal(reloads, 0);
});
