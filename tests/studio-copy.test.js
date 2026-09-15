const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studioPath = path.join(__dirname, '../public/members/module/studio');
const read = (name) => fs.readFileSync(path.join(studioPath, name), 'utf8');

test('Studio primary actions use consistent everyday Polish rather than storage details', () => {
  const html = read('index.html');
  const actionCopy = (id) => html.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>([^<]*)</button>`))?.[1];
  assert.equal(actionCopy('lesson-repository-save-button'), 'Opublikuj');
  assert.equal(actionCopy('prompt-repository-save-button'), 'Zapisz');
  for (const kind of ['quiz', 'exam']) {
    assert.equal(actionCopy(`${kind}-save-draft-button`), 'Zapisz szkic');
    assert.equal(actionCopy(`${kind}-delete-button`), 'Usuń');
  }
  assert.doesNotMatch(html, /<(?:strong|small|button)\b[^>]*>[^<]*(?:Draft|Builder|GitHub|Netlify Blobs|commit)[^<]*<\//);
  assert.match(read('script.js'), /updatesCurrentFile \? 'Opublikuj zmiany' : 'Opublikuj'/);
  for (const name of ['quiz-builder.js', 'exam-builder.js']) {
    assert.match(read(name), /'Zapisany szkic'/);
    assert.match(read(name), /'Szkic na tym urządzeniu'/);
    assert.doesNotMatch(read(name), /'Draft (?:lokalny|w GitHubie)'/);
  }
});

test('simple publication wording preserves public-file warnings and both destination choices', () => {
  const html = read('landing/index.html');
  assert.match(html, /id="publish"[^>]*>Opublikuj<\/button>/);
  assert.match(html, /id="save-draft"[^>]*>Zapisz szkic<\/button>/);
  assert.match(html, /nie dodawaj tutaj poufnych plików/);
  assert.match(html, /value="netlify-blobs">Na platformie/);
  assert.match(html, /value="static-github">W publicznej bibliotece plików/);
  assert.match(read('landing/script.js'), /Nie dodawaj do nich haseł ani prywatnych danych/);
  const script = read('landing/script.js');
  assert.match(script, /dostępny tylko dla administratora/);
  assert.match(script, /Odwiedzający zobaczą zmiany dopiero po publikacji/);
  assert.match(script, /do 10 minut/);
  assert.match(script, /do 15 minut/);
});
