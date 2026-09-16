(function (root) {
  'use strict';
  const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, fn) => { const n = el('button', text, 'quiz-player-button mini-button'); n.type = 'button'; n.addEventListener('click', fn); return n; };
  function study({ questions, getUrl, review: client, onComplete, mode: initialMode }) {
    const scheduler = root.ChemStudyScheduler, all = scheduler.cards(questions), host = el('section', null, 'quiz-deck-study study-session');
    const now = () => client.now?.() ?? Date.now();
    let mode = Object.hasOwn(scheduler.MODES, initialMode) ? initialMode : Object.keys(client.records).length ? 'due' : 'new', queue = [], current, checked, answer, correct, reviewed = 0, completionSaved = false;
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
    modeSelect.addEventListener('change', () => { mode = modeSelect.value; queue = scheduler.select(all, client.records, mode, now()); reviewed = 0; completionSaved = false; render(); });
    const reload = button('Odśwież kolejkę', () => { queue = scheduler.select(all, client.records, mode, now()); render(); });
    const abcdBtn = button('🎯 Test ABCD z fiszek', () => {
      if (!root.ChemQuizFlashcards?.generateAbcd) return;
      const abcdQuestions = root.ChemQuizFlashcards.generateAbcd(questions);
      if (!abcdQuestions.length) return;
      stage.replaceChildren();
      const abcdContainer = el('div', null, 'study-abcd-test');
      abcdContainer.append(el('h3', 'Wygenerowany Test ABCD z Twojej talii'));
      const answersMap = {};
      abcdQuestions.forEach((q, idx) => {
        const qCard = el('div', null, 'study-abcd-card');
        qCard.append(el('h4', `Pytanie ${idx + 1}: ${q.prompt}`));
        const optGroup = el('div', null, 'study-abcd-options');
        q.options.forEach((opt, optIdx) => {
          const optLabel = el('label', null, 'study-abcd-option');
          const optInput = el('input');
          optInput.type = 'radio';
          optInput.name = `gen-q-${idx}`;
          optInput.value = opt.optionId;
          optInput.addEventListener('change', () => {
            answersMap[idx] = opt.correct;
          });
          optLabel.append(optInput, document.createTextNode(` ${String.fromCharCode(65 + optIdx)}. ${opt.text}`));
          optGroup.append(optLabel);
        });
        qCard.append(optGroup);
        abcdContainer.append(qCard);
      });
      const checkAbcd = button('Sprawdź wynik testu ABCD', () => {
        let correctCount = 0;
        abcdQuestions.forEach((q, idx) => {
          if (answersMap[idx] === true) correctCount++;
        });
        const resultP = el('p', `Twój wynik: ${correctCount} / ${abcdQuestions.length} (${Math.round(correctCount / abcdQuestions.length * 100)}%)`, 'study-abcd-result');
        checkAbcd.replaceWith(resultP);
      });
      const backBtn = button('← Wróć do fiszek', () => render());
      abcdContainer.append(checkAbcd, backBtn);
      stage.append(abcdContainer);
    });
    controls.append(modeSelect, reload, abcdBtn); host.append(stats, controls, stage, status, save);
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
