'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync(require.resolve('../public/assets/js/site-brand.js'), 'utf8');
const ids = ['home', 'about', 'services', 'pricing', 'skills', 'contact'];
function model(branding = {}) {
  return { version: 3, revision: 2, branding: { brandName: 'TestMed', companyName: 'Test Company', primaryColor: '#112233', faviconUrl: 'https://example.com/favicon.png', ...branding }, sections: ids.map((id) => ({ id })) };
}

async function run({ cache, response = null, route, pathname = '/members/', logoSlots = 0, initialTitle = 'Panel kursanta — NextMed', preservePalette = false } = {}) {
  const storage = new Map(Object.entries(cache || {}));
  const names = [{ textContent: 'NextMed' }];
  const company = [{ textContent: 'NextMed' }];
  const title = { dataset: { brandTitle: 'Panel kursanta' } };
  const icon = { href: '/icon.svg', type: 'image/svg+xml', getAttribute(name) { return this[name]; }, removeAttribute(name) { delete this[name]; } };
  const images = [];
  function node(tag) {
    const result = { tag, attrs: {}, style: { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } },
      setAttribute(key, value) { this.attrs[key] = value; }, getAttribute(key) { return key === 'src' ? this.src : this.attrs[key]; },
      removeAttribute(key) { delete this.attrs[key]; }, remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
    };
    if (tag === 'img') images.push(result);
    return result;
  }
  const slots = Array.from({ length: logoSlots }, () => {
    const svg = node('svg');
    return { children: [svg], svg, dataset: {}, style: node('span').style,
      get childNodes() { return this.children; },
      querySelector(selector) { return this.children.find((child) => child.tag === (selector === 'svg' ? 'svg' : 'img')); },
      append(child) { child.parent = this; this.children.push(child); },
      replaceChildren(...children) { this.children = []; children.forEach((child) => this.append(child)); }
    };
  });
  const styles = [];
  const calls = [];
  const document = {
    title: initialTitle,
    documentElement: { dataset: { brandPalette: preservePalette ? 'preserve' : '' }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } },
    querySelector: (selector) => selector === 'title[data-brand-title]' ? title : selector === 'link[rel~="icon"]' ? icon : null,
    querySelectorAll: (selector) => ({ '[data-brand-name]': names, '[data-company-name]': company, 'link[rel~="icon"]': [icon], '[data-brand-logo-slot]': slots }[selector] || []),
    getElementById: (id) => styles.find((entry) => entry.id === id),
    createElement: node,
    head: { append: (node) => styles.push(node) }
  };
  const browser = { setTimeout, clearTimeout, location: { pathname }, NextMedAppearance: require('../public/assets/js/site-appearance.js'), ...(route ? { NextMedLandingSource: { ready: Promise.resolve(route) }, NextMedLandingDelivery: require('../public/assets/js/landing-delivery-model.js') } : {}) };
  vm.runInNewContext(script, {
    document, URL, AbortController, Date,
    window: browser,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => response }; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { document, names, company, icon, styles, calls, storage, slots, images, brand: browser.NextMedBrand, titleNode: title };
}

test('shell logos use the favicon instead of the landing logo, with late loads unable to overwrite it', async () => {
  for (const pathname of ['/members/', '/members/module/studio/', '/purchase/', '/time', '/members/module/exam/', '/members/module/quiz/', '/members/module/lesson/', '/members/module/chat/', '/members/module/presentation/']) {
    const result = await run({ pathname, logoSlots: 2, cache: { 'chem.landing.public.v3': JSON.stringify({ model: model({ logoUrl: 'https://example.com/wide-logo.svg' }), checkedAt: Date.now() }) } });
    const current = result.images.filter((image) => image.src === result.icon.href);
    assert.equal(current.length, 2);
    current.forEach((image) => image.onload());
    result.images.filter((image) => image.src === '/icon.svg').forEach((image) => image.onload());
    for (const slot of result.slots) {
      assert.equal(slot.children.length, 1);
      assert.equal(slot.children[0].src, result.icon.href);
      assert.equal(slot.children[0].alt, 'TestMed');
      assert.equal(slot.querySelector('svg'), undefined, 'The old mark is removed, not merely hidden behind the logo');
      assert.equal(slot.dataset.logoState, 'ready');
      assert.equal(slot.style.background, 'transparent');
      assert.equal(slot.style['box-shadow'], 'none');
      assert.match(slot.children[0].style.cssText, /position:absolute/);
    }
    assert.equal(result.calls.length, 0);
    assert.equal(result.images.some((image) => /wide-logo/.test(image.src)), false);
  }
});

test('same favicon in cache and refresh reuses an in-flight logo and updates its accessible name', async () => {
  const result = await run({ logoSlots: 1, cache: { 'nextmed.site-brand.v1': JSON.stringify({ model: model(), checkedAt: Date.now() - 16 * 60 * 1000 }) }, response: { active: true, model: model({ brandName: 'Renamed' }) } });
  const matching = result.images.filter((image) => image.src === result.icon.href);
  assert.equal(matching.length, 1);
  matching[0].onload();
  assert.equal(result.slots[0].children[0].alt, 'Renamed');
});

test('offline configuration uses the checked-in favicon; an image failure keeps a visible fallback', async () => {
  const result = await run({ logoSlots: 1 });
  assert.equal(result.images[0].src, '/icon.svg');
  result.images[0].onerror();
  assert.equal(result.slots[0].svg.attrs.hidden, undefined);
  assert.equal(result.slots[0].children.length, 1);
  assert.equal(result.slots[0].children[0], result.slots[0].svg);
});

test('shared public cache updates shell names, title and favicon without another request', async () => {
  const result = await run({ cache: { 'chem.landing.public.v3': JSON.stringify({ model: model(), checkedAt: Date.now() }) } });
  assert.equal(result.names[0].textContent, 'TestMed');
  assert.equal(result.company[0].textContent, 'Test Company');
  assert.equal(result.document.title, 'Panel kursanta — TestMed');
  assert.equal(result.icon.href, 'https://example.com/favicon.png');
  assert.equal(result.icon.type, undefined);
  assert.equal(result.calls.length, 0);
});

test('the same cached configuration renders independent dashboard, Studio and account palettes without requests', async () => {
  const palettes = {
    dashboard: { primaryColor: '#110000', textColor: '#220000', backgroundColor: '#330000' },
    studio: { primaryColor: '#001100', textColor: '#002200', backgroundColor: '#003300' },
    account: { primaryColor: '#000011', textColor: '#000022', backgroundColor: '#000033' }
  };
  const cache = { 'chem.landing.public.v3': JSON.stringify({ model: model({ palettes }), checkedAt: Date.now() }) };
  for (const [pathname, scope] of [['/members/', 'dashboard'], ['/members/module/studio/', 'studio'], ['/members/module/studio/landing/', 'studio'], ['/members/module/studio/env/', 'studio'], ['/login/', 'account'], ['/purchase/', 'account'], ['/time', 'account'], ['/payment-success/', 'account']]) {
    const result = await run({ cache, pathname });
    const css = result.styles[0].textContent;
    assert.ok(css.includes(`--primary:${palettes[scope].primaryColor}`), pathname);
    assert.ok(css.includes(`--ink:${palettes[scope].textColor}`), pathname);
    assert.ok(css.includes(`--chem-bg:${palettes[scope].backgroundColor}`), pathname);
    assert.equal(result.document.documentElement.attributes['data-site-palette'], scope);
    assert.equal(result.names[0].textContent, 'TestMed');
    assert.equal(result.icon.href, 'https://example.com/favicon.png');
    assert.equal(result.calls.length, 0);
    assert.match(css, /:root:not\(\[data-theme="dark"\]\)/);
  }
});

test('unsafe scoped colors cannot inject CSS or fall through to another areas palette', async () => {
  const result = await run({ pathname: '/members/module/studio/', response: { active: true, model: model({ palettes: {
    studio: { textColor: 'red;}body{display:none', primaryColor: '#aabbcc' }, dashboard: { textColor: '#123456' }
  } }) } });
  const css = result.styles[0].textContent;
  assert.match(css, /--primary:#aabbcc/);
  assert.doesNotMatch(css, /red;\}|--ink:#123456|--ink:red/);
});

test('branding follows the custom JSON source, ignoring a fresh cache from another repository', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const route = delivery.normalize({ externalEnabled: true, externalUrl: 'start.netlify.app', target: { repository: 'NextMed/site', ref: 'main', path: 'custom.json' } });
  const result = await run({ route,
    cache: { 'chem.landing.public.v3': JSON.stringify({ model: model({ brandName: 'Wrong repository' }), checkedAt: Date.now() }) },
    response: { active: true, model: model({ brandName: 'Selected repository' }) }
  });
  assert.equal(result.names[0].textContent, 'Selected repository');
  assert.equal(result.calls[0].url, delivery.rawUrl(route.target));
  assert.equal(result.calls[0].options.credentials, 'omit');
  assert.equal(JSON.parse(result.storage.get('nextmed.site-brand.v1')).configUrl, delivery.rawUrl(route.target));
});

test('Blob publication branding overrides an older GitHub cache with no second request', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const route = { ...delivery.normalize(), publication: { mode: 'netlify-blobs', active: true, version: 'new', model: model({ brandName: 'Live Blobs' }) } };
  const result = await run({ route, cache: { 'chem.landing.public.v3': JSON.stringify({ model: model({ brandName: 'Old GitHub' }), checkedAt: Date.now() }) } });
  assert.equal(result.names[0].textContent, 'Live Blobs');
  assert.equal(result.calls.length, 0);
});

test('a new GitHub publication version refreshes branding even when the previous cache is fresh', async () => {
  const delivery = require('../public/assets/js/landing-delivery-model.js');
  const route = { ...delivery.normalize(), publication: { mode: 'static-github', active: false, version: 'new' } };
  const result = await run({ route, cache: { 'chem.landing.public.v3': JSON.stringify({ model: model({ brandName: 'Old GitHub' }), checkedAt: Date.now(), publicationVersion: 'old' }) }, response: { active: true, model: model({ brandName: 'New GitHub' }) } });
  assert.equal(result.names[0].textContent, 'New GitHub');
  assert.equal(result.calls.length, 1);
  assert.equal(JSON.parse(result.storage.get('nextmed.site-brand.v1')).publicationVersion, 'new');
});

test('expired shell cache refreshes only public GitHub data without credentials', async () => {
  const result = await run({
    cache: { 'nextmed.site-brand.v1': JSON.stringify({ model: model({ brandName: 'Old' }), checkedAt: Date.now() - 16 * 60 * 1000 }) },
    response: { active: true, model: model({ brandName: 'New' }) }
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].url, 'https://raw.githubusercontent.com/Kuczis-Media/logo/main/landing/config.json');
  assert.equal(result.calls[0].options.credentials, 'omit');
  assert.equal(result.calls[0].options.headers.Authorization, undefined);
  assert.equal(result.names[0].textContent, 'New');
  assert.equal(JSON.parse(result.storage.get('nextmed.site-brand.v1')).model.branding.brandName, 'New');
});

test('malformed public models cannot overwrite the checked-in brand', async () => {
  const broken = model();
  broken.sections[0].id = 'about';
  const result = await run({ response: { active: true, model: broken } });
  assert.equal(result.names[0].textContent, 'NextMed');
  assert.equal(result.styles.length, 0);
  assert.equal(result.storage.has('nextmed.site-brand.v1'), false);
});

test('unsafe asset URLs and CSS are ignored while valid palette stays scoped to light mode', async () => {
  const result = await run({ response: { active: true, model: model({ faviconUrl: 'javascript:alert(1)', textColor: 'red;}body{display:none', brandName: '<img src=x>' }) } });
  assert.equal(result.names[0].textContent, '<img src=x>');
  assert.equal(result.icon.href, '/icon.svg');
  assert.match(result.styles[0].textContent, /:root:not\(\[data-theme="dark"\]\)/);
  assert.match(result.styles[0].textContent, /--primary:#112233/);
  assert.doesNotMatch(result.styles[0].textContent, /display:none[^}]*body|--ink:/);
});

test('an older GitHub revision does not replace a newer cached brand', async () => {
  const recent = model({ brandName: 'Recent' });
  recent.revision = 8;
  const result = await run({
    cache: { 'chem.landing.public.v3': JSON.stringify({ model: recent, checkedAt: Date.now() - 16 * 60 * 1000 }) },
    response: { active: true, model: model({ brandName: 'Old CDN revision' }) }
  });
  assert.equal(result.names[0].textContent, 'Recent');
  assert.equal(result.storage.has('nextmed.site-brand.v1'), false);
});

test('dynamic material titles keep the configured brand, including materials loaded before branding', async () => {
  const result = await run({ initialTitle: 'Budowa komórki — NextMed', response: { active: true, model: model() } });
  assert.equal(result.document.title, 'Budowa komórki — TestMed');
  result.brand.setTitle('Egzamin końcowy');
  assert.equal(result.document.title, 'Egzamin końcowy — TestMed');
  assert.equal(result.titleNode.dataset.brandTitle, 'Egzamin końcowy');
  assert.equal(result.brand.name, 'TestMed');
});

test('all student modules load shared branding in dependency order and no longer hard-code the old name', () => {
  const path = require('node:path');
  const modules = path.join(__dirname, '../public/members/module');
  for (const directory of fs.readdirSync(modules, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== 'studio')) {
    const filename = path.join(modules, directory.name, 'index.html');
    if (!fs.existsSync(filename)) continue;
    const html = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(html, /\bChemDisk\b/, directory.name);
    assert.match(html, /<title data-brand-title=/, directory.name);
    assert.match(html, /data-brand-palette="preserve"/, directory.name);
    const scripts = ['landing-delivery-model', 'landing-source', 'site-appearance', 'site-brand'];
    const indices = scripts.map((name) => html.indexOf(`/assets/js/${name}.js`));
    assert.ok(indices.every((index, i) => index >= 0 && (!i || index > indices[i - 1])), directory.name);
    if (['exam', 'quiz', 'presentation', 'lesson', 'chat'].includes(directory.name)) {
      assert.match(html, /data-brand-logo-slot/, directory.name);
      const player = fs.readFileSync(path.join(modules, directory.name, 'script.js'), 'utf8');
      assert.doesNotMatch(player, /(?:document\.title|<strong>).*ChemDisk/);
      if (directory.name !== 'chat') assert.match(player, /NextMedBrand\.setTitle/);
    }
  }
});

test('student player branding leaves existing question and theme palettes untouched', async () => {
  const result = await run({ pathname: '/members/module/exam/', preservePalette: true, response: { active: true, model: model() } });
  assert.equal(result.styles.length, 0);
  assert.equal(result.names[0].textContent, 'TestMed');
  assert.equal(result.icon.href, 'https://example.com/favicon.png');
});
