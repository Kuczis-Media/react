'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repository = require('../netlify/content-repository.js');
const contentFunction = require('../netlify/functions/content-library.js');
const presentationCommon = require('../netlify/presentation-common.js');
const presentationModel = require('../public/members/module/studio/presentation-model.js');
const lessonModel = require('../public/members/module/studio/lesson-model.js');
const lessonParser = require('../public/members/module/lesson/lesson-parser.js');

const configured = {
  configured: true,
  token: 'github_pat_test',
  repository: 'Kuczis-Media/chemdisk-content',
  ref: 'main',
  root: '',
  id: 'default',
  label: 'ChemDisk',
  default: true
};

function response(body, status = 200) {
  return new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' }
  });
}

test('Media Manager maps local and shared files to bounded GitHub folders', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if ((options.method || 'GET') === 'GET') {
      return response([
        { type: 'file', name: 'model.png', size: 128, sha: 'a'.repeat(40) },
        { type: 'file', name: 'notatki.txt', size: 12, sha: 'b'.repeat(40) }
      ]);
    }
    return response({
      content: { sha: 'c'.repeat(40) },
      commit: { sha: 'd'.repeat(40), html_url: 'https://github.com/example/commit/media' }
    }, options.method === 'PUT' ? 201 : 200);
  };

  const listed = await repository.listMedia('local', 'lesson', 'alkohole.md', { config: configured, fetchImpl });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].reference, 'photos/model.png');
  assert.match(requests[0].url, /lessons\/alkohole\/photos/);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const saved = await repository.saveMedia('local', 'presentation', 'alkohole', 'wykres.png', png.toString('base64'), 'image/png', { config: configured, fetchImpl });
  assert.equal(saved.reference, 'photos/wykres.png');
  const put = requests.find((entry) => entry.options.method === 'PUT');
  assert.match(put.url, /presentations\/alkohole\/photos\/wykres\.png/);
  assert.equal(JSON.parse(put.options.body).content, png.toString('base64'));

  const sha = 'e'.repeat(40);
  const removed = await repository.deleteMedia('shared', '', '', 'assets/shared/model.png', sha, { config: configured, fetchImpl });
  assert.equal(removed.deleted, true);
  const deletion = requests.find((entry) => entry.options.method === 'DELETE');
  assert.match(deletion.url, /assets\/shared\/model\.png/);
  assert.equal(JSON.parse(deletion.options.body).sha, sha);
});

test('protected media reads reuse a bounded warm Function cache', async () => {
  repository._test.clearCache();
  let requests = 0;
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetchImpl = async () => {
    requests += 1;
    return response(bytes);
  };
  const options = { config: configured, fetchImpl };
  const first = await repository.readMedia('local', 'lesson', 'test.md', 'photos/model.png', options);
  const second = await repository.readMedia('local', 'lesson', 'test.md', 'photos/model.png', options);
  assert.equal(requests, 1);
  assert.deepEqual(second.buffer, first.buffer);
  assert.equal(second.mimeType, 'image/png');
});

test('media writes reject traversal, mismatched binaries and active SVG content before GitHub access', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return response({}); };
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');

  await assert.rejects(
    repository.saveMedia('local', 'exam', 'chemia', '../sekret.png', 'eA==', 'image/png', { config: configured, fetchImpl }),
    (error) => error.code === 'INVALID_MEDIA_REFERENCE'
  );
  await assert.rejects(
    repository.saveMedia('local', 'exam', 'chemia', 'atak.svg', svg, 'image/svg+xml', { config: configured, fetchImpl }),
    (error) => error.code === 'MEDIA_SVG_UNSAFE'
  );
  await assert.rejects(
    repository.deleteMedia('local', 'lesson', 'lekcja.md', 'photos/../sekret.png', 'f'.repeat(40), { config: configured, fetchImpl }),
    (error) => error.code === 'INVALID_MEDIA_REFERENCE'
  );
  assert.equal(called, false);
});

test('generic media mutations are bounded to an explicit owner and reject oversized uploads', async () => {
  assert.equal(contentFunction._test.validateMutationBody({
    kind: 'media',
    scope: 'local',
    materialKind: 'exam',
    materialId: 'alkohole',
    filename: 'model.png',
    contentBase64: 'iVBORw0KGgo=',
    mimeType: 'image/png',
    repositoryId: 'default'
  }, 'PUT').ok, true);
  assert.equal(contentFunction._test.validateMutationBody({
    kind: 'media',
    scope: 'local',
    materialKind: 'prompt',
    materialId: 'tajny.json',
    filename: 'model.png',
    contentBase64: 'iVBORw0KGgo=',
    mimeType: 'image/png'
  }, 'PUT').ok, false);

  const oversized = Buffer.alloc(4 * 1024 * 1024 + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversized);
  await assert.rejects(
    repository.saveMedia('shared', '', '', 'za-duzy.png', oversized.toString('base64'), 'image/png', { config: configured, fetchImpl: async () => response({}) }),
    (error) => error.code === 'CONTENT_FILE_TOO_LARGE' && error.status === 413
  );
});

test('Presentation Studio preserves stable IDs and accepts only managed image references', () => {
  const presentation = presentationModel.createPresentation({
    presentationId: 'alkohole',
    metadata: { title: 'Alkohole', status: 'published' },
    slides: [{
      slideId: 'slide-intro',
      title: 'Wstęp',
      elements: [
        { elementId: 'title-main', type: 'text', content: 'Alkohole' },
        { elementId: 'image-main', type: 'image', ref: 'assets/shared/model.svg', alt: 'Model' }
      ]
    }]
  });
  const serialized = presentationModel.serialize(presentation);
  const reparsed = presentationModel.parse(serialized, 'alkohole');
  assert.equal(reparsed.slides[0].slideId, 'slide-intro');
  assert.equal(reparsed.slides[0].elements[1].elementId, 'image-main');
  assert.equal(reparsed.slides[0].elements[1].ref, 'assets/shared/model.svg');
  assert.equal(presentationCommon.validateDefinition(reparsed, 'alkohole').valid, true);

  const unsafe = presentationModel.createPresentation({
    presentationId: 'niebezpieczna',
    slides: [{ elements: [{ type: 'image', ref: 'photos/../sekret.svg' }] }]
  });
  assert.equal(presentationModel.validate(unsafe).valid, false);
  const duplicate = presentationCommon.validateDefinition({
    presentationId: 'duplikat',
    slides: [{ slideId: 'ten-sam', elements: [] }, { slideId: 'ten-sam', elements: [] }]
  }, 'duplikat');
  assert.ok(duplicate.errors.some((error) => error.code === 'PRESENTATION_SLIDE_ID_DUPLICATE'));
});

test('Presentation Studio round-trips rich elements, typography, crop and backgrounds', () => {
  const elements = [
    presentationModel.createElement('heading', { content: 'Alkohole', fontFamily: 'playfair', fontWeight: 800, lineHeight: 1.25, letterSpacing: 1.2 }),
    presentationModel.createElement('image', { ref: 'photos/model.webp', alt: 'Model cząsteczki', cropMode: true, aspectLocked: false, focalX: 31, focalY: 66, opacity: .7 }),
    presentationModel.createElement('shape', { shape: 'line', opacity: .4 }),
    presentationModel.createElement('formula', { expression: 'C2H5OH', mode: 'chemistry' }),
    presentationModel.createElement('icon', { symbol: '⚗' }),
    presentationModel.createElement('table', { headers: ['Wzór', 'Nazwa'], rows: [['CH3OH', 'metanol']] }),
    presentationModel.createElement('button', { label: 'Czytaj', href: '/members/' }),
    presentationModel.createElement('code', { language: 'text', code: 'CH3OH' }),
    presentationModel.createElement('embed', { title: 'Film', url: 'https://www.youtube-nocookie.com/embed/abcdefghijk' })
  ];
  const presentation = presentationModel.createPresentation({
    presentationId: 'bogata-prezentacja',
    settings: { headingFont: 'playfair', bodyFont: 'open-sans' },
    slides: [{
      slideId: 'slajd-1',
      backgroundType: 'gradient',
      gradientFrom: '#112233',
      gradientTo: '#ddeeff',
      gradientAngle: 42,
      elements
    }]
  });
  const serialized = presentationModel.serialize(presentation);
  const server = presentationCommon.validateDefinition(JSON.parse(serialized), 'bogata-prezentacja');
  assert.equal(server.valid, true);
  assert.equal(server.definition.version, 2);
  assert.equal(server.definition.slides[0].backgroundType, 'gradient');
  assert.equal(server.definition.slides[0].elements.find((element) => element.type === 'image').cropMode, true);
  assert.deepEqual(new Set(server.definition.slides[0].elements.map((element) => element.type)), new Set(['heading', 'image', 'shape', 'formula', 'icon', 'table', 'button', 'code', 'embed']));
  assert.ok(['title-image', 'text-image', 'image-full', 'quote', 'table', 'question'].every((layout) => presentationModel.LAYOUTS.includes(layout)));

  const unsafeEmbed = presentationModel.createPresentation({
    presentationId: 'zly-embed',
    slides: [{ elements: [{ type: 'embed', url: 'https://evil.example/embed/abc' }] }]
  });
  assert.equal(presentationModel.validate(unsafeEmbed).valid, false);
});

test('legacy native presentations migrate to the versioned model without changing saved IDs later', () => {
  const migrated = presentationModel.parse({
    version: 1,
    presentationId: 'starsza',
    metadata: { title: 'Starsza' },
    slides: [{ title: 'Pierwszy', elements: [{ type: 'text', content: 'Treść' }] }]
  }, 'starsza');
  assert.equal(migrated.version, 2);
  assert.match(migrated.slides[0].slideId, /^slide-/);
  assert.match(migrated.slides[0].elements[0].elementId, /^element-/);
  const reparsed = presentationModel.parse(presentationModel.serialize(migrated), 'starsza');
  assert.equal(reparsed.slides[0].slideId, migrated.slides[0].slideId);
  assert.equal(reparsed.slides[0].elements[0].elementId, migrated.slides[0].elements[0].elementId);
});

test('Lesson Builder round-trips managed local media while keeping legacy HTTPS images', () => {
  const lesson = lessonModel.createLesson({
    title: 'Obrazy',
    filename: 'obrazy.md',
    slides: [{ blocks: [
      { type: 'image', ref: 'photos/schemat.webp', repositoryId: 'default', owner: 'obrazy.md', alt: 'Schemat', width: 72, align: 'right' },
      { type: 'image', url: 'https://example.com/stary.png', alt: 'Starszy obraz' }
    ] }]
  });
  const markdown = lessonModel.serializeLesson(lesson);
  assert.match(markdown, /:::image[\s\S]*ref: photos\/schemat\.webp[\s\S]*repository: default[\s\S]*owner: obrazy\.md[\s\S]*width: 72[\s\S]*align: right/);
  assert.match(markdown, /!\[Starszy obraz\]\(https:\/\/example\.com\/stary\.png\)/);
  const editable = lessonModel.parseLesson(markdown, 'obrazy.md');
  assert.equal(editable.slides[0].blocks.find((block) => block.ref)?.ref, 'photos/schemat.webp');
  assert.equal(editable.slides[0].blocks.find((block) => block.ref)?.owner, 'obrazy.md');
  const published = lessonParser.parseLesson(markdown, 'obrazy.md');
  assert.match(published.slides[0].html, /data-lesson-media-ref="photos\/schemat\.webp"/);
  assert.match(published.slides[0].html, /data-lesson-media-owner="obrazy\.md"/);
});

test('Studio publishes the shared Media Manager and a nested, lazy content explorer', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/members/module/studio/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public/members/module/studio/script.js'), 'utf8');
  const lessonPlayer = fs.readFileSync(path.join(root, 'public/members/module/lesson/script.js'), 'utf8');
  const examHtml = fs.readFileSync(path.join(root, 'public/members/module/exam/index.html'), 'utf8');
  const examPlayer = fs.readFileSync(path.join(root, 'public/members/module/exam/script.js'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'public/assets/js/media-manager.js'), 'utf8');
  const mediaFunction = fs.readFileSync(path.join(root, 'netlify/functions/content-media.js'), 'utf8');
  assert.match(html, /media-manager\.css/);
  assert.match(html, /media-manager\.js/);
  assert.match(script, /function loadExplorerMedia/);
  assert.match(script, /function deleteExplorerMedia/);
  assert.match(script, /function duplicateContentExplorerAsset/);
  assert.match(script, /readMediaBlob/);
  assert.match(script, /bypassCache/);
  assert.match(script, /lesson-image-retry/);
  assert.match(script, /Math\.min\(4, figures\.length\)/);
  assert.match(lessonPlayer, /scheduleLessonImagePrefetch/);
  assert.match(lessonPlayer, /slice\(state\.index \+ 1, state\.index \+ 2\)/);
  assert.match(lessonPlayer, /connection\?\.saveData/);
  assert.match(lessonPlayer, /Math\.min\(4, figures\.length\)/);
  assert.match(examHtml, /\/assets\/js\/content-library\.js/);
  assert.match(examPlayer, /library\.readMediaBlob/);
  assert.match(examPlayer, /IntersectionObserver/);
  assert.match(script, /uploadMedia/);
  assert.ok(script.indexOf("ChemContentLibrary.remove(kind") < script.indexOf("ChemContentLibrary.removeMedia({", script.indexOf('async function deleteContentExplorerAsset')));
  assert.match(script, /ChemMediaManager\.open/);
  assert.match(manager, /IntersectionObserver/);
  assert.match(manager, /clipboardData/);
  assert.match(manager, /dataTransfer/);
  assert.match(manager, /removeMedia/);
  assert.match(mediaFunction, /public, max-age=31536000, immutable/);
});

test('visual editors expose direct resize handles and duplicate elements with fresh stable IDs', () => {
  const root = path.join(__dirname, '..');
  const studio = fs.readFileSync(path.join(root, 'public/members/module/studio/script.js'), 'utf8');
  const presentation = fs.readFileSync(path.join(root, 'public/members/module/studio/presentation-builder.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public/members/module/studio/style.css'), 'utf8');
  assert.match(studio, /function bindLessonPreviewImageResize/);
  assert.match(studio, /lesson-preview-image-handle/);
  assert.match(presentation, /presentation-resize-handle/);
  assert.match(presentation, /delete seed\.elementId/);
  assert.match(presentation, /cropDrag/);
  assert.match(presentation, /has-guide-x/);
  assert.match(styles, /\.lesson-preview-image-handle/);
  assert.match(styles, /\.presentation-resize-handle/);
});

test('Google Slides top toolbar supports text formatting, chemical indices and arrow shapes', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/members/module/studio/index.html'), 'utf8');
  const builder = fs.readFileSync(path.join(root, 'public/members/module/studio/presentation-builder.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public/members/module/studio/style.css'), 'utf8');
  const player = fs.readFileSync(path.join(root, 'public/members/module/presentation/script.js'), 'utf8');
  const playerStyles = fs.readFileSync(path.join(root, 'public/members/module/presentation/style.css'), 'utf8');

  // Model supports arrow shapes and rich text properties
  const arrowShape = presentationModel.createElement('shape', { shape: 'arrow', borderWidth: 3 });
  assert.equal(arrowShape.shape, 'arrow');
  assert.equal(arrowShape.borderWidth, 3);

  const formattedText = presentationModel.createElement('text', { strikethrough: true, align: 'justify' });
  assert.equal(formattedText.strikethrough, true);
  assert.equal(formattedText.align, 'justify');

  // Studio HTML exposes Google Slides toolbar & format toolbar
  assert.match(html, /id="presentation-format-toolbar"/);
  assert.match(html, /data-presentation-add="circle"/);
  assert.match(html, /data-presentation-add="line"/);
  assert.match(html, /data-presentation-add="arrow"/);
  assert.match(html, /data-presentation-property-action="toggle-bold"/);
  assert.match(html, /data-presentation-property-action="toggle-italic"/);
  assert.match(html, /data-presentation-property-action="toggle-underline"/);
  assert.match(html, /data-presentation-property-action="toggle-strikethrough"/);
  assert.match(html, /data-presentation-property-action="subscript"/);
  assert.match(html, /data-presentation-property-action="superscript"/);
  assert.match(html, /data-presentation-property-action="chemical-formula-auto"/);

  // Builder and Player support formatted text and chemical indices
  assert.match(builder, /function transformSubscript/);
  assert.match(builder, /function transformSuperscript/);
  assert.match(builder, /function transformAutoChem/);
  assert.match(builder, /function renderFormattedText/);
  assert.match(player, /function renderFormattedText/);

  // CSS supports arrows and format toolbar
  assert.match(styles, /\.presentation-format-toolbar/);
  assert.match(styles, /\.presentation-shape\.is-arrow/);
  assert.match(playerStyles, /\.presentation-player-shape\.is-arrow/);
});

test('Smart alignment guides and marquee selection box support visual multi-element editing', () => {
  const root = path.join(__dirname, '..');
  const builder = fs.readFileSync(path.join(root, 'public/members/module/studio/presentation-builder.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public/members/module/studio/style.css'), 'utf8');

  // Builder supports marquee box drag-selection and multi-selection
  assert.match(builder, /presentation-marquee-box/);
  assert.match(builder, /selectedElementIds/);
  assert.match(builder, /moveMarquee/);

  // Builder supports smart alignment guides and magnetic snapping
  assert.match(builder, /presentation-smart-guide/);
  assert.match(builder, /has-guide-x/);
  assert.match(builder, /has-guide-y/);
  assert.match(builder, /SNAP_THRESHOLD/);
  assert.match(builder, /ensureGuide\('is-vertical'\)/);
  assert.match(builder, /ensureGuide\('is-horizontal'\)/);

  // CSS contains rules for smart guides and marquee selection box
  assert.match(styles, /\.presentation-smart-guide/);
  assert.match(styles, /\.presentation-smart-guide\.is-vertical/);
  assert.match(styles, /\.presentation-smart-guide\.is-horizontal/);
  assert.match(styles, /\.presentation-marquee-box/);
});

test('Google Slides 1:1 editing supports inline WYSIWYG, grouping Ctrl+G, layers, and unlimited undo/redo', () => {
  const root = path.join(__dirname, '..');
  const model = require('../public/members/module/studio/presentation-model.js');
  const builder = fs.readFileSync(path.join(root, 'public/members/module/studio/presentation-builder.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public/members/module/studio/style.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'public/members/module/studio/index.html'), 'utf8');

  // Model supports groupId and keeps grouped elements grouped on duplicate
  const el = model.createElement('text', { content: 'Witaj', groupId: 'group-1' });
  assert.equal(el.groupId, 'group-1');

  const slide = model.createSlide({
    elements: [
      model.createElement('text', { content: 'Element 1', groupId: 'grp-abc' }),
      model.createElement('shape', { shape: 'rectangle', groupId: 'grp-abc' }),
      model.createElement('text', { content: 'Solo element' })
    ]
  });
  const dupSlide = model.duplicateSlide(slide);
  assert.equal(dupSlide.elements.length, 3);
  assert.ok(dupSlide.elements[0].groupId);
  assert.notEqual(dupSlide.elements[0].groupId, 'grp-abc');
  assert.equal(dupSlide.elements[0].groupId, dupSlide.elements[1].groupId);
  assert.equal(dupSlide.elements[2].groupId, '');

  // Builder supports inline WYSIWYG text editing
  assert.match(builder, /function startInlineTextEdit/);
  assert.match(builder, /content\.contentEditable\s*=\s*['"]true['"]/);
  assert.match(builder, /is-inline-editing/);
  assert.match(builder, /dblclick/);

  // Builder supports grouping and ungrouping
  assert.match(builder, /action === ['"]group-elements['"]/);
  assert.match(builder, /action === ['"]ungroup-elements['"]/);
  assert.match(builder, /propertyAction\(['"]ungroup-elements['"]\)\s*:\s*propertyAction\(['"]group-elements['"]\)/);

  // Builder supports layer management and shortcuts
  assert.match(builder, /action === ['"]layer-up['"]/);
  assert.match(builder, /action === ['"]layer-down['"]/);
  assert.match(builder, /action === ['"]layer-front['"]/);
  assert.match(builder, /action === ['"]layer-back['"]/);
  assert.match(builder, /propertyAction\(['"]layer-front['"]\)\s*:\s*propertyAction\(['"]layer-up['"]\)/);
  assert.match(builder, /propertyAction\(['"]layer-back['"]\)\s*:\s*propertyAction\(['"]layer-down['"]\)/);
  assert.match(builder, /openElementContextMenu/);

  // Builder supports unlimited undo/redo depth >= 150
  assert.match(builder, /state\.undo\.slice\(-200\)/);
  assert.match(builder, /redo\(\)\s*:\s*undo\(\)/);

  // CSS contains rules for inline editing and groups
  assert.match(styles, /\.presentation-element\.is-inline-editing/);
  assert.match(styles, /data-group-id/);

  // Format toolbar contains group and layer buttons
  assert.match(indexHtml, /presentation-btn-group/);
  assert.match(indexHtml, /presentation-btn-ungroup/);
});

test('Prompt 2.5: step-by-step element reveal animations and admin edit link', () => {
  const model = presentationModel;
  const elFade = model.createElement('text', {
    content: 'Fade text',
    animationType: 'fade-in',
    animationOrder: 1
  });
  assert.equal(elFade.animationType, 'fade-in');
  assert.equal(elFade.animationOrder, 1);

  const elSlide = model.createElement('shape', {
    shape: 'rectangle',
    animationType: 'slide-up',
    animationOrder: 2
  });
  assert.equal(elSlide.animationType, 'slide-up');
  assert.equal(elSlide.animationOrder, 2);

  // Invalid animationType falls back to 'none'
  const elInvalid = model.createElement('text', {
    animationType: 'invalid-bounce',
    animationOrder: -5
  });
  assert.equal(elInvalid.animationType, 'none');
  assert.equal(elInvalid.animationOrder, 0);

  // Check player script
  const playerScript = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/script.js'), 'utf8');
  assert.match(playerScript, /function getMaxStep/);
  assert.match(playerScript, /function nextStepOrSlide/);
  assert.match(playerScript, /function prevStepOrSlide/);
  assert.match(playerScript, /presentation-player-animated/);
  assert.match(playerScript, /is-anim-hidden/);
  assert.match(playerScript, /is-anim-visible/);
  assert.match(playerScript, /presentation-player-edit/);
  assert.match(playerScript, /roles\.includes\(['"]admin['"]\)/);

  // Check player styles
  const playerStyles = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/style.css'), 'utf8');
  assert.match(playerStyles, /\.presentation-player-element\.presentation-player-animated/);
  assert.match(playerStyles, /\.is-anim-hidden/);
  assert.match(playerStyles, /\.is-anim-visible/);
  assert.match(playerStyles, /\.presentation-player-edit-link/);

  // Check player HTML
  const playerHtml = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/index.html'), 'utf8');
  assert.match(playerHtml, /id="presentation-player-edit"/);
});

test('Prompt 2.6: Presenter View in separate window with timer and speaker notes + live annotation and laser pointer', () => {
  const playerHtml = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/index.html'), 'utf8');
  const playerScript = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/script.js'), 'utf8');
  const playerStyles = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/style.css'), 'utf8');

  // HTML includes Presenter View button and full presenter layout
  assert.match(playerHtml, /id="presentation-player-presenter"/);
  assert.match(playerHtml, /id="presentation-presenter-view"/);
  assert.match(playerHtml, /id="presenter-timer"/);
  assert.match(playerHtml, /id="presenter-notes-content"/);
  assert.match(playerHtml, /id="presenter-stage-current"/);
  assert.match(playerHtml, /id="presenter-stage-next"/);
  assert.match(playerHtml, /id="presenter-filmstrip"/);

  // HTML includes live annotation canvas and laser pointer
  assert.match(playerHtml, /id="presentation-annotation-canvas"/);
  assert.match(playerHtml, /id="presentation-laser-dot"/);
  assert.match(playerHtml, /id="presentation-annotation-toolbar"/);
  assert.match(playerHtml, /id="presentation-toggle-tools"/);

  // Script implements Presenter View, sync, and lecture timer
  assert.match(playerScript, /function initPresenterTimer/);
  assert.match(playerScript, /function renderPresenter/);
  assert.match(playerScript, /function renderPresenterFilmstrip/);
  assert.match(playerScript, /function initSyncChannel/);
  assert.match(playerScript, /BroadcastChannel/);
  assert.match(playerScript, /function broadcastState/);

  // Script implements Live Annotation and Laser Pointer
  assert.match(playerScript, /function initLiveAnnotations/);
  assert.match(playerScript, /function resizeCanvas/);
  assert.match(playerScript, /function redrawAnnotations/);
  assert.match(playerScript, /function setTool/);

  // CSS contains styles for presenter view, annotations, and laser
  assert.match(playerStyles, /\.presentation-presenter-view/);
  assert.match(playerStyles, /\.presenter-timer-box/);
  assert.match(playerStyles, /\.presentation-annotation-canvas/);
  assert.match(playerStyles, /\.presentation-laser-dot/);
  assert.match(playerStyles, /\.presentation-annotation-toolbar/);
  assert.match(playerStyles, /\.is-laser/);
  assert.match(playerStyles, /\.is-drawing/);
});

test('Prompt 2.7: PDF Export in Presentation Player and Studio with vector typography', () => {
  const playerHtml = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/index.html'), 'utf8');
  const playerScript = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/script.js'), 'utf8');
  const playerStyles = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/style.css'), 'utf8');
  const studioHtml = fs.readFileSync(path.resolve(__dirname, '../public/members/module/studio/index.html'), 'utf8');
  const studioBuilder = fs.readFileSync(path.resolve(__dirname, '../public/members/module/studio/presentation-builder.js'), 'utf8');

  // Presentation player has PDF button and print script
  assert.match(playerHtml, /id="presentation-player-pdf"/);
  assert.match(playerScript, /function exportPresentationToPdf/);
  assert.match(playerScript, /window\.print\(\)/);
  assert.match(playerScript, /afterprint/);
  assert.match(playerScript, /params\.get\(['"]print['"]\)/);
  assert.match(playerScript, /elements\.pdf/);

  // Studio has PDF button, click action and Ctrl+P shortcut
  assert.match(studioHtml, /id="presentation-btn-export-pdf"/);
  assert.match(studioBuilder, /action === ['"]export-pdf['"]/);
  assert.match(studioBuilder, /event\.key\.toLowerCase\(\) === ['"]p['"]/);

  // CSS contains @media print rules with 100% vector fidelity and clean page breaks
  assert.match(playerStyles, /@media print/);
  assert.match(playerStyles, /size:\s*landscape/);
  assert.match(playerStyles, /\.presentation-print-container/);
  assert.match(playerStyles, /\.presentation-print-page/);
  assert.match(playerStyles, /\.presentation-print-stage/);
  assert.match(playerStyles, /page-break-after:\s*always/);
});

test('Prompt 2.8: Interactive Slide Quizzes with slide locking until correct answer', () => {
  // Model supports quiz element type
  assert.ok(presentationModel.ELEMENT_TYPES.includes('quiz'));

  const quizEl = presentationModel.createElement('quiz', {
    question: 'Jaki odczyn ma roztwór o pH = 3?',
    options: [
      { id: 'opt-1', text: 'Kwasowy', correct: true },
      { id: 'opt-2', text: 'Zasadowy', correct: false },
      { id: 'opt-3', text: 'Obojętny', correct: false }
    ],
    explanation: 'pH < 7 oznacza odczyn kwasowy.',
    blockNextUntilCorrect: true
  });

  assert.equal(quizEl.type, 'quiz');
  assert.equal(quizEl.question, 'Jaki odczyn ma roztwór o pH = 3?');
  assert.equal(quizEl.options.length, 3);
  assert.equal(quizEl.options[0].correct, true);
  assert.equal(quizEl.blockNextUntilCorrect, true);
  assert.equal(quizEl.explanation, 'pH < 7 oznacza odczyn kwasowy.');

  // Auto-correction: if no option marked correct, first is made correct
  const fallbackQuiz = presentationModel.createElement('quiz', {
    question: 'Pytanie bez oznaczonej poprawnej?',
    options: [
      { id: '1', text: 'A', correct: false },
      { id: '2', text: 'B', correct: false }
    ]
  });
  assert.equal(fallbackQuiz.options[0].correct, true);

  // Full presentation validation round-trip
  const pres = presentationModel.createPresentation({
    presentationId: 'quiz-slide-test',
    slides: [
      {
        title: 'Slajd z quizem',
        elements: [quizEl]
      },
      {
        title: 'Kolejny slajd',
        elements: [{ type: 'text', content: 'Koniec' }]
      }
    ]
  });
  const serialized = presentationModel.serialize(pres);
  const validated = presentationModel.validate(presentationModel.parse(serialized, 'quiz-slide-test'));
  assert.equal(validated.valid, true);

  // Files verification
  const studioHtml = fs.readFileSync(path.resolve(__dirname, '../public/members/module/studio/index.html'), 'utf8');
  const studioBuilder = fs.readFileSync(path.resolve(__dirname, '../public/members/module/studio/presentation-builder.js'), 'utf8');
  const studioStyles = fs.readFileSync(path.resolve(__dirname, '../public/members/module/studio/style.css'), 'utf8');
  const playerScript = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/script.js'), 'utf8');
  const playerStyles = fs.readFileSync(path.resolve(__dirname, '../public/members/module/presentation/style.css'), 'utf8');

  // Studio has quiz button, seed, preview render and properties
  assert.match(studioHtml, /data-presentation-add="quiz"/);
  assert.match(studioBuilder, /quiz:\s*\{\s*x:\s*12/);
  assert.match(studioBuilder, /presentation-builder-quiz/);
  assert.match(studioBuilder, /quizOpt/);
  assert.match(studioBuilder, /quizCorrectIndex/);
  assert.match(studioBuilder, /blockNextUntilCorrect/);
  assert.match(studioStyles, /\.presentation-builder-quiz/);

  // Player script implements interactive quiz and slide transition locking
  assert.match(playerScript, /presentation-player-quiz/);
  assert.match(playerScript, /presentation-quiz-option/);
  assert.match(playerScript, /is-correct/);
  assert.match(playerScript, /is-incorrect/);
  assert.match(playerScript, /state\.quizAnswers/);
  assert.match(playerScript, /function isSlideLocked/);
  assert.match(playerScript, /function triggerLockNotice/);
  assert.match(playerScript, /presentation-quiz-shake/);

  // Player CSS has styles for quiz, shake, options and feedback
  assert.match(playerStyles, /\.presentation-player-quiz/);
  assert.match(playerStyles, /\.presentation-quiz-shake/);
  assert.match(playerStyles, /\.presentation-quiz-option/);
  assert.match(playerStyles, /\.presentation-quiz-feedback/);
  assert.match(playerStyles, /\.presentation-quiz-locked-msg/);
});

test('Presentation Studio exposes curated modern background presets and contrast harmonization', () => {
  const root = path.join(__dirname, '..');
  const builder = fs.readFileSync(path.join(root, 'public/members/module/studio/presentation-builder.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public/members/module/studio/style.css'), 'utf8');
  const player = fs.readFileSync(path.join(root, 'public/members/module/presentation/script.js'), 'utf8');

  // Builder exposes presets definition, picker and text contrast harmonization
  assert.match(builder, /MODERN_BACKGROUND_PRESETS/);
  assert.match(builder, /renderThemePresetPicker/);
  assert.match(builder, /applyBackgroundPreset/);
  assert.match(builder, /bio-emerald/);
  assert.match(builder, /nordic-slate/);
  assert.match(builder, /cyber-indigo/);
  assert.match(builder, /mint-clean/);
  assert.match(builder, /isDarkColor/);

  // Studio CSS styles the preset picker, grid, preview cards and action buttons
  assert.match(styles, /\.presentation-theme-presets-section/);
  assert.match(styles, /\.presentation-preset-tabs/);
  assert.match(styles, /\.presentation-theme-presets-grid/);
  assert.match(styles, /\.presentation-preset-card/);
  assert.match(styles, /\.presentation-preset-preview/);
  assert.match(styles, /\.presentation-preset-actions/);

  // Player script handles gradient fallbacks gracefully
  assert.match(player, /slide\.gradientAngle \?\? 135/);
});




