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
  function disclosure(label, id, cls) {
    const button = el('button', null, cls); button.type = 'button'; button.setAttribute('aria-controls', id);
    const chevron = el('span', '⌄', 'study-disclosure-chevron'); chevron.setAttribute('aria-hidden', 'true');
    button.append(el('span', label, 'study-disclosure-title'), chevron); return button;
  }
  function fold(button, panel, expanded) {
    button.setAttribute('aria-expanded', String(expanded)); panel.dataset.expanded = String(expanded);
    panel.setAttribute('aria-hidden', String(!expanded)); panel.toggleAttribute('inert', !expanded);
  }
  const toggle = disclosure('Nauka / Fiszki', 'study-dashboard-content', 'study-dashboard-toggle');
  const title = el('h2'), content = el('div', null, 'study-dashboard-collapse'), inner = el('div', null, 'study-dashboard-collapse-inner');
  const footer = el('footer', null, 'study-dashboard-footer'); content.id = 'study-dashboard-content';
  title.append(toggle); tools.append(manager); heading.append(title, tools); footer.append(refresh, paging);
  inner.append(list, footer); content.append(inner); host.append(heading, status, content); fold(toggle, content, false);
  toggle.addEventListener('click', () => fold(toggle, content, toggle.getAttribute('aria-expanded') !== 'true'));
  let expandedDeckKey = '', rows = [];
  const PAGE_SIZE = 6; let page = 0;
  let decks = [], cursor = null, active = false, ownerId = '', epoch = 0, busy = false, observer;
  function visible() { return root.ChemBentoConfig ? root.ChemBentoConfig.flashcards !== false : !document.getElementById('markdown-sections'); }
  function planner() { return root.ChemStudyPlannerConfig?.enabled !== false && host.dataset.studyPlanner !== 'OFF'; }
  function render() {
    list.replaceChildren(); rows = [];
    const totals = decks.reduce((s, d) => { for (const key of ['due', 'new', 'hard']) s[key] += Number(d[key]) || 0; return s; }, { due: 0, new: 0, hard: 0 });
    status.textContent = decks.length ? `${totals.due} do powtórzenia · ${totals.new} nowych · ${totals.hard} trudnych (we wczytanych pulach).` : 'Otwórz pulę z kursu lub menadżera, aby rozpocząć naukę.';
    for (const [index, d] of decks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).entries()) {
      const key = `${d.repositoryId}:${d.deckId}`, card = el('article', null, 'study-dashboard-card');
      const rowToggle = disclosure(d.title, `study-dashboard-deck-${index}`, 'study-dashboard-row-toggle');
      const badge = el('span', planner() ? (d.due > 0 ? `${d.due} do powtórzenia` : d.new > 0 ? `${d.new} nowych` : 'Na bieżąco') : `${d.total} kart`, 'study-dashboard-badge');
      rowToggle.insertBefore(badge, rowToggle.lastChild);
      const rowTitle = el('h3'), details = el('div', null, 'study-dashboard-collapse'), detailsInner = el('div', null, 'study-dashboard-collapse-inner');
      details.id = `study-dashboard-deck-${index}`; rowTitle.append(rowToggle); details.append(detailsInner);
      detailsInner.append(el('p', planner() ? `${d.due} do powtórzenia · ${d.new} nowych · ${d.hard} trudnych` : `${d.total} kart · ${d.correct}/${d.attempts} poprawnych odpowiedzi`));
      rows.push({ key, button: rowToggle, panel: details }); fold(rowToggle, details, key === expandedDeckKey);
      rowToggle.addEventListener('click', () => {
        expandedDeckKey = expandedDeckKey === key ? '' : key;
        for (const row of rows) fold(row.button, row.panel, row.key === expandedDeckKey);
      });
      const actions = el('div', null, 'study-deck-links');
      const mode = planner() && d.due > 0 ? 'due' : planner() && d.new > 0 ? 'new' : 'all';
      const label = mode === 'due' ? `Powtórz teraz (${d.due})` : mode === 'new' ? 'Ucz się nowych' : 'Ucz się';
      const learn = el('a', label, 'study-deck-primary');
      learn.href = `/members/module/quiz/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId, study: mode })}`; actions.append(learn);
      const browse = el('a', 'Przeglądaj', 'study-deck-manage'); browse.href = `/members/module/flashcards/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId })}`;
      const remove = el('button', 'Usuń pulę', 'study-deck-remove'); remove.type = 'button';
      remove.setAttribute('aria-label', `Usuń pulę „${d.title}” i wyzeruj swój postęp`);
      remove.addEventListener('click', () => void removePool(d, remove));
      actions.append(browse, remove); detailsInner.append(actions); card.append(rowTitle, details); list.append(card);
    }
    more.hidden = false; paging.hidden = !cursor && decks.length <= PAGE_SIZE; updateControls();
    pageLabel.textContent = `Strona ${page + 1} · wczytano ${decks.length} pul`;
  }
  function updateControls() {
    host.setAttribute('aria-busy', String(busy));
    refresh.disabled = busy; previous.disabled = busy || page === 0;
    more.disabled = busy || (!cursor && (page + 1) * PAGE_SIZE >= decks.length);
    for (const button of list.querySelectorAll('.study-deck-remove')) button.disabled = busy;
  }
  async function removePool(deck, button) {
    if (busy || !active || !visible()) return;
    if (!root.confirm(`Usunąć pulę „${deck.title}” z Twojej listy? Cały Twój postęp i terminy powtórek w tej puli zostaną wyzerowane. Fiszki pozostaną w kursie. Pula pojawi się ponownie, gdy otworzysz jej tryb nauki.`)) return;
    const version = epoch;
    busy = true; updateControls(); button.textContent = 'Usuwanie…';
    try {
      await root.ChemProgress.reset(`quiz:${deck.repositoryId}:${deck.deckId}`);
      if (version !== epoch) return;
      decks = decks.filter((d) => d.repositoryId !== deck.repositoryId || d.deckId !== deck.deckId);
      expandedDeckKey = ''; page = Math.min(page, Math.max(0, Math.ceil(decks.length / PAGE_SIZE) - 1));
      render(); status.textContent = `Usunięto pulę „${deck.title}” z listy i wyzerowano Twój postęp. ${status.textContent}`;
      (rows[0]?.button || toggle).focus();
    } catch (_) {
      if (version === epoch) status.textContent = 'Nie udało się usunąć puli. Spróbuj ponownie — pula pozostaje na liście.';
    } finally {
      if (version === epoch) { busy = false; button.textContent = 'Usuń pulę'; updateControls(); }
    }
  }
  async function load(next = false) {
    if (busy || !active || !visible()) return;
    if (next && (page + 1) * PAGE_SIZE < decks.length) { page++; render(); return; }
    const version = epoch; busy = true; updateControls(); status.textContent = 'Wczytywanie powtórek…';
    try {
      const data = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary', ...(next && cursor ? { cursor } : {}) });
      if (version !== epoch) return;
      const unique = new Map((next ? decks : []).map((d) => [`${d.repositoryId}:${d.deckId}`, d]));
      for (const d of data.decks || []) unique.set(`${d.repositoryId}:${d.deckId}`, d);
      decks = [...unique.values()]; cursor = data.cursor; page = next ? Math.min(page + 1, Math.max(0, Math.ceil(decks.length / PAGE_SIZE) - 1)) : 0; render();
    } catch (_) { if (version === epoch) status.textContent = 'Nie udało się pobrać powtórek. Kliknij „Odśwież”.'; }
    finally { if (version === epoch) { busy = false; updateControls(); } }
  }
  function stop() { epoch++; active = false; busy = false; observer?.disconnect(); decks = []; cursor = null; expandedDeckKey = ''; rows = []; fold(toggle, content, false); list.replaceChildren(); host.hidden = true; }
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
