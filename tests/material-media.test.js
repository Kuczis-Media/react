'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const repository = require('../netlify/content-repository.js');
const content = require('../netlify/functions/content-library.js');
const exam = require('../netlify/exam-common.js');
const examModel = require('../public/members/module/studio/exam-model.js');
const config = { configured: true, token: 'fixture', repository: 'school/content', ref: 'main', root: 'course', id: 'bio', label: 'Biologia' };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const webp = Buffer.from('RIFF1234WEBPfixture');
const sha = 'a'.repeat(40);
const reply = (data, status = 200) => new Response(Buffer.isBuffer(data) ? data : JSON.stringify(data), { status });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('original and thumbnail are saved next to the owning presentation or exam, never in shared media', async () => {
  for (const kind of ['presentation', 'exam']) {
    const requests = [];
    const saved = await repository.saveMedia('local', kind, 'test', 'image.png', png.toString('base64'), 'image/png', {
      config, thumbnailBase64: webp.toString('base64'), fetchImpl: async (url, options) => {
        requests.push({ url: String(url), body: JSON.parse(options.body) }); return reply({ content: { sha } }, 201);
      }
    });
    assert.equal(saved.thumbnailSaved, true); assert.equal(saved.reference, 'photos/image.png');
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, new RegExp(`/course/${kind}s/test/photos/image.png$`));
    assert.match(requests[1].url, new RegExp(`/course/${kind}s/test/photos/\\.thumbs/image.png.webp$`));
    assert.equal(requests[0].body.content, png.toString('base64')); assert.equal(requests[1].body.content, webp.toString('base64'));
    assert.ok(requests.every(entry => !entry.url.includes('shared')));
  }
});

test('thumbnail validation happens before any repository mutation and the request schema preserves it', async () => {
  let calls = 0;
  const options = { config, fetchImpl: async () => { calls++; throw Error('Must not write'); } };
  for (const [thumbnailBase64, code] of [[png.toString('base64'), 'MEDIA_INVALID'], [Buffer.concat([webp, Buffer.alloc(256 * 1024)]).toString('base64'), 'CONTENT_FILE_TOO_LARGE']]) {
    await assert.rejects(repository.saveMedia('local', 'exam', 'test', 'a.png', png.toString('base64'), 'image/png', { ...options, thumbnailBase64 }), error => error.code === code);
  }
  assert.equal(calls, 0);
  const body = { kind: 'media', scope: 'local', materialKind: 'presentation', materialId: 'test', filename: 'a.png', contentBase64: png.toString('base64'), mimeType: 'image/png', thumbnailBase64: webp.toString('base64') };
  assert.equal(content._test.validateMutationBody(body, 'PUT').value.thumbnailBase64, body.thumbnailBase64);
  assert.equal(content._test.validateMutationBody({ ...body, thumbnailBase64: {} }, 'PUT').ok, false);
  assert.equal(content._test.validateMutationBody({ ...body, thumbnailPath: '../other' }, 'PUT').ok, false);
});

test('failed derivative storage still returns the successfully stored original', async () => {
  const saved = await repository.saveMedia('local', 'presentation', 'test', 'a.png', png.toString('base64'), 'image/png', {
    config, thumbnailBase64: webp.toString('base64'), fetchImpl: async url => String(url).includes('.thumbs') ? reply({}, 503) : reply({ content: { sha } }, 201)
  });
  assert.equal(saved.sha, sha); assert.equal(saved.thumbnailSaved, false); assert.equal(saved.reference, 'photos/a.png');
});

test('thumbnail reads are isolated by owner and variant, with cached fallback for old images', async () => {
  repository._test.clearCache();
  const calls = [];
  const options = { config, fetchImpl: async url => {
    calls.push(String(url)); return String(url).includes('.thumbs') ? reply(webp) : reply(png);
  } };
  const full = await repository.readMedia('local', 'presentation', 'one', 'photos/image.png', options);
  const thumbnail = await repository.readMedia('local', 'presentation', 'one', 'photos/image.png', { ...options, variant: 'thumbnail' });
  assert.equal(full.mimeType, 'image/png'); assert.equal(thumbnail.mimeType, 'image/webp');
  assert.deepEqual(thumbnail.buffer, webp); assert.equal(calls.length, 2);
  await repository.readMedia('local', 'presentation', 'one', 'photos/image.png', { ...options, variant: 'thumbnail' });
  assert.equal(calls.length, 2);
  await repository.readMedia('local', 'exam', 'one', 'photos/image.png', { ...options, variant: 'thumbnail' });
  assert.equal(calls.length, 3); assert.match(calls[2], /exams\/one\/photos\/\.thumbs\//);
  await assert.rejects(repository.readMedia('local', 'presentation', 'one', 'photos/../secret.png', { ...options, variant: 'thumbnail' }));
  await assert.rejects(repository.readMedia('local', 'presentation', 'one', 'photos/image.png', { ...options, variant: '../' }));
  assert.equal(calls.length, 3);
  repository._test.clearCache(); let olderCalls = 0;
  const legacy = { config, variant: 'thumbnail', fetchImpl: async url => { olderCalls++; return String(url).includes('.thumbs') ? reply({}, 404) : reply(png); } };
  assert.deepEqual((await repository.readMedia('local', 'exam', 'old', 'photos/a.png', legacy)).buffer, png);
  await repository.readMedia('local', 'exam', 'old', 'photos/a.png', legacy);
  await repository.readMedia('local', 'exam', 'old', 'photos/a.png', { ...legacy, variant: '' });
  assert.equal(olderCalls, 2);
});

test('deleting a media file removes its derivative using that derivative SHA', async () => {
  const calls = [], derivativeSha = 'b'.repeat(40);
  const result = await repository.deleteMedia('local', 'exam', 'test', 'photos/a.png', sha, { config,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
      return reply(options.method === 'DELETE' ? { commit: { sha } } : { sha: derivativeSha });
    }
  });
  assert.equal(result.deleted, true);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'DELETE', 'DELETE']);
  assert.equal(calls[2].body.sha, sha); assert.equal(calls[1].body.sha, derivativeSha);
  assert.match(calls[1].url, /exams\/test\/photos\/\.thumbs\/a.png.webp$/);
});

test('one image plus its derivative folder is one library item, and older originals remain listed', async () => {
  const options = { config, fetchImpl: async url => {
    if (String(url).includes('/.thumbs')) return reply([{ type: 'file', name: 'a.png.webp', sha }]);
    return reply([{ type: 'file', name: 'a.png', size: 20, sha }, { type: 'file', name: 'old.png', size: 40, sha }, { type: 'dir', name: '.thumbs', sha }]);
  } };
  const listed = await repository.listMedia('local', 'presentation', 'test', options);
  assert.equal(listed.length, 2);
  assert.equal(listed.find(item => item.filename === 'a.png').hasThumbnail, true);
  assert.equal(listed.find(item => item.filename === 'old.png').hasThumbnail, false);
  assert.ok(listed.every(item => !item.reference.includes('.thumbs')));
});

test('deleting an original without a thumbnail succeeds and a thumbnail deletion failure keeps the original', async () => {
  const calls = [];
  await repository.deleteMedia('local', 'exam', 'test', 'photos/a.png', sha, { config, fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    return String(url).includes('.thumbs') ? reply({}, 404) : reply({ commit: { sha } });
  } });
  assert.deepEqual(calls.map(call => call.method), ['GET', 'DELETE']);
  assert.ok(!calls[1].url.includes('.thumbs'));
  const failures = [];
  await assert.rejects(repository.deleteMedia('local', 'exam', 'test', 'photos/a.png', sha, { config, fetchImpl: async (url, options = {}) => {
    failures.push({ url: String(url), method: options.method || 'GET' });
    return options.method === 'DELETE' ? reply({}, 503) : reply({ sha });
  } }), error => error.code === 'CONTENT_REPOSITORY_UNAVAILABLE');
  assert.equal(failures.filter(call => call.method === 'DELETE' && !call.url.includes('.thumbs')).length, 0);
});

test('a conflict deleting the original can be retried after its thumbnail has already been removed', async () => {
  let thumbnailExists = true, conflict = true, originalExists = true;
  const opts = { config, fetchImpl: async (url, options = {}) => {
    if (String(url).includes('.thumbs')) {
      if (!thumbnailExists) return reply({}, 404);
      if (options.method === 'DELETE') { thumbnailExists = false; return reply({ commit: { sha } }); }
      return reply({ sha });
    }
    if (options.method === 'DELETE') {
      if (conflict) return reply({}, 409);
      originalExists = false; return reply({ commit: { sha } });
    }
    return reply(png);
  } };
  await assert.rejects(repository.deleteMedia('local', 'exam', 'conflict', 'photos/a.png', sha, opts), error => error.code === 'CONTENT_WRITE_CONFLICT');
  assert.equal(thumbnailExists, false); assert.equal(originalExists, true);
  repository._test.clearCache();
  assert.deepEqual((await repository.readMedia('local', 'exam', 'conflict', 'photos/a.png', { ...opts, variant: 'thumbnail' })).buffer, png);
  conflict = false;
  assert.equal((await repository.deleteMedia('local', 'exam', 'conflict', 'photos/a.png', sha, opts)).deleted, true);
  assert.equal(originalExists, false);
});

test('backfilling a thumbnail writes only the derivative and verifies the original revision', async () => {
  const calls = [];
  const opts = { config, fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (options.method === 'PUT') return reply({ content: { sha } }, 201);
    return String(url).includes('.thumbs') ? reply({}, 404) : reply({ sha });
  } };
  const result = await repository.saveMediaThumbnail('local', 'presentation', 'test', 'photos/a.png', sha, webp.toString('base64'), opts);
  assert.equal(result.hasThumbnail, true); assert.equal(result.reference, 'photos/a.png');
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1); assert.match(calls.at(-1).url, /photos\/\.thumbs\/a.png.webp$/);
  calls.length = 0;
  await assert.rejects(repository.saveMediaThumbnail('local', 'presentation', 'test', 'photos/a.png', 'b'.repeat(40), webp.toString('base64'), opts), error => error.code === 'CONTENT_WRITE_CONFLICT');
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
  const body = { kind: 'media_thumbnail', scope: 'local', materialKind: 'presentation', materialId: 'test', reference: 'photos/a.png', expectedSha: sha, thumbnailBase64: webp.toString('base64') };
  assert.equal(content._test.validateMutationBody(body, 'PUT').value.kind, 'media_thumbnail');
  assert.equal(content._test.validateMutationBody(body, 'DELETE').ok, false);
  assert.equal(content._test.validateMutationBody({ ...body, filename: 'other.png' }, 'PUT').ok, false);
});

test('incomplete exam drafts can own media, while publishing still rejects missing answers', async () => {
  const value = examModel.createExam({ examId: 'draft', questions: [{ questionId: 'q', type: 'short_text', prompt: 'Obejrzyj zdjęcie', acceptedAnswers: [] }] });
  value.status = 'draft';
  const json = examModel.serializeExam(value);
  assert.equal(exam.validateDefinition(JSON.parse(json), 'draft', { allowDraft: true }).valid, true);
  assert.equal(exam.validateDefinition(JSON.parse(json), 'draft').valid, false);
  assert.throws(() => examModel.serializeExam({ ...value, status: 'published' }), /poprawn/);
  const opts = { config, fetchImpl: async () => reply({ content: { sha } }, 201) };
  assert.equal((await repository.saveAsset('exam', 'draft', json, opts)).sha, sha);
  await assert.rejects(repository.saveAsset('exam', 'draft', JSON.stringify({ ...value, status: 'published' }), opts), error => error.code === 'QUESTION_ANSWER_REQUIRED');
  const invalidIds = { ...value, questions: [value.questions[0], value.questions[0]] };
  assert.equal(exam.validateDefinition(invalidIds, 'draft', { allowDraft: true }).valid, false);
});

function client(t, fetch) {
  const dom = new JSDOM('', { url: 'https://course.test', runScripts: 'outside-only' });
  const w = dom.window;
  w.ChemAuth = { getUser: () => ({ id: 'admin' }), getAccessToken: async () => 'fixture' };
  w.fetch = fetch;
  w.eval(fs.readFileSync(path.join(__dirname, '../public/assets/js/content-library.js'), 'utf8'));
  t.after(() => w.close());
  return w.ChemContentLibrary;
}
const media = { scope: 'local', materialKind: 'presentation', materialId: 'test', reference: 'photos/a.png', repositoryId: 'bio' };
const binary = blob => ({ ok: true, status: 200, blob: async () => blob });

test('progressive loading shows a thumbnail first, keeps variants separate and reuses both caches', async t => {
  const full = deferred(), small = deferred(), calls = [], shown = [];
  const api = client(t, async url => { calls.push(String(url)); return String(url).includes('variant=thumbnail') ? small.promise : full.promise; });
  const task = api.readMediaProgressively(media, (blob, info) => shown.push({ blob, ...info }));
  await tick(); assert.equal(calls.length, 2);
  small.resolve(binary(new Blob(['small'], { type: 'image/webp' }))); await tick();
  assert.equal(shown.length, 1); assert.equal(shown[0].thumbnail, true);
  full.resolve(binary(new Blob(['full'], { type: 'image/png' }))); await task;
  assert.equal(shown.length, 2); assert.equal(shown[1].thumbnail, false);
  await api.readMediaProgressively(media, () => {}); assert.equal(calls.length, 2);
});

test('late thumbnail never replaces an original and a failed original can leave a usable preview', async t => {
  const small = deferred(), shown = [];
  const api = client(t, async url => String(url).includes('variant=thumbnail') ? small.promise : binary(new Blob(['full'], { type: 'image/png' })));
  await api.readMediaProgressively(media, (blob, info) => shown.push(info.thumbnail));
  small.resolve(binary(new Blob(['small'], { type: 'image/webp' }))); await tick();
  assert.deepEqual(shown, [false]);
  const fallback = client(t, async url => String(url).includes('variant=thumbnail') ? binary(new Blob(['small'], { type: 'image/webp' })) : { ok: false, status: 404, json: async () => ({ error: 'CONTENT_FILE_NOT_FOUND' }) });
  const kept = await fallback.readMediaProgressively(media, () => {});
  assert.equal(await kept.text(), 'small');
});

test('creating a thumbnail bypasses a browser-cached full-size fallback on its next read', async t => {
  let generated = false; const reads = [];
  const api = client(t, async (url, options) => {
    if (options.method === 'PUT') { generated = true; return { ok: true, status: 200, json: async () => ({ reference: media.reference, hasThumbnail: true }) }; }
    reads.push(options.cache);
    return binary(new Blob([generated ? 'small' : 'original'], { type: generated ? 'image/webp' : 'image/png' }));
  });
  assert.equal(await (await api.readMediaBlob({ ...media, variant: 'thumbnail' })).text(), 'original');
  await api.createMediaThumbnail({ ...media, expectedSha: sha, thumbnailBase64: webp.toString('base64') });
  assert.equal(await (await api.readMediaBlob({ ...media, variant: 'thumbnail' })).text(), 'small');
  assert.deepEqual(reads, ['default', 'reload']);
});
