'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const media = require('../public/assets/js/google-media');
const lesson = require('../public/members/module/studio/lesson-model');
const player = require('../public/members/module/lesson/lesson-parser');
const dashboard = require('../public/members/module/studio/dashboard-model');
const dashboardParser = require('../public/members/dashboard-parser');
const drive = 'https://drive.google.com/file/d/1ExampleFile12345/view';
const notebook = 'https://notebook.google.com/notebook/34d7c6f5-8448-4a4b-88a2-54ca40c451dc/artifact/95b77346-f4b3-4b9a-8329-82ada04bc1c2';

test('Google links become preview URLs without losing resource keys or accepting unrelated URLs', () => {
  for (const link of [drive, '1ExampleFile12345', 'https://drive.google.com/open?id=1ExampleFile12345', 'https://drive.google.com/uc?id=1ExampleFile12345&export=download']) {
    assert.equal(media.resolve(link).embedUrl, drive.replace('/view', '/preview'));
  }
  const keyed = media.resolve(`${drive}?resourcekey=0-key_123&utm_source=tracking`);
  assert.match(keyed.embedUrl, /preview\?resourcekey=0-key_123$/);
  assert.equal(media.resolve(keyed.href).embedUrl, keyed.embedUrl);
  for (const [kind, mode] of [['document', 'preview'], ['spreadsheets', 'preview'], ['presentation', 'embed']]) {
    assert.equal(media.resolve(`https://docs.google.com/${kind}/d/1ExampleFile12345/edit`).embedUrl, `https://docs.google.com/${kind}/d/1ExampleFile12345/${mode}`);
  }
  assert.match(media.resolve('https://docs.google.com/spreadsheets/d/e/1PublishedFile123/pubhtml').embedUrl, /\/e\/1PublishedFile123\/pubhtml$/);
  assert.equal(media.resolve('https://drive.google.com/drive/u/0/folders/1ExampleFile12345').embedUrl, 'https://drive.google.com/embeddedfolderview?id=1ExampleFile12345#grid');
  for (const bad of ['javascript:alert(1)', 'http://drive.google.com/file/d/1ExampleFile12345/view', '//drive.google.com/x', '<iframe src="x"></iframe>', 'https://drive.google.com.evil.example/file/d/1ExampleFile12345/view', 'https://evil.example/', 'https://user@drive.google.com/file/d/1ExampleFile12345/view', 'https://drive.google.com:444/file/d/1ExampleFile12345/view', 'https://drive.google.com/redirect?id=1ExampleFile12345', 'https://docs.google.com/file/d/123/view', `${drive}/bad`, `${notebook}/bad`]) {
    assert.equal(media.resolve(bad), null, bad);
  }
  assert.deepEqual(media.dimensions({ width: 200, height: -1 }), { width: 100, heightPercent: 20 });
  assert.deepEqual(media.dimensions({ width: null, height: undefined }), { width: 100, heightPercent: 60 });
  assert.equal(media.dimensions({ height: '600px;display:none' }).heightPercent, 60);
  assert.equal(media.dimensions({ height: 720 }).heightPercent, 90, 'Old pixel settings remain readable');
  assert.equal(media.dimensions({ heightPercent: 250 }).heightPercent, 150);
});

test('Notebook links are safe external cards, never blocked iframes or endless loading states', () => {
  for (const url of [notebook, notebook.replace('notebook.google', 'notebooklm.google')]) {
    const parsed = media.resolve(`${url}?utm_source=tracking`);
    assert.equal(parsed.embedUrl, '');
    assert.equal(parsed.href, url);
    const html = media.html({ url });
    assert.doesNotMatch(html, /<iframe|data-google-load/);
    assert.match(html, /Notatnik otworzy się w nowej karcie/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  }
});

test('Google cards serialize in lessons and dashboards with shared preview and size validation', () => {
  const model = lesson.createLesson({ filename: 'google-test.md', slides: [{ blocks: [{ type: 'google', url: drive, title: 'Audio i plik', width: 80, height: 200 }] }] });
  assert.equal(lesson.validateLesson(model).valid, true);
  const md = lesson.serializeLesson(model);
  const parsed = lesson.parseEditableLesson(md, model.filename);
  const block = parsed.slides[0].blocks.find((entry) => entry.type === 'google');
  assert.equal(block.width, 80); assert.equal(block.heightPercent, 25); assert.equal(block.url, drive);
  const rendered = player.parseLesson(md, model.filename).slides[0].html;
  assert.match(rendered, /--google-media-width:80%;--google-media-height:25vh/);
  assert.match(rendered, /data-google-load/); assert.doesNotMatch(rendered, /<iframe/);
  const invalid = lesson.createLesson({ filename: 'bad.md', slides: [{ blocks: [{ type: 'google', url: 'https://evil.example' }] }] });
  assert.equal(lesson.validateLesson(invalid).valid, false);
  assert.match(player.renderMarkdown(':::googlemedia\nurl: javascript:alert(1)\n:::'), /google-media-error/);

  const dash = dashboard.createModel({ sections: [{ title: 'Pliki', blocks: [dashboard.createModule({ module: 'google', title: 'Mój plik', id: drive, embedWidth: 75, embedHeight: 220 })] }] });
  assert.equal(dashboard.validate(dash).valid, true);
  const source = dashboard.serialize(dash);
  const reimported = dashboard.parseMarkdown(source).sections[0].blocks[0];
  assert.equal(reimported.module, 'google'); assert.equal(reimported.embedWidth, 75); assert.equal(reimported.embedHeightPercent, 28);
  assert.equal(reimported.embedHeightLegacy, 220);
  assert.equal(reimported.id, drive);
  const card = dashboardParser.parse(source).sections[0].items[0];
  assert.equal(card.type, 'embed');
  assert.deepEqual(dashboard.toDashboardModel(dashboard.parseMarkdown(source)), dashboardParser.parse(source));
  const params = new URL(card.href, 'https://course.example').searchParams;
  assert.equal(params.get('id'), drive); assert.equal(params.get('title'), 'Mój plik');
  assert.equal(params.get('height'), '220');
});

test('unchanged legacy Google links retain progress IDs; editing size publishes percentages', () => {
  const original = dashboard.createModel({ sections: [{ title: 'Materiały', blocks: [dashboard.createModule({ module: 'google', title: 'Plik', id: drive, embedWidth: 75, embedHeight: 720 })] }] });
  const source = dashboard.serialize(original);
  const parsed = dashboard.parseMarkdown(source);
  const before = dashboardParser.parse(source).sections[0].items[0];
  const unchanged = dashboardParser.parse(dashboard.serialize(parsed)).sections[0].items[0];
  assert.equal(unchanged.href, before.href);
  assert.equal(unchanged.id, before.id, 'Saving without editing must not reset the progress identity');
  parsed.sections[0].blocks[0].embedHeightPercent = 50;
  const changed = dashboardParser.parse(dashboard.serialize(parsed)).sections[0].items[0];
  const url = new URL(changed.href, 'https://course.example');
  assert.equal(url.searchParams.get('heightPercent'), '50');
  assert.equal(url.searchParams.has('height'), false);
});

test('media iframe is created only on click, can resize/close, and markup is escaped', (t) => {
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://course.example' }); t.after(() => dom.window.close());
  const doc = dom.window.document, host = doc.getElementById('host');
  media.mount(host, { url: drive, title: '<img src=x onerror=alert(1)>', height: 200 });
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('iframe'), null);
  const open = host.querySelector('[data-google-load]'); open.click();
  let frame = host.querySelector('iframe');
  assert.equal(frame.src, drive.replace('/view', '/preview'));
  assert.equal(frame.title, '<img src=x onerror=alert(1)>');
  assert.equal(frame.loading, 'eager');
  assert.equal(frame.getAttribute('sandbox'), null, 'Use the standard allowlisted Google player without extra sandbox restrictions');
  host.querySelector('[data-google-size="10"]').click();
  assert.equal(host.querySelector('.google-media-viewport').style.height, '35vh');
  open.click(); assert.equal(host.querySelector('iframe'), null, 'Closing stops media and releases the frame');
  assert.equal(open.getAttribute('aria-expanded'), 'false');
  open.click(); assert.equal(host.querySelectorAll('iframe').length, 1);
  assert.notEqual(host.querySelector('iframe'), frame);
});

for (const scenario of ['allowed', 'locked', 'anonymous']) test(`Google viewer uses the real progress client without duplicate opens or swallowed access errors (${scenario})`, async (t) => {
  const base = path.join(__dirname, '..', 'public');
  const dom = new JSDOM(fs.readFileSync(path.join(base, 'members/module/google/index.html'), 'utf8'), { url: `https://course.example/members/module/google/?id=${encodeURIComponent(drive)}&material=course-google`, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window; let progressCalls = 0;
  w.fetch = async (url, options) => {
    assert.equal(url, '/.netlify/functions/progress'); assert.equal(options.method, 'POST');
    const event = JSON.parse(options.body); progressCalls++; assert.equal(event.action, 'open'); assert.equal(event.materialType, 'embed');
    return new Response(JSON.stringify(scenario === 'locked' ? { error: 'SEQUENCE_LOCKED' } : { saved: true }), { status: scenario === 'locked' ? 409 : 200 });
  };
  w.ChemAuth = { ready: Promise.resolve({ authenticated: scenario !== 'anonymous', session: { ok: scenario !== 'anonymous' } }), getAccessToken: async () => 'fixture-token' };
  w.eval(fs.readFileSync(path.join(base, 'assets/js/progress.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(base, 'assets/js/google-media.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(base, 'members/module/google/script.js'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(progressCalls, scenario === 'anonymous' ? 0 : 1);
  const button = w.document.querySelector('[data-google-load]');
  assert.equal(Boolean(button), scenario === 'allowed');
  assert.equal(Boolean(w.document.querySelector('iframe')), scenario === 'allowed', 'Dashboard opens preview only after authorization');
  if (button) { button.click(); assert.equal(w.document.querySelector('iframe'), null); button.click(); assert.ok(w.document.querySelector('iframe')); assert.equal(progressCalls, 1); }
  if (scenario === 'locked') assert.match(w.document.getElementById('google-viewer-status').textContent, /poprzedni krok/);
});
