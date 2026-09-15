(function exposeContentLibrary(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemContentLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentLibrary(root) {
  'use strict';

  const DEFAULT_ENDPOINT = '/.netlify/functions/content-library';
  const DEFAULT_MEDIA_ENDPOINT = '/.netlify/functions/content-media';
  const SAFE_LESSON_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.md$/i;
  const SAFE_PROMPT_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(json|txt)$/i;
  const SAFE_EXAM_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const SAFE_QUESTION_BANK_FILENAME = /^question-bank\.json$/;
  const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const STUDIO_ASSET_KINDS = Object.freeze([
    'lesson',
    'prompt',
    'exam',
    'presentation',
    'quiz'
  ]);
  const MEDIA_CACHE_TTL_MS = 15 * 60 * 1000;
  const MEDIA_CACHE_MAX_ENTRIES = 96;
  const MEDIA_FETCH_TIMEOUT_MS = 8_000;
  const MEDIA_FETCH_CONCURRENCY = 4;
  const MEDIA_RETRY_DELAYS_MS = Object.freeze([0, 250]);
  const mediaBlobCache = new Map();
  const mediaFetchQueue = [];
  let activeMediaFetches = 0;
  let mediaCacheGeneration = 0;
  const JSON_CACHE_MAX_ENTRIES = 160;
  const JSON_CACHE_TTL_MS = Object.freeze({
    repositories: 5 * 60 * 1000,
    bootstrap: 30 * 1000,
    list: 30 * 1000,
    read: 60 * 1000,
    mediaList: 30 * 1000,
    status: 30 * 1000
  });
  const jsonResponseCache = new Map();

  const ERROR_MESSAGES = Object.freeze({
    ACCESS_EXPIRED: 'Dostęp do kursu wygasł.',
    ACCESS_REQUIRED: 'To konto nie ma dostępu do materiałów.',
    ADMIN_REQUIRED: 'Ta operacja jest dostępna tylko dla administratora.',
    AUTH_EXPIRED: 'Sesja wygasła. Zaloguj się ponownie.',
    AUTH_REQUIRED: 'Zaloguj się ponownie, aby pobrać materiały.',
    CONTENT_CATALOG_INVALID: 'Plik catalog.json w repozytorium jest nieprawidłowy.',
    CONTENT_DIRECTORY_NOT_FOUND: 'Nie udało się odczytać folderu materiałów. Sprawdź gałąź i katalog bazowy biblioteki.',
    CONTENT_ROOT_NOT_FOUND: 'Nie znaleziono katalogu bazowego materiałów. Sprawdź pole root w konfiguracji repozytorium.',
    CONTENT_REPOSITORY_ROOT_NOT_DIRECTORY: 'Katalog bazowy materiałów wskazuje plik zamiast folderu. Popraw pole root.',
    CONTENT_REPOSITORY_BRANCH_NOT_FOUND: 'Nie znaleziono gałęzi z pola ref. Sprawdź jej nazwę; nowe repozytorium musi mieć pierwszy commit, np. plik README.',
    CONTENT_FILE_INVALID: 'Plik nie jest poprawnym tekstem UTF-8.',
    CONTENT_FILE_ALREADY_EXISTS: 'Plik o tej nazwie już istnieje. Wczytaj go z repozytorium przed aktualizacją albo wybierz inną nazwę.',
    CONTENT_FILE_NOT_FOUND: 'Nie znaleziono tego materiału w repozytorium.',
    CONTENT_FILE_TOO_LARGE: 'Plik przekracza dozwolony rozmiar.',
    CONTENT_REPOSITORY_NOT_CONFIGURED: 'Biblioteka materiałów nie została jeszcze skonfigurowana.',
    CONTENT_REPOSITORIES_INVALID: 'Konfiguracja listy repozytoriów jest nieprawidłowa.',
    CONTENT_REPOSITORY_NOT_FOUND: 'Repozytorium nie istnieje lub token nie ma do niego dostępu. Sprawdź właściciela, nazwę i uprawnienia.',
    CONTENT_REPOSITORY_RESPONSE_INVALID: 'Serwer repozytorium zwrócił nieprawidłową odpowiedź.',
    CONTENT_REPOSITORY_TIMEOUT: 'Serwer repozytorium zbyt długo nie odpowiadał.',
    CONTENT_REPOSITORY_AUTH_FAILED: 'Token Gitea jest nieprawidłowy lub wygasł. Administrator musi go zaktualizować.',
    CONTENT_REPOSITORY_FORBIDDEN: 'Gitea odmawia dostępu. Sprawdź uprawnienia tokenu oraz blokady serwera.',
    CONTENT_REPOSITORY_RATE_LIMITED: 'Serwer repozytorium ograniczył ruch. Spróbuj ponownie za chwilę.',
    INVALID_GITEA_URL: 'Sprawdź GITEA_BASE_URL i GITEA_API_URL w konfiguracji serwera.',
    CONTENT_REPOSITORY_UNAVAILABLE: 'Biblioteka materiałów jest chwilowo niedostępna.',
    GITHUB_CONTENT_TOKEN_REJECTED: 'Token repozytorium jest nieprawidłowy albo nie ma dostępu do repozytorium.',
    GITHUB_CONTENT_WRITE_REJECTED: 'Token repozytorium nie ma uprawnienia do zapisu w repozytorium.',
    CONTENT_WRITE_CONFLICT: 'Plik został w międzyczasie zmieniony. Wczytaj najnowszą wersję z repozytorium.',
    INVALID_CONTENT_SHA: 'Brakuje aktualnej wersji pliku. Wczytaj go ponownie z repozytorium.',
    INVALID_CONTENT_ENDPOINT: 'Endpoint biblioteki musi działać w tej samej domenie co aplikacja.',
    INVALID_CONTENT_FILENAME: 'Nazwa pliku lub rozszerzenie są nieprawidłowe.',
    INVALID_CONTENT_KIND: 'Nieprawidłowy rodzaj materiału.',
    INVALID_CONTENT_REQUEST: 'Żądanie zapisu materiału jest nieprawidłowe.',
    INVALID_CONTENT_REPOSITORY: 'Wybrane repozytorium jest nieprawidłowe albo nie zostało skonfigurowane.',
    PROMPT_FILE_INVALID: 'Prompt ma nieprawidłowy format albo przekracza limit.',
    EXAM_FILE_INVALID: 'Definicja egzaminu jest nieprawidłowa.',
    EXAM_MEDIA_INVALID: 'Plik nie jest prawidłowym obrazem PNG, JPG, WEBP lub GIF.',
    INVALID_EXAM_MEDIA_REFERENCE: 'Nazwa albo ścieżka obrazu jest nieprawidłowa.',
    MEDIA_INVALID: 'Plik nie jest prawidłowym obrazem PNG, JPG, WEBP, GIF lub SVG.',
    MEDIA_SVG_UNSAFE: 'SVG zawiera aktywną albo zewnętrzną treść i nie może zostać zapisany.',
    INVALID_MEDIA_REFERENCE: 'Nazwa albo ścieżka obrazu jest nieprawidłowa.',
    INVALID_MEDIA_OWNER: 'Nieprawidłowy materiał nadrzędny dla obrazu.',
    INVALID_MEDIA_SCOPE: 'Nieprawidłowa biblioteka mediów.',
    QUESTION_BANK_INVALID: 'Bank pytań jest nieprawidłowy.',
    PRESENTATION_FILE_INVALID: 'Definicja prezentacji jest nieprawidłowa.',
    QUIZ_FILE_INVALID: 'Definicja quizu jest nieprawidłowa.',
    SESSION_CHECK_UNAVAILABLE: 'Nie udało się potwierdzić sesji.'
  });

  class ContentLibraryError extends Error {
    constructor(code, status) {
      super(ERROR_MESSAGES[code] || 'Nie udało się pobrać materiałów.');
      this.name = 'ContentLibraryError';
      this.code = code;
      this.status = status;
    }
  }

  function endpoint() {
    const meta = root && root.document
      ? root.document.querySelector('meta[name="chemdisk-content-endpoint"]')
      : null;
    const value = meta && typeof meta.content === 'string' ? meta.content.trim() : '';
    return value || DEFAULT_ENDPOINT;
  }

  function mediaEndpoint() {
    const meta = root && root.document
      ? root.document.querySelector('meta[name="chemdisk-media-endpoint"]')
      : null;
    const value = meta && typeof meta.content === 'string' ? meta.content.trim() : '';
    return value || DEFAULT_MEDIA_ENDPOINT;
  }

  function validateFilename(kind, rawFilename) {
    const filename = typeof rawFilename === 'string' ? rawFilename.trim() : '';
    const pattern = kind === 'lesson'
      ? SAFE_LESSON_FILENAME
      : ['exam', 'presentation', 'quiz'].includes(kind) ? SAFE_EXAM_ID
        : kind === 'question_bank' ? SAFE_QUESTION_BANK_FILENAME : SAFE_PROMPT_FILENAME;
    if (!pattern.test(filename)) {
      throw new ContentLibraryError('INVALID_CONTENT_FILENAME', 400);
    }
    return filename;
  }

  function validateRepositoryId(rawRepositoryId, optional = true) {
    const repositoryId = typeof rawRepositoryId === 'string'
      ? rawRepositoryId.trim().toLowerCase()
      : '';
    if (!repositoryId && optional) return '';
    if (!SAFE_REPOSITORY_ID.test(repositoryId)) {
      throw new ContentLibraryError('INVALID_CONTENT_REPOSITORY', 400);
    }
    return repositoryId;
  }

  async function accessToken(forceRefresh) {
    const auth = root && root.ChemAuth;
    if (!auth || typeof auth.getAccessToken !== 'function') {
      throw new ContentLibraryError('AUTH_REQUIRED', 401);
    }
    const token = await auth.getAccessToken({ forceRefresh: Boolean(forceRefresh) });
    if (!token) throw new ContentLibraryError('AUTH_REQUIRED', 401);
    return token;
  }

  function cachePrincipal() {
    try {
      const user = root?.ChemAuth?.getUser?.();
      return String(user?.id || user?.sub || user?.email || 'session');
    } catch {
      return 'session';
    }
  }

  function jsonCacheKey(...parts) {
    return [cachePrincipal(), ...parts.map((part) => String(part ?? ''))].join('\u001f');
  }

  function cloneJson(value) {
    if (typeof root?.structuredClone === 'function') {
      try { return root.structuredClone(value); } catch { /* fall back below */ }
    }
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function trimJsonResponseCache() {
    while (jsonResponseCache.size > JSON_CACHE_MAX_ENTRIES) {
      const oldestKey = jsonResponseCache.keys().next().value;
      if (oldestKey === undefined) break;
      jsonResponseCache.delete(oldestKey);
    }
  }

  function seedJsonResponse(key, value, ttl) {
    const snapshot = cloneJson(value);
    jsonResponseCache.delete(key);
    jsonResponseCache.set(key, {
      pending: false,
      expiresAt: Date.now() + ttl,
      promise: Promise.resolve(snapshot)
    });
    trimJsonResponseCache();
  }

  function cachedJsonResponse(key, ttl, refresh, loader) {
    const existing = jsonResponseCache.get(key);
    if (existing && (existing.pending || (!refresh && existing.expiresAt > Date.now()))) {
      return existing.promise.then(cloneJson);
    }
    if (existing) jsonResponseCache.delete(key);
    const entry = { pending: true, expiresAt: 0, promise: null };
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        entry.pending = false;
        entry.expiresAt = Date.now() + ttl;
        return cloneJson(value);
      })
      .catch((error) => {
        if (jsonResponseCache.get(key) === entry) jsonResponseCache.delete(key);
        throw error;
      });
    entry.promise = promise;
    jsonResponseCache.set(key, entry);
    trimJsonResponseCache();
    return promise.then(cloneJson);
  }

  function clearJsonResponseCache() {
    jsonResponseCache.clear();
  }

  // A long-lived tab can be signed into a different account. Never carry
  // private repository metadata or image Blobs across that boundary.
  if (root && typeof root.addEventListener === 'function') {
    root.addEventListener('chem-auth-user-changed', () => {
      clearJsonResponseCache();
      mediaCacheGeneration += 1;
      mediaBlobCache.clear();
    });
  }

  async function request(params, options = {}) {
    const applicationOrigin = root && root.location ? root.location.origin : 'https://local.invalid';
    const url = new URL(endpoint(), applicationOrigin);
    if (url.origin !== applicationOrigin) {
      throw new ContentLibraryError('INVALID_CONTENT_ENDPOINT', 400);
    }
    const token = await accessToken(options.forceRefresh);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    let response;
    try {
      response = await root.fetch(url, {
        method: options.method || 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      });
    } catch {
      throw new ContentLibraryError('CONTENT_REPOSITORY_UNAVAILABLE', 503);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ContentLibraryError('CONTENT_REPOSITORY_UNAVAILABLE', response.status || 503);
    }
    if (!response.ok) {
      const code = payload && typeof payload.error === 'string'
        ? payload.error
        : 'CONTENT_REPOSITORY_UNAVAILABLE';
      if (response.status === 401 && !options.forceRefresh) {
        return request(params, { ...options, forceRefresh: true });
      }
      throw new ContentLibraryError(code, response.status);
    }
    return payload;
  }

  async function list(kind, options = {}) {
    if (!['lesson', 'prompt', 'exam', 'question_bank', 'presentation', 'quiz'].includes(kind)) {
      throw new ContentLibraryError('INVALID_CONTENT_KIND', 400);
    }
    const repositoryId = validateRepositoryId(options.repositoryId);
    return cachedJsonResponse(
      jsonCacheKey('list', repositoryId, kind),
      JSON_CACHE_TTL_MS.list,
      Boolean(options.refresh),
      async () => {
        const payload = await request({
          action: 'list',
          kind,
          repo: repositoryId,
          refresh: options.refresh ? '1' : ''
        });
        return Array.isArray(payload.assets) ? payload.assets : [];
      }
    );
  }

  async function readLesson(rawFilename, options = {}) {
    return read('lesson', rawFilename, options);
  }

  async function readPrompt(rawFilename, options = {}) {
    return read('prompt', rawFilename, options);
  }

  async function readExam(rawExamId, options = {}) {
    return read('exam', rawExamId, options);
  }

  async function readQuestionBank(options = {}) {
    return read('question_bank', 'question-bank.json', options);
  }

  async function readPresentation(rawPresentationId, options = {}) {
    return read('presentation', rawPresentationId, options);
  }

  async function readQuiz(rawQuizId, options = {}) {
    return read('quiz', rawQuizId, options);
  }

  async function read(kind, rawFilename, options = {}) {
    const filename = validateFilename(kind, rawFilename);
    const repositoryId = validateRepositoryId(options.repositoryId);
    return cachedJsonResponse(
      jsonCacheKey('read', repositoryId, kind, filename),
      JSON_CACHE_TTL_MS.read,
      Boolean(options.refresh),
      async () => {
        const payload = await request({
          action: 'read',
          kind,
          file: filename,
          repo: repositoryId
        });
        if (!payload || typeof payload.content !== 'string') {
          throw new ContentLibraryError('CONTENT_FILE_INVALID', 422);
        }
        return payload;
      }
    );
  }

  async function save(kind, input = {}) {
    const filename = validateFilename(kind, input.filename);
    if (typeof input.content !== 'string') {
      throw new ContentLibraryError('CONTENT_FILE_INVALID', 422);
    }
    const saved = await request({}, {
      method: 'PUT',
      body: {
        kind,
        filename,
        content: input.content,
        expectedSha: typeof input.expectedSha === 'string' ? input.expectedSha : '',
        repositoryId: validateRepositoryId(input.repositoryId)
      }
    });
    clearJsonResponseCache();
    return saved;
  }

  async function remove(kind, input = {}) {
    const filename = validateFilename(kind, input.filename);
    const removed = await request({}, {
      method: 'DELETE',
      body: {
        kind,
        filename,
        expectedSha: typeof input.expectedSha === 'string' ? input.expectedSha : '',
        repositoryId: validateRepositoryId(input.repositoryId)
      }
    });
    clearJsonResponseCache();
    return removed;
  }

  async function uploadExamMedia(input = {}) {
    const examId = validateFilename('exam', input.examId);
    const filename = typeof input.filename === 'string' ? input.filename.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif)$/.test(filename)) {
      throw new ContentLibraryError('INVALID_EXAM_MEDIA_REFERENCE', 400);
    }
    if (typeof input.contentBase64 !== 'string' || !input.contentBase64) {
      throw new ContentLibraryError('EXAM_MEDIA_INVALID', 422);
    }
    const saved = await request({}, {
      method: 'PUT',
      body: {
        kind: 'exam_media',
        examId,
        filename,
        contentBase64: input.contentBase64,
        mimeType: typeof input.mimeType === 'string' ? input.mimeType : '',
        repositoryId: validateRepositoryId(input.repositoryId)
      }
    });
    clearJsonResponseCache();
    return saved;
  }

  function normalizeMediaOwner(input = {}) {
    const scope = input.scope === 'shared' ? 'shared' : 'local';
    const materialKind = scope === 'shared' ? '' : String(input.materialKind || '').trim().toLowerCase();
    const materialId = scope === 'shared' ? '' : String(input.materialId || '').trim();
    if (scope === 'local' && !['lesson', 'exam', 'presentation', 'quiz'].includes(materialKind)) {
      throw new ContentLibraryError('INVALID_MEDIA_OWNER', 400);
    }
    if (scope === 'local') {
      if (materialKind === 'lesson') validateFilename('lesson', materialId);
      else if (!SAFE_EXAM_ID.test(materialId)) throw new ContentLibraryError('INVALID_MEDIA_OWNER', 400);
    }
    return { scope, materialKind, materialId };
  }

  async function listMedia(input = {}) {
    const owner = normalizeMediaOwner(input);
    const repositoryId = validateRepositoryId(input.repositoryId);
    return cachedJsonResponse(
      jsonCacheKey('media-list', repositoryId, owner.scope, owner.materialKind, owner.materialId, input.usage ? 'usage' : ''),
      JSON_CACHE_TTL_MS.mediaList,
      Boolean(input.refresh),
      async () => {
        const payload = await request({
          action: 'list-media',
          scope: owner.scope,
          materialKind: owner.materialKind,
          materialId: owner.materialId,
          repo: repositoryId,
          refresh: input.refresh ? '1' : '',
          usage: input.usage ? '1' : ''
        });
        return Array.isArray(payload.assets) ? payload.assets : [];
      }
    );
  }

  async function uploadMedia(input = {}) {
    const owner = normalizeMediaOwner(input);
    const filename = typeof input.filename === 'string' ? input.filename.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/.test(filename)) {
      throw new ContentLibraryError('INVALID_MEDIA_REFERENCE', 400);
    }
    if (typeof input.contentBase64 !== 'string' || !input.contentBase64) {
      throw new ContentLibraryError('MEDIA_INVALID', 422);
    }
    const saved = await request({}, {
      method: 'PUT',
      body: {
        kind: 'media',
        ...owner,
        filename,
        contentBase64: input.contentBase64,
        mimeType: typeof input.mimeType === 'string' ? input.mimeType : '',
        repositoryId: validateRepositoryId(input.repositoryId)
      }
    });
    clearJsonResponseCache();
    invalidateMediaBlob(owner, saved.reference || saved.ref || `photos/${filename}`, input.repositoryId);
    return saved;
  }

  async function removeMedia(input = {}) {
    const owner = normalizeMediaOwner(input);
    const removed = await request({}, {
      method: 'DELETE',
      body: {
        kind: 'media',
        ...owner,
        reference: typeof input.reference === 'string' ? input.reference.trim().toLowerCase() : '',
        expectedSha: typeof input.expectedSha === 'string' ? input.expectedSha : '',
        repositoryId: validateRepositoryId(input.repositoryId)
      }
    });
    clearJsonResponseCache();
    invalidateMediaBlob(owner, input.reference, input.repositoryId);
    return removed;
  }

  function mediaBlobCacheKey(owner, reference, repositoryId) {
    return [
      cachePrincipal(),
      validateRepositoryId(repositoryId),
      owner.scope,
      owner.materialKind,
      owner.materialId,
      String(reference || '').trim().toLowerCase()
    ].join(':');
  }

  function drainMediaFetchQueue() {
    while (activeMediaFetches < MEDIA_FETCH_CONCURRENCY && mediaFetchQueue.length) {
      const entry = mediaFetchQueue.shift();
      activeMediaFetches += 1;
      Promise.resolve()
        .then(entry.loader)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          activeMediaFetches -= 1;
          drainMediaFetchQueue();
        });
    }
  }

  function scheduleMediaFetch(loader) {
    return new Promise((resolve, reject) => {
      mediaFetchQueue.push({ loader, resolve, reject });
      drainMediaFetchQueue();
    });
  }

  function invalidateMediaBlob(owner, reference, repositoryId) {
    try { mediaBlobCache.delete(mediaBlobCacheKey(owner, reference, repositoryId)); } catch { /* invalid input */ }
  }

  function trimMediaBlobCache() {
    while (mediaBlobCache.size > MEDIA_CACHE_MAX_ENTRIES) {
      mediaBlobCache.delete(mediaBlobCache.keys().next().value);
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => (root?.setTimeout || setTimeout)(resolve, milliseconds));
  }

  function transientMediaStatus(status) {
    // Missing files and rate limits do not recover within a sub-second retry.
    // Retrying those only spends another Function invocation and delays the UI.
    return [408, 425].includes(status) || status >= 500;
  }

  async function fetchMediaBlob(owner, input, options = {}) {
    const applicationOrigin = root && root.location ? root.location.origin : 'https://local.invalid';
    const url = new URL(mediaEndpoint(), applicationOrigin);
    if (url.origin !== applicationOrigin) throw new ContentLibraryError('INVALID_CONTENT_ENDPOINT', 400);
    const values = {
      scope: owner.scope,
      materialKind: owner.materialKind,
      materialId: owner.materialId,
      ref: typeof input.reference === 'string' ? input.reference.trim().toLowerCase() : '',
      repo: validateRepositoryId(input.repositoryId)
    };
    Object.entries(values).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    let forceRefresh = Boolean(options.forceRefresh);
    let lastError = null;
    for (let attempt = 0; attempt < MEDIA_RETRY_DELAYS_MS.length; attempt += 1) {
      if (MEDIA_RETRY_DELAYS_MS[attempt]) await wait(MEDIA_RETRY_DELAYS_MS[attempt]);
      const token = await accessToken(forceRefresh);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = (root?.setTimeout || setTimeout)(() => controller?.abort(), MEDIA_FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await root.fetch(url, {
          method: 'GET',
          cache: options.bypassCache ? 'reload' : 'default',
          credentials: 'same-origin',
          headers: { Accept: 'image/*', Authorization: `Bearer ${token}` },
          ...(controller ? { signal: controller.signal } : {})
        });
      } catch (error) {
        lastError = new ContentLibraryError(
          error?.name === 'AbortError' ? 'CONTENT_REPOSITORY_TIMEOUT' : 'CONTENT_REPOSITORY_UNAVAILABLE',
          error?.name === 'AbortError' ? 504 : 503
        );
        if (attempt + 1 < MEDIA_RETRY_DELAYS_MS.length) continue;
        throw lastError;
      } finally {
        (root?.clearTimeout || clearTimeout)(timeout);
      }
      if (response.status === 401 && !forceRefresh) {
        forceRefresh = true;
        lastError = new ContentLibraryError('AUTH_EXPIRED', 401);
        continue;
      }
      if (!response.ok) {
        let payload = {};
        try { payload = await response.json(); } catch { /* binary endpoint */ }
        lastError = new ContentLibraryError(payload.error || 'CONTENT_REPOSITORY_UNAVAILABLE', response.status);
        if (transientMediaStatus(response.status) && attempt + 1 < MEDIA_RETRY_DELAYS_MS.length) continue;
        throw lastError;
      }
      const blob = await response.blob();
      if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) {
        throw new ContentLibraryError('MEDIA_INVALID', 422);
      }
      return blob;
    }
    throw lastError || new ContentLibraryError('CONTENT_REPOSITORY_UNAVAILABLE', 503);
  }

  function readMediaBlob(input = {}, options = {}) {
    const owner = normalizeMediaOwner(input);
    const key = mediaBlobCacheKey(owner, input.reference, input.repositoryId);
    const cached = mediaBlobCache.get(key);
    if (cached?.pending || (!options.bypassCache && cached && cached.expiresAt > Date.now())) return cached.promise;
    if (cached) mediaBlobCache.delete(key);
    const generation = mediaCacheGeneration;
    const entry = { promise: null, pending: true, expiresAt: 0 };
    const promise = scheduleMediaFetch(() => {
      if (generation !== mediaCacheGeneration) throw new ContentLibraryError('AUTH_EXPIRED', 401);
      return fetchMediaBlob(owner, input, options);
    }).then((blob) => {
      if (generation !== mediaCacheGeneration) throw new ContentLibraryError('AUTH_EXPIRED', 401);
      entry.pending = false;
      entry.expiresAt = Date.now() + MEDIA_CACHE_TTL_MS;
      return blob;
    }).catch((error) => {
      if (mediaBlobCache.get(key)?.promise === promise) mediaBlobCache.delete(key);
      throw error;
    });
    entry.promise = promise;
    mediaBlobCache.set(key, entry);
    trimMediaBlobCache();
    return promise;
  }

  async function status(options = {}) {
    const repositoryId = validateRepositoryId(options.repositoryId);
    return cachedJsonResponse(
      jsonCacheKey('status', repositoryId),
      JSON_CACHE_TTL_MS.status,
      Boolean(options.refresh),
      () => request({
        action: 'status',
        repo: repositoryId,
        refresh: options.refresh ? '1' : ''
      })
    );
  }

  async function repositories(options = {}) {
    return cachedJsonResponse(
      jsonCacheKey('repositories'),
      JSON_CACHE_TTL_MS.repositories,
      Boolean(options.refresh),
      async () => {
        const payload = await request({ action: 'repositories' });
        return Array.isArray(payload.repositories) ? payload.repositories : [];
      }
    );
  }

  async function studioBootstrap(options = {}) {
    const repositoryId = validateRepositoryId(options.repositoryId);
    const result = await cachedJsonResponse(
      jsonCacheKey('bootstrap', repositoryId),
      JSON_CACHE_TTL_MS.bootstrap,
      Boolean(options.refresh),
      async () => {
        const payload = await request({
          action: 'studio-bootstrap',
          repo: repositoryId,
          refresh: options.refresh ? '1' : ''
        });
        const source = payload && payload.assets && typeof payload.assets === 'object'
          ? payload.assets
          : {};
        return {
          repositories: Array.isArray(payload.repositories) ? payload.repositories : [],
          repository: payload && payload.repository && typeof payload.repository === 'object'
            ? payload.repository
            : null,
          assets: Object.fromEntries(STUDIO_ASSET_KINDS.map((kind) => [
            kind,
            Array.isArray(source[kind]) ? source[kind] : []
          ]))
        };
      }
    );
    seedJsonResponse(jsonCacheKey('repositories'), result.repositories, JSON_CACHE_TTL_MS.repositories);
    const resolvedRepositoryId = validateRepositoryId(result.repository?.id || repositoryId);
    STUDIO_ASSET_KINDS.forEach((kind) => {
      seedJsonResponse(
        jsonCacheKey('list', resolvedRepositoryId, kind),
        result.assets[kind],
        JSON_CACHE_TTL_MS.list
      );
    });
    return result;
  }

  function lessonUrl(rawFilename, rawRepositoryId = '') {
    const filename = validateFilename('lesson', rawFilename);
    const repositoryId = validateRepositoryId(rawRepositoryId);
    const params = new URLSearchParams({ file: filename });
    if (repositoryId) params.set('repo', repositoryId);
    return `/members/module/lesson/?${params.toString()}`;
  }

  function examUrl(rawExamId, rawRepositoryId = '', materialId = '') {
    const examId = validateFilename('exam', rawExamId);
    const repositoryId = validateRepositoryId(rawRepositoryId);
    const params = new URLSearchParams({ exam: examId });
    if (repositoryId) params.set('repo', repositoryId);
    if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(materialId || '')) params.set('material', materialId);
    return `/members/module/exam/?${params.toString()}`;
  }

  function presentationUrl(rawPresentationId, rawRepositoryId = '', materialId = '') {
    const presentationId = validateFilename('presentation', rawPresentationId);
    const repositoryId = validateRepositoryId(rawRepositoryId);
    const params = new URLSearchParams({ presentation: presentationId });
    if (repositoryId) params.set('repo', repositoryId);
    if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(materialId || '')) params.set('material', materialId);
    return `/members/module/presentation/?${params.toString()}`;
  }

  function quizUrl(rawQuizId, rawRepositoryId = '', materialId = '') {
    const quizId = validateFilename('quiz', rawQuizId);
    const repositoryId = validateRepositoryId(rawRepositoryId);
    const params = new URLSearchParams({ quiz: quizId });
    if (repositoryId) params.set('repo', repositoryId);
    if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(materialId || '')) params.set('material', materialId);
    return `/members/module/quiz/?${params.toString()}`;
  }

  function search(assets, query) {
    const normalized = String(query || '').trim().toLocaleLowerCase('pl');
    if (!normalized) return Array.isArray(assets) ? assets.slice() : [];
    return (Array.isArray(assets) ? assets : []).filter((asset) => (
      [
        asset && asset.title,
        asset && asset.filename,
        asset && asset.description,
        ...(Array.isArray(asset && asset.tags) ? asset.tags : [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pl')
        .includes(normalized)
    ));
  }

  return {
    ContentLibraryError,
    ERROR_MESSAGES,
    list,
    readExam,
    readPresentation,
    readPrompt,
    readQuiz,
    readLesson,
    readQuestionBank,
    repositories,
    remove,
    removeMedia,
    save,
    search,
    status,
    studioBootstrap,
    listMedia,
    readMediaBlob,
    uploadMedia,
    uploadExamMedia,
    lessonUrl,
    examUrl,
    presentationUrl,
    quizUrl,
    validateFilename,
    validateRepositoryId,
    _test: {
      endpoint,
      clearRequestCache: clearJsonResponseCache,
      requestCacheSize() { return jsonResponseCache.size; },
      clearMediaCache() { mediaBlobCache.clear(); },
      mediaCacheSize() { return mediaBlobCache.size; },
      mediaRequestState() {
        return { active: activeMediaFetches, queued: mediaFetchQueue.length };
      }
    }
  };
});
