'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'public', 'members');
const files = ['dashboard.css', 'module/exam/style.css', 'module/quiz/style.css', 'module/lesson/style.css', 'module/studio/style.css', 'module/studio/manage/style.css'];
const styles = Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));

function blockAfter(source, selector) {
  const start = source.startsWith(`${selector} {`) ? 0 : source.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `Missing style block: ${selector}`);
  const open = source.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, `Unclosed style block: ${selector}`);
  return source.slice(open + 1, end - 1);
}

const rgb = (hex) => hex.replace('#', '').match(/../g).map((part) => parseInt(part, 16));
const mix = (first, second, weight) => first.map((value, index) => value * weight + second[index] * (1 - weight));
function luminance(color) {
  const channels = color.map((value) => {
    const normalized = value / 255;
    return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('dashboard module badges use the tile surface and type accent, not a fixed pale background', () => {
  const css = styles['dashboard.css'];
  const card = blockAfter(css, '.resource-card');
  const icon = blockAfter(css, '.card-icon');
  assert.match(card, /--module-icon-tint: color-mix\(in srgb, var\(--surface\) 70%, var\(--card-accent, #64b8a8\)\)/);
  assert.match(icon, /background: linear-gradient\(145deg, var\(--module-icon-start\), var\(--module-icon-end\)\)/);
  assert.match(icon, /border: 1px solid/);
  assert.match(icon, /flex-shrink: 0/);
  assert.doesNotMatch(css, /--icon-background|--icon-color/);
  assert.match(css, /\.resource-card\.is-sequence-locked:hover,[\s\S]*?transform: none/);
  assert.match(css, /\.resource-accordion\.is-sequential \.card-icon\s*\{[^}]*grid-area: icon/);
});

test('module letters stay legible throughout the actual CSS gradient, including neon, dark and light tiles', () => {
  const css = styles['dashboard.css'];
  const card = blockAfter(css, '.resource-card');
  const icon = blockAfter(css, '.card-icon');
  const text = rgb(/color: (#[a-f0-9]{6});/i.exec(icon)[1]);
  const stops = ['start', 'end'].map((stop) => {
    const match = new RegExp(`--module-icon-${stop}: color-mix\\(in srgb, var\\(--module-icon-tint\\) (\\d+)%, (#[a-f0-9]{6})\\)`).exec(card);
    assert.ok(match, `Missing contrast-bounded ${stop} stop`);
    return { weight: Number(match[1]) / 100, base: rgb(match[2]) };
  });
  const accents = [...css.matchAll(/--card-accent: (#[a-f0-9]{6});/g)].map((match) => match[1]);
  accents.push('#64b8a8', '#ffffff', '#000000');
  const surfaces = ['#ffffff', '#000000', '#151e2a', '#b8ef00', '#b4ef00', '#ff0088', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'];
  for (const surface of surfaces) for (const accent of accents) {
    const tint = mix(rgb(surface), rgb(accent), .70);
    const endpoints = stops.map((stop) => mix(tint, stop.base, stop.weight));
    for (let position = 0; position <= 10; position++) {
      const background = mix(endpoints[0], endpoints[1], position / 10);
      assert.ok(contrast(text, background) >= 4.5, `Unreadable badge on ${surface}, accent ${accent}, position ${position}`);
    }
  }
});

test('Studio keeps vector icons square while giving them the same contrast-bounded gradient treatment', () => {
  const css = styles['module/studio/style.css'];
  const icon = blockAfter(css, '.project-icon');
  assert.match(icon, /color: #ffffff/);
  assert.match(icon, /linear-gradient\(145deg, color-mix\(in srgb, var\(--project-icon-tint\) 34%, #111c2e\), color-mix\(in srgb, var\(--project-icon-tint\) 16%, #111c2e\)\)/);
  assert.match(icon, /aspect-ratio: 1/);
  assert.match(blockAfter(css, '.project-icon svg > *'), /vector-effect: non-scaling-stroke/);
  assert.match(blockAfter(css, '.project-card'), /text-decoration: none/);
  assert.match(blockAfter(css, '.project-card::before'), /content: ""/);
  assert.match(css, /\.project-card::before \{ pointer-events: none/);
});

test('new entrance motion is brief, opt-in and never attached to the editable canvas or timer', () => {
  for (const file of files.filter((file) => file !== 'module/lesson/style.css')) {
    const motion = blockAfter(styles[file], '@media (prefers-reduced-motion: no-preference)');
    assert.doesNotMatch(motion, /infinite|\.builder-node|\.lesson-slide|\.exam-topbar-state/);
    const durations = [...motion.matchAll(/animation: [\w-]+ (\d+)ms/g)];
    assert.ok(durations.length > 0);
    for (const [, duration] of durations) assert.ok(Number(duration) <= 400);
  }
  assert.match(styles['dashboard.css'], /\.card-grid > \.resource-card:nth-child\(-n\+8\)/, 'Long material lists do not animate every card');
  for (const file of files) assert.ok(styles[file].includes('@media (prefers-reduced-motion: reduce)'));
  for (const file of ['module/exam/style.css', 'module/quiz/style.css']) {
    const css = styles[file];
    assert.ok(css.lastIndexOf('@media (prefers-reduced-motion: reduce)') > css.lastIndexOf('@media (hover: hover)'));
    assert.match(blockAfter(css, '@media (prefers-reduced-motion: reduce)'), /transform: none/);
  }
});

test('assessment polish keeps native controls and adds distinct checked and keyboard-focus styles', () => {
  for (const [file, option] of [['module/exam/style.css', '.exam-option'], ['module/quiz/style.css', '.quiz-player-option']]) {
    const css = styles[file];
    assert.ok(css.includes(`${option}:has(input:checked)`));
    assert.match(blockAfter(css, `${option}:focus-within`), /outline: 2px solid/);
    assert.match(blockAfter(css, `${option} input`), /accent-color:/);
    assert.doesNotMatch(blockAfter(css, `${option} input`), /display: none|appearance: none|pointer-events: none/);
    assert.match(css, /:not\(:disabled\):hover/);
  }
});

test('visual polish requires no downloaded fonts, images, animation libraries or stylesheet imports', () => {
  for (const file of files) assert.doesNotMatch(styles[file], /@import|url\s*\(/i, file);
});
