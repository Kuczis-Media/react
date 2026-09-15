'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../public/members/module/studio/quiz-model');
const common = require('../netlify/quiz-common');

test('parseCsv handles basic comma-separated flashcards without quotes', () => {
  const csv = 'Pytanie 1,Odpowiedź 1\nPytanie 2,Odpowiedź 2';
  const result = model.parseCsv(csv);
  assert.equal(result.count, 2);
  assert.equal(result.cards[0].front, 'Pytanie 1');
  assert.equal(result.cards[0].back, 'Odpowiedź 1');
  assert.equal(result.cards[1].front, 'Pytanie 2');
  assert.equal(result.cards[1].back, 'Odpowiedź 2');
});

test('parseCsv auto-detects semicolon and tab delimiters', () => {
  const semicolonCsv = 'Termin A;Definicja A\nTermin B;Definicja B';
  const semiResult = model.parseCsv(semicolonCsv);
  assert.equal(semiResult.delimiter, ';');
  assert.equal(semiResult.count, 2);
  assert.equal(semiResult.cards[0].front, 'Termin A');
  assert.equal(semiResult.cards[0].back, 'Definicja A');

  const tabCsv = 'Pojęcie 1\tZnaczenie 1\nPojęcie 2\tZnaczenie 2';
  const tabResult = model.parseCsv(tabCsv);
  assert.equal(tabResult.delimiter, '\t');
  assert.equal(tabResult.count, 2);
  assert.equal(tabResult.cards[0].front, 'Pojęcie 1');
  assert.equal(tabResult.cards[0].back, 'Znaczenie 1');
});

test('parseCsv supports explicit delimiter override in options', () => {
  const mixedCsv = 'Pytanie;część 1, część 2';
  const result = model.parseCsv(mixedCsv, { delimiter: ';' });
  assert.equal(result.count, 1);
  assert.equal(result.cards[0].front, 'Pytanie');
  assert.equal(result.cards[0].back, 'część 1, część 2');
});

test('parseCsv respects RFC 4180 quotes with embedded delimiters, escaped quotes and newlines', () => {
  const csv = [
    '"Woda, tlenek wodoru","Główny rozpuszczalnik, wzór H2O"',
    '"Cytat: ""Być albo nie być""","William Shakespeare"',
    '"Pytanie wielolinijkowe:\nLinia 1\nLinia 2","Odpowiedź"'
  ].join('\n');

  const result = model.parseCsv(csv);
  assert.equal(result.count, 3);
  assert.equal(result.cards[0].front, 'Woda, tlenek wodoru');
  assert.equal(result.cards[0].back, 'Główny rozpuszczalnik, wzór H2O');
  assert.equal(result.cards[1].front, 'Cytat: "Być albo nie być"');
  assert.equal(result.cards[1].back, 'William Shakespeare');
  assert.equal(result.cards[2].front, 'Pytanie wielolinijkowe:\nLinia 1\nLinia 2');
  assert.equal(result.cards[2].back, 'Odpowiedź');
});

test('parseCsv maps explicitly selected headers, keeping every row by default', () => {
  const withHeader = 'Front,Back\nCo to jest DNA?,Kwas deoksyrybonukleinowy';
  const result1 = model.parseCsv(withHeader, { hasHeader: true });
  assert.equal(result1.count, 1);
  assert.equal(result1.cards[0].front, 'Co to jest DNA?');

  const polishHeader = 'Pytanie;Odpowiedź;Wyjaśnienie\nCo to jest RNA?;Kwas rybonukleinowy;Jednoniciowy';
  const result2 = model.parseCsv(polishHeader, { hasHeader: true });
  assert.equal(result2.count, 1);
  assert.equal(result2.cards[0].front, 'Co to jest RNA?');
  assert.equal(result2.cards[0].back, 'Kwas rybonukleinowy');
  assert.equal(result2.cards[0].explanation, 'Jednoniciowy');

  const noHeader = 'Mitoza,Podział komórki somatycznej\nMejoza,Podział redukcyjny';
  const result3 = model.parseCsv(noHeader);
  assert.equal(result3.count, 2);
  assert.equal(result3.cards[0].front, 'Mitoza');
});

test('parseCsv respects explicit hasHeader option', () => {
  const forcedHeader = 'Mitoza,Podział komórki somatycznej\nMejoza,Podział redukcyjny';
  const result1 = model.parseCsv(forcedHeader, { hasHeader: true, mapping: { question: 0, answer: 1 } });
  assert.equal(result1.count, 1);
  assert.equal(result1.cards[0].front, 'Mejoza');

  const forcedNoHeader = 'Front,Back\nDNA,Kwas';
  const result2 = model.parseCsv(forcedNoHeader, { hasHeader: false });
  assert.equal(result2.count, 2);
  assert.equal(result2.cards[0].front, 'Front');
});

test('CSV preserves UTF-8, Markdown, dollar LaTeX and backslashes through serialization', () => {
  const source = '\uFEFF"Żółć, **białko** $\\alpha$?","$H_2O$\n\\frac{a}{b}"';
  const imported = model.importCardsFromCsv(model.createQuiz({ mode: 'deck' }), source, { append: false });
  assert.equal(imported.added, 1);
  const q = model.parse(model.serialize(imported.quiz)).questions[0];
  assert.equal(q.front.text, 'Żółć, **białko** $\\alpha$?');
  assert.equal(q.back.text, '$H_2O$\n\\frac{a}{b}');
  const renderer = require('../public/assets/js/assessment-text');
  assert.match(renderer.html(q.front.text), /data-assessment-math/);
  assert.match(renderer.html(q.back.text), /<i>H<\/i><sub>2<\/sub><i>O<\/i>|H<sub>2<\/sub>O/);
});

test('importCardsFromCsv converts quiz to deck mode and generates valid schema', () => {
  const quiz = model.createQuiz({ quizId: 'fiszki-biologia', mode: 'quiz' });
  const csv = [
    'Pytanie 1,Odpowiedź 1',
    'Pytanie 2,Odpowiedź 2',
    'Pytanie 3,Odpowiedź 3'
  ].join('\n');

  const imported = model.importCardsFromCsv(quiz, csv, { append: false });
  assert.equal(imported.quiz.mode, 'deck');
  assert.equal(imported.count, 3);
  assert.equal(imported.quiz.questions.length, 3);
  assert.equal(imported.quiz.questions[0].type, 'flashcard');
  assert.equal(imported.quiz.questions[0].points, 0);
  assert.equal(imported.quiz.questions[0].required, false);
  assert.equal(imported.quiz.questions[0].front.text, 'Pytanie 1');
  assert.equal(imported.quiz.questions[0].back.text, 'Odpowiedź 1');

  // Serialization and parsing round-trip
  const serialized = model.serialize(imported.quiz);
  const parsedBack = model.parse(serialized);
  assert.equal(parsedBack.mode, 'deck');
  assert.equal(parsedBack.questions.length, 3);

  // Schema validations
  assert.equal(model.validate(imported.quiz).valid, true);
  assert.equal(common.validateDefinition(imported.quiz).valid, true);
});

test('importCardsFromCsv supports appending cards to existing deck', () => {
  const existing = model.createQuiz({
    quizId: 'fiszki-istniejace',
    mode: 'deck',
    questions: [
      model.createQuestion({
        type: 'flashcard',
        prompt: 'Stara karta',
        front: { text: 'Stara karta', images: [] },
        back: { text: 'Stara odpowiedź', images: [] }
      })
    ]
  });

  const csv = 'Nowa karta 1,Nowa odp 1\nNowa karta 2,Nowa odp 2';
  const imported = model.importCardsFromCsv(existing, csv, { append: true });
  assert.equal(imported.quiz.questions.length, 3);
  assert.equal(imported.quiz.questions[0].front.text, 'Stara karta');
  assert.equal(imported.quiz.questions[1].front.text, 'Nowa karta 1');
  assert.equal(imported.quiz.questions[2].front.text, 'Nowa karta 2');
  assert.equal(model.validate(imported.quiz).valid, true);
  assert.equal(common.validateDefinition(imported.quiz).valid, true);
});

test('CSV maps reordered columns and mixed choice/text types with validated tags and keys', () => {
  const csv = 'tags,answer,question,optionA,optionB,optionC,optionD,correct,type,explanation\n"chemia|woda",,Wzór wody?,H2O,CO2,O2,H2,A,SINGLE_CHOICE,Wyjaśnienie\n,,Pierwiastki?,Tlen,Woda,Wodór,Sól,A|C,MULTIPLE_CHOICE,\nbiologia,Tkanka,Co badamy?,,,,,,TEXT_COMPARE,';
  const result = model.importCardsFromCsv(model.createQuiz(), csv, { hasHeader: true, append: false });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(result.count, 3);
  const [single, multiple, text] = model.parse(model.serialize(result.quiz)).questions;
  assert.deepEqual(single.tags, ['chemia', 'woda']);
  assert.equal(single.options.filter((o) => o.correct)[0].text, 'H2O');
  assert.deepEqual(multiple.options.filter((o) => o.correct).map((o) => o.text), ['Tlen', 'Wodór']);
  assert.equal(text.acceptedAnswers[0], 'Tkanka');
  assert.equal(common.validateDefinition(result.quiz).valid, true);
  const mapped = model.parseCsv('Tył;Przód', { mapping: { question: 1, answer: 0 } });
  assert.equal(mapped.cards[0].front, 'Przód');
  assert.equal(model.parseCsv('question,answer\nTreść,Odpowiedź').count, 2, 'Never silently discard a header-like data row');
});

test('duplicate policy handles existing cards and same-file repetitions without changing text or IDs', () => {
  const existing = model.importCardsFromCsv(model.createQuiz(), 'ŻÓŁĆ,**wzór** $H_2O$', { append: false }).quiz;
  const before = structuredClone(existing);
  const csv = '  żółć  ,**wzór** $H_2O$\nNowe pytanie,Nowa odpowiedź\nNOWE  PYTANIE,nowa odpowiedź';
  const skip = model.importCardsFromCsv(existing, csv);
  assert.equal(skip.added, 1); assert.equal(skip.duplicates, 2); assert.equal(skip.skipped, 2);
  assert.equal(skip.quiz.questions[0].questionId, existing.questions[0].questionId);
  assert.deepEqual(existing, before);
  const keep = model.importCardsFromCsv(existing, csv, { duplicates: 'import' });
  assert.equal(keep.added, 3); assert.equal(keep.duplicates, 2); assert.equal(keep.skipped, 0);
  assert.equal(new Set(keep.quiz.questions.map((q) => q.questionId)).size, 4);
  assert.equal(common.validateDefinition(keep.quiz).valid, true);
});

test('CSV rejects invalid syntax, keys, encodings and limits atomically without truncating existing questions', () => {
  const quiz = model.createQuiz({ mode: 'deck' }), snapshot = structuredClone(quiz);
  for (const csv of ['Pytanie,Odpowiedź\n"Niezamknięte,pole', 'Pytanie,Odpowiedź\n"Treść"extra,Tył', 'Pytanie,Odpowiedź\nJeden', 'Pytanie,', '\u0000Pytanie,Odpowiedź', 'Pytanie,\ufffd', 'q,' + 'a'.repeat(10001), 'a'.repeat(2 * 1024 * 1024 + 1)]) {
    const result = model.importCardsFromCsv(quiz, csv);
    assert.ok(result.errors.length, csv.slice(0, 100)); assert.equal(result.added, 0); assert.strictEqual(result.quiz, quiz);
  }
  for (const type of ['single', 'multiple', 'image_occlusion', 'constructor']) {
    const result = model.importCardsFromCsv(quiz, `question,answer,optionA,optionB,correct,type\nTreść,,A,B,Z,${type}`, { hasHeader: true });
    assert.ok(result.errors.length); assert.equal(result.added, 0);
  }
  const tooMany = Array.from({ length: 201 }, (_, i) => `q${i},a${i}`).join('\n');
  assert.equal(model.importCardsFromCsv(quiz, tooMany).added, 0);
  assert.deepEqual(quiz, snapshot);
  const overfull = { ...quiz, questions: Array(201).fill(quiz.questions[0]) };
  assert.equal(model.validate(overfull).valid, false);
  assert.throws(() => model.serialize(overfull));
});
