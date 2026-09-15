'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const git = require('../netlify/git-provider');
const repository = require('../netlify/content-repository');
const assets = require('../netlify/site-assets');
const delivery = require('../public/assets/js/landing-delivery-model');
const envModel = require('../public/members/module/studio/env/env-model');
const env = { GIT_PROVIDER: 'gitea', GITEA_BASE_URL: 'https://git.example', GITEA_API_URL: 'https://git.example/api/v1',
  GITEA_TOKEN: 'private-gitea-token-never-return', GITEA_OWNER: 'school', GITEA_REPO: 'course', GITEA_BRANCH: 'main',
  GITEA_SITE_ASSETS_REPOSITORY: 'school/public-assets' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sha = (content) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
function server() {
  const calls = [], files = new Map([['lessons/cell.md', Buffer.from('# Komórka\n\nTreść lekcji.\n')], ['catalog.json', Buffer.from('{"assets":{}}')]]);
  const fetchImpl = async (url, options) => {
    url = new URL(url); calls.push({ url, ...options });
    assert.equal(url.origin, 'https://git.example');
    assert.equal(options.headers.Authorization, `token ${env.GITEA_TOKEN}`);
    assert.equal(options.headers['X-GitHub-Api-Version'], undefined);
    assert.equal(options.redirect, 'error');
    const path = decodeURIComponent(url.pathname.split('/contents/')[1] || '');
    const content = files.get(path);
    if (options.method === 'GET') {
      assert.equal(url.searchParams.get('ref'), 'main');
      if (!path) return json([...files.keys()].map((key) => ({ name: key.split('/')[0], type: key.includes('/') ? 'dir' : 'file' })));
      if (path === 'lessons') {
        const entries = [...files].filter(([key]) => key.startsWith('lessons/')).map(([key, value]) => ({ type: 'file', name: key.split('/')[1], sha: sha(value), size: value.length }));
        return entries.length ? json(entries) : json({}, 404);
      }
      return content ? json({ type: 'file', encoding: 'base64', content: content.toString('base64'), sha: sha(content) }) : json({}, 404);
    }
    const body = JSON.parse(options.body);
    assert.equal(body.branch, 'main');
    if (options.method === 'POST' && content) return json({}, 422);
    if (options.method !== 'POST' && (!content || body.sha !== sha(content))) return json({}, 409);
    if (options.method === 'DELETE') files.delete(path);
    else files.set(path, Buffer.from(body.content, 'base64'));
    return json({ content: options.method === 'DELETE' ? null : { sha: sha(files.get(path)) }, commit: { sha: 'b'.repeat(40), html_url: 'https://git.example/school/course/commit/abc' } });
  };
  return { files, calls, fetchImpl };
}
test.beforeEach(() => { repository._test.clearCache(); assets._test.resetPublicCheck(); });

test('Gitea defaults, explicit switching and old GitHub aliases remain compatible', () => {
  assert.equal(git.providerName({}), 'gitea');
  assert.equal(git.providerName({ GITHUB_CONTENT_TOKEN: 'legacy' }), 'github');
  assert.equal(repository.repositoryConfig(env).repository, 'school/course');
  const old = repository.repositoryConfig({ GIT_PROVIDER: 'github', GITHUB_TOKEN: 'legacy', GITHUB_OWNER: 'owner', GITHUB_REPO: 'course', GITHUB_BRANCH: 'release' });
  assert.equal(old.configured, true); assert.equal(old.ref, 'release');
  assert.equal(git.headers(old).Authorization, 'Bearer legacy');
  assert.equal(git.headers(old)['X-GitHub-Api-Version'], git.GITHUB_API_VERSION);
  assert.throws(() => git.settings({ GIT_PROVIDER: 'unknown' }), { code: 'INVALID_GIT_PROVIDER' });
});

test('Gitea Markdown, JSON and directory lists use the existing content layer and SHA', async () => {
  const remote = server(), options = { env, fetchImpl: remote.fetchImpl };
  const lesson = await repository.readAsset('lesson', 'cell.md', options);
  assert.equal(lesson.content, '# Komórka\n\nTreść lekcji.\n');
  assert.equal(lesson.sha, sha(remote.files.get('lessons/cell.md')));
  const parsed = require('../public/members/module/lesson/lesson-parser');
  assert.equal(parsed.parseLesson(lesson.content, 'cell.md').title, 'Komórka');
  const list = await repository.listAssets('lesson', options);
  assert.equal(list[0].filename, 'cell.md');
  const count = remote.calls.length;
  await repository.listAssets('lesson', options);
  assert.equal(remote.calls.length, count, 'Directory cache avoids another Gitea request');
  const response = await git.request(repository.repositoryConfig(env), git.apiUrl(repository.repositoryConfig(env), 'catalog.json'), { fetchImpl: remote.fetchImpl, raw: true });
  assert.deepEqual(await response.json(), { assets: {} });
});

test('create, update, conflicts and delete use Gitea POST/PUT/DELETE with base64 and SHA', async () => {
  const remote = server(), options = { env, fetchImpl: remote.fetchImpl };
  const created = await repository.saveAsset('lesson', 'new.md', '# Nowa lekcja\n', options);
  assert.equal(remote.calls.at(-1).method, 'POST');
  assert.equal(created.created, true);
  const updated = await repository.saveAsset('lesson', 'new.md', '# Zmieniona lekcja\n', { ...options, expectedSha: created.sha });
  assert.equal(remote.calls.at(-1).method, 'PUT');
  assert.notEqual(updated.sha, created.sha);
  await assert.rejects(repository.saveAsset('lesson', 'new.md', '# Stara wersja', { ...options, expectedSha: created.sha }), { code: 'CONTENT_WRITE_CONFLICT' });
  await assert.rejects(repository.saveAsset('lesson', 'new.md', '# Duplikat', options), { code: 'CONTENT_FILE_ALREADY_EXISTS' });
  await repository.deleteAsset('lesson', 'new.md', updated.sha, options);
  assert.equal(remote.calls.at(-1).method, 'DELETE');
  assert.equal(remote.files.has('lessons/new.md'), false);
});

test('an initialized Gitea repo needs no material folders before publishing its first lesson', async () => {
  const remote = server();
  remote.files.clear();
  remote.files.set('README.md', Buffer.from('# Course'));
  const options = { env, fetchImpl: remote.fetchImpl };
  const empty = await repository.listAssetBundle(options);
  assert.ok(Object.values(empty).every((entries) => entries.length === 0));
  assert.equal(remote.calls.filter((call) => call.url.pathname.endsWith('/contents')).length, 1);
  assert.ok(remote.calls.every((call) => call.method === 'GET'), 'Opening the library must not create folders or commits');
  await repository.saveAsset('lesson', 'first.md', '# First lesson\n', options);
  assert.equal(remote.calls.at(-1).method, 'POST');
  const loaded = await repository.listAssetBundle(options);
  assert.equal(loaded.lesson[0].filename, 'first.md');
});

for (const initialized of [true, false]) {
  test(`a second Gitea repo ${initialized ? 'without material folders' : 'without a first commit'} cannot block the default library`, async () => {
    const remote = server();
    const emptyCalls = [];
    const multi = { ...env, GITEA_CONTENT_REPOSITORIES: JSON.stringify([
      { id: 'glowne', label: 'Materiały lekcji', repository: 'school/course', ref: 'main', root: '', default: true },
      { id: 'repo-testowe', label: 'Repo testowe', repository: 'school/empty', ref: 'main', root: '', default: false }
    ]) };
    const options = { env: multi, fetchImpl: async (url, requestOptions) => {
      const pathname = new URL(url).pathname;
      if (!pathname.startsWith('/api/v1/repos/school/empty')) return remote.fetchImpl(url, requestOptions);
      emptyCalls.push(pathname);
      assert.equal(requestOptions.method, 'GET');
      if (pathname.endsWith('/repos/school/empty')) return json({ empty: !initialized });
      if (initialized && pathname.endsWith('/contents')) return json([{ type: 'file', name: 'README.md' }]);
      return json({}, 404);
    } };

    assert.equal(repository.publicConfigurations(multi).length, 2);
    const main = await repository.listAssetBundle(options);
    assert.equal(main.lesson[0].filename, 'cell.md');
    assert.equal(main.lesson[0].repositoryId, 'glowne');
    assert.equal(emptyCalls.length, 0, 'Default bootstrap must not read the other repository');

    const mainCalls = remote.calls.length;
    if (initialized) {
      const empty = await repository.listAssetBundle({ ...options, repositoryId: 'repo-testowe' });
      assert.ok(Object.values(empty).every((entries) => entries.length === 0));
      assert.equal(emptyCalls.filter((pathname) => pathname.endsWith('/contents')).length, 1);
    } else {
      await assert.rejects(repository.listAssetBundle({ ...options, repositoryId: 'repo-testowe' }), {
        code: 'CONTENT_REPOSITORY_BRANCH_NOT_FOUND'
      });
    }
    assert.equal(remote.calls.length, mainCalls, 'Selecting another repository must not fetch the default one');
    const cachedMain = await repository.listAssetBundle({ ...options, repositoryId: 'glowne' });
    assert.equal(cachedMain.lesson[0].filename, 'cell.md', 'Empty results must not replace another repository’s cache');
    assert.equal(remote.calls.length, mainCalls, 'Returning to the main repository uses its cache');
    const refreshedMain = await repository.listAssetBundle({ ...options, repositoryId: 'glowne', force: true });
    assert.equal(refreshedMain.lesson[0].filename, 'cell.md');
  });
}

test('Gitea 404 diagnosis distinguishes missing repository, branch and configured root; errors never look empty', async () => {
  for (const [repositoryStatus, branchStatus, code] of [
    [404, 200, 'CONTENT_REPOSITORY_NOT_FOUND'],
    [401, 200, 'CONTENT_REPOSITORY_AUTH_FAILED'],
    [403, 200, 'CONTENT_REPOSITORY_FORBIDDEN'],
    [200, 404, 'CONTENT_REPOSITORY_BRANCH_NOT_FOUND'],
    [200, 200, 'CONTENT_ROOT_NOT_FOUND']
  ]) {
    repository._test.clearCache();
    await assert.rejects(repository.listAssetBundle({ env: { ...env, GITEA_CONTENT_ROOT: 'missing' }, fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/repos/school/course')) return json({}, repositoryStatus);
      if (pathname.includes('/branches/')) return json({}, branchStatus);
      return json({}, 404);
    } }), { code });
  }
  repository._test.clearCache();
  await assert.rejects(repository.listAssetBundle({ env: { ...env, GITEA_CONTENT_ROOT: 'README.md' }, fetchImpl: async (url) => {
    return new URL(url).pathname.endsWith('/contents/README.md') ? json({ type: 'file' }) : json({}, 404);
  } }), { code: 'CONTENT_REPOSITORY_ROOT_NOT_DIRECTORY' });
});

test('private course images are cached on the server and never expose a token URL', async () => {
  const remote = server(), bytes = Buffer.from('test-image-bytes');
  remote.files.set('lessons/cell/photos/figure.png', bytes);
  const options = { env, fetchImpl: remote.fetchImpl };
  const first = await repository.readMedia('local', 'lesson', 'cell.md', 'photos/figure.png', options);
  assert.deepEqual(first.buffer, bytes);
  const count = remote.calls.length;
  await repository.readMedia('local', 'lesson', 'cell.md', 'photos/figure.png', options);
  assert.equal(remote.calls.length, count);
  const visible = JSON.stringify(repository.publicConfigurations(env));
  assert.doesNotMatch(visible, /private-gitea-token-never-return|Authorization/);
  assert.notEqual(git.cacheIdentity(repository.repositoryConfig(env)), git.cacheIdentity(repository.repositoryConfig({ ...env, GITEA_TOKEN: 'rotated' })));
  assert.notEqual(git.cacheIdentity(repository.repositoryConfig(env)), git.cacheIdentity(repository.repositoryConfig({ ...env, GITEA_BASE_URL: 'https://another.example', GITEA_API_URL: '' })));
});

test('401, 403, 404, rate limits, unavailable servers and timeouts are safe failures', async () => {
  for (const [status, code] of [[401, 'CONTENT_REPOSITORY_AUTH_FAILED'], [403, 'CONTENT_REPOSITORY_FORBIDDEN'], [404, 'CONTENT_FILE_NOT_FOUND'], [429, 'CONTENT_REPOSITORY_RATE_LIMITED'], [502, 'CONTENT_REPOSITORY_UNAVAILABLE']]) {
    await assert.rejects(repository.readAsset('lesson', 'cell.md', { env, fetchImpl: async () => json({}, status) }), { code });
  }
  await assert.rejects(repository.readAsset('lesson', 'cell.md', { env, fetchImpl: async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); } }), { code: 'CONTENT_REPOSITORY_TIMEOUT' });
  assert.throws(() => git.settings({ ...env, GITEA_API_URL: 'https://untrusted.example/api/v1' }), { code: 'INVALID_GITEA_URL' });
  assert.throws(() => git.settings({ ...env, GITEA_BASE_URL: 'https://token@git.example' }), { code: 'INVALID_GITEA_URL' });
  let called = false;
  await assert.rejects(git.request(repository.repositoryConfig(env), 'https://untrusted.example', { fetchImpl: async () => { called = true; } }), { code: 'INVALID_GITEA_URL' });
  assert.equal(called, false);
});

test('multi-repository configuration uses Gitea-only ENV and does not leak its tokens', () => {
  const multi = { ...env, GITHUB_CONTENT_REPOSITORIES: 'invalid ignored legacy config', GITEA_TOKEN_BIO: 'other-private-token',
    GITEA_CONTENT_REPOSITORIES: JSON.stringify([
      { id: 'chem', label: 'Chemia', repository: 'school/chemistry', default: true },
      { id: 'bio', label: 'Biologia', repository: 'school/biology', tokenEnv: 'GITEA_TOKEN_BIO' }
    ]) };
  assert.equal(repository.repositoryConfig(multi, 'bio').token, 'other-private-token');
  assert.equal(repository.repositoryConfig(multi, 'default').repository, 'school/chemistry');
  assert.doesNotMatch(JSON.stringify(repository.publicConfigurations(multi)), /other-private-token|private-gitea-token/);
  assert.throws(() => repository.repositoryConfigs({ ...env, GITEA_CONTENT_REPOSITORIES: JSON.stringify([
    { id: 'wrong', label: 'Wrong token provider', repository: 'school/course', tokenEnv: 'GITHUB_TOKEN' }
  ]) }), { code: 'CONTENT_REPOSITORIES_INVALID' });
});

test('public image uploads use Gitea commits/raw links and reject private asset repositories', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK1sAAAAASUVORK5CYII=', 'base64');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options.method);
    assert.equal(options.headers.Authorization, `token ${env.GITEA_TOKEN}`);
    if (String(url).includes('/branches/')) return json({ commit: { id: 'b'.repeat(40) } });
    if (options.method === 'POST') return json({ content: { sha: 'a'.repeat(40) }, commit: { sha: 'b'.repeat(40) } });
    return json({ private: false });
  };
  const result = await assets.uploadAsset({ filename: 'figure.png', contentBase64: png.toString('base64'), mimeType: 'image/png' }, env, { fetchImpl });
  assert.ok(calls.includes('POST'));
  assert.match(JSON.stringify(result), /git\.example.*raw\/commit/);
  assert.doesNotMatch(JSON.stringify(result), /private-gitea-token|github\.com|jsdelivr/);
  assets._test.resetPublicCheck();
  await assert.rejects(assets.listAssets(env, { fetchImpl: async () => json({ private: true }) }), { code: 'SITE_ASSETS_REPOSITORY_NOT_PUBLIC' });
});

test('public landing routing uses ENV instance and anonymous requests; raw URLs never contain credentials', async () => {
  const settings = await assets.readPublicLandingRoute(env, { fetchImpl: async (url, options) => {
    assert.equal(String(url), 'https://git.example/school/public-assets/raw/branch/main/landing/route.json');
    assert.equal(options.headers, undefined); assert.equal(options.credentials, 'omit');
    return json({}, 404);
  } });
  assert.equal(delivery.rawUrl(settings.target), 'https://git.example/school/public-assets/raw/branch/main/landing/config.json');
  assert.doesNotMatch(JSON.stringify(settings), /TOKEN|private-gitea-token|github/);
});

test('Gitea landing can publish, update, select another JSON path and read its public route', async () => {
  const remote = server();
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname.includes('/branches/')) return json({ commit: { id: 'b'.repeat(40) } });
    if (!pathname.includes('/contents/')) return json({ private: false });
    return remote.fetchImpl(url, options);
  };
  const model = require('../netlify/landing-content').defaultModel();
  model.updatedBy = 'private-admin-id';
  const first = await assets.publishLandingConfig(model, env, { fetchImpl, expectedSha: null });
  assert.equal(remote.calls.at(-1).method, 'POST');
  assert.equal(first.rawUrl, 'https://git.example/school/public-assets/raw/branch/main/landing/config.json');
  const read = await assets.readLandingConfig(env, { fetchImpl });
  assert.equal(read.exists, true); assert.equal(read.sha, first.sha);
  model.sections[0].title = 'Nowy tytuł';
  const updated = await assets.publishLandingConfig(model, env, { fetchImpl, expectedSha: first.sha });
  assert.equal(remote.calls.at(-1).method, 'PUT');
  assert.notEqual(first.sha, updated.sha);
  const route = await assets.saveLandingRoute({ target: { repository: 'school/public-assets', ref: 'main', path: 'website/home.json' } }, env, { fetchImpl, expectedSha: null });
  assert.equal(route.settings.target.provider, 'gitea');
  assert.equal(route.configUrl, 'https://git.example/school/public-assets/raw/branch/main/website/home.json');
  const copied = JSON.parse(remote.files.get('website/home.json'));
  assert.equal(copied.model.sections[0].title, 'Nowy tytuł');
  assert.doesNotMatch(JSON.stringify(copied), /private-admin-id|private-gitea-token/);
  const visible = await assets.readPublicLandingRoute(env, { fetchImpl: async (url, options) => {
    assert.equal(options.credentials, 'omit');
    return new Response(remote.files.get('landing/route.json'));
  } });
  assert.equal(delivery.rawUrl(visible.target), route.configUrl);
  await assert.rejects(assets.saveLandingRoute({ target: { repository: 'school/public-assets', ref: 'main', path: 'landing/route.json' } }, env, { fetchImpl, expectedSha: route.sha }), { code: 'LANDING_PATH_RESERVED' });
});

test('ENV generator round-trips Gitea config, masks tokens and preserves legacy imports', () => {
  const entries = envModel.mergeEntries(envModel.defaultEntries(), envModel.parseEnv(Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')).entries);
  const serialized = envModel.serializeEnv(entries);
  const parsed = Object.fromEntries(envModel.parseEnv(serialized).entries.map((entry) => [entry.name, entry.value]));
  assert.equal(repository.repositoryConfig(parsed).provider, 'gitea');
  assert.equal(parsed.GITEA_TOKEN, env.GITEA_TOKEN);
  assert.doesNotMatch(envModel.serializeEnv(entries, { maskSecrets: true }), /private-gitea-token/);
  const legacy = envModel.mergeEntries(envModel.defaultEntries(), envModel.parseEnv('GITHUB_CONTENT_TOKEN=legacy-token\nGITHUB_CONTENT_REPOSITORY=school/course').entries);
  assert.equal(legacy.find((entry) => entry.name === 'GIT_PROVIDER').value, 'github');
  const aliases = envModel.mergeEntries(envModel.defaultEntries(), envModel.parseEnv('GITHUB_TOKEN=old-token\nGITHUB_OWNER=school\nGITHUB_REPO=legacy\nGITHUB_BRANCH=release').entries);
  const aliasEnv = Object.fromEntries(envModel.parseEnv(envModel.serializeEnv(aliases)).entries.map((entry) => [entry.name, entry.value]));
  assert.equal(repository.repositoryConfig(aliasEnv).repository, 'school/legacy');
  assert.equal(repository.repositoryConfig(aliasEnv).ref, 'release');
  const instance = envModel.mergeEntries(envModel.defaultEntries(), envModel.parseEnv('GITEA_BASE_URL=https://another.example').entries);
  assert.equal(envModel.validateEntries(instance).ok, true);
  assert.equal(instance.find((entry) => entry.name === 'GITEA_API_URL').value, '');
  assert.equal(envModel.validateEntries([{ name: 'GIT_PROVIDER', value: 'wrong' }]).ok, false);
  assert.equal(envModel.validateEntries([{ name: 'GITEA_BASE_URL', value: 'https://token@git.example' }]).ok, false);
});
