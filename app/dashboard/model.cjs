'use strict';

// Pure view model. The Studio parser, publication format and material IDs remain
// the source of truth; this index adds no requests and never changes that model.
function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').trim();
}

function compileDashboard(model, adapters) {
  const usedIds = new Set(['start']);
  function container(source, key, titles, depth) {
    const path = [...titles, source.title];
    const items = (source.items || []).flatMap((item, index) => {
      const url = adapters.safeUrl(item.href);
      if (!url) return [];
      let href = url.href;
      const tracksItself = !url.external && /^\/members\/module\//.test(url.pathname);
      if (tracksItself && item.id) {
        const tracked = new URL(href, adapters.origin);
        tracked.searchParams.set('material', item.id);
        href = `${tracked.pathname}${tracked.search}${tracked.hash}`;
      }
      return [{ ...item, key: `${key}/item:${item.id || index}:${index}`, href,
        external: url.external, tracksItself, resource: adapters.classifyResource(url.pathname),
        search: normalizeText(`${path.join(' ')} ${item.title} ${item.description || ''} ${item.searchText || ''}`)
      }];
    });
    const groups = (source.groups || []).map((group, index) => (
      container(group, `${key}/group:${group.id || index}:${index}`, path, depth + 1)
    ));
    const total = items.length + groups.reduce((sum, group) => sum + group.total, 0);
    return { ...source, key, depth, items, allItems: items, groups, total, count: total };
  }
  const sections = (model.sections || []).map((section, index) => {
    const base = normalizeText(section.title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `dzial-${index + 1}`;
    let anchor = base, suffix = 2;
    while (usedIds.has(anchor)) anchor = `${base}-${suffix++}`;
    usedIds.add(anchor);
    return { ...container(section, `section:${section.id || index}:${index}`, [], -1), anchor };
  });
  return { sections, total: sections.reduce((sum, section) => sum + section.total, 0) };
}

function filterDashboard(compiled, rawQuery) {
  const query = normalizeText(rawQuery);
  if (!query) return { ...compiled, query, count: compiled.total };
  function filter(node) {
    const items = node.items.filter((item) => item.search.includes(query));
    const groups = node.groups.map(filter);
    return { ...node, items, groups, count: items.length + groups.reduce((sum, group) => sum + group.count, 0) };
  }
  const sections = compiled.sections.map(filter);
  return { ...compiled, sections, query, count: sections.reduce((sum, section) => sum + section.count, 0) };
}

function materialProgress(state, id) {
  return state?.aggregate?.nodes?.[id] || state?.records?.[id] || null;
}

function sequenceStates(group, state) {
  const items = group.allItems;
  const access = state?.access || {};
  const catalogMatches = items.every((item, index) => {
    const value = access[item.id];
    return value?.sequenceId === group.id && value.step === index + 1 && value.totalSteps === items.length;
  });
  const output = new Map();
  let firstIncomplete = null;
  items.forEach((item, index) => {
    const aggregate = materialProgress(state, item.id);
    output.set(item.key, {
      index, total: items.length,
      locked: catalogMatches ? access[item.id]?.allowed === false : Boolean(firstIncomplete),
      prerequisiteTitle: (catalogMatches ? access[item.id]?.prerequisiteTitle : '') || firstIncomplete?.title || '',
      status: aggregate?.status
    });
    if (!firstIncomplete && aggregate?.status !== 'completed') firstIncomplete = item;
  });
  return output;
}

module.exports = { compileDashboard, filterDashboard, materialProgress, normalizeText, sequenceStates };
