(function (root) {
  'use strict';

  const elements = {
    loading: document.getElementById('flashcards-loading'),
    error: document.getElementById('flashcards-error'),
    errorMessage: document.getElementById('flashcards-error-message'),
    workspace: document.getElementById('flashcards-workspace'),
    poolsList: document.getElementById('pools-list'),
    poolsCount: document.getElementById('pools-count'),
    poolSearchInput: document.getElementById('pool-search-input'),
    activePoolTitle: document.getElementById('active-pool-title'),
    activePoolDesc: document.getElementById('active-pool-desc'),
    btnStudyPool: document.getElementById('btn-study-pool'),
    btnOrderToggle: document.getElementById('btn-study-order-toggle'),
    btnShuffle: document.getElementById('btn-study-shuffle'),
    poolStatsStrip: document.getElementById('pool-stats-strip'),
    filterPills: document.getElementById('filter-pills'),
    cardSearchInput: document.getElementById('card-search-input'),
    cardsContainer: document.getElementById('cards-container'),
    btnSelectAll: document.getElementById('btn-select-all'),
    bulkSelectedLabel: document.getElementById('bulk-selected-label'),
    btnStudySelected: document.getElementById('btn-study-selected'),
    btnResetSelected: document.getElementById('btn-reset-selected'),
    btnResetWholePool: document.getElementById('btn-reset-whole-pool'),
    syncStatus: document.getElementById('flashcards-sync-status'),
    themeToggle: document.getElementById('theme-toggle')
  };

  let state = {
    authenticatedUser: null,
    pools: [],
    activePoolKey: null,
    activePoolData: null,
    poolSearch: '',
    cardFilter: 'all',
    cardSearch: '',
    selectedCards: new Set(),
    isShuffleOrder: false,
    cache: new Map()
  };

  function setStatus(text) {
    if (elements.syncStatus) elements.syncStatus.textContent = text || '';
  }

  function showError(msg) {
    elements.loading.hidden = true;
    elements.workspace.hidden = true;
    elements.error.hidden = false;
    elements.errorMessage.textContent = msg || 'Nieznany błąd.';
  }

  function typeset(scope) {
    if (!scope) return;
    if (root.MathJax?.typesetPromise) {
      try { root.MathJax.typesetPromise([scope]).catch(() => {}); } catch (_) {}
    }
  }

  function cardStatus(r, now = Date.now()) {
    if (!r || !r.attempts) return { code: 'new', label: '⚪ Nowa', cls: 'flashcards-badge-new' };
    if (r.dueAt && Date.parse(r.dueAt) <= now) return { code: 'due', label: '🟠 Do powtórki', cls: 'flashcards-badge-due' };
    if (r.lastGrade === 2 || r.lastGrade === 1) return { code: 'hard', label: '🔴 Trudna', cls: 'flashcards-badge-hard' };
    if (r.interval >= 3 && r.repetitions >= 2) return { code: 'learned', label: '🟢 Zapamiętana', cls: 'flashcards-badge-learned' };
    return { code: 'learning', label: '🔵 W nauce', cls: 'flashcards-badge-learning' };
  }

  function extractCardText(q) {
    const front = q.prompt || q.title || (q.front && (q.front.text || q.front)) || 'Fiszka';
    let back = '';
    if (q.type === 'flashcard') {
      back = q.answer || q.explanation || (q.back && (q.back.text || q.back)) || '';
    } else if (q.type === 'single' || q.type === 'multiple') {
      const opts = Array.isArray(q.options) ? q.options.filter((o) => o.correct).map((o) => o.text).join(', ') : '';
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

  async function fetchPoolQuizData(pool) {
    const key = pool.key;
    if (state.cache.has(key)) return state.cache.get(key);

    setStatus('Wczytuję dane puli…');
    let quiz = null;
    try {
      const token = await root.ChemAuth?.getAccessToken?.();
      const u = new URL('/.netlify/functions/quiz', root.location?.origin || 'http://localhost');
      u.searchParams.set('quiz', pool.deckId);
      u.searchParams.set('repo', pool.repositoryId);
      const res = await fetch(u.toString(), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        const payload = await res.json();
        quiz = payload.quiz;
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
    state.cache.set(key, data);
    setStatus('');
    return data;
  }

  async function loadInitialPools() {
    setStatus('Pobieram listę pul…');
    let summaryDecks = [];
    try {
      if (root.ChemProgress?.studyRequest) {
        const res = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary' });
        summaryDecks = Array.isArray(res?.decks) ? res.decks : [];
      }
    } catch (e) {
      console.warn('[flashcards] studyRequest failed:', e);
    }

    const map = new Map();
    summaryDecks.forEach((d) => {
      const key = `quiz:${d.repositoryId}:${d.deckId}`;
      map.set(key, { ...d, key, isStarted: true });
    });

    // Discover any additional course decks from dashboard.md
    try {
      const dRes = await fetch('/members/dashboard.md');
      if (dRes.ok) {
        const md = await dRes.text();
        const quizMatches = md.matchAll(/\[([^\]]+)\]\(\/members\/module\/(?:quiz|flashcards)\/\?([^)\s]+)\)/g);
        for (const match of quizMatches) {
          const title = match[1];
          const query = new URLSearchParams(match[2]);
          const repo = query.get('repo');
          const quiz = query.get('quiz');
          if (repo && quiz) {
            const key = `quiz:${repo}:${quiz}`;
            if (!map.has(key)) {
              map.set(key, {
                key,
                repositoryId: repo,
                deckId: quiz,
                title: title || `Zestaw: ${quiz}`,
                desc: 'Zestaw fiszek kursowych.',
                due: 0, new: 0, hard: 0, total: 0, isStarted: false
              });
            }
          }
        }
      }
    } catch (_) {}

    // Check URL params
    const params = new URLSearchParams(window.location.search);
    const paramRepo = params.get('repo');
    const paramQuiz = params.get('quiz') || params.get('deck');

    if (paramRepo && paramQuiz) {
      const targetKey = `quiz:${paramRepo}:${paramQuiz}`;
      if (!map.has(targetKey)) {
        map.set(targetKey, {
          key: targetKey,
          repositoryId: paramRepo,
          deckId: paramQuiz,
          title: `Zestaw: ${paramQuiz}`,
          desc: 'Zestaw fiszek kursowych.',
          due: 0, new: 0, hard: 0, total: 0, isStarted: false
        });
      }
      state.activePoolKey = targetKey;
    }

    state.pools = Array.from(map.values());
    if (!state.activePoolKey && state.pools.length > 0) {
      state.activePoolKey = state.pools[0].key;
    }

    elements.loading.hidden = true;
    elements.workspace.hidden = false;
    renderPoolsSidebar();
    if (state.activePoolKey) {
      await switchActivePool(state.activePoolKey);
    } else {
      elements.activePoolTitle.textContent = 'Brak dostępnych pul fiszek';
      elements.activePoolDesc.textContent = 'Gdy otworzysz pierwszą lekcję lub quiz z fiszkami, pojawi się on tutaj automatycznie.';
    }
  }

  function renderPoolsSidebar() {
    elements.poolsList.replaceChildren();
    const query = state.poolSearch.trim().toLowerCase();
    const filtered = state.pools.filter((p) => {
      if (!query) return true;
      return (p.title || '').toLowerCase().includes(query) || (p.deckId || '').toLowerCase().includes(query);
    });

    elements.poolsCount.textContent = `${state.pools.length} ${state.pools.length === 1 ? 'pula' : 'pul'}`;

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'flashcards-empty-card';
      empty.textContent = 'Brak pasujących pul.';
      elements.poolsList.append(empty);
      return;
    }

    filtered.forEach((p) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'flashcards-pool-item' + (p.key === state.activePoolKey ? ' is-active' : '');
      const title = document.createElement('h4');
      title.textContent = p.title || p.deckId;
      const desc = document.createElement('p');
      desc.textContent = p.desc || p.deckId;
      const badges = document.createElement('div');
      badges.className = 'flashcards-pool-badges';
      if (p.due > 0) {
        const b = document.createElement('span'); b.className = 'flashcards-badge-due'; b.textContent = `${p.due} do powtórki`;
        badges.append(b);
      }
      if (p.new > 0) {
        const b = document.createElement('span'); b.className = 'flashcards-badge-new'; b.textContent = `${p.new} nowych`;
        badges.append(b);
      }
      item.append(title, desc, badges);
      item.addEventListener('click', () => switchActivePool(p.key));
      elements.poolsList.append(item);
    });
  }

  async function switchActivePool(key) {
    state.activePoolKey = key;
    state.selectedCards.clear();
    renderPoolsSidebar();

    const pool = state.pools.find((p) => p.key === key);
    if (!pool) return;

    elements.activePoolTitle.textContent = pool.title || pool.deckId;
    elements.activePoolDesc.textContent = pool.desc || 'Zestaw fiszek kursowych.';

    // Setup study link
    const studyUrl = `/members/module/quiz/?${new URLSearchParams({
      repo: pool.repositoryId,
      quiz: pool.deckId,
      material: pool.key,
      study: 'all',
      ...(state.isShuffleOrder ? { study_order: 'shuffle' } : {})
    })}`;
    elements.btnStudyPool.href = studyUrl;

    const data = await fetchPoolQuizData(pool);
    state.activePoolData = data;
    renderPoolContent(pool, data);
  }

  function renderPoolContent(pool, data) {
    const quiz = data?.quiz;
    const records = data?.records || {};
    const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];

    // Calculate stats
    let learned = 0, learning = 0, dueCount = 0, newCount = 0, hardCount = 0;
    const now = Date.now();
    questions.forEach((q) => {
      const rec = records[q.questionId];
      const st = cardStatus(rec, now);
      if (st.code === 'learned') learned++;
      else if (st.code === 'due') dueCount++;
      else if (st.code === 'hard') hardCount++;
      else if (st.code === 'learning') learning++;
      else newCount++;
    });

    // Render Stats Strip
    elements.poolStatsStrip.replaceChildren();
    const stats = [
      { label: `Razem: ${questions.length}`, cls: '' },
      { label: `🟢 Zapamiętane: ${learned}`, cls: 'flashcards-badge-learned' },
      { label: `🔵 W nauce: ${learning}`, cls: 'flashcards-badge-learning' },
      { label: `⚪ Nowe: ${newCount}`, cls: 'flashcards-badge-new' },
      { label: `🔴 Trudne: ${hardCount}`, cls: 'flashcards-badge-hard' },
      { label: `🟠 Do powtórki: ${dueCount}`, cls: 'flashcards-badge-due' }
    ];
    stats.forEach((s) => {
      const b = document.createElement('span');
      b.className = 'flashcards-stat-badge ' + s.cls;
      b.textContent = s.label;
      elements.poolStatsStrip.append(b);
    });

    renderCardsList(pool, questions, records);
    updateBulkControls(pool, questions);
  }

  function renderCardsList(pool, questions, records) {
    elements.cardsContainer.replaceChildren();

    const query = state.cardSearch.trim().toLowerCase();
    const filter = state.cardFilter;
    const now = Date.now();

    const filtered = questions.filter((q, idx) => {
      const text = extractCardText(q);
      const st = cardStatus(records[q.questionId], now);
      if (filter !== 'all' && st.code !== filter) return false;
      if (query) {
        const full = `${text.front} ${text.back} ${q.questionId}`.toLowerCase();
        if (!full.includes(query)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'flashcards-empty-card';
      empty.textContent = questions.length === 0
        ? 'Ta pula nie zawiera jeszcze żadnych pytań ani fiszek.'
        : 'Brak fiszek spełniających wybrane kryteria wyszukiwania.';
      elements.cardsContainer.append(empty);
      return;
    }

    filtered.forEach((q, index) => {
      const cardId = q.questionId;
      const text = extractCardText(q);
      const st = cardStatus(records[cardId], now);

      const item = document.createElement('article');
      item.className = 'flashcards-card-item';
      item.dataset.cardId = cardId;

      // Top row: Checkbox, ID, Status Badge
      const top = document.createElement('div');
      top.className = 'flashcards-card-top';

      const checkWrap = document.createElement('label');
      checkWrap.className = 'flashcards-card-check-wrap';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'flashcards-card-checkbox';
      checkbox.checked = state.selectedCards.has(cardId);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedCards.add(cardId);
        else state.selectedCards.delete(cardId);
        updateBulkControls(pool, questions);
      });
      const idLabel = document.createElement('span');
      idLabel.className = 'flashcards-card-id';
      idLabel.textContent = `#${index + 1} (${cardId})`;
      checkWrap.append(checkbox, idLabel);

      const badge = document.createElement('span');
      badge.className = 'flashcards-stat-badge ' + st.cls;
      badge.textContent = st.label;
      top.append(checkWrap, badge);

      // Body: Front & Back
      const body = document.createElement('div');
      body.className = 'flashcards-card-body';

      const front = document.createElement('div');
      front.className = 'flashcards-card-front';
      const frontLabel = document.createElement('strong');
      frontLabel.textContent = 'Pytanie / Przód';
      const frontContent = document.createElement('div');
      frontContent.textContent = text.front;
      front.append(frontLabel, frontContent);

      const back = document.createElement('div');
      back.className = 'flashcards-card-back';
      const backLabel = document.createElement('strong');
      backLabel.textContent = 'Odpowiedź / Tył';
      const backContent = document.createElement('div');
      backContent.textContent = text.back;
      back.append(backLabel, backContent);

      body.append(front, back);

      // Actions: Start from this card, Reset single card
      const actions = document.createElement('div');
      actions.className = 'flashcards-card-actions';

      const startBtn = document.createElement('button');
      startBtn.type = 'button';
      startBtn.className = 'flashcards-card-start-btn';
      startBtn.textContent = '▶ Ucz się od tej karty';
      startBtn.addEventListener('click', () => {
        const u = `/members/module/quiz/?${new URLSearchParams({
          repo: pool.repositoryId,
          quiz: pool.deckId,
          material: pool.key,
          study: 'all',
          study_start: cardId,
          ...(state.isShuffleOrder ? { study_order: 'shuffle' } : {})
        })}`;
        window.location.assign(u);
      });

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'flashcards-card-reset-btn';
      resetBtn.textContent = '↺ Resetuj postęp karty';
      resetBtn.addEventListener('click', async () => {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetuję…';
        await resetSingleCard(pool, cardId);
        await switchActivePool(pool.key);
      });

      actions.append(startBtn, resetBtn);
      item.append(top, body, actions);
      elements.cardsContainer.append(item);
    });

    typeset(elements.cardsContainer);
  }

  function updateBulkControls(pool, questions) {
    const selCount = state.selectedCards.size;
    elements.bulkSelectedLabel.textContent = `Zaznaczono: ${selCount} kart`;
    elements.btnStudySelected.disabled = selCount === 0;
    elements.btnStudySelected.textContent = `▶ Ucz się wybranych (${selCount})`;
    elements.btnResetSelected.disabled = selCount === 0;

    const allChecked = questions.length > 0 && questions.every((q) => state.selectedCards.has(q.questionId));
    elements.btnSelectAll.textContent = allChecked ? 'Odznacz wszystkie' : 'Zaznacz wszystkie';
  }

  async function resetSingleCard(pool, cardId) {
    if (!root.ChemProgress?.studyRequest) return;
    try {
      const data = state.activePoolData;
      let generation = data?.generation;
      if (!generation) {
        const res = await root.ChemProgress.studyRequest('GET', null, { view: 'study', repo: pool.repositoryId, deck: pool.deckId });
        generation = res?.generation;
      }
      if (!generation) return;
      await root.ChemProgress.studyRequest('POST', {
        generation,
        reviews: [{
          eventId: `rst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cardId,
          action: 'reset'
        }]
      }, { repo: pool.repositoryId, deck: pool.deckId });
      state.cache.delete(pool.key);
    } catch (e) {
      alert('Błąd resetu karty: ' + (e.message || e));
    }
  }

  async function resetSelectedCards(pool) {
    const ids = Array.from(state.selectedCards);
    if (!ids.length) return;
    if (!confirm(`Czy na pewno chcesz zresetować postęp dla ${ids.length} zaznaczonych fiszek?`)) return;

    elements.btnResetSelected.disabled = true;
    elements.btnResetSelected.textContent = 'Resetuję…';
    try {
      const data = state.activePoolData;
      let generation = data?.generation;
      if (!generation && root.ChemProgress?.studyRequest) {
        const res = await root.ChemProgress.studyRequest('GET', null, { view: 'study', repo: pool.repositoryId, deck: pool.deckId });
        generation = res?.generation;
      }
      if (generation && root.ChemProgress?.studyRequest) {
        const reviews = ids.map((id) => ({
          eventId: `rst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          cardId: id,
          action: 'reset'
        }));
        for (let i = 0; i < reviews.length; i += 20) {
          const chunk = reviews.slice(i, i + 20);
          await root.ChemProgress.studyRequest('POST', { generation, reviews: chunk }, {
            repo: pool.repositoryId,
            deck: pool.deckId
          });
        }
      }
      state.cache.delete(pool.key);
      state.selectedCards.clear();
      await switchActivePool(pool.key);
    } catch (e) {
      alert('Błąd resetu zaznaczonych kart: ' + (e.message || e));
    } finally {
      elements.btnResetSelected.textContent = '↺ Resetuj zaznaczone';
      elements.btnResetSelected.disabled = false;
    }
  }

  async function resetWholePool(pool) {
    if (!confirm(`Czy na pewno chcesz zresetować postęp powtórek dla CAŁEJ puli „${pool.title}”? Wszystkie fiszki powrócą do stanu „Nowe”.`)) return;
    elements.btnResetWholePool.disabled = true;
    elements.btnResetWholePool.textContent = 'Resetuję pulę…';
    try {
      if (root.ChemProgress?.reset) {
        await root.ChemProgress.reset(pool.key);
      }
      state.cache.delete(pool.key);
      state.selectedCards.clear();
      await switchActivePool(pool.key);
    } catch (e) {
      alert('Błąd resetu puli: ' + (e.message || e));
    } finally {
      elements.btnResetWholePool.textContent = '↺ Resetuj całą pulę';
      elements.btnResetWholePool.disabled = false;
    }
  }

  // Setup Event Listeners
  elements.poolSearchInput.addEventListener('input', (e) => {
    state.poolSearch = e.target.value;
    renderPoolsSidebar();
  });

  elements.cardSearchInput.addEventListener('input', (e) => {
    state.cardSearch = e.target.value;
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    if (pool && state.activePoolData) {
      renderCardsList(pool, state.activePoolData.quiz?.questions || [], state.activePoolData.records || {});
    }
  });

  elements.filterPills.addEventListener('click', (e) => {
    const pill = e.target.closest('.flashcards-filter-pill');
    if (!pill) return;
    elements.filterPills.querySelectorAll('.flashcards-filter-pill').forEach((p) => p.classList.remove('is-active'));
    pill.classList.add('is-active');
    state.cardFilter = pill.dataset.filter || 'all';
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    if (pool && state.activePoolData) {
      renderCardsList(pool, state.activePoolData.quiz?.questions || [], state.activePoolData.records || {});
    }
  });

  elements.btnSelectAll.addEventListener('click', () => {
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    const questions = state.activePoolData?.quiz?.questions || [];
    const allChecked = questions.length > 0 && questions.every((q) => state.selectedCards.has(q.questionId));
    if (allChecked) {
      state.selectedCards.clear();
    } else {
      questions.forEach((q) => state.selectedCards.add(q.questionId));
    }
    if (pool) {
      renderCardsList(pool, questions, state.activePoolData?.records || {});
      updateBulkControls(pool, questions);
    }
  });

  elements.btnStudySelected.addEventListener('click', () => {
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    if (!pool || !state.selectedCards.size) return;
    const ids = Array.from(state.selectedCards).join(',');
    const u = `/members/module/quiz/?${new URLSearchParams({
      repo: pool.repositoryId,
      quiz: pool.deckId,
      material: pool.key,
      study: 'all',
      study_selected: ids,
      ...(state.isShuffleOrder ? { study_order: 'shuffle' } : {})
    })}`;
    window.location.assign(u);
  });

  elements.btnResetSelected.addEventListener('click', () => {
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    if (pool) resetSelectedCards(pool);
  });

  elements.btnResetWholePool.addEventListener('click', () => {
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    if (pool) resetWholePool(pool);
  });

  elements.btnOrderToggle.addEventListener('click', () => {
    state.isShuffleOrder = !state.isShuffleOrder;
    elements.btnOrderToggle.textContent = state.isShuffleOrder ? '🔀 Losowo' : '🔢 Po kolei';
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    if (pool) {
      elements.btnStudyPool.href = `/members/module/quiz/?${new URLSearchParams({
        repo: pool.repositoryId,
        quiz: pool.deckId,
        material: pool.key,
        study: 'all',
        ...(state.isShuffleOrder ? { study_order: 'shuffle' } : {})
      })}`;
    }
  });

  elements.btnShuffle.addEventListener('click', () => {
    state.isShuffleOrder = true;
    elements.btnOrderToggle.textContent = '🔀 Losowo';
    const pool = state.pools.find((p) => p.key === state.activePoolKey);
    if (pool) {
      elements.btnStudyPool.href = `/members/module/quiz/?${new URLSearchParams({
        repo: pool.repositoryId,
        quiz: pool.deckId,
        material: pool.key,
        study: 'all',
        study_order: 'shuffle'
      })}`;
      window.location.assign(elements.btnStudyPool.href);
    }
  });

  elements.themeToggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('chem.theme', next); } catch (_) {}
  });

  // Initialize
  async function init() {
    await window.ChemAuth.ready;
    state.authenticatedUser = root.ChemAuth?.getUser?.();
    if (root.NextMedBrand?.setTitle) {
      root.NextMedBrand.setTitle('Baza fiszek');
    }
    await loadInitialPools();
  }

  init().catch((err) => {
    console.error('[flashcards] load failed:', err);
    showError(err.message || 'Wystąpił błąd podczas ładowania bazy fiszek.');
  });

})(window);
