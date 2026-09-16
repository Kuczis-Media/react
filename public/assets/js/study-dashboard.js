(function (root) {
  'use strict';
  const host = document.getElementById('study-dashboard'); if (!host) return;
  let cursor = null, decks = [], busy = false, loadedAt = 0, generation = 0, active = false, ownerId;
  const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const status = node('p'), list = node('div', null, 'study-dashboard-list'); status.setAttribute('role', 'status');
  const refresh = node('button', 'Odśwież'), more = node('button', 'Pokaż kolejne pule'); refresh.type = more.type = 'button'; more.hidden = true;
  host.append(node('h2', 'Nauka / Fiszki'), node('p', 'Twoje rozpoczęte pule. Nową pulę dodasz do tej listy, otwierając ją z materiałów kursu lub lekcji.'), status, list, refresh, more);

  function isStudyVisible() {
    if (root.ChemBentoConfig && typeof root.ChemBentoConfig === 'object') {
      return root.ChemBentoConfig.flashcards !== false;
    }
    try {
      const saved = localStorage.getItem('chem.bento-visibility');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed.flashcards !== false;
      }
    } catch (_) {}
    return true;
  }

  function getDailyGoal() {
    try {
      const saved = Number(localStorage.getItem('chem.study-daily-goal'));
      if (Number.isFinite(saved) && saved > 0) return Math.min(500, Math.round(saved));
    } catch (_) {}
    return 20;
  }

  function getCourseDecks() {
    const cards = Array.from(document.querySelectorAll('.resource-card[data-kind="quiz"]'));
    return cards.map((card) => {
      const title = card.querySelector('h3')?.textContent || 'Fiszki';
      const desc = card.querySelector('p')?.textContent || 'Zestaw fiszek kursowych.';
      const link = card.querySelector('.card-link')?.getAttribute('href') || '';
      return { title, desc, link };
    }).filter((c) => c.link);
  }

  function render() {
    list.replaceChildren();
    const totals = decks.reduce((s, d) => ({
      due: s.due + d.due, new: s.new + d.new, hard: s.hard + d.hard,
      attempts: s.attempts + (d.attempts || 0), correct: s.correct + (d.correct || 0),
      total: s.total + (d.total || (d.due + d.new + d.hard))
    }), { due: 0, new: 0, hard: 0, attempts: 0, correct: 0, total: 0 });
    const retentionRate = totals.attempts > 0 ? Math.round(totals.correct / totals.attempts * 100) : 100;
    const courseDecks = getCourseDecks();
    status.textContent = decks.length
      ? `${totals.due} do powtórzenia · ${totals.new} nowych · ${totals.hard} trudnych (we wczytanych pulach). Skuteczność: ${retentionRate}%.`
      : (courseDecks.length ? 'Nie masz jeszcze rozpoczętej puli. Wybierz zestaw z poniższej bazy fiszek, aby rozpocząć:' : 'Nie masz jeszcze rozpoczętej puli.');

    if (decks.length > 0) {
      const master = node('article', null, 'study-dashboard-master study-master-card');
      const badge = node('span', '🌟 Główny zbiór fiszek', 'study-master-badge');
      const title = node('h3', 'Wszystkie Twoje fiszki (Zbiór połączony)');
      const desc = node('p', `${totals.due} do powtórzenia dzisiaj · ${totals.new} nowych · ${totals.hard} trudnych · Łącznie fiszek: ${totals.total}`);
      const accuracy = node('p', `Skuteczność zapamiętywania: ${retentionRate}% (${totals.correct} poprawnych z ${totals.attempts} powtórek)`);
      
      const adminLimits = root.ChemProgress?.state?.()?.preferences?.studyLimits;
      const dailyGoal = getDailyGoal();
      const goalBox = node('div', null, 'study-goal-container');
      const goalLabel = node('span', `🎯 Twój cel dzienny: ${dailyGoal} powtórek${adminLimits?.maxDailyReviews ? ` (limit admina: ${adminLimits.maxDailyReviews})` : ''}`);
      const editGoalBtn = node('button', '✏️ Zmień cel', 'study-goal-edit-btn');
      editGoalBtn.type = 'button';
      editGoalBtn.addEventListener('click', () => {
        const val = root.prompt('Podaj Twój docelowy cel dzienny powtórek (np. 15, 25, 50):', String(dailyGoal));
        if (val !== null) {
          const parsed = parseInt(val, 10);
          if (parsed > 0 && parsed <= 500) {
            try { localStorage.setItem('chem.study-daily-goal', String(parsed)); } catch (_) {}
            render();
          }
        }
      });
      goalBox.append(goalLabel, editGoalBtn);

      const actions = node('div', null, 'study-master-actions');
      const targetDeck = decks.find((d) => d.due > 0) || decks.find((d) => d.new > 0) || decks[0];
      const startDue = node('a', '🔥 Rozpocznij powtórkę na dziś', 'button-primary');
      startDue.href = `/members/module/quiz/?${new URLSearchParams({ repo: targetDeck.repositoryId, quiz: targetDeck.deckId, material: `quiz:${targetDeck.repositoryId}:${targetDeck.deckId}`, study: 'due' })}`;
      const startNew = node('a', '✨ Nowe fiszki');
      const newDeck = decks.find((d) => d.new > 0) || targetDeck;
      startNew.href = `/members/module/quiz/?${new URLSearchParams({ repo: newDeck.repositoryId, quiz: newDeck.deckId, material: `quiz:${newDeck.repositoryId}:${newDeck.deckId}`, study: 'new' })}`;
      const startAll = node('a', '📚 Przeglądaj wszystkie');
      startAll.href = `/members/module/quiz/?${new URLSearchParams({ repo: targetDeck.repositoryId, quiz: targetDeck.deckId, material: `quiz:${targetDeck.repositoryId}:${targetDeck.deckId}`, study: 'all' })}`;
      actions.append(startDue, startNew, startAll);

      master.append(badge, title, desc, accuracy, goalBox, actions);
      list.append(master);
    }

    decks.forEach((d) => {
      const card = node('article', null, 'study-dashboard-card');
      card.append(node('h3', d.title), node('p', `${d.due} do powtórzenia · ${d.new} nowych · ${d.hard} trudnych`), node('p', `Próby: ${d.attempts} · poprawne: ${d.correct} · błędne: ${d.incorrect}`));
      const linkWrap = node('div', null, 'study-deck-links');
      for (const [mode, title] of [['due', 'Na dziś'], ['new', 'Nowe karty'], ['all', 'Wszystkie']]) {
        const link = node('a', title); link.href = `/members/module/quiz/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId, material: `quiz:${d.repositoryId}:${d.deckId}`, study: mode })}`; linkWrap.append(link);
      }
      const resetBtn = node('button', '↺ Resetuj postęp', 'study-deck-reset-btn');
      resetBtn.type = 'button';
      resetBtn.title = `Zresetuj postęp powtórek dla „${d.title}”`;
      resetBtn.addEventListener('click', async () => {
        if (!root.confirm(`Czy na pewno chcesz zresetować postęp powtórek dla puli „${d.title}”? Wszystkie fiszki w tej puli powrócą do stanu „Nowe”.`)) return;
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetowanie…';
        try {
          if (root.ChemProgress?.reset) {
            await root.ChemProgress.reset(`quiz:${d.repositoryId}:${d.deckId}`);
          }
          await load();
        } catch (e) {
          resetBtn.textContent = 'Błąd resetu';
          setTimeout(() => { resetBtn.disabled = false; resetBtn.textContent = '↺ Resetuj postęp'; }, 2000);
        }
      });
      card.append(linkWrap, resetBtn);
      list.append(card);
    });

    if (courseDecks.length > 0) {
      const catalogSection = node('div', null, 'study-catalog-section');
      const toggleBtn = node('button', `📚 Wielka baza fiszek (${courseDecks.length} zestawów w kursie)`, 'study-all-decks-toggle');
      toggleBtn.type = 'button';
      const catalogGrid = node('div', null, 'study-catalog-grid');
      catalogGrid.hidden = decks.length > 0;
      toggleBtn.addEventListener('click', () => {
        catalogGrid.hidden = !catalogGrid.hidden;
      });

      courseDecks.forEach((deck) => {
        const item = node('div', null, 'study-catalog-item');
        item.append(node('h4', deck.title), node('p', deck.desc));
        const studyLink = node('a', 'Ucz się tego zestawu ➔');
        studyLink.href = deck.link;
        item.append(studyLink);
        catalogGrid.append(item);
      });

      catalogSection.append(toggleBtn, catalogGrid);
      list.append(catalogSection);
    }

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
    if (busy || !active || !isStudyVisible()) return;
    const owner = generation; busy = true; refresh.disabled = more.disabled = true; status.textContent = 'Wczytywanie powtórek…';
    try {
      const data = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary', ...(next && cursor ? { cursor } : {}) });
      if (owner !== generation) return;
      const incoming = Array.isArray(data.decks) ? data.decks : [];
      decks = [...(next ? decks : []), ...incoming]; cursor = data.cursor; loadedAt = Date.now(); render();
    } catch (_) { if (owner === generation) status.textContent = 'Nie udało się pobrać powtórek. Kliknij „Odśwież”.'; }
    finally { busy = false; refresh.disabled = more.disabled = false; }
  }

  function initStudy() {
    if (!isStudyVisible()) {
      active = false;
      host.hidden = true;
      return;
    }
    ownerId = root.ChemAuth?.getUser?.()?.id;
    active = true;
    host.hidden = false;
    if (root.IntersectionObserver) {
      const observer = new root.IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      }, { rootMargin: '200px' });
      observer.observe(host);
    } else {
      void load();
    }
  }

  refresh.addEventListener('click', () => void load());
  more.addEventListener('click', () => void load(true));

  root.addEventListener('chem-auth-user-changed', (event) => {
    if (event.detail?.authenticated === true && (!ownerId || root.ChemAuth?.getUser?.()?.id === ownerId)) return;
    generation++; active = false; decks = []; list.replaceChildren(); host.hidden = true;
  });

  root.addEventListener('chem-bento-config-updated', (event) => {
    const visible = event.detail?.flashcards !== false;
    if (!visible) {
      active = false;
      host.hidden = true;
    } else if (!active && root.ChemAuth?.getUser?.() && root.ChemProgress?.studyRequest) {
      initStudy();
    }
  });

  Promise.resolve(root.ChemAuth?.ready).then((auth) => {
    if (!auth?.authenticated || !auth.session?.ok || !root.ChemProgress?.studyRequest) return;
    if (!isStudyVisible()) {
      host.hidden = true;
      return;
    }
    initStudy();
  });
})(window);
