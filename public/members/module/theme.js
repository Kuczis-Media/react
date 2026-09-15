(function initializeChemModuleTheme() {
  'use strict';

  const STORAGE_KEY = 'chem.theme';
  const root = document.documentElement;

  function safeLessonReturn(rawValue, origin = window.location.origin) {
    const raw = String(rawValue || '').trim();
    if (!raw || raw.length > 800) return '';
    try {
      const url = new URL(raw, origin);
      if (url.origin !== origin || !/^\/members\/module\/lesson\/?$/.test(url.pathname)) return '';
      const files = url.searchParams.getAll('file');
      const repositories = url.searchParams.getAll('repo');
      const materials = url.searchParams.getAll('material');
      if (files.length !== 1 || repositories.length > 1 || materials.length > 1) return '';
      const file = String(files[0] || '').trim();
      const repository = String(repositories[0] || '').trim().toLowerCase();
      const material = String(materials[0] || '').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.md$/.test(file)) return '';
      if (repository && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(repository)) return '';
      if (material && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(material)) return '';
      const safe = new URL('/members/module/lesson/', origin);
      safe.searchParams.set('file', file);
      if (repository) safe.searchParams.set('repo', repository);
      if (material) safe.searchParams.set('material', material);
      return `${safe.pathname}${safe.search}`;
    } catch (_) {
      return '';
    }
  }

  function readLessonReturn() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const values = params.getAll('lesson_return');
      return values.length === 1 ? safeLessonReturn(values[0]) : '';
    } catch (_) {
      return '';
    }
  }

  const lessonReturnUrl = readLessonReturn();

  function decorateInternalModuleLinks(scope = document) {
    if (!lessonReturnUrl) return;
    const links = [];
    if (scope?.matches?.('a[href]')) links.push(scope);
    if (scope?.querySelectorAll) links.push(...scope.querySelectorAll('a[href]'));
    links.forEach((link) => {
      try {
        const target = new URL(link.getAttribute('href'), window.location.origin);
        if (target.origin !== window.location.origin) return;
        if (!/^\/members\/module\/[^/]+\/?$/.test(target.pathname)) return;
        if (/^\/members\/module\/lesson\/?$/.test(target.pathname)) return;
        target.searchParams.set('lesson_return', lessonReturnUrl);
        link.href = `${target.pathname}${target.search}${target.hash}`;
      } catch (_) {}
    });
  }

  function applyLessonReturn() {
    if (!lessonReturnUrl || /^\/members\/module\/lesson\/?$/.test(window.location.pathname)) return;
    decorateInternalModuleLinks(document);
    document.querySelectorAll('a[href="/members/"], a[href="/members"]').forEach((link) => {
      link.href = lessonReturnUrl;
      const text = String(link.textContent || '').trim();
      if (/^wr[oó]ć\b/i.test(text)) link.textContent = 'Wróć do lekcji';
      if (/dashboard/i.test(link.getAttribute('aria-label') || '')) link.setAttribute('aria-label', 'Wróć do lekcji');
    });
    if (document.querySelector('[data-chem-lesson-return]')) return;
    const link = document.createElement('a');
    link.className = 'chem-module-lesson-return';
    link.dataset.chemLessonReturn = '';
    link.href = lessonReturnUrl;
    link.textContent = '← Wróć do lekcji';
    link.setAttribute('aria-label', 'Wróć do lekcji, z której otwarto ten materiał');
    document.body.appendChild(link);
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => decorateInternalModuleLinks(node)));
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.ChemModuleReturn = Object.freeze({
    active: Boolean(lessonReturnUrl),
    url: lessonReturnUrl,
    apply: applyLessonReturn,
    decorateLinks: decorateInternalModuleLinks,
    safeLessonReturn
  });

  function preferredTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function readTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (_) {}
    return preferredTheme();
  }

  function applyTheme(theme) {
    root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  applyTheme(readTheme());

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyLessonReturn, { once: true });
  else applyLessonReturn();

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) applyTheme(readTheme());
  });

  if (window.matchMedia) {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemTheme = () => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch (_) {}
      applyTheme(systemTheme.matches ? 'dark' : 'light');
    };
    if (typeof systemTheme.addEventListener === 'function') {
      systemTheme.addEventListener('change', handleSystemTheme);
    } else if (typeof systemTheme.addListener === 'function') {
      systemTheme.addListener(handleSystemTheme);
    }
  }
})();
