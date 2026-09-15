(function exposeEnvModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemEnvModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEnvModel() {
  'use strict';

  const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const MAX_ENTRIES = 100;
  const MAX_SOURCE_LENGTH = 256 * 1024;
  const MASKED_VALUE = '••••••';
  const PRESETS = Object.freeze([
    { ...preset('GIT_PROVIDER', 'Git / Content Provider', 'Źródło repozytoriów. Wybór dotyczy materiałów oraz publicznych assetów.', false, 'gitea'), choices: ['gitea', 'github'] },
    preset('GITEA_BASE_URL', 'Git / Content Provider', 'Adres Twojej instancji Gitea (HTTPS).', false, 'https://gitea.nextmed.edu.pl'),
    preset('GITEA_API_URL', 'Git / Content Provider', 'Adres API v1 tej samej instancji. Puste pole: Base URL + /api/v1.', false, 'https://gitea.nextmed.edu.pl/api/v1'),
    preset('GITEA_TOKEN', 'Git / Content Provider', 'Token Gitea do materiałów. Wpisujesz go lokalnie; generator nigdy nie pobiera istniejącego sekretu z serwera.', true),
    preset('GITEA_OWNER', 'Git / Content Provider', 'Właściciel lub organizacja w Gitei.', false),
    preset('GITEA_REPO', 'Git / Content Provider', 'Nazwa repozytorium materiałów (bez właściciela).', false),
    preset('GITEA_BRANCH', 'Git / Content Provider', 'Gałąź materiałów.', false, 'main'),
    preset('GITEA_CONTENT_ROOT', 'Git / Content Provider', 'Opcjonalny katalog bazowy z lessons, quizzes, exams i assets.', false),
    preset('GITEA_CONTENT_REPOSITORIES', 'Git / Content Provider', 'Wiele repozytoriów: JSON jak w panelu repozytoriów. tokenEnv wskazuje GITEA_TOKEN lub GITEA_TOKEN_<ID>; nigdy nie wpisuj tokenu do JSON.', false),
    preset('GITEA_SITE_ASSETS_REPOSITORY', 'Git / Content Provider', 'Oddzielne PUBLICZNE repo logo i landingu: właściciel/nazwa. Nie używaj tu prywatnego repo kursu.', false),
    preset('GITEA_SITE_ASSETS_TOKEN', 'Git / Content Provider', 'Opcjonalny oddzielny token publicznych assetów. Puste: użyj GITEA_TOKEN.', true),
    preset('GITEA_SITE_ASSETS_BRANCH', 'Git / Content Provider', 'Gałąź publicznych assetów. Puste: GITEA_BRANCH.', false),
    preset('GITEA_SITE_ASSETS_DIRECTORY', 'Git / Content Provider', 'Opcjonalny katalog obrazów publicznych.', false),
    preset('LANDING_CONFIG_PATH', 'Git / Content Provider', 'Domyślny plik JSON landingu. Wybrana w panelu ścieżka ma pierwszeństwo.', false, 'landing/config.json'),
    preset('NETLIFY_API_TOKEN', 'Netlify', 'Token Netlify do Blobs i narzędzi administratora, również publikacji landingu bez GitHuba.', true),
    preset('SITE_ID', 'Netlify', 'UUID witryny; na deployu Netlify ustawia go automatycznie.', false),
    preset('GITHUB_CONTENT_TOKEN', 'Materiały GitHub', 'Fine-grained PAT do prywatnego repo materiałów.', true),
    preset('GITHUB_CONTENT_REPOSITORIES', 'Materiały GitHub', 'Opcjonalna lista wielu repozytoriów w JSON.', false),
    preset('GITHUB_CONTENT_REPOSITORY', 'Materiały GitHub', 'Pojedyncze repo w formacie właściciel/nazwa.', false, 'Kuczis-Media/chemdisk-content'),
    preset('GITHUB_CONTENT_REF', 'Materiały GitHub', 'Gałąź repozytorium materiałów.', false, 'main'),
    preset('GITHUB_CONTENT_ROOT', 'Materiały GitHub', 'Opcjonalny katalog bazowy materiałów.', false),
    preset('GITHUB_SITE_ASSETS_TOKEN', 'Logo i landing', 'PAT z Contents: Read and write do publicznego repo assetów (domyślnie Kuczis-Media/logo) oraz repo JSON wybranego w panelu admina → Landing. Tylko dla GIT_PROVIDER=github; publikacja w Blobs i eksport HTML nie wymagają tego tokenu.', true),
    preset('GITHUB_SITE_ASSETS_DIRECTORY', 'Logo i landing', 'Opcjonalny katalog na logo i obrazy. Miejsce zapisu JSON strony wybierz osobno: panel admina → Landing.', false),
    preset('GITHUB_SITE_ASSETS_REPOSITORY', 'Logo i landing', 'Publiczne repo assetów dla GitHuba; puste zachowuje dotychczasową konfigurację.', false),
    preset('GITHUB_SITE_ASSETS_REF', 'Logo i landing', 'Gałąź publicznych assetów GitHuba; domyślnie main.', false),
    preset('GEMINI_API_KEY', 'AI', 'Klucz konfiguracji Gemini (ENV), dostępnej w routerze AI.', true),
    preset('GEMINI_MODEL', 'AI', 'Model konfiguracji Gemini (ENV).', false, 'gemini-2.5-flash'),
    preset('OPENAI_API_KEY', 'AI', 'Klucz konfiguracji OpenAI (ENV), dostępnej w routerze AI i czacie.', true),
    preset('OPENAI_MODEL', 'AI', 'Model konfiguracji OpenAI (ENV).', false, 'gpt-4.1-mini'),
    preset('STRIPE_SECRET_KEY', 'Płatności', 'Sekretny klucz Stripe test albo live.', true),
    preset('STRIPE_WEBHOOK_SECRET', 'Płatności', 'Sekret podpisu webhooka Stripe.', true)
  ]);

  function preset(name, group, description, secret, value = '') {
    return Object.freeze({ name, value, group, description, secret, preset: true });
  }

  function defaultEntries() {
    return PRESETS.map((entry) => ({ ...entry }));
  }

  function parseEnv(source) {
    const text = String(source ?? '');
    if (text.length > MAX_SOURCE_LENGTH) throw modelError('ENV_SOURCE_TOO_LARGE');
    const entries = [];
    const positions = new Map();
    const invalidLines = [];
    const duplicateNames = [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const assignment = line.trimStart().replace(/^export[ \t]+/, '');
      const separator = assignment.indexOf('=');
      if (separator < 1) {
        invalidLines.push(index + 1);
        continue;
      }
      const name = assignment.slice(0, separator).trim();
      if (!NAME_PATTERN.test(name)) {
        invalidLines.push(index + 1);
        continue;
      }
      const parsedValue = parseValue(lines, index, assignment.slice(separator + 1));
      if (!parsedValue.ok) {
        invalidLines.push(index + 1);
        continue;
      }
      index = parsedValue.endIndex;
      const entry = {
        name,
        value: parsedValue.value,
        group: 'Zaimportowane',
        description: 'Zmienna zaimportowana lokalnie z pliku.',
        secret: looksSecret(name),
        preset: false
      };
      if (positions.has(name)) {
        entries[positions.get(name)] = entry;
        duplicateNames.push(name);
      }
      else {
        positions.set(name, entries.length);
        entries.push(entry);
      }
    }
    if (entries.length > MAX_ENTRIES) throw modelError('ENV_TOO_MANY_ENTRIES');
    return { entries, invalidLines, duplicateNames: unique(duplicateNames) };
  }

  function parseValue(lines, startIndex, rawValue) {
    // This is the value portion of the parser used by dotenv (and Netlify).
    // It deliberately keeps dotenv's lenient fallback for unmatched quotes.
    const remaining = [String(rawValue || ''), ...lines.slice(startIndex + 1)].join('\n');
    const match = /^(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/m.exec(remaining);
    if (!match) return { ok: false, value: '', endIndex: startIndex };
    let value = (match[1] || '').trim();
    const maybeQuote = value[0];
    if (value.length >= 2 && ['"', "'", '`'].includes(maybeQuote) && value.at(-1) === maybeQuote) {
      value = value.slice(1, -1);
    }
    if (maybeQuote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    const consumedLines = (match[0].match(/\n/g) || []).length;
    return { ok: true, value, endIndex: startIndex + consumedLines };
  }

  function mergeEntries(currentEntries, importedEntries) {
    const imported = new Map((Array.isArray(importedEntries) ? importedEntries : []).map((entry) => [entry.name, entry]));
    const merged = (Array.isArray(currentEntries) ? currentEntries : []).map((entry) => (
      imported.has(entry.name) ? { ...entry, value: imported.get(entry.name).value } : { ...entry }
    ));
    const known = new Set(merged.map((entry) => entry.name));
    for (const entry of imported.values()) {
      if (known.has(entry.name)) continue;
      known.add(entry.name);
      merged.push({ ...entry });
    }
    // Importing a legacy GitHub .env must not silently switch it to the new
    // Gitea preset. An explicitly supplied provider always takes precedence.
    if (!imported.has('GIT_PROVIDER') && !Array.from(imported.keys()).some((name) => name.startsWith('GITEA_'))
      && Array.from(imported).some(([name, entry]) => name.startsWith('GITHUB_') && entry.value)) {
      const provider = merged.find((entry) => entry.name === 'GIT_PROVIDER');
      if (provider) provider.value = 'github';
    }
    // A preset must not override an imported legacy alias or an instance URL.
    for (const [canonical, aliases] of [
      ['GITHUB_CONTENT_REPOSITORY', ['GITHUB_OWNER', 'GITHUB_REPO']],
      ['GITHUB_CONTENT_REF', ['GITHUB_BRANCH']],
      ['GITEA_API_URL', ['GITEA_BASE_URL']]
    ]) {
      if (!imported.has(canonical) && aliases.every((name) => imported.has(name))) {
        const entry = merged.find((item) => item.name === canonical);
        if (entry) entry.value = '';
      }
    }
    if (merged.length > MAX_ENTRIES) {
      throw modelError('ENV_TOO_MANY_ENTRIES', { count: merged.length, max: MAX_ENTRIES });
    }
    return merged;
  }

  function validateEntries(entries) {
    const source = Array.isArray(entries) ? entries : [];
    const values = Object.fromEntries(source.filter((entry) => entry?.name).map((entry) => [entry.name, String(entry.value || '').trim()]));
    const configurationErrors = [];
    if (values.GIT_PROVIDER && !['gitea', 'github'].includes(values.GIT_PROVIDER)) configurationErrors.push('GIT_PROVIDER musi mieć wartość gitea albo github.');
    for (const name of ['GITEA_BASE_URL', 'GITEA_API_URL']) {
      if (!values[name]) continue;
      try {
        const url = new URL(values[name]);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { configurationErrors.push(`${name}: wpisz adres HTTPS bez tokenu, loginu i parametrów.`); }
    }
    if (!configurationErrors.length && values.GITEA_BASE_URL && values.GITEA_API_URL
      && new URL(values.GITEA_BASE_URL).origin !== new URL(values.GITEA_API_URL).origin) configurationErrors.push('GITEA_API_URL musi wskazywać tę samą instancję co GITEA_BASE_URL.');
    const invalidNames = [];
    const missingNameRows = [];
    const duplicateNames = [];
    const unrepresentableNames = [];
    const seen = new Set();
    for (let index = 0; index < source.length; index += 1) {
      const raw = source[index];
      const name = String(raw?.name || '').trim();
      const value = String(raw?.value || '');
      if (!name) {
        if (value) missingNameRows.push(index + 1);
        continue;
      }
      if (!NAME_PATTERN.test(name)) {
        invalidNames.push(name);
        continue;
      }
      if (seen.has(name)) duplicateNames.push(name);
      else seen.add(name);
      if (formatValue(value) == null) unrepresentableNames.push(name);
    }
    return {
      ok: !configurationErrors.length && source.length <= MAX_ENTRIES
        && !invalidNames.length
        && !missingNameRows.length
        && !duplicateNames.length
        && !unrepresentableNames.length,
      count: source.length,
      configurationErrors,
      max: MAX_ENTRIES,
      tooMany: source.length > MAX_ENTRIES,
      invalidNames: unique(invalidNames),
      missingNameRows,
      duplicateNames: unique(duplicateNames),
      unrepresentableNames: unique(unrepresentableNames)
    };
  }

  function serializeEnv(entries, options = {}) {
    const includeEmpty = options.includeEmpty !== false;
    const maskSecrets = options.maskSecrets === true;
    const validation = validateEntries(entries);
    if (!validation.ok) throw modelError(validationCode(validation), validation);
    const lines = [];
    for (const raw of Array.isArray(entries) ? entries : []) {
      const name = String(raw?.name || '').trim();
      const value = String(raw?.value || '');
      if (!name || (!includeEmpty && !value)) continue;
      const visibleValue = maskSecrets && value && (raw?.secret === true || looksSecret(name)) ? MASKED_VALUE : value;
      lines.push(`${name}=${formatValue(visibleValue)}`);
    }
    return `${lines.join('\n')}${lines.length ? '\n' : ''}`;
  }

  function formatValue(value) {
    if (!value) return '';
    if (value.includes('\r')) {
      if (!value.includes('"') && !/\\[nr]/.test(value)) return `"${value.replace(/\r/g, '\\r')}"`;
      return null;
    }
    const looksFullyQuoted = /^(['"`])[\s\S]*\1$/.test(value);
    if (!value.includes('#') && !value.includes('\n') && value === value.trim() && !looksFullyQuoted) return value;
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('`')) return `\`${value}\``;
    if (!value.includes('"') && !/\\[nr]/.test(value)) return `"${value}"`;
    return null;
  }

  function looksSecret(name) {
    return /(?:TOKEN|KEY|SECRET|PASSWORD|PRIVATE|PAT)(?:_|$)/i.test(String(name || ''));
  }

  function validationCode(validation) {
    if (validation.configurationErrors?.length) return 'ENV_CONFIGURATION_INVALID';
    if (validation.tooMany) return 'ENV_TOO_MANY_ENTRIES';
    if (validation.missingNameRows.length) return 'ENV_NAME_REQUIRED';
    if (validation.invalidNames.length) return 'ENV_NAME_INVALID';
    if (validation.duplicateNames.length) return 'ENV_DUPLICATE_NAMES';
    return 'ENV_VALUE_UNREPRESENTABLE';
  }

  function modelError(code, details) {
    const error = new Error(code);
    error.code = code;
    if (details) error.details = details;
    return error;
  }

  function unique(values) { return Array.from(new Set(values)); }

  return {
    PRESETS,
    NAME_PATTERN,
    MAX_ENTRIES,
    MAX_SOURCE_LENGTH,
    defaultEntries,
    looksSecret,
    mergeEntries,
    parseEnv,
    serializeEnv,
    validateEntries
  };
});
