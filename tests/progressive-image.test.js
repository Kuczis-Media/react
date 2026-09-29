'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const loader = require('../public/assets/js/progressive-image.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup(t) {
  const dom = new JSDOM('<main><figure data-lesson-media-ref="assets/shared/a.png"><img></figure></main>', { url: 'https://course.test', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  return { w: dom.window, image: dom.window.document.querySelector('img'), figure: dom.window.document.querySelector('figure') };
}

test('the same image keeps its thumbnail until the original has decoded', async t => {
  const { w, image } = setup(t), full = deferred(), decode = deferred(), display = [];
  w.HTMLImageElement.prototype.decode = function () { return this.src.endsWith('/full') ? decode.promise : Promise.resolve(); };
  const getUrl = () => full.promise; getUrl.preview = async () => '/small';
  const pending = loader.load(image, getUrl, { onDisplay: info => display.push(info.thumbnail) });
  await tick(); assert.equal(image.dataset.mediaQuality, 'thumbnail'); assert.match(image.src, /\/small$/);
  full.resolve('/full'); await tick(); assert.match(image.src, /\/small$/);
  decode.resolve(); await pending; assert.match(image.src, /\/full$/);
  assert.deepEqual(display, [true, false]); assert.equal(image.getAttribute('aria-busy'), 'false');
});

test('a late thumbnail cannot downgrade a full image', async t => {
  const { image } = setup(t), small = deferred(), display = [];
  const getUrl = async () => '/full'; getUrl.preview = () => small.promise;
  await loader.load(image, getUrl, { onDisplay: info => display.push(info.thumbnail) });
  small.resolve('/small'); await tick();
  assert.deepEqual(display, [false]); assert.match(image.src, /\/full$/);
});

test('a failed full download or decode keeps a working thumbnail; missing thumbnails still show the original', async t => {
  const { w, image } = setup(t);
  const getUrl = async () => { throw Error('offline'); }; getUrl.preview = async () => '/small';
  let errors = 0;
  assert.equal(await loader.load(image, getUrl, { onError: () => errors++ }), true);
  assert.match(image.src, /\/small$/); assert.equal(errors, 0);
  w.HTMLImageElement.prototype.decode = function () { return this.src.endsWith('/invalid') ? Promise.reject(Error('invalid image')) : Promise.resolve(); };
  const invalid = async () => '/invalid'; invalid.preview = async () => '/small';
  await loader.load(image, invalid, { onError: () => errors++ }); assert.match(image.src, /\/small$/); assert.equal(errors, 0);
  const old = async () => '/original'; old.preview = async () => { throw Error('no thumbnail'); };
  await loader.load(image, old, { onError: () => errors++ }); assert.match(image.src, /\/original$/); assert.equal(errors, 0);
});

test('a replaced, cancelled or detached image ignores late results', async t => {
  const { image } = setup(t), old = deferred();
  const pending = loader.load(image, () => old.promise);
  await tick(); await loader.load(image, async () => '/current'); old.resolve('/stale'); await pending;
  assert.match(image.src, /\/current$/);
  for (const dispose of [() => loader.cancel(image), () => image.remove()]) {
    const next = deferred(); const loading = loader.load(image, () => next.promise);
    await tick(); dispose(); next.resolve('/late'); await loading; assert.match(image.src, /\/current$/);
  }
});

test('managed lesson images preserve ownership for both reads and clean broken URLs', async t => {
  const { w, figure } = setup(t), inputs = [], urls = [], revoked = [];
  w.HTMLImageElement.prototype.decode = async () => { throw Error('broken'); };
  const input = { scope: 'local', materialKind: 'lesson', materialId: 'lesson.md', repositoryId: 'bio', reference: 'photos/a.png' };
  let errors = 0, count = 0;
  await loader.loadManaged(figure, input, {
    library: { readMediaBlob: async (owner, options) => { inputs.push({ ...owner, ...options }); return new w.Blob(['image']); } },
    objectUrls: urls, urlApi: { createObjectURL: () => `blob:${++count}`, revokeObjectURL: url => revoked.push(url) }, bypassCache: true,
    onError: () => errors++
  });
  assert.equal(inputs.length, 2); assert.equal(inputs[0].variant, 'thumbnail'); assert.equal(inputs[1].variant, undefined);
  assert.ok(inputs.every(value => value.repositoryId === 'bio' && value.materialId === 'lesson.md' && value.bypassCache));
  assert.equal(errors, 1); assert.equal(urls.length, 0); assert.equal(revoked.length, 2);
});

test('the learner lesson hydrator uses a thumbnail before the original without replacing another slide', async t => {
  const { w, figure } = setup(t), full = deferred(), reads = [], created = [];
  w.ChemProgressiveImage = loader;
  w.ChemContentLibrary = { readMediaBlob: async input => { reads.push(input); return input.variant ? new w.Blob(['small']) : full.promise; } };
  w.URL.createObjectURL = blob => { created.push(blob); return `blob:${created.length}`; }; w.URL.revokeObjectURL = () => {};
  const source = fs.readFileSync(require.resolve('../public/members/module/lesson/script.js'), 'utf8');
  const begin = source.indexOf('  async function hydrateManagedImages('), end = source.indexOf('  function scheduleLessonImagePrefetch(', begin);
  w.eval(`const state = {filename:'one.md',repositoryId:'bio',mediaObjectUrls:[]};${source.slice(begin, end)};window.hydrateTest = hydrateManagedImages;`);
  figure.dataset.lessonMediaScope = 'shared'; figure.dataset.lessonMediaRepository = 'images';
  const pending = w.hydrateTest(w.document.querySelector('main')); await tick();
  assert.equal(figure.querySelector('img').dataset.mediaQuality, 'thumbnail');
  assert.ok(reads.every(input => input.scope === 'shared' && input.repositoryId === 'images' && input.materialId === ''));
  figure.remove(); full.resolve(new w.Blob(['full'])); await pending;
  assert.equal(created.length, 1, 'Detached lesson does not allocate an original URL');
});

test('flashcard image caches separate thumbnail, original and repository, including after clearing pending reads', async t => {
  const { w } = setup(t), reads = [], revoked = []; let count = 0;
  w.URL.createObjectURL = () => `blob:${++count}`; w.URL.revokeObjectURL = url => revoked.push(url);
  w.eval(fs.readFileSync(require.resolve('../public/assets/js/quiz-flashcards.js'), 'utf8'));
  const cache = w.ChemQuizFlashcards.imageCache(async (ref, repo) => { reads.push(['full', ref, repo]); return new w.Blob(['full']); },
    async (ref, repo) => { reads.push(['small', ref, repo]); return new w.Blob(['small']); });
  const small = await cache.get.preview('assets/shared/a.png', 'bio'), full = await cache.get('assets/shared/a.png', 'bio');
  assert.notEqual(small, full); assert.equal(await cache.get.preview('assets/shared/a.png', 'bio'), small);
  assert.notEqual(await cache.get.preview('assets/shared/a.png', 'chem'), small); assert.equal(reads.length, 3);
  cache.clear(); assert.equal(revoked.length, 3);
  const release = deferred(), pendingCache = w.ChemQuizFlashcards.imageCache(() => release.promise, () => release.promise);
  const pending = pendingCache.get.preview('assets/shared/a.png'); await tick(); pendingCache.clear(); release.resolve(new w.Blob(['late']));
  await assert.rejects(pending, /PREVIEW_CHANGED/); assert.equal(count, 3);
});

test('flashcard faces show small images while originals are downloading', async t => {
  const { w } = setup(t), full = deferred();
  w.ChemProgressiveImage = loader; w.eval(fs.readFileSync(require.resolve('../public/assets/js/quiz-flashcards.js'), 'utf8'));
  const getUrl = () => full.promise; getUrl.preview = async () => '/small';
  const face = w.ChemQuizFlashcards.face({ text: 'Pytanie', images: [{ ref: 'assets/shared/a.png', alt: 'Diagram' }] }, getUrl);
  w.document.body.append(face); await tick();
  assert.equal(face.querySelector('img').dataset.mediaQuality, 'thumbnail'); assert.equal(face.querySelector('figure span').hidden, true);
  full.resolve('/full'); await tick(); assert.equal(face.querySelector('img').dataset.mediaQuality, 'full');
});

test('occlusion keeps its masks and revealed answer when a thumbnail becomes the original', async t => {
  const { w } = setup(t), full = deferred();
  w.ChemProgressiveImage = loader;
  w.ChemQuizOcclusionModel = { COLORS: { teal: '#087a6b' } };
  for (const file of ['quiz-flashcards.js', 'quiz-occlusion.js']) w.eval(fs.readFileSync(require.resolve('../public/assets/js/' + file), 'utf8'));
  const getUrl = () => full.promise; getUrl.preview = async () => '/small';
  const card = w.ChemQuizOcclusion.card({ questionId: 'cell', prompt: 'Rozpoznaj element', image: { ref: 'assets/shared/a.png' },
    occlusion: { color: 'teal', masks: [{ maskId: 'nucleus', x: .3, y: .4, width: .2, height: .1, answer: 'Jądro' }] } }, getUrl);
  w.document.body.append(card); await tick();
  const image = card.querySelector('img'), mask = card.querySelector('.io-mask');
  assert.equal(image.dataset.mediaQuality, 'thumbnail'); assert.equal(card.querySelector('.io-stage').hidden, false);
  assert.equal(mask.style.left, '30%'); assert.equal(mask.style.top, '40%');
  mask.click(); assert.equal(mask.getAttribute('aria-expanded'), 'true');
  full.resolve('/full'); await tick();
  assert.equal(card.querySelector('img'), image); assert.equal(image.dataset.mediaQuality, 'full');
  assert.equal(mask.getAttribute('aria-expanded'), 'true'); assert.match(card.querySelector('.io-answers').textContent, /Jądro/);
});

test('lesson image resize controls stay singular across thumbnail and original updates', t => {
  const { w, figure } = setup(t);
  const source = fs.readFileSync(require.resolve('../public/members/module/studio/script.js'), 'utf8');
  const begin = source.indexOf('  function bindLessonPreviewImageResize('), end = source.indexOf('  function addFullPreviewHead(', begin);
  w.eval(`const state = {lesson:{selectedId:'image'}};
    const findLessonNode = () => ({kind:'block',node:{id:'image',type:'image',ref:'assets/shared/a.png',width:65}});
    const all = (selector, root) => [...root.querySelectorAll(selector)];
    const create = (tag, className, text) => {const el=document.createElement(tag);el.className=className;if(text)el.textContent=text;return el;};
    ${source.slice(begin, end)};window.bindResizeTest=bindLessonPreviewImageResize;`);
  for (let update = 0; update < 3; update++) w.bindResizeTest(w.document.querySelector('main'));
  assert.equal(figure.querySelectorAll('.lesson-preview-image-handle').length, 1);
  assert.equal(figure.querySelectorAll('.lesson-preview-image-size').length, 1);
  assert.equal(figure.style.getPropertyValue('--lesson-image-width'), '65%');
});
