'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../public/assets/js/landing-session.js'), 'utf8');
function user(overrides = {}) {
  return { id: 'test-user', url: 'https://course.example/.netlify/identity', token: {
    access_token: 'not-a-real-token', expires_at: Date.now() + 60_000
  }, ...overrides };
}
function run({ stored, preview = false, ctaHref = '/members/', hidden = false } = {}) {
  const events = {}, documentEvents = {}, storage = new Map(stored ? [['gotrue.user', JSON.stringify(stored)]] : []);
  const node = (text, href) => ({ textContent: text, hidden: false, attributes: { href },
    getAttribute(name) { return this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; } });
  const menu = node('Zaloguj się', '/login/'), cta = node('Zacznij naukę', ctaHref); cta.hidden = hidden;
  const context = { URL, URLSearchParams, Date, location: { origin: 'https://course.example', search: preview ? '?landing-preview=1' : '' },
    document: { getElementById: (id) => ({ 'login-btn': menu, 'login-cta': cta })[id], addEventListener: (name, callback) => { documentEvents[name] = callback; } },
    localStorage: { getItem: (key) => storage.get(key) }, addEventListener: (name, callback) => { events[name] = callback; },
    fetch: () => { throw new Error('Session label must never make requests'); }
  };
  context.window = context; context.parent = preview ? {} : context;
  vm.runInNewContext(script, context);
  return { menu, cta, events, documentEvents, storage };
}
test('landing recognizes its own renewable local session without requesting Identity or accessing another domain', () => {
  for (const stored of [user(), user({ token: { access_token: 'test', refresh_token: 'renewable', expires_at: 1 } })]) {
    const result = run({ stored });
    assert.equal(result.menu.textContent, 'Przejdź do kursu');
    assert.equal(result.cta.textContent, 'Przejdź do kursu');
    assert.equal(result.menu.getAttribute('href'), '/members/');
  }
});
test('missing, expired or foreign session hints leave the login button unchanged', () => {
  for (const stored of [undefined, {}, user({ url: 'https://foreign.example/.netlify/identity' }), user({ url: 'https://course.example/other' }), user({ token: { access_token: 'test', expires_at: 1 } })]) {
    const result = run({ stored });
    assert.equal(result.menu.textContent, 'Zaloguj się');
    assert.equal(result.menu.getAttribute('href'), '/login/');
  }
});
test('builder-defined external/pricing links and intentionally hidden CTAs are preserved', () => {
  for (const ctaHref of ['#pricing', '/purchase/', 'https://external.example/course', '']) {
    const result = run({ stored: user(), ctaHref });
    assert.equal(result.cta.textContent, 'Zacznij naukę');
    assert.equal(result.cta.getAttribute('href'), ctaHref);
  }
  assert.equal(run({ stored: user(), hidden: true }).cta.textContent, 'Zacznij naukę');
});
test('logout in another tab restores the original button labels and event-driven updates reapply after rendering', () => {
  const result = run({ stored: user() });
  result.storage.clear(); result.events.storage({ key: 'gotrue.user' });
  assert.equal(result.menu.textContent, 'Zaloguj się');
  assert.equal(result.cta.textContent, 'Zacznij naukę');
  result.events['chem-auth-user-changed']({ detail: { authenticated: true } });
  result.cta.textContent = 'Własny tekst'; result.cta.setAttribute('href', '/members/');
  result.documentEvents['chemdisk-landing-applied']();
  assert.equal(result.cta.textContent, 'Przejdź do kursu');
  result.events['chem-auth-user-changed']({ detail: { authenticated: false } });
  assert.equal(result.cta.textContent, 'Własny tekst');
});
test('live builder preview shows the authored label instead of the administrator session hint', () => {
  const result = run({ stored: user(), preview: true });
  assert.equal(result.menu.textContent, 'Zaloguj się');
  assert.equal(result.cta.textContent, 'Zacznij naukę');
});
