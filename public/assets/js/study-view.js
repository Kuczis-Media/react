(function (root) {
  'use strict';
  const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const n = el('button', text, 'quiz-player-button mini-button'); n.type = 'button'; n.addEventListener('click', fn); return n; };
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

  function typeset(node) {
    if (!node) return;
    if (root.MathJax?.typesetPromise) {
      try { root.MathJax.typesetPromise([node]).catch?.(() => {}); } catch (_) {}
    } else {
      ensureMathJax().then((mj) => {
        if (mj?.typesetPromise) {
          try { mj.typesetPromise([node]).catch?.(() => {}); } catch (_) {}
        }
      }).catch?.(() => {});
    }
  }

  function study({ questions, getUrl, review: client, onComplete, mode: initialMode, order: initialOrder, cards: initialCards }) {
    const scheduler = root.ChemStudyScheduler, all = scheduler.cards(questions), host = el('section', null, 'quiz-deck-study study-session');
    const now = () => client.now?.() ?? Date.now();
    let mode = Object.hasOwn(scheduler.MODES, initialMode) ? initialMode : Object.keys(client.records).length ? 'due' : 'new', queue = [], current, checked, answer, correct, reviewed = 0, completionSaved = false;
    let orderMode = initialOrder || 'sequential';
    try {
      const sp = new URLSearchParams(root.location?.search || '');
      if (sp.get('order') === 'shuffle') orderMode = 'shuffle';
    } catch (_) {}

    function shuffleArray(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }

    function applyOrder(items) {
      return orderMode === 'shuffle' ? shuffleArray(items) : [...items];
    }

    const initialCardKeys = initialCards || (() => {
      try {
        const sp = new URLSearchParams(root.location?.search || '');
        const c = sp.get('cards');
        return c ? c.split(',').filter(Boolean) : null;
      } catch (_) { return null; }
    })();

    function selectQueue() {
      let cardsSelected = scheduler.select(all, client.records, mode, now());
      if (initialCardKeys && initialCardKeys.length) {
        const set = new Set(initialCardKeys);
        const filtered = cardsSelected.filter((q) => set.has(q.studyKey) || set.has(q.questionId));
        cardsSelected = filtered.length ? filtered : all.filter((q) => set.has(q.studyKey) || set.has(q.questionId));
      }
      return applyOrder(cardsSelected);
    }

    const stats = el('p', null, 'study-summary'), controls = el('div', null, 'study-modes'), stage = el('div'), status = el('p'); status.setAttribute('role', 'status');
    async function sync() {
      await client.flush();
      if (reviewed && !queue.length && !completionSaved && scheduler.stats(all, client.records, now()).new === 0) {
        completionSaved = true; try { await onComplete?.(); } catch (_) { completionSaved = false; }
      }
    }
    const save = button('Zapisz teraz', () => void sync().catch(() => {}));
    const modeSelect = el('select'); modeSelect.setAttribute('aria-label', 'Tryb nauki');
    for (const [value, label] of Object.entries(scheduler.MODES)) { const option = el('option', label); option.value = value; modeSelect.append(option); }
    modeSelect.value = mode;
    modeSelect.addEventListener('change', () => { mode = modeSelect.value; queue = selectQueue(); reviewed = 0; completionSaved = false; render(); });

    const orderBtn = button(orderMode === 'shuffle' ? '🔀 Losowo' : '🔢 Po kolei', () => {
      orderMode = orderMode === 'shuffle' ? 'sequential' : 'shuffle';
      orderBtn.textContent = orderMode === 'shuffle' ? '🔀 Losowo' : '🔢 Po kolei';
      queue = applyOrder(scheduler.select(all, client.records, mode, now()));
      render();
      status.textContent = orderMode === 'shuffle' ? '🎲 Włączono losową kolejność fiszek.' : '🔢 Włączono kolejność po kolei.';
    });
    orderBtn.title = 'Przełącz kolejność kart: po kolei / losowo';
    orderBtn.className = 'study-order-toggle-btn mini-button';

    const shuffleBtn = button('🔀 Przetasuj', () => {
      queue = shuffleArray(queue);
      render();
      status.textContent = '🎲 Przetasowano kolejność kart!';
    });
    shuffleBtn.title = 'Przetasuj aktualną kolejkę kart';
    shuffleBtn.className = 'study-shuffle-btn mini-button';

    const reload = button('Odśwież kolejkę', () => { queue = selectQueue(); render(); });
    const abcdBtn = button('🎯 Test ABCD z fiszek', () => {
      if (!root.ChemQuizFlashcards?.generateAbcd) return;
      const abcdQuestions = root.ChemQuizFlashcards.generateAbcd(questions);
      if (!abcdQuestions.length) return;
      stage.replaceChildren();
      const abcdContainer = el('div', null, 'study-abcd-test');
      const abcdHeader = el('div', null, 'study-abcd-head');
      abcdHeader.append(
        el('h3', '🎯 Test sprawdzający ABCD z wybranej talii'),
        el('p', `Odpowiedz na poniższe ${abcdQuestions.length} pytań, aby sprawdzić swoje opanowanie materiału przed powtórkami SRS.`)
      );
      abcdContainer.append(abcdHeader);

      const answersMap = {};
      const optionElements = [];

      abcdQuestions.forEach((q, idx) => {
        const qCard = el('article', null, 'study-abcd-card');
        const qHeader = el('div', null, 'study-abcd-card-header');
        qHeader.append(
          el('span', `Pytanie ${idx + 1} z ${abcdQuestions.length}`, 'study-abcd-qnum'),
          el('span', '1 wybór', 'study-abcd-qtype')
        );
        const qPrompt = el('h4', q.prompt, 'study-abcd-prompt');
        qCard.append(qHeader, qPrompt);

        const optGroup = el('div', null, 'study-abcd-options');
        q.options.forEach((opt, optIdx) => {
          const optLabel = el('label', null, 'study-abcd-option');
          const optInput = el('input');
          optInput.type = 'radio';
          optInput.name = `gen-q-${idx}`;
          optInput.value = opt.optionId;
          optInput.addEventListener('change', () => {
            answersMap[idx] = opt.correct;
            optGroup.querySelectorAll('.study-abcd-option').forEach((l) => l.classList.remove('is-selected'));
            optLabel.classList.add('is-selected');
          });

          const badge = el('span', String.fromCharCode(65 + optIdx), 'study-abcd-letter');
          const textSpan = el('span', opt.text, 'study-abcd-text');
          optLabel.append(optInput, badge, textSpan);
          optGroup.append(optLabel);

          optionElements.push({ input: optInput, label: optLabel, correct: Boolean(opt.correct), qIdx: idx });
        });
        qCard.append(optGroup);
        abcdContainer.append(qCard);
      });

      const actionsRow = el('div', null, 'study-abcd-actions');
      const checkAbcd = button('✓ Sprawdź wynik testu ABCD', () => {
        let correctCount = 0;
        abcdQuestions.forEach((q, idx) => {
          if (answersMap[idx] === true) correctCount++;
        });

        // Mark correct and wrong options
        optionElements.forEach(({ input, label, correct }) => {
          input.disabled = true;
          if (correct) {
            label.classList.add('is-correct');
          } else if (input.checked) {
            label.classList.add('is-wrong');
          }
        });

        const pct = Math.round((correctCount / abcdQuestions.length) * 100);
        const resultP = el('div', null, 'study-abcd-result');
        const scoreBadge = el('span', `${pct}%`, `study-abcd-score-pill ${pct >= 70 ? 'is-good' : 'is-warn'}`);
        const resultMsg = el('p', `Twój wynik: ${correctCount} z ${abcdQuestions.length} poprawnych odpowiedzi (${pct}%). ${pct === 100 ? '🎉 Bezbłędnie!' : pct >= 70 ? '👍 Bardzo dobry wynik!' : '💡 Warto powtórzyć trudniejsze karty w trybie fiszek.'}`);
        resultP.append(scoreBadge, resultMsg);

        checkAbcd.replaceWith(resultP);
        typeset(abcdContainer);
      });
      checkAbcd.className = 'button-primary study-abcd-submit-btn';

      const backBtn = button('← Wróć do fiszek', () => render());
      actionsRow.append(checkAbcd, backBtn);
      abcdContainer.append(actionsRow);

      stage.append(abcdContainer);
      typeset(abcdContainer);
    });

    const listBtn = button('📋 Lista fiszek', () => {
      stage.replaceChildren();
      const listContainer = el('div', null, 'study-session-list-view');
      const listHead = el('div', null, 'study-session-list-header');
      const listTitleBox = el('div', null, 'study-session-list-title-box');
      listTitleBox.append(
        el('h3', 'Wszystkie fiszki w tej puli'),
        el('p', `Przeglądaj wszystkie ${all.length} fiszek. Zaznacz wybrane karty, aby uczyć się tylko ich, lub zacznij naukę od dowolnej karty.`)
      );
      listHead.append(listTitleBox);

      const sessionSelectedKeys = new Set();
      let listFilter = 'all';

      const toolbar = el('div', null, 'study-content-toolbar study-session-list-toolbar');
      
      const searchRow = el('div', null, 'study-session-search-row');
      const searchInput = el('input');
      searchInput.type = 'search';
      searchInput.className = 'study-card-search';
      searchInput.placeholder = '🔍 Filtruj treść fiszek (pytanie i odpowiedź)…';

      const backBtn = button('← Wróć do nauki', () => {
        queue = selectQueue();
        render();
      });
      backBtn.className = 'button-primary study-session-back-btn';
      searchRow.append(searchInput, backBtn);

      const pillsBox = el('div', null, 'study-filter-pills');
      toolbar.append(searchRow, pillsBox);

      const actionRow = el('div', null, 'study-bulk-bar study-session-action-bar');
      const selectAllLabel = el('label', null, 'study-select-all-label');
      const selectAllCheckbox = el('input');
      selectAllCheckbox.type = 'checkbox';
      selectAllCheckbox.className = 'study-select-all-checkbox';
      const selectAllText = el('span', 'Zaznacz widoczne');
      selectAllLabel.append(selectAllCheckbox, selectAllText);

      const actionButtons = el('div', null, 'study-bulk-actions');
      const learnSelectedBtn = button('▶ Ucz się wybranych (0)', () => {
        if (!sessionSelectedKeys.size) return;
        const chosen = all.filter((c) => sessionSelectedKeys.has(c.studyKey));
        queue = applyOrder(chosen);
        reviewed = 0;
        render();
        status.textContent = `🎯 Rozpoczęto naukę ${chosen.length} wybranych fiszek.`;
      });
      learnSelectedBtn.className = 'button-primary study-learn-selected-btn';
      learnSelectedBtn.disabled = true;

      const shuffleVisibleBtn = button('🔀 Przetasuj widoczne', () => {
        const visible = getVisibleCards();
        queue = shuffleArray(visible);
        reviewed = 0;
        render();
        status.textContent = `🎲 Rozpoczęto naukę ${visible.length} fiszek w losowej kolejności!`;
      });
      shuffleVisibleBtn.className = 'study-shuffle-visible-btn mini-button';

      actionButtons.append(learnSelectedBtn, shuffleVisibleBtn);
      actionRow.append(selectAllLabel, actionButtons);

      listContainer.append(listHead, toolbar, actionRow);

      const cardsWrap = el('div', null, 'study-cards-list');

      function getCardBack(q) {
        if (q.type === 'flashcard') return q.answer || q.explanation || '';
        if (q.type === 'single' || q.type === 'multiple') {
          const correctOpts = Array.isArray(q.options) ? q.options.filter((o) => o.correct).map((o) => o.text).join(', ') : '';
          return correctOpts + (q.explanation ? (correctOpts ? '\n' : '') + q.explanation : '');
        }
        if (q.type === 'text') return Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers.join(' / ') : q.answer || q.explanation || '';
        if (q.type === 'image_occlusion') return q.occlusion?.masks?.map((m) => m.label).filter(Boolean).join(', ') || q.explanation || '';
        return q.rubric || q.modelAnswer || q.answer || q.explanation || '';
      }

      function getVisibleCards() {
        const norm = searchInput.value.trim().toLowerCase();
        return all.filter((q) => {
          const r = client.records[q.studyKey];
          const isDue = r?.dueAt && Date.parse(r.dueAt) <= now();
          const statusCode = !r?.attempts ? 'new' : isDue ? 'due' : r.interval >= 3 ? 'learned' : r?.lastGrade === 2 ? 'hard' : 'learning';
          if (listFilter !== 'all' && statusCode !== listFilter) return false;
          if (norm) {
            const front = (q.prompt || 'Fiszka').toLowerCase();
            const back = getCardBack(q).toLowerCase();
            if (!front.includes(norm) && !back.includes(norm)) return false;
          }
          return true;
        });
      }

      function updateSelectCount() {
        const count = sessionSelectedKeys.size;
        learnSelectedBtn.textContent = `▶ Ucz się wybranych (${count})`;
        learnSelectedBtn.disabled = count === 0;
        const visible = getVisibleCards();
        selectAllText.textContent = `Zaznacz widoczne (${visible.length})`;
        selectAllCheckbox.checked = visible.length > 0 && visible.every((c) => sessionSelectedKeys.has(c.studyKey));
      }

      selectAllCheckbox.addEventListener('change', () => {
        const visible = getVisibleCards();
        if (selectAllCheckbox.checked) {
          visible.forEach((c) => sessionSelectedKeys.add(c.studyKey));
        } else {
          visible.forEach((c) => sessionSelectedKeys.delete(c.studyKey));
        }
        renderListCards();
      });

      function renderFilters() {
        pillsBox.replaceChildren();
        const counts = { all: all.length, due: 0, learned: 0, learning: 0, new: 0, hard: 0 };
        all.forEach((q) => {
          const r = client.records[q.studyKey];
          const isDue = r?.dueAt && Date.parse(r.dueAt) <= now();
          if (!r?.attempts) counts.new++;
          else if (isDue) counts.due++;
          else if (r.interval >= 3) counts.learned++;
          else if (r?.lastGrade === 2) counts.hard++;
          else counts.learning++;
        });

        const filterDefs = [
          ['all', `Wszystkie (${counts.all})`],
          ['due', `🟠 Do powtórzenia (${counts.due})`],
          ['learned', `🟢 Zapamiętane (${counts.learned})`],
          ['learning', `🔵 W nauce (${counts.learning})`],
          ['new', `⚪ Nowe (${counts.new})`]
        ];
        if (counts.hard > 0) filterDefs.push(['hard', `🔴 Trudne (${counts.hard})`]);

        filterDefs.forEach(([fCode, fLabel]) => {
          const pill = el('button', fLabel, 'study-pill' + (listFilter === fCode ? ' is-active' : ''));
          pill.type = 'button';
          pill.addEventListener('click', () => {
            listFilter = fCode;
            renderFilters();
            renderListCards();
          });
          pillsBox.append(pill);
        });
      }

      function renderListCards() {
        cardsWrap.replaceChildren();
        const visible = getVisibleCards();
        updateSelectCount();

        if (!visible.length) {
          cardsWrap.append(el('p', 'Brak fiszek spełniających wybrane kryteria.', 'study-empty-label'));
          return;
        }

        visible.forEach((q) => {
          const originalIdx = all.findIndex((c) => c.studyKey === q.studyKey);
          const front = q.prompt || 'Fiszka';
          const back = getCardBack(q);

          const r = client.records[q.studyKey];
          const isDue = r?.dueAt && Date.parse(r.dueAt) <= now();
          const statusText = !r?.attempts ? '⚪ Nowa' : isDue ? '🟠 Do powtórzenia' : r.interval >= 3 ? '🟢 Zapamiętana' : r?.lastGrade === 2 ? '🔴 Trudna' : '🔵 W nauce';
          const statusClass = !r?.attempts ? 'badge-new' : isDue ? 'badge-due' : r.interval >= 3 ? 'badge-learned' : r?.lastGrade === 2 ? 'badge-hard' : 'badge-learning';

          const item = el('article', null, 'study-card-item');
          const head = el('div', null, 'study-card-head');

          const checkLabel = el('label', null, 'study-card-checkbox-label');
          const chk = el('input');
          chk.type = 'checkbox';
          chk.className = 'study-card-checkbox';
          chk.checked = sessionSelectedKeys.has(q.studyKey);
          chk.addEventListener('change', () => {
            if (chk.checked) sessionSelectedKeys.add(q.studyKey);
            else sessionSelectedKeys.delete(q.studyKey);
            updateSelectCount();
          });
          checkLabel.append(chk, el('strong', `Fiszka #${originalIdx + 1}`));

          head.append(
            checkLabel,
            el('span', statusText, `study-card-status-pill study-stat-badge ${statusClass}`)
          );

          const body = el('div', null, 'study-card-body');
          const fBox = el('div', null, 'study-card-front');
          fBox.append(el('span', 'PRZÓD / PYTANIE', 'study-card-label'), el('div', front, 'card-prompt-text'));
          const bBox = el('div', null, 'study-card-back');
          bBox.append(el('span', 'TYŁ / ODPOWIEDŹ', 'study-card-label'), el('div', back || '—', 'card-answer-text'));
          body.append(fBox, bBox);

          const foot = el('div', null, 'study-card-foot');
          const statsSpan = el('span', r?.attempts ? `Próby: ${r.attempts} • Poprawne: ${r.correct || 0} • Błędne: ${r.incorrect || 0}` : 'Brak wcześniejszych prób (Nowa)', 'study-card-stats');

          const footActions = el('div', null, 'study-card-foot-actions');

          const startFromBtn = button('▶ Ucz się od tej karty', () => {
            const reordered = all.slice(originalIdx).concat(all.slice(0, originalIdx));
            queue = reordered;
            reviewed = 0;
            render();
            status.textContent = `Rozpoczęto naukę od fiszki #${originalIdx + 1}.`;
          });
          startFromBtn.className = 'study-card-start-btn mini-button';
          startFromBtn.title = 'Rozpocznij naukę od tej karty naprzód';

          const resetBtn = button('↺ Resetuj tę fiszkę', () => {
            try {
              client.resetCard(q);
              renderFilters();
              renderListCards();
            } catch (e) {
              alert(e.message);
            }
          });
          resetBtn.className = 'study-card-reset-btn';

          footActions.append(startFromBtn, resetBtn);
          foot.append(statsSpan, footActions);

          item.append(head, body, foot);
          cardsWrap.append(item);
        });
        typeset(cardsWrap);
      }

      searchInput.addEventListener('input', () => renderListCards());
      renderFilters();
      renderListCards();
      listContainer.append(cardsWrap);
      stage.append(listContainer);
    });
    controls.append(modeSelect, orderBtn, shuffleBtn, reload, abcdBtn, listBtn); host.append(stats, controls, stage, status, save);
    client.onStatus((s) => {
      status.textContent = s.error || (!s.enabled ? 'Administrator wyłączył zapis postępu. Nauka działa tylko w tej sesji.' : s.pending ? `Oczekuje na zapis: ${s.pending} ocen.` : 'Postęp zapisany na Twoim koncie.');
      save.textContent = s.error ? 'Ponów zapis' : 'Zapisz teraz'; save.disabled = !s.pending;
    });
    function updateStats() {
      const s = scheduler.stats(all, client.records, now());
      const retention = scheduler.calculateRetentionStats ? scheduler.calculateRetentionStats(client.records, now()) : null;
      const streakText = retention?.streak ? ` · 🔥 Passa: ${retention.streak} ${retention.streak === 1 ? 'dzień' : 'dni'}` : '';
      const retentionText = retention?.retentionRate != null && s.attempts > 0 ? ` · Pamięć: ${retention.retentionRate}%` : '';
      stats.textContent = `${s.due} do powtórzenia · ${s.new} nowych · ${s.hard} trudnych · ${s.failed} błędnych. Poprawne: ${s.correct}/${s.attempts}${streakText}${retentionText}.`;
    }
    function render() {
      root.MathJax?.typesetClear?.([stage]); stage.replaceChildren(); updateStats();
      current = queue[0]; checked = false; answer = null; correct = null;
      if (!current) {
        const dueAgain = all.filter((q) => client.records[q.studyKey]?.lastGrade === 1).map((q) => Date.parse(client.records[q.studyKey].dueAt)).filter((v) => v > now()).sort((a,b) => a-b)[0];
        const celebration = reviewed ? el('div', '🎉 Gratulacje! Dzisiejsza partia kart została ukończona!', 'study-celebration') : null;
        stage.append(
          el('h3', reviewed ? 'Sesja zakończona' : 'Brak kart w tym trybie'),
          ...(celebration ? [celebration] : []),
          el('p', dueAgain ? `Najbliższy powrót zapomnianej karty: ${new Date(dueAgain).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}. Odśwież kolejkę, gdy nadejdzie jej termin.` : 'Wybierz inny tryb lub wróć jutro, aby utrzymać passę powtórek! 🔥')
        );
        if (reviewed) void sync().catch(() => {});
        return;
      }
      const ratings = el('div', null, 'quiz-flashcard-ratings'); ratings.hidden = true;
      const flash = ['flashcard', 'image_occlusion'].includes(current.type);
      const card = current.type === 'image_occlusion' ? root.ChemQuizOcclusion.card(current, getUrl)
        : flash ? root.ChemQuizFlashcards.card(current, getUrl)
          : root.ChemQuizFlashcards.practiceCard(current, getUrl, { onAnswer: (v) => { answer = v; }, onCheck: (v, result) => { answer = v; correct = result.correct; checked = true; ratings.hidden = false; } });
      card.addEventListener('flashcard-reveal', (e) => { checked = e.detail; ratings.hidden = !checked; });
      const predictions = scheduler.predictIntervals ? scheduler.predictIntervals(client.records[current.studyKey], now()) : null;
      ['Powtórz', 'Trudna', 'Dobra', 'Łatwa'].forEach((label, i) => {
        const grade = i + 1;
        const timeBadge = predictions?.[grade]?.timeLabel ? ` (${predictions[grade].timeLabel})` : '';
        const rate = button(`${grade}. ${label}${timeBadge}`, () => {
          if (!checked) return;
          try {
            client.rate(current, grade, answer, correct); reviewed++; queue.shift();
            const waiting = new Set(queue.map((q) => q.studyKey));
            for (const q of all) if (client.records[q.studyKey]?.lastGrade === 1 && scheduler.matches(client.records[q.studyKey], 'due', now()) && !waiting.has(q.studyKey)) { queue.push(q); waiting.add(q.studyKey); }
            render(); stage.querySelector('button, textarea, input')?.focus({ preventScroll: true });
          } catch (e) { status.textContent = e.message; }
        });
        rate.dataset.studyGrade = String(grade);
        ratings.append(rate);
      });
      const cardActions = el('div', null, 'study-card-actions');
      const skip = button('Pomiń na teraz', () => { queue.shift(); render(); });
      const resetCardBtn = button('↺ Zacznij tę fiszkę od nowa', () => {
        try {
          client.resetCard(current);
          queue.shift();
          render();
          status.textContent = 'Fiszka została zresetowana — wróciła do puli jako nowa.';
        } catch (e) {
          status.textContent = e.message;
        }
      });
      resetCardBtn.title = 'Resetuje postęp tej jednej fiszki (będzie traktowana jak nowa)';
      resetCardBtn.className = 'quiz-player-button mini-button is-secondary';
      cardActions.append(skip, resetCardBtn);
      const hint = el('div', null, 'quiz-flashcard-hint');
      hint.innerHTML = '<small>Skróty: <kbd>Spacja</kbd> odwróć • <kbd>1</kbd>-<kbd>4</kbd> oceń</small>';
      stage.append(el('p', `Pozostało: ${queue.length} · oceniono: ${reviewed}`, 'quiz-deck-position'), card, ratings, cardActions, hint);
    }
    function onKeydown(event) {
      if (!host.isConnected) return;
      if (event.target && event.target.matches('input, textarea, select')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const revealBtn = host.querySelector('[data-flashcard-reveal]');
      if ((event.code === 'Space' || event.key === ' ' || event.key === 'Enter') && revealBtn && !checked) {
        event.preventDefault();
        revealBtn.click();
        return;
      }
      if (checked && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        host.querySelector(`[data-study-grade="${event.key}"]`)?.click();
        return;
      }
    }
    root.document?.addEventListener?.('keydown', onKeydown);
    queue = scheduler.select(all, client.records, mode, now()); render(); return host;
  }
  root.ChemStudyView = Object.freeze({ study });
})(window);
