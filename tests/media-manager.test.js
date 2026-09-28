'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../public/assets/js/media-manager.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const asset = (index, other = {}) => ({ filename: `image-${index}.png`, reference: `assets/shared/image-${index}.png`,
  mimeType: 'image/png', size: 1024, sha: String(index).padStart(40, 'a'), createdAt: new Date(1700000000000 + index * 1000).toISOString(), ...other });
function setup(t, overrides = {}) {
  const dom = new JSDOM('<body></body>', { url: 'https://course.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, reads = [], revoked = [], observers = [], calls = [];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.URL.createObjectURL = () => `blob:${Math.random()}`;
  w.URL.revokeObjectURL = url => revoked.push(url);
  w.confirm = () => true;
  w.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this); }
    observe(node) { this.nodes.push(node); }
    unobserve() {} disconnect() {}
    visible(count = this.nodes.length) { this.callback(this.nodes.slice(0, count).map(target => ({ target, isIntersecting: true }))); }
  };
  w.ChemContentLibrary = {
    repositories: async () => [{ id: 'bio', label: 'Biologia', default: true }, { id: 'chem', label: 'Chemia' }],
    listMedia: async input => { calls.push(input); return [asset(1)]; },
    readMediaBlob: async input => { reads.push(input); return new w.Blob(['image'], { type: 'image/png' }); },
    ...overrides
  };
  w.eval(code);
  t.after(() => { w.document.querySelector('dialog[open]')?.close(); w.close(); });
  return { w, d: w.document, reads, revoked, observers, calls, open: options => w.ChemMediaManager.open({ repositoryId: 'bio', ...options }) };
}

test('1000 media names are searchable locally while DOM and thumbnail requests stay bounded', async t => {
  const assets = Array.from({ length: 1000 }, (_, index) => asset(index, index === 10 ? { displayName: 'Żółć — przekrój' } : {}));
  const h = setup(t, { listMedia: async () => assets }); await h.open();
  assert.equal(h.d.querySelectorAll('.chem-media-card').length, 24);
  assert.equal(h.d.querySelector('.chem-media-card strong').textContent, 'image-999.png');
  assert.equal(h.reads.length, 0);
  h.observers.at(-1).visible(3); await settle();
  assert.equal(h.reads.length, 3);
  const search = h.d.querySelector('input[type=search]'); search.value = 'zolc'; search.dispatchEvent(new h.w.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(h.d.querySelectorAll('.chem-media-card').length, 1);
  assert.equal(h.d.querySelector('.chem-media-card strong').textContent, 'Żółć — przekrój');
  search.value = ''; search.dispatchEvent(new h.w.Event('input')); await new Promise(resolve => setTimeout(resolve, 150));
  h.observers.at(-1).visible(3); await settle();
  assert.equal(h.reads.length, 3, 'returning to a page reuses thumbnails');
  h.d.querySelector('[aria-label="Następna strona obrazów"]').click();
  assert.equal(h.d.querySelectorAll('.chem-media-card').length, 24);
  assert.equal(h.d.querySelector('.chem-media-card strong').textContent, 'image-975.png');
});

test('repository changes ignore stale lists and disable local folder from a different owner', async t => {
  const first = deferred(), second = deferred();
  const h = setup(t, { listMedia: input => input.repositoryId === 'bio' ? first.promise : second.promise });
  const opening = h.open({ materialKind: 'presentation', materialId: 'lesson' }); await settle();
  const select = h.d.querySelector('.chem-media-repository select'); select.value = 'chem'; select.dispatchEvent(new h.w.Event('change'));
  second.resolve([asset(2)]); await settle(); first.resolve([asset(1)]); await opening;
  assert.equal(select.value, 'chem');
  assert.equal(h.d.querySelector('[data-media-scope=local]').disabled, true);
  assert.equal(h.d.querySelector('.chem-media-card strong').textContent, 'image-2.png');
  h.observers.at(-1).visible(); await settle();
  assert.equal(h.reads[0].repositoryId, 'chem'); assert.equal(h.reads[0].scope, 'shared');
});

test('rapid search discards queued thumbnails and closing prevents late object URL creation', async t => {
  const release = deferred(); let active = 0, peak = 0, requests = 0;
  const h = setup(t, { listMedia: async () => Array.from({ length: 100 }, (_, i) => asset(i)),
    readMediaBlob: async () => { requests++; active++; peak = Math.max(active, peak); await release.promise; active--; return new h.w.Blob(['image']); } });
  await h.open(); h.observers.at(-1).visible();
  assert.equal(requests, 3);
  const search = h.d.querySelector('input[type=search]'); search.value = 'nothing'; search.dispatchEvent(new h.w.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 150));
  h.d.querySelector('dialog').close(); release.resolve(); await settle();
  assert.equal(peak, 3); assert.equal(requests, 3); assert.equal(h.revoked.length, 0);
});

test('picker selection is consumed once and image paste never bubbles to the presentation editor', async t => {
  const selected = [], uploads = [], release = deferred(); let bubbled = 0;
  const h = setup(t, { uploadMedia: async input => { uploads.push(input); await release.promise; return { ...asset(2), repositoryId: input.repositoryId }; } });
  await h.open({ onSelect: value => selected.push(value) });
  const select = h.d.querySelector('.chem-media-select'); select.click(); select.click();
  assert.equal(selected.length, 1); assert.equal(selected[0].repositoryId, 'bio');
  await h.open(); h.d.addEventListener('paste', () => { bubbled++; });
  const file = new h.w.File(['image'], 'test.png', { type: 'image/png' });
  const paste = () => { const event = new h.w.Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: { files: [file] } }); h.d.querySelector('.chem-media-drop').dispatchEvent(event); };
  paste(); paste(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(uploads.length, 1); assert.equal(bubbled, 0);
  release.resolve(); await settle(); assert.match(h.d.querySelector('.chem-media-status').textContent, /Dodano 1/);
});

test('rename keeps the reference and safely renders searchable names containing HTML', async t => {
  const names = [], selected = [];
  const h = setup(t, { renameMedia: async input => { names.push(input); return { displayName: input.displayName }; } });
  await h.open({ onSelect: value => selected.push(value) });
  h.d.querySelector('.chem-media-rename').click();
  const input = h.d.querySelector('.chem-media-name-form input'); input.value = '<img src=x onerror=alert(1)> Żółć';
  h.d.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.equal(names[0].reference, asset(1).reference); assert.equal(names[0].repositoryId, 'bio');
  assert.equal(h.d.querySelector('.chem-media-card strong').textContent, input.value);
  assert.equal(h.d.querySelector('.chem-media-card-copy img'), null);
  h.d.querySelector('.chem-media-select').click(); assert.equal(selected[0].reference, asset(1).reference);
});

test('deleting one of two identical binary files keeps the other reference', async t => {
  const h = setup(t, { listMedia: async () => [asset(1), asset(2, { sha: asset(1).sha })], removeMedia: async () => ({ deleted: true }) });
  await h.open(); h.d.querySelector('.chem-media-remove').click(); await settle();
  assert.equal(h.d.querySelectorAll('.chem-media-card').length, 1);
  assert.equal(h.d.querySelector('.chem-media-card strong').textContent, 'image-1.png');
});

test('a material library cannot switch to the shared folder or another repository', async t => {
  const h = setup(t);
  await h.open({ scope: 'local', materialKind: 'presentation', materialId: 'chemia', lockLocal: true, title: 'Obrazy tej prezentacji' });
  assert.equal(h.d.querySelector('#chem-media-title').textContent, 'Obrazy tej prezentacji');
  assert.equal(h.d.querySelector('.chem-media-location').hidden, true);
  h.d.querySelector('[data-media-scope=shared]').click();
  const select = h.d.querySelector('.chem-media-repository select');
  select.value = 'chem'; select.dispatchEvent(new h.w.Event('change')); await settle();
  assert.equal(select.value, 'bio'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].scope, 'local'); assert.equal(h.calls[0].materialId, 'chemia');
  assert.match(h.d.querySelector('.chem-media-footer').textContent, /presentations\/chemia\/photos\//);
  h.observers.at(-1).visible(1); await settle(); assert.equal(h.reads[0].variant, 'thumbnail');
});

test('upload produces a bounded WebP thumbnail and preserves the original binary', async t => {
  const uploads = [], sizes = []; let closed = 0;
  const h = setup(t, { uploadMedia: async input => { uploads.push(input); return { reference: `photos/${input.filename}`, thumbnailSaved: true }; } });
  h.w.createImageBitmap = async () => ({ width: 2000, height: 4000, close() { closed++; } });
  h.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  h.w.HTMLCanvasElement.prototype.toBlob = function (callback) { sizes.push([this.width, this.height]); callback(new h.w.Blob(['RIFF1234WEBP'], { type: 'image/webp' })); };
  const file = new h.w.File(['original-binary'], 'Zdjęcie.png', { type: 'image/png' });
  const asset = await h.w.ChemMediaManager.uploadImage(file, { scope: 'local', materialKind: 'exam', materialId: 'test', repositoryId: 'bio', createThumbnails: true });
  assert.deepEqual(sizes, [[240, 480]]); assert.equal(closed, 1);
  assert.equal(uploads[0].contentBase64, Buffer.from('original-binary').toString('base64'));
  assert.equal(uploads[0].thumbnailBase64, Buffer.from('RIFF1234WEBP').toString('base64'));
  assert.equal(uploads[0].scope, 'local'); assert.equal(asset.width, 2000); assert.equal(asset.height, 4000);
  await assert.rejects(h.w.ChemMediaManager.uploadImage(file, { scope: 'local' }), /Nie wybrano/);
  assert.equal(uploads.length, 1, 'Invalid owner must never fall back to shared storage');
});

test('thumbnail decoding failure does not lose an otherwise valid upload', async t => {
  let saved;
  const h = setup(t, { uploadMedia: async input => { saved = input; return { reference: `photos/${input.filename}` }; } });
  h.w.createImageBitmap = async () => { throw Error('Decoder unavailable'); };
  await h.w.ChemMediaManager.uploadImage(new h.w.File(['gif'], 'animation.gif', { type: 'image/gif' }), { scope: 'local', materialKind: 'presentation', materialId: 'slides', repositoryId: 'bio', createThumbnails: true });
  assert.equal(saved.mimeType, 'image/gif'); assert.equal(saved.thumbnailBase64, undefined);
});

test('thumbnail choice asks once per material, supports no, and cancellation never uploads', async t => {
  const uploads = [];
  const h = setup(t, { uploadMedia: async input => { uploads.push(input); return { reference: `photos/${input.filename}` }; } });
  const owner = { scope: 'local', materialKind: 'presentation', materialId: 'first', repositoryId: 'bio' };
  const file = new h.w.File(['image'], 'a.png', { type: 'image/png' });
  const uploading = h.w.ChemMediaManager.uploadImage(file, owner);
  const dialog = h.d.querySelector('.chem-thumbnail-dialog'); assert.ok(dialog.open); assert.equal(uploads.length, 0);
  [...dialog.querySelectorAll('button')].find(node => node.textContent === 'Nie, tylko oryginały').click();
  await uploading; assert.equal(uploads.length, 1); assert.equal(uploads[0].thumbnailBase64, undefined);
  await h.w.ChemMediaManager.uploadImage(file, owner); assert.equal(uploads.length, 2); assert.equal(h.d.querySelector('.chem-thumbnail-dialog'), null);
  const cancelled = h.w.ChemMediaManager.uploadImage(file, { ...owner, materialId: 'second' });
  h.d.querySelector('.chem-thumbnail-dialog').dispatchEvent(new h.w.Event('cancel', { cancelable: true }));
  await assert.rejects(cancelled, error => error.code === 'MEDIA_UPLOAD_CANCELLED'); assert.equal(uploads.length, 2);
  await h.open({ ...owner, lockLocal: true });
  const preference = h.d.querySelector('.chem-media-thumbnail-policy select'); assert.equal(preference.value, 'no');
  preference.value = 'ask'; preference.dispatchEvent(new h.w.Event('change'));
  const again = h.w.ChemMediaManager.chooseThumbnails(owner); assert.ok(h.d.querySelector('.chem-thumbnail-dialog'));
  h.d.querySelector('.chem-thumbnail-dialog .chem-media-select').click(); assert.equal(await again, true);
  assert.equal(preference.value, 'yes');
});

test('unremembered thumbnail choices apply to one batch and preferences are isolated by repository and user', async t => {
  const h = setup(t); h.w.ChemAuth = { getUser: () => ({ id: 'first-user' }) };
  const owner = { scope: 'local', materialKind: 'exam', materialId: 'first', repositoryId: 'bio' };
  const choice = h.w.ChemMediaManager.chooseThumbnails(owner);
  h.d.querySelector('.chem-thumbnail-dialog input').checked = false;
  h.d.querySelector('.chem-thumbnail-dialog .chem-media-select').click(); assert.equal(await choice, true);
  const next = h.w.ChemMediaManager.chooseThumbnails(owner); assert.ok(h.d.querySelector('.chem-thumbnail-dialog'));
  h.d.querySelector('.chem-thumbnail-dialog .chem-media-select').click(); await next;
  assert.equal(await h.w.ChemMediaManager.chooseThumbnails(owner), true);
  for (const input of [{ ...owner, repositoryId: 'chem' }, owner]) {
    h.w.ChemAuth = { getUser: () => ({ id: 'second-user' }) };
    const ask = h.w.ChemMediaManager.chooseThumbnails(input);
    assert.ok(h.d.querySelector('.chem-thumbnail-dialog')); h.d.querySelector('.chem-thumbnail-dialog').dispatchEvent(new h.w.Event('cancel', { cancelable: true }));
    assert.equal(await ask, null);
  }
});

test('generating a missing thumbnail keeps exactly one original image card', async t => {
  const writes = [];
  const h = setup(t, { listMedia: async () => [asset(1, { hasThumbnail: false })], createMediaThumbnail: async input => { writes.push(input); return { hasThumbnail: true }; } });
  h.w.createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
  h.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  h.w.HTMLCanvasElement.prototype.toBlob = function (callback) { callback(new h.w.Blob(['RIFF1234WEBP'], { type: 'image/webp' })); };
  await h.open(); h.d.querySelector('.chem-media-generate').click();
  for (let i = 0; i < 10 && !writes.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  await settle();
  assert.equal(writes.length, 1); assert.equal(writes[0].reference, asset(1).reference); assert.equal(writes[0].expectedSha, asset(1).sha);
  assert.equal(h.d.querySelectorAll('.chem-media-card').length, 1); assert.equal(h.d.querySelector('.chem-media-generate'), null);
  assert.equal(h.d.querySelector('.chem-media-thumbnail-state').textContent, 'Miniatura gotowa');
});
