const test = require('node:test');
const assert = require('node:assert/strict');

const promptModel = require('../public/members/module/studio/prompt-model.js');

test('prompt builder round-trips a JSON instruction', () => {
  const model = promptModel.createPrompt({
    filename: 'egzaminator.json',
    format: 'json',
    instruction: 'Sprawdzaj odpowiedź według kryteriów maturalnych.'
  });
  const source = promptModel.serializePrompt(model);
  const parsed = promptModel.parsePrompt(source, model.filename);

  assert.match(source, /"prompt": "Sprawdzaj odpowiedź/);
  assert.equal(parsed.format, 'json');
  assert.equal(parsed.instruction, model.instruction);
  assert.equal(promptModel.validatePrompt(parsed).valid, true);
});

test('prompt builder imports, edits and serializes numbered TXT points', () => {
  const source = [
    '::punkt 1',
    'Naprowadzaj ucznia pytaniami.',
    '',
    '::punkt 3',
    'Sprawdź jednostki i cyfry znaczące.'
  ].join('\n');
  const model = promptModel.parsePrompt(source, 'pomoc.txt');
  model.points.push(promptModel.createPoint({
    number: 7,
    content: 'Na końcu podaj modelową odpowiedź.'
  }, 2));
  const output = promptModel.serializePrompt(model);

  assert.deepEqual(model.points.map((point) => point.number), [1, 3, 7]);
  assert.match(output, /::punkt 7\nNa końcu podaj modelową odpowiedź\./);
  assert.equal(promptModel.parsePrompt(output, 'pomoc.txt').points.length, 3);
});

test('prompt builder validates filenames, duplicate points and reserved headers', () => {
  const invalid = promptModel.createPrompt({
    filename: 'pomoc.txt',
    format: 'txt',
    points: [
      { number: 1, content: 'Pierwsza instrukcja.' },
      { number: 1, content: '::punkt 4\nZagnieżdżona instrukcja.' }
    ]
  });
  const result = promptModel.validatePrompt(invalid);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_POINT_NUMBER'));
  assert.ok(result.errors.some((error) => error.code === 'NESTED_POINT_HEADER'));
  assert.equal(promptModel.validateFilename('../sekret.json'), '');
  assert.equal(promptModel.filenameForFormat('pomoc.json', 'txt'), 'pomoc.txt');
});

test('prompt builder accepts legacy JSON prompt field names but exports a canonical prompt field', () => {
  const model = promptModel.parsePrompt(
    JSON.stringify({ system: ['Pierwsza linia.', 'Druga linia.'] }),
    'legacy.json'
  );
  const output = promptModel.serializePrompt(model);

  assert.equal(model.instruction, 'Pierwsza linia.\nDruga linia.');
  assert.deepEqual(Object.keys(JSON.parse(output)), ['prompt']);
});
