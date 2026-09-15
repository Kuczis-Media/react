(async () => {
    'use strict';

    const initialParams = new URLSearchParams(location.search);
    const initialFromUrl = (initialParams.get('id') || '').trim();
    const progressApi = window.ChemProgress;
    const progressMaterialId = progressApi
      ? progressApi.materialId('quiz', initialFromUrl, initialParams.get('material') || '')
      : '';
    if (initialFromUrl) stripQuery();

    const authState = await window.ChemAuth.ready;
    if (!authState?.authenticated || !authState.session?.ok) return;

    const STORAGE_KEY = 'chemdisk.forms.v2';
    const stage = document.getElementById('stage');
    const frame = document.getElementById('form');
    const loader = document.getElementById('loader');
    const error = document.getElementById('error');
    const hint = document.getElementById('loaderHint');
    const retry = document.getElementById('retry');
    let source = '';
    let timeout = 0;

    const decode = (value) => {
      try { return decodeURIComponent(value); }
      catch { return value; }
    };

    const validId = (value) => /^[A-Za-z0-9_-]{10,200}$/.test(value || '');

    function normalizeInput(input) {
      const raw = decode(String(input || '').trim());
      if (!raw) return '';

      if (/^https?:\/\//i.test(raw)) {
        try {
          const url = new URL(raw);
          const host = url.hostname.toLowerCase();
          if (host === 'forms.gle' || host === 'www.forms.gle') {
            url.protocol = 'https:';
            url.searchParams.set('embedded', 'true');
            return url.toString();
          }
          if (host !== 'docs.google.com') return '';
          const match = url.pathname.match(/^\/forms\/d\/(e\/)?([A-Za-z0-9_-]{10,200})(?:\/|$)/i);
          if (!match) return '';
          const variant = match[1] ? 'e/' : '';
          const id = match[2];
          url.pathname = `/forms/d/${variant}${id}/viewform`;
          url.searchParams.delete('edit_requested');
          url.searchParams.set('embedded', 'true');
          url.hash = '';
          return url.toString();
        } catch { return ''; }
      }

      if (!validId(raw)) return '';
      // Publiczne identyfikatory odpowiedzi zaczynają się zwykle od 1FAIpQL;
      // pozostałe identyfikatory korzystają z wariantu /d/ (jak link z edytora).
      const variant = raw.startsWith('1FAIpQL') ? 'e/' : '';
      return `https://docs.google.com/forms/d/${variant}${encodeURIComponent(raw)}/viewform?embedded=true`;
    }

    function save(raw) {
      try { sessionStorage.setItem(STORAGE_KEY, raw); } catch {}
    }

    function load() {
      try { return sessionStorage.getItem(STORAGE_KEY) || ''; }
      catch { return ''; }
    }

    function stripQuery() {
      try { history.replaceState({}, document.title, location.pathname + location.hash); }
      catch {}
    }

    function showError() {
      window.clearTimeout(timeout);
      loader.hidden = true;
      error.hidden = false;
      stage.removeAttribute('aria-busy');
    }

    function openForm() {
      if (!source) return showError();
      window.clearTimeout(timeout);
      error.hidden = true;
      loader.hidden = false;
      retry.hidden = true;
      hint.textContent = 'To może potrwać chwilę przy wolniejszym łączu.';
      stage.classList.remove('ready');
      stage.setAttribute('aria-busy', 'true');
      frame.src = source;
      timeout = window.setTimeout(() => {
        hint.textContent = 'Formularz ładuje się dłużej niż zwykle. Sprawdź połączenie lub uprawnienia formularza.';
        retry.hidden = false;
      }, 15000);
    }

    frame.addEventListener('load', () => {
      window.clearTimeout(timeout);
      stage.classList.add('ready');
      stage.removeAttribute('aria-busy');
      loader.hidden = true;
    });
    window.addEventListener('message', (event) => {
      if (!progressApi || !progressMaterialId || event.source !== frame.contentWindow) return;
      let expectedOrigin = '';
      try { expectedOrigin = new URL(source).origin; } catch (_) {}
      if (!expectedOrigin || event.origin !== expectedOrigin || event.data?.type !== 'chemdisk:quiz') return;
      progressApi.update({
        materialId: progressMaterialId,
        materialType: 'quiz',
        action: 'quiz',
        progressPercent: Number(event.data.progressPercent) || 0,
        details: {
          started: event.data.started === true,
          completed: event.data.completed === true,
          scorePercent: event.data.scorePercent,
          attempts: event.data.attempts
        }
      }, { immediate: event.data.completed === true });
    });
    retry.addEventListener('click', openForm);

    const fromUrl = initialFromUrl;
    const raw = fromUrl || load();
    if (fromUrl) {
      save(fromUrl);
    }
    source = normalizeInput(raw);
    openForm();
  })();
