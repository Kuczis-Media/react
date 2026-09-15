(function exposePromptLoader(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemPromptLoader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPromptLoader() {
  'use strict';

  const SAFE_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(json|txt)$/i;
  const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

  class PromptConfigError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'PromptConfigError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new PromptConfigError(code, message);
  }

  function sanitizePromptFilename(raw) {
    const filename = typeof raw === 'string' ? raw.trim() : '';
    if (!SAFE_FILENAME.test(filename)) {
      fail('INVALID_FILENAME', 'Nazwa pliku promptu jest nieprawidłowa.');
    }
    return filename;
  }

  function parsePointNumber(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!/^[1-9]\d{0,3}$/.test(value)) {
      fail('INVALID_POINT', 'Parametr punkt musi być dodatnią liczbą całkowitą.');
    }
    return Number(value);
  }

  function parsePromptRequest(input) {
    let url;
    try {
      url = input instanceof URL ? input : new URL(String(input));
    } catch {
      fail('INVALID_URL', 'Adres konfiguracji promptu jest nieprawidłowy.');
    }

    const fileValues = url.searchParams.getAll('plik');
    const legacyValues = url.searchParams.getAll('prompt');
    const pointValues = url.searchParams.getAll('punkt');
    const repositoryValues = url.searchParams.getAll('repo');
    if (
      fileValues.length > 1 ||
      legacyValues.length > 1 ||
      pointValues.length > 1 ||
      repositoryValues.length > 1
    ) {
      fail('AMBIGUOUS_QUERY', 'Parametry konfiguracji nie mogą się powtarzać.');
    }

    const fileValue = fileValues[0] ? fileValues[0].trim() : '';
    const legacyValue = legacyValues[0] ? legacyValues[0].trim() : '';
    if (!fileValue && !legacyValue) return null;
    if (fileValue && legacyValue) {
      fail('AMBIGUOUS_SOURCE', 'Podaj plik tylko w jednym parametrze.');
    }

    const filename = sanitizePromptFilename(fileValue || legacyValue);
    const repositoryId = repositoryValues[0] ? repositoryValues[0].trim().toLowerCase() : '';
    if (repositoryId && !SAFE_REPOSITORY_ID.test(repositoryId)) {
      fail('INVALID_REPOSITORY', 'Identyfikator repozytorium jest nieprawidłowy.');
    }
    const format = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
    const pointRaw = pointValues[0] ? pointValues[0].trim() : '';
    if (format === 'txt' && !pointRaw) fail('POINT_REQUIRED', 'Dla pliku TXT wymagany jest parametr punkt.');
    if (format === 'json' && pointRaw) fail('POINT_NOT_ALLOWED', 'Parametr punkt jest przeznaczony dla plików TXT.');

    return {
      filename,
      repositoryId,
      format,
      point: format === 'txt' ? parsePointNumber(pointRaw) : null
    };
  }

  return { PromptConfigError, parsePromptRequest, sanitizePromptFilename };
});
