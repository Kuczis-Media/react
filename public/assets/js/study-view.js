(function (root) {
  'use strict';
  const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const n = el('button', text, 'quiz-player-button mini-button'); n.type = 'button'; n.addEventListener('click', fn); return n; };
  function study({ questions, getUrl, review: client, onComplete, mode: initialMode, order: initialOrder, cards: initialCards }) {
    const scheduler = root.ChemStudyScheduler, all = scheduler.cards(questions), host = el('section', null, 'quiz-deck-study study-session');
    const now = () => client.now?.() ?? Date.now();
    let mode = Object.hasOwn(scheduler.MODES, initialMode) ? initialMode : Object.keys(client.records).length ? 'due' : 'new', queue = [], current, checked, answer, correct, reviewed = 0, completionSaved = false, resetting = false;
    let orderMode = initialOrder || 'sequential';
    try {
      const sp = new URLSearchParams(root.location?.search || '');
      if ((sp.get('order') || sp.get('study_order')) === 'shuffle') orderMode = 'shuffle';
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
      const sp = new URLSearchParams(root.location?.search || '');
      if (sp.has('selection')) {
        try {
          const selection = JSON.parse(root.sessionStorage.getItem('chem.study.selection') || 'null');
          if (selection?.token === sp.get('selection') && selection.userId === root.ChemAuth?.getUser?.()?.id && selection.repo === (sp.get('repo') || 'default') && selection.quiz === sp.get('quiz') && selection.expiresAt > Date.now() && Array.isArray(selection.cards) && selection.cards.length <= 10000) return selection.cards;
        } catch (_) {}
        return [];
      }
      const keys = sp.get('cards') || sp.get('study_selected');
      return keys ? keys.split(',').filter(Boolean) : null;
    })();
    const selectedKeys = initialCardKeys ? new Set(initialCardKeys) : null;
    const eligible = selectedKeys ? all.filter((q) => selectedKeys.has(q.studyKey) || selectedKeys.has(q.questionId)) : all;
    const requestedLimit = Number(new URLSearchParams(root.location?.search || '').get('limit'));
    const sessionLimit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 && requestedLimit <= 10000 ? requestedLimit : Infinity;
    let sessionKeys = new Set();
    function selectQueue() {
      const cards = applyOrder(scheduler.select(eligible, client.records, mode, now())).slice(0, sessionLimit);
      sessionKeys = new Set(cards.map((q) => q.studyKey)); return cards;
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
      queue = selectQueue();
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
      const abcdQuestions = root.ChemQuizFlashcards.generateAbcd([...new Map(eligible.map((q) => [q.questionId, q])).values()]);
      if (!abcdQuestions.length) { status.textContent = 'Test ABCD wymaga co najmniej czterech fiszek z różnymi odpowiedziami tekstowymi.'; return; }
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
        const qPrompt = el('div', null, 'study-abcd-prompt'); qPrompt.append(root.ChemQuizFlashcards.text(q.prompt, getUrl));
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
          const textSpan = el('span', null, 'study-abcd-text'); textSpan.append(root.ChemQuizFlashcards.text(opt.text, getUrl));
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
        });
      checkAbcd.className = 'button-primary study-abcd-submit-btn';

      const backBtn = button('← Wróć do fiszek', () => render());
      actionsRow.append(checkAbcd, backBtn);
      abcdContainer.append(actionsRow);

      stage.append(abcdContainer);
    });

    const listBtn = button('Otwórz menadżer fiszek →', async () => {
      listBtn.disabled = true;
      try {
        await client.flush();
        const sp = new URLSearchParams(root.location.search);
        root.location.assign(`/members/module/flashcards/?${new URLSearchParams({ repo: sp.get('repo') || 'default', quiz: sp.get('quiz') || '', ...(root.ChemModuleReturn?.url ? { lesson_return: root.ChemModuleReturn.url } : {}) })}`);
      } catch (_) { status.textContent = 'Przed otwarciem menadżera zapisz oczekujące zmiany.'; }
      finally { listBtn.disabled = false; }
    });
    controls.append(modeSelect, orderBtn, shuffleBtn, reload, abcdBtn, listBtn); host.append(stats, controls, stage, status, save);
    const unsubscribe = client.onStatus((s) => {
      status.textContent = s.error || (!s.enabled ? 'Administrator wyłączył zapis postępu. Nauka działa tylko w tej sesji.' : s.pending ? `Oczekuje na zapis: ${s.pending} ocen.` : 'Postęp zapisany na Twoim koncie.');
      save.textContent = s.error ? 'Ponów zapis' : 'Zapisz teraz'; save.disabled = !s.pending;
    });
    host.dispose = () => unsubscribe?.();
    function updateStats() {
      const s = scheduler.stats(all, client.records, now());
      stats.textContent = `${Number.isFinite(sessionLimit) ? `Limit sesji: ${sessionLimit} kart · ` : ''}${s.due} do powtórzenia · ${s.new} nowych · ${s.hard} trudnych · ${s.failed} błędnych. Poprawne: ${s.correct}/${s.attempts}.`;
    }
    function render() {
      root.MathJax?.typesetClear?.([stage]); stage.replaceChildren(); updateStats();
      current = queue[0]; checked = false; answer = null; correct = null;
      if (!current) {
        const dueAgain = eligible.filter((q) => sessionKeys.has(q.studyKey)).filter((q) => client.records[q.studyKey]?.lastGrade === 1).map((q) => Date.parse(client.records[q.studyKey].dueAt)).filter((v) => v > now()).sort((a,b) => a-b)[0];
        const celebration = reviewed ? el('div', '🎉 Gratulacje! Dzisiejsza partia kart została ukończona!', 'study-celebration') : null;
        stage.append(
          el('h3', reviewed ? 'Sesja zakończona' : 'Brak kart w tym trybie'),
          ...(celebration ? [celebration] : []),
          el('p', dueAgain ? `Najbliższy powrót zapomnianej karty: ${new Date(dueAgain).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}. Odśwież kolejkę, gdy nadejdzie jej termin.` : 'Wybierz inny tryb lub wróć do nauki później.')
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
          if (!checked || resetting) return;
          try {
            client.rate(current, grade, answer, correct); reviewed++; queue.shift();
            const waiting = new Set(queue.map((q) => q.studyKey));
            for (const q of eligible) if (sessionKeys.has(q.studyKey) && client.records[q.studyKey]?.lastGrade === 1 && scheduler.matches(client.records[q.studyKey], 'due', now()) && !waiting.has(q.studyKey)) { queue.push(q); waiting.add(q.studyKey); }
            render(); stage.querySelector('button, textarea, input')?.focus({ preventScroll: true });
          } catch (e) { status.textContent = e.message; }
        });
        rate.dataset.studyGrade = String(grade);
        ratings.append(rate);
      });
      const cardActions = el('div', null, 'study-card-actions');
      const skip = button('Pomiń na teraz', () => { queue.shift(); render(); });
      const resetCardBtn = button('↺ Zacznij tę fiszkę od nowa', async () => {
        if (resetting) return;
        const target = current; resetting = true; resetCardBtn.disabled = true;
        try {
          await client.resetCard(target);
          queue = queue.filter((q) => q.studyKey !== target.studyKey); completionSaved = false; resetting = false;
          render();
          status.textContent = 'Fiszka została zresetowana — wróciła do puli jako nowa.';
        } catch (e) {
          status.textContent = e.message; resetCardBtn.disabled = false;
        } finally { resetting = false; }
      });
      resetCardBtn.disabled = resetting || client.canReset === false;
      resetCardBtn.title = 'Resetuje postęp tej jednej fiszki (będzie traktowana jak nowa)';
      resetCardBtn.className = 'quiz-player-button mini-button is-secondary';
      cardActions.append(skip, resetCardBtn);
      const hint = el('div', null, 'quiz-flashcard-hint');
      hint.innerHTML = '<small>Skróty: <kbd>Spacja</kbd> odwróć • <kbd>1</kbd>-<kbd>4</kbd> oceń</small>';
      stage.append(el('p', `Pozostało: ${queue.length} · oceniono: ${reviewed}`, 'quiz-deck-position'), card, ratings, cardActions, hint);
    }
    function onKeydown(event) {
      if (!host.isConnected) return;
      if (event.repeat || event.target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const revealBtn = host.querySelector('[data-flashcard-reveal]');
      if ((event.code === 'Space' || event.key === ' ') && revealBtn && !checked) {
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
    host.addEventListener('keydown', onKeydown);
    queue = selectQueue();
    const start = new URLSearchParams(root.location?.search || '').get('study_start');
    const startIndex = queue.findIndex((q) => q.studyKey === start || q.questionId === start);
    if (startIndex > 0) queue = [...queue.slice(startIndex), ...queue.slice(0, startIndex)];
    render(); return host;
  }
  root.ChemStudyView = Object.freeze({ study });
})(window);
