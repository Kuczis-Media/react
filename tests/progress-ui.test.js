'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadProgressApi() {
  const source = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'progress.js'), 'utf8');
  const window = {
    location: { href: 'https://chemdisk.test/members/' },
    addEventListener() {},
    dispatchEvent() {},
    clearTimeout,
    setTimeout
  };
  vm.runInNewContext(source, {
    window,
    URL,
    Promise,
    Map,
    Set,
    console,
    CustomEvent: class CustomEvent {},
    localStorage: { getItem() { return null; }, setItem() {} }
  });
  return window.ChemProgress;
}

function progressClient({ fail = false } = {}) {
  let now = 1_700_000_000_000, nextTimer = 0;
  const timers = new Map(), requests = [], windowEvents = {}, documentEvents = {};
  const document = { hidden: false, addEventListener(name, handler) { documentEvents[name] = handler; } };
  const window = {
    location: { href: 'https://course.example/members/' },
    ChemAuth: { ready: Promise.resolve({ authenticated: true, session: { ok: true } }), getAccessToken: async () => 'student-token' },
    addEventListener(name, handler) { windowEvents[name] = handler; }, dispatchEvent() {},
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/assets/js/progress.js'), 'utf8'), {
    window, document, URL, Date: { now: () => now }, CustomEvent: class {},
    console: { warn() {} }, localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: !fail, status: fail ? 503 : 200, json: async () => fail ? { error: 'OFFLINE' } : { saved: true } };
    }
  });
  return {
    api: window.ChemProgress, requests, timers, windowEvents, documentEvents, document,
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at; timers.delete(next[0]); await next[1].callback();
      }
      now = target;
    }
  };
}

const lessonEvent = (question, answer) => ({ materialId: 'lesson-1', materialType: 'lesson', action: 'lesson_step', details: { lessonAnswers: { [question]: answer } } });

test('lesson background writes wait five seconds, merge answers and settle every caller with one request', async () => {
  const client = progressClient();
  const first = client.api.update(lessonEvent('q1', 'one'));
  await client.advance(4_000);
  assert.equal(client.requests.length, 0);
  const second = client.api.update(lessonEvent('q2', 'two'));
  assert.equal(first, second, 'Coalesced calls must share completion instead of leaving promises unresolved');
  await client.advance(4_999);
  assert.equal(client.requests.length, 0);
  await client.advance(1);
  assert.equal(client.requests.length, 1);
  assert.deepEqual(client.requests[0].body.details.lessonAnswers, { q1: 'one', q2: 'two' });
  assert.equal((await first).saved, true);
  assert.equal(client.requests[0].options.headers.Authorization, 'Bearer student-token');
  assert.equal(client.requests[0].options.cache, 'no-store', 'Protected writes never enter shared caches');
});

test('continuous lesson editing cannot postpone a server write past fifteen seconds', async () => {
  const client = progressClient();
  const first = client.api.update(lessonEvent('q1', '0'));
  for (let index = 1; index <= 3; index++) {
    await client.advance(4_000);
    client.api.update(lessonEvent('q1', String(index)));
  }
  await client.advance(2_999);
  assert.equal(client.requests.length, 0);
  await client.advance(1);
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].body.details.lessonAnswers.q1, '3');
  assert.equal((await first).saved, true);
});

test('completion immediately includes pending answers and cancels redundant autosaves', async () => {
  const client = progressClient();
  const pending = client.api.update(lessonEvent('q1', 'answer'));
  const result = await client.api.update({ materialId: 'lesson-1', action: 'complete' }, { immediate: true, throwOnError: true });
  assert.equal(result, await pending);
  assert.equal(client.requests[0].body.action, 'complete');
  assert.equal(client.requests[0].body.details.lessonAnswers.q1, 'answer');
  await client.advance(30_000);
  assert.equal(client.requests.length, 1);
});

test('hiding the document flushes pending answers once with keepalive, without a duplicate on pagehide', async () => {
  const client = progressClient();
  const pending = client.api.update(lessonEvent('q1', 'answer'));
  client.document.hidden = true; client.documentEvents.visibilitychange();
  assert.equal((await pending).saved, true);
  client.windowEvents.pagehide(); await client.advance(30_000);
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].options.keepalive, true);
});

test('failed coalesced writes settle all callers and explicit completion still surfaces a server error', async () => {
  const client = progressClient({ fail: true });
  const background = client.api.update(lessonEvent('q1', 'answer'));
  await client.advance(5_000);
  assert.equal(await background, null);
  const pending = client.api.update(lessonEvent('q2', 'answer'));
  await assert.rejects(client.api.update({ materialId: 'lesson-1', action: 'complete' }, { immediate: true, throwOnError: true }), /OFFLINE/);
  assert.equal(await pending, null);
});

test('student progress labels never round a positive value down to zero', () => {
  const api = loadProgressApi();
  assert.equal(api.percentLabel(0), '0%');
  assert.equal(api.percentLabel(0.13), '<1%');
  assert.equal(api.percentLabel(4.26), '4,3%');
  assert.equal(api.percentLabel(68.4), '68%');
});

test('debounced progress updates merge lesson answers by question id', () => {
  const progressSource = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'progress.js'), 'utf8');
  assert.match(
    progressSource,
    /output\.details\.lessonAnswers\s*=\s*\{[\s\S]*previous\?\.details\?\.lessonAnswers[\s\S]*next\?\.details\?\.lessonAnswers/
  );
});

test('course progress remains legible and refreshes after every back navigation', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');
  const studio = fs.readFileSync(path.join(root, 'public', 'members', 'module', 'studio', 'script.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'index.html'), 'utf8');
  assert.match(css, /\.course-progress\s*\{[^}]*--progress-text:\s*#ffffff[^}]*background:\s*rgba\(5, 28, 40, \.72\)/s);
  assert.match(dashboard, /addEventListener\('pageshow',[\s\S]*dashboardLoadId > 0[\s\S]*hydrateDashboardProgress\(null, true\)/);
  assert.match(dashboard, /api\.resetAll\(\)/);
  assert.match(dashboard, /studentResetButton\('Resetuj'/);
  assert.match(dashboard, /aggregate\.trackedCount <= 0/);
  assert.match(studio, /action:\s*'lesson_manifest',[\s\S]*repositoryId,[\s\S]*manifest:/);
  assert.doesNotMatch(studio, /Uwzględniaj w postępie (?:sekcji|działu|całego kursu)/);
  assert.match(html, /id="profile-reset-progress"/);
});

test('sequential presentations complete before navigation and unlock from raw records', () => {
  const dashboard = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.js'), 'utf8');

  assert.match(dashboard, /item\?\.type !== 'presentation'[\s\S]*action:\s*'complete',[\s\S]*opened:\s*true/);
  assert.match(dashboard, /Promise\.race\([\s\S]*window\.location\.assign\(destination\)/);
  assert.match(dashboard, /const records = state\?\.records \|\| \{\};/);
  assert.match(dashboard, /const materialProgress = \(id\) => nodes\[id\] \|\| records\[id\] \|\| null;/);
  assert.match(dashboard, /fallbackLocked = previous\.some\(\(item\) => materialProgress\(item\.dataset\.progressId\)\?\.status !== 'completed'\)/);
  assert.match(dashboard, /currentCatalogSequence = siblings\.every[\s\S]*itemAccess\?\.sequenceId === card\.dataset\.sequenceParent[\s\S]*itemAccess\.totalSteps === siblings\.length/);
});

test('admin student report renders a compact, lazily expanded material tree', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public', 'members', 'module', 'studio', 'manage', 'management.js'), 'utf8');
  assert.match(dashboard, /accountSettings\.className = 'admin-progress-account-settings'/);
  assert.match(dashboard, /card = document\.createElement\('details'\)/);
  assert.match(dashboard, /card\.addEventListener\('toggle',[\s\S]*if \(!card\.open \|\| hydrated\) return;[\s\S]*admin-progress-material-body/);
  assert.match(dashboard, /childrenByParent[\s\S]*admin-progress-material-children[\s\S]*createMaterialRow\(child\)/);
  assert.match(dashboard, /report\.className = 'admin-progress-exam-attempts'/);
  assert.match(dashboard, /report\.addEventListener\('toggle',[\s\S]*view=user[\s\S]*Reset próby/);
  assert.match(css, /\.admin-progress-material > summary\s*\{[\s\S]*min-height:\s*54px/);
  assert.match(css, /\.admin-progress-material-children\s*\{/);
  assert.match(css, /\.admin-progress-exam-attempt\s*\{/);
});

test('global progress report explains metrics and renders readable audit entries', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public', 'members', 'module', 'studio', 'manage', 'management.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'module', 'studio', 'manage', 'index.html'), 'utf8');
  assert.match(html, /Raporty globalne i historia zmian/);
  assert.match(html, /Zbiorcze wyniki kursantów oraz operacje wykonane przez administratorów/);
  assert.match(dashboard, /Jak uczniowie przechodzą kurs/);
  assert.match(dashboard, /wskaźnikiem pomocniczym:[\s\S]*nie jest dowodem/);
  assert.match(dashboard, /adminProgressAuditActionLabel[\s\S]*Zresetowano cały kurs/);
  assert.match(dashboard, /'exam\.attempt\.reset': 'Zresetowano próbę egzaminu'/);
  assert.match(dashboard, /administrator: \$\{adminProgressIdentityLabel\(entry\.adminId\)\}/);
  assert.match(css, /\.admin-progress-distribution\s*\{[\s\S]*repeat\(4/);
  assert.match(css, /\.admin-progress-audit-list li:not\(:last-child\)::before/);
});

test('admin progress lists render in bounded pages and fetch more only on demand', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.css'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public', 'members', 'module', 'studio', 'manage', 'management.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'members', 'module', 'studio', 'manage', 'index.html'), 'utf8');

  assert.match(html, /id="admin-progress-more"[^>]*hidden/);
  assert.match(dashboard, /const ADMIN_PROGRESS_PAGE_SIZE = 30/);
  assert.match(dashboard, /rows\.slice\(0, adminProgressVisibleCount\)/);
  assert.match(dashboard, /function loadMoreAdminProgressUsers\(\)/);
  assert.match(dashboard, /view=users&limit=\$\{ADMIN_PROGRESS_PAGE_SIZE\}&cursor=/);
  assert.match(dashboard, /function loadMoreAdminProgressAudit\(\)/);
  assert.match(dashboard, /Pokaż starsze wpisy/);
  assert.match(css, /\.admin-progress-pagination/);
});
