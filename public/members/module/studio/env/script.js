(function initializeEnvGenerator() {
  'use strict';

  const modelApi = window.ChemEnvModel;
  const elements = {
    access: document.getElementById('access-state'), app: document.getElementById('env-app'), list: document.getElementById('env-list'),
    template: document.getElementById('env-row-template'), output: document.getElementById('env-output'), status: document.getElementById('env-status'),
    includeEmpty: document.getElementById('env-include-empty'), search: document.getElementById('env-search'), import: document.getElementById('env-import'),
    add: document.getElementById('env-add'), defaults: document.getElementById('env-defaults'), clear: document.getElementById('env-clear'),
    copy: document.getElementById('env-copy'), copyNames: document.getElementById('env-copy-names'), download: document.getElementById('env-download'),
    outputVisibility: document.getElementById('env-output-visibility'),
    theme: document.getElementById('theme-toggle')
  };
  let entries = modelApi.defaultEntries();
  let serializedOutput = '';
  let outputMasked = true;
  let setup = null;
  let dirty = false;
  let importRevision = 0;

  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });

  async function bootstrap() {
    try {
      const authState = await window.ChemAuth.ready;
      const user = window.ChemAuth.getUser?.();
      const roles = user?.app_metadata?.roles || [];
      if (!authState?.authenticated || !authState.session?.ok || !roles.includes('admin')) throw new Error('Generator .env jest dostępny tylko dla administratora.');
      bindEvents();
      setup = window.ChemEnvSetup?.mount({
        entries: () => entries,
        setValue(name, value) {
          const existing = entries.find((entry) => entry.name === name);
          if (existing && existing.value === value) return;
          if (existing) existing.value = value;
          else entries.push({ name, value, group: 'Konfiguracja', description: 'Zmienna konfiguracji platformy.', secret: modelApi.looksSecret(name) });
          dirty = true;
        },
        onChange(markDirty = false) { if (markDirty) dirty = true; updateOutput(); },
        renderAdvanced: render
      });
      dirty = false;
      elements.access.hidden = true;
      elements.app.hidden = false;
      render();
    } catch (error) {
      elements.access.querySelector('h1').textContent = 'Brak dostępu';
      elements.access.querySelector('p').textContent = error.message;
    }
  }

  function bindEvents() {
    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return;
      event.preventDefault(); event.returnValue = '';
    });
    window.addEventListener('chem-auth-user-changed', () => {
      if ((window.ChemAuth.getUser?.()?.app_metadata?.roles || []).includes('admin')) return;
      importRevision += 1;
      dirty = false; entries = []; serializedOutput = '';
      window.NextMedUI?.releaseWithin(elements.app);
      elements.app.replaceChildren(); elements.app.hidden = true; elements.access.hidden = false;
      elements.access.querySelector('h1').textContent = 'Sesja zakończona';
      elements.access.querySelector('p').textContent = 'Zaloguj się ponownie jako administrator. Wpisane wartości zostały usunięte z formularza.';
    });
    elements.add.addEventListener('click', addEntry);
    elements.defaults.addEventListener('click', restoreDefaults);
    elements.clear.addEventListener('click', clearValues);
    elements.search.addEventListener('input', applyFilter);
    elements.includeEmpty.addEventListener('change', updateOutput);
    elements.import.addEventListener('change', importFile);
    elements.copy.addEventListener('click', () => copyText(serializedOutput, 'Skopiowano gotowy plik .env.', 'output'));
    elements.copyNames.addEventListener('click', () => {
      const names = (setup?.selectedEntries() || entries).map((entry) => String(entry.name || '').trim()).filter(Boolean).join('\n');
      return copyText(names, 'Skopiowano nazwy zmiennych.', 'names');
    });
    elements.download.addEventListener('click', downloadEnv);
    elements.outputVisibility.addEventListener('click', () => {
      outputMasked = !outputMasked;
      elements.outputVisibility.setAttribute('aria-pressed', String(!outputMasked));
      elements.outputVisibility.textContent = outputMasked ? 'Pokaż wartości' : 'Ukryj wartości';
      updateOutput();
    });
    elements.theme.addEventListener('click', () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    });
  }

  function render() {
    if (window.NextMedUI?.render('studio-env', elements.list, {
      entries, looksSecret: modelApi.looksSecret,
      onChange(entry, patch) { Object.assign(entry, patch); dirty = true; updateOutput(); setup?.updateSummary(); },
      onRemove(entry) { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); dirty = true; render(); }
    })) { applyFilter(); updateOutput(); return; }
    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
      const row = elements.template.content.firstElementChild.cloneNode(true);
      row.dataset.index = String(index);
      row.querySelector('.env-group').textContent = entry.group || 'Własna';
      row.querySelector('.env-label').textContent = entry.name || 'Nowa zmienna';
      row.querySelector('.env-description').textContent = entry.description || 'Własna zmienna środowiskowa.';
      const name = row.querySelector('.env-name');
      let value = row.querySelector('.env-value');
      if (entry.name === 'GIT_PROVIDER') {
        name.readOnly = true;
        const select = document.createElement('select');
        select.className = value.className;
        select.setAttribute('aria-label', 'Provider repozytoriów');
        for (const choice of ['', 'gitea', 'github']) {
          const option = document.createElement('option');
          option.value = choice; option.textContent = choice === 'gitea' ? 'Gitea' : choice === 'github' ? 'GitHub' : 'Wybierz dostawcę';
          select.append(option);
        }
        value.replaceWith(select);
        value = select;
      }
      const reveal = row.querySelector('.reveal-button');
      name.value = entry.name || '';
      value.value = entry.value || '';
      if (value.tagName !== 'SELECT') value.type = entry.secret ? 'password' : 'text';
      reveal.hidden = !entry.secret;
      name.addEventListener('input', () => {
        dirty = true;
        entry.name = name.value.trim();
        entry.secret = entry.secret || modelApi.looksSecret(entry.name);
        if (entry.secret) {
          value.type = 'password';
          reveal.hidden = false;
          reveal.textContent = 'Pokaż';
        }
        row.querySelector('.env-label').textContent = entry.name || 'Nowa zmienna';
        updateOutput();
      });
      value.addEventListener('input', () => { entry.value = value.value; dirty = true; updateOutput(); setup?.updateSummary(); });
      reveal.addEventListener('click', () => {
        const hidden = value.type === 'password';
        value.type = hidden ? 'text' : 'password';
        reveal.textContent = hidden ? 'Ukryj' : 'Pokaż';
      });
      row.querySelector('.remove-button').addEventListener('click', () => {
        dirty = true;
        entries.splice(index, 1);
        render();
      });
      fragment.append(row);
    });
    elements.list.replaceChildren(fragment);
    applyFilter();
    updateOutput();
  }

  function addEntry() {
    if (entries.length >= modelApi.MAX_ENTRIES) return setStatus('Limit to 100 zmiennych.', 'error');
    dirty = true;
    entries.push({ name: '', value: '', group: 'Własna', description: 'Własna zmienna środowiskowa.', secret: false, preset: false });
    render();
    const input = elements.list.querySelector('.env-row:last-child .env-name');
    input?.focus();
  }

  function restoreDefaults() {
    if (!window.confirm('Przywrócić domyślną listę? Wpisane wartości zostaną wyczyszczone.')) return;
    importRevision += 1;
    entries = modelApi.defaultEntries();
    dirty = true; setup?.refresh(true);
    render();
    setStatus('Przywrócono bezpieczny szablon projektu.', 'success');
  }

  function clearValues() {
    if (!window.confirm('Wyczyścić wszystkie wartości z tej karty?')) return;
    importRevision += 1;
    entries.forEach((entry) => { entry.value = ''; });
    const provider = entries.find((entry) => entry.name === 'GIT_PROVIDER');
    if (provider) provider.value = 'gitea';
    dirty = true; setup?.refresh(true);
    render();
    setStatus('Wartości zostały usunięte z formularza.', 'success');
  }

  async function importFile() {
    const file = elements.import.files?.[0];
    elements.import.value = '';
    if (!file) return;
    const revision = ++importRevision;
    if (file.size > modelApi.MAX_SOURCE_LENGTH) return setStatus('Plik .env przekracza 256 KB.', 'error');
    try {
      const source = await file.text();
      if (revision !== importRevision) return;
      const parsed = modelApi.parseEnv(source);
      entries = modelApi.mergeEntries(entries, parsed.entries);
      dirty = true; setup?.refresh(true);
      render();
      const warnings = [];
      if (parsed.invalidLines.length) warnings.push(`pominięte wiersze: ${parsed.invalidLines.join(', ')}`);
      if (parsed.duplicateNames.length) warnings.push(`powtórzone nazwy (zachowano ostatnią wartość): ${parsed.duplicateNames.join(', ')}`);
      setStatus(warnings.length
        ? `Zaimportowano plik; ${warnings.join('; ')}.`
        : `Zaimportowano ${parsed.entries.length} zmiennych lokalnie.`, warnings.length ? 'warning' : 'success');
    } catch (error) {
      if (revision !== importRevision) return;
      const message = error?.code === 'ENV_TOO_MANY_ENTRIES'
        ? `Po imporcie byłoby więcej niż ${modelApi.MAX_ENTRIES} zmiennych. Usuń zbędne pozycje i spróbuj ponownie.`
        : error?.code === 'ENV_SOURCE_TOO_LARGE'
          ? 'Plik .env przekracza 256 KB.'
          : 'Nie udało się odczytać tego pliku .env.';
      setStatus(message, 'error');
    }
  }

  function applyFilter() {
    const query = elements.search.value.trim().toLocaleLowerCase('pl');
    elements.list.querySelectorAll('.env-row').forEach((row) => {
      const entry = entries[Number(row.dataset.index)];
      row.hidden = Boolean(query && !`${entry?.name || ''} ${entry?.group || ''} ${entry?.description || ''}`.toLocaleLowerCase('pl').includes(query));
    });
  }

  function updateOutput() {
    const exportedEntries = setup?.selectedEntries() || entries;
    const validation = modelApi.validateEntries(exportedEntries);
    const report = setup?.inspect();
    const duplicates = new Set(validation.duplicateNames);
    elements.list.querySelectorAll('.env-row').forEach((row) => {
      const entry = entries[Number(row.dataset.index)];
      const name = String(entry?.name || '').trim();
      const invalid = Boolean((entry?.value && !name) || (name && (!modelApi.NAME_PATTERN.test(name) || duplicates.has(name))));
      row.querySelector('.env-name')?.setAttribute('aria-invalid', String(invalid));
    });
    const actions = [elements.copy, elements.copyNames, elements.download];
    if (!validation.ok || report?.errors.length) {
      serializedOutput = '';
      elements.output.value = '';
      actions.forEach((button) => { button.disabled = true; });
      setup?.updateSummary();
      if (validation.ok && report?.repositories.length === 1 && !report.repositories[0].repository && report.errors.length === 1) {
        return setStatus('Dodaj repozytorium w kroku 2, aby zobaczyć podgląd konfiguracji.', 'info');
      }
      return setStatus(!validation.ok ? validationMessage(validation) : report.errors.join(' '), 'error');
    }
    serializedOutput = modelApi.serializeEnv(exportedEntries, { includeEmpty: elements.includeEmpty.checked });
    elements.output.value = outputMasked
      ? modelApi.serializeEnv(exportedEntries, { includeEmpty: elements.includeEmpty.checked, maskSecrets: true })
      : serializedOutput;
    actions.forEach((button) => { button.disabled = !serializedOutput; });
    const filled = exportedEntries.filter((entry) => entry.name && String(entry.value || '').length > 0).length;
    setStatus(`${report?.missing.length ? 'Szablon do uzupełnienia' : 'Gotowe'}: ${exportedEntries.filter((entry) => entry.name).length} zmiennych, ${filled} z wartością.${outputMasked ? ' Sekrety w podglądzie są ukryte.' : ''}`, report?.missing.length ? 'warning' : 'success');
    setup?.updateSummary();
  }

  function validationMessage(validation) {
    if (validation.configurationErrors?.length) return validation.configurationErrors.join(' ');
    if (validation.tooMany) return `Lista ma ${validation.count} pozycji, a limit wynosi ${validation.max}. Usuń nadmiarowe wiersze.`;
    if (validation.missingNameRows.length) return `Wartość bez nazwy w wierszu: ${validation.missingNameRows.join(', ')}.`;
    if (validation.invalidNames.length) return `Niepoprawne nazwy: ${validation.invalidNames.join(', ')}.`;
    if (validation.duplicateNames.length) return `Nazwy nie mogą się powtarzać: ${validation.duplicateNames.join(', ')}.`;
    return `Tych wartości nie da się bezpiecznie zapisać w formacie .env: ${validation.unrepresentableNames.join(', ')}.`;
  }

  async function copyText(value, message, fallbackKind) {
    if (!value) return setStatus('Nie ma jeszcze nic do skopiowania.', 'error');
    try {
      await navigator.clipboard.writeText(value);
      if (fallbackKind === 'output') dirty = false;
      setStatus(message, 'success');
    } catch {
      if (legacyCopy(value)) { if (fallbackKind === 'output') dirty = false; return setStatus(message, 'success'); }
      if (fallbackKind === 'names') {
        window.prompt('Przeglądarka zablokowała schowek. Skopiuj poniższe nazwy:', value);
        return setStatus('Schowek jest zablokowany — pokazano wyłącznie nazwy zmiennych.', 'warning');
      }
      outputMasked = false;
      elements.outputVisibility.setAttribute('aria-pressed', 'true');
      elements.outputVisibility.textContent = 'Ukryj wartości';
      elements.output.value = serializedOutput;
      elements.output.focus();
      elements.output.select();
      setStatus('Przeglądarka zablokowała schowek. Wynik został odsłonięty i zaznaczony do ręcznego kopiowania.', 'warning');
    }
  }

  function legacyCopy(value) {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.readOnly = true;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    helper.remove();
    return copied;
  }

  function downloadEnv() {
    const value = serializedOutput;
    if (!value) return setStatus('Nie ma jeszcze nic do pobrania.', 'error');
    const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'platforma.env';
    document.body.append(link);
    link.click();
    link.remove();
    dirty = false;
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setStatus('Pobrano platforma.env. Lokalnie zmień nazwę na .env; w Netlify importuj pobrany plik.', 'success');
  }

  function setStatus(message, state = '') {
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  }
})();
