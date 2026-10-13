(function initializeStudioPagedList(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemStudioPagedList = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStudioPagedListApi() {
  'use strict';

  const DEFAULT_PAGE_SIZE = 12;

  function createState(pageSize = DEFAULT_PAGE_SIZE) {
    const normalized = Math.max(4, Math.min(100, Math.round(Number(pageSize) || DEFAULT_PAGE_SIZE)));
    return { pageSize: normalized, limits: Object.create(null) };
  }

  function reset(state, key) {
    if (!state || !state.limits) return;
    if (key) {
      delete state.limits[key];
      return;
    }
    Object.keys(state.limits).forEach((entry) => delete state.limits[entry]);
  }

  function page(state, key, source) {
    const items = Array.isArray(source) ? source : [];
    const pageSize = Math.max(1, Number(state?.pageSize) || DEFAULT_PAGE_SIZE);
    const requested = Math.max(pageSize, Number(state?.limits?.[key]) || pageSize);
    const start = Math.min(Math.max(0, requested - pageSize), Math.max(0, Math.floor((items.length - 1) / pageSize) * pageSize));
    const visible = Math.min(pageSize, items.length - start);
    return {
      key,
      items: items.slice(start, start + visible),
      start,
      end: start + visible,
      previous: start > 0,
      total: items.length,
      visible,
      remaining: Math.max(0, items.length - start - visible),
      pageSize
    };
  }

  function more(state, key, total, direction = 1) {
    if (!state || !state.limits) return 0;
    const current = Math.max(state.pageSize, Number(state.limits[key]) || state.pageSize);
    state.limits[key] = Math.max(state.pageSize, Math.min(Math.max(state.pageSize, Math.ceil((Number(total) || 0) / state.pageSize) * state.pageSize), current + state.pageSize * direction));
    return state.limits[key];
  }

  function controls(documentRef, state, paged, options = {}) {
    const shell = documentRef.createElement('div');
    shell.className = 'studio-list-pagination';
    const label = options.label || 'pozycji';
    const status = documentRef.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = `Pozycje ${paged.total ? paged.start + 1 : 0}–${paged.end} z ${paged.total} ${label}.`;
    shell.append(status);
    for (const direction of [-1, 1]) {
      if (direction < 0 ? !paged.previous : !paged.remaining) continue;
      const button = documentRef.createElement('button');
      button.type = 'button'; button.className = 'studio-list-more';
      button.dataset.pagedListMore = paged.key;
      button.textContent = direction < 0 ? 'Poprzednia strona' : 'Następna strona';
      button.addEventListener('click', () => {
        more(state, paged.key, paged.total, direction);
        options.onMore?.();
      });
      shell.append(button);
    }
    return shell;
  }

  return Object.freeze({ DEFAULT_PAGE_SIZE, createState, reset, page, more, controls });
});
