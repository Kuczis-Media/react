'use strict';

const git = require('./git-provider.js');
const { GITHUB_API_VERSION } = git;
const LIST_CACHE_MS = 20_000;
const MAX_PROMPT_CHARS = 10_000;
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_LESSON_BYTES = 512 * 1024;
const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_EXAM_BYTES = 2 * 1024 * 1024;
const MAX_PRESENTATION_BYTES = 2 * 1024 * 1024;
const MAX_QUIZ_BYTES = 2 * 1024 * 1024;
const MAX_QUESTION_BANK_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_UPLOAD_BYTES = 4 * 1024 * 1024;
const MEDIA_READ_CACHE_MS = 5 * 60 * 1000;
const MAX_MEDIA_READ_CACHE_BYTES = 24 * 1024 * 1024;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SAFE_TOKEN_ENV = /^(?:GITHUB_CONTENT_TOKEN|GITHUB_TOKEN|GITEA_TOKEN)(?:_[A-Z0-9][A-Z0-9_]*)?$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SAFE_ROOT = /^(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SAFE_LESSON_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.md$/i;
const SAFE_PROMPT_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(json|txt)$/i;
const SAFE_EXAM_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_QUESTION_BANK_FILENAME = /^question-bank\.json$/;
const SAFE_MEDIA_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_MEDIA_FILENAME = /^[a-z0-9][a-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/;
const SAFE_LOCAL_MEDIA_REF = /^photos\/[a-z0-9][a-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/;
const SAFE_SHARED_MEDIA_REF = /^assets\/shared\/[a-z0-9][a-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/;
const SAFE_SHA = /^[a-f0-9]{40,64}$/i;
const PROMPT_POINT_HEADER = /^::punkt[ \t]+([1-9]\d{0,3})[ \t]*$/i;
const SIMPLE_PROMPT_POINT_HEADER = /^([1-9]\d{0,3})[.)][ \t]+(.+)$/;
const listCache = new Map();
const mediaReadCache = new Map();
let mediaReadCacheBytes = 0;
const mutationQueues = new Map();
const MAX_REPOSITORIES = 20;
const STUDIO_ASSET_KINDS = Object.freeze([
  'lesson',
  'prompt',
  'exam',
  'presentation',
  'quiz'
]);

class ContentRepositoryError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'ContentRepositoryError';
    this.code = code;
    this.status = status;
  }
}

function repositoryConfigs(env = process.env) {
  const provider = git.settings(env);
  const raw = cleanString(env[git.repositoriesEnvKey(env)]);
  if (!raw) return [legacyRepositoryConfig(env)];

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new ContentRepositoryError('CONTENT_REPOSITORIES_INVALID', 503);
  }
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_REPOSITORIES) {
    throw new ContentRepositoryError('CONTENT_REPOSITORIES_INVALID', 503);
  }

  const seen = new Set();
  let defaultCount = 0;
  const configs = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ContentRepositoryError('CONTENT_REPOSITORIES_INVALID', 503);
    }
    const allowed = new Set(['id', 'label', 'repository', 'ref', 'root', 'tokenEnv', 'default']);
    if (Object.keys(entry).some((key) => !allowed.has(key))) {
      throw new ContentRepositoryError('CONTENT_REPOSITORIES_INVALID', 503);
    }
    const id = cleanString(entry.id).toLowerCase();
    const label = cleanString(entry.label).slice(0, 80);
    const repository = cleanString(entry.repository);
    const ref = cleanString(entry.ref) || 'main';
    const root = cleanString(entry.root).replace(/^\/+|\/+$/g, '');
    const tokenEnv = cleanString(entry.tokenEnv) || git.tokenEnv(env);
    const isDefault = entry.default === true || (!index && !entries.some((item) => item && item.default === true));
    if (
      !SAFE_REPOSITORY_ID.test(id) ||
      seen.has(id) ||
      (id === 'default' && !isDefault) ||
      !label ||
      !SAFE_REPOSITORY.test(repository) ||
      !SAFE_REF.test(ref) ||
      (root && !SAFE_ROOT.test(root)) ||
      !SAFE_TOKEN_ENV.test(tokenEnv) ||
      (provider.provider === 'gitea' ? !tokenEnv.startsWith('GITEA_TOKEN') : tokenEnv.startsWith('GITEA_TOKEN')) ||
      (entry.default != null && typeof entry.default !== 'boolean')
    ) {
      throw new ContentRepositoryError('CONTENT_REPOSITORIES_INVALID', 503);
    }
    seen.add(id);
    if (isDefault) defaultCount += 1;
    const token = cleanString(env[tokenEnv]);
    return {
      id,
      label,
      default: isDefault,
      ...provider,
      configured: Boolean(token && provider.apiUrl),
      token,
      tokenEnv,
      repository,
      ref,
      root
    };
  });
  if (defaultCount !== 1) {
    throw new ContentRepositoryError('CONTENT_REPOSITORIES_INVALID', 503);
  }
  return configs;
}

function legacyRepositoryConfig(env) {
  const provider = git.settings(env);
  const gitea = provider.provider === 'gitea';
  const token = cleanString(gitea ? env.GITEA_TOKEN : env.GITHUB_CONTENT_TOKEN || env.GITHUB_TOKEN);
  const repository = cleanString(gitea ? (env.GITEA_OWNER && env.GITEA_REPO ? `${env.GITEA_OWNER}/${env.GITEA_REPO}` : '') : env.GITHUB_CONTENT_REPOSITORY || (env.GITHUB_OWNER && env.GITHUB_REPO ? `${env.GITHUB_OWNER}/${env.GITHUB_REPO}` : ''));
  const ref = cleanString(gitea ? env.GITEA_BRANCH : env.GITHUB_CONTENT_REF || env.GITHUB_BRANCH) || 'main';
  const root = cleanString(gitea ? env.GITEA_CONTENT_ROOT : env.GITHUB_CONTENT_ROOT).replace(/^\/+|\/+$/g, '');
  return {
    ...provider,
    id: 'default',
    label: repository && SAFE_REPOSITORY.test(repository)
      ? repository.split('/')[1]
      : 'Główne repozytorium',
    default: true,
    configured: Boolean(
      token && provider.apiUrl &&
      SAFE_REPOSITORY.test(repository) &&
      SAFE_REF.test(ref) &&
      (!root || SAFE_ROOT.test(root))
    ),
    token,
    tokenEnv: gitea ? 'GITEA_TOKEN' : env.GITHUB_CONTENT_TOKEN ? 'GITHUB_CONTENT_TOKEN' : env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : 'GITHUB_CONTENT_TOKEN',
    repository,
    ref,
    root
  };
}

function repositoryConfig(env = process.env, rawRepositoryId = '') {
  const configs = repositoryConfigs(env);
  const repositoryId = cleanString(rawRepositoryId).toLowerCase();
  if (repositoryId && !SAFE_REPOSITORY_ID.test(repositoryId)) {
    throw new ContentRepositoryError('INVALID_CONTENT_REPOSITORY', 400);
  }
  const selected = repositoryId
    ? repositoryId === 'default'
      ? configs.find((config) => config.default)
      : configs.find((config) => config.id === repositoryId)
    : configs.find((config) => config.default) || configs[0];
  if (!selected) throw new ContentRepositoryError('INVALID_CONTENT_REPOSITORY', 400);
  return selected;
}

function publicConfig(config) {
  return {
    provider: config.provider || 'github',
    configured: config.configured,
    tokenConfigured: Boolean(config.token),
    id: config.id,
    label: config.label,
    default: Boolean(config.default),
    repository: SAFE_REPOSITORY.test(config.repository) ? config.repository : '',
    ref: SAFE_REF.test(config.ref) ? config.ref : '',
    root: !config.root || SAFE_ROOT.test(config.root) ? config.root : ''
  };
}

function publicConfiguration(env = process.env, repositoryId = '') {
  return publicConfig(repositoryConfig(env, repositoryId));
}

function publicConfigurations(env = process.env) {
  return repositoryConfigs(env).map(publicConfig);
}

function configFromOptions(options = {}) {
  if (options.config) {
    const repository = cleanString(options.config.repository);
    return {
      ...options.config,
      id: cleanString(options.config.id) || 'default',
      label: cleanString(options.config.label)
        || (SAFE_REPOSITORY.test(repository) ? repository.split('/')[1] : '')
        || 'Repozytorium',
      default: options.config.default !== false
    };
  }
  return repositoryConfig(options.env, options.repositoryId);
}

function assetDefinition(kind) {
  if (kind === 'lesson') {
    return {
      directory: 'lessons',
      maxBytes: MAX_LESSON_BYTES,
      pattern: SAFE_LESSON_FILENAME
    };
  }
  if (kind === 'prompt') {
    return {
      directory: 'prompts',
      maxBytes: MAX_PROMPT_BYTES,
      pattern: SAFE_PROMPT_FILENAME
    };
  }
  if (kind === 'exam') {
    return {
      directory: 'exams',
      maxBytes: MAX_EXAM_BYTES,
      pattern: SAFE_EXAM_ID,
      nestedFilename: 'exam.json'
    };
  }
  if (kind === 'presentation') {
    return {
      directory: 'presentations',
      maxBytes: MAX_PRESENTATION_BYTES,
      pattern: SAFE_EXAM_ID,
      nestedFilename: 'presentation.json'
    };
  }
  if (kind === 'quiz') {
    return {
      directory: 'quizzes',
      maxBytes: MAX_QUIZ_BYTES,
      pattern: SAFE_EXAM_ID,
      nestedFilename: 'quiz.json'
    };
  }
  if (kind === 'question_bank') {
    return {
      directory: 'exams',
      maxBytes: MAX_QUESTION_BANK_BYTES,
      pattern: SAFE_QUESTION_BANK_FILENAME
    };
  }
  throw new ContentRepositoryError('INVALID_CONTENT_KIND', 400);
}

function validateFilename(kind, rawFilename) {
  const filename = cleanString(rawFilename);
  const definition = assetDefinition(kind);
  if (!definition.pattern.test(filename)) {
    throw new ContentRepositoryError('INVALID_CONTENT_FILENAME', 400);
  }
  return filename;
}

function repositoryPath(config, relativePath) {
  const suffix = String(relativePath || '').replace(/^\/+/, '');
  return config.root ? `${config.root}/${suffix}` : suffix;
}

function apiUrl(config, relativePath, includeRef = true) {
  return git.apiUrl(config, repositoryPath(config, relativePath), includeRef);
}

async function githubRequest(config, relativePath, options = {}) {
  if (!config.configured) {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_NOT_CONFIGURED', 503);
  }
  let response;
  try {
    response = await git.request(config, apiUrl(config, relativePath), { ...options, raw: Boolean(options.raw) });
    git.assertGiteaAccess(config, response);
  } catch (error) {
    throw new ContentRepositoryError(error.code || 'CONTENT_REPOSITORY_UNAVAILABLE', error.status || 503);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ContentRepositoryError('GITHUB_CONTENT_TOKEN_REJECTED', 503);
  }
  if (response.status === 404) {
    throw new ContentRepositoryError(options.notFoundCode || 'CONTENT_REPOSITORY_NOT_FOUND', 404);
  }
  if (!response.ok) {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_UNAVAILABLE', 503);
  }
  return response;
}

async function githubMutationRequest(config, relativePath, method, payload, options = {}) {
  if (!config.configured) {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_NOT_CONFIGURED', 503);
  }
  let response;
  try {
    response = await git.request(config, apiUrl(config, relativePath, false), { ...options, method, body: payload });
    git.assertGiteaAccess(config, response);
  } catch (error) {
    throw new ContentRepositoryError(error.code || 'CONTENT_REPOSITORY_UNAVAILABLE', error.status || 503);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ContentRepositoryError('GITHUB_CONTENT_WRITE_REJECTED', 503);
  }
  if (response.status === 404) {
    throw new ContentRepositoryError(
      options.fileExpected ? 'CONTENT_FILE_NOT_FOUND' : 'CONTENT_REPOSITORY_NOT_FOUND',
      404
    );
  }
  if (response.status === 409) {
    throw new ContentRepositoryError('CONTENT_WRITE_CONFLICT', 409);
  }
  if (response.status === 422) {
    throw new ContentRepositoryError(
      options.creating ? 'CONTENT_FILE_ALREADY_EXISTS' : 'CONTENT_WRITE_CONFLICT',
      409
    );
  }
  if (!response.ok) {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_UNAVAILABLE', 503);
  }
  try {
    return await response.json();
  } catch {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_RESPONSE_INVALID', 503);
  }
}

async function readResponseBytes(response, maxBytes) {
  const declaredLength = Number(response.headers && response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ContentRepositoryError('CONTENT_FILE_TOO_LARGE', 413);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new ContentRepositoryError('CONTENT_FILE_TOO_LARGE', 413);
  }
  return buffer;
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    throw new ContentRepositoryError('CONTENT_FILE_INVALID', 422);
  }
}

async function readCatalog(config, options = {}) {
  let response;
  try {
    response = await githubRequest(config, 'catalog.json', {
      ...options,
      raw: true,
      notFoundCode: 'CONTENT_CATALOG_NOT_FOUND'
    });
  } catch (error) {
    if (error instanceof ContentRepositoryError && error.code === 'CONTENT_CATALOG_NOT_FOUND') {
      return {};
    }
    throw error;
  }
  const raw = decodeUtf8(await readResponseBytes(response, MAX_CATALOG_BYTES));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContentRepositoryError('CONTENT_CATALOG_INVALID', 422);
  }
  const assets = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed.assets
    : null;
  return assets && typeof assets === 'object' && !Array.isArray(assets) ? assets : {};
}

function normalizeMetadata(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const tags = Array.isArray(source.tags)
    ? source.tags.map(cleanString).filter(Boolean).slice(0, 12)
    : [];
  return {
    title: cleanString(source.title).slice(0, 160),
    description: cleanString(source.description).slice(0, 500),
    tags
  };
}

function titleFromFilename(filename) {
  const stem = String(filename || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (!stem) return filename;
  return stem.charAt(0).toLocaleUpperCase('pl') + stem.slice(1);
}

async function verifyContentRoot(config, options = {}) {
  // A missing material folder is normal for a new library. First establish
  // that its parent exists so a bad token/repository/ref cannot look empty.
  try {
    const response = await githubRequest(config, '', { ...options, raw: false, notFoundCode: 'CONTENT_ROOT_NOT_FOUND' });
    let entries;
    try { entries = await response.json(); }
    catch { throw new ContentRepositoryError('CONTENT_REPOSITORY_RESPONSE_INVALID'); }
    if (!Array.isArray(entries)) throw new ContentRepositoryError('CONTENT_REPOSITORY_ROOT_NOT_DIRECTORY', 400);
    return;
  } catch (error) {
    if (error.code !== 'CONTENT_ROOT_NOT_FOUND') throw error;
  }
  // Only a missing parent needs extra diagnosis. The normal empty-folder case
  // above costs one shared read for the whole Studio bootstrap, not per kind.
  for (const [resource, pathname, notFoundCode] of [
    ['', '', 'CONTENT_REPOSITORY_NOT_FOUND'],
    ['branches', config.ref, 'CONTENT_REPOSITORY_BRANCH_NOT_FOUND']
  ]) {
    try {
      const response = await git.request(config, git.apiUrl(config, pathname, false, resource), { ...options, raw: false, method: 'GET' });
      git.assertGiteaAccess(config, response);
      if ([401, 403].includes(response.status)) throw new ContentRepositoryError('GITHUB_CONTENT_TOKEN_REJECTED');
      if (response.status === 404) throw new ContentRepositoryError(notFoundCode, 404);
      if (!response.ok) throw new ContentRepositoryError('CONTENT_REPOSITORY_UNAVAILABLE');
    } catch (error) {
      throw new ContentRepositoryError(error.code || 'CONTENT_REPOSITORY_UNAVAILABLE', error.status || 503);
    }
  }
  throw new ContentRepositoryError('CONTENT_ROOT_NOT_FOUND', 404);
}

async function listAssets(kind, options = {}) {
  const definition = assetDefinition(kind);
  const config = configFromOptions(options);
  if (!config.configured) {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_NOT_CONFIGURED', 503);
  }
  const cacheKey = [git.cacheIdentity(config), config.id, kind, options.verifyNested === false ? 'candidates' : 'verified'].join(':');
  const cached = listCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.value.map((asset) => ({ ...asset, tags: [...asset.tags] }));
  }

  const directoryRequest = githubRequest(config, definition.directory, {
    ...options,
    notFoundCode: 'CONTENT_DIRECTORY_NOT_FOUND'
  }).catch(async (error) => {
    if (!(error instanceof ContentRepositoryError) || error.code !== 'CONTENT_DIRECTORY_NOT_FOUND') throw error;
    await (options.verifyRoot ? options.verifyRoot() : verifyContentRoot(config, options));
    return null;
  });
  const catalogRequest = typeof options.catalogLoader === 'function'
    ? options.catalogLoader()
    : Object.prototype.hasOwnProperty.call(options, 'catalog')
      ? Promise.resolve(options.catalog)
      : readCatalog(config, options);
  const [response, catalog] = await Promise.all([
    directoryRequest,
    catalogRequest
  ]);
  if (!response) {
    listCache.set(cacheKey, { expiresAt: Date.now() + LIST_CACHE_MS, value: [] });
    return [];
  }
  let entries;
  try {
    entries = await response.json();
  } catch {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_RESPONSE_INVALID', 503);
  }
  if (!Array.isArray(entries)) {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_RESPONSE_INVALID', 503);
  }
  let usableEntries = entries.filter((entry) => {
    if (!entry || !definition.pattern.test(entry.name || '')) return false;
    if (definition.nestedFilename) return entry.type === 'dir';
    return entry.type === 'file'
      && Number.isFinite(Number(entry.size))
      && Number(entry.size) <= definition.maxBytes;
  });
  if (definition.nestedFilename && options.verifyNested !== false) {
    const verified = [];
    for (let offset = 0; offset < usableEntries.length; offset += 12) {
      const batch = await Promise.all(usableEntries.slice(offset, offset + 12).map(async (entry) => {
        try {
          const examResponse = await githubRequest(config, `${definition.directory}/${entry.name}/${definition.nestedFilename}`, {
            ...options,
            notFoundCode: 'CONTENT_FILE_NOT_FOUND'
          });
          const file = await examResponse.json();
          if (!file || file.type !== 'file' || file.name !== definition.nestedFilename
            || !Number.isFinite(Number(file.size)) || Number(file.size) > definition.maxBytes) return null;
          return { ...entry, examFile: file };
        } catch (error) {
          if (error instanceof ContentRepositoryError && error.status === 404) return null;
          throw error;
        }
      }));
      verified.push(...batch.filter(Boolean));
    }
    usableEntries = verified;
  }
  const assets = usableEntries
    .map((entry) => {
      const path = definition.nestedFilename
        ? `${definition.directory}/${entry.name}/${definition.nestedFilename}`
        : `${definition.directory}/${entry.name}`;
      const metadata = normalizeMetadata(catalog[path]);
      return {
        id: `${kind}:${entry.name}`,
        kind,
        repositoryId: config.id,
        repositoryLabel: config.label,
        filename: entry.name,
        path,
        title: metadata.title || titleFromFilename(entry.name),
        description: metadata.description,
        tags: metadata.tags,
        size: definition.nestedFilename ? Number(entry.examFile?.size || 0) : Number(entry.size),
        sha: cleanString(definition.nestedFilename ? (entry.examFile?.sha || entry.sha) : entry.sha)
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title, 'pl', { sensitivity: 'base' }));

  listCache.set(cacheKey, {
    expiresAt: Date.now() + LIST_CACHE_MS,
    value: assets
  });
  return assets.map((asset) => ({ ...asset, tags: [...asset.tags] }));
}

async function listAssetBundle(rawKinds = STUDIO_ASSET_KINDS, rawOptions = {}) {
  const kinds = Array.isArray(rawKinds) ? rawKinds : STUDIO_ASSET_KINDS;
  const options = Array.isArray(rawKinds) ? rawOptions : rawKinds;
  if (!kinds.length || !options || typeof options !== 'object' || Array.isArray(options)) {
    throw new ContentRepositoryError('INVALID_CONTENT_KIND', 400);
  }
  const normalizedKinds = [...new Set(kinds.map(cleanString))];
  normalizedKinds.forEach(assetDefinition);
  const config = configFromOptions(options);
  if (!config.configured) {
    throw new ContentRepositoryError('CONTENT_REPOSITORY_NOT_CONFIGURED', 503);
  }

  // Every uncached list shares this lazy promise. Directory requests still start
  // in parallel, while a fully cached bundle avoids catalog.json altogether.
  let catalogRequest = null;
  const catalogLoader = () => {
    if (!catalogRequest) catalogRequest = readCatalog(config, options);
    return catalogRequest;
  };
  let rootCheck = null;
  const verifyRoot = () => {
    if (!rootCheck) rootCheck = verifyContentRoot(config, options);
    return rootCheck;
  };
  const entries = await Promise.all(normalizedKinds.map(async (kind) => [
    kind,
    await listAssets(kind, { ...options, config, catalogLoader, verifyRoot })
  ]));
  return Object.fromEntries(entries);
}

async function readAsset(kind, rawFilename, options = {}) {
  const definition = assetDefinition(kind);
  const filename = validateFilename(kind, rawFilename);
  const config = configFromOptions(options);
  const relativePath = definition.nestedFilename
    ? `${definition.directory}/${filename}/${definition.nestedFilename}`
    : `${definition.directory}/${filename}`;
  const response = await githubRequest(config, relativePath, {
    ...options,
    raw: true,
    notFoundCode: 'CONTENT_FILE_NOT_FOUND'
  });
  const content = decodeUtf8(await readResponseBytes(response, definition.maxBytes));
  return {
    kind,
    repositoryId: config.id,
    repositoryLabel: config.label,
    filename,
    content,
    sha: cleanString(response.headers && response.headers.get('etag')).replace(/^W\/|"/g, '')
  };
}

function validateExpectedSha(rawSha, required = false) {
  const sha = cleanString(rawSha);
  if ((!sha && required) || (sha && !SAFE_SHA.test(sha))) {
    throw new ContentRepositoryError('INVALID_CONTENT_SHA', 400);
  }
  return sha.toLowerCase();
}

function extractJsonPrompt(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string').join('\n').trim();
  }
  if (value && typeof value === 'object') {
    for (const key of ['prompt', 'system', 'text', 'value', 'content']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      if (Array.isArray(candidate)) {
        const joined = candidate.filter((item) => typeof item === 'string').join('\n').trim();
        if (joined) return joined;
      }
    }
  }
  return '';
}

function validateTxtPrompt(content) {
  const text = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const usesExplicitHeaders = lines.some((line) => PROMPT_POINT_HEADER.test(line));
  const seen = new Set();
  let currentNumber = null;
  let currentLines = [];

  const saveCurrent = () => {
    if (currentNumber === null) return;
    const value = currentLines.join('\n').trim();
    if (!value || value.length > MAX_PROMPT_CHARS || seen.has(currentNumber)) {
      throw new ContentRepositoryError('PROMPT_FILE_INVALID', 422);
    }
    seen.add(currentNumber);
  };

  for (const line of lines) {
    const header = usesExplicitHeaders
      ? PROMPT_POINT_HEADER.exec(line)
      : SIMPLE_PROMPT_POINT_HEADER.exec(line);
    if (header) {
      saveCurrent();
      currentNumber = Number(header[1]);
      currentLines = usesExplicitHeaders ? [] : [header[2].trim()];
      continue;
    }
    if (currentNumber === null) {
      if (line.trim()) throw new ContentRepositoryError('PROMPT_FILE_INVALID', 422);
      continue;
    }
    currentLines.push(line);
  }
  saveCurrent();
  if (!seen.size) throw new ContentRepositoryError('PROMPT_FILE_INVALID', 422);
}

function validateAssetContent(kind, filename, rawContent) {
  const definition = assetDefinition(kind);
  if (typeof rawContent !== 'string' || rawContent.includes('\0') || !rawContent.trim()) {
    throw new ContentRepositoryError('CONTENT_FILE_INVALID', 422);
  }
  const bytes = Buffer.byteLength(rawContent, 'utf8');
  if (bytes > definition.maxBytes) {
    throw new ContentRepositoryError('CONTENT_FILE_TOO_LARGE', 413);
  }
  if (kind === 'prompt') {
    if (/\.json$/i.test(filename)) {
      let parsed;
      try {
        parsed = JSON.parse(rawContent.replace(/^\uFEFF/, ''));
      } catch {
        throw new ContentRepositoryError('PROMPT_FILE_INVALID', 422);
      }
      const prompt = extractJsonPrompt(parsed);
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
        throw new ContentRepositoryError('PROMPT_FILE_INVALID', 422);
      }
    } else {
      validateTxtPrompt(rawContent);
    }
  } else if (kind === 'exam') {
    let parsed;
    try { parsed = JSON.parse(rawContent.replace(/^\uFEFF/, '')); }
    catch { throw new ContentRepositoryError('EXAM_FILE_INVALID', 422); }
    const { validateDefinition } = require('./exam-common.js');
    const validation = validateDefinition(parsed, filename);
    if (!validation.valid) throw new ContentRepositoryError(validation.errors[0]?.code || 'EXAM_FILE_INVALID', 422);
  } else if (kind === 'question_bank') {
    let parsed;
    try { parsed = JSON.parse(rawContent.replace(/^\uFEFF/, '')); }
    catch { throw new ContentRepositoryError('QUESTION_BANK_INVALID', 422); }
    const { validateQuestionBank } = require('./exam-common.js');
    const validation = validateQuestionBank(parsed);
    if (!validation.valid) {
      throw new ContentRepositoryError(validation.errors[0]?.code || 'QUESTION_BANK_INVALID', 422);
    }
  } else if (kind === 'presentation') {
    let parsed;
    try { parsed = JSON.parse(rawContent.replace(/^\uFEFF/, '')); }
    catch { throw new ContentRepositoryError('PRESENTATION_FILE_INVALID', 422); }
    const { validateDefinition } = require('./presentation-common.js');
    const validation = validateDefinition(parsed, filename);
    if (!validation.valid) {
      throw new ContentRepositoryError(validation.errors[0]?.code || 'PRESENTATION_FILE_INVALID', 422);
    }
  } else if (kind === 'quiz') {
    let parsed;
    try { parsed = JSON.parse(rawContent.replace(/^\uFEFF/, '')); }
    catch { throw new ContentRepositoryError('QUIZ_FILE_INVALID', 422); }
    const { validateDefinition } = require('./quiz-common.js');
    const validation = validateDefinition(parsed, filename);
    if (!validation.valid) {
      throw new ContentRepositoryError('QUIZ_FILE_INVALID', 422);
    }
  }
  return rawContent;
}

function mutationResult(data, fallbackSha = '') {
  const source = data && typeof data === 'object' ? data : {};
  const content = source.content && typeof source.content === 'object' ? source.content : {};
  const commit = source.commit && typeof source.commit === 'object' ? source.commit : {};
  return {
    sha: cleanString(content.sha) || fallbackSha,
    commitSha: cleanString(commit.sha),
    commitUrl: cleanString(commit.html_url)
  };
}

function enqueueMutation(config, task) {
  const key = git.cacheIdentity(config);
  const previous = mutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  mutationQueues.set(key, current);
  return current.finally(() => {
    if (mutationQueues.get(key) === current) mutationQueues.delete(key);
  });
}

async function saveAsset(kind, rawFilename, rawContent, options = {}) {
  const definition = assetDefinition(kind);
  const filename = validateFilename(kind, rawFilename);
  const content = validateAssetContent(kind, filename, rawContent);
  const expectedSha = validateExpectedSha(options.expectedSha, false);
  const config = configFromOptions(options);
  const creating = !expectedSha;
  const payload = {
    message: creating
      ? `Add ${definition.nestedFilename ? `${definition.directory}/${filename}/${definition.nestedFilename}` : `${definition.directory}/${filename}`} from ChemDisk Studio`
      : `Update ${definition.nestedFilename ? `${definition.directory}/${filename}/${definition.nestedFilename}` : `${definition.directory}/${filename}`} from ChemDisk Studio`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: config.ref
  };
  if (expectedSha) payload.sha = expectedSha;

  return enqueueMutation(config, async () => {
    const data = await githubMutationRequest(
      config,
      definition.nestedFilename
        ? `${definition.directory}/${filename}/${definition.nestedFilename}`
        : `${definition.directory}/${filename}`,
      'PUT',
      payload,
      {
        ...options,
        creating,
        fileExpected: Boolean(expectedSha)
      }
    );
    listCache.clear();
    return {
      kind,
      repositoryId: config.id,
      repositoryLabel: config.label,
      filename,
      created: creating,
      ...mutationResult(data, expectedSha)
    };
  });
}

async function deleteAsset(kind, rawFilename, rawSha, options = {}) {
  const definition = assetDefinition(kind);
  const filename = validateFilename(kind, rawFilename);
  const expectedSha = validateExpectedSha(rawSha, true);
  const config = configFromOptions(options);

  return enqueueMutation(config, async () => {
    const data = await githubMutationRequest(
      config,
      definition.nestedFilename
        ? `${definition.directory}/${filename}/${definition.nestedFilename}`
        : `${definition.directory}/${filename}`,
      'DELETE',
      {
        message: `Delete ${definition.nestedFilename ? `${definition.directory}/${filename}/${definition.nestedFilename}` : `${definition.directory}/${filename}`} from ChemDisk Studio`,
        sha: expectedSha,
        branch: config.ref
      },
      {
        ...options,
        fileExpected: true
      }
    );
    listCache.clear();
    return {
      kind,
      repositoryId: config.id,
      repositoryLabel: config.label,
      filename,
      deleted: true,
      ...mutationResult(data)
    };
  });
}

function mediaMimeType(rawFilename) {
  const extension = (cleanString(rawFilename).match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
  return ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml'
  })[extension] || '';
}

function mediaReadCacheKey(config, directory, filename) {
  return `${git.cacheIdentity(config)}:${directory}/${filename}`;
}

function removeMediaReadCache(key) {
  const cached = mediaReadCache.get(key);
  if (!cached) return;
  mediaReadCacheBytes = Math.max(0, mediaReadCacheBytes - cached.buffer.byteLength);
  mediaReadCache.delete(key);
}

function cachedMedia(key) {
  const cached = mediaReadCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    removeMediaReadCache(key);
    return null;
  }
  mediaReadCache.delete(key);
  mediaReadCache.set(key, cached);
  return cached;
}

function cacheMedia(key, buffer, mimeType, sha) {
  removeMediaReadCache(key);
  const entry = { buffer, mimeType, sha: sha || '', expiresAt: Date.now() + MEDIA_READ_CACHE_MS };
  mediaReadCache.set(key, entry);
  mediaReadCacheBytes += buffer.byteLength;
  while (mediaReadCacheBytes > MAX_MEDIA_READ_CACHE_BYTES && mediaReadCache.size > 1) {
    removeMediaReadCache(mediaReadCache.keys().next().value);
  }
}

function mediaLocation(rawScope, rawMaterialKind, rawMaterialId) {
  const scope = cleanString(rawScope).toLowerCase() || 'local';
  if (scope === 'shared') {
    return {
      scope,
      materialKind: 'shared',
      materialId: '',
      directory: 'assets/shared',
      referencePrefix: 'assets/shared/'
    };
  }
  if (scope !== 'local') throw new ContentRepositoryError('INVALID_MEDIA_SCOPE', 400);
  const materialKind = cleanString(rawMaterialKind).toLowerCase();
  let materialId;
  let directory;
  if (materialKind === 'exam') {
    materialId = validateFilename('exam', rawMaterialId);
    directory = `exams/${materialId}/photos`;
  } else if (materialKind === 'lesson') {
    materialId = validateFilename('lesson', rawMaterialId);
    directory = `lessons/${materialId.replace(/\.md$/i, '')}/photos`;
  } else if (['presentation', 'quiz'].includes(materialKind)) {
    materialId = cleanString(rawMaterialId).toLowerCase();
    if (!SAFE_MEDIA_ID.test(materialId)) {
      throw new ContentRepositoryError('INVALID_MEDIA_OWNER', 400);
    }
    directory = `${materialKind === 'presentation' ? 'presentations' : 'quizzes'}/${materialId}/photos`;
  } else {
    throw new ContentRepositoryError('INVALID_MEDIA_OWNER', 400);
  }
  return { scope, materialKind, materialId, directory, referencePrefix: 'photos/' };
}

function validateMediaReference(location, rawReference) {
  const reference = cleanString(rawReference).toLowerCase();
  const valid = location.scope === 'shared'
    ? SAFE_SHARED_MEDIA_REF.test(reference)
    : SAFE_LOCAL_MEDIA_REF.test(reference);
  if (!valid || !reference.startsWith(location.referencePrefix)) {
    throw new ContentRepositoryError('INVALID_MEDIA_REFERENCE', 400);
  }
  return reference;
}

function safeSvg(buffer) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '').trim();
  } catch {
    throw new ContentRepositoryError('MEDIA_INVALID', 422);
  }
  source = source.replace(/^<\?xml(?:\s[^?>]*)?\?>\s*/i, '');
  if (!/^<svg(?:\s|>)/i.test(source)) throw new ContentRepositoryError('MEDIA_INVALID', 422);
  const unsafe = [
    /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|style|link|meta)\b/i,
    /\son[a-z]+\s*=/i,
    /(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)/i,
    /(?:url\s*\(|@import|javascript:|data:text\/html)/i,
    /<!DOCTYPE|<!ENTITY/i
  ];
  if (unsafe.some((pattern) => pattern.test(source))) {
    throw new ContentRepositoryError('MEDIA_SVG_UNSAFE', 422);
  }
  return Buffer.from(source, 'utf8');
}

function decodeMedia(rawFilename, rawBase64, rawMimeType) {
  const filename = cleanString(rawFilename).toLowerCase();
  const contentBase64 = cleanString(rawBase64);
  const requestedMimeType = cleanString(rawMimeType).toLowerCase();
  if (!SAFE_MEDIA_FILENAME.test(filename)) {
    throw new ContentRepositoryError('INVALID_MEDIA_REFERENCE', 400);
  }
  if (
    !contentBase64
    || contentBase64.length > Math.ceil(MAX_MEDIA_UPLOAD_BYTES * 4 / 3) + 8
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64)
  ) {
    throw new ContentRepositoryError('MEDIA_INVALID', 422);
  }
  let buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) throw new ContentRepositoryError('MEDIA_INVALID', 422);
  if (buffer.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
    throw new ContentRepositoryError('CONTENT_FILE_TOO_LARGE', 413);
  }
  let mimeType = '';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mimeType = 'image/png';
  else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) mimeType = 'image/jpeg';
  else if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) mimeType = 'image/gif';
  else if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') mimeType = 'image/webp';
  else if (/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8'))) {
    mimeType = 'image/svg+xml';
    buffer = safeSvg(buffer);
  }
  if (!mimeType || (requestedMimeType && requestedMimeType !== mimeType)) {
    throw new ContentRepositoryError('MEDIA_INVALID', 422);
  }
  const extension = filename.split('.').pop();
  const validExtension = mimeType === 'image/jpeg'
    ? ['jpg', 'jpeg'].includes(extension)
    : mimeType === 'image/svg+xml'
      ? extension === 'svg'
      : extension === mimeType.split('/')[1];
  if (!validExtension) throw new ContentRepositoryError('MEDIA_INVALID', 422);
  return { filename, buffer, mimeType };
}

async function listMedia(rawScope, rawMaterialKind, rawMaterialId, options = {}) {
  const location = mediaLocation(rawScope, rawMaterialKind, rawMaterialId);
  const config = configFromOptions(options);
  let response;
  try {
    response = await githubRequest(config, location.directory, {
      ...options,
      notFoundCode: 'MEDIA_DIRECTORY_NOT_FOUND'
    });
  } catch (error) {
    if (error instanceof ContentRepositoryError && error.code === 'MEDIA_DIRECTORY_NOT_FOUND') return [];
    throw error;
  }
  let entries;
  try { entries = await response.json(); }
  catch { throw new ContentRepositoryError('CONTENT_REPOSITORY_RESPONSE_INVALID', 503); }
  if (!Array.isArray(entries)) throw new ContentRepositoryError('CONTENT_REPOSITORY_RESPONSE_INVALID', 503);
  return entries
    .filter((entry) => entry?.type === 'file' && SAFE_MEDIA_FILENAME.test(cleanString(entry.name).toLowerCase()))
    .map((entry) => {
      const filename = cleanString(entry.name).toLowerCase();
      return {
        id: `${location.scope}:${location.materialKind}:${location.materialId}:${filename}`,
        scope: location.scope,
        materialKind: location.materialKind,
        materialId: location.materialId,
        repositoryId: config.id,
        repositoryLabel: config.label,
        filename,
        reference: `${location.referencePrefix}${filename}`,
        path: `${location.directory}/${filename}`,
        mimeType: mediaMimeType(filename),
        size: Number(entry.size) || 0,
        sha: cleanString(entry.sha)
      };
    })
    .sort((left, right) => left.filename.localeCompare(right.filename, 'pl', { sensitivity: 'base' }));
}

async function saveMedia(rawScope, rawMaterialKind, rawMaterialId, rawFilename, rawBase64, rawMimeType, options = {}) {
  const location = mediaLocation(rawScope, rawMaterialKind, rawMaterialId);
  const media = decodeMedia(rawFilename, rawBase64, rawMimeType);
  const config = configFromOptions(options);
  const reference = `${location.referencePrefix}${media.filename}`;
  return enqueueMutation(config, async () => {
    const data = await githubMutationRequest(
      config,
      `${location.directory}/${media.filename}`,
      'PUT',
      {
        message: `Add ${location.directory}/${media.filename} from ChemDisk Media Manager`,
        content: media.buffer.toString('base64'),
        branch: config.ref
      },
      { ...options, creating: true, fileExpected: false }
    );
    removeMediaReadCache(mediaReadCacheKey(config, location.directory, media.filename));
    return {
      kind: 'media',
      scope: location.scope,
      materialKind: location.materialKind,
      materialId: location.materialId,
      repositoryId: config.id,
      repositoryLabel: config.label,
      filename: media.filename,
      reference,
      ref: reference,
      path: `${location.directory}/${media.filename}`,
      mimeType: media.mimeType,
      size: media.buffer.byteLength,
      created: true,
      ...mutationResult(data)
    };
  });
}

async function readMedia(rawScope, rawMaterialKind, rawMaterialId, rawReference, options = {}) {
  const location = mediaLocation(rawScope, rawMaterialKind, rawMaterialId);
  const reference = validateMediaReference(location, rawReference);
  const config = configFromOptions(options);
  const filename = reference.slice(location.referencePrefix.length);
  const cacheKey = mediaReadCacheKey(config, location.directory, filename);
  const cached = cachedMedia(cacheKey);
  if (cached) {
    return {
      buffer: cached.buffer,
      mimeType: cached.mimeType,
      sha: cached.sha || '',
      reference,
      scope: location.scope,
      materialKind: location.materialKind,
      materialId: location.materialId,
      repositoryId: config.id
    };
  }
  const response = await githubRequest(config, `${location.directory}/${filename}`, {
    ...options,
    raw: true,
    notFoundCode: 'CONTENT_FILE_NOT_FOUND'
  });
  const buffer = await readResponseBytes(response, MAX_MEDIA_BYTES);
  const mimeType = mediaMimeType(filename);
  if (!mimeType) throw new ContentRepositoryError('INVALID_MEDIA_REFERENCE', 400);
  const rawEtag = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('etag') || '' : '';
  const sha = rawEtag.replace(/^"|"$/g, '').trim();
  cacheMedia(cacheKey, buffer, mimeType, sha);
  return {
    buffer,
    mimeType,
    sha,
    reference,
    scope: location.scope,
    materialKind: location.materialKind,
    materialId: location.materialId,
    repositoryId: config.id
  };
}

async function deleteMedia(rawScope, rawMaterialKind, rawMaterialId, rawReference, rawSha, options = {}) {
  const location = mediaLocation(rawScope, rawMaterialKind, rawMaterialId);
  const reference = validateMediaReference(location, rawReference);
  const expectedSha = validateExpectedSha(rawSha, true);
  const config = configFromOptions(options);
  const filename = reference.slice(location.referencePrefix.length);
  return enqueueMutation(config, async () => {
    const data = await githubMutationRequest(
      config,
      `${location.directory}/${filename}`,
      'DELETE',
      {
        message: `Delete ${location.directory}/${filename} from ChemDisk Media Manager`,
        sha: expectedSha,
        branch: config.ref
      },
      { ...options, fileExpected: true }
    );
    removeMediaReadCache(mediaReadCacheKey(config, location.directory, filename));
    return {
      kind: 'media',
      deleted: true,
      scope: location.scope,
      materialKind: location.materialKind,
      materialId: location.materialId,
      repositoryId: config.id,
      repositoryLabel: config.label,
      filename,
      reference,
      ...mutationResult(data)
    };
  });
}

async function saveExamMedia(rawExamId, rawFilename, rawBase64, rawMimeType, options = {}) {
  try {
    const result = await saveMedia('local', 'exam', rawExamId, rawFilename, rawBase64, rawMimeType, options);
    return { ...result, kind: 'exam_media', examId: result.materialId };
  } catch (error) {
    if (error instanceof ContentRepositoryError && error.code === 'INVALID_MEDIA_REFERENCE') {
      throw new ContentRepositoryError('INVALID_EXAM_MEDIA_REFERENCE', error.status);
    }
    if (error instanceof ContentRepositoryError && ['MEDIA_INVALID', 'MEDIA_SVG_UNSAFE'].includes(error.code)) {
      throw new ContentRepositoryError('EXAM_MEDIA_INVALID', error.status);
    }
    throw error;
  }
}

async function readExamMedia(rawExamId, rawReference, options = {}) {
  try {
    const result = await readMedia('local', 'exam', rawExamId, rawReference, options);
    return { ...result, examId: result.materialId };
  } catch (error) {
    if (error instanceof ContentRepositoryError && error.code === 'INVALID_MEDIA_REFERENCE') {
      throw new ContentRepositoryError('INVALID_EXAM_MEDIA_REFERENCE', error.status);
    }
    throw error;
  }
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clearCache() {
  listCache.clear();
  mediaReadCache.clear();
  mediaReadCacheBytes = 0;
}

module.exports = {
  ContentRepositoryError,
  GITHUB_API_VERSION,
  decodeMediaUpload: decodeMedia,
  deleteAsset,
  deleteMedia,
  listAssetBundle,
  listAssets,
  listMedia,
  publicConfiguration,
  publicConfigurations,
  readAsset,
  readExamMedia,
  readMedia,
  saveExamMedia,
  saveMedia,
  repositoryConfig,
  repositoryConfigs,
  saveAsset,
  validateFilename,
  _test: {
    apiUrl,
    assetDefinition,
    clearCache,
    decodeUtf8,
    decodeExamMedia: decodeMedia,
    decodeMedia,
    extractJsonPrompt,
    mutationResult,
    normalizeMetadata,
    publicConfig,
    mediaLocation,
    mediaMimeType,
    repositoryPath,
    titleFromFilename,
    validateAssetContent,
    validateExpectedSha,
    validateTxtPrompt
  }
};
