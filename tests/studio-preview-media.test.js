'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../public/members/module/studio/script.js'), 'utf8');
function implementation(name, next) {
  const start = script.indexOf(`  ${name === 'hydrateStudioLessonMedia' ? 'async ' : ''}function ${name}(`);
  const end = script.indexOf(`\n  function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return script.slice(start, end);
}

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag; this.ownerDocument = ownerDocument; this.dataset = {}; this.children = [];
    this.listeners = {}; this.isConnected = true; this.attributes = {};
    this.classList = { add() {}, remove() {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) {
    const disconnect = (node) => { node.isConnected = false; node.children.forEach(disconnect); };
    this.children.forEach(disconnect); this.children = nodes;
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  contains(node) { return this.children.some((child) => child === node || child.contains(node)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
}
function setup({ read, timeout = false, count = 1 } = {}) {
  const requests = [], revoked = [], created = [];
  const document = { createElement: (tag) => new Element(tag, document) };
  document.documentElement = new Element('html', document); document.body = new Element('body', document);
  document.importNode = (node) => node;
  const figure = (index = 0) => { const node = document.createElement('figure'); node.dataset = { lessonMediaRef: `media-${index}`, lessonMediaAlt: 'Schemat' }; return node; };
  const root = document.createElement('main');
  root.append(...Array.from({ length: count }, (_, index) => figure(index)));
  const state = {
    lesson: { model: { filename: 'draft.md', slides: [{ id: 's1' }] }, remoteFilename: 'published.md', remoteRepositoryId: 'biology', mediaObjectUrls: ['blob:embedded'] },
    contentLibrary: { selectedRepositoryId: 'chemistry' }, previewWindows: {}, dashboard: { model: {} }
  };
  const all = (selector, node) => node.children.flatMap((child) => [...(child.dataset.lessonMediaRef ? [child] : []), ...all(selector, child)]);
  const context = {
    state, document, URL: class extends URL {
      static createObjectURL(blob) { created.push(blob); return `blob:preview-${created.length}`; }
      static revokeObjectURL(url) { revoked.push(url); }
    },
    URLSearchParams, all, fullPreviewMedia: new WeakMap(),
    create: (tag, className, text) => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; },
    window: {
      ChemContentLibrary: { readMediaBlob: async (input, options) => { requests.push({ input, options }); return read ? read(input, options) : new Blob(['image']); } },
      setTimeout: timeout ? (fn) => { queueMicrotask(fn); return 1; } : setTimeout,
      clearTimeout: timeout ? () => {} : clearTimeout
    },
    bindLessonPreviewImageResize() {}, clearTypesetMath() {}, addFullPreviewHead() {},
    lessonModelApi: { validateLesson: () => ({ valid: true }) }, buildLessonPreviewShell: () => figure(),
    preparePreviewYouTube() {}, bindPreviewFlashcards() {}, bindPreviewAtonom() {}, bindPreviewOpenAnswers() {},
    bindPreviewAiHelp() {}, bindPreviewTasks() {}, typesetMath() {}, flushDrafts() {}, toast() {}
  };
  vm.createContext(context);
  vm.runInContext(implementation('hydrateStudioLessonMedia', 'bindLessonPreviewCanvasControls')
    + implementation('renderFullPreviewWindow', 'syncFullPreview')
    + implementation('openFullPreview', 'requestedFullPreviewMode')
    + implementation('startStandalonePreview', 'updateLessonNodeSummary'), context);
  return { context, state, document, root, requests, revoked, created };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('preview media uses the original lesson and repository and a separate object URL collection', async () => {
  const app = setup(); const popupUrls = [];
  await app.context.hydrateStudioLessonMedia(app.root, popupUrls);
  const image = app.root.children[0].children[0];
  assert.equal(image.tagName, 'img'); assert.equal(image.alt, 'Schemat');
  assert.equal(image.src, 'blob:preview-1'); assert.equal(image.ownerDocument, app.document);
  assert.equal(app.requests[0].input.repositoryId, 'biology');
  assert.equal(app.requests[0].input.materialId, 'published.md');
  assert.deepEqual(popupUrls, ['blob:preview-1']);
  assert.deepEqual(app.state.lesson.mediaObjectUrls, ['blob:embedded']);
});

test('shared media uses its explicit repository and no local lesson owner', async () => {
  const app = setup();
  Object.assign(app.root.children[0].dataset, { lessonMediaScope: 'shared', lessonMediaRepository: 'shared-library' });
  await app.context.hydrateStudioLessonMedia(app.root);
  const input = app.requests[0].input;
  assert.equal(input.scope, 'shared'); assert.equal(input.materialId, ''); assert.equal(input.materialKind, '');
  assert.equal(input.repositoryId, 'shared-library');
});

test('failed image loading presents a working explicit retry rather than an infinite placeholder', async () => {
  let attempts = 0;
  const app = setup({ read: () => { if (++attempts === 1) throw Object.assign(new Error('missing'), { code: 'CONTENT_FILE_NOT_FOUND' }); return new Blob(['image']); } });
  await app.context.hydrateStudioLessonMedia(app.root);
  const placeholder = app.root.children[0].children[0];
  assert.match(placeholder.children[0].textContent, /Nie znaleziono pliku/);
  placeholder.children[1].listeners.click();
  await settle();
  assert.equal(app.root.children[0].children[0].tagName, 'img');
  assert.equal(app.requests[1].options.bypassCache, true);
});

test('a stalled media promise times out and a detached preview cannot retain blob URLs', async () => {
  const stalled = setup({ timeout: true, read: () => new Promise(() => {}) });
  await stalled.context.hydrateStudioLessonMedia(stalled.root);
  assert.equal(stalled.root.children[0].children[0].children[1].tagName, 'button');
  const removed = setup(); removed.root.children[0].isConnected = false;
  await removed.context.hydrateStudioLessonMedia(removed.root);
  assert.equal(removed.requests.length, 0); assert.equal(removed.created.length, 0);
});

test('image decode failure releases its URL and offers retry', async () => {
  const app = setup();
  await app.context.hydrateStudioLessonMedia(app.root);
  app.root.children[0].children[0].listeners.error();
  assert.deepEqual(app.revoked, ['blob:preview-1']);
  assert.equal(app.root.children[0].children[0].children[1].tagName, 'button');
});

test('a read completing after the popup closes cannot allocate an orphaned object URL', async () => {
  let finishRead;
  const app = setup({ read: () => new Promise((resolve) => { finishRead = resolve; }) });
  app.document.defaultView = { closed: false };
  const pending = app.context.hydrateStudioLessonMedia(app.root);
  app.document.defaultView.closed = true;
  finishRead(new Blob(['image']));
  await pending;
  assert.equal(app.created.length, 0);
});

test('full lesson window hydrates images on open and refresh and cleans up only its own URLs', async () => {
  const app = setup(); const events = {};
  const popup = { document: app.document, scrollY: 0, requestAnimationFrame: (fn) => fn(), scrollTo() {}, addEventListener: (name, callback) => { events[name] = callback; } };
  app.context.renderFullPreviewWindow('lesson', popup);
  await settle();
  assert.equal(app.requests.length, 1); assert.equal(app.created.length, 1);
  app.context.renderFullPreviewWindow('lesson', popup);
  await settle();
  assert.equal(app.requests.length, 2);
  assert.deepEqual(app.revoked, ['blob:preview-1']);
  events.pagehide();
  assert.deepEqual(app.revoked, ['blob:preview-1', 'blob:preview-2']);
  assert.deepEqual(app.state.lesson.mediaObjectUrls, ['blob:embedded']);
});

test('opening a new lesson preview transfers validated repository and owner before rendering', () => {
  const app = setup(); let opened;
  app.context.window.location = { origin: 'https://course.example' };
  app.context.window.open = (url) => { opened = url; return { focus() {} }; };
  app.context.openFullPreview('lesson');
  const parameters = new URL(opened).searchParams;
  assert.equal(parameters.get('previewRepo'), 'biology');
  assert.equal(parameters.get('previewOwner'), 'published.md');
  app.state.lesson.remoteFilename = ''; app.state.lesson.remoteRepositoryId = '';
  app.context.window.location.search = new URL(opened).search;
  app.context.window.addEventListener = () => {};
  let rendered;
  app.context.renderFullPreviewWindow = () => { rendered = { owner: app.state.lesson.remoteFilename, repository: app.state.lesson.remoteRepositoryId }; };
  app.context.startStandalonePreview('lesson');
  assert.deepEqual(rendered, { owner: 'published.md', repository: 'biology' });
});
