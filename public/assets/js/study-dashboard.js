(function (root) {
  'use strict';
  const host = document.getElementById('study-dashboard'); if (!host) return;
  let cursor = null, decks = [], busy = false, loadedAt = 0, generation = 0, active = false, ownerId;
  const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const status = node('p'), list = node('div', null, 'study-dashboard-list'); status.setAttribute('role', 'status');
  const refresh = node('button', 'Odśwież'), more = node('button', 'Pokaż kolejne pule'); refresh.type = more.type = 'button'; more.hidden = true;
  const managerToggle = node('button', '📋 Przeglądaj fiszki jako listę', 'study-open-manager-btn'); managerToggle.type = 'button';
  const managerHost = node('section', null, 'study-manager-container');
  managerHost.id = 'study-flashcards-manager';
  managerHost.hidden = true;
  let managerIsOpen = null, managerActivePoolKey = null, managerFilter = 'all', managerSearchText = '', managerPoolSearchText = '';
  const managerCache = new Map(), managerSelectedCards = new Set();

  function ensureMathJax() {
    if (root.MathJax?.typesetPromise) return Promise.resolve(root.MathJax);
    if (typeof document === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const ready = () => {
        if (!root.MathJax?.typesetPromise) return;
        resolve(root.MathJax);
      };
      if (document.querySelector('script[src*="mathjax"]')) {
        root.addEventListener('chem-mathjax-ready', ready, { once: true });
        document.addEventListener('chemdisk-mathjax-ready', ready, { once: true });
        setTimeout(() => resolve(root.MathJax || null), 1500);
        return;
      }
      if (!root.MathJax) {
        root.MathJax = {
          loader: { load: ['[tex]/mhchem'] },
          tex: {
            packages: { '[+]': ['mhchem'] },
            inlineMath: [['$', '$'], ['\\(', '\\)']],
            displayMath: [['$$', '$$'], ['\\[', '\\]']]
          },
          startup: { typeset: false },
          options: { renderActions: { addMenu: [] } }
        };
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-mml-chtml.js';
      script.defer = true;
      script.onload = () => {
        Promise.resolve(root.MathJax?.startup?.promise).then(() => {
          root.dispatchEvent(new CustomEvent('chem-mathjax-ready'));
          resolve(root.MathJax);
        });
      };
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
  }

  function typeset(element) {
    if (!element) return;
    if (root.MathJax?.typesetPromise) {
      try { root.MathJax.typesetPromise([element]).catch?.(() => {}); } catch (_) {}
    } else {
      ensureMathJax().then((mj) => {
        if (mj?.typesetPromise) {
          try { mj.typesetPromise([element]).catch?.(() => {}); } catch (_) {}
        }
      }).catch?.(() => {});
    }
  }

  function toggleManager(open) {
    managerIsOpen = typeof open === 'boolean' ? open : !managerIsOpen;
    managerHost.hidden = !managerIsOpen;
    managerToggle.textContent = managerIsOpen ? '✕ Zamknij listę fiszek' : '📋 Przeglądaj fiszki jako listę';
    if (managerIsOpen) {
      renderFlashcardManager(managerHost);
      managerHost.scrollIntoView?.({ behavior: 'smooth' });
    }
  }
  managerToggle.addEventListener('click', () => toggleManager());

  const heading = node('h2', 'Nauka / Fiszki');
  const subtitle = node('p', 'Twoje rozpoczęte pule. Nową pulę dodasz do tej listy, otwierając ją z materiałów kursu lub lekcji.');
  host.append(heading, subtitle, status, list, refresh, more, managerToggle, managerHost);

  function isPlannerEnabled() {
    if (root.ChemStudyPlannerConfig && typeof root.ChemStudyPlannerConfig.enabled === 'boolean') {
      return root.ChemStudyPlannerConfig.enabled;
    }
    if (host.dataset.studyPlanner) {
      return host.dataset.studyPlanner !== 'OFF';
    }
    const rootSections = document.getElementById('markdown-sections');
    if (rootSections?.dataset?.studyPlanner) {
      return rootSections.dataset.studyPlanner !== 'OFF';
    }
    if (root.ChemProgressCatalog?.global && typeof root.ChemProgressCatalog.global.studyPlanner === 'boolean') {
      return root.ChemProgressCatalog.global.studyPlanner;
    }
    return true;
  }

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
    const plannerActive = isPlannerEnabled();
    if (!plannerActive) {
      heading.textContent = 'Baza fiszek i nauka';
      subtitle.textContent = 'Przeglądaj wszystkie fiszki z kursu, wybieraj pule i ucz się we własnym tempie. Planer powtórek na dziś jest wyłączony.';
      host.classList.add('study-browse-only-mode');
      if (managerIsOpen === null) managerIsOpen = true;
    } else {
      heading.textContent = 'Nauka / Fiszki';
      subtitle.textContent = 'Twoje rozpoczęte pule. Nową pulę dodasz do tej listy, otwierając ją z materiałów kursu lub lekcji.';
      host.classList.remove('study-browse-only-mode');
    }

    const totals = decks.reduce((s, d) => ({
      due: s.due + d.due, new: s.new + d.new, hard: s.hard + d.hard,
      attempts: s.attempts + (d.attempts || 0), correct: s.correct + (d.correct || 0),
      total: s.total + (d.total || (d.due + d.new + d.hard))
    }), { due: 0, new: 0, hard: 0, attempts: 0, correct: 0, total: 0 });
    const retentionRate = totals.attempts > 0 ? Math.round(totals.correct / totals.attempts * 100) : 100;
    const courseDecks = getCourseDecks();

    if (plannerActive) {
      status.textContent = decks.length
        ? `${totals.due} do powtórzenia · ${totals.new} nowych · ${totals.hard} trudnych (we wczytanych pulach). Skuteczność: ${retentionRate}%.`
        : (courseDecks.length ? 'Nie masz jeszcze rozpoczętej puli. Wybierz zestaw z poniższej bazy fiszek, aby rozpocząć:' : 'Nie masz jeszcze rozpoczętej puli.');
    } else {
      status.textContent = decks.length
        ? `Tryb bazy fiszek (planer powtórek wyłączony) · Dostępnych rozpoczętych pul: ${decks.length} · fiszek łącznie: ${totals.total}.`
        : (courseDecks.length ? 'Baza fiszek: wybierz zestaw z poniższej listy lub skorzystaj z przeglądarki fiszek:' : 'Brak rozpoczętych pul fiszek.');
    }

    if (decks.length > 0) {
      const master = node('article', null, 'study-dashboard-master study-master-card');
      const badge = node('span', plannerActive ? '🌟 Główny zbiór fiszek' : '📚 Baza fiszek kursu', 'study-master-badge');
      const title = node('h3', plannerActive ? 'Wszystkie Twoje fiszki (Zbiór połączony)' : 'Wszystkie Twoje fiszki w bazie');
      const desc = node('p', plannerActive
        ? `${totals.due} do powtórzenia dzisiaj · ${totals.new} nowych · ${totals.hard} trudnych · Łącznie fiszek: ${totals.total}`
        : `Łącznie fiszek: ${totals.total} · Przeglądaj pytania, odpowiedzi i ucz się we własnym tempie bez ograniczeń dziennych.`);
      const accuracy = node('p', `Skuteczność zapamiętywania: ${retentionRate}% (${totals.correct} poprawnych z ${totals.attempts} powtórek)`);
      
      let goalBox = null;
      if (plannerActive) {
        const progressState = typeof root.ChemProgress?.state === 'function'
          ? root.ChemProgress.state()
          : root.ChemProgress?.state;
        const adminLimits = progressState?.preferences?.studyLimits;
        const dailyGoal = getDailyGoal();
        goalBox = node('div', null, 'study-goal-container');
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
      }

      const actions = node('div', null, 'study-master-actions');
      const targetDeck = decks.find((d) => d.due > 0) || decks.find((d) => d.new > 0) || decks[0];
      if (plannerActive) {
        const startDue = node('a', '🔥 Rozpocznij powtórkę na dziś', 'button-primary');
        startDue.href = `/members/module/quiz/?${new URLSearchParams({ repo: targetDeck.repositoryId, quiz: targetDeck.deckId, material: `quiz:${targetDeck.repositoryId}:${targetDeck.deckId}`, study: 'due' })}`;
        const startNew = node('a', '✨ Nowe fiszki');
        const newDeck = decks.find((d) => d.new > 0) || targetDeck;
        startNew.href = `/members/module/quiz/?${new URLSearchParams({ repo: newDeck.repositoryId, quiz: newDeck.deckId, material: `quiz:${newDeck.repositoryId}:${newDeck.deckId}`, study: 'new' })}`;
        actions.append(startDue, startNew);
      }
      const startAll = node('a', plannerActive ? '📚 Przeglądaj wszystkie' : '▶ Ucz się wszystkich fiszek', plannerActive ? '' : 'button-primary');
      startAll.href = `/members/module/quiz/?${new URLSearchParams({ repo: targetDeck.repositoryId, quiz: targetDeck.deckId, material: `quiz:${targetDeck.repositoryId}:${targetDeck.deckId}`, study: 'all' })}`;
      const openManager = node('a', '📋 Przeglądaj fiszki jako listę', 'study-open-manager-btn');
      openManager.href = '#study-flashcards-manager';
      openManager.addEventListener('click', (e) => {
        e.preventDefault();
        toggleManager(true);
      });
      const openApp = node('a', '🗂 Baza fiszek (aplikacja) ↗', 'study-open-app-btn');
      openApp.href = `/members/module/flashcards/?${new URLSearchParams({ repo: targetDeck.repositoryId, quiz: targetDeck.deckId })}`;
      actions.append(startAll, openManager, openApp);

      master.append(badge, title, desc, accuracy);
      if (goalBox) master.append(goalBox);
      master.append(actions);
      list.append(master);
    }

    decks.forEach((d) => {
      const card = node('article', null, 'study-dashboard-card');
      card.append(node('h3', d.title));
      if (plannerActive) {
        card.append(node('p', `${d.due} do powtórzenia · ${d.new} nowych · ${d.hard} trudnych`), node('p', `Próby: ${d.attempts} · poprawne: ${d.correct} · błędne: ${d.incorrect}`));
      } else {
        card.append(node('p', `Liczba fiszek: ${d.total || (d.due + d.new + d.hard)} · Próby: ${d.attempts} · poprawne: ${d.correct}`));
      }
      const linkWrap = node('div', null, 'study-deck-links');
      if (plannerActive) {
        for (const [mode, title] of [['due', 'Na dziś'], ['new', 'Nowe karty'], ['all', 'Wszystkie']]) {
          const link = node('a', title); link.href = `/members/module/quiz/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId, material: `quiz:${d.repositoryId}:${d.deckId}`, study: mode })}`; linkWrap.append(link);
        }
      } else {
        const viewLink = node('button', '📋 Zobacz fiszki', 'study-deck-view-btn');
        viewLink.type = 'button';
        viewLink.addEventListener('click', () => {
          managerActivePoolKey = `quiz:${d.repositoryId}:${d.deckId}`;
          toggleManager(true);
        });
        const studyLink = node('a', '▶ Ucz się zestawu');
        studyLink.href = `/members/module/quiz/?${new URLSearchParams({ repo: d.repositoryId, quiz: d.deckId, material: `quiz:${d.repositoryId}:${d.deckId}`, study: 'all' })}`;
        linkWrap.append(viewLink, studyLink);
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

    if (decks.length > 0 && plannerActive) {
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
    const isManagerActive = Boolean(managerIsOpen);
    if (isManagerActive) renderFlashcardManager(managerHost);
    else managerHost.hidden = true;
    managerToggle.textContent = isManagerActive ? '✕ Zamknij listę fiszek' : '📋 Przeglądaj fiszki jako listę';
  }

  function getAllPools() {
    const course = getCourseDecks();
    const map = new Map();
    decks.forEach((d) => {
      const key = `${d.repositoryId}:${d.deckId}`;
      map.set(key, {
        key,
        repositoryId: d.repositoryId,
        deckId: d.deckId,
        title: d.title || 'Fiszki',
        due: d.due || 0,
        new: d.new || 0,
        hard: d.hard || 0,
        total: d.total || (d.due + d.new + d.hard),
        isStarted: true
      });
    });
    course.forEach((cd) => {
      try {
        const u = new URL(cd.link, root.location?.origin || 'http://localhost');
        const r = u.searchParams.get('repo') || 'default';
        const q = u.searchParams.get('quiz') || u.searchParams.get('id') || '';
        if (!q) return;
        const key = `${r}:${q}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            repositoryId: r,
            deckId: q,
            title: cd.title || 'Fiszki kursowe',
            desc: cd.desc || '',
            due: 0,
            new: 0,
            hard: 0,
            total: 0,
            isStarted: false
          });
        }
      } catch (_) {}
    });
    return Array.from(map.values());
  }

  async function fetchPoolData(pool) {
    const key = pool.key;
    if (managerCache.has(key)) return managerCache.get(key);

    let quiz = null;
    try {
      const token = await root.ChemAuth?.getAccessToken?.();
      const u = new URL('/.netlify/functions/quiz', root.location?.origin || 'http://localhost');
      u.searchParams.set('quiz', pool.deckId);
      u.searchParams.set('repo', pool.repositoryId);
      if (typeof root.fetch === 'function' || typeof fetch === 'function') {
        const fetchFn = typeof root.fetch === 'function' ? root.fetch : fetch;
        const res = await fetchFn(u.toString(), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
        });
        if (res.ok) {
          const payload = await res.json();
          quiz = payload.quiz;
        }
      }
    } catch (_) {}

    let studyData = {};
    try {
      if (root.ChemProgress?.studyRequest) {
        const res = await root.ChemProgress.studyRequest('GET', null, {
          view: 'study',
          repo: pool.repositoryId,
          deck: pool.deckId
        });
        studyData = res || {};
      }
    } catch (_) {}

    if (!quiz && studyData?.quiz) quiz = studyData.quiz;
    if (!quiz && pool.questions) quiz = { questions: pool.questions };

    const data = {
      quiz,
      records: studyData?.records || {},
      generation: studyData?.generation || '',
      enabled: studyData?.enabled !== false
    };
    managerCache.set(key, data);
    return data;
  }

  function extractCards(quiz) {
    if (!quiz || !Array.isArray(quiz.questions)) return [];
    if (root.ChemStudyScheduler?.cards) {
      return root.ChemStudyScheduler.cards(quiz.questions);
    }
    return quiz.questions.map((q) => ({ ...q, studyKey: q.questionId }));
  }

  function cardContent(q) {
    const front = q.prompt || q.title || 'Fiszka';
    let back = '';
    if (q.type === 'flashcard') {
      back = q.answer || q.explanation || '';
    } else if (q.type === 'single' || q.type === 'multiple') {
      const opts = Array.isArray(q.options)
        ? q.options.filter((o) => o.correct).map((o) => o.text).join(', ')
        : '';
      back = opts + (q.explanation ? (opts ? '\n' : '') + q.explanation : '');
    } else if (q.type === 'text') {
      const acc = Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers.join(' / ') : '';
      back = acc || q.answer || q.explanation || '';
    } else if (q.type === 'image_occlusion') {
      back = q.occlusion?.masks?.map((m) => m.label).filter(Boolean).join(', ') || q.explanation || 'Etykieta zasłonięta';
    } else {
      back = q.rubric || q.modelAnswer || q.answer || q.explanation || '';
    }
    return { front, back: back || '—' };
  }

  function cardStatus(r, now = Date.now()) {
    if (!r || !r.attempts) return { code: 'new', label: '⚪ Nowa', cls: 'badge-new' };
    if (r.dueAt && Date.parse(r.dueAt) <= now) return { code: 'due', label: '🟠 Do powtórzenia', cls: 'badge-due' };
    if (r.lastGrade === 2 || r.lastGrade === 1) return { code: 'hard', label: '🔴 Trudna', cls: 'badge-hard' };
    if (r.interval >= 3 && r.repetitions >= 2) return { code: 'learned', label: '🟢 Zapamiętana', cls: 'badge-learned' };
    return { code: 'learning', label: '🔵 W nauce', cls: 'badge-learning' };
  }

  async function resetCardsAction(pool, cardIds) {
    if (!cardIds.length) return;
    const key = pool.key;
    const cached = managerCache.get(key);
    let generation = cached?.generation;
    if (!generation && root.ChemProgress?.studyRequest) {
      try {
        const res = await root.ChemProgress.studyRequest('GET', null, { view: 'study', repo: pool.repositoryId, deck: pool.deckId });
        generation = res?.generation;
        if (cached) {
          cached.generation = generation;
          cached.records = res?.records || {};
        }
      } catch (_) {}
    }
    if (!generation) return;

    const reviews = cardIds.map((cardId) => ({
      eventId: (root.crypto?.randomUUID ? root.crypto.randomUUID() : `rst-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
      cardId,
      action: 'reset'
    }));

    for (let i = 0; i < reviews.length; i += 20) {
      const chunk = reviews.slice(i, i + 20);
      await root.ChemProgress.studyRequest('POST', { generation, reviews: chunk }, {
        repo: pool.repositoryId,
        deck: pool.deckId
      });
    }

    if (cached?.records) {
      cardIds.forEach((id) => { delete cached.records[id]; });
    }
    cardIds.forEach((id) => managerSelectedCards.delete(id));
  }

  function renderFlashcardManager(container) {
    const allPools = getAllPools();
    if (!allPools.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    container.replaceChildren();

    if (!managerActivePoolKey || !allPools.some((p) => p.key === managerActivePoolKey)) {
      managerActivePoolKey = allPools[0].key;
    }

    const head = node('div', null, 'study-manager-header');
    const titleBox = node('div', null, 'study-manager-title-box');
    const activePool = allPools.find((p) => p.key === managerActivePoolKey) || allPools[0];
    const openAppBtn = node('a', '↗ Otwórz w osobnym module aplikacji', 'button-secondary study-open-fullscreen-btn');
    openAppBtn.href = `/members/module/flashcards/${activePool ? `?repo=${encodeURIComponent(activePool.repositoryId)}&quiz=${encodeURIComponent(activePool.deckId)}` : ''}`;
    titleBox.append(
      node('h3', '📋 Przeglądarka i zarządzanie fiszkami (Widok listy)'),
      node('p', 'Wybierz pulę po lewej stronie, aby zobaczyć wszystkie fiszki, ich stan opanowania oraz zresetować postęp wybranych kart.'),
      openAppBtn
    );
    head.append(titleBox);

    const layout = node('div', null, 'study-manager-layout');

    // Sidebar
    const sidebar = node('aside', null, 'study-manager-sidebar');
    const sideHead = node('div', null, 'study-sidebar-head');
    sideHead.append(node('h4', 'Wszystkie pule fiszek'));
    const poolSearch = node('input', null, 'study-pool-search');
    poolSearch.type = 'search';
    poolSearch.placeholder = '🔍 Szukaj puli…';
    poolSearch.value = managerPoolSearchText;
    sideHead.append(poolSearch);

    const poolsList = node('div', null, 'study-pools-list');

    function renderPoolsList() {
      poolsList.replaceChildren();
      const norm = managerPoolSearchText.trim().toLowerCase();
      const filtered = allPools.filter((p) => !norm || p.title.toLowerCase().includes(norm) || p.deckId.toLowerCase().includes(norm));
      if (!filtered.length) {
        poolsList.append(node('p', 'Brak pasujących pul.', 'study-empty-label'));
        return;
      }
      filtered.forEach((p) => {
        const item = node('button', null, 'study-pool-item' + (p.key === managerActivePoolKey ? ' is-active' : ''));
        item.type = 'button';
        const pTitle = node('span', p.title, 'study-pool-title');
        const pBadges = node('span', null, 'study-pool-badges');
        if (p.isStarted) {
          pBadges.textContent = `${p.total} fiszek${p.due > 0 ? ` · ${p.due} do powtórki` : ''}`;
        } else {
          pBadges.textContent = 'Pula kursowa (nowa)';
        }
        item.append(pTitle, pBadges);
        item.addEventListener('click', () => {
          if (managerActivePoolKey === p.key) return;
          managerActivePoolKey = p.key;
          managerSelectedCards.clear();
          renderPoolsList();
          void renderActivePoolContent();
        });
        poolsList.append(item);
      });
    }

    poolSearch.addEventListener('input', () => {
      managerPoolSearchText = poolSearch.value;
      renderPoolsList();
    });

    sidebar.append(sideHead, poolsList);
    renderPoolsList();

    // Content Area
    const content = node('main', null, 'study-manager-content');

    async function renderActivePoolContent() {
      content.replaceChildren();
      const activePool = allPools.find((p) => p.key === managerActivePoolKey) || allPools[0];
      if (!activePool) return;

      const loadingMsg = node('p', 'Wczytywanie fiszek dla wybranej puli…', 'study-loading-msg');
      content.append(loadingMsg);

      const data = await fetchPoolData(activePool);
      content.replaceChildren();

      const cards = extractCards(data.quiz);
      const records = data.records || {};

      let countDue = 0, countLearned = 0, countLearning = 0, countNew = 0, countHard = 0;
      cards.forEach((c) => {
        const st = cardStatus(records[c.studyKey]);
        if (st.code === 'due') countDue++;
        else if (st.code === 'learned') countLearned++;
        else if (st.code === 'learning') countLearning++;
        else if (st.code === 'hard') countHard++;
        else countNew++;
      });

      const cHead = node('div', null, 'study-content-head');
      const infoBox = node('div', null, 'study-selected-info');
      
      const titleRow = node('div', null, 'study-selected-title-row');
      titleRow.append(node('h4', activePool.title, 'study-selected-title'));

      const poolSelectWrap = node('div', null, 'study-quick-select-wrap');
      const poolSelectLabel = node('label', 'Pula:', 'study-quick-select-label');
      const poolSelect = node('select', null, 'study-pool-quick-select');
      poolSelect.setAttribute('aria-label', 'Zmień pulę fiszek');
      allPools.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = `${p.isStarted ? '🗂️' : '📚'} ${p.title} (${p.isStarted ? `${p.total} fiszek` : 'kursowa'})`;
        if (p.key === activePool.key) opt.selected = true;
        poolSelect.append(opt);
      });
      poolSelect.addEventListener('change', () => {
        managerActivePoolKey = poolSelect.value;
        managerSelectedCards.clear();
        renderPoolsList();
        void renderActivePoolContent();
      });
      poolSelectWrap.append(poolSelectLabel, poolSelect);
      titleRow.append(poolSelectWrap);
      infoBox.append(titleRow);

      const badgesBox = node('div', null, 'study-selected-stats-badges');
      badgesBox.append(
        node('span', `Łącznie: ${cards.length}`, 'study-stat-badge'),
        node('span', `🟠 Do powtórzenia: ${countDue}`, 'study-stat-badge badge-due'),
        node('span', `🟢 Zapamiętane: ${countLearned}`, 'study-stat-badge badge-learned'),
        node('span', `🔵 W nauce: ${countLearning}`, 'study-stat-badge badge-learning'),
        node('span', `⚪ Nowe: ${countNew}`, 'study-stat-badge badge-new')
      );
      if (countHard > 0) badgesBox.append(node('span', `🔴 Trudne: ${countHard}`, 'study-stat-badge badge-hard'));
      infoBox.append(badgesBox);

      const deckActionsBox = node('div', null, 'study-deck-actions-box');
      const learnLink = node('a', '▶ Ucz się tej puli', 'study-learn-deck-btn');
      learnLink.href = `/members/module/quiz/?${new URLSearchParams({
        repo: activePool.repositoryId,
        quiz: activePool.deckId,
        material: `quiz:${activePool.repositoryId}:${activePool.deckId}`,
        study: countDue > 0 ? 'due' : countNew > 0 ? 'new' : 'all'
      })}`;

      const shuffleLink = node('a', '🔀 Ucz się losowo', 'study-learn-deck-btn study-learn-shuffle-btn');
      shuffleLink.href = `/members/module/quiz/?${new URLSearchParams({
        repo: activePool.repositoryId,
        quiz: activePool.deckId,
        material: `quiz:${activePool.repositoryId}:${activePool.deckId}`,
        study: countDue > 0 ? 'due' : countNew > 0 ? 'new' : 'all',
        order: 'shuffle'
      })}`;

      deckActionsBox.append(learnLink, shuffleLink);
      cHead.append(infoBox, deckActionsBox);
      content.append(cHead);

      const toolbar = node('div', null, 'study-content-toolbar');
      const cardSearch = node('input', null, 'study-card-search');
      cardSearch.type = 'search';
      cardSearch.placeholder = '🔍 Filtruj treść fiszek (pytanie i odpowiedź)…';
      cardSearch.value = managerSearchText;

      const pillsBox = node('div', null, 'study-filter-pills');
      const filters = [
        ['all', `Wszystkie (${cards.length})`],
        ['due', `🟠 Do powtórzenia (${countDue})`],
        ['learned', `🟢 Zapamiętane (${countLearned})`],
        ['learning', `🔵 W nauce (${countLearning})`],
        ['new', `⚪ Nowe (${countNew})`]
      ];
      if (countHard > 0) filters.push(['hard', `🔴 Trudne (${countHard})`]);

      filters.forEach(([fCode, fLabel]) => {
        const pill = node('button', fLabel, 'study-pill' + (managerFilter === fCode ? ' is-active' : ''));
        pill.type = 'button';
        pill.addEventListener('click', () => {
          managerFilter = fCode;
          pillsBox.querySelectorAll('.study-pill').forEach((p) => p.classList.remove('is-active'));
          pill.classList.add('is-active');
          renderCards();
        });
        pillsBox.append(pill);
      });

      toolbar.append(cardSearch, pillsBox);
      content.append(toolbar);

      const bulkBar = node('div', null, 'study-bulk-bar');
      const selectAllLabel = node('label', null, 'study-select-all-label');
      const selectAllCheckbox = node('input');
      selectAllCheckbox.type = 'checkbox';
      selectAllCheckbox.className = 'study-select-all-checkbox';
      const selectAllText = node('span', 'Zaznacz wszystkie widoczne');
      selectAllLabel.append(selectAllCheckbox, selectAllText);

      const bulkActions = node('div', null, 'study-bulk-actions');
      const learnSelectedBtn = node('button', '▶ Ucz się zaznaczonych (0)', 'study-learn-selected-btn button-primary');
      learnSelectedBtn.type = 'button';
      learnSelectedBtn.disabled = true;
      learnSelectedBtn.addEventListener('click', () => {
        const ids = Array.from(managerSelectedCards).join(',');
        if (!ids) return;
        const u = `/members/module/quiz/?${new URLSearchParams({
          repo: activePool.repositoryId,
          quiz: activePool.deckId,
          material: `quiz:${activePool.repositoryId}:${activePool.deckId}`,
          study: 'all',
          cards: ids
        })}`;
        if (root.location) root.location.href = u;
      });

      const resetSelectedBtn = node('button', '↺ Zresetuj zaznaczone (0)', 'study-bulk-reset-btn');
      resetSelectedBtn.type = 'button';
      resetSelectedBtn.disabled = true;

      const resetWholeBtn = node('button', '↺ Resetuj całą pulę', 'study-deck-reset-all-btn');
      resetWholeBtn.type = 'button';

      bulkActions.append(learnSelectedBtn, resetSelectedBtn, resetWholeBtn);
      bulkBar.append(selectAllLabel, bulkActions);
      content.append(bulkBar);

      const cardsScroll = node('div', null, 'study-cards-scrollable');
      const cardsList = node('div', null, 'study-cards-list');
      cardsScroll.append(cardsList);
      content.append(cardsScroll);

      function getVisibleCards() {
        const query = managerSearchText.trim().toLowerCase();
        return cards.filter((c) => {
          const st = cardStatus(records[c.studyKey]);
          if (managerFilter !== 'all' && st.code !== managerFilter) return false;
          if (query) {
            const { front, back } = cardContent(c);
            if (!front.toLowerCase().includes(query) && !back.toLowerCase().includes(query)) return false;
          }
          return true;
        });
      }

      function updateBulkBtn() {
        const count = managerSelectedCards.size;
        resetSelectedBtn.textContent = `↺ Zresetuj zaznaczone (${count})`;
        resetSelectedBtn.disabled = count === 0;
        learnSelectedBtn.textContent = `▶ Ucz się zaznaczonych (${count})`;
        learnSelectedBtn.disabled = count === 0;
      }

      function renderCards() {
        cardsList.replaceChildren();
        const visible = getVisibleCards();
        selectAllText.textContent = `Zaznacz wszystkie widoczne (${visible.length})`;
        selectAllCheckbox.checked = visible.length > 0 && visible.every((c) => managerSelectedCards.has(c.studyKey));

        if (!visible.length) {
          cardsList.append(node('p', 'Brak fiszek spełniających wybrane kryteria.', 'study-empty-label'));
          return;
        }

        visible.forEach((card, idx) => {
          const r = records[card.studyKey];
          const st = cardStatus(r);
          const { front, back } = cardContent(card);

          const item = node('article', null, 'study-card-item');
          item.dataset.cardId = card.studyKey;

          const cardHead = node('div', null, 'study-card-head');
          const checkLabel = node('label', null, 'study-card-checkbox-label');
          const chk = node('input');
          chk.type = 'checkbox';
          chk.className = 'study-card-checkbox';
          chk.value = card.studyKey;
          chk.checked = managerSelectedCards.has(card.studyKey);
          chk.addEventListener('change', () => {
            if (chk.checked) managerSelectedCards.add(card.studyKey);
            else managerSelectedCards.delete(card.studyKey);
            selectAllCheckbox.checked = visible.every((c) => managerSelectedCards.has(c.studyKey));
            updateBulkBtn();
          });
          checkLabel.append(chk, node('span', `#${idx + 1}`));

          const statusPill = node('span', st.label, `study-card-status-pill study-stat-badge ${st.cls}`);
          const typeTag = node('span', card.type === 'flashcard' ? 'Fiszka' : 'Pytanie kursowe', 'study-card-type-tag');

          cardHead.append(checkLabel, statusPill, typeTag);

          const body = node('div', null, 'study-card-body');
          const fBox = node('div', null, 'study-card-front');
          fBox.append(node('strong', 'Pytanie / Przód:'), node('div', front, 'card-prompt-text'));
          const bBox = node('div', null, 'study-card-back');
          bBox.append(node('strong', 'Odpowiedź / Tył:'), node('div', back, 'card-answer-text'));
          body.append(fBox, bBox);

          const foot = node('div', null, 'study-card-foot');
          const statsSpan = node('div', null, 'study-card-stats');
          if (r?.attempts) {
            const acc = Math.round((r.correct || 0) / r.attempts * 100);
            const dueLabel = r.dueAt ? new Date(r.dueAt).toLocaleDateString('pl-PL') : '—';
            statsSpan.textContent = `Próby: ${r.attempts} • Poprawne: ${r.correct || 0} • Skuteczność: ${acc}% • Powtórka: ${dueLabel}`;
          } else {
            statsSpan.textContent = 'Fiszka jeszcze nierozpoczęta (stan nowej)';
          }

          const footActions = node('div', null, 'study-card-foot-actions');
          const startCardLink = node('a', '▶ Ucz się od tej karty', 'study-card-start-btn mini-button');
          startCardLink.href = `/members/module/quiz/?${new URLSearchParams({
            repo: activePool.repositoryId,
            quiz: activePool.deckId,
            material: `quiz:${activePool.repositoryId}:${activePool.deckId}`,
            study: 'all'
          })}#${encodeURIComponent(card.studyKey)}`;
          startCardLink.title = 'Rozpocznij naukę w odtwarzaczu od tej karty';

          const resetSingleBtn = node('button', '↺ Resetuj tę fiszkę', 'study-card-reset-btn');
          resetSingleBtn.type = 'button';
          resetSingleBtn.title = 'Resetuje postęp tej jednej fiszki';
          resetSingleBtn.addEventListener('click', async () => {
            resetSingleBtn.disabled = true;
            resetSingleBtn.textContent = 'Resetowanie…';
            try {
              await resetCardsAction(activePool, [card.studyKey]);
              await renderActivePoolContent();
              renderPoolsList();
            } catch (e) {
              alert('Błąd resetu: ' + (e.message || e));
              resetSingleBtn.disabled = false;
              resetSingleBtn.textContent = '↺ Resetuj tę fiszkę';
            }
          });

          footActions.append(startCardLink, resetSingleBtn);
          foot.append(statsSpan, footActions);
          item.append(cardHead, body, foot);
          cardsList.append(item);
        });

        typeset(cardsList);
      }

      cardSearch.addEventListener('input', () => {
        managerSearchText = cardSearch.value;
        renderCards();
      });

      selectAllCheckbox.addEventListener('change', () => {
        const visible = getVisibleCards();
        if (selectAllCheckbox.checked) {
          visible.forEach((c) => managerSelectedCards.add(c.studyKey));
        } else {
          visible.forEach((c) => managerSelectedCards.delete(c.studyKey));
        }
        cardsList.querySelectorAll('.study-card-checkbox').forEach((c) => {
          c.checked = selectAllCheckbox.checked;
        });
        updateBulkBtn();
      });

      resetSelectedBtn.addEventListener('click', async () => {
        const toReset = Array.from(managerSelectedCards);
        if (!toReset.length) return;
        if (!root.confirm(`Czy na pewno chcesz zresetować ${toReset.length} zaznaczonych fiszek?`)) return;
        resetSelectedBtn.disabled = true;
        resetSelectedBtn.textContent = 'Resetowanie…';
        try {
          await resetCardsAction(activePool, toReset);
          await renderActivePoolContent();
          renderPoolsList();
        } catch (e) {
          alert('Błąd resetu: ' + (e.message || e));
          updateBulkBtn();
        }
      });

      resetWholeBtn.addEventListener('click', async () => {
        if (!root.confirm(`Czy na pewno chcesz zresetować całą pulę „${activePool.title}”? Wszystkie fiszki w tej puli wrócą do stanu „Nowe”.`)) return;
        resetWholeBtn.disabled = true;
        resetWholeBtn.textContent = 'Resetowanie…';
        try {
          const matId = `quiz:${activePool.repositoryId}:${activePool.deckId}`;
          if (root.ChemProgress?.reset) {
            await root.ChemProgress.reset(matId);
          }
          if (data) data.records = {};
          managerSelectedCards.clear();
          await renderActivePoolContent();
          renderPoolsList();
          void load(false);
        } catch (e) {
          alert('Błąd resetu: ' + (e.message || e));
          resetWholeBtn.disabled = false;
          resetWholeBtn.textContent = '↺ Resetuj całą pulę';
        }
      });

      renderCards();
      updateBulkBtn();
    }

    void renderActivePoolContent();
    layout.append(sidebar, content);
    container.append(head, layout);
  }

  async function load(next = false) {
    if (busy || !active || !isStudyVisible()) return;
    const owner = generation; busy = true; refresh.disabled = more.disabled = true; status.textContent = 'Wczytywanie powtórek…';
    try {
      const data = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary', ...(next && cursor ? { cursor } : {}) });
      if (owner !== generation) return;
      const incoming = Array.isArray(data.decks) ? data.decks : [];
      decks = [...(next ? decks : []), ...incoming]; cursor = data.cursor; loadedAt = Date.now();
      try {
        render();
      } catch (renderError) {
        console.error('[study-dashboard] render error:', renderError);
      }
    } catch (err) {
      console.error('[study-dashboard] load failed:', err);
      if (owner === generation) status.textContent = 'Nie udało się pobrać powtórek. Kliknij „Odśwież”.';
    }
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

  refresh.addEventListener('click', () => {
    cursor = null;
    void load(false);
  });
  more.addEventListener('click', () => void load(true));

  root.addEventListener('chem-auth-user-changed', (event) => {
    const currentId = root.ChemAuth?.getUser?.()?.id;
    if (event.detail?.authenticated === true && currentId) {
      if (active && ownerId === currentId) return;
      ownerId = currentId;
      initStudy();
      return;
    }
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

  root.addEventListener('chem-study-planner-updated', (event) => {
    const enabled = event.detail?.enabled !== false;
    host.dataset.studyPlanner = enabled ? 'ON' : 'OFF';
    if (active) render();
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
