const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const moduleRoot = path.join(root, 'public', 'members', 'module');
const media = require(path.join(moduleRoot, 'media-utils.js'));

test('media helpers accept IDs and common Google/YouTube sharing links', () => {
  const driveId = '1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF';
  const slideId = '1q27sAFuVxw-ILceGOdVPcaBz2nD_sC2B';
  const publishedId = '2PACX-1vQ_examplePublishedSlidesId123456789';
  const youtubeId = 'CH50zuS8DD0';

  assert.equal(media.extractDriveId(driveId), driveId);
  assert.equal(media.extractDriveId(`https://drive.google.com/file/d/${driveId}/view?usp=sharing`), driveId);
  assert.equal(media.extractDriveId(`https://drive.google.com/open?id=${driveId}`), driveId);
  assert.equal(media.extractDriveId('https://evil.example/file/d/1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF/view'), '');

  assert.equal(media.extractYouTubeId(youtubeId), youtubeId);
  assert.equal(media.extractYouTubeId(`https://youtu.be/${youtubeId}?feature=shared`), youtubeId);
  assert.equal(media.extractYouTubeId(`https://www.youtube.com/shorts/${youtubeId}`), youtubeId);
  assert.equal(media.extractYouTubeId(`https://www.youtube.com/watch?v=${youtubeId}`), youtubeId);

  assert.deepEqual(
    media.extractSlides(`https://docs.google.com/presentation/d/${slideId}/edit?usp=sharing`),
    { id: slideId, published: false }
  );
  assert.deepEqual(
    media.extractSlides(`https://docs.google.com/presentation/u/1/d/${slideId}/edit`),
    { id: slideId, published: false }
  );
  assert.deepEqual(
    media.extractSlides(`https://docs.google.com/presentation/d/e/${publishedId}/pub?start=false`),
    { id: publishedId, published: true }
  );

  assert.equal(media.safeHttpsUrl('https://example.com/material.pdf'), 'https://example.com/material.pdf');
  assert.equal(media.safeHttpsUrl('http://example.com/material.pdf'), '');
  assert.equal(media.safeHttpsUrl('https://user:secret@example.com/material.pdf'), '');
});

test('media parameter reader removes source IDs from the visible address immediately', () => {
  let replacedWith = '';
  const fakeWindow = {
    document: { title: 'Viewer' },
    history: {
      state: { preserved: true },
      replaceState(_state, _title, nextUrl) { replacedWith = nextUrl; }
    },
    location: {
      pathname: '/members/module/pdf/',
      search: '?id=secret-drive-id&type=1',
      hash: ''
    }
  };

  const params = media.readParamsAndHide(fakeWindow);
  assert.equal(params.get('id'), 'secret-drive-id');
  assert.equal(params.get('type'), '1');
  assert.equal(replacedWith, '/members/module/pdf/');
});

test('media viewers are domain portable and strip query parameters before auth wait', () => {
  for (const name of ['slides', 'pdf', 'film']) {
    const html = fs.readFileSync(path.join(moduleRoot, name, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(moduleRoot, name, 'script.js'), 'utf8');

    assert.doesNotMatch(`${html}\n${script}`, /chemdisk\.netlify\.app/i, `${name}: deployment domain is hardcoded`);
    assert.match(html, /referrerpolicy=["']origin["']/i, `${name}: embedded provider needs an origin referrer`);
    assert.match(script, /readParamsAndHide\(window\)/, `${name}: source query is left in the address bar`);
    assert.ok(
      script.indexOf('readParamsAndHide(window)') < script.indexOf('await window.ChemAuth.ready'),
      `${name}: source query is hidden too late`
    );
    assert.match(script, /setTimeout/, `${name}: missing slow-provider timeout`);
    assert.match(script, /retry/i, `${name}: missing retry flow`);
  }
});

test('shared media viewers expose a persistent collapsible mobile toolbar', () => {
  const chrome = fs.readFileSync(path.join(moduleRoot, 'media-viewer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(moduleRoot, 'media-viewer.css'), 'utf8');

  for (const name of ['pdf', 'slides', 'film']) {
    const html = fs.readFileSync(path.join(moduleRoot, name, 'index.html'), 'utf8');
    assert.match(html, /src=["']\.\.\/media-viewer\.js["']/, `${name}: missing collapsible toolbar script`);
  }
  assert.match(chrome, /viewer-bar-collapsed/);
  assert.match(chrome, /aria-expanded/);
  assert.match(styles, /100dvh/);
  assert.match(styles, /viewer-bar\.is-collapsed/);
});

test('custom YT player has mobile controls, filled ranges and deterministic mute state', () => {
  const html = fs.readFileSync(path.join(moduleRoot, 'yt', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(moduleRoot, 'yt', 'style.css'), 'utf8');
  const script = fs.readFileSync(path.join(moduleRoot, 'yt', 'script.js'), 'utf8');

  assert.match(styles, /--range-progress/);
  assert.match(styles, /100dvh/);
  assert.match(html, /aria-pressed=["']false["']/);
  assert.match(script, /let desiredMuted = false/);
  assert.match(script, /requestMuteState\(!desiredMuted\)/);
  assert.match(script, /verifyMuteState/);
  assert.doesNotMatch(script, /const muted = player\.isMuted\(\);\s*if \(muted\)/);
});

test('protected Film suppresses provider links and sandboxes YouTube frames without popups', () => {
  for (const name of ['film']) {
    const html = fs.readFileSync(path.join(moduleRoot, name, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(moduleRoot, name, 'script.js'), 'utf8');
    const styles = fs.readFileSync(path.join(moduleRoot, name, 'style.css'), 'utf8');

    assert.match(html, new RegExp(`${name}-guard-title`));
    assert.match(script, /providerTop\.hidden\s*=\s*protectedMode/);
    assert.match(script, /providerLink\.hidden\s*=\s*protectedMode/);
    assert.match(script, /sandbox.*allow-scripts allow-same-origin allow-presentation/);
    assert.doesNotMatch(script, /allow-popups/);
    assert.match(styles, new RegExp(`\\.${name}-guard-title`));
  }
});

test('Film tracks real YouTube watch ranges through the iframe API with batched writes', () => {
  const script = fs.readFileSync(path.join(moduleRoot, 'film', 'script.js'), 'utf8');
  assert.match(script, /query\.set\('enablejsapi', '1'\)/);
  assert.match(script, /new window\.YT\.Player\(frame/);
  assert.match(script, /watchedRanges:\s*trackedRanges\(\)/);
  assert.match(script, /delta > 0 && delta <= 2\.5/);
  assert.match(script, /const PROGRESS_SYNC_INTERVAL = 15000/);
});

test('protected PDF and Slides suppress every direct Google fallback link', () => {
  const cases = [
    { name: 'pdf', protectedType: /const protectedMode = state\.type === '1'/ },
    { name: 'slides', protectedType: /const protectedMode = state\.type === '2'/ }
  ];

  for (const { name, protectedType } of cases) {
    const script = fs.readFileSync(path.join(moduleRoot, name, 'script.js'), 'utf8');

    assert.match(script, protectedType, `${name}: unexpected protected type mapping`);
    assert.match(script, /providerTop\.hidden\s*=\s*protectedMode/);
    assert.match(script, /providerLink\.hidden\s*=\s*protectedMode/);
    assert.match(script, /if \(!protectedMode\)\s*\{[\s\S]*providerTop\.href\s*=\s*outsideUrl;[\s\S]*providerLink\.href\s*=\s*outsideUrl;/);
    assert.match(script, /providerTop\.removeAttribute\('href'\)/);
    assert.match(script, /providerLink\.removeAttribute\('href'\)/);
    assert.match(script, /sandbox.*allow-scripts allow-same-origin allow-forms allow-presentation/);
    assert.doesNotMatch(script, /allow-popups|allow-top-navigation/);
  }
});

test('Google Slides marks a presentation complete when its viewer is opened', () => {
  const script = fs.readFileSync(path.join(moduleRoot, 'slides', 'script.js'), 'utf8');

  assert.match(script, /async function markPresentationOpened\(\)/);
  assert.match(script, /progressApi\.open\(\{[\s\S]*materialId:\s*progressMaterialId,[\s\S]*materialType:\s*'presentation'/);
  assert.match(script, /if \(state\.type === '5'\)\s*\{[\s\S]*await markPresentationOpened\(\);[\s\S]*window\.location\.replace\(state\.url\)/);
  assert.match(script, /void markPresentationOpened\(\)/);
});

test('PDF and Slides expose direct HTTPS modes 4 and 5 after hiding the source query', () => {
  for (const name of ['pdf', 'slides']) {
    const script = fs.readFileSync(path.join(moduleRoot, name, 'script.js'), 'utf8');
    assert.match(script, /\['4', '5'\]/);
    assert.match(script, /media\.safeHttpsUrl/);
    assert.match(script, /const directEmbedMode = state\.type === '4'/);
    assert.match(script, /if \(state\.type === '5'\)\s*\{[\s\S]*window\.location\.replace\(state\.url\)/);
    assert.ok(
      script.indexOf('readParamsAndHide(window)') < script.indexOf("state.type === '5'"),
      `${name}: direct navigation happens before the source query is hidden`
    );
  }
});
