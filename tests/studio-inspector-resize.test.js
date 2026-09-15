'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/members/module/studio/inspector-resize.js'), 'utf8');

function setup({ width = 1600, saved = null, blockedStorage = false } = {}) {
  const events = {}, windowEvents = {}, classes = new Set(), values = {}, attrs = {}, writes = [];
  const handle = { tabIndex: 0, addEventListener(key, value) { events[key] = value; },
    setAttribute(key, value) { attrs[key] = value; }, focus() {}, setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; }, releasePointerCapture() { this.capture = null; } };
  const layout = { getBoundingClientRect: () => ({ width: context.innerWidth }) };
  const workspace = { querySelector: () => layout, classList: { contains: (key) => classes.has(key), add: (key) => classes.add(key), remove: (key) => classes.delete(key) }, style: { setProperty(key, value) { values[key] = value; } } };
  const context = { innerWidth: width, document: { getElementById: (id) => id === 'lesson-workspace' ? workspace : handle },
    localStorage: { getItem() { if (blockedStorage) throw Error('Blocked'); return saved; }, setItem(key, value) { if (blockedStorage) throw Error('Blocked'); writes.push({ key, value }); } },
    addEventListener(key, value) { windowEvents[key] = value; },
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const emit = (name, extra = {}) => events[name]({ pointerId: 1, button: 0, clientX: 1000, preventDefault() {}, ...extra });
  return { events, windowEvents, context, handle, values, attrs, writes, classes, emit, width: () => parseInt(values['--lesson-inspector-width'], 10) };
}

test('lesson inspector can be widened by dragging and persists only when the gesture ends', () => {
  const env = setup();
  assert.equal(env.width(), 340);
  env.emit('pointerdown'); env.emit('pointermove', { clientX: 800 });
  assert.equal(env.width(), 540);
  assert.equal(env.writes.length, 0);
  env.emit('pointerup');
  assert.equal(env.writes.length, 1);
  assert.equal(setup({ saved: env.writes[0].value }).width(), 540);
  assert.equal(env.classes.has('is-inspector-resizing'), false);
});

test('keyboard resizing, limits, cancellation and reset remain accessible', () => {
  const env = setup();
  env.emit('keydown', { key: 'ArrowLeft' }); assert.equal(env.width(), 360);
  env.emit('keydown', { key: 'ArrowLeft', shiftKey: true }); assert.equal(env.width(), 410);
  env.emit('keydown', { key: 'End' }); assert.equal(env.width(), 680);
  env.emit('keydown', { key: 'Home' }); assert.equal(env.width(), 300);
  env.emit('pointerdown'); env.emit('pointermove', { clientX: 600 });
  env.emit('pointercancel'); assert.equal(env.width(), 300);
  env.emit('pointerdown'); env.emit('pointermove', { clientX: 600 });
  env.emit('keydown', { key: 'Escape' }); assert.equal(env.width(), 300);
  env.emit('dblclick'); assert.equal(env.width(), 340);
  assert.equal(env.attrs['aria-valuenow'], '340');
});

test('window and library size clamp the panel without erasing the preferred width; mobile does not drag', () => {
  const env = setup({ saved: '620' });
  env.context.innerWidth = 1100; env.windowEvents.resize();
  assert.equal(env.width(), 505);
  env.classes.add('is-palette-collapsed'); env.windowEvents.resize();
  assert.equal(env.width(), 620);
  env.context.innerWidth = 1600; env.windowEvents.resize();
  assert.equal(env.width(), 620);
  assert.equal(env.writes.length, 0);
  env.classes.add('is-inspector-collapsed'); env.windowEvents.resize();
  assert.equal(env.handle.tabIndex, -1);
  env.emit('pointerdown'); assert.equal(env.handle.capture, undefined);
  env.classes.clear(); env.context.innerWidth = 800; env.windowEvents.resize();
  env.emit('pointerdown'); assert.equal(env.handle.capture, undefined);
  assert.equal(env.handle.tabIndex, -1);
});

test('missing or corrupt layout storage never breaks lesson editing', () => {
  for (const saved of ['bad JSON', '{}', '"600"', 'null']) assert.equal(setup({ saved }).width(), 340);
  assert.equal(setup({ saved: '99999' }).width(), 680);
  const env = setup({ blockedStorage: true });
  env.emit('keydown', { key: 'ArrowLeft' }); assert.equal(env.width(), 360);
  assert.doesNotMatch(source, /fetch\(|\.netlify\/functions/);
});

test('lesson resize handle is wired to a scoped desktop layout and does not change other builders', () => {
  const html = fs.readFileSync(require.resolve('../public/members/module/studio/index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../public/members/module/studio/style.css'), 'utf8');
  assert.match(html, /src="inspector-resize.js" defer/);
  assert.match(html, /id="lesson-inspector-resize" role="separator"[^>]+aria-controls="lesson-inspector-panel"/);
  assert.match(css, /#lesson-workspace \.builder-layout \{ grid-template-columns: var\(--lesson-palette-width\) minmax\(360px, 1fr\) var\(--lesson-inspector-track, var\(--lesson-inspector-width\)\)/);
  assert.match(css, /#lesson-workspace\.is-inspector-collapsed \.inspector-resize-handle \{ display: none/);
});
