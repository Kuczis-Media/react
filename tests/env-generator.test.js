'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const model = require('../public/members/module/studio/env/env-model.js');

test('env generator serializes defaults and safely quotes complex values', () => {
  const entries = model.defaultEntries();
  entries.find((entry) => entry.name === 'SITE_ID').value = 'abc-123';
  entries.push({ name: 'CUSTOM_VALUE', value: 'tekst ze spacją i #', secret: false });
  const output = model.serializeEnv(entries);
  assert.match(output, /^GIT_PROVIDER=gitea/);
  assert.match(output, /SITE_ID=abc-123/);
  assert.equal(dotenv.parse(output).CUSTOM_VALUE, 'tekst ze spacją i #');
  assert.doesNotMatch(output, /undefined|null/);
});

test('env generator imports quoted values, export syntax and keeps the last duplicate', () => {
  const parsed = model.parseEnv('export SITE_ID=first\n# komentarz\nCUSTOM="dwa słowa"\nSITE_ID=second\nBŁĄD=x\n');
  assert.deepEqual(parsed.entries.map(({ name, value }) => [name, value]), [['SITE_ID', 'second'], ['CUSTOM', 'dwa słowa']]);
  assert.deepEqual(parsed.invalidLines, [5]);
  assert.deepEqual(parsed.duplicateNames, ['SITE_ID']);
});

test('env generator can omit blanks and blocks invalid names instead of silently dropping them', () => {
  const output = model.serializeEnv([
    { name: 'VALID_NAME', value: 'ok' },
    { name: 'EMPTY_NAME', value: '' }
  ], { includeEmpty: false });
  assert.equal(output, 'VALID_NAME=ok\n');
  assert.throws(
    () => model.serializeEnv([{ name: 'BAD-NAME', value: 'no' }]),
    (error) => error.code === 'ENV_NAME_INVALID'
  );
});

test('generated values round-trip through the dotenv parser used by Netlify', () => {
  const values = {
    GITHUB_CONTENT_REPOSITORIES: '[{"id":"main","tokenEnv":"GITHUB_CONTENT_TOKEN"}]',
    HASH_VALUE: 'tekst # z komentarzem',
    WINDOWS_PATH: 'C:\\Temp\\folder',
    MIXED_QUOTES: '"cytat" i `kod`',
    TAB_VALUE: 'lewa\tprawa',
    LITERAL_ESCAPE: 'pierwsza\\ndruga',
    MULTILINE_VALUE: 'pierwsza\ndruga',
    OUTER_QUOTES: "'zachowaj apostrofy'",
    PADDED_VALUE: '  zachowaj odstępy  '
  };
  const output = model.serializeEnv(Object.entries(values).map(([name, value]) => ({ name, value })));
  assert.deepEqual(dotenv.parse(output), values);
});

test('env validation catches duplicates, unsafe values and merged-list overflow', () => {
  const duplicate = model.validateEntries([{ name: 'TOKEN', value: 'first' }, { name: 'TOKEN', value: 'second' }]);
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.duplicateNames, ['TOKEN']);
  assert.throws(
    () => model.serializeEnv([{ name: 'ALL_QUOTES', value: " ' \" ` # " }]),
    (error) => error.code === 'ENV_VALUE_UNREPRESENTABLE'
  );
  const current = model.defaultEntries();
  const imported = Array.from({ length: model.MAX_ENTRIES }, (_, index) => ({ name: `CUSTOM_${index}`, value: String(index) }));
  assert.throws(
    () => model.mergeEntries(current, imported),
    (error) => error.code === 'ENV_TOO_MANY_ENTRIES' && error.details.count > model.MAX_ENTRIES
  );
});

test('env import follows dotenv comments and multiline quote semantics', () => {
  const source = "PLAIN=wartość # komentarz\nMULTI='pierwsza\ndruga'\nDOUBLE=wiersz\\nbez-ekspansji\n";
  const parsed = model.parseEnv(source);
  assert.deepEqual(Object.fromEntries(parsed.entries.map((entry) => [entry.name, entry.value])), {
    PLAIN: 'wartość',
    MULTI: 'pierwsza\ndruga',
    DOUBLE: 'wiersz\\nbez-ekspansji'
  });
});

test('env import keeps dotenv-compatible values with unmatched or embedded quotes', () => {
  const source = 'ONE="trailing\\\\" # comment\nTWO="inside"quote" # comment\nTHREE=`unterminated\n';
  const expected = dotenv.parse(source);
  const parsed = model.parseEnv(source);
  assert.deepEqual(Object.fromEntries(parsed.entries.map((entry) => [entry.name, entry.value])), expected);
  assert.deepEqual(parsed.invalidLines, []);
});

test('admin UI exposes a no-Function env tool and protects it with the admin session', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/members/module/studio/env/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../public/members/module/studio/env/script.js'), 'utf8');
  const studio = fs.readFileSync(path.join(__dirname, '../public/members/module/studio/index.html'), 'utf8');
  const members = fs.readFileSync(path.join(__dirname, '../public/members/module/studio/admin/index.html'), 'utf8');
  assert.match(html, /id="env-import"/);
  assert.match(html, /id="env-copy"/);
  assert.match(html, /id="env-download"/);
  assert.match(html, /id="env-output-visibility"/);
  assert.match(script, /ChemAuth\.ready/);
  assert.match(script, /roles\.includes\('admin'\)/);
  assert.doesNotMatch(script, /fetch\s*\(/);
  assert.doesNotMatch(script, /localStorage/);
  assert.match(script, /modelApi\.mergeEntries/);
  assert.match(script, /fallbackKind === 'names'/);
  assert.match(script, /serializedOutput/);
  assert.match(studio, /href="\/members\/module\/studio\/env\/"/);
  assert.match(members, /Otwórz generator \.env/);
});
