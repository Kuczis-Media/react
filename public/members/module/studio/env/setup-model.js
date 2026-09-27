(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemSetupModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_REPOSITORIES = 20;
  const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
  const ROOT = /^(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  const TOKEN = /^(?:GITHUB_CONTENT_TOKEN|GITHUB_TOKEN|GITEA_TOKEN)(?:_[A-Z0-9][A-Z0-9_]*)?$/;
  const clean = (value) => String(value ?? '').trim();
  const valuesOf = (entries) => Object.fromEntries(entries.map((entry) => [entry.name, clean(entry.value)]));
  const prefixFor = (provider) => provider === 'github' ? 'GITHUB' : 'GITEA';
  const tokenFor = (provider) => provider === 'github' ? 'GITHUB_CONTENT_TOKEN' : 'GITEA_TOKEN';
  const repositoriesKey = (provider) => `${prefixFor(provider)}_CONTENT_REPOSITORIES`;
  function slug(value) {
    return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }
  function blankRepository(provider, index = 0) {
    return { id: index ? `kurs-${index + 1}` : 'glowne', label: index ? `Kurs ${index + 1}` : 'Materiały główne', repository: '', ref: 'main', root: '', tokenEnv: tokenFor(provider), default: index === 0 };
  }
  function readRepositories(entries, provider) {
    const values = valuesOf(entries);
    const key = repositoriesKey(provider);
    if (values[key]) {
      let parsed;
      try { parsed = JSON.parse(values[key]); } catch (_) { throw new Error(`${key}: niepoprawny JSON. Popraw go w edytorze zmiennych.`); }
      if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_REPOSITORIES || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error(`${key}: potrzebna jest lista od 1 do ${MAX_REPOSITORIES} repozytoriów.`);
      }
      const allowed = new Set(['id', 'label', 'repository', 'ref', 'root', 'tokenEnv', 'default']);
      if (parsed.some((item) => Object.keys(item).some((key) => !allowed.has(key)))) throw new Error(`${key}: nieobsługiwane pola. Token wpisz w osobnej zmiennej, a w JSON tylko jej nazwę w tokenEnv.`);
      if (parsed.some((item) => (item.default != null && typeof item.default !== 'boolean') || ['id', 'label', 'repository', 'ref', 'root', 'tokenEnv'].some((key) => item[key] != null && typeof item[key] !== 'string'))) {
        throw new Error(`${key}: pola repozytorium muszą być tekstem, a default wartością true lub false.`);
      }
      return parsed.map((item, index) => ({ ...item, ref: item.ref || 'main', root: item.root || '', tokenEnv: item.tokenEnv || tokenFor(provider), default: item.default === true || (!index && !parsed.some((item) => item.default === true)) }));
    }
    const github = provider === 'github';
    const repository = github ? values.GITHUB_CONTENT_REPOSITORY || (values.GITHUB_OWNER && values.GITHUB_REPO ? `${values.GITHUB_OWNER}/${values.GITHUB_REPO}` : '')
      : values.GITEA_OWNER && values.GITEA_REPO ? `${values.GITEA_OWNER}/${values.GITEA_REPO}` : '';
    return [{ ...blankRepository(provider), repository, ref: (github ? values.GITHUB_CONTENT_REF || values.GITHUB_BRANCH : values.GITEA_BRANCH) || 'main', root: values[`${prefixFor(provider)}_CONTENT_ROOT`] || '',
      tokenEnv: github && !values.GITHUB_CONTENT_TOKEN && values.GITHUB_TOKEN ? 'GITHUB_TOKEN' : tokenFor(provider) }];
  }
  function normalizeRepository(value, provider, baseUrl) {
    const raw = clean(value);
    if (!/^https?:/i.test(raw)) return raw.replace(/\.git$/, '');
    try {
      const url = new URL(raw);
      const base = new URL(provider === 'github' ? 'https://github.com' : baseUrl);
      if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.search || url.hash) return raw;
      const prefix = base.pathname.replace(/\/$/, '');
      if (prefix && !url.pathname.startsWith(`${prefix}/`)) return raw;
      return decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
    } catch (_) { return raw; }
  }
  function validateRepositories(repositories, provider) {
    const errors = [];
    if (!Array.isArray(repositories) || !repositories.length || repositories.length > MAX_REPOSITORIES) return [`Dodaj od 1 do ${MAX_REPOSITORIES} repozytoriów.`];
    const ids = new Set();
    repositories.forEach((item, index) => {
      const label = `Repozytorium ${index + 1}`;
      const id = clean(item.id);
      if (!ID.test(id) || (id === 'default' && !item.default)) errors.push(`${label}: identyfikator to 1–40 małych liter, cyfr lub myślników; „default” jest zarezerwowane dla domyślnego repozytorium.`);
      if (ids.has(id)) errors.push(`${label}: identyfikator musi być unikalny.`);
      ids.add(id);
      if (!clean(item.label) || clean(item.label).length > 80 || /[\u0000-\u001f\u007f]/.test(clean(item.label))) errors.push(`${label}: wpisz nazwę do 80 znaków, bez znaków sterujących.`);
      if (!REPOSITORY.test(clean(item.repository))) errors.push(`${label}: wpisz właściciel/nazwa, np. moja-szkola/biologia.`);
      if (!REF.test(clean(item.ref) || 'main')) errors.push(`${label}: niepoprawna gałąź.`);
      if (clean(item.root) && !ROOT.test(clean(item.root))) errors.push(`${label}: niepoprawny katalog materiałów (bez spacji i ..).`);
      const tokenEnv = clean(item.tokenEnv) || tokenFor(provider);
      if (!TOKEN.test(tokenEnv) || (provider === 'gitea' ? !tokenEnv.startsWith('GITEA_TOKEN') : tokenEnv.startsWith('GITEA_TOKEN'))) errors.push(`${label}: nazwa zmiennej tokenu musi odpowiadać wybranemu dostawcy.`);
    });
    if (repositories.filter((item) => item.default === true).length !== 1) errors.push('Wybierz dokładnie jedno repozytorium domyślne.');
    return errors;
  }
  function repositoryJson(repositories, provider, pretty = false) {
    return JSON.stringify(repositories.map((item) => ({ id: clean(item.id), label: clean(item.label), repository: clean(item.repository), ref: clean(item.ref) || 'main', root: clean(item.root), tokenEnv: clean(item.tokenEnv) || tokenFor(provider), default: item.default === true })), null, pretty ? 2 : undefined);
  }
  function selectedEntries(entries, features = {}) {
    const values = valuesOf(entries);
    const provider = values.GIT_PROVIDER || 'gitea';
    const prefix = prefixFor(provider);
    const inactive = provider === 'gitea' ? /^GITHUB_/ : /^GITEA_/;
    return entries.filter((entry) => {
      if (entry.name === 'SITE_ID' && !values.SITE_ID) return false;
      if (inactive.test(entry.name)) return false;
      if (features.openai === false && /^OPENAI_/.test(entry.name)) return false;
      if (features.gemini === false && /^GEMINI_/.test(entry.name)) return false;
      if (features.payments === false && /^STRIPE_/.test(entry.name)) return false;
      if (features.assets === false && (/_SITE_ASSETS_/.test(entry.name) || entry.name === 'GITEA_ASSETS_REPO' || entry.name === 'LANDING_CONFIG_PATH')) return false;
      // With a JSON catalog these legacy single-repository fields are redundant.
      if (values[repositoriesKey(provider)] && [`${prefix}_OWNER`, `${prefix}_REPO`, `${prefix}_BRANCH`, `${prefix}_CONTENT_REPOSITORY`, `${prefix}_CONTENT_REF`, `${prefix}_CONTENT_ROOT`].includes(entry.name)) {
        if (provider === 'gitea' && features.assets !== false && ((entry.name === 'GITEA_BRANCH' && !values.GITEA_SITE_ASSETS_BRANCH) || (entry.name === 'GITEA_OWNER' && values.GITEA_ASSETS_REPO && !values.GITEA_SITE_ASSETS_REPOSITORY))) return true;
        return false;
      }
      return true;
    });
  }
  function inspect(entries, features = {}) {
    const values = valuesOf(entries);
    const provider = values.GIT_PROVIDER || 'gitea';
    const errors = [], missing = [];
    let repositories = [];
    if (!['github', 'gitea'].includes(provider)) errors.push('Wybierz GitHub albo Gitea.');
    try { repositories = readRepositories(entries, provider); errors.push(...validateRepositories(repositories, provider)); }
    catch (error) { errors.push(error.message); }
    if (provider === 'gitea' && !values.GITEA_BASE_URL) missing.push({ step: 'git', label: 'Adres instancji Gitea' });
    if (values.SITE_ID && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(values.SITE_ID)) errors.push('ID projektu Netlify musi być UUID, np. 12345678-1234-1234-1234-123456789abc.');
    if (!values.NETLIFY_API_TOKEN) missing.push({ step: 'platform', label: 'Token Netlify — zapis danych i administracja' });
    const tokens = new Set(repositories.map((item) => clean(item.tokenEnv) || tokenFor(provider)));
    for (const token of tokens) if (!values[token]) missing.push({ step: 'repositories', label: `Token do materiałów: ${token}` });
    if (features.assets) {
      const repo = values[`${prefixFor(provider)}_SITE_ASSETS_REPOSITORY`];
      if (!repo) missing.push({ step: 'services', label: 'Publiczne repozytorium logo i strony głównej' });
      else if (!REPOSITORY.test(repo) || repo.includes('..')) errors.push('Publiczne repozytorium: wpisz właściciel/nazwa.');
      if (repo && repositories.some((item) => clean(item.repository).toLowerCase() === repo.toLowerCase())) errors.push('Repozytorium publicznych obrazów musi być oddzielone od prywatnych materiałów kursu.');
      const assetToken = values[`${prefixFor(provider)}_SITE_ASSETS_TOKEN`] || (provider === 'gitea' ? values.GITEA_TOKEN : values.GITHUB_TOKEN);
      if (!assetToken) missing.push({ step: 'services', label: 'Token do publicznych obrazów i strony głównej' });
      const ref = values[`${prefixFor(provider)}_SITE_ASSETS_${provider === 'gitea' ? 'BRANCH' : 'REF'}`];
      if (ref && (!REF.test(ref) || ref.includes('..'))) errors.push('Publiczne repozytorium: niepoprawna gałąź.');
      const directory = values[`${prefixFor(provider)}_SITE_ASSETS_DIRECTORY`];
      if (directory && !ROOT.test(directory)) errors.push('Publiczne repozytorium: niepoprawny katalog obrazów.');
      if (values.LANDING_CONFIG_PATH && (!ROOT.test(values.LANDING_CONFIG_PATH) || !values.LANDING_CONFIG_PATH.endsWith('.json'))) errors.push('Plik strony głównej musi mieć poprawną ścieżkę zakończoną .json.');
    }
    for (const [feature, name, label] of [['openai', 'OPENAI_API_KEY', 'Klucz OpenAI'], ['gemini', 'GEMINI_API_KEY', 'Klucz Gemini'], ['payments', 'STRIPE_SECRET_KEY', 'Klucz Stripe'], ['payments', 'STRIPE_WEBHOOK_SECRET', 'Sekret webhooka Stripe']]) {
      if (features[feature] && !values[name]) missing.push({ step: 'services', label });
    }
    if (features.payments && values.STRIPE_SECRET_KEY && !/^sk_(test|live)_.+/.test(values.STRIPE_SECRET_KEY)) errors.push('Stripe: wpisz pełny sekretny klucz sk_test_… lub sk_live_….');
    if (features.payments && values.STRIPE_WEBHOOK_SECRET && !/^whsec_.+/.test(values.STRIPE_WEBHOOK_SECRET)) errors.push('Stripe: wpisz pełny sekret webhooka whsec_….');
    return { errors, missing, repositories, ready: !errors.length && !missing.length };
  }
  return { MAX_REPOSITORIES, prefixFor, tokenFor, repositoriesKey, blankRepository, readRepositories, normalizeRepository, validateRepositories, repositoryJson, selectedEntries, inspect, slug, valuesOf };
});
