'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, '../public/members/module/studio');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(directory, 'style.css'), 'utf8');

test('styled Studio tool switch retains the native labeled selector, categories and destinations', () => {
  const nav = html.match(/<nav class="mode-switch tool-switch"[\s\S]*?<\/nav>/)[0];
  assert.match(nav, /id="mode-switch"[^>]*hidden/);
  assert.match(nav, /<label for="studio-tool-select">/);
  assert.match(nav, /<select id="studio-tool-select">/);
  assert.equal((nav.match(/<optgroup /g) || []).length, 3);
  assert.deepEqual([...nav.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]), [
    'home', 'lesson', 'quiz', 'exam', 'presentation', 'prompt', 'dashboard', 'landing', 'assets',
    'progress', 'ai-usage', 'payments', 'ai-settings', 'users', 'forms', 'content-settings', 'landing-settings', 'env'
  ]);
  assert.match(nav, /class="tool-switch-mark" aria-hidden="true"/);
  assert.match(nav, /class="tool-switch-chevron"[^>]*aria-hidden="true"/);
  assert.match(css, /\.tool-switch-mark svg, \.tool-switch-chevron \{[^}]*pointer-events: none/);
  assert.match(css, /\.tool-switch select:focus-visible \{[^}]*outline: 2px solid/);
});

test('tool switch visual accents follow native selection and mobile width remains flexible', () => {
  for (const mode of ['lesson', 'quiz', 'exam', 'presentation', 'prompt']) {
    assert.ok(css.includes(`.tool-switch:has(option[value="${mode}"]:checked)`));
  }
  assert.match(css, /\.tool-switch \{[^}]*grid-template-columns: 38px minmax\(0, 1fr\) 18px/);
  assert.match(css, /\.tool-switch \{[^}]*bottom: calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\)[^}]*width: auto/);
  assert.doesNotMatch(css, /\.project-card-presentation \.project-icon \{/);
});

test('each builder has a distinct inline SVG symbol without changing its button action', () => {
  const drawings = new Set();
  for (const mode of ['dashboard', 'lesson', 'quiz', 'exam', 'presentation', 'prompt']) {
    const start = html.indexOf(`data-open-mode="${mode}"`);
    assert.ok(start > 0);
    const card = html.slice(start, html.indexOf('</button>', start));
    const icon = card.match(/<span class="project-icon" aria-hidden="true">\s*(<svg[\s\S]*?<\/svg>)/)[1];
    assert.match(icon, /viewBox="0 0 40 40" width="40" height="40" focusable="false"/);
    assert.doesNotMatch(icon, /<image|<script|href=|on\w+=/);
    drawings.add(icon);
  }
  assert.equal(drawings.size, 6);
  assert.match(css, /\.home-view \.project-icon svg \{ width: 30px; height: 30px; \}/);
});
