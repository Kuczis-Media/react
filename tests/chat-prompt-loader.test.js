const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loader = require('../public/members/module/chat/prompt-loader.js');

test('chat prompt URL keeps legacy JSON and supports a selected TXT point', () => {
  assert.deepEqual(
    loader.parsePromptRequest('https://kurs.example/members/module/chat/?prompt=test.json'),
    { filename: 'test.json', repositoryId: '', format: 'json', point: null }
  );
  assert.deepEqual(
    loader.parsePromptRequest('https://kurs.example/members/module/chat/?plik=prompty-przyklad.txt&punkt=12'),
    { filename: 'prompty-przyklad.txt', repositoryId: '', format: 'txt', point: 12 }
  );
  assert.deepEqual(
    loader.parsePromptRequest('https://kurs.example/members/module/chat/?repo=organiczna&prompt=test.json'),
    { filename: 'test.json', repositoryId: 'organiczna', format: 'json', point: null }
  );
});

test('chat prompt URL rejects traversal, remote URLs and invalid point numbers', () => {
  for (const url of [
    'https://kurs.example/chat/?plik=../sekret.txt&punkt=1',
    'https://kurs.example/chat/?plik=https%3A%2F%2Fevil.example%2Fa.txt&punkt=1',
    'https://kurs.example/chat/?plik=a%2Fb.txt&punkt=1',
    'https://kurs.example/chat/?plik=test.txt&punkt=0',
    'https://kurs.example/chat/?plik=test.txt&punkt=1.5',
    'https://kurs.example/chat/?plik=test.txt&punkt=01',
    'https://kurs.example/chat/?plik=test.txt',
    'https://kurs.example/chat/?prompt=test.json&punkt=1',
    'https://kurs.example/chat/?repo=../inne&prompt=test.json'
  ]) {
    assert.throws(() => loader.parsePromptRequest(url), loader.PromptConfigError);
  }
});

test('chat prompt URL rejects duplicate or conflicting configuration', () => {
  assert.throws(
    () => loader.parsePromptRequest('https://kurs.example/chat/?plik=a.txt&plik=b.txt&punkt=1'),
    (error) => error.code === 'AMBIGUOUS_QUERY'
  );
  assert.throws(
    () => loader.parsePromptRequest('https://kurs.example/chat/?plik=a.txt&prompt=b.txt&punkt=1'),
    (error) => error.code === 'AMBIGUOUS_SOURCE'
  );
  assert.throws(
    () => loader.parsePromptRequest('https://kurs.example/chat/?plik=a.txt&prompt=a.txt&punkt=1'),
    (error) => error.code === 'AMBIGUOUS_SOURCE'
  );
  assert.throws(
    () => loader.parsePromptRequest('https://kurs.example/chat/?repo=a&repo=b&prompt=a.json'),
    (error) => error.code === 'AMBIGUOUS_QUERY'
  );
});

test('prompt sets stay private and the browser sends only a validated reference', () => {
  const root = path.join(__dirname, '..');
  const publicChat = path.join(root, 'public', 'members', 'module', 'chat');
  const browserScript = fs.readFileSync(path.join(publicChat, 'script.js'), 'utf8');
  const serverScript = fs.readFileSync(path.join(root, 'netlify', 'functions', 'chat.mjs'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  const exampleEnvironment = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  assert.equal(fs.existsSync(path.join(publicChat, 'prompty-przyklad.txt')), false);
  assert.equal(fs.existsSync(path.join(publicChat, 'test.json')), false);
  assert.match(browserScript, /promptConfig/);
  assert.doesNotMatch(browserScript, /fetchPromptText|parsePromptFile/);
  assert.match(serverScript, /contentRepository\.readAsset\(\s*['"]prompt['"]/);
  assert.doesNotMatch(config, /chat-prompts/);
  assert.match(exampleEnvironment, /GITHUB_CONTENT_TOKEN=/);
  assert.match(exampleEnvironment, /GITHUB_CONTENT_REPOSITORY=/);
});
