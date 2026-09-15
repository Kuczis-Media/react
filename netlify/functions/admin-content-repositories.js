'use strict';

const crypto = require('node:crypto');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');
const contentRepository = require('../content-repository.js');

const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';
const git = require('../git-provider.js');
// A save can make several sequential Netlify calls. Keep every individual
// request bounded so the whole synchronous Function still has time to return
// a useful JSON error instead of being terminated at the platform limit.
const API_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 32_768;
const MAX_CONFIGURATION_BYTES = 5_000;
const MAX_REPOSITORIES = 20;
const GITHUB_TEST_CONCURRENCY = 20;
const ENV_WRITE_CONCURRENCY = 20;
const SAFE_SITE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SAFE_ROOT = /^(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SAFE_TOKEN_ENV = /^(?:GITHUB_CONTENT_TOKEN|GITHUB_TOKEN|GITEA_TOKEN)(?:_[A-Z0-9][A-Z0-9_]*)?$/;
let mutationQueue = Promise.resolve();

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'GET, POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
  }
  if (method !== 'GET' && method !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, OPTIONS' });
  }

  if (method === 'POST') {
    const guard = mutationGuard(event, { maxBodyBytes: MAX_BODY_BYTES });
    if (!guard.ok) return responseForFailure(guard);
    if (!allowsConfigurationMutation(process.env)) {
      return json({ error: 'CONTENT_REPOSITORY_PRODUCTION_REQUIRED' }, 409);
    }
  }

  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);

  if (method === 'GET') {
    try { return json(settingsView()); }
    catch (error) { return json({ error: error?.code || 'CONTENT_REPOSITORY_ADMIN_UNAVAILABLE' }, error?.status || 503); }
  }

  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);

  try {
    const result = await enqueueMutation(() => handleAction(parsed.value, auth.userId));
    return json(result);
  } catch (error) {
    console.error('admin content repositories failed', safeErrorName(error));
    return json({ error: error && error.code || 'CONTENT_REPOSITORY_ADMIN_UNAVAILABLE' }, error && error.status || 503);
  }
};

function settingsView() {
  const current = currentConfiguration();
  return {
    repositories: current.repositories.map(publicAdminRepository),
    configurationInvalid: current.invalid,
    netlifyConfigured: Boolean(netlifyConfig()),
    limits: { repositories: MAX_REPOSITORIES },
    provider: git.providerName(),
    repositoriesEnvKey: git.repositoriesEnvKey(),
    tokenEnvBase: git.tokenEnv(),
    // Public connection metadata only; never send environment or token values.
    baseUrl: git.settings().baseUrl,
    apiUrl: git.settings().apiUrl,
    tokenHelpUrl: git.providerName() === 'gitea' ? `${git.settings().baseUrl}/user/settings/applications` : 'https://github.com/settings/personal-access-tokens/new'
  };
}

async function handleAction(body, actorId) {
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'test') {
    assertOnlyFields(body, ['action', 'repository']);
    const current = currentConfiguration().repositories;
    // Use the same tokenEnv selection rule as save. This matters during
    // recovery from an invalid/empty configuration on Free, where the UI may
    // point the first default repository at GITHUB_CONTENT_TOKEN.
    const repository = normalizeRepository(body.repository, 0, current);
    const token = resolveToken(repository, body.repository, current);
    await testGitHubRepository(repository, token);
    return { test: { status: 'ok' }, repository: publicAdminRepository({ ...repository, token }) };
  }
  if (action === 'deploy') {
    assertOnlyFields(body, ['action']);
    const config = requiredNetlifyConfig();
    const site = await readNetlifySite(config);
    const deployment = await createBuild(config, site);
    console.info('Content repositories deploy started', { actorId, siteId: config.siteId, buildId: deployment.buildId });
    return { deployment };
  }
  if (action !== 'save' && action !== 'save-and-deploy') throw apiError('INVALID_CONTENT_REPOSITORY_ACTION', 400);
  assertOnlyFields(body, ['action', 'repositories']);
  const input = Array.isArray(body.repositories) ? body.repositories : null;
  if (!input || !input.length || input.length > MAX_REPOSITORIES) throw apiError('INVALID_CONTENT_REPOSITORIES', 400);

  const current = currentConfiguration().repositories;
  const repositories = input.map((entry, index) => normalizeRepository(entry, index, current));
  validateRepositorySet(repositories);
  resolveRepositoryTokens(repositories, input, current);
  const serializedConfiguration = serializeRepositoryConfiguration(repositories);
  const config = requiredNetlifyConfig();
  const [, site] = await Promise.all([
    testGitHubRepositories(repositories),
    readNetlifySite(config)
  ]);
  if (action === 'save-and-deploy' && site.buildsStopped) throw apiError('NETLIFY_BUILDS_STOPPED', 409);
  const environment = await persistEnvironment(config, site, repositories, serializedConfiguration);
  let deployment = null;
  let deploymentError = '';
  if (action === 'save-and-deploy') {
    try {
      deployment = await createBuild(config, site);
    } catch (error) {
      // ENV has already been saved at this point. Report the partial success
      // explicitly so the browser does not keep editing against the old
      // Function environment or ask the administrator to paste PATs again.
      deploymentError = clean(error && error.code) || 'NETLIFY_DEPLOY_START_FAILED';
    }
  }

  console.info('Content repositories configuration saved', {
    actorId,
    siteId: config.siteId,
    repositories: repositories.map(({ id, repository, ref, root, tokenEnv, default: isDefault }) => ({ id, repository, ref, root, tokenEnv, default: isDefault })),
    deployStarted: Boolean(deployment)
  });
  return {
    saved: true,
    requiresDeploy: !deployment,
    scopes: environment.scopes,
    repositories: repositories.map(publicAdminRepository),
    ...(deployment ? { deployment } : {}),
    ...(deploymentError ? { deploymentError } : {})
  };
}

function currentConfiguration() {
  try {
    return { repositories: contentRepository.repositoryConfigs(process.env), invalid: false };
  } catch {
    return { repositories: [], invalid: true };
  }
}

function normalizeRepository(value, index, current) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw apiError('INVALID_CONTENT_REPOSITORIES', 400);
  const allowed = new Set(['id', 'label', 'repository', 'ref', 'root', 'default', 'secret']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw apiError('UNEXPECTED_FIELDS', 400);
  const id = clean(value.id).toLowerCase();
  const label = clean(value.label);
  const repository = clean(value.repository);
  const ref = clean(value.ref) || 'main';
  const root = clean(value.root).replace(/^\/+|\/+$/g, '');
  const existing = current.find((entry) => entry.id === id);
  const tokenEnv = existing && SAFE_TOKEN_ENV.test(existing.tokenEnv || '')
    ? existing.tokenEnv
    : (value.default === true && !current.some((entry) => (
      entry.tokenEnv === git.tokenEnv() && (entry.token || entry.repository)
    ))
      ? git.tokenEnv()
      : tokenEnvironmentForId(id));
  if (
    !SAFE_REPOSITORY_ID.test(id) || !label || label.length > 80 || hasUnsafeControls(label) ||
    !isSafeRepository(repository) || !SAFE_REF.test(ref) ||
    (root && (!SAFE_ROOT.test(root) || root.length > 300)) ||
    (value.default != null && typeof value.default !== 'boolean')
  ) throw apiError('INVALID_CONTENT_REPOSITORIES', 400);
  return {
    id,
    label,
    repository,
    ref,
    root,
    default: Boolean(value.default),
    tokenEnv,
    token: existing ? clean(existing.token) : ''
  };
}

function validateRepositorySet(repositories) {
  const ids = new Set();
  let defaults = 0;
  for (const repository of repositories) {
    if (ids.has(repository.id)) throw apiError('INVALID_CONTENT_REPOSITORIES', 400);
    if (repository.id === 'default' && !repository.default) {
      throw apiError('CONTENT_REPOSITORY_DEFAULT_ID_RESERVED', 400);
    }
    ids.add(repository.id);
    if (repository.default) defaults += 1;
  }
  if (defaults !== 1) throw apiError('CONTENT_REPOSITORY_DEFAULT_REQUIRED', 400);
}

function resolveToken(repository, raw, current) {
  const secret = normalizedSecret(raw && raw.secret);
  if (secret) return secret;
  const existing = current.find((entry) => entry.id === repository.id);
  const token = clean(existing && existing.token) || clean(process.env[repository.tokenEnv]);
  if (!token) throw apiError('GITHUB_CONTENT_TOKEN_REQUIRED', 400);
  return token;
}

function resolveRepositoryTokens(repositories, rawEntries, current) {
  const groups = new Map();
  repositories.forEach((repository, index) => {
    if (!groups.has(repository.tokenEnv)) groups.set(repository.tokenEnv, []);
    groups.get(repository.tokenEnv).push(index);
  });
  for (const [tokenEnv, indexes] of groups) {
    const explicit = indexes
      .map((index) => normalizedSecret(rawEntries[index] && rawEntries[index].secret))
      .filter(Boolean);
    const distinct = [...new Set(explicit)];
    if (distinct.length > 1) throw apiError('CONTENT_REPOSITORY_SHARED_TOKEN_CONFLICT', 400);
    let token = distinct[0] || '';
    if (!token) {
      const existing = current.find((entry) => entry.tokenEnv === tokenEnv && clean(entry.token));
      token = clean(existing && existing.token) || clean(process.env[tokenEnv]);
    }
    if (!token) throw apiError('GITHUB_CONTENT_TOKEN_REQUIRED', 400);
    // Every PAT supplied through the panel is staged under a fresh key. This
    // keeps first-time concurrent saves as safe as rotations: whichever
    // repository list wins can only reference the token created by that same
    // request. Blank/manual Free flows retain their deterministic key.
    const resolvedTokenEnv = distinct[0]
      ? rotatedTokenEnvironment(tokenEnv)
      : tokenEnv;
    indexes.forEach((index) => {
      repositories[index].token = token;
      repositories[index].tokenSupplied = Boolean(distinct[0]);
      repositories[index].tokenEnv = resolvedTokenEnv;
    });
  }
}

function rotatedTokenEnvironment(tokenEnv) {
  const base = String(tokenEnv || '').replace(/_R_[A-F0-9]{12}$/, '');
  const value = `${base}_R_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  if (!SAFE_TOKEN_ENV.test(value)) throw apiError('INVALID_CONTENT_REPOSITORIES', 400);
  return value;
}

function normalizedSecret(value) {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (secret && (secret.length < 20 || secret.length > 500 || /[\s\u0000-\u001f\u007f]/.test(secret))) {
    throw apiError('INVALID_GITHUB_CONTENT_TOKEN', 400);
  }
  return secret;
}

function tokenEnvironmentForId(id) {
  const suffix = String(id || '').toUpperCase().replace(/-/g, '_');
  const value = `${git.tokenEnv()}_${suffix}`;
  if (!SAFE_TOKEN_ENV.test(value)) throw apiError('INVALID_CONTENT_REPOSITORIES', 400);
  return value;
}

async function testGitHubRepository(repository, token) {
  const config = { ...repository, ...git.settings(), token };
  const [branchResponse, response] = await Promise.all([
    git.request(config, git.apiUrl(config, repository.ref, false, 'branches')),
    git.request(config, git.apiUrl(config, repository.root))
  ]);
  git.assertGiteaAccess(config, branchResponse);
  git.assertGiteaAccess(config, response);
  assertGitHubAccessResponse(branchResponse, 'CONTENT_REPOSITORY_BRANCH_NOT_FOUND');
  assertGitHubAccessResponse(response, 'CONTENT_REPOSITORY_NOT_FOUND');
  let contents;
  try {
    contents = await response.json();
  } catch {
    throw apiError('CONTENT_REPOSITORY_INVALID_RESPONSE', 502);
  }
  if (!Array.isArray(contents)) throw apiError('CONTENT_REPOSITORY_ROOT_NOT_DIRECTORY', 400);
}

function assertGitHubAccessResponse(response, notFoundCode) {
  if (response.status === 429 || (response.status === 403 && response.headers && response.headers.get('x-ratelimit-remaining') === '0')) {
    throw apiError('GITHUB_CONTENT_RATE_LIMITED', 429);
  }
  if (response.status === 401 || response.status === 403) throw apiError('GITHUB_CONTENT_TOKEN_REJECTED', 400);
  if (response.status === 404) throw apiError(notFoundCode, 404);
  if (!response.ok) throw apiError('CONTENT_REPOSITORY_UNAVAILABLE', 502);
}

async function testGitHubRepositories(repositories) {
  for (let offset = 0; offset < repositories.length; offset += GITHUB_TEST_CONCURRENCY) {
    await Promise.all(repositories.slice(offset, offset + GITHUB_TEST_CONCURRENCY).map((repository) => (
      testGitHubRepository(repository, repository.token)
    )));
  }
}

function netlifyConfig() {
  const token = clean(process.env.NETLIFY_API_TOKEN);
  const siteId = clean(process.env.SITE_ID);
  if (token.length < 16 || token.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(token) || !SAFE_SITE_ID.test(siteId)) return null;
  return { token, siteId };
}

function requiredNetlifyConfig() {
  const config = netlifyConfig();
  if (!config) throw apiError('NETLIFY_CONTENT_CONFIG_NOT_CONFIGURED', 503);
  return config;
}

async function readNetlifySite(config) {
  const response = await netlifyRequest(`/sites/${encodeURIComponent(config.siteId)}`, config);
  if (response.status === 401 || response.status === 403) throw apiError('NETLIFY_CONTENT_CONFIG_TOKEN_REJECTED', 503);
  if (response.status === 404) throw apiError('NETLIFY_CONTENT_CONFIG_SITE_NOT_FOUND', 404);
  if (!response.ok) throw apiError('NETLIFY_CONTENT_CONFIG_UNAVAILABLE', 502);
  const site = await readJson(response);
  const accountId = clean(site && (site.account_id || site.account_slug));
  if (!site || clean(site.id) !== config.siteId || !accountId || accountId.length > 200) {
    throw apiError('NETLIFY_CONTENT_CONFIG_RESPONSE_INVALID', 502);
  }
  return {
    accountId,
    name: clean(site.name).slice(0, 200),
    adminUrl: safeHttpsUrl(site.admin_url),
    buildsStopped: Boolean(site.build_settings && site.build_settings.stop_builds),
    granularScopes: supportsGranularScopes(site)
  };
}

async function persistEnvironment(config, site, repositories, serializedConfiguration) {
  const listResponse = await netlifyRequest(
    `/accounts/${encodeURIComponent(site.accountId)}/env`,
    config,
    { query: { site_id: config.siteId } }
  );
  if (listResponse.status === 401 || listResponse.status === 403) throw apiError('NETLIFY_CONTENT_CONFIG_TOKEN_REJECTED', 503);
  if (!listResponse.ok) throw apiError('NETLIFY_CONTENT_CONFIG_UNAVAILABLE', 502);
  const variables = await readJson(listResponse);
  if (!Array.isArray(variables)) throw apiError('NETLIFY_CONTENT_CONFIG_RESPONSE_INVALID', 502);
  assertNoPendingRepositoryConfiguration(variables);
  const existingKeys = new Set(variables.map((entry) => clean(entry && entry.key)).filter(Boolean));

  // Write secrets first. If the final repository list fails, unused secret
  // variables remain harmless and the active configuration stays unchanged.
  const tokenValues = new Map();
  for (const repository of repositories) {
    const current = tokenValues.get(repository.tokenEnv) || {
      token: repository.token,
      supplied: false
    };
    current.supplied = current.supplied || Boolean(repository.tokenSupplied);
    tokenValues.set(repository.tokenEnv, current);
  }
  await writeTokenEnvironmentVariables(config, site, existingKeys, tokenValues);
  await upsertEnvironmentVariable(
    config,
    site,
    existingKeys,
    git.repositoriesEnvKey(),
    serializedConfiguration,
    false
  );
  return { scopes: site.granularScopes ? ['functions'] : ['all'] };
}

async function writeTokenEnvironmentVariables(config, site, existingKeys, tokenValues) {
  const missing = [];
  const updates = [];
  for (const [key, tokenState] of tokenValues) {
    if (existingKeys.has(key)) {
      if (tokenState.supplied) updates.push({ key, value: tokenState.token });
    } else {
      missing.push({ key, value: tokenState.token });
    }
  }

  if (missing.length) {
    const path = `/accounts/${encodeURIComponent(site.accountId)}/env`;
    const response = await netlifyRequest(path, config, {
      method: 'POST',
      query: { site_id: config.siteId },
      body: missing.map(({ key, value }) => environmentVariableBody(site, key, value, true))
    });
    if (response.status === 409) {
      // A different Function instance may have created one of the keys after
      // our initial list request. Retry each key through the idempotent upsert
      // path, which converts an individual create conflict into PUT.
      await runInBatches(missing, ENV_WRITE_CONCURRENCY, ({ key, value }) => (
        upsertEnvironmentVariable(config, site, existingKeys, key, value, true)
      ));
    } else {
      assertEnvironmentWriteResponse(response, true);
      missing.forEach(({ key }) => existingKeys.add(key));
    }
  }

  await runInBatches(updates, ENV_WRITE_CONCURRENCY, ({ key, value }) => (
    upsertEnvironmentVariable(config, site, existingKeys, key, value, true)
  ));
}

async function upsertEnvironmentVariable(config, site, existingKeys, key, value, secret) {
  const body = environmentVariableBody(site, key, value, secret);
  const exists = existingKeys.has(key);
  const path = exists
    ? `/accounts/${encodeURIComponent(site.accountId)}/env/${encodeURIComponent(key)}`
    : `/accounts/${encodeURIComponent(site.accountId)}/env`;
  let response = await netlifyRequest(path, config, {
    method: exists ? 'PUT' : 'POST',
    query: { site_id: config.siteId },
    body: exists ? body : [body]
  });
  if (!exists && response.status === 409) {
    response = await netlifyRequest(
      `/accounts/${encodeURIComponent(site.accountId)}/env/${encodeURIComponent(key)}`,
      config,
      {
        method: 'PUT',
        query: { site_id: config.siteId },
        body
      }
    );
  }
  assertEnvironmentWriteResponse(response, secret);
  existingKeys.add(key);
}

function environmentVariableBody(site, key, value, secret) {
  return {
    key,
    // Repository credentials configure the published course. Keeping them in
    // production prevents Deploy Previews and branch deploys from inheriting
    // private GitHub access automatically; local development uses its own env.
    values: [{ value, context: 'production' }],
    is_secret: Boolean(secret),
    ...(site.granularScopes ? { scopes: ['functions'] } : {})
  };
}

function assertNoPendingRepositoryConfiguration(variables) {
  const entry = variables.find((variable) => clean(variable && variable.key) === git.repositoriesEnvKey());
  const deployed = clean(process.env[git.repositoriesEnvKey()]);
  if (!entry) {
    if (deployed) throw apiError('CONTENT_REPOSITORY_CONFIG_PENDING_DEPLOY', 409);
    return;
  }
  const values = Array.isArray(entry.values) ? entry.values : [];
  const selected = values.find((value) => clean(value && value.context) === 'production')
    || values.find((value) => clean(value && value.context) === 'all');
  if (!selected || typeof selected.value !== 'string') return;
  if (canonicalConfigurationValue(selected.value) !== canonicalConfigurationValue(deployed)) {
    throw apiError('CONTENT_REPOSITORY_CONFIG_PENDING_DEPLOY', 409);
  }
}

function canonicalConfigurationValue(value) {
  const source = clean(value);
  if (!source) return '';
  try { return JSON.stringify(JSON.parse(source)); }
  catch { return source; }
}

function assertEnvironmentWriteResponse(response, secret) {
  if (response.status === 401 || response.status === 403) throw apiError('NETLIFY_CONTENT_CONFIG_TOKEN_REJECTED', 503);
  if (secret && !response.ok) {
    if ([400, 402, 422].includes(response.status)) throw apiError('NETLIFY_SECRETS_CONTROLLER_REQUIRED', 409);
    throw apiError('NETLIFY_CONTENT_SECRET_WRITE_FAILED', 502);
  }
  if (!response.ok) throw apiError('NETLIFY_CONTENT_CONFIG_WRITE_FAILED', 502);
}

async function createBuild(config, site) {
  if (site.buildsStopped) throw apiError('NETLIFY_BUILDS_STOPPED', 409);
  const response = await netlifyRequest(`/sites/${encodeURIComponent(config.siteId)}/builds`, config, {
    method: 'POST',
    query: { title: 'Publikacja konfiguracji repozytoriów ChemDisk' }
  });
  if (response.status === 401 || response.status === 403) throw apiError('NETLIFY_CONTENT_CONFIG_TOKEN_REJECTED', 503);
  if (response.status === 404) throw apiError('NETLIFY_CONTENT_CONFIG_SITE_NOT_FOUND', 404);
  if (!response.ok) throw apiError('NETLIFY_DEPLOY_START_FAILED', 502);
  const build = await readJson(response);
  const buildId = clean(build && build.id).slice(0, 200);
  const deployId = clean(build && (build.deploy_id || build.deployId)).slice(0, 200);
  if (!SAFE_SITE_ID.test(buildId) || (deployId && !SAFE_SITE_ID.test(deployId)) || clean(build && build.error)) {
    throw apiError('NETLIFY_CONTENT_CONFIG_RESPONSE_INVALID', 502);
  }
  return {
    started: true,
    buildId,
    deployId,
    adminUrl: site.adminUrl ? `${site.adminUrl.replace(/\/$/, '')}/deploys${deployId ? `/${encodeURIComponent(deployId)}` : ''}` : ''
  };
}

async function netlifyRequest(path, config, options = {}) {
  const url = new URL(`${NETLIFY_API_BASE}${path}`);
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, String(value));
  return request(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}

async function request(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function publicAdminRepository(repository) {
  return {
    id: repository.id,
    label: repository.label,
    repository: repository.repository,
    ref: repository.ref,
    root: repository.root,
    default: Boolean(repository.default),
    tokenConfigured: Boolean(repository.token),
    tokenEnv: SAFE_TOKEN_ENV.test(repository.tokenEnv || '') ? repository.tokenEnv : ''
  };
}

function assertOnlyFields(value, allowed) {
  const set = new Set(allowed);
  if (!value || Object.keys(value).some((key) => !set.has(key))) throw apiError('UNEXPECTED_FIELDS', 400);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : '';
  } catch { return ''; }
}

function supportsGranularScopes(site) {
  const plan = clean(site && site.plan).toLowerCase();
  return /(?:^|[-_\s])(?:pro|business|enterprise)(?:[-_\s]|$)/.test(plan);
}

function serializeRepositoryConfiguration(repositories) {
  const configuration = repositories.map((repository) => ({
    id: repository.id,
    label: repository.label,
    repository: repository.repository,
    ref: repository.ref,
    root: repository.root,
    tokenEnv: repository.tokenEnv,
    default: repository.default
  }));
  const serialized = JSON.stringify(configuration);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONFIGURATION_BYTES) {
    throw apiError('CONTENT_REPOSITORIES_ENV_TOO_LARGE', 400);
  }
  return serialized;
}

async function runInBatches(values, limit, operation) {
  for (let offset = 0; offset < values.length; offset += limit) {
    await Promise.all(values.slice(offset, offset + limit).map(operation));
  }
}

function allowsConfigurationMutation(env) {
  const context = clean(env && env.CONTEXT).toLowerCase();
  return !context || context === 'production' || context === 'dev';
}

function hasUnsafeControls(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value || ''));
}

function isSafeRepository(value) {
  if (!SAFE_REPOSITORY.test(value) || value.length > 140) return false;
  const [owner, name] = value.split('/');
  return owner.length <= 39 && name.length <= 100 && owner !== '.' && owner !== '..' && name !== '.' && name !== '..';
}

function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
async function readJson(response) { try { return await response.json(); } catch { return null; } }
function apiError(code, status) { const error = new Error(code); error.code = code; error.status = status; return error; }
function safeErrorName(error) { return error && error.name ? String(error.name).slice(0, 80) : 'Error'; }
function enqueueMutation(operation) {
  const run = mutationQueue.then(operation, operation);
  mutationQueue = run.catch(() => {});
  return run;
}

exports._test = {
  allowsConfigurationMutation,
  assertNoPendingRepositoryConfiguration,
  currentConfiguration,
  isSafeRepository,
  normalizeRepository,
  publicAdminRepository,
  resolveRepositoryTokens,
  rotatedTokenEnvironment,
  serializeRepositoryConfiguration,
  supportsGranularScopes,
  tokenEnvironmentForId,
  validateRepositorySet
};
