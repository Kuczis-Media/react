'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

// Netlify passes production ENV to the build. Tests must never inherit those
// credentials or provider settings, even when a new integration is added.
// Only platform/process settings needed to execute Node cross-platform pass on.
const RUNTIME_ENV = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC',
  'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'TERM', 'FORCE_COLOR', 'NO_COLOR', 'CI', 'NODE_V8_COVERAGE'
]);

function testEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) => (
    RUNTIME_ENV.has(name.toUpperCase()) && typeof value === 'string'
  )));
}

function run(args = process.argv.slice(2)) {
  const child = spawn(process.execPath, ['--test', ...args], {
    cwd: path.resolve(__dirname, '..'),
    env: testEnvironment(),
    stdio: 'inherit'
  });
  child.once('error', () => {
    console.error('Nie udało się uruchomić testów w osobnym procesie.');
    process.exitCode = 1;
  });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
}

if (require.main === module) run();
module.exports = { testEnvironment };
