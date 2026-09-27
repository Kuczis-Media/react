(function () {
  'use strict';
  const model = window.ChemSetupModel;
  const steps = ['git', 'repositories', 'platform', 'services', 'finish'];
  const names = ['Dostawca Git', 'Repozytoria', 'Netlify', 'Usługi', 'Gotowe pliki'];
  const byId = (id) => document.getElementById(id);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  function mount(controller) {
    let provider = 'gitea', step = 0, advanced = false;
    let repositories = [], repositoryError = '';
    let features = { openai: false, gemini: false, payments: false, assets: false };
    let advancedBaseline = null;
    const values = () => model.valuesOf(controller.entries());
    const value = (name) => values()[name] || '';
    const set = (name, next) => controller.setValue(name, next);
    const contentTokenName = () => provider === 'github' && !value('GITHUB_CONTENT_TOKEN') && value('GITHUB_TOKEN') ? 'GITHUB_TOKEN' : model.tokenFor(provider);
    const ownTokenName = (id) => `${model.tokenFor(provider)}_${(model.slug(id) || 'KURS').replace(/-/g, '_').toUpperCase()}`;
    function featureValues(current) {
      const prefix = model.prefixFor(current.GIT_PROVIDER);
      return {
        openai: [current.OPENAI_API_KEY || ''], gemini: [current.GEMINI_API_KEY || ''],
        payments: [current.STRIPE_SECRET_KEY || '', current.STRIPE_WEBHOOK_SECRET || ''],
        assets: [current[`${prefix}_SITE_ASSETS_REPOSITORY`] || '', current[`${prefix}_SITE_ASSETS_TOKEN`] || '']
      };
    }
    function inferredFeatures(current) {
      return Object.fromEntries(Object.entries(featureValues(current)).map(([key, fields]) => [key, fields.some(Boolean)]));
    }
    function effectiveFeatures() {
      if (!advanced || !advancedBaseline) return features;
      const current = featureValues(values()), previous = featureValues(advancedBaseline);
      return Object.fromEntries(Object.keys(features).map((key) => [key,
        JSON.stringify(current[key]) === JSON.stringify(previous[key]) ? features[key] : current[key].some(Boolean)
      ]));
    }

    function commitRepositories() {
      if (repositoryError) return;
      set(model.repositoriesKey(provider), model.repositoryJson(repositories, provider));
      byId('setup-repositories-preview').textContent = model.repositoryJson(repositories, provider, true);
      byId('setup-add-repository').disabled = repositories.length >= model.MAX_REPOSITORIES;
    }
    function changed(markDirty = false) {
      controller.onChange(markDirty);
      updateSummary();
    }
    function refresh(inferFeatures = false) {
      const current = values();
      // Preserve the backend's legacy public-assets aliases during import.
      if (current.GIT_PROVIDER === 'gitea') {
        if (!current.GITEA_SITE_ASSETS_REPOSITORY && current.GITEA_ASSETS_REPO && current.GITEA_OWNER) {
          set('GITEA_SITE_ASSETS_REPOSITORY', `${current.GITEA_OWNER}/${current.GITEA_ASSETS_REPO}`);
          current.GITEA_SITE_ASSETS_REPOSITORY = `${current.GITEA_OWNER}/${current.GITEA_ASSETS_REPO}`;
        }
        if (!current.GITEA_SITE_ASSETS_BRANCH && current.GITEA_BRANCH) set('GITEA_SITE_ASSETS_BRANCH', current.GITEA_BRANCH);
      }
      provider = ['github', 'gitea'].includes(current.GIT_PROVIDER) ? current.GIT_PROVIDER : 'gitea';
      repositoryError = '';
      try { repositories = model.readRepositories(controller.entries(), provider); }
      catch (error) { repositoryError = error.message; repositories = []; }
      if (inferFeatures) features = inferredFeatures(current);
      all('[data-env-field]').forEach((input) => { input.value = value(input.dataset.envField); if (input.type === 'password' || input.parentElement.querySelector('[data-reveal-secret]')) input.type = 'password'; });
      all('[data-reveal-secret]').forEach((button) => { button.textContent = 'Pokaż'; button.setAttribute('aria-pressed', 'false'); });
      all('[data-setup-provider]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.setupProvider === provider)));
      byId('setup-gitea-fields').hidden = provider !== 'gitea';
      byId('setup-content-token').value = value(contentTokenName());
      byId('setup-content-token').type = 'password';
      const help = byId('setup-provider-help');
      help.replaceChildren(node('strong', '', provider === 'github' ? 'Uprawnienia tokenu GitHub' : 'Uprawnienia tokenu Gitea'));
      help.append(node('p', '', provider === 'github' ? 'Utwórz fine-grained token dla wybranych repozytoriów z uprawnieniem Contents: Read and write. Konto musi mieć prawo zapisu do tych repozytoriów.' : 'W ustawieniach konta Gitea otwórz Applications → Generate New Token. Nadaj prawo zapisu do repozytoriów (write:repository) i dostęp do prywatnych materiałów.'));
      const docs = node('a', '', 'Jak utworzyć token ↗');
      docs.href = provider === 'github' ? 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens' : 'https://docs.gitea.com/development/api-usage';
      docs.target = '_blank'; docs.rel = 'noopener noreferrer'; help.append(docs);
      if (!repositoryError) commitRepositories();
      if (advanced) advancedBaseline = values();
      renderRepositories(); renderAssetFields(); renderFeatures(); updateSummary();
    }
    function field(label, valueText, attrs = {}, hint = '') {
      const wrapper = node('label', 'setup-field');
      wrapper.append(node('span', '', label));
      const holder = node('span', 'setup-value');
      const input = document.createElement('input');
      input.value = valueText || ''; input.type = attrs.type || 'text'; input.autocomplete = input.type === 'password' ? 'new-password' : 'off'; input.spellcheck = false;
      for (const [key, val] of Object.entries(attrs)) input.setAttribute(key, val);
      holder.append(input);
      if (input.type === 'password') {
        const reveal = node('button', '', 'Pokaż'); reveal.type = 'button'; reveal.dataset.revealSecret = ''; reveal.setAttribute('aria-pressed', 'false'); reveal.setAttribute('aria-label', `Pokaż ${label}`); holder.append(reveal);
      }
      wrapper.append(holder);
      if (hint) wrapper.append(node('small', '', hint));
      return wrapper;
    }
    function renderRepositories() {
      const host = byId('setup-repositories');
      const opened = new Set([...host.querySelectorAll('[data-repository-index]')].filter((card) => card.querySelector('details')?.open).map((card) => card.dataset.repositoryIndex));
      host.replaceChildren();
      if (repositoryError) {
        host.append(node('p', 'setup-error', repositoryError));
        const edit = node('button', 'button', 'Popraw w edytorze zmiennych'); edit.type = 'button'; edit.addEventListener('click', () => setMode(true)); host.append(edit);
        byId('setup-repositories-preview').textContent = 'Popraw konfigurację, aby wyświetlić JSON.';
        byId('setup-add-repository').disabled = true; return;
      }
      repositories.forEach((repo, index) => {
        const card = node('article', 'setup-repository'); card.dataset.repositoryIndex = index;
        const header = node('header', 'setup-repository-header'); header.append(node('strong', '', `Repozytorium ${index + 1}`));
        const defaultLabel = node('label', 'setup-default'); const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'setup-default-repository'; radio.checked = repo.default; radio.dataset.repositoryDefault = index;
        defaultLabel.append(radio, document.createTextNode('Domyślne')); header.append(defaultLabel);
        const remove = node('button', 'text-button danger', 'Usuń'); remove.type = 'button'; remove.dataset.repositoryRemove = index; remove.disabled = repositories.length === 1; remove.setAttribute('aria-label', `Usuń repozytorium ${index + 1}`); header.append(remove); card.append(header);
        const grid = node('div', 'setup-field-grid');
        grid.append(field('Nazwa w Studio', repo.label, { 'data-repository-field': 'label', maxlength: '80' }), field('Repozytorium', repo.repository, { 'data-repository-field': 'repository', placeholder: 'moja-szkola/biologia' }, 'Wpisz właściciel/nazwa albo wklej adres repozytorium.'));
        card.append(grid);
        const details = node('details', 'setup-details'); details.open = opened.has(String(index)); details.append(node('summary', '', 'Gałąź, katalog i osobny token'));
        const advancedGrid = node('div', 'setup-field-grid');
        advancedGrid.append(field('Identyfikator biblioteki', repo.id, { 'data-repository-field': 'id', maxlength: '40' }, 'Stałe ID używane w linkach. Nie zmieniaj po udostępnieniu kursu.'), field('Gałąź', repo.ref, { 'data-repository-field': 'ref', placeholder: 'main' }), field('Katalog materiałów (opcjonalnie)', repo.root, { 'data-repository-field': 'root', placeholder: 'np. kursy/biologia' }, 'Puste oznacza katalog główny repozytorium.'));
        details.append(advancedGrid);
        const own = ![model.tokenFor(provider), 'GITHUB_TOKEN'].includes(repo.tokenEnv);
        const ownLabel = node('label', 'setup-own-token'); const ownCheck = document.createElement('input'); ownCheck.type = 'checkbox'; ownCheck.checked = own; ownCheck.dataset.repositoryOwn = index;
        ownLabel.append(ownCheck, document.createTextNode('Użyj osobnego tokenu dla tej biblioteki')); details.append(ownLabel);
        const tokenFields = node('div', 'setup-repository-token'); tokenFields.hidden = !own;
        tokenFields.append(field('Nazwa zmiennej tokenu', repo.tokenEnv, { 'data-repository-field': 'tokenEnv' }, 'W JSON zapisujemy tylko tę nazwę, nigdy token.'), field('Token tej biblioteki', value(repo.tokenEnv), { 'data-repository-secret': '', type: 'password' }));
        details.append(tokenFields); card.append(details); host.append(card);
      });
      byId('setup-repositories-preview').textContent = model.repositoryJson(repositories, provider, true);
      byId('setup-add-repository').disabled = repositories.length >= model.MAX_REPOSITORIES;
    }
    function renderAssetFields() {
      const prefix = model.prefixFor(provider);
      byId('setup-assets-fields').replaceChildren(
        field('Publiczne repozytorium', value(`${prefix}_SITE_ASSETS_REPOSITORY`), { 'data-env-field': `${prefix}_SITE_ASSETS_REPOSITORY`, placeholder: 'moja-szkola/strona-publiczna' }),
        field('Token do publicznych plików', value(`${prefix}_SITE_ASSETS_TOKEN`), { 'data-env-field': `${prefix}_SITE_ASSETS_TOKEN`, type: 'password' }, provider === 'gitea' ? 'Puste: użyj wspólnego tokenu Gitea, jeśli ma dostęp do tego repozytorium.' : 'Token z Contents: Read and write do tego repozytorium. Przy imporcie starszej konfiguracji możliwe jest użycie GITHUB_TOKEN.'),
        field('Gałąź publicznych plików', value(`${prefix}_SITE_ASSETS_${provider === 'gitea' ? 'BRANCH' : 'REF'}`), { 'data-env-field': `${prefix}_SITE_ASSETS_${provider === 'gitea' ? 'BRANCH' : 'REF'}`, placeholder: 'main' }),
        field('Katalog obrazów (opcjonalnie)', value(`${prefix}_SITE_ASSETS_DIRECTORY`), { 'data-env-field': `${prefix}_SITE_ASSETS_DIRECTORY`, placeholder: 'branding' }),
        field('Plik konfiguracji strony', value('LANDING_CONFIG_PATH'), { 'data-env-field': 'LANDING_CONFIG_PATH', placeholder: 'landing/config.json' })
      );
    }
    function renderFeatures() {
      all('[data-setup-feature]').forEach((input) => { input.checked = features[input.dataset.setupFeature]; });
      all('[data-setup-service]').forEach((section) => { section.hidden = !features[section.dataset.setupService]; });
    }
    function go(next, focus = true) {
      step = Math.max(0, Math.min(steps.length - 1, next));
      all('[data-setup-step]').forEach((button) => { if (button.dataset.setupStep === steps[step]) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
      all('[data-setup-panel]').forEach((panel) => { panel.hidden = panel.dataset.setupPanel !== steps[step]; });
      byId('setup-back').disabled = step === 0;
      byId('setup-next').hidden = step === steps.length - 1;
      byId('setup-next').textContent = `Dalej: ${names[step + 1] || ''} →`;
      byId('setup-step-counter').textContent = `Krok ${step + 1} z ${steps.length}`;
      if (focus) document.querySelector(`[data-setup-panel="${steps[step]}"] h2`)?.focus({ preventScroll: true });
      updateSummary();
    }
    function setMode(nextAdvanced) {
      if (advanced === nextAdvanced) return;
      if (!nextAdvanced) features = effectiveFeatures();
      advanced = nextAdvanced;
      if (advanced) advancedBaseline = values();
      else { advancedBaseline = null; refresh(false); }
      byId('env-guided-panel').hidden = advanced;
      byId('env-advanced-panel').hidden = !advanced;
      byId('env-guided-mode').setAttribute('aria-pressed', String(!advanced));
      byId('env-advanced-mode').setAttribute('aria-pressed', String(advanced));
      if (advanced) controller.renderAdvanced();
      else changed();
    }
    function inspect() { return model.inspect(controller.entries(), effectiveFeatures()); }
    function updateSummary() {
      const report = inspect();
      const selectedProvider = value('GIT_PROVIDER') || 'gitea';
      const summary = byId('setup-output-summary');
      const count = report.repositories.length;
      summary.replaceChildren(node('strong', '', `${selectedProvider === 'github' ? 'GitHub' : 'Gitea'} · ${count} ${count === 1 ? 'biblioteka' : count >= 2 && count <= 4 ? 'biblioteki' : 'bibliotek'}`), node('span', '', report.errors.length ? 'Uzupełnij dane repozytoriów.' : report.missing.length ? `Szablon. Pozostałe pola do uzupełnienia: ${report.missing.length}.` : 'Konfiguracja uzupełniona.'));
      summary.dataset.state = report.errors.length ? 'incomplete' : report.missing.length ? 'template' : 'ready';
      const checklist = byId('setup-checklist'); checklist.replaceChildren();
      if (!report.errors.length && !report.missing.length) checklist.append(node('p', 'setup-success', 'Wszystkie wymagane pola są uzupełnione. Po wdrożeniu sprawdź połączenia w Studio.'));
      for (const error of report.errors) checklist.append(node('p', 'setup-error', error));
      if (report.missing.length) {
        checklist.append(node('p', 'setup-note', 'Możesz pobrać szablon już teraz. Przed wdrożeniem uzupełnij:'));
        for (const item of report.missing) { const button = node('button', 'setup-check-item', item.label + ' →'); button.type = 'button'; button.addEventListener('click', () => go(steps.indexOf(item.step))); checklist.append(button); }
      }
      byId('setup-download-json').disabled = report.errors.length > 0;
    }
    function download(content, filename, mime = 'text/plain') {
      const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
      const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function guide() {
      const report = inspect();
      const selectedProvider = value('GIT_PROVIDER') || 'gitea', selectedFeatures = effectiveFeatures();
      const lines = ['# Uruchomienie platformy', '', `Dostawca materiałów: ${selectedProvider === 'github' ? 'GitHub' : 'Gitea'}.`, '', '## 1. Repozytoria materiałów', '',
        'Utwórz prywatne repozytoria z wybraną gałęzią. Skopiuj strukturę katalogów z Examples/ lub dodaj materiały w Studio.'];
      for (const repo of report.repositories) lines.push(`- ${repo.label}: ${repo.repository}, gałąź ${repo.ref || 'main'}, katalog ${repo.root || '/'}; zmienna tokenu: ${repo.tokenEnv}.`);
      lines.push('', `W .env lista repozytoriów znajduje się w ${model.repositoriesKey(selectedProvider)}. repositories.json zawiera tę samą listę bez tokenów.`, '', '## 2. Netlify', '',
        '1. Utwórz projekt z repozytorium kodu tej aplikacji.', '2. Build: npm run build; katalog publikacji: public; Functions: netlify/functions (ustawione w netlify.toml).',
        '3. Włącz Identity. Zaproś konto administratora i nadaj mu app_metadata.roles = ["admin"].',
        '4. Importuj .env w Project configuration → Environment variables → Import from a .env file. Ustaw właściwy kontekst i zakres obejmujący Functions.',
        '5. Wykonaj deploy, zaloguj się przez /login/ i przejdź do Studio → Biblioteki materiałów.', '', '## 3. Uruchomienie lokalne', '',
        'Zmień nazwę pobranego platforma.env na .env i zapisz w katalogu aplikacji, uruchom npm install, npx netlify login, npx netlify link, npm run dev. SITE_ID powinno wskazywać Twój projekt testowy.', '',
        '## 4. Usługi', '');
      if (selectedFeatures.openai || selectedFeatures.gemini) lines.push('AI: w Studio → Konfiguracja AI przypisz dostawcę do czatu i oceniania. Limity ustaw w Studio → Limity i zużycie AI.');
      if (selectedFeatures.assets) lines.push('Publiczne logo i landing: użyj oddzielnego publicznego repozytorium. W Studio → Publikacja strony wybierz źródło. Logo i treści ustaw w edytorze strony głównej.');
      if (selectedFeatures.payments) lines.push('Stripe: zacznij w trybie testowym; dodaj webhook https://TWOJA-DOMENA/.netlify/functions/stripe-webhook ze zdarzeniami checkout.session.completed i checkout.session.async_payment_succeeded. Wpisz jego whsec_… w ENV. Ceny ustaw w Studio → Płatności.');
      if (report.missing.length) lines.push('', '## Pola do uzupełnienia', '', ...report.missing.map((item) => `- ${item.label}`));
      if (report.errors.length) lines.push('', '## Konfiguracja wymagająca poprawy', '', ...report.errors.map((error) => `- ${error}`));
      lines.push('', 'Plik .env zawiera sekrety. Nie dodawaj go do repozytorium ani katalogu public/. Pobranie plików nie tworzy repozytoriów i nie wdraża platformy.', '', 'Dokumentacja projektu: readme.md, GITEA_SETUP.md, SETUP.md.', '');
      return lines.join('\n');
    }
    document.addEventListener('click', (event) => {
      const reveal = event.target.closest('[data-reveal-secret]');
      if (reveal) {
        const input = reveal.parentElement.querySelector('input'); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; reveal.textContent = show ? 'Ukryj' : 'Pokaż'; reveal.setAttribute('aria-pressed', String(show)); return;
      }
      const tab = event.target.closest('[data-setup-step]'); if (tab) { go(steps.indexOf(tab.dataset.setupStep)); return; }
      const providerButton = event.target.closest('[data-setup-provider]');
      if (providerButton) {
        provider = providerButton.dataset.setupProvider; set('GIT_PROVIDER', provider); refresh(false); changed(); return;
      }
      const remove = event.target.closest('[data-repository-remove]');
      if (remove && repositories.length > 1) {
        const index = Number(remove.dataset.repositoryRemove); const repo = repositories[index];
        if (repo.repository && !window.confirm(`Usunąć „${repo.label}” z konfiguracji? Repozytorium na serwerze pozostanie bez zmian.`)) return;
        repositories.splice(index, 1); if (!repositories.some((item) => item.default)) repositories[0].default = true;
        commitRepositories(); renderRepositories(); changed();
      }
    });
    document.addEventListener('input', (event) => {
      const input = event.target;
      if (input.dataset.envField) { set(input.dataset.envField, input.value); changed(); return; }
      if (input.id === 'setup-content-token') { set(contentTokenName(), input.value); changed(); return; }
      const card = input.closest('[data-repository-index]'); if (!card) return;
      const repo = repositories[Number(card.dataset.repositoryIndex)]; if (!repo) return;
      if (input.hasAttribute('data-repository-secret')) { set(repo.tokenEnv, input.value); changed(); return; }
      const key = input.dataset.repositoryField;
      if (key) {
        if (key === 'id' && repo.tokenEnv === ownTokenName(repo.id)) {
          const secret = value(repo.tokenEnv); repo.tokenEnv = ownTokenName(input.value); set(repo.tokenEnv, secret);
          const tokenNameInput = card.querySelector('[data-repository-field="tokenEnv"]'); if (tokenNameInput) tokenNameInput.value = repo.tokenEnv;
        }
        repo[key] = input.value;
        commitRepositories(); changed();
      }
    });
    document.addEventListener('change', (event) => {
      const input = event.target;
      if (input.dataset.setupFeature) { features[input.dataset.setupFeature] = input.checked; renderFeatures(); changed(true); return; }
      if (input.hasAttribute('data-repository-default')) {
        repositories.forEach((repo, index) => { repo.default = index === Number(input.dataset.repositoryDefault); }); commitRepositories(); changed(); return;
      }
      if (input.hasAttribute('data-repository-own')) {
        const repo = repositories[Number(input.dataset.repositoryOwn)]; repo.tokenEnv = input.checked ? ownTokenName(repo.id) : contentTokenName(); commitRepositories(); renderRepositories(); changed(); return;
      }
      if (input.dataset.repositoryField === 'repository') {
        const repo = repositories[Number(input.closest('[data-repository-index]').dataset.repositoryIndex)]; repo.repository = model.normalizeRepository(input.value, provider, value('GITEA_BASE_URL')); input.value = repo.repository; commitRepositories(); changed();
      }
      if (input.dataset.repositoryField === 'tokenEnv') {
        const repo = repositories[Number(input.closest('[data-repository-index]').dataset.repositoryIndex)]; input.closest('[data-repository-index]').querySelector('[data-repository-secret]').value = value(repo.tokenEnv);
      }
    });
    byId('setup-add-repository').addEventListener('click', () => {
      if (repositories.length >= model.MAX_REPOSITORIES || repositoryError) return;
      let index = repositories.length; while (repositories.some((repo) => repo.id === `kurs-${index + 1}`)) index++;
      repositories.push(model.blankRepository(provider, index)); commitRepositories(); renderRepositories(); changed();
      byId('setup-repositories').lastElementChild?.querySelector('input[data-repository-field]')?.focus();
    });
    byId('setup-back').addEventListener('click', () => go(step - 1));
    byId('setup-next').addEventListener('click', () => go(step + 1));
    byId('env-guided-mode').addEventListener('click', () => setMode(false));
    byId('env-advanced-mode').addEventListener('click', () => setMode(true));
    byId('setup-download-json').addEventListener('click', () => {
      const report = inspect(); if (report.errors.length) return;
      download(model.repositoryJson(report.repositories, value('GIT_PROVIDER'), true) + '\n', 'repositories.json', 'application/json');
    });
    byId('setup-download-guide').addEventListener('click', () => download(guide(), 'URUCHOMIENIE.md', 'text/markdown'));
    refresh(true); go(0, false);
    return { refresh, inspect, updateSummary, selectedEntries: () => model.selectedEntries(controller.entries(), effectiveFeatures()), isAdvanced: () => advanced, guide };
  }
  window.ChemEnvSetup = { mount };
})();
