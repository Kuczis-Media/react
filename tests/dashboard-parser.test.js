'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse, toProgressCatalog } = require('../public/members/dashboard-parser.js');

test('dashboard parser builds nested accordions from headings level 3 through 6', () => {
  const model = parse(`
# Panel
## Dział
### Poziom 1
#### Poziom 2
##### Poziom 3
###### Poziom 4
- [Materiał](/members/module/pdf/?id=test) — Opis
#### Drugi poziom 2
- [Film](/members/module/film/?id=test) — Nagranie
### Drugi poziom 1
- [Test](/members/module/forms/?id=test) — Sprawdzenie
`);

  const section = model.sections[0];
  assert.equal(section.groups.length, 2);
  assert.equal(section.groups[0].title, 'Poziom 1');
  assert.equal(section.groups[0].groups[0].title, 'Poziom 2');
  assert.equal(section.groups[0].groups[0].groups[0].title, 'Poziom 3');
  assert.equal(section.groups[0].groups[0].groups[0].groups[0].title, 'Poziom 4');
  assert.equal(section.groups[0].groups[0].groups[0].groups[0].items[0].title, 'Materiał');
  assert.equal(section.groups[0].groups[1].title, 'Drugi poziom 2');
  assert.equal(section.groups[0].groups[1].items[0].title, 'Film');
  assert.equal(section.groups[1].title, 'Drugi poziom 1');
});

test('plain lines become safe text descriptions at the current hierarchy level', () => {
  const model = parse(`
Tekst powitalny.
## Dział
Zwykły tekst działu.
### Harmonijka
Pierwsza linia zwykłego tekstu.
Druga linia zwykłego tekstu.
#### Wnętrze
Tekst wewnętrzny.
> Ważny komunikat.
`);

  assert.deepEqual(model.intro, ['Tekst powitalny.']);
  assert.deepEqual(model.sections[0].description, ['Zwykły tekst działu.']);
  assert.deepEqual(
    model.sections[0].groups[0].description,
    ['Pierwsza linia zwykłego tekstu.', 'Druga linia zwykłego tekstu.']
  );
  assert.deepEqual(model.sections[0].groups[0].groups[0].description, ['Tekst wewnętrzny.']);
  assert.deepEqual(model.sections[0].groups[0].groups[0].notices, ['Ważny komunikat.']);
});

test('progress catalog is rebuilt only from materials currently present in the dashboard', () => {
  const firstModel = parse(`
<!-- chemdisk-progress:{"id":"course","type":"course","progress":{"tracking":"ON","showProgress":"ON"}} -->
# Kurs
## Dział
<!-- chemdisk-progress:{"id":"path","type":"section","settings":{"navigation":"sequential"}} -->
### Ścieżka
- [Slajdy](/members/module/slides/?id=slides123&type=2) — Start
- [Lekcja](/members/module/lesson/?repo=repo-testowe&file=lesson.md) — Dalej
`);
  const firstCatalog = toProgressCatalog(firstModel);
  const slides = firstCatalog.nodes.find((node) => node.title === 'Slajdy');
  const lesson = firstCatalog.nodes.find((node) => node.title === 'Lekcja');

  assert.equal(firstCatalog.nodes.find((node) => node.id === 'path').settings.navigation, 'sequential');
  assert.equal(slides.settings.manualCompletion, false);
  assert.equal(lesson.settings.contentFile, 'lesson.md');
  assert.equal(lesson.settings.repositoryId, 'repo-testowe');

  const secondCatalog = toProgressCatalog(parse(`
# Kurs
## Dział
### Ścieżka
- [Lekcja](/members/module/lesson/?repo=repo-testowe&file=lesson.md) — Dalej
`));
  assert.equal(secondCatalog.nodes.some((node) => node.id === slides.id), false);
  assert.deepEqual(
    secondCatalog.nodes.filter((node) => !['course', 'department'].includes(node.type)).map((node) => node.title),
    ['Ścieżka', 'Lekcja']
  );
});

test('default dashboard restores only the curated organic chemistry examples', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'members', 'dashboard.md'),
    'utf8'
  );
  const model = parse(source);

  assert.equal(model.title, 'Przykładowy kurs chemii organicznej');
  assert.deepEqual(model.sections.map((section) => section.title), [
    'Kurs przykładowy',
    'Materiały Google i filmy',
    'Narzędzia Studio',
    'Pomoc i konto'
  ]);
  assert.equal(model.sections[0].groups[0].navigation, 'sequential');
  assert.deepEqual(
    model.sections[0].groups[0].items.map((item) => item.title),
    [
      '1. Aldehydy — Google Slides',
      '2. Chemia organiczna — kompletna lekcja',
      '3. Chemia organiczna — quiz',
      '4. Chemia organiczna — egzamin'
    ]
  );
  assert.deepEqual(
    model.sections.at(-1).items.map((item) => item.title),
    ['Status dostępu', 'Napisz do nas']
  );
});
