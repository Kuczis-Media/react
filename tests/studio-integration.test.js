const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const studioRoot = path.join(root, 'public', 'members', 'module', 'studio');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Studio is an admin-only member application linked only for administrators', () => {
  const html = read('public/members/module/studio/index.html');
  const script = read('public/members/module/studio/script.js');
  const dashboardHtml = read('public/members/index.html');
  const dashboardScript = read('public/members/dashboard.js');
  const redirects = read('netlify.toml');

  assert.match(html, /<base href=["']\/members\/module\/studio\/["']/);
  assert.match(html, /<meta name=["']x-members["'] content=["']1["']/);
  assert.match(html, /\/members\/module\/theme\.js/);
  assert.match(html, /\/assets\/js\/auth\.js/);
  assert.match(script, /await window\.ChemAuth\.ready/);
  assert.match(script, /metadata\.roles\.includes\(['"]admin['"]\)/);

  assert.match(dashboardHtml, /id=["']content-studio-link["'][^>]*hidden/);
  assert.match(dashboardScript, /contentStudioLink\.hidden\s*=\s*!visible/);
  assert.match(dashboardScript, /filmv1[\s\S]*?url\.pathname\s*=\s*['"]\/members\/module\/film\/['"]/i);

  const studioRoleRule = redirects.indexOf('from = "/members/module/studio"');
  const generalMembersRule = redirects.indexOf('from = "/members/*"');
  assert.ok(studioRoleRule >= 0, 'missing exact Studio redirect');
  assert.ok(generalMembersRule > studioRoleRule, 'Studio role protection must run before the general members route');
  assert.match(
    redirects.slice(studioRoleRule, generalMembersRule),
    /conditions\s*=\s*\{\s*Role\s*=\s*\["admin"\]\s*\}/
  );
});

test('Studio start cards keep links undecorated and icons square at every breakpoint', () => {
  const html = read('public/members/module/studio/index.html');
  const styles = read('public/members/module/studio/style.css');
  const home = html.slice(html.indexOf('<section class="home-view"'), html.indexOf('<section class="content-explorer"'));
  const cards = home.match(/<(?:button|a) class="project-card\b/g) || [];
  const linkedCards = home.match(/<a class="project-card\b/g) || [];
  const iconSvgs = [...home.matchAll(/<span class="project-icon"[^>]*>\s*<svg\s+([^>]+)>/g)];

  assert.ok(cards.length >= 10, 'the start screen should expose all Studio tools');
  assert.ok(linkedCards.length >= 1, 'the regression requires link-backed cards');
  assert.equal(iconSvgs.length, cards.length, 'every start card should have one stable SVG icon');
  iconSvgs.forEach((match) => {
    assert.match(match[1], /viewBox="0 0 40 40"/);
    assert.match(match[1], /width="40"/);
    assert.match(match[1], /height="40"/);
    assert.match(match[1], /focusable="false"/);
  });

  assert.match(styles, /\.project-card\s*\{[\s\S]*?text-decoration:\s*none/);
  assert.match(styles, /\.project-card:visited\s*\{[\s\S]*?color:\s*var\(--chem-text\)/);
  assert.match(styles, /\.project-card:focus-visible\s*\{[\s\S]*?border-color:/);
  assert.match(styles, /\.project-icon svg\s*\{[\s\S]*?display:\s*block[\s\S]*?aspect-ratio:\s*1/);
  assert.match(styles, /\.project-icon svg > \*\s*\{[\s\S]*?vector-effect:\s*non-scaling-stroke/);
  assert.match(styles, /\.project-card-presentation\s*\{\s*--card-color:/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.project-choices\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(styles, /\.project-card-ai\s*\{[^}]*text-decoration/);
});

test('Studio defers repository bootstrap until a builder or explorer is opened', () => {
  const html = read('public/members/module/studio/index.html');
  const script = read('public/members/module/studio/script.js');
  assert.match(html, /id="content-explorer"/);
  assert.match(script, /function initializeContentExplorerLoader\(\)/);
  assert.match(script, /new window\.IntersectionObserver/);
  assert.match(script, /switchMode\(new URL\(window.location.href\)\.searchParams.get\('mode'\) \|\| 'home'\);\s*initializeContentExplorerLoader\(\);/);
  assert.match(script, /elements\.contentExplorerRefresh\.disabled = state\.contentLibrary\.loading/);
  assert.match(script, /const repositoryReady = next === 'home'\s*\? Promise\.resolve\(\)\s*:\s*loadRepositoryAssets\(false\)/);
  assert.match(script, /if \(state\.mode === 'quiz'\) return window\.ChemQuizBuilder\?\.activate\?\.\(\)/);
  assert.match(script, /if \(state\.mode === 'exam'\) return window\.ChemExamBuilder\?\.activate\?\.\(\)/);
});

test('Dashboard Builder loads and conditionally publishes the active Blob version', () => {
  const html = read('public/members/module/studio/index.html');
  const script = read('public/members/module/studio/script.js');
  const model = read('public/members/module/studio/dashboard-model.js');

  assert.match(html, /id=["']dashboard-load-button["']/);
  assert.match(html, /id=["']dashboard-publish-button["']/);
  assert.match(html, /data-dashboard-add=["']slides["']/);
  assert.match(html, /data-dashboard-add=["']text["']/);
  assert.match(html, /data-dashboard-add=["']group["']/);
  assert.match(html, /data-dashboard-add=["']organizer["']/);
  assert.match(script, /add-organizer-child/);
  assert.match(script, /Dodaj organizer po kolei do tej harmonijki/);
  assert.match(script, /method:\s*['"]GET['"]/);
  assert.match(script, /method:\s*['"]PUT['"]/);
  assert.match(script, /expectedEtag/);
  assert.match(script, /response\.status\s*===\s*409/);
  assert.match(script, /catalogPending:\s*false/);
  assert.match(script, /current === state\.dashboard\.baseline && !state\.dashboard\.catalogPending/);
  assert.match(script, /state\.dashboard\.catalogPending = true;[\s\S]*const progressResponse = await fetch\(ADMIN_PROGRESS_URL/);
  assert.match(script, /Ponów synchronizację katalogu postępu/);
  assert.match(script, /DASHBOARD_CATALOG_PENDING_KEY/);
  assert.match(script, /retryCatalogOnly = state\.dashboard\.catalogPending && current === state\.dashboard\.baseline/);
  assert.match(script, /let dashboardPublishedThisAttempt = false/);
  assert.match(script, /const dashboardSaved = retryCatalogOnly \|\| dashboardPublishedThisAttempt/);
  assert.doesNotMatch(script, /const dashboardSaved = state\.dashboard\.catalogPending/);
  assert.match(script, /removeStorage\(DASHBOARD_CATALOG_PENDING_KEY\)/);
  assert.match(script, /credentials:\s*['"]same-origin['"]/);
  assert.match(script, /getAccessToken\(\{\s*forceRefresh:\s*true\s*\}\)/);
  assert.match(model, /ADMIN_DASHBOARD_URL\s*=\s*['"]\/\.netlify\/functions\/admin-dashboard['"]/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^)]*(?:token|jwt)/i);
});

test('Studio exposes dashboard, lesson, exam and prompt authoring workflows', () => {
  const html = read('public/members/module/studio/index.html');
  const script = read('public/members/module/studio/script.js');
  const styles = read('public/members/module/studio/style.css');
  const examBuilder = read('public/members/module/studio/exam-builder.js');
  const examStyles = read('public/members/module/exam/style.css');
  const examPlayer = read('public/members/module/exam/script.js');
  const mathJaxConfig = read('public/members/module/mathjax-config.js');

  assert.ok(fs.existsSync(path.join(studioRoot, 'dashboard-model.js')));
  assert.ok(fs.existsSync(path.join(studioRoot, 'lesson-model.js')));
  assert.ok(fs.existsSync(path.join(studioRoot, 'prompt-model.js')));
  assert.ok(fs.existsSync(path.join(studioRoot, 'exam-model.js')));
  assert.ok(fs.existsSync(path.join(studioRoot, 'exam-builder.js')));
  assert.match(html, /draggable=["']true["']/);
  assert.match(html, /id=["']lesson-download-button["']/);
  assert.match(html, /id=["']lesson-copy-button["']/);
  assert.match(html, /id=["']lesson-new-button["']/);
  assert.match(html, /id=["']lesson-repository-save-button["']/);
  assert.match(html, /id=["']lesson-repository-delete-button["']/);
  assert.match(html, /id=["']prompt-workspace["']/);
  assert.match(html, /id=["']exam-workspace["']/);
  assert.match(html, /id=["']content-explorer-folders["']/);
  assert.match(html, /id=["']content-explorer-search["']/);
  assert.match(script, /openContentExplorerAsset/);
  assert.match(script, /deleteContentExplorerAsset/);
  assert.match(script, /data\.explorerDelete|dataset\.explorerDelete/);
  assert.match(script, /expectedSha:\s*asset\.sha/);
  assert.match(examBuilder, /deletionWarning/);
  assert.match(examBuilder, /assetDeleted/);
  assert.match(examBuilder, /openAsset/);
  assert.match(html, /data-exam-tab=["']questions["']/);
  assert.match(html, /data-exam-tab=["']reports["']/);
  assert.match(examBuilder, /resultVisibility\.feedbackMode/);
  assert.match(examBuilder, /\/\.netlify\/functions\/admin-users/);
  assert.match(examBuilder, /Szukaj po imieniu, nazwisku, e-mailu lub ID/);
  assert.match(styles, /\.exam-audience-picker/);
  assert.match(styles, /\.content-explorer-folder/);
  assert.match(styles, /\.content-explorer-delete/);
  assert.match(examBuilder, /uploadExamMedia/);
  assert.match(examBuilder, /handleMediaPaste/);
  assert.match(examBuilder, /handleMediaDrop/);
  assert.match(examBuilder, /ChemContentLibrary\.readMediaBlob/);
  assert.match(examBuilder, /loadAssets\(true, \{ keepBank: true \}\)/);
  assert.match(styles, /\.exam-media-dropzone/);
  assert.match(examStyles, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(examPlayer, /ANSWER_SAVE_INTERVAL_MS\s*=\s*15_000/);
  assert.match(examPlayer, /client\.bootstrap\(/);
  assert.match(examPlayer, /SIGNAL_THROTTLE_MS\s*=\s*10_000/);
  assert.match(examPlayer, /autosave-batch/);
  assert.match(examPlayer, /sessionStorage/);
  assert.match(examPlayer, /pendingNavigationIndex/);
  assert.match(examPlayer, /state\.attempt\.currentIndex\s*=\s*targetIndex/);
  assert.match(examPlayer, /cursor_leave/);
  assert.match(examPlayer, /context_menu/);
  assert.match(examBuilder, /Sygnały wymagające uwagi/);
  assert.match(styles, /\.exam-attempt-alerts/);
  assert.match(styles, /\.exam-builder-shell\s*\{[\s\S]*?height:\s*calc\(100dvh\s*-\s*var\(--studio-header-height\)\s*-\s*var\(--workspace-toolbar-height\)\)/);
  assert.match(styles, /\.exam-editor-panel,[\s\S]*?\.exam-summary-panel\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(html, /id=["']prompt-download-button["']/);
  assert.match(html, /id=["']prompt-import-button["']/);
  assert.match(html, /id=["']prompt-repository-save-button["']/);
  assert.match(html, /id=["']prompt-repository-delete-button["']/);
  assert.match(html, /id=["']source-dialog["']/);
  assert.match(html, /data-lesson-add=["']quote["']/);
  assert.match(html, /data-lesson-add=["']youtube["']/);
  assert.match(html, /data-lesson-add=["']slides["']/);
  assert.match(html, /data-lesson-add=["']presentation["']/);
  assert.match(html, /data-lesson-add=["']quiz["']/);
  assert.match(html, /data-lesson-add=["']pdf["']/);
  assert.match(html, /data-lesson-add=["']atonom["']/);
  assert.match(html, /data-lesson-add=["']formula["']/);
  assert.match(html, /data-lesson-add=["']link["']/);
  assert.match(html, /data-lesson-add=["']ai["']/);
  assert.match(html, /data-lesson-add=["']board["']/);
  assert.match(html, /data-lesson-add=["']contact["']/);
  assert.match(html, /palette-group-featured/);
  assert.match(html, /data-lesson-add=["']flashcards["']/);
  assert.match(html, /data-lesson-add=["']task-gaps["']/);
  assert.match(html, /data-lesson-add=["']task-gaps-text["']/);
  assert.match(html, /\/members\/module\/mathjax-config\.js/);
  assert.match(mathJaxConfig, /\[tex\]\/mhchem/);
  assert.match(html, /mathjax@3\.2\.2/);
  assert.match(html, /\/assets\/js\/content-library\.js/);
  assert.match(html, /id=["']dashboard-asset-search["']/);
  assert.match(html, /id=["']dashboard-repository-select["']/);
  assert.match(html, /id=["']lesson-repository-select["']/);
  assert.match(html, /id=["']prompt-repository-select["']/);
  assert.match(html, /id=["']lesson-asset-search["']/);
  assert.match(html, /id=["']dashboard-asset-list["']/);
  assert.match(html, /id=["']lesson-asset-list["']/);
  assert.match(script, /addEventListener\(['"]dragstart['"]/);
  assert.match(script, /addEventListener\(['"]drop['"]/);
  assert.match(script, /window\.open\(/);
  assert.match(script, /data-full-preview/);
  assert.match(script, /state\.lesson\.model\.slides\.forEach/);
  assert.match(script, /Ponów synchronizację postępów/);
  assert.match(script, /syncLessonProgressManifest\(pendingManifest\)/);
  assert.match(script, /bez ponownej publikacji lekcji/);
  assert.match(script, /LESSON_MANIFEST_PENDING_KEY/);
  assert.match(script, /state\.lesson\.manifestPending = readPendingLessonManifest\(\)/);
  assert.match(script, /setPendingLessonManifest\(manifest\)/);
  assert.match(script, /writeStorage\(LESSON_DRAFT_KEY, state\.lesson\.model\)/);
  assert.match(script, /pendingManifest\.content === String\(result\.content \|\| ''\)/);
  assert.match(script, /type === 'error' \|\| type === 'warning'/);
  assert.match(script, /function bindPreviewTasks/);
  assert.match(script, /function bindPreviewAtonom/);
  assert.match(script, /function bindPreviewAiHelp/);
  assert.match(script, /chem\.lesson-ai-context\./);
  assert.match(script, /buildLessonAiContext/);
  assert.match(script, /previewTaskAiResponse/);
  assert.match(script, /authorContext/);
  assert.match(script, /markPreviewAnswerStates/);
  assert.match(script, /Dodatkowy kontekst autora dla AI/);
  assert.match(script, /Dołącz zadanie, warianty odpowiedzi/);
  assert.match(styles, /\.preview-gap-field\[data-state="success"\]/);
  assert.match(styles, /\.preview-gap-field\[data-state="error"\]/);
  assert.match(styles, /\.preview-choice-option\[data-state="success"\]/);
  assert.match(styles, /\.preview-choice-option\[data-state="error"\]/);
  assert.match(script, /function typesetMath/);
  assert.match(script, /function preparePreviewYouTube/);
  assert.match(script, /source\.searchParams\.set\(['"]origin['"],\s*window\.location\.origin\)/);
  assert.match(script, /source\.searchParams\.set\(['"]widget_referrer['"],\s*window\.location\.href\)/);
  assert.match(script, /#MJX-CHTML-styles,\s*style\[id\^=["']MJX-["']\]/);
  assert.match(script, /data-formula-snippet/);
  assert.match(script, /LESSON_FORMULA_PRESETS/);
  assert.match(script, /data-formula-preset/);
  assert.match(script, /data-formula-arrow/);
  assert.match(script, /formulaComposerPreview/);
  assert.match(script, /updateFormulaComposerPreview/);
  assert.match(script, /function revealFeaturedLessonTool/);
  assert.match(script, /activateInspectorPanel\(['"]lesson['"],\s*['"]inspector['"]\)/);
  assert.match(script, /scrollIntoView/);
  assert.match(script, /SLIDE_TRANSITIONS/);
  assert.match(script, /previewTransitionKey/);
  assert.match(script, /ChemLesson\.checkAnswer/);
  assert.match(script, /ChemLesson\.checkGapAnswer/);
  assert.match(script, /data-lesson-task-editor-action/);
  assert.match(script, /serializeLesson/);
  assert.match(script, /parseEditableLesson/);
  assert.match(script, /library\.list\(['"]lesson['"]/);
  assert.match(script, /library\.list\(['"]prompt['"]/);
  assert.match(script, /library\.repositories\(\)/);
  assert.match(script, /library\.studioBootstrap\(/);
  assert.match(script, /INVALID_CONTENT_ACTION/);
  assert.match(script, /studioBootstrapCapability:\s*null/);
  assert.match(script, /studioBootstrapCapability\s*===\s*false/);
  assert.match(script, /INVALID_CONTENT_ACTION['"]\)\s*\{[\s\S]*?studioBootstrapCapability\s*=\s*false;[\s\S]*?return null/);
  assert.match(script, /applyRepositoryAssetBundle/);
  assert.match(script, /ChemContentLibrary\.readLesson/);
  assert.match(script, /function createNewLessonDraft\(\)/);
  assert.match(script, /lessonModelApi\.parseEditableLesson\(source,\s*filename\)/);
  assert.match(script, /sourceWasEmpty/);
  assert.match(script, /ChemContentLibrary\.readPrompt/);
  assert.match(script, /ChemContentLibrary\.save/);
  assert.match(script, /ChemContentLibrary\.remove/);
  assert.match(script, /library\.search/);
  assert.match(script, /function lessonRepositoryFilenameInput/);
  assert.match(script, /lessonRepositoryFilenameInput\([\s\S]*?block\.promptFile[\s\S]*?\[['"]json['"],\s*['"]txt['"]\]/);
  assert.match(script, /function syncInspectorRepository/);
  assert.match(script, /\[['"]lesson['"],\s*['"]chat['"],\s*['"]exam['"],\s*['"]presentation['"],\s*['"]quiz['"]\]\.includes\(node\.module\)/);
  assert.match(script, /block\.type\s*===\s*['"]ai['"][^;\n]*syncInspectorRepository/);
  assert.match(script, /if\s*\(fieldName\s*===\s*['"]repositoryId['"]\)[\s\S]*?selectContentRepository/);
  assert.match(script, /collapsedNodes:\s*new Set\(\)/);
  assert.match(script, /['"]toggle-collapse['"]/);
  assert.match(script, /body\.hidden\s*=\s*collapsed/);
  assert.match(script, /found\.node\.kind\s*===\s*['"]section['"]\s*\|\|\s*found\.node\.kind\s*===\s*['"]group['"]/);
  assert.match(script, /function requestedFullPreviewMode/);
  assert.match(script, /function startStandalonePreview/);
  assert.match(script, /new URL\(['"]\/members\/module\/studio\/['"],\s*window\.location\.origin\)/);
  assert.match(script, /previewUrl\.searchParams\.set\(['"]preview['"],\s*mode\)/);
  assert.doesNotMatch(script, /popup\.history\.replaceState/);
  assert.match(styles, /\.studio-preview-window/);
  assert.match(styles, /\.full-preview-main/);
  assert.match(styles, /\.full-lesson-list/);
  assert.match(styles, /\.lesson-font-serif/);
  assert.match(styles, /\.lesson-align-center/);
  assert.match(styles, /\.lesson-font-arial/);
  assert.match(styles, /\.lesson-weight-bold/);
  assert.match(styles, /\.lesson-rich-style p[\s\S]*?font-size:\s*inherit/);
  assert.match(styles, /\.lesson-atonom-card/);
  assert.match(styles, /\.lesson-formula-display/);
  assert.match(styles, /\.lesson-link-card/);
  assert.match(styles, /\.lesson-table/);
  assert.match(styles, /\.lesson-support-card/);
  assert.match(styles, /\.lesson-ai-help/);
  assert.match(styles, /\.lesson-board-card/);
  assert.match(styles, /\.formula-chemistry-equation/);
  assert.match(styles, /\.formula-builder-preview/);
  assert.match(styles, /\.formula-arrow-button/);
  assert.match(styles, /\[data-transition=["']rise["']\]/);
  assert.match(styles, /\.formula-symbol-toolbar/);
  assert.match(styles, /\.lesson-palette-scroll/);
  assert.match(styles, /\.palette-group-featured/);
  assert.match(styles, /\.task-correct-toggle/);
  assert.match(styles, /\.preview-quiz/);
  assert.match(styles, /\.preview-text-gap/);
  assert.match(styles, /\.drop-zone\.is-dragover/);
  assert.match(styles, /\.section-node\.is-editor-collapsed/);
  assert.match(styles, /\.group-node\.is-editor-collapsed/);
  assert.match(styles, /\.dashboard-collapse-action/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /data-studio-toggle=["']palette["']/);
  assert.match(html, /data-studio-toggle=["']inspector["']/);
  assert.match(html, /data-studio-toggle=["']toolbar["']/);
  assert.match(script, /function toggleStudioLayout\(/);
  assert.match(styles, /\.workspace-view\.is-palette-collapsed/);
  assert.match(styles, /\.workspace-view\.is-inspector-collapsed/);
  assert.match(styles, /\.workspace-view\.is-toolbar-collapsed/);
  assert.match(styles, /100dvh[\s\S]*?overflow:\s*auto/);
  assert.doesNotMatch(html, /data-dashboard-add=["']filmv1["']/i);
  assert.doesNotMatch(script, /Wygenerowany adres|dashboard-url-preview|hrefPreview/);

  const repositoryLibrary = html.indexOf('lesson-repository-library');
  const scrollingLessonBlocks = html.indexOf('palette-scroll lesson-palette-scroll');
  const regularContent = html.indexOf('<h2>Treść</h2>', scrollingLessonBlocks);
  const interactions = html.indexOf('<h2>Interakcje</h2>', regularContent);
  const featuredTools = html.indexOf('palette-group palette-group-featured lesson-library-tools', interactions);
  const dashboardWorkspaceStart = html.indexOf('id="dashboard-workspace"');
  const lessonWorkspaceStart = html.indexOf('id="lesson-workspace"');
  const promptWorkspaceStart = html.indexOf('id="prompt-workspace"');
  const dashboardWorkspace = html.slice(dashboardWorkspaceStart, lessonWorkspaceStart);
  const lessonWorkspace = html.slice(lessonWorkspaceStart, promptWorkspaceStart);
  assert.ok(featuredTools >= 0, 'missing featured lesson tools');
  assert.ok(scrollingLessonBlocks > repositoryLibrary, 'scrolling lesson blocks should follow the repository');
  assert.ok(regularContent > scrollingLessonBlocks, 'regular content should be inside the scrolling block list');
  assert.ok(interactions > regularContent, 'interactions should follow regular content');
  assert.ok(featuredTools > interactions, 'formula, AI and board should be at the bottom of the scrolling block list');
  assert.doesNotMatch(dashboardWorkspace, /data-lesson-add=["'](?:formula|ai|board)["']/);
  assert.match(lessonWorkspace, /data-lesson-add=["']formula["']/);
  assert.match(lessonWorkspace, /data-lesson-add=["']ai["']/);
  assert.match(lessonWorkspace, /data-lesson-add=["']board["']/);
  assert.match(lessonWorkspace, /data-lesson-add=["']table["']/);
  assert.match(script, /fieldName\s*===\s*['"]tableHeaders['"]/);
  assert.match(script, /fieldName\s*===\s*['"]tableRows['"]/);
  assert.match(script, /function materialPicker\(/);
  assert.match(script, /studio-material-picker-option/);
  assert.doesNotMatch(script, /createElement\(['"]datalist['"]\)/);
  assert.match(script, /slideLayout/);
  assert.match(script, /slideBackground/);
  assert.match(script, /slideDecoration/);
  assert.match(script, /slideTextTone/);
  assert.match(script, /bindLessonPreviewCanvasControls/);
  assert.match(script, /scientificNotationToolbar/);

  const dashboardClone = script.slice(
    script.indexOf('function cloneDashboardNode'),
    script.indexOf('function cloneLessonNode')
  );
  assert.match(dashboardClone, /delete node\.uid/);
  assert.doesNotMatch(dashboardClone, /delete node\.id/);
  assert.match(script, /saveTimers:\s*\{\s*dashboard:\s*0,\s*lesson:\s*0,\s*prompt:\s*0\s*\}/);
  assert.match(script, /addEventListener\(['"]pagehide['"],\s*flushDrafts\)/);
});

test('Studio probes an unsupported bootstrap only once per page load', async () => {
  const script = read('public/members/module/studio/script.js');
  const source = /  (async function loadStudioBootstrap\(library, repositoryId, force\) \{[\s\S]*?\n  \})\n\n  function applyRepositoryAssetBundle/.exec(script);
  assert.ok(source, 'missing loadStudioBootstrap helper');
  const state = { contentLibrary: { studioBootstrapCapability: null } };
  const loadStudioBootstrap = Function(
    'state',
    `'use strict';\n${source[1]}\nreturn loadStudioBootstrap;`
  )(state);
  let calls = 0;
  const library = {
    async studioBootstrap() {
      calls += 1;
      const error = new Error('Older Function');
      error.code = 'INVALID_CONTENT_ACTION';
      throw error;
    }
  };

  assert.equal(await loadStudioBootstrap(library, '', false), null);
  assert.equal(state.contentLibrary.studioBootstrapCapability, false);
  assert.equal(await loadStudioBootstrap(library, '', true), null);
  assert.equal(calls, 1);
});

function repositoryLoadHarness(library) {
  const script = read('public/members/module/studio/script.js');
  const recovery = /  (async function recoverRepositorySelector\(library, requestId\) \{[\s\S]*?\n  \})\n\n  function loadRepositoryAssets/.exec(script);
  const loader = /  (async function performLoadRepositoryAssets\(force\) \{[\s\S]*?\n  \})\n\n  async function refreshRepositoryAssetKind/.exec(script);
  assert.ok(recovery && loader);
  const state = { mode: 'home', contentLibrary: { repositories: [], selectedRepositoryId: '', requestId: 0, error: '', loaded: false, loading: false } };
  const status = () => ({ textContent: '', classList: { add() {}, remove() {} } });
  const elements = { dashboardAssetStatus: status(), lessonAssetStatus: status(), promptAssetStatus: status(), contentExplorerStatus: status() };
  let selectorRenders = 0, assetRenders = 0;
  const load = Function('state', 'window', 'elements', 'loadStudioBootstrap', 'selectedRepository',
    'renderRepositorySelectors', 'renderContentExplorer', 'applyRepositoryAssetBundle', 'renderRepositoryAssets',
    'updateRepositoryButtons', 'loadRepositoryAssetLists',
    `'use strict';\n${recovery[1]}\n${loader[1]}\nreturn performLoadRepositoryAssets;`
  )(state, { ChemContentLibrary: library }, elements,
    (client, repositoryId, force) => client.studioBootstrap({ repositoryId, refresh: Boolean(force) }),
    () => state.contentLibrary.repositories.find((entry) => entry.id === state.contentLibrary.selectedRepositoryId),
    () => { selectorRenders++; }, () => {},
    (assets) => { state.contentLibrary.assets = assets; }, () => { assetRenders++; }, () => {},
    () => { throw new Error('No legacy list fan-out expected'); });
  return { state, elements, load, counts: () => ({ selectorRenders, assetRenders }) };
}

test('Studio keeps the repository selector usable after a failed bootstrap and can load another repository', async () => {
  const repositories = [{ id: 'glowne', label: 'Main', default: true }, { id: 'test', label: 'Test', default: false }];
  let metadataReads = 0, bootstrapReads = 0;
  const failure = Object.assign(new Error('Nie znaleziono gałęzi.'), { code: 'CONTENT_REPOSITORY_BRANCH_NOT_FOUND' });
  const harness = repositoryLoadHarness({
    async repositories() { metadataReads++; return repositories; },
    async list() { throw new Error('No per-kind requests expected'); },
    async studioBootstrap({ repositoryId }) {
      bootstrapReads++;
      if (repositoryId !== 'test') throw failure;
      return { repositories, repository: repositories[1], assets: { lesson: [{ filename: 'cell.md' }], prompt: [], exam: [], presentation: [], quiz: [] } };
    }
  });
  await harness.load(false);
  assert.deepEqual(harness.state.contentLibrary.repositories, repositories);
  assert.equal(harness.state.contentLibrary.selectedRepositoryId, 'glowne');
  assert.equal(harness.elements.contentExplorerStatus.textContent, failure.message, 'The real error is preserved');
  assert.equal(harness.state.contentLibrary.loaded, false);
  assert.equal(harness.state.contentLibrary.loading, false);
  assert.equal(metadataReads, 1);
  assert.equal(harness.counts().selectorRenders, 1);
  await harness.load(true);
  assert.equal(metadataReads, 1, 'Metadata recovery must not be repeated once the selector is populated');
  harness.state.contentLibrary.selectedRepositoryId = 'test';
  await harness.load(false);
  assert.equal(harness.state.contentLibrary.loaded, true);
  assert.equal(harness.state.contentLibrary.error, '');
  assert.equal(harness.state.contentLibrary.assets.lesson[0].filename, 'cell.md');
  assert.equal(bootstrapReads, 3);
});

test('Studio does not request repository metadata after a session/access failure', async () => {
  let metadataReads = 0;
  const harness = repositoryLoadHarness({
    async repositories() { metadataReads++; return []; },
    async studioBootstrap() { throw Object.assign(new Error('Zaloguj się ponownie.'), { code: 'AUTH_REQUIRED' }); }
  });
  await harness.load(false);
  assert.equal(metadataReads, 0);
  assert.equal(harness.state.contentLibrary.error, 'Zaloguj się ponownie.');
});

test('lesson authoring extensions are rendered through strict, non-HTML directives', () => {
  const parser = read('public/members/module/lesson/lesson-parser.js');
  const player = read('public/members/module/lesson/script.js');
  const styles = read('public/members/module/lesson/style.css');
  const chatHtml = read('public/members/module/chat/index.html');
  const chatScript = read('public/members/module/chat/script.js');

  assert.match(parser, /STYLE_FONTS\s*=\s*new Set/);
  assert.match(parser, /SAFE_STYLE_COLOR/);
  assert.match(parser, /lesson-accordion/);
  assert.match(parser, /lesson-atonom-card/);
  assert.match(parser, /lesson-atonom-open/);
  assert.match(parser, /formulaBlockHtml/);
  assert.match(parser, /lesson-link-card/);
  assert.match(parser, /tableBlockHtml/);
  assert.match(parser, /lesson-ai-help/);
  assert.match(parser, /function taskAiContext/);
  assert.match(parser, /function lessonMediaAiContext/);
  assert.match(parser, /data-lesson-media-alt/);
  assert.match(parser, /lesson-flashcard/);
  assert.match(parser, /lesson-board-card/);
  assert.match(parser, /lesson-contact-card/);
  assert.match(parser, /safeLinkCardUrl/);
  assert.match(parser, /SAFE_MATH_COMMANDS/);
  assert.match(parser, /decoding=["']async["']/);
  assert.match(parser, /referrerpolicy=["']no-referrer["']/);
  assert.match(styles, /\.lesson-rich-style/);
  assert.match(styles, /\.lesson-font-arial/);
  assert.match(styles, /\.lesson-weight-bold/);
  assert.match(styles, /\.lesson-rich-style p[\s\S]*?font-size:\s*inherit/);
  assert.match(styles, /\.lesson-atonom-card/);
  assert.match(styles, /\.lesson-formula-display/);
  assert.match(styles, /\.lesson-link-card/);
  assert.match(styles, /\.lesson-table/);
  assert.match(styles, /\.lesson-support-card/);
  assert.match(styles, /\.lesson-contact-card/);
  assert.match(styles, /\.slide-card\.is-entering\[data-transition=["']zoom["']\]/);
  assert.match(styles, /data-lesson-background=["']grid["']/);
  assert.match(styles, /data-lesson-decoration=["']molecules["']/);
  assert.match(player, /function completeCurrentStepForNavigation/);
  assert.match(player, /if \(!maySkipCurrent\(\)\) \{\s*await refreshExamProgress\(true\)/);
  assert.match(styles, /\.lesson-font-rounded/);
  assert.match(styles, /\.lesson-accordion\[open\]/);
  assert.match(styles, /\.lesson-flashcard/);
  assert.match(styles, /\.lesson-embed/);
  assert.match(styles, /\.gap-exercise/);
  assert.match(player, /function openSlideAiHelp/);
  assert.match(player, /chem\.lesson-ai-context\./);
  assert.match(player, /\[data-lesson-ai-open\]/);
  assert.match(player, /currentTaskAiResponse/);
  assert.match(player, /buildLessonAiContext/);
  assert.match(player, /markTaskAnswerStates/);
  assert.match(styles, /\.gap-exercise select\[data-state="success"\]/);
  assert.match(styles, /\.gap-exercise select\[data-state="error"\]/);
  assert.match(styles, /\.choice-grid label\[data-state="success"\]/);
  assert.match(styles, /\.choice-grid label\[data-state="error"\]/);
  assert.match(chatHtml, /id=["']lesson-context-status["']/);
  assert.match(chatScript, /LESSON_CONTEXT_MAX_AGE\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(chatScript, /LESSON_CONTEXT_MAX_CHARS\s*=\s*12_000/);
  assert.match(chatScript, /replace\(\/\\r\\n\?\/g,\s*['"]\\n['"]\)/);
  assert.match(chatScript, /localStorage\.removeItem\(key\)/);
  assert.match(chatScript, /Kontekst slajdu/);
});
