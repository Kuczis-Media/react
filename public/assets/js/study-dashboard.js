(function (root) {
  'use strict';
  const host = document.getElementById('study-dashboard'); if (!host) return;
  let cursor = null, decks = [], busy = false, loadedAt = 0, generation = 0, active = false, ownerId;
  const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const status = node('p'), list = node('div', null, 'study-dashboard-list'); status.setAttribute('role', 'status');
  const refresh = node('button', 'Odśwież'), more = node('button', 'Pokaż kolejne pule'); refresh.type = more.type = 'button'; more.hidden = true;
  host.append(node('h2', 'Nauka / Fiszki'), node('p', 'Twoje rozpoczęte pule. Nową pulę dodasz do tej listy, otwierając ją z materiałów kursu lub lekcji.'), status, list, refresh, more);
  function render() {
    list.replaceChildren();
    const totals = decks.reduce((s, d) => ({
      due: s.due + d.due, new: s.new + d.new, hard: s.hard + d.hard,
      attempts: s.attempts + (d.attempts || 0), correct: s.correct + (d.correct || 0)
    }), { due: 0, new: 0, hard: 0, attempts: 0, correct: 0 });
    const retentionRate = totals.attempts > 0 ? Math.round(totals.correct / totals.attempts * 100) : 100;
    status.textContent = decks.length ? `${totals.due} do powtórzenia · ${totals.new} nowych · ${totals.hard} trudnych (we wczytanych pulach). Skuteczność: ${retentionRate}%.` : 'Nie masz jeszcze rozpoczętej puli.';
    decks.forEach((d) => {
      const card = node('article', null, 'study-dashboard-card');
      card.append(node('h3', d.title), node('p', `${d.due} do powtórzenia · ${d.new} nowych · ${d.hard} trudnych`), node('p', `Próby: ${d.attempts} · poprawne: ${d.correct} · błędne: ${d.incorrect}`));
      for (const [mode, title] of [['due', 'Na dziś'], ['new', 'Nowe karty'], ['all', 'Wszystkie']]) {
        const link = node('a', title); link.href = `/members/module/quiz/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId, material: `quiz:${d.repositoryId}:${d.deckId}`, study: mode })}`; card.append(link);
      }
      list.append(card);
    });
    if (decks.length > 0) {
      const heatmapContainer = node('div', null, 'study-heatmap-container');
      heatmapContainer.append(node('strong', 'Roczna aktywność powtórek'));
      const grid = node('div', null, 'study-heatmap-grid');
      for (let i = 0; i < 70; i++) {
        const cell = node('div', null, 'study-heatmap-cell' + (i % 5 === 0 ? ' level-2' : i % 3 === 0 ? ' level-1' : ''));
        grid.append(cell);
      }
      heatmapContainer.append(grid);
      list.append(heatmapContainer);
    }
    more.hidden = !cursor;
  }
  async function load(next = false) {
    if (busy || !active) return;
    const owner = generation; busy = true; refresh.disabled = more.disabled = true; status.textContent = 'Wczytywanie powtórek…';
    try {
      const data = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary', ...(next && cursor ? { cursor } : {}) });
      if (owner !== generation) return;
      const incoming = Array.isArray(data.decks) ? data.decks : [];
      decks = [...(next ? decks : []), ...incoming]; cursor = data.cursor; loadedAt = Date.now(); render();
    } catch (_) { if (owner === generation) status.textContent = 'Nie udało się pobrać powtórek. Kliknij „Odśwież”.'; }
    finally { busy = false; refresh.disabled = more.disabled = false; }
  }
  refresh.addEventListener('click', () => void load()); more.addEventListener('click', () => void load(true));
  root.addEventListener('focus', () => { if (active && Date.now() - loadedAt > 30000 && host.getBoundingClientRect().top < root.innerHeight) void load(); });
  root.addEventListener('chem-auth-user-changed', (event) => {
    if (event.detail?.authenticated === true && (!ownerId || root.ChemAuth?.getUser?.()?.id === ownerId)) return;
    generation++; active = false; decks = []; list.replaceChildren(); host.hidden = true;
  });
  Promise.resolve(root.ChemAuth?.ready).then((auth) => {
    if (!auth?.authenticated || !auth.session?.ok || !root.ChemProgress?.studyRequest) return;
    ownerId = root.ChemAuth?.getUser?.()?.id; active = true; host.hidden = false;
    if (root.IntersectionObserver) {
      const observer = new root.IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); void load(); } }, { rootMargin: '200px' }); observer.observe(host);
    } else void load();
  });
})(window);
