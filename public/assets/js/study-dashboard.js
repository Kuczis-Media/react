(function (root) {
  'use strict';
  const host = document.getElementById('study-dashboard'); if (!host) return;
  const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const status = el('p'), list = el('div', null, 'study-dashboard-list'); status.setAttribute('role', 'status');
  const refresh = el('button', 'Odśwież'), more = el('button', 'Następne pule →'); refresh.type = more.type = 'button'; more.hidden = true;
  const previous = el('button', '← Poprzednie pule'), paging = el('nav', null, 'study-dashboard-paging'), pageLabel = el('span');
  previous.type = 'button'; previous.disabled = true; more.dataset.studyNext = '1';
  paging.setAttribute('aria-label', 'Strony pul do nauki'); paging.append(previous, pageLabel, more);
  const manager = el('a', 'Menadżer fiszek →', 'study-open-manager-btn'); manager.href = '/members/module/flashcards/';
  const heading = el('header', null, 'study-dashboard-heading'), tools = el('div', null, 'study-dashboard-tools');
  tools.append(manager, refresh); heading.append(el('h2', 'Nauka / Fiszki'), tools); host.append(heading, status, list, paging);
  const PAGE_SIZE = 6; let page = 0;
  let decks = [], cursor = null, active = false, ownerId = '', epoch = 0, busy = false, observer;
  function visible() { return root.ChemBentoConfig ? root.ChemBentoConfig.flashcards !== false : !document.getElementById('markdown-sections'); }
  function planner() { return root.ChemStudyPlannerConfig?.enabled !== false && host.dataset.studyPlanner !== 'OFF'; }
  function render() {
    list.replaceChildren();
    const totals = decks.reduce((s, d) => { for (const key of ['due', 'new', 'hard']) s[key] += Number(d[key]) || 0; return s; }, { due: 0, new: 0, hard: 0 });
    status.textContent = decks.length ? `${totals.due} do powtórzenia · ${totals.new} nowych · ${totals.hard} trudnych (we wczytanych pulach).` : 'Otwórz pulę z kursu lub menadżera, aby rozpocząć naukę.';
    for (const d of decks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const card = el('article', null, 'study-dashboard-card');
      card.append(el('h3', d.title), el('p', planner() ? `${d.due} do powtórzenia · ${d.new} nowych · ${d.hard} trudnych` : `${d.total} kart · ${d.correct}/${d.attempts} poprawnych odpowiedzi`));
      const actions = el('div', null, 'study-deck-links');
      const mode = planner() && d.due > 0 ? 'due' : planner() && d.new > 0 ? 'new' : 'all';
      const label = mode === 'due' ? `Powtórz teraz (${d.due})` : mode === 'new' ? 'Ucz się nowych' : 'Ucz się';
      const learn = el('a', label, 'study-deck-primary');
      learn.href = `/members/module/quiz/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId, study: mode })}`; actions.append(learn);
      const browse = el('a', 'Przeglądaj', 'study-deck-manage'); browse.href = `/members/module/flashcards/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId })}`;
      actions.append(browse); card.append(actions); list.append(card);
    }
    more.hidden = false; more.disabled = busy || (!cursor && (page + 1) * PAGE_SIZE >= decks.length);
    previous.disabled = busy || page === 0; paging.hidden = !cursor && decks.length <= PAGE_SIZE;
    pageLabel.textContent = `Strona ${page + 1} · wczytano ${decks.length} pul`;
  }
  async function load(next = false) {
    if (busy || !active || !visible()) return;
    if (next && (page + 1) * PAGE_SIZE < decks.length) { page++; render(); return; }
    const version = epoch; busy = true; refresh.disabled = more.disabled = true; status.textContent = 'Wczytywanie powtórek…';
    try {
      const data = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary', ...(next && cursor ? { cursor } : {}) });
      if (version !== epoch) return;
      const unique = new Map((next ? decks : []).map((d) => [`${d.repositoryId}:${d.deckId}`, d]));
      for (const d of data.decks || []) unique.set(`${d.repositoryId}:${d.deckId}`, d);
      decks = [...unique.values()]; cursor = data.cursor; page = next ? Math.min(page + 1, Math.max(0, Math.ceil(decks.length / PAGE_SIZE) - 1)) : 0; render();
    } catch (_) { if (version === epoch) status.textContent = 'Nie udało się pobrać powtórek. Kliknij „Odśwież”.'; }
    finally { if (version === epoch) { busy = false; refresh.disabled = false; more.disabled = !cursor && (page + 1) * PAGE_SIZE >= decks.length; previous.disabled = page === 0; } }
  }
  function stop() { epoch++; active = false; busy = false; observer?.disconnect(); decks = []; cursor = null; list.replaceChildren(); host.hidden = true; }
  function start() {
    const id = root.ChemAuth?.getUser?.()?.id || '';
    if (!visible()) { stop(); return; }
    if (active && ownerId === id) return;
    stop(); ownerId = id; active = true; host.hidden = false;
    if (root.IntersectionObserver) {
      observer = new root.IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); void load(); } }, { rootMargin: '200px' }); observer.observe(host);
    } else void load();
  }
  previous.addEventListener('click', () => { if (!busy && page > 0) { page--; render(); } });
  refresh.addEventListener('click', () => void load()); more.addEventListener('click', () => void load(true));
  root.addEventListener('chem-auth-user-changed', (event) => { if (event.detail?.authenticated === true) start(); else stop(); });
  root.addEventListener('chem-bento-config-updated', () => { if (root.ChemAuth?.getUser?.()) start(); else if (!visible()) stop(); });
  root.addEventListener('chem-study-planner-updated', (event) => { host.dataset.studyPlanner = event.detail?.enabled === false ? 'OFF' : 'ON'; if (active) render(); });
  Promise.resolve(root.ChemAuth?.ready).then((auth) => { if (auth?.authenticated && auth.session?.ok && root.ChemProgress?.studyRequest) start(); });
})(window);
