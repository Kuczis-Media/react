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
    const visible = Math.min(items.length, requested);
    return {
      key,
      items: items.slice(0, visible),
      total: items.length,
      visible,
      remaining: Math.max(0, items.length - visible),
      pageSize
    };
  }

  function more(state, key, total) {
    if (!state || !state.limits) return 0;
    const current = Math.max(state.pageSize, Number(state.limits[key]) || state.pageSize);
    state.limits[key] = Math.min(Math.max(0, Number(total) || 0), current + state.pageSize);
    return state.limits[key];
  }

  function controls(documentRef, state, paged, options = {}) {
    const shell = documentRef.createElement('div');
    shell.className = 'studio-list-pagination';
    const label = options.label || 'pozycji';
    const status = documentRef.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = `Wyświetlono ${paged.visible} z ${paged.total} ${label}.`;
    shell.append(status);
    if (paged.remaining > 0) {
      const amount = Math.min(paged.pageSize, paged.remaining);
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'studio-list-more';
      button.dataset.pagedListMore = paged.key;
      button.textContent = `Pokaż więcej (${amount})`;
      button.setAttribute('aria-label', `Pokaż kolejne ${amount} z ${paged.remaining} ukrytych ${label}`);
      button.addEventListener('click', () => {
        more(state, paged.key, paged.total);
        if (typeof options.onMore === 'function') options.onMore();
      });
      shell.append(button);
    }
    return shell;
  }

  return Object.freeze({ DEFAULT_PAGE_SIZE, createState, reset, page, more, controls });
});
