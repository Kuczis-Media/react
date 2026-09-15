const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagination = require('../public/members/module/studio/paged-list.js');
const root = path.join(__dirname, '..');

test('Studio lists render twelve files initially and reveal the next page on demand', () => {
  const state = pagination.createState();
  const source = Array.from({ length: 31 }, (_, index) => ({ filename: `lesson-${index + 1}.md` }));

  let page = pagination.page(state, 'lessons', source);
  assert.equal(page.items.length, 12);
  assert.equal(page.remaining, 19);
  assert.equal(page.items.at(-1).filename, 'lesson-12.md');

  pagination.more(state, 'lessons', source.length);
  page = pagination.page(state, 'lessons', source);
  assert.equal(page.items.length, 24);
  assert.equal(page.remaining, 7);

  pagination.more(state, 'lessons', source.length);
  page = pagination.page(state, 'lessons', source);
  assert.equal(page.items.length, 31);
  assert.equal(page.remaining, 0);

  pagination.reset(state, 'lessons');
  assert.equal(pagination.page(state, 'lessons', source).items.length, 12);
  assert.equal(source.length, 31, 'pagination must not modify the source catalog');
});

test('all Studio file explorers use the shared paginated list contract', () => {
  const html = fs.readFileSync(path.join(root, 'public/members/module/studio/index.html'), 'utf8');
  const studio = fs.readFileSync(path.join(root, 'public/members/module/studio/script.js'), 'utf8');
  const quiz = fs.readFileSync(path.join(root, 'public/members/module/studio/quiz-builder.js'), 'utf8');
  const exam = fs.readFileSync(path.join(root, 'public/members/module/studio/exam-builder.js'), 'utf8');
  const presentation = fs.readFileSync(path.join(root, 'public/members/module/studio/presentation-builder.js'), 'utf8');
  const media = fs.readFileSync(path.join(root, 'public/assets/js/media-manager.js'), 'utf8');

  assert.ok(html.indexOf('paged-list.js') < html.indexOf('media-manager.js'));
  assert.match(html, /Zapisane egzaminy/);
  assert.match(html, /Zapisane prezentacje/);
  assert.match(studio, /explorer-\$\{group\.kind\}/);
  assert.match(studio, /media-\$\{key\}/);
  [quiz, exam, presentation, media].forEach((script) => {
    assert.match(script, /pagedListApi\.page/);
    assert.match(script, /pagedListApi(?:\?)?\.reset/);
  });
});

test('quiz, exam and presentation libraries use the same repository accordion as lessons', () => {
  const html = fs.readFileSync(path.join(root, 'public/members/module/studio/index.html'), 'utf8');
  const builders = [
    ['quiz', 'Zapisane quizy'],
    ['exam', 'Zapisane egzaminy'],
    ['presentation', 'Zapisane prezentacje']
  ];

  builders.forEach(([kind, title]) => {
    assert.match(html, new RegExp(`<details class="repository-library studio-builder-repository-library[^\"]*" open>[\\s\\S]*?${title}`));
    assert.match(html, new RegExp(`id="${kind}-(?:library-search|search)"[^>]*aria-label="Szukaj`));
    assert.match(html, new RegExp(`id="${kind}-library-status" role="status" aria-live="polite"`));
    assert.match(html, new RegExp(`class="repository-asset-list ${kind}-library"`));
  });

  assert.doesNotMatch(html, /<span class="sr-only">Szukaj (?:quizu|egzaminu|prezentacji)<\/span>/);
});
