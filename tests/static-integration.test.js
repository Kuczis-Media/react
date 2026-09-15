const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const modulesRoot = path.join(root, 'public', 'members', 'module');

test('every members module has stable asset paths and waits for initial auth', () => {
  const moduleNames = fs.readdirSync(modulesRoot)
    .filter((name) => fs.statSync(path.join(modulesRoot, name)).isDirectory())
    .sort();

  assert.deepEqual(moduleNames, [
    'atonom', 'bitpaper', 'chat', 'classic', 'contact', 'exam', 'film', 'forms', 'google',
    'kalkulator', 'lesson', 'pdf', 'presentation', 'quiz', 'slides', 'studio', 'whiteboard', 'yt'
  ]);

  for (const name of moduleNames) {
    const directory = path.join(modulesRoot, name);
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const scripts = fs.readdirSync(directory)
      .filter((file) => file.endsWith('.js'))
      .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
      .join('\n');
    const source = `${html}\n${scripts}`;

    assert.match(html, new RegExp(`<base href=["']/members/module/${name}/["']\\s*/?>`), `${name}: missing stable base`);
    assert.match(html, /<meta name=["']x-members["'] content=["']1["']\s*\/?>/, `${name}: missing members marker`);
    assert.match(html, /<script src=["']\/members\/module\/theme\.js["']><\/script>/, `${name}: missing shared theme bootstrap`);
    assert.match(html, /<link rel=["']stylesheet["'] href=["']\/members\/module\/theme\.css["']\s*\/?>/, `${name}: missing shared theme palette`);
    assert.match(html, /<script src=["']\/assets\/js\/auth\.js["']><\/script>/, `${name}: auth must initialize before module code`);
    assert.match(source, /await window\.ChemAuth\.ready/, `${name}: module starts before the session check`);
  }
});

test('all member applications follow the persistent dashboard theme', () => {
  const themeScript = fs.readFileSync(path.join(modulesRoot, 'theme.js'), 'utf8');
  const themeStyles = fs.readFileSync(path.join(modulesRoot, 'theme.css'), 'utf8');

  assert.match(themeScript, /localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(themeScript, /STORAGE_KEY\s*=\s*['"]chem\.theme['"]/);
  assert.match(themeScript, /document\.documentElement|const root = document\.documentElement/);
  assert.match(themeScript, /prefers-color-scheme:\s*dark/);
  assert.match(themeScript, /addEventListener\(['"]storage['"]/);
  assert.match(themeStyles, /--chem-bg:\s*#edf2f7/);
  assert.match(themeStyles, /:root\[data-theme=["']dark["']\]/);
  assert.match(themeStyles, /--chem-primary:\s*#70cfbc/);
  assert.match(themeScript, /function safeLessonReturn/);
  assert.match(themeScript, /lesson_return/);
  assert.match(themeScript, /dataset\.chemLessonReturn/);
  assert.match(themeStyles, /\.chem-module-lesson-return/);
});

test('modules opened by a lesson retain a safe return route', () => {
  const themeScript = fs.readFileSync(path.join(modulesRoot, 'theme.js'), 'utf8');
  const lessonScript = fs.readFileSync(path.join(modulesRoot, 'lesson', 'script.js'), 'utf8');
  const presentationScript = fs.readFileSync(path.join(modulesRoot, 'presentation', 'script.js'), 'utf8');

  assert.match(themeScript, /url\.origin !== origin/);
  assert.match(themeScript, /\/members\\\/module\\\/lesson/);
  assert.match(themeScript, /params\.getAll\('lesson_return'\)/);
  assert.match(lessonScript, /function decorateLessonModuleLinks/);
  assert.match(lessonScript, /target\.searchParams\.set\('lesson_return', returnUrl\)/);
  assert.match(lessonScript, /url\.searchParams\.set\('lesson_return', returnUrl\)/);
  assert.match(presentationScript, /window\.ChemModuleReturn\?\.url \|\| '\/members\/'/);
});

test('Atonom is published locally with protected assets and the shared theme', () => {
  const directory = path.join(modulesRoot, 'atonom');
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(directory, 'script.js'), 'utf8');
  const styles = fs.readFileSync(path.join(directory, 'style.css'), 'utf8');
  const markdown = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.md'), 'utf8');

  const expectedAssets = ['chemistry.js', 'favicon.svg', 'index.html', 'script.js', 'style.css'];
  assert.deepEqual(fs.readdirSync(directory).sort(), expectedAssets);
  for (const filename of expectedAssets) {
    assert.ok(fs.existsSync(path.join(directory, filename)), `atonom: missing ${filename}`);
    assert.equal(fs.lstatSync(path.join(directory, filename)).isSymbolicLink(), false, `atonom: ${filename} must not be a symlink`);
  }
  assert.match(html, /<base href=["']\/members\/module\/atonom\/["']\s*\/?>/);
  assert.match(html, /<meta name=["']x-members["'] content=["']1["']\s*\/?>/);
  assert.match(script, /await window\.ChemAuth\.ready/);
  assert.match(script, /new URLSearchParams\(window\.location\.search\)\.get\(["']formula["']\)/);
  assert.match(script, /url\.searchParams\.set\(["']formula["'],\s*name\)/);
  assert.match(script, /writeStorage\(["']chem\.theme["']/);
  assert.doesNotMatch(script, /atonom-theme/);
  assert.match(styles, /--paper:\s*#edf2f7/);
  assert.match(styles, /--lime:\s*#0e665a/);
  assert.match(styles, /html\[data-theme=["']dark["']\]/);
  assert.match(markdown, /\[ATONOM[^\]]*\]\(\/members\/module\/atonom\/(?:\?[^)]*)?\)/);
  assert.doesNotMatch(markdown, /\[ATONOM\]\(https?:\/\//);
});

test('classic calculator supports complete physical keyboard input', async () => {
  const html = fs.readFileSync(path.join(modulesRoot, 'classic', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(modulesRoot, 'classic', 'script.js'), 'utf8');

  assert.match(html, /aria-keyshortcuts=["']Enter =["']/);
  assert.match(html, /aria-keyshortcuts=["']Backspace Delete["']/);
  assert.match(script, /document\.addEventListener\(['"]keydown['"]/);
  assert.match(script, /event\.key === ['"]Enter['"] \|\| event\.key === ['"]=['"]/);
  assert.match(script, /event\.key === ['"]Backspace['"] \|\| event\.key === ['"]Delete['"]/);
  assert.match(script, /event\.key === ['"]Escape['"]/);
  assert.match(script, /const aliases = \{[^}]*x:\s*['"]\*['"][^}]*['"]:['"]:\s*['"]\/['"]/);

  const displayHandlers = {};
  const documentHandlers = {};
  const display = {
    value: '',
    classList: { add() {}, remove() {} },
    focus() {},
    select() {},
    addEventListener(name, handler) { displayHandlers[name] = handler; }
  };
  const keys = {
    addEventListener() {},
    querySelector() { return null; }
  };
  const context = vm.createContext({
    CSS: { escape: (value) => value },
    document: {
      getElementById: (id) => id === 'display' ? display : keys,
      addEventListener: (name, handler) => { documentHandlers[name] = handler; }
    },
    window: {
      ChemAuth: { ready: Promise.resolve({ authenticated: true, session: { ok: true } }) },
      matchMedia: () => ({ matches: false }),
      setTimeout
    }
  });

  await vm.runInContext(script, context);
  const press = (key) => documentHandlers.keydown({
    key,
    target: {},
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault() {}
  });

  ['1', '+', '2', 'Enter'].forEach(press);
  assert.equal(display.value, '3');
  press('Backspace');
  assert.equal(display.value, '');
  ['9', ':', '3', '='].forEach(press);
  assert.equal(display.value, '3');
  press('Escape');
  assert.equal(display.value, '');
});

test('large member modules keep CSS and JavaScript outside index.html', () => {
  assert.ok(
    fs.existsSync(path.join(modulesRoot, 'mathjax-config.js')),
    'shared MathJax configuration is missing'
  );
  for (const name of ['atonom', 'bitpaper', 'whiteboard', 'forms', 'lesson', 'quiz', 'yt']) {
    const directory = path.join(modulesRoot, name);
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<style\b/i, `${name}: CSS remains inline`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, `${name}: JavaScript remains inline`);
    assert.ok(fs.existsSync(path.join(directory, 'style.css')), `${name}: missing style.css`);
    assert.ok(fs.existsSync(path.join(directory, 'script.js')), `${name}: missing script.js`);
  }

  for (const [name, scriptName] of [['contact', 'script.js'], ['chat', 'bootstrap.js']]) {
    const directory = path.join(modulesRoot, name);
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, `${name}: JavaScript remains inline`);
    assert.ok(fs.existsSync(path.join(directory, scriptName)), `${name}: missing ${scriptName}`);
  }
});

test('chat loads shared mhchem support without blocking application scripts on the CDN', () => {
  const html = fs.readFileSync(path.join(modulesRoot, 'chat', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(modulesRoot, 'chat', 'script.js'), 'utf8');
  const config = fs.readFileSync(path.join(modulesRoot, 'mathjax-config.js'), 'utf8');
  assert.match(html, /\/members\/module\/mathjax-config\.js/);
  assert.match(html, /<script async src="https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax@3\.2\.2/);
  assert.match(config, /\[tex\]\/mhchem/);
  assert.match(config, /chem-mathjax-ready/);
  assert.match(script, /addEventListener\('chem-mathjax-ready'/);
});

test('members home is a local Markdown dashboard rather than a remote iframe', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');
  const markdown = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.md'), 'utf8');

  assert.doesNotMatch(html, /<iframe\b/i);
  assert.match(script, /\/members\/dashboard\.md/);
  assert.match(markdown, /^#\s+\S/m);
  assert.match(markdown, /^##\s+\S/m);
  assert.match(script, /document\.createElement\('details'\)/);
  assert.match(script, /resource-accordion/);
  assert.match(html, /\/members\/dashboard-parser\.js/);
  assert.match(script, /createAccordionGroup\(child,\s*sectionTitle/);
});

test('dashboard lesson links are resolved through the private content library', () => {
  const markdown = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.md'), 'utf8');
  const lessonRoot = path.join(root, 'public', 'members', 'module', 'lesson');
  const lessonScript = fs.readFileSync(path.join(lessonRoot, 'script.js'), 'utf8');
  const dashboardScript = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');
  const lessonLinks = [...markdown.matchAll(/\]\((\/members\/module\/lesson\/\?[^)\s]+)\)/g)]
    .map((match) => new URL(match[1], 'https://course.example'));
  const filenames = lessonLinks.map((url) => url.searchParams.get('file')).filter(Boolean);

  assert.ok(filenames.length > 0, 'dashboard should link to at least one repository lesson');
  assert.ok(lessonLinks.some((url) => (
    url.searchParams.get('repo') === 'repo-testowe' &&
    url.searchParams.get('file') === 'lekcja-chemia-organiczna.md'
  )));
  assert.match(lessonScript, /library\.readLesson\(filename,\s*\{\s*repositoryId\s*\}\)/);
  assert.match(dashboardScript, /ChemContentLibrary/);
  assert.doesNotMatch(dashboardScript, /fetchLibraryLessons|appendLibraryLessons/);
  assert.equal(fs.readdirSync(lessonRoot).some((filename) => filename.endsWith('.md')), false);
});

test('members dashboard has a persistent accessible light and dark theme', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');

  assert.match(html, /id=["']theme-toggle["']/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(script, /localStorage\.setItem\(THEME_STORAGE_KEY/);
  assert.match(script, /aria-pressed/);
  assert.match(styles, /html\[data-theme=["']dark["']\]/);
  assert.match(styles, /color-scheme:\s*dark/);
});

test('profile lets an authenticated user verify the current password and set a new one', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'auth.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');

  assert.match(html, /id=["']profile-password-form["']/);
  assert.match(html, /id=["']profile-current-password["'][^>]*autocomplete=["']current-password["']/);
  assert.match(html, /id=["']profile-new-password["'][^>]*minlength=["']10["'][^>]*autocomplete=["']new-password["']/);
  assert.match(html, /id=["']profile-confirm-password["'][^>]*autocomplete=["']new-password["']/);
  assert.match(script, /function changeProfilePassword/);
  assert.match(script, /newPassword\.length\s*<\s*10/);
  assert.match(script, /newPassword\s*!==\s*confirmPassword/);
  assert.match(script, /auth\.changePassword\(\{\s*currentPassword,\s*newPassword\s*\}\)/);
  assert.match(auth, /ID\.gotrue\.login\(user\.email,\s*currentPassword,\s*true\)/);
  assert.match(auth, /verifiedUser\.update\(\{\s*password:\s*newPassword\s*\}\)/);
  assert.match(styles, /\.profile-password-form/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^)]*password/i);
});

test('members dashboard has a persistent accessible collapsible sidebar', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');

  assert.match(html, /id=["']menu-button["'][^>]*aria-controls=["']sidebar["']/);
  assert.match(html, /localStorage\.getItem\(['"]chem\.sidebar['"]\)/);
  assert.match(script, /localStorage\.setItem\(SIDEBAR_STORAGE_KEY/);
  assert.match(script, /MOBILE_SIDEBAR_QUERY\s*=\s*'\(max-width:\s*920px\)'/);
  assert.match(script, /Zwiń menu boczne/);
  assert.match(script, /Rozwiń menu boczne/);
  assert.match(styles, /html\[data-sidebar=["']collapsed["']\]\s+\.sidebar/);
  assert.match(styles, /html\[data-sidebar=["']collapsed["']\]\s+\.main-area/);
  assert.match(styles, /\.sidebar\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s);
  assert.match(styles, /\.sidebar::\-webkit-scrollbar\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.nav-item\.is-active\s*\{[^}]*background:\s*#e6f8f4/s);
});

test('dashboard admin editor exposes the complete deployment file after load and restore', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');

  assert.doesNotMatch(script, /DASHBOARD_OVERRIDE_STARTER/);
  assert.match(script, /const editorContent = ensureRequiredHelpSection\(content\)/);
  assert.match(script, /elements\.adminDashboardSource\.value = editorContent/);
  assert.match(script, /renderAdminDashboardPreview\(editorContent\)/);
  assert.match(script, /pełny dashboard\.md z wdrożenia wraz ze wszystkimi przykładowymi klockami/);
  assert.match(script, /function ensureRequiredHelpSection\(content\)/);
  assert.match(script, /model = ensureRequiredDashboardModel\(model\)/);
  assert.match(script, /fetchStaticDashboard\(true\)/);
  assert.match(script, /syncDashboardProgressCatalog\(model\)/);
  assert.match(script, /action:\s*'catalog'/);
  assert.match(script, /await syncDashboardProgressCatalog\(model\);[\s\S]*renderDashboard\(model, true\)/);
  assert.match(script, /function renderDashboard\(model, forceProgress = false\)[\s\S]*hydrateDashboardProgress\(model, forceProgress\)/);
  assert.match(script, /Postęp obejmuje teraz wyłącznie materiały znajdujące się w aktualnym dashboardzie/);
  assert.match(script, /Usunięte materiały:/);
  assert.doesNotMatch(script, /adminDashboardRestore\.disabled = !adminDashboardLoaded \|\| adminDashboardSourceKind !== 'blob'/);
});

test('sequential dashboard path is compact, readable and responsive', () => {
  const styles = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');

  assert.match(styles, /\.resource-accordion\.is-sequential \.resource-card\s*\{[^}]*display:\s*grid[^}]*min-height:\s*116px[^}]*grid-template-areas:/s);
  assert.match(styles, /\.resource-accordion\.is-sequential > \.accordion-body > \.card-grid\s*\{[^}]*padding-left:\s*52px/s);
  assert.match(styles, /\.resource-accordion\.is-sequential \.resource-card:not\(:last-child\)::after\s*\{[^}]*left:\s*-33px/s);
  assert.match(styles, /\.resource-accordion\.is-sequential \.card-icon\s*\{[^}]*grid-area:\s*icon/s);
  assert.match(styles, /\.resource-accordion\.is-sequential \.card-open\s*\{[^}]*grid-area:\s*action[^}]*border-radius:/s);
  assert.match(styles, /\.resource-card\.is-sequence-locked\s*\{[^}]*filter:\s*none[^}]*opacity:\s*1/s);
  assert.match(styles, /@media \(max-width:\s*700px\)[\s\S]*\.resource-accordion\.is-sequential \.resource-card\s*\{[^}]*min-height:\s*0[^}]*grid-template-columns:\s*36px/s);
});

test('dashboard exposes user management only through the guarded admin workflow', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'public/members/module/studio/admin/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');

  assert.match(html, /id=["']admin-panel-button["'][^>]*\bhidden\b/);
  assert.doesNotMatch(html, /id=["']admin-dialog["']/);
  assert.match(admin, /id=["']admin-dialog["']/);
  assert.match(admin, /id=["']admin-export-json["'][^>]*\bdisabled\b/);
  assert.match(admin, /id=["']admin-export-xml["'][^>]*\bdisabled\b/);
  assert.match(script, /appMetadata\.roles\.includes\('admin'\)/);
  assert.match(script, /\/\.netlify\/functions\/admin-users/);
  assert.match(script, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(script, /perPage=100/);
  assert.match(script, /function downloadAdminContacts\(format\)/);
  assert.match(script, /application\/json;charset=utf-8/);
  assert.match(script, /application\/xml;charset=utf-8/);
  assert.match(script, /URL\.createObjectURL\(new Blob/);
  assert.match(script, /email:\s*clean\(user && user\.email\)/);
  assert.match(script, /firstName:\s*clean\(user && user\.firstName\)/);
  assert.match(script, /lastName:\s*clean\(user && user\.lastName\)/);
  assert.doesNotMatch(script, /operator[-_ ]token/i);
});

test('administrator UI covers users, Forms, dashboard and private content status', () => {
  const html = fs.readFileSync(path.join(root, 'public/members/module/studio/admin/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');

  for (const tab of ['users', 'forms', 'dashboard', 'content', 'ai', 'landing']) {
    assert.match(html, new RegExp(`data-admin-tab=["']${tab}["']`));
    assert.match(html, new RegExp(`data-admin-panel=["']${tab}["']`));
  }
  assert.match(html, /Contents:\s*Read and write/);
  assert.match(html, /id="admin-content-env-template"/);
  assert.match(script, /GITHUB_CONTENT_TOKEN=/);
  assert.match(script, /GITEA_TOKEN=/);
  assert.doesNotMatch(html + script, /GITHUB_CONTENT_TOKEN=github_pat_[A-Za-z0-9]/);
  assert.match(script, /GITHUB_CONTENT_REPOSITORIES=/);
  assert.match(script, /GITEA_CONTENT_REPOSITORIES=/);
  assert.match(html, /id=["']admin-content-repository-select["']/);
  assert.match(html, /Wpisany token repozytorium jest przesyłany tylko podczas zapisu lub testu/);
  assert.match(html, /id=["']admin-content-config-list["']/);
  assert.match(html, /id=["']admin-content-config-save-deploy["']/);
  assert.match(script, /\/\.netlify\/functions\/admin-users/);
  assert.match(script, /\/\.netlify\/functions\/admin-forms/);
  assert.match(script, /\/\.netlify\/functions\/admin-dashboard/);
  assert.match(script, /\/\.netlify\/functions\/admin-content-repositories/);
  assert.match(script, /action:\s*deploy \? 'save-and-deploy' : 'save'/);
  assert.match(script, /const library = window\.ChemContentLibrary/);
  assert.match(script, /library\.repositories\(\)/);
  assert.match(script, /library\.status\(\{\s*refresh:/);
  assert.match(script, /method:\s*'POST'/);
  assert.match(script, /method:\s*'DELETE'/);
  assert.match(script, /deleteToken:\s*submission\.deleteToken/);
  assert.match(html, /id=["']admin-forms-export["']/);
  assert.match(html, /Pobierz wszystko/);
  assert.match(script, /function exportAllAdminFormSubmissions\(\)/);
  assert.match(script, /chemdisk-formularze-/);
  assert.match(script, /submissionCount:\s*totalSubmissions/);
  assert.match(script, /expectedEtag:\s*adminDashboardEtag/);
  assert.match(script, /window\.confirm/);
  assert.doesNotMatch(script, /process\.env|api\.netlify\.com|github_pat_[A-Za-z0-9]/);
});

test('dashboard runtime editor initializes strong Netlify Blobs API access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const implementation = fs.readFileSync(path.join(root, 'netlify', 'functions', 'admin-dashboard.js'), 'utf8');

  assert.equal(manifest.dependencies['@netlify/blobs'], '10.7.9');
  assert.match(implementation, /require\(['"]@netlify\/blobs['"]\)/);
  assert.match(implementation, /process\.env\.NETLIFY_API_TOKEN/);
  assert.match(implementation, /process\.env\.SITE_ID/);
  assert.match(implementation, /siteID:\s*config\.siteId/);
  assert.match(implementation, /consistency:\s*'strong'/);
  assert.doesNotMatch(implementation, /^\s*connectLambda\(event\);/m);
  assert.match(implementation, /writeResult\.modified\s*!==\s*true/);
});

test('published application code is independent from the old Netlify subdomain', () => {
  const roots = [path.join(root, 'public'), path.join(root, 'netlify')];
  const matches = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && /\.(?:html|css|js|mjs|md|toml)$/.test(entry.name)) {
        if (/chemdisk\.netlify\.app/i.test(fs.readFileSync(fullPath, 'utf8'))) matches.push(fullPath);
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(matches, []);
});

test('access-status page has live Identity states and local published assets', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'time.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'time', 'script.js'), 'utf8');

  assert.match(html, /data-state=["']loading["']/);
  assert.match(html, /id=["']countdown-value["']/);
  assert.match(html, /id=["']progress-track["']/);
  assert.match(script, /window\.ChemAuth\.ready/);
  assert.match(script, /SESSION_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(script, /netlifyIdentity\.init\s*\(/);
});

test('purchase and access-status pages follow the persistent dashboard theme', () => {
  const purchaseHtml = fs.readFileSync(path.join(root, 'public', 'purchase', 'index.html'), 'utf8');
  const purchaseStyles = fs.readFileSync(path.join(root, 'public', 'purchase', 'style.css'), 'utf8');
  const timeHtml = fs.readFileSync(path.join(root, 'public', 'time.html'), 'utf8');
  const timeStyles = fs.readFileSync(path.join(root, 'public', 'assets', 'time', 'style.css'), 'utf8');
  const dashboardStyles = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');

  for (const html of [purchaseHtml, timeHtml]) {
    assert.match(html, /localStorage\.getItem\(['"]chem\.theme['"]\)/);
    assert.match(html, /document\.documentElement\.dataset\.theme/);
    assert.match(html, /prefers-color-scheme:\s*dark/);
  }
  assert.match(purchaseStyles, /:root\[data-theme=["']dark["']\]/);
  assert.match(timeStyles, /:root\[data-theme=["']dark["']\]/);
  assert.match(dashboardStyles, /html\[data-theme=["']dark["']\]\s+\.purchase-sidebar-action/);
});

test('login page prevents Identity email tokens from leaking through referrers', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'login', 'index.html'), 'utf8');
  assert.match(html, /<meta name=["']referrer["'] content=["']no-referrer["']\s*\/>/);
});

test('all inline scripts in published HTML are valid JavaScript', () => {
  const htmlFiles = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(fullPath);
    }
  };
  walk(path.join(root, 'public'));

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const inlineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let index = 0;
    while ((match = inlineScript.exec(html))) {
      index += 1;
      assert.doesNotThrow(
        () => new vm.Script(match[1], { filename: `${file}#inline-${index}` }),
        `${file}: invalid inline script ${index}`
      );
    }
  }
});

test('all local script and stylesheet references point to published files', () => {
  const htmlFiles = [];
  const publicRoot = path.join(root, 'public');
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(fullPath);
    }
  };
  walk(publicRoot);

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const pagePath = `/${path.relative(publicRoot, file).split(path.sep).join('/')}`;
    const baseMatch = html.match(/<base\b[^>]*href=["']([^"']+)["']/i);
    const baseUrl = new URL(baseMatch ? baseMatch[1] : pagePath, 'https://example.test');
    const references = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = references.exec(html))) {
      const raw = match[1].trim();
      if (!raw || /^(?:[a-z]+:)?\/\//i.test(raw) || raw.startsWith('data:')) continue;
      const resolved = new URL(raw, baseUrl);
      const localPath = path.join(publicRoot, decodeURIComponent(resolved.pathname).replace(/^\/+/, ''));
      assert.equal(fs.existsSync(localPath), true, `${file}: missing local asset ${raw}`);
    }
  }
});
