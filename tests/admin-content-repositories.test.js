'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const adminRepositories = require('../netlify/functions/admin-content-repositories.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const IDENTITY_URL = 'https://course.example/.netlify/identity';
const CLIENT_TOKEN = 'verified-client-jwt';
const NETLIFY_TOKEN = 'netlify-api-token-long-enough-for-tests';
const SITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const canonicalAdmin = { id: ADMIN_ID, email: 'admin@example.com', app_metadata: { roles: ['admin', 'active'] } };

const contextFor = () => ({ clientContext: { user: canonicalAdmin, identity: { url: IDENTITY_URL } } });
const eventFor = (overrides = {}) => ({
  httpMethod: 'GET',
  headers: { authorization: `Bearer ${CLIENT_TOKEN}` },
  queryStringParameters: {},
  ...overrides
});
const mutationHeaders = () => ({
  authorization: `Bearer ${CLIENT_TOKEN}`,
  'content-type': 'application/json',
  origin: 'https://course.example',
  host: 'course.example',
  'x-forwarded-proto': 'https'
});
const responseJson = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

function installFetch(t, implementation) {
  const original = global.fetch;
  global.fetch = implementation;
  t.after(() => { global.fetch = original; });
}

function installEnvironment(t, values = {}) {
  const oldProvider = process.env.GIT_PROVIDER;
  process.env.GIT_PROVIDER = 'github';
  t.after(() => { if (oldProvider === undefined) delete process.env.GIT_PROVIDER; else process.env.GIT_PROVIDER = oldProvider; });
  const isRepositoryKey = (key) => key.startsWith('GITHUB_CONTENT_') || key.startsWith('GITEA_');
  const keys = Object.keys(process.env).filter(isRepositoryKey);
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  const netlifyToken = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.SITE_ID;
  const deployContext = process.env.CONTEXT;
  keys.forEach((key) => { delete process.env[key]; });
  process.env.NETLIFY_API_TOKEN = values.netlifyToken === undefined ? NETLIFY_TOKEN : values.netlifyToken;
  process.env.SITE_ID = values.siteId === undefined ? SITE_ID : values.siteId;
  process.env.CONTEXT = values.context === undefined ? 'production' : values.context;
  for (const [key, value] of Object.entries(values.git || values.github || {})) process.env[key] = value;
  t.after(() => {
    Object.keys(process.env).filter(isRepositoryKey).forEach((key) => { delete process.env[key]; });
    saved.forEach((value, key) => { process.env[key] = value; });
    if (netlifyToken === undefined) delete process.env.NETLIFY_API_TOKEN;
    else process.env.NETLIFY_API_TOKEN = netlifyToken;
    if (siteId === undefined) delete process.env.SITE_ID;
    else process.env.SITE_ID = siteId;
    if (deployContext === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = deployContext;
  });
}

test('GET returns repository metadata but never returns GitHub or Netlify secrets', async (t) => {
  installEnvironment(t, {
    github: {
      GITHUB_CONTENT_TOKEN: 'github_pat_super_secret_value',
      GITHUB_CONTENT_REPOSITORIES: JSON.stringify([{
        id: 'glowne', label: 'Główne', repository: 'owner/materials', ref: 'main',
        root: '', tokenEnv: 'GITHUB_CONTENT_TOKEN', default: true
      }])
    }
  });
  installFetch(t, async (url) => {
    assert.ok(String(url).endsWith('/user'));
    return responseJson(canonicalAdmin);
  });

  const response = await adminRepositories.handler(eventFor(), contextFor());
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.repositories[0].tokenConfigured, true);
  assert.equal(payload.repositories[0].tokenEnv, 'GITHUB_CONTENT_TOKEN');
  assert.doesNotMatch(response.body, /super_secret|netlify-api-token/);
});

test('Gitea admin metadata, connection test and save use Gitea ENV without returning secrets', async (t) => {
  installEnvironment(t, { git: {
    GIT_PROVIDER: 'gitea', GITEA_BASE_URL: 'https://git.example',
    GITEA_TOKEN: 'gitea_private_server_token_12345', GITEA_OWNER: 'school', GITEA_REPO: 'course'
  } });
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', ...options };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://git.example/api/v1/')) {
      assert.equal(options.headers.Authorization, 'token gitea_private_server_token_12345');
      assert.equal(options.headers['X-GitHub-Api-Version'], undefined);
      return responseJson(request.url.includes('/branches/') ? { commit: { id: 'a'.repeat(40) } } : []);
    }
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) return responseJson({ id: SITE_ID, account_id: 'account-id', plan: 'pro' });
    if (request.url.includes('/accounts/account-id/env?')) {
      if (request.method === 'GET') return responseJson([{ key: 'GITEA_TOKEN', is_secret: true }]);
      assert.equal(request.method, 'POST');
      const [variable] = JSON.parse(request.body);
      assert.equal(variable.key, 'GITEA_CONTENT_REPOSITORIES');
      assert.equal(variable.is_secret, false);
      assert.equal(JSON.parse(variable.values[0].value)[0].tokenEnv, 'GITEA_TOKEN');
      assert.doesNotMatch(variable.values[0].value, /gitea_private_server/);
      return responseJson([variable], 201);
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });
  const view = await adminRepositories.handler(eventFor(), contextFor());
  assert.equal(view.statusCode, 200);
  const metadata = JSON.parse(view.body);
  assert.equal(metadata.provider, 'gitea');
  assert.equal(metadata.tokenHelpUrl, 'https://git.example/user/settings/applications');
  assert.equal(metadata.repositories[0].tokenConfigured, true);
  assert.doesNotMatch(view.body, /gitea_private_server|netlify-api-token/);
  const repository = { id: 'default', label: 'Materiały', repository: 'school/course', ref: 'main', default: true };
  for (const action of ['test', 'save']) {
    const result = await adminRepositories.handler(eventFor({ httpMethod: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ action, ...(action === 'test' ? { repository } : { repositories: [repository] }) }) }), contextFor());
    assert.equal(result.statusCode, 200, result.body);
    assert.doesNotMatch(result.body, /gitea_private_server|netlify-api-token/);
  }
  assert.equal(requests.filter((request) => request.url.startsWith('https://api.github.com')).length, 0);
  assert.ok(requests.some((request) => request.url.includes('/env?') && request.method === 'POST'));
});

test('invalid Gitea ENV returns a safe admin JSON error rather than an unhandled exception', async (t) => {
  installEnvironment(t, { git: { GIT_PROVIDER: 'gitea', GITEA_BASE_URL: 'https://secret@git.example' } });
  installFetch(t, async () => responseJson(canonicalAdmin));
  const response = await adminRepositories.handler(eventFor(), contextFor());
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: 'INVALID_GITEA_URL' });
});

test('save-and-deploy tests GitHub, writes scoped Netlify variables and queues a build', async (t) => {
  installEnvironment(t);
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', headers: options.headers || {}, body: options.body || '' };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) return responseJson([]);
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({ id: SITE_ID, account_id: 'account-id', name: 'chemdisk', plan: 'pro', admin_url: 'https://app.netlify.com/projects/chemdisk', build_settings: { stop_builds: false } });
    }
    if (request.method === 'GET' && request.url.includes('/accounts/account-id/env?')) return responseJson([]);
    if (request.method === 'POST' && request.url.includes('/accounts/account-id/env?')) {
      const variables = JSON.parse(request.body);
      assert.ok(Array.isArray(variables), 'Netlify createEnvVars requires an array request body');
      assert.ok(variables.length >= 1);
      return responseJson(variables, 201);
    }
    if (request.method === 'POST' && request.url.startsWith(`https://api.netlify.com/api/v1/sites/${SITE_ID}/builds?`)) {
      return responseJson({ id: 'build-id', deploy_id: 'deploy-id' });
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });

  const repositories = [
    { id: 'glowne', label: 'Materiały główne', repository: 'owner/main-materials', ref: 'main', root: '', default: true, secret: 'github_pat_main_secret_123456789' },
    { id: 'organiczna', label: 'Chemia organiczna', repository: 'owner/organic', ref: 'publikacja', root: 'kurs', default: false, secret: 'github_pat_organic_secret_123456' }
  ];
  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save-and-deploy', repositories })
  }), contextFor());

  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body);
  assert.equal(payload.saved, true);
  assert.deepEqual(payload.scopes, ['functions']);
  assert.equal(payload.deployment.deployId, 'deploy-id');
  assert.doesNotMatch(response.body, /github_pat_/);

  const githubRequests = requests.filter((request) => request.url.startsWith('https://api.github.com/'));
  assert.equal(githubRequests.length, 4);
  const organicBranchRequest = githubRequests.find((request) => /owner\/organic\/branches\/publikacja/.test(request.url));
  const organicContentsRequest = githubRequests.find((request) => /owner\/organic\/contents\/kurs\?ref=publikacja/.test(request.url));
  assert.ok(organicBranchRequest);
  assert.ok(organicContentsRequest);
  assert.equal(organicBranchRequest.headers.Authorization, 'Bearer github_pat_organic_secret_123456');
  assert.equal(organicContentsRequest.headers.Authorization, 'Bearer github_pat_organic_secret_123456');

  const environmentWrites = requests.filter((request) => request.url.includes('/accounts/account-id/env?') && request.method === 'POST');
  assert.equal(environmentWrites.length, 2);
  const batches = environmentWrites.map((request) => JSON.parse(request.body));
  assert.ok(batches.every((body) => Array.isArray(body) && body.length >= 1));
  assert.match(batches[0][0].key, /^GITHUB_CONTENT_TOKEN_R_[A-F0-9]{12}$/);
  assert.match(batches[0][1].key, /^GITHUB_CONTENT_TOKEN_ORGANICZNA_R_[A-F0-9]{12}$/);
  assert.ok(batches[0].every((body) => body.is_secret === true));
  assert.equal(batches[1].length, 1);
  assert.equal(batches[1][0].key, 'GITHUB_CONTENT_REPOSITORIES');
  assert.equal(batches[1][0].is_secret, false);
  assert.ok(batches.flat().every((body) => body.scopes.length === 1 && body.scopes[0] === 'functions'));
  assert.ok(batches.flat().every((body) => body.values[0].context === 'production'));
  const savedRepositories = JSON.parse(batches[1][0].values[0].value);
  assert.deepEqual(savedRepositories.map((repository) => repository.tokenEnv), batches[0].map((body) => body.key));
});

test('save rejects missing default and performs no external mutation', async (t) => {
  installEnvironment(t);
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    return responseJson(canonicalAdmin);
  });
  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save', repositories: [
      { id: 'a', label: 'A', repository: 'owner/a', ref: 'main', root: '', default: false, secret: 'github_pat_secret_long_enough_123' },
      { id: 'b', label: 'B', repository: 'owner/b', ref: 'main', root: '', default: false, secret: 'github_pat_secret_long_enough_456' }
    ] })
  }), contextFor());
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'CONTENT_REPOSITORY_DEFAULT_REQUIRED' });
  assert.equal(requests.length, 1, 'only canonical Identity verification should run');
});

test('token names are deterministic and validation rejects duplicate IDs', (t) => {
  installEnvironment(t);
  assert.equal(adminRepositories._test.tokenEnvironmentForId('chemia-organiczna'), 'GITHUB_CONTENT_TOKEN_CHEMIA_ORGANICZNA');
  assert.throws(() => adminRepositories._test.validateRepositorySet([
    { id: 'chemia', tokenEnv: 'GITHUB_CONTENT_TOKEN', default: true },
    { id: 'chemia', tokenEnv: 'GITHUB_CONTENT_TOKEN_INNE', default: false }
  ]), (error) => error.code === 'INVALID_CONTENT_REPOSITORIES');
  assert.throws(() => adminRepositories._test.validateRepositorySet([
    { id: 'default', tokenEnv: 'GITHUB_CONTENT_TOKEN', default: false },
    { id: 'nowe', tokenEnv: 'GITHUB_CONTENT_TOKEN_NOWE', default: true }
  ]), (error) => error.code === 'CONTENT_REPOSITORY_DEFAULT_ID_RESERVED');
  assert.equal(adminRepositories._test.supportsGranularScopes({ plan: 'free' }), false);
  assert.equal(adminRepositories._test.supportsGranularScopes({ plan: 'starter' }), false);
  assert.equal(adminRepositories._test.supportsGranularScopes({ plan: 'personal' }), false);
  assert.equal(adminRepositories._test.supportsGranularScopes({ plan: 'pro-v4' }), true);
  assert.equal(adminRepositories._test.supportsGranularScopes({}), false);
});

test('existing shared token is preserved without rewriting its secret and Netlify PUT uses an object', async (t) => {
  const sharedToken = 'github_pat_existing_shared_secret_123456789';
  installEnvironment(t, {
    github: {
      GITHUB_CONTENT_TOKEN: sharedToken,
      GITHUB_CONTENT_REPOSITORIES: JSON.stringify([
        {
          id: 'glowne', label: 'Główne', repository: 'owner/main-materials', ref: 'main',
          root: '', tokenEnv: 'GITHUB_CONTENT_TOKEN', default: true
        },
        {
          id: 'organiczna', label: 'Organiczna', repository: 'owner/organic', ref: 'main',
          root: '', tokenEnv: 'GITHUB_CONTENT_TOKEN', default: false
        }
      ])
    }
  });
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', headers: options.headers || {}, body: options.body || '' };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) {
      assert.equal(request.headers.Authorization, `Bearer ${sharedToken}`);
      return responseJson([]);
    }
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({
        id: SITE_ID,
        account_id: 'account-id',
        name: 'chemdisk',
        plan: 'pro',
        admin_url: 'https://app.netlify.com/projects/chemdisk',
        build_settings: { stop_builds: false }
      });
    }
    if (request.method === 'GET' && request.url.includes('/accounts/account-id/env?')) {
      return responseJson([
        { key: 'GITHUB_CONTENT_TOKEN', is_secret: true, values: [{ value: '***', context: 'all' }] },
        { key: 'GITHUB_CONTENT_REPOSITORIES', is_secret: false }
      ]);
    }
    if (request.method === 'PUT' && request.url.includes('/accounts/account-id/env/GITHUB_CONTENT_REPOSITORIES?')) {
      const variable = JSON.parse(request.body);
      assert.equal(Array.isArray(variable), false, 'Netlify updateEnvVar requires an object request body');
      return responseJson(variable);
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify({
      action: 'save',
      repositories: [
        { id: 'glowne', label: 'Główne', repository: 'owner/main-materials', ref: 'main', root: '', default: true, secret: '' },
        { id: 'organiczna', label: 'Organiczna', repository: 'owner/organic', ref: 'main', root: '', default: false, secret: '' }
      ]
    })
  }), contextFor());

  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body);
  assert.equal(payload.saved, true);
  assert.equal(payload.repositories[0].tokenConfigured, true);
  assert.equal(payload.repositories[1].tokenConfigured, true);
  const secretWrites = requests.filter((request) => (
    request.method === 'PUT' && /\/env\/GITHUB_CONTENT_TOKEN\?/.test(request.url)
  ));
  assert.equal(secretWrites.length, 0, 'a blank secret must preserve the existing Netlify value and contexts');
  const configurationWrite = requests.find((request) => (
    request.method === 'PUT' && request.url.includes('/env/GITHUB_CONTENT_REPOSITORIES?')
  ));
  assert.ok(configurationWrite);
  const savedRepositories = JSON.parse(JSON.parse(configurationWrite.body).values[0].value);
  assert.deepEqual(savedRepositories.map((repository) => repository.tokenEnv), [
    'GITHUB_CONTENT_TOKEN',
    'GITHUB_CONTENT_TOKEN'
  ]);
});

test('rotating an existing PAT stages a versioned secret before switching the repository list', async (t) => {
  const oldToken = 'github_pat_existing_rotation_secret_123456789';
  const newToken = 'github_pat_replacement_rotation_secret_987654321';
  installEnvironment(t, {
    github: {
      GITHUB_CONTENT_TOKEN: oldToken,
      GITHUB_CONTENT_REPOSITORIES: JSON.stringify([{
        id: 'default', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '',
        tokenEnv: 'GITHUB_CONTENT_TOKEN', default: true
      }])
    }
  });
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = {
      url: String(url), method: options.method || 'GET', body: options.body || '', headers: options.headers || {}
    };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) {
      assert.equal(request.headers.Authorization, `Bearer ${newToken}`);
      return responseJson([]);
    }
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({ id: SITE_ID, account_id: 'account-id', name: 'chemdisk', plan: 'pro', build_settings: {} });
    }
    if (request.method === 'GET' && request.url.includes('/accounts/account-id/env?')) {
      return responseJson([{ key: 'GITHUB_CONTENT_TOKEN' }, { key: 'GITHUB_CONTENT_REPOSITORIES' }]);
    }
    if (request.method === 'POST' && request.url.includes('/accounts/account-id/env?')) return responseJson([], 201);
    if (request.method === 'PUT' && request.url.includes('/env/GITHUB_CONTENT_REPOSITORIES?')) {
      return responseJson({ message: 'write failed' }, 500);
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save', repositories: [{
      id: 'default', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '',
      default: true, secret: newToken
    }] })
  }), contextFor());

  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'NETLIFY_CONTENT_CONFIG_WRITE_FAILED' });
  assert.equal(requests.some((request) => request.method === 'PUT' && /\/env\/GITHUB_CONTENT_TOKEN\?/.test(request.url)), false);
  const secretCreate = requests.find((request) => request.method === 'POST' && request.url.includes('/accounts/account-id/env?'));
  const [secretVariable] = JSON.parse(secretCreate.body);
  assert.match(secretVariable.key, /^GITHUB_CONTENT_TOKEN_R_[A-F0-9]{12}$/);
  assert.equal(secretVariable.values[0].value, newToken);
  const configWrite = requests.find((request) => request.method === 'PUT' && request.url.includes('/env/GITHUB_CONTENT_REPOSITORIES?'));
  const [savedRepository] = JSON.parse(JSON.parse(configWrite.body).values[0].value);
  assert.equal(savedRepository.tokenEnv, secretVariable.key);
});

test('deploy previews cannot test, save or deploy production repository settings', async (t) => {
  installEnvironment(t, { context: 'deploy-preview' });
  installFetch(t, async () => {
    throw new Error('a deploy-preview mutation must be rejected before external access');
  });

  const repository = {
    id: 'glowne', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '',
    default: true, secret: 'github_pat_preview_secret_123456789'
  };
  const bodies = [
    { action: 'test', repository },
    { action: 'save', repositories: [repository] },
    { action: 'deploy' }
  ];
  for (const body of bodies) {
    const response = await adminRepositories.handler(eventFor({
      httpMethod: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body)
    }), contextFor());
    assert.equal(response.statusCode, 409);
    assert.deepEqual(JSON.parse(response.body), { error: 'CONTENT_REPOSITORY_PRODUCTION_REQUIRED' });
  }
});

test('GitHub repository test rejects a file as root and malformed successful responses', async (t) => {
  installEnvironment(t);
  const repository = {
    id: 'glowne', label: 'Główne', repository: 'owner/materials', ref: 'main', root: 'course',
    default: true, secret: 'github_pat_root_check_secret_123456'
  };
  let githubResponse = responseJson({ type: 'file', name: 'course' });
  installFetch(t, async (url) => {
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    if (String(url).startsWith('https://api.github.com/')) return githubResponse;
    throw new Error(`Unexpected request ${url}`);
  });

  const fileResponse = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'test', repository })
  }), contextFor());
  assert.equal(fileResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(fileResponse.body), { error: 'CONTENT_REPOSITORY_ROOT_NOT_DIRECTORY' });

  githubResponse = new Response('{not-json', {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  const malformedResponse = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'test', repository })
  }), contextFor());
  assert.equal(malformedResponse.statusCode, 502);
  assert.deepEqual(JSON.parse(malformedResponse.body), { error: 'CONTENT_REPOSITORY_INVALID_RESPONSE' });
});

test('GitHub repository test rejects a missing branch before accepting its root', async (t) => {
  installEnvironment(t);
  installFetch(t, async (url) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith('/user')) return responseJson(canonicalAdmin);
    if (requestUrl.includes('/branches/brak-galezi')) return responseJson({ message: 'Not Found' }, 404);
    if (requestUrl.startsWith('https://api.github.com/')) return responseJson([]);
    throw new Error(`Unexpected request ${url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'test', repository: {
      id: 'glowne', label: 'Główne', repository: 'owner/materials', ref: 'brak-galezi', root: '',
      default: true, secret: 'github_pat_missing_branch_secret_123456'
    } })
  }), contextFor());

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'CONTENT_REPOSITORY_BRANCH_NOT_FOUND' });
});

test('test and save choose the same base token for the first default repository', async (t) => {
  const token = 'github_pat_invalid_config_recovery_123456789';
  installEnvironment(t, {
    github: {
      GITHUB_CONTENT_TOKEN: token,
      GITHUB_CONTENT_REPOSITORIES: '{invalid-json'
    }
  });
  installFetch(t, async (url, options = {}) => {
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    if (String(url).startsWith('https://api.github.com/')) {
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      return responseJson([]);
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'test', repository: {
      id: 'default', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '',
      default: true, secret: ''
    } })
  }), contextFor());

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(JSON.parse(response.body).repository.tokenEnv, 'GITHUB_CONTENT_TOKEN');
});

test('repository configuration exceeding the Netlify ENV limit is rejected before external repository or Netlify calls', async (t) => {
  installEnvironment(t);
  const requests = [];
  installFetch(t, async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('/user')) return responseJson(canonicalAdmin);
    throw new Error(`Unexpected request ${url}`);
  });
  const root = `${'folder/'.repeat(42)}end`;
  const repositories = Array.from({ length: 20 }, (_, index) => ({
    id: `repo-${index + 1}`,
    label: `Repozytorium ${index + 1} ${'x'.repeat(55)}`,
    repository: `owner${index + 1}/${'r'.repeat(100)}`,
    ref: 'r'.repeat(199),
    root,
    default: index === 0,
    secret: `github_pat_repository_secret_${String(index + 1).padStart(2, '0')}_123456789`
  }));
  const body = JSON.stringify({ action: 'save', repositories });
  const projectedConfiguration = repositories.map((repository, index) => ({
    id: repository.id,
    label: repository.label,
    repository: repository.repository,
    ref: repository.ref,
    root: repository.root,
    tokenEnv: index === 0 ? 'GITHUB_CONTENT_TOKEN' : `GITHUB_CONTENT_TOKEN_REPO_${index + 1}`,
    default: repository.default
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(projectedConfiguration), 'utf8') > 5_000);
  assert.ok(Buffer.byteLength(body, 'utf8') < 32_768, 'the request itself must stay below the Function body limit');

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(), body
  }), contextFor());

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'CONTENT_REPOSITORIES_ENV_TOO_LARGE' });
  assert.equal(requests.length, 1, 'only canonical Identity verification may run before size rejection');
});

test('save-and-deploy checks stopped builds before writing any Netlify environment variable', async (t) => {
  installEnvironment(t);
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET' };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) return responseJson([]);
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({
        id: SITE_ID,
        account_id: 'account-id',
        name: 'chemdisk',
        plan: 'pro',
        build_settings: { stop_builds: true }
      });
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save-and-deploy', repositories: [{
      id: 'glowne', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '', default: true,
      secret: 'github_pat_stopped_build_secret_123456'
    }] })
  }), contextFor());

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: 'NETLIFY_BUILDS_STOPPED' });
  assert.equal(requests.some((request) => request.url.includes('/accounts/account-id/env')), false);
  assert.equal(requests.some((request) => request.url.includes(`/sites/${SITE_ID}/builds`)), false);
});

test('save-and-deploy reports saved ENV when Netlify cannot queue the build', async (t) => {
  installEnvironment(t);
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', body: options.body || '' };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) return responseJson([]);
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({
        id: SITE_ID,
        account_id: 'account-id',
        name: 'chemdisk',
        plan: 'pro',
        build_settings: { stop_builds: false }
      });
    }
    if (request.method === 'GET' && request.url.includes('/accounts/account-id/env?')) return responseJson([]);
    if (request.method === 'POST' && request.url.includes('/accounts/account-id/env?')) return responseJson([], 201);
    if (request.method === 'POST' && request.url.startsWith(`https://api.netlify.com/api/v1/sites/${SITE_ID}/builds?`)) {
      return responseJson({ message: 'build unavailable' }, 503);
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save-and-deploy', repositories: [{
      id: 'default', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '', default: true,
      secret: 'github_pat_build_failure_secret_123456'
    }] })
  }), contextFor());

  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body);
  assert.equal(payload.saved, true);
  assert.equal(payload.requiresDeploy, true);
  assert.deepEqual(payload.scopes, ['functions']);
  assert.equal(payload.deploymentError, 'NETLIFY_DEPLOY_START_FAILED');
  const { tokenEnv, ...visibleRepository } = payload.repositories[0];
  assert.deepEqual(visibleRepository, {
    id: 'default', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '', default: true,
    tokenConfigured: true
  });
  assert.match(tokenEnv, /^GITHUB_CONTENT_TOKEN_R_[A-F0-9]{12}$/);
  assert.equal(requests.filter((request) => request.url.includes('/accounts/account-id/env?') && request.method === 'POST').length, 2);
});

test('a newer ENV configuration waiting for deploy blocks a stale Function instance', async (t) => {
  const token = 'github_pat_pending_deploy_secret_123456789';
  const deployedConfiguration = JSON.stringify([{
    id: 'default', label: 'Wersja wdrożona', repository: 'owner/materials', ref: 'main', root: '',
    tokenEnv: 'GITHUB_CONTENT_TOKEN', default: true
  }]);
  const pendingConfiguration = JSON.stringify([{
    id: 'default', label: 'Wersja oczekująca', repository: 'owner/materials', ref: 'main', root: '',
    tokenEnv: 'GITHUB_CONTENT_TOKEN', default: true
  }]);
  installEnvironment(t, {
    github: {
      GITHUB_CONTENT_TOKEN: token,
      GITHUB_CONTENT_REPOSITORIES: deployedConfiguration
    }
  });
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', body: options.body || '' };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) return responseJson([]);
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({ id: SITE_ID, account_id: 'account-id', name: 'chemdisk', plan: 'pro', build_settings: {} });
    }
    if (request.method === 'GET' && request.url.includes('/accounts/account-id/env?')) {
      return responseJson([
        { key: 'GITHUB_CONTENT_TOKEN' },
        { key: 'GITHUB_CONTENT_REPOSITORIES', values: [{ context: 'production', value: pendingConfiguration }] }
      ]);
    }
    throw new Error(`Unexpected mutation ${request.method} ${request.url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save', repositories: [{
      id: 'default', label: 'Jeszcze nowsza', repository: 'owner/materials', ref: 'main', root: '',
      default: true, secret: ''
    }] })
  }), contextFor());

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: 'CONTENT_REPOSITORY_CONFIG_PENDING_DEPLOY' });
  assert.equal(requests.some((request) => ['POST', 'PUT'].includes(request.method) && request.url.includes('/env')), false);
});

test('personal plan omits granular scopes from Netlify create requests', async (t) => {
  installEnvironment(t);
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', body: options.body || '' };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) return responseJson([]);
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({
        id: SITE_ID,
        account_id: 'account-id',
        name: 'chemdisk',
        plan: 'personal',
        build_settings: { stop_builds: false }
      });
    }
    if (request.method === 'GET' && request.url.includes('/accounts/account-id/env?')) return responseJson([]);
    if (request.method === 'POST' && request.url.includes('/accounts/account-id/env?')) {
      const variables = JSON.parse(request.body);
      assert.ok(Array.isArray(variables));
      assert.ok(variables.every((variable) => !Object.hasOwn(variable, 'scopes')));
      return responseJson(variables, 201);
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save', repositories: [{
      id: 'glowne', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '', default: true,
      secret: 'github_pat_personal_plan_secret_123456'
    }] })
  }), contextFor());

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(JSON.parse(response.body).scopes, ['all']);
  const writes = requests.filter((request) => request.method === 'POST' && request.url.includes('/accounts/account-id/env?'));
  assert.equal(writes.length, 2);
});

test('Free plan never falls back to storing a newly supplied PAT as a regular variable', async (t) => {
  installEnvironment(t);
  const writes = [];
  installFetch(t, async (url, options = {}) => {
    const requestUrl = String(url);
    const method = options.method || 'GET';
    if (requestUrl.endsWith('/user')) return responseJson(canonicalAdmin);
    if (requestUrl.startsWith('https://api.github.com/')) return responseJson([]);
    if (requestUrl === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({ id: SITE_ID, account_id: 'account-id', name: 'chemdisk', plan: 'free', build_settings: {} });
    }
    if (method === 'GET' && requestUrl.includes('/accounts/account-id/env?')) return responseJson([]);
    if (method === 'POST' && requestUrl.includes('/accounts/account-id/env?')) {
      writes.push(JSON.parse(options.body));
      return responseJson({ message: 'Secrets Controller is unavailable' }, 422);
    }
    throw new Error(`Unexpected request ${method} ${requestUrl}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save', repositories: [{
      id: 'default', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '', default: true,
      secret: 'github_pat_free_plan_secret_123456789'
    }] })
  }), contextFor());

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: 'NETLIFY_SECRETS_CONTROLLER_REQUIRED' });
  assert.equal(writes.length, 1);
  assert.ok(writes[0].every((variable) => variable.is_secret === true));
  assert.equal(writes[0].some((variable) => variable.key === 'GITHUB_CONTENT_REPOSITORIES'), false);
});

test('Free plan can update the repository list while preserving a manually created PAT', async (t) => {
  const token = 'github_pat_manually_configured_free_123456789';
  installEnvironment(t, {
    github: {
      GITHUB_CONTENT_TOKEN: token,
      GITHUB_CONTENT_REPOSITORIES: JSON.stringify([{
        id: 'default', label: 'Główne', repository: 'owner/materials', ref: 'main', root: '',
        tokenEnv: 'GITHUB_CONTENT_TOKEN', default: true
      }])
    }
  });
  const requests = [];
  installFetch(t, async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', body: options.body || '' };
    requests.push(request);
    if (request.url.endsWith('/user')) return responseJson(canonicalAdmin);
    if (request.url.startsWith('https://api.github.com/')) return responseJson([]);
    if (request.url === `https://api.netlify.com/api/v1/sites/${SITE_ID}`) {
      return responseJson({ id: SITE_ID, account_id: 'account-id', name: 'chemdisk', plan: 'free', build_settings: {} });
    }
    if (request.method === 'GET' && request.url.includes('/accounts/account-id/env?')) {
      return responseJson([{ key: 'GITHUB_CONTENT_TOKEN' }, { key: 'GITHUB_CONTENT_REPOSITORIES' }]);
    }
    if (request.method === 'PUT' && request.url.includes('/env/GITHUB_CONTENT_REPOSITORIES?')) {
      const variable = JSON.parse(request.body);
      assert.equal(variable.is_secret, false);
      assert.equal(Object.hasOwn(variable, 'scopes'), false);
      return responseJson(variable);
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  });

  const response = await adminRepositories.handler(eventFor({
    httpMethod: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ action: 'save', repositories: [{
      id: 'default', label: 'Główne po poprawce', repository: 'owner/materials', ref: 'main', root: '',
      default: true, secret: ''
    }] })
  }), contextFor());

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(requests.some((request) => /\/env\/GITHUB_CONTENT_TOKEN\?/.test(request.url)), false);
});
