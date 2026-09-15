(function () {
  'use strict';
  const form = document.getElementById('landing-delivery-form');
  if (!form) return;
  const api = window.NextMedLandingDelivery;
  const byId = (id) => document.getElementById(id);
  const fields = byId('landing-delivery-fields'), status = byId('landing-settings-status');
  const enabled = byId('landing-external-enabled'), external = byId('landing-external-url');
  const locationField = byId('landing-config-location'), ref = byId('landing-config-ref'), url = byId('landing-config-url');
  const reload = byId('landing-settings-reload');
  let current = null, busy = false;
  const errors = {
    INVALID_EXTERNAL_LANDING_URL: 'Wpisz poprawny adres HTTPS, np. start.netlify.app.',
    LANDING_REDIRECT_LOOP: 'Wpisz inną domenę. Przekierowanie na tę aplikację utworzyłoby pętlę.',
    INVALID_LANDING_REPOSITORY: 'Podaj właściciela i repozytorium, np. Kuczis-Media/repo.',
    INVALID_LANDING_PATH: 'Podaj ścieżkę do pliku .json, bez .., spacji i początkowego ukośnika.',
    INVALID_LANDING_REF: 'Wpisz poprawną nazwę gałęzi, np. main.',
    LANDING_PATH_RESERVED: 'landing/route.json w repozytorium ustawień jest zarezerwowany. Wybierz inny plik JSON.',
    LANDING_CONFLICT: 'Ustawienia zmieniły się w innej karcie. Wczytaj je ponownie przed zapisem.',
    LANDING_STATIC_CONFIG_INVALID: 'Docelowy plik istnieje, ale nie jest poprawnym landingiem. Niczego w nim nie nadpisano. Wybierz nową ścieżkę.',
    SITE_ASSETS_NOT_CONFIGURED: 'Skonfiguruj publiczne repozytorium i token wybranego dostawcy w środowisku serwera, a następnie wykonaj deploy.',
    SITE_ASSETS_TOKEN_REJECTED: 'Token nie ma dostępu do jednego z repozytoriów.',
    SITE_ASSETS_WRITE_REJECTED: 'Token wymaga uprawnień do odczytu i zapisu obu repozytoriów.',
    SITE_ASSETS_REPOSITORY_NOT_FOUND: 'Nie znaleziono repozytorium lub token nie ma do niego dostępu.',
    SITE_ASSETS_REPOSITORY_NOT_PUBLIC: 'Repozytorium JSON musi być publiczne.',
    SITE_ASSETS_REF_NOT_FOUND: 'Nie znaleziono wskazanej gałęzi repozytorium.',
    SITE_ASSETS_TIMEOUT: 'Serwer repozytorium odpowiada zbyt długo. Spróbuj ponownie.'
  };
  function report(text, error = false) { status.textContent = text; status.dataset.state = error ? 'error' : 'success'; }
  function target() {
    const parts = locationField.value.trim().split('/');
    return api.target({ repository: parts.slice(0, 2).join('/'), path: parts.slice(2).join('/'), ref: ref.value });
  }
  function value() {
    return api.normalize({ externalEnabled: enabled.checked, externalUrl: external.value,
      target: target()
    }, window.location.origin);
  }
  function previewUrl() { try { url.value = api.rawUrl(target()); } catch { url.value = ''; } }
  function show(payload) {
    current = payload; const settings = payload.settings;
    enabled.checked = settings.externalEnabled; external.value = settings.externalUrl;
    locationField.value = `${settings.target.repository}/${settings.target.path}`; ref.value = settings.target.ref;
    url.value = payload.configUrl; external.required = enabled.checked;
  }
  async function request(method, body) {
    const token = await window.ChemAuth.getAccessToken({ forceRefresh: method !== 'GET' });
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch('/.netlify/functions/admin-landing-settings', {
        method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const payload = await response.json();
      if (!response.ok) { const error = new Error(payload.error); error.code = payload.error; throw error; }
      return payload;
    } finally { window.clearTimeout(timer); }
  }
  function message(error) { return errors[error.code] || 'Nie udało się zapisać lub wczytać ustawień. Sprawdź połączenie i uprawnienia repozytorium; możesz ponowić operację.'; }
  async function load(force = false) {
    if (busy || (current && !force)) return;
    busy = true; fields.disabled = true; reload.disabled = true; report('Wczytuję ustawienia…');
    try { show(await request('GET')); report('Wczytano. Zmiany zaczną obowiązywać po zapisaniu.'); }
    catch (error) { report(message(error), true); }
    finally { busy = false; fields.disabled = !current; reload.disabled = false; }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!current || busy) return;
    let settings;
    try { settings = value(); } catch (error) { report(message(error), true); return; }
    if (!window.confirm(`Zastosować ustawienia?\nLanding: ${settings.externalEnabled ? settings.externalUrl : 'lokalna strona NextMed'}\nJSON: ${settings.target.repository}/${settings.target.path} (${settings.target.ref})\nNowy plik otrzyma kopię aktualnej publikacji. Istniejący poprawny landing zostanie użyty bez nadpisywania.`)) return;
    busy = true; fields.disabled = true; reload.disabled = true; report('Sprawdzam repozytorium i zapisuję ustawienia…');
    try {
      show(await request('PUT', { settings, expectedSha: current.sha }));
      try {
        localStorage.setItem('nextmed.landing.route.v1', JSON.stringify({ settings: current.settings, checkedAt: Date.now() }));
        for (const key of ['chem.landing.public.v3', 'chem.landing.public.v2', 'nextmed.site-brand.v1']) localStorage.removeItem(key);
      } catch {}
      report('Zapisano. Nowe wejście na stronę główną użyje tych ustawień. W otwartym edytorze landingu odśwież stronę przed następną publikacją.');
    } catch (error) { report(message(error), true); }
    finally { busy = false; fields.disabled = false; reload.disabled = false; }
  });
  enabled.addEventListener('change', () => { external.required = enabled.checked; });
  locationField.addEventListener('input', previewUrl); ref.addEventListener('input', previewUrl);
  reload.addEventListener('click', () => void load(true));
  byId('landing-config-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url.value); report('Skopiowano publiczny adres JSON.'); }
    catch { url.focus(); url.select(); report('Zaznaczono adres — skopiuj go ręcznie.'); }
  });
  window.NextMedAdminLanding = { load };
})();
