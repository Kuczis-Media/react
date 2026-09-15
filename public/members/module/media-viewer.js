(function initializeViewerChrome() {
  'use strict';

  const STORAGE_KEY = 'chemdisk.viewer-bar-collapsed';
  const bar = document.querySelector('.viewer-bar');
  const shell = bar?.closest('.viewer-shell');
  if (!bar || !shell) return;

  const toggle = document.createElement('button');
  toggle.className = 'viewer-bar-toggle';
  toggle.type = 'button';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 9 5 5 5-5"/></svg>';
  bar.append(toggle);

  function storedState() {
    try { return sessionStorage.getItem(STORAGE_KEY) === '1'; }
    catch { return false; }
  }

  function applyState(collapsed, persist) {
    const next = Boolean(collapsed);
    bar.classList.toggle('is-collapsed', next);
    shell.classList.toggle('viewer-bar-collapsed', next);
    toggle.setAttribute('aria-expanded', String(!next));
    toggle.setAttribute('aria-label', next ? 'Pokaż pasek narzędzi' : 'Ukryj pasek narzędzi');
    toggle.title = next ? 'Pokaż pasek' : 'Ukryj pasek';
    if (persist) {
      try { sessionStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch {}
    }
  }

  toggle.addEventListener('click', () => applyState(!bar.classList.contains('is-collapsed'), true));
  applyState(storedState(), false);
})();
