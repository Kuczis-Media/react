const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'members', 'module', 'theme.js'), 'utf8');

function boot(search = '') {
  const appended = [];
  const document = {
    documentElement: { dataset: {} },
    readyState: 'complete',
    body: { appendChild(node) { appended.push(node); } },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() {
      return {
        dataset: {},
        setAttribute(name, value) { this[name] = value; },
        getAttribute(name) { return this[name] || ''; }
      };
    }
  };
  const window = {
    location: { origin: 'https://kurs.example', pathname: '/members/module/quiz/', search },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}
  };
  const context = vm.createContext({
    document,
    window,
    localStorage: { getItem() { return null; } },
    URL,
    URLSearchParams,
    MutationObserver: undefined
  });
  vm.runInContext(source, context);
  return { api: window.ChemModuleReturn, appended };
}

test('shared module return accepts only an allowlisted same-origin lesson route', () => {
  const { api } = boot();
  assert.equal(
    api.safeLessonReturn('/members/module/lesson/?file=lekcja-chemia-organiczna.md&repo=default'),
    '/members/module/lesson/?file=lekcja-chemia-organiczna.md&repo=default'
  );
  assert.equal(api.safeLessonReturn('https://evil.example/members/module/lesson/?file=lekcja.md'), '');
  assert.equal(api.safeLessonReturn('/members/module/lesson/?file=../sekret.md'), '');
  assert.equal(api.safeLessonReturn('/members/module/lesson/?file=a.md&file=b.md'), '');
  assert.equal(api.safeLessonReturn('/members/module/exam/?file=lekcja.md'), '');
});

test('a module opened from a lesson gets a visible return button', () => {
  const lesson = '/members/module/lesson/?file=lekcja-chemia-organiczna.md&repo=default';
  const { api, appended } = boot(`?quiz=quiz-chemia-organiczna&lesson_return=${encodeURIComponent(lesson)}`);
  assert.equal(api.active, true);
  assert.equal(api.url, lesson);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].href, lesson);
  assert.equal(appended[0].textContent, '← Wróć do lekcji');
});
