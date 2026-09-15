'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const geometry = require('../public/assets/js/quiz-occlusion-model');
const model = require('../public/members/module/studio/quiz-model');
const common = require('../netlify/quiz-common');
const repository = require('../netlify/content-repository');
const progressStorage = require('../netlify/progress-storage');
const endpoint = require('../netlify/functions/quiz');
const contentEndpoint = require('../netlify/functions/content-library');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const plain = (v) => JSON.parse(JSON.stringify(v));
const rectangle = (v) => Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, v[key]]));
function deck() {
  return model.createQuiz({ quizId: 'histologia-maski', mode: 'deck', metadata: { title: 'Histologia', courseId: 'course', active: true, status: 'published' }, questions: [{
    questionId: 'obraz-1', type: 'image_occlusion', prompt: '**Rozpoznaj** zasłonięte fragmenty.', image: { ref: 'photos/histologia.webp', alt: 'Przekrój tkanki' },
    explanation: 'Cały schemat', occlusion: { mode: 'one_per_mask', color: 'teal', masks: [
      { maskId: 'm1', x: .22, y: .35, width: .18, height: .08, name: 'Jądro', answer: '**Jądro komórkowe**', explanation: 'Wzór: \\(\\ce{H2O}\\)' },
      { maskId: 'm2', x: .55, y: .6, width: .2, height: .12, name: 'Błona', answer: 'Błona komórkowa', explanation: '' }
    ] }
  }] });
}

test('occlusion geometry is normalized, scale independent and bounded for drawing/movement/resizing', () => {
  for (const width of [1000, 500, 280]) {
    const bounds = { left: 10, top: 20, width, height: width / 2 };
    const start = geometry.point(10 + width * .22, 20 + width / 2 * .35, bounds);
    const end = geometry.point(10 + width * .4, 20 + width / 2 * .43, bounds);
    assert.deepEqual(geometry.draw(start, end), { x: .22, y: .35, width: .18, height: .08 });
    assert.deepEqual(geometry.draw(end, start), geometry.draw(start, end));
    assert.deepEqual(geometry.point(-100, 10000, bounds), { x: 0, y: 1 });
  }
  const original = { x: .22, y: .35, width: .18, height: .08 };
  assert.deepEqual(geometry.move(original, 2, -2), { x: .82, y: 0, width: .18, height: .08 });
  assert.deepEqual(geometry.resize(original, 2, -2), { x: .22, y: .35, width: .78, height: .005 });
  assert.deepEqual(geometry.rect({ x: 1, y: -1, width: 100, height: 0 }), { x: .995, y: 0, width: .005, height: .005 });
  assert.equal(geometry.point(20, 30, { width: 0, height: 20 }), null);
  assert.deepEqual(original, { x: .22, y: .35, width: .18, height: .08 }, 'Helpers do not mutate source data');
});

test('occlusion saves masks, edits, order, source image and LaTeX through the existing quiz publisher', () => {
  const value = deck();
  const mask = value.questions[0].occlusion.masks[0];
  Object.assign(mask, geometry.move(mask, .1, .05));
  mask.answer += '\n\\(\\alpha + \\beta\\)';
  value.questions[0].occlusion.masks.reverse();
  const source = model.serialize(value);
  assert.deepEqual(model.parse(source), value);
  assert.equal(common.validateDefinition(JSON.parse(source), value.quizId).valid, true);
  assert.equal(repository._test.validateAssetContent('quiz', value.quizId, source), source);
  assert.equal(model.CARD_TYPES.IMAGE_OCCLUSION, 'image_occlusion');
  assert.equal(model.score(value).percent, null);
  assert.equal(common.gradeQuiz(value).gradingStatus, 'not_scored');
  assert.deepEqual(common.publicDefinition(value), value, 'Practice cards carry their answers without changing exam key policy');
  const old = model.createQuiz({ questions: [{ type: 'true_false', questionId: 'old', points: 2 }] });
  old.questions.push(value.questions[0]);
  const answers = { old: [old.questions[0].options[0].optionId] };
  assert.equal(common.gradeQuiz(old, answers).maximum, 2);
  assert.equal(common.gradeQuiz(old, answers).percent, 100);
});

test('occlusion rejects malformed/out-of-bounds masks, unsafe sources and empty publication without damaging drafts', () => {
  for (const change of [
    (q) => { q.occlusion.masks[0].x = NaN; },
    (q) => { q.occlusion.masks[0].width = 1; },
    (q) => { q.occlusion.masks[0].height = 0; },
    (q) => { q.occlusion.masks[1].maskId = 'm1'; },
    (q) => { q.occlusion.color = 'url(https://evil.example)'; },
    (q) => { q.occlusion.mode = 'unknown'; },
    (q) => { q.occlusion = null; },
    (q) => { q.occlusion.masks[0] = null; },
    (q) => { q.occlusion.masks = Array.from({ length: 51 }, (_, i) => ({ ...q.occlusion.masks[0], maskId: `m${i}` })); }
  ]) {
    const value = deck(); change(value.questions[0]);
    assert.equal(common.validateDefinition(value).valid, false);
    assert.equal(model.validate(value).valid, false);
    assert.throws(() => model.parse(JSON.stringify(value)), /współrzędne lub dane masek/);
  }
  const value = deck();
  value.questions[0].image.ref = 'https://evil.example/source.svg';
  assert.equal(common.validateDefinition(value).valid, false);
  value.questions[0].image.ref = '';
  assert.equal(common.validateDefinition(value).valid, false);
  assert.equal(model.validate(value).valid, false);
  value.metadata.status = 'draft'; value.questions[0].occlusion.masks = [];
  assert.equal(common.validateDefinition(value).valid, true);
  assert.equal(model.validate(value).valid, true);
  value.metadata.status = 'published'; value.questions[0].image.ref = 'assets/shared/tkanka.png';
  assert.equal(common.validateDefinition(value).valid, false);
  value.questions[0].occlusion.masks = [{ maskId: 'empty-answer', x: 0, y: 0, width: .1, height: .1, name: '', answer: '', explanation: '' }];
  assert.equal(common.validateDefinition(value).valid, true, 'The uncovered source image can itself be the answer');
});

test('three occlusion modes expand stable virtual cards without duplicating source data', () => {
  const q = deck().questions[0], before = structuredClone(q), ordinary = model.createQuestion({ type: 'flashcard' });
  const cards = geometry.expand([ordinary, q]);
  assert.equal(cards.length, 3);
  assert.equal(cards[0], ordinary);
  assert.deepEqual(cards.slice(1).map((c) => c.activeMaskIds), [['m1'], ['m2']]);
  assert.notEqual(cards[1].studyKey, cards[2].studyKey);
  assert.equal(cards[1].image, q.image); assert.equal(cards[2].occlusion, q.occlusion);
  assert.deepEqual(q, before);
  q.occlusion.mode = 'all';
  assert.deepEqual(geometry.expand([q])[0].activeMaskIds, ['m1', 'm2']);
  q.occlusion.mode = 'random'; let calls = 0;
  const random = geometry.expand([q], () => { calls++; return .9; });
  assert.equal(random.length, 1); assert.deepEqual(random[0].activeMaskIds, ['m2']); assert.equal(calls, 1);
});

test('occlusion reuses quiz permissions: active students read masks but cannot publish or delete them', async (t) => {
  progressStorage.setStoreFactory(() => ({ getWithMetadata: async () => null }));
  t.after(() => progressStorage.setStoreFactory(null));
  const value = deck(), user = { id: 'student-occlusion', app_metadata: { roles: ['active'] } };
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify(user)));
  t.mock.method(repository, 'readAsset', async () => ({ content: model.serialize(value), sha: 'a'.repeat(40) }));
  let writes = 0;
  t.mock.method(repository, 'saveAsset', async () => { writes++; return {}; });
  t.mock.method(repository, 'deleteAsset', async () => { writes++; return {}; });
  const event = { httpMethod: 'GET', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json', origin: 'https://course.example', host: 'course.example' }, queryStringParameters: { quiz: value.quizId } };
  const context = { clientContext: { user, identity: { url: 'https://course.example/.netlify/identity' } } };
  const response = await endpoint.handler(event, context);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(JSON.parse(response.body).quiz.questions[0].occlusion, value.questions[0].occlusion);
  const mutation = { ...event, httpMethod: 'PUT', body: JSON.stringify({ kind: 'quiz', filename: value.quizId, content: model.serialize(value), repositoryId: 'default', expectedSha: '' }) };
  assert.equal((await contentEndpoint.handler(mutation, context)).statusCode, 403);
  assert.equal((await contentEndpoint.handler({ ...mutation, httpMethod: 'DELETE' }, context)).statusCode, 403);
  assert.equal(writes, 0);
  value.metadata.active = false;
  assert.equal((await endpoint.handler(event, context)).statusCode, 404);
});

function browser(t) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM('<main></main>', { url: 'https://course.example/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.MathJax = { typesetPromise: async () => {}, typesetClear() {} };
  for (const file of ['members/module/lesson/lesson-parser.js', 'assets/js/assessment-text.js', 'members/module/studio/assessment-editor.js', 'assets/js/quiz-practice.js', 'assets/js/quiz-occlusion-model.js', 'assets/js/quiz-flashcards.js', 'assets/js/quiz-occlusion.js']) w.eval(read(file));
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  return w;
}
async function editor(t, initialMasks = []) {
  const w = browser(t), question = deck().questions[0]; question.occlusion.masks = initialMasks;
  let changes = 0;
  const view = w.ChemQuizOcclusion.editor(question, { getUrl: async () => 'blob:fixture', onChange: () => changes++, onImage() {} });
  w.document.body.append(view); await tick();
  const stage = view.querySelector('.io-stage'), img = stage.querySelector('img');
  Object.defineProperty(img, 'naturalWidth', { value: 1000 }); img.dispatchEvent(new w.Event('load'));
  stage.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 500 });
  function pointer(target, type, x, y, pointerType = 'mouse') {
    const event = new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType }, isPrimary: { value: true } });
    target.dispatchEvent(event);
  }
  return { w, view, question, stage, overlay: view.querySelector('.io-overlay'), pointer, changes: () => changes };
}

for (const device of ['mouse', 'touch', 'pen']) test(`editor draws, moves, resizes and cancels ${device} gestures in normalized coordinates`, async (t) => {
  const h = await editor(t), { view, overlay, question, pointer } = h;
  view.querySelector('[data-io-draw]').click();
  pointer(overlay, 'pointerdown', 230, 195, device); pointer(overlay, 'pointermove', 410, 235, device);
  assert.equal(question.occlusion.masks.length, 0, 'No unfinished gesture can enter the auto-saved draft');
  pointer(overlay, 'pointerup', 410, 235, device);
  assert.deepEqual(rectangle(question.occlusion.masks[0]), { x: .22, y: .35, width: .18, height: .08 });
  assert.equal(h.changes(), 1);
  view.querySelector('[data-io-draw]').click();
  pointer(overlay.querySelector('[data-mask-id]'), 'pointerdown', 250, 205, device);
  pointer(overlay, 'pointermove', 350, 255, device); pointer(overlay, 'pointerup', 350, 255, device);
  assert.deepEqual(rectangle(question.occlusion.masks[0]), { x: .32, y: .45, width: .18, height: .08 });
  pointer(overlay.querySelector('[data-io-resize]'), 'pointerdown', 510, 285, device);
  pointer(overlay, 'pointerup', 560, 305, device);
  assert.deepEqual(rectangle(question.occlusion.masks[0]), { x: .32, y: .45, width: .23, height: .12 });
  const before = plain(question.occlusion);
  pointer(overlay.querySelector('[data-mask-id]'), 'pointerdown', 350, 255, device);
  pointer(overlay, 'pointermove', 600, 400, device); pointer(overlay, 'pointercancel', 600, 400, device);
  assert.deepEqual(plain(question.occlusion), before); assert.equal(h.changes(), 3);
  view.querySelector('[data-io-draw]').click();
  pointer(overlay, 'pointerdown', 230, 195, device); pointer(overlay, 'pointercancel', 410, 235, device);
  assert.equal(question.occlusion.masks.length, 1); assert.equal(h.changes(), 3);
});

test('editor percentage fields, keyboard, mask metadata and deletion preserve source and safe bounds', async (t) => {
  const h = await editor(t, deck().questions[0].occlusion.masks), { view, question, w } = h;
  const x = view.querySelector('[data-io-coordinate="x"]'); x.value = '30'; x.dispatchEvent(new w.Event('change'));
  assert.equal(question.occlusion.masks[0].x, .3);
  const mask = view.querySelector('[data-mask-id="m1"]');
  assert.match(mask.style.left, /^30%$/); assert.match(mask.style.width, /^18%$/);
  mask.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(question.occlusion.masks[0].x, .305);
  assert.equal(w.document.activeElement.dataset.maskId, 'm1');
  assert.equal(w.document.activeElement.getAttribute('aria-pressed'), 'true');
  const width = view.querySelector('[data-io-coordinate="width"]'); width.value = '500'; width.dispatchEvent(new w.Event('change'));
  assert.equal(question.occlusion.masks[0].width, .695);
  const input = view.querySelector('[aria-label="Odpowiedź maski (opcjonalnie)"]');
  input.value = 'Woda: \\(\\ce{H2O}\\)\n**Opis**'; input.dispatchEvent(new w.Event('input'));
  assert.equal(question.occlusion.masks[0].answer, input.value);
  assert.ok(input.closest('.quiz-math-field').querySelector('.assessment-equation-trigger'));
  view.querySelector('[data-io-delete]').click();
  assert.equal(question.occlusion.masks.length, 1); assert.equal(question.occlusion.masks[0].maskId, 'm2');
  assert.equal(question.image.ref, 'photos/histologia.webp');
  assert.equal(common.validateDefinition({ ...deck(), questions: [question] }).valid, true);
});

test('at the mask limit the author can still exit drawing and delete a mask', async (t) => {
  const masks = Array.from({ length: 49 }, (_, i) => ({ ...deck().questions[0].occlusion.masks[0], maskId: `m${i}` }));
  const { view, overlay, pointer, question } = await editor(t, masks);
  const draw = view.querySelector('[data-io-draw]'); draw.click();
  pointer(overlay, 'pointerdown', 20, 30); pointer(overlay, 'pointerup', 120, 130);
  assert.equal(question.occlusion.masks.length, 50); assert.equal(draw.disabled, false);
  assert.equal(view.querySelector('[data-io-add]').disabled, true);
  draw.click(); assert.equal(view.querySelector('.io-stage').dataset.tool, 'select');
  view.querySelector('[data-io-delete]').click(); assert.equal(question.occlusion.masks.length, 49); assert.equal(draw.disabled, false);
});

test('learner sees opaque active masks first, reveals only requested answers and renders Markdown/LaTeX', async (t) => {
  const w = browser(t), q = deck().questions[0]; q.activeMaskIds = ['m1'];
  q.occlusion.masks[0].answer += '<script>alert(1)</script>';
  const view = w.ChemQuizOcclusion.card(q, async () => 'blob:fixture'); w.document.body.append(view);
  const states = []; view.addEventListener('flashcard-reveal', (e) => states.push(e.detail));
  assert.equal(view.querySelector('.io-stage').hidden, true, 'No uncovered source flash while the image loads');
  assert.equal(view.querySelector('.io-reveal-list'), null, 'Single mask view must not render redundant toggle buttons');
  assert.doesNotMatch(view.textContent, /Jądro|Błona|Cały schemat/);
  assert.equal(view.querySelector('[data-mask-id="m2"]').disabled, true);
  view.querySelector('[data-mask-id="m1"]').click(); await tick();
  assert.equal(view.querySelectorAll('.is-revealed').length, 1);
  assert.equal(view.querySelectorAll('[data-mask-answer]').length, 1);
  assert.match(view.textContent, /Jądro komórkowe/); assert.doesNotMatch(view.textContent, /Błona komórkowa/);
  assert.ok(view.querySelector('.io-answer strong')); assert.ok(view.querySelector('[data-assessment-math]')); assert.ok(view.querySelector('sub'));
  assert.equal(view.querySelector('script'), null); assert.deepEqual(states, [true]);
  view.querySelector('[data-flashcard-reveal]').click(); assert.equal(view.querySelectorAll('[data-mask-answer]').length, 0);
  assert.deepEqual(states, [true, false]);
});

test('all-masks study requires all answers revealed while per-mask study creates separate locally rated cards', async (t) => {
  const w = browser(t), q = deck().questions[0]; let completed = 0, reads = 0;
  w.URL.createObjectURL = () => 'blob:cached'; w.URL.revokeObjectURL = () => {};
  const cache = w.ChemQuizFlashcards.imageCache(async () => { reads++; return new Blob(['fixture']); });
  t.after(() => cache.clear());
  const view = w.ChemQuizFlashcards.study({ questions: [q], getUrl: cache.get, onComplete: () => { completed++; } }); w.document.body.append(view);
  assert.match(view.textContent, /Karta 1 z 2/);
  for (let i = 0; i < 2; i++) {
    await tick(); assert.equal(view.querySelectorAll('.io-card').length, 1);
    assert.equal(view.querySelector('.quiz-flashcard-ratings').hidden, true);
    view.querySelector('[data-flashcard-reveal]').click();
    assert.equal(view.querySelector('.quiz-flashcard-ratings').hidden, false);
    view.querySelector('[data-flashcard-rating="3"]').click();
  }
  await tick(); assert.equal(completed, 1); assert.equal(reads, 1); assert.match(view.textContent, /Ukończono 2 kart/);
  q.occlusion.mode = 'all';
  const all = w.ChemQuizFlashcards.study({ questions: [q], getUrl: cache.get, preview: true }); w.document.body.append(all);
  assert.match(all.textContent, /Karta 1 z 1/);
  all.querySelector('[data-mask-id="m1"]').click(); assert.equal(all.querySelector('.quiz-flashcard-ratings').hidden, true);
  all.querySelector('[data-mask-id="m2"]').click(); assert.equal(all.querySelector('.quiz-flashcard-ratings').hidden, false);
});

test('image failures offer an explicit retry, never request storage repeatedly on their own', async (t) => {
  const w = browser(t); let reads = 0;
  const view = w.ChemQuizOcclusion.card(deck().questions[0], async () => { reads++; throw new Error('offline'); }); w.document.body.append(view);
  await tick(); assert.equal(reads, 1); assert.equal(view.querySelector('.io-stage').hidden, true);
  assert.match(view.querySelector('[role="status"]').textContent, /Nie udało się/);
  view.querySelector('[role="status"] button').click(); await tick(); assert.equal(reads, 2);
});
