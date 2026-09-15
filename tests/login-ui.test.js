const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'login', 'script.js'),
  'utf8'
);

test('login UI keeps an Identity flow in memory and removes its secrets from the address', () => {
  let cleanedAddress = '';
  const location = {
    href: 'https://chemdisk.netlify.app/login/?returnTo=%2Fmembers%2F&flow=recovery&token=super-secret&email=k%40example.com',
    hash: '',
    search: '?returnTo=%2Fmembers%2F&flow=recovery&token=super-secret&email=k%40example.com'
  };
  const window = {};

  vm.runInNewContext(source, {
    URL,
    URLSearchParams,
    atob,
    location,
    window,
    history: {
      replaceState(_state, _title, value) { cleanedAddress = value; }
    },
    document: {
      title: 'Logowanie',
      addEventListener() {}
    },
    localStorage: {
      getItem() { return null; },
      removeItem() {},
      setItem() {}
    },
    Set,
    String
  });

  assert.equal(window.__CHEM_IDENTITY_FLOW_ACTIVE__, true);
  assert.equal(cleanedAddress, '/login/?returnTo=%2Fmembers%2F');
  assert.doesNotMatch(cleanedAddress, /super-secret|email=|token=|flow=/);
});

test('invite and confirmation flows persist the session and handle email-change confirmations', () => {
  assert.match(source, /acceptInvite\(inviteToken, password, true\)/);
  assert.match(source, /confirm\(rawFlow\.token, true\)/);
  assert.match(source, /typeParam === 'email_change_confirm'/);
  assert.match(source, /current\.logout\(\)/);
});

test('the application does not initialize the self-starting Identity widget twice', () => {
  const authSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'js', 'auth.js'),
    'utf8'
  );
  const contactSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'members', 'module', 'contact', 'index.html'),
    'utf8'
  );
  const timeSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'time', 'script.js'),
    'utf8'
  );

  for (const candidate of [authSource, contactSource, timeSource]) {
    assert.doesNotMatch(candidate, /\b(?:ID|netlifyIdentity)\.init\s*\(/);
  }
});
