(function (root) {
  'use strict';
  const MEDIA = /^(?:photos\/|assets\/shared\/)[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/i;
  const create = (tag, className, text) => {
    const node = root.document.createElement(tag);
    node.className = className || '';
    if (text != null) node.textContent = text;
    return node;
  };
  function button(text, action) {
    const node = create('button', 'quiz-player-button mini-button', text);
    node.type = 'button'; node.addEventListener('click', action);
    return node;
  }
  function imageCache(readBlob) {
    const entries = new Map();
    let bytes = 0, generation = 0, trimScheduled = false;
    function trim() {
      const visible = new Set([...root.document.querySelectorAll('img[src]')].map((img) => img.src));
      for (const [ref, entry] of entries) {
        if (entries.size <= 32 && bytes <= 64 * 1024 * 1024) break;
        if (!entry.url || visible.has(entry.url)) continue;
        root.URL.revokeObjectURL(entry.url); bytes -= entry.bytes; entries.delete(ref);
      }
    }
    function get(ref, repositoryId = '') {
      const key = `${repositoryId}:${ref}`;
      if (entries.has(key)) {
        const entry = entries.get(key); entries.delete(key); entries.set(key, entry);
        return entry.promise;
      }
      const owner = generation;
      const entry = { url: '', bytes: 0, promise: null };
      entry.promise = Promise.resolve().then(() => readBlob(ref, repositoryId)).then((blob) => {
        if (owner !== generation) throw new Error('PREVIEW_CHANGED');
        entry.url = root.URL.createObjectURL(blob); entry.bytes = blob.size; bytes += blob.size;
        if (!trimScheduled) {
          trimScheduled = true;
          root.setTimeout(() => { trimScheduled = false; trim(); }, 0);
        }
        return entry.url;
      }).catch((error) => { if (entries.get(key) === entry) entries.delete(key); throw error; });
      entries.set(key, entry); return entry.promise;
    }
    function clear() {
      generation++;
      entries.forEach((entry) => { if (entry.url) root.URL.revokeObjectURL(entry.url); });
      entries.clear(); bytes = 0;
    }
    return { get, clear };
  }
  function image(value, getUrl) {
    const figure = create('figure', 'quiz-flashcard-image');
    if (!MEDIA.test(value?.ref || '')) return figure;
    const img = create('img'); img.alt = value.alt || ''; img.decoding = 'async';
    const status = create('span', '', 'Wczytywanie obrazu…');
    status.setAttribute('role', 'status');
    figure.append(img, status);
    // Start after mounting; stale previews never attach a completed request.
    Promise.resolve().then(() => getUrl(value.ref, value.repositoryId)).then((url) => {
      if (!img.isConnected) return;
      img.onload = () => status.remove();
      img.onerror = () => { img.hidden = true; status.textContent = 'Nie udało się wczytać obrazu.'; };
      img.src = url;
    }).catch(() => { if (figure.isConnected) status.textContent = 'Nie udało się wczytać obrazu.'; });
    return figure;
  }
  function text(value, getUrl) {
    const node = create('div', 'quiz-flashcard-text');
    const formulas = [];
    // Protect TeX from Markdown's superscript syntax, then use the same safe
    // equation renderer as the exam and Lesson Builder (including mhchem).
    const source = String(value || '')
      .replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g, (formula) => {
        formulas.push(formula); return `NEXTMEDFLASHMATH${formulas.length - 1}TOKEN`;
      })
      .replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_, prefix, formula) => {
        formulas.push(`\\(${formula}\\)`); return `${prefix}NEXTMEDFLASHMATH${formulas.length - 1}TOKEN`;
      });
    if (root.ChemLesson?.renderMarkdown) {
      const template = root.document.createElement('template');
      template.innerHTML = root.ChemLesson.renderMarkdown(source);
      // Fiszki use the text renderer, not interactive lesson directives.
      template.content.querySelectorAll('iframe,script,object,embed,input,button,style').forEach((item) => item.remove());
      template.content.querySelectorAll('img').forEach((item) => {
        const ref = item.getAttribute('src');
        item.replaceWith(MEDIA.test(ref || '') ? image({ ref, alt: item.alt }, getUrl) : create('span', '', item.alt));
      });
      node.append(template.content);
    } else node.textContent = source;
    const walker = root.document.createTreeWalker(node, 4);
    const leaves = []; while (walker.nextNode()) leaves.push(walker.currentNode);
    for (const leaf of leaves) {
      if (!/NEXTMEDFLASHMATH\d+TOKEN/.test(leaf.textContent)) continue;
      const fragment = root.document.createDocumentFragment();
      const parts = leaf.textContent.split(/(NEXTMEDFLASHMATH\d+TOKEN)/);
      for (const part of parts) {
        const index = /^NEXTMEDFLASHMATH(\d+)TOKEN$/.exec(part)?.[1];
        if (index == null || !formulas[index]) fragment.append(root.document.createTextNode(part));
        else {
          const formula = create('span');
          if (root.ChemAssessmentText) root.ChemAssessmentText.render(formula, formulas[index]);
          else formula.textContent = formulas[index];
          fragment.append(formula);
        }
      }
      leaf.replaceWith(fragment);
    }
    return node;
  }
  function face(value, getUrl) {
    const node = create('div', 'quiz-flashcard-face');
    node.append(text(value?.text, getUrl));
    const images = create('div', 'quiz-flashcard-images');
    (value?.images || []).forEach((entry) => images.append(image(entry, getUrl)));
    node.append(images);
    return node;
  }
  function card(question, getUrl) {
    const node = create('section', 'quiz-flashcard');
    node.dataset.flashcardId = question.questionId;
    const front = face(question.front, getUrl);
    const back = create('section', 'quiz-flashcard-back'); back.hidden = true;
    const reveal = button('Pokaż odpowiedź', () => {
      if (back.hidden) {
        back.replaceChildren(create('h3', '', 'Odpowiedź'), face(question.back, getUrl));
        if (question.explanation) back.append(create('h4', '', 'Wyjaśnienie'), text(question.explanation, getUrl));
      }
      back.hidden = !back.hidden;
      reveal.textContent = back.hidden ? 'Pokaż odpowiedź' : 'Ukryj odpowiedź';
      reveal.setAttribute('aria-expanded', String(!back.hidden));
      node.dispatchEvent(new root.CustomEvent('flashcard-reveal', { detail: !back.hidden }));
    });
    reveal.dataset.flashcardReveal = '1'; reveal.setAttribute('aria-expanded', 'false');
    node.append(create('h3', '', 'Przód'), front, reveal, back);
    return node;
  }
  function feedback(question, result, getUrl, showExplanation = true) {
    const node = create('section', 'quiz-practice-feedback');
    node.setAttribute('aria-label', 'Sprawdzenie odpowiedzi');
    node.append(create('strong', result.correct ? 'quiz-diff-equal' : 'quiz-diff-wrong', result.correct ? 'Poprawna odpowiedź' : 'Sprawdź różnice'));
    const comparison = result.comparison;
    if (comparison) {
      node.append(create('p', '', `Podobieństwo: ${comparison.similarity}%${comparison.tolerated ? ' · zaakceptowano drobną literówkę' : ''}`));
      node.append(create('small', '', 'Porównanie uwzględnia ustawione tolerancje. Zielony: zgodne; czerwony: błędne; podkreślenie: brakujące.'));
      const difference = create('div', 'quiz-text-diff');
      difference.setAttribute('aria-label', 'Różnice znak po znaku');
      comparison.segments.forEach((part) => {
        const segment = create(part.type === 'missing' ? 'ins' : part.type === 'wrong' ? 'del' : 'span', `quiz-diff-${part.type}`, part.text);
        segment.title = part.type === 'missing' ? 'Brakujący fragment' : part.type === 'wrong' ? 'Błędny fragment' : 'Poprawny fragment';
        difference.append(segment);
      });
      node.append(difference);
    }
    const key = create('div', 'quiz-player-answer-key'); key.dataset.localAnswerKey = '1';
    key.append(create('strong', '', question.type === 'text' ? 'Prawidłowa odpowiedź' : 'Twoje wybory i poprawne odpowiedzi'));
    if (result.optionStates) {
      const labels = { correct: '✓ Poprawnie zaznaczona', wrong: '✕ Błędnie zaznaczona', missed: '＋ Poprawna, ale pominięta' };
      result.optionStates.forEach((state) => {
        if (state.status === 'neutral') return;
        const option = question.options.find((entry) => entry.optionId === state.optionId);
        if (!option) return;
        const item = create('div', `quiz-option-feedback is-${state.status}`);
        item.dataset.optionId = option.optionId; item.dataset.optionStatus = state.status;
        item.append(create('strong', '', labels[state.status]), text(option.text, getUrl));
        if (option.image?.ref) item.append(image(option.image, getUrl));
        key.append(item);
      });
    } else {
      (result.correctAnswers || []).forEach((answer) => key.append(text(answer, getUrl)));
      const variants = question.type === 'text' ? question.acceptedAnswers.filter((answer) => !result.correctAnswers?.includes(answer)) : [];
      if (variants.length) {
        key.append(create('small', '', 'Pozostałe akceptowane warianty:'));
        variants.forEach((answer) => key.append(text(answer, getUrl)));
      }
    }
    node.append(key);
    if (showExplanation && question.explanation) node.append(create('h4', '', 'Wyjaśnienie'), text(question.explanation, getUrl));
    return node;
  }
  function practiceCard(question, getUrl, options = {}) {
    const node = create('section', 'quiz-flashcard quiz-practice-card');
    node.dataset.practiceQuestion = question.questionId;
    node.append(text(question.prompt, getUrl));
    if (question.image?.ref) node.append(image(question.image, getUrl));
    const controls = [], output = create('div'); output.setAttribute('aria-live', 'polite');
    const read = () => question.type === 'text' ? controls[0].value : controls.filter((input) => input.checked).map((input) => input.value);
    let checked = Boolean(options.checked);
    const changed = () => options.onAnswer?.(read());
    if (question.type === 'text') {
      const input = create('textarea', 'quiz-player-text'); input.rows = 2; input.maxLength = 500;
      input.value = typeof options.answer === 'string' ? options.answer : '';
      input.setAttribute('aria-label', 'Twoja odpowiedź'); input.placeholder = 'Wpisz odpowiedź…';
      input.addEventListener('input', changed); controls.push(input); node.append(input);
      if (root.ChemAssessmentEditor) node.append(root.ChemAssessmentEditor.equationButton(input));
    } else {
      node.append(create('small', '', question.type === 'multiple' ? 'Zaznacz wszystkie poprawne odpowiedzi.' : 'Wybierz jedną odpowiedź.'));
      question.options.forEach((option) => {
        const label = create('label', 'quiz-player-option');
        const input = create('input'); input.type = question.type === 'multiple' ? 'checkbox' : 'radio';
        input.name = `practice-${question.questionId}`; input.value = option.optionId;
        input.checked = Array.isArray(options.answer) && options.answer.includes(option.optionId);
        input.addEventListener('change', changed); controls.push(input);
        label.append(input, text(option.text, getUrl));
        if (option.image?.ref) label.append(image(option.image, getUrl));
        node.append(label);
      });
    }
    function showResult() {
      controls.forEach((control) => { control.disabled = true; });
      node.querySelectorAll('.assessment-equation-trigger').forEach((button) => { button.disabled = true; });
      const result = root.ChemQuizPractice.evaluate(question, read());
      output.replaceChildren(feedback(question, result, getUrl));
      return result;
    }
    const check = button('Sprawdź odpowiedź', () => {
      if (checked) return;
      const answer = read();
      if (!answer.length || (typeof answer === 'string' && !answer.trim())) {
        output.replaceChildren(create('p', '', 'Najpierw wpisz lub wybierz odpowiedź.')); return;
      }
      checked = true; check.disabled = true;
      const result = showResult();
      options.onCheck?.(answer, result);
    });
    check.dataset.practiceCheck = '1'; check.disabled = checked;
    node.append(check, output);
    if (checked) showResult();
    return node;
  }
  function study({ questions, getUrl, onComplete, preview = false, review, mode, initialQuestionId }) {
    if (review && !preview && root.ChemStudyView) return root.ChemStudyView.study({ questions, getUrl, onComplete, review, mode });
    const sourceQuestions = questions;
    questions = root.ChemQuizOcclusionModel ? root.ChemQuizOcclusionModel.expand(sourceQuestions) : questions;
    const node = create('section', 'quiz-deck-study');
    let index = preview ? Math.max(0, questions.findIndex((q) => q.questionId === initialQuestionId)) : 0, finished = false;
    const ratings = new Map(); // Session-only; at most 200 questions × 50 masks, no image duplication.
    const answers = new Map();
    function advance(rating) {
      if (finished) return;
      ratings.set(questions[index].studyKey || questions[index].questionId, rating);
      if (ratings.size === questions.length) { void finish(); return; }
      index = questions.findIndex((q, i) => i > index && !ratings.has(q.studyKey || q.questionId));
      if (index < 0) index = questions.findIndex((q) => !ratings.has(q.studyKey || q.questionId));
      render();
      node.querySelector('[data-flashcard-reveal], textarea, input')?.focus({ preventScroll: true });
    }
    function render() {
      root.MathJax?.typesetClear?.([node]);
      const question = questions[index], flashcard = ['flashcard', 'image_occlusion'].includes(question.type);
      const heading = create('p', 'quiz-deck-position', `Karta ${index + 1} z ${questions.length} · przejrzano ${ratings.size}`);
      const actions = create('div', 'quiz-flashcard-ratings'); actions.hidden = true;
      const record = answers.get(question.questionId) || {};
      const current = question.type === 'image_occlusion' ? root.ChemQuizOcclusion.card(question, getUrl) : flashcard ? card(question, getUrl) : practiceCard(question, getUrl, {
        ...record, onAnswer: (answer) => answers.set(question.questionId, { answer, checked: false }),
        onCheck: (answer) => { answers.set(question.questionId, { answer, checked: true }); actions.hidden = false; }
      });
      if (flashcard) {
        const predictions = root.ChemStudyScheduler?.predictIntervals ? root.ChemStudyScheduler.predictIntervals(null) : null;
        ['Powtórz', 'Trudna', 'Dobra', 'Łatwa'].forEach((label, rating) => {
          const grade = rating + 1;
          const timeBadge = predictions?.[grade]?.timeLabel ? ` (${predictions[grade].timeLabel})` : '';
          const rate = button(`${grade}. ${label}${timeBadge}`, () => advance(grade));
          rate.dataset.flashcardRating = String(grade);
          actions.append(rate);
        });
      }
      current.addEventListener('flashcard-reveal', (event) => { actions.hidden = !event.detail; });
      if (!flashcard) {
        actions.hidden = !record.checked;
        actions.append(button('Dalej — zapamiętane', () => advance(true)));
      }
      const navigation = create('div', 'quiz-flashcard-navigation');
      [-1, 1].forEach((step) => {
        const control = button(step < 0 ? '← Poprzednia' : 'Następna →', () => { index += step; render(); });
        control.disabled = index + step < 0 || index + step >= questions.length;
        navigation.append(control);
      });
      const hint = create('div', 'quiz-flashcard-hint');
      hint.innerHTML = '<small>Skróty: <kbd>Spacja</kbd> odwróć • <kbd>1</kbd>-<kbd>4</kbd> oceń • <kbd>←</kbd> <kbd>→</kbd> przełącz</small>';
      node.replaceChildren(heading, current, actions, navigation, hint, create('small', '', 'Samoocena dotyczy tylko tej sesji. Nie zmienia punktów i nie planuje powtórek.'));
    }
    async function finish() {
      if (finished) return;
      finished = true;
      node.replaceChildren(create('h2', '', 'Pula przejrzana'), create('p', '', `Ukończono ${ratings.size} kart.${preview ? ' To podgląd — postęp nie jest zapisywany.' : ''}`));
      try { if (!preview) await onComplete?.(); }
      catch (_) { node.append(create('p', '', 'Nie udało się zapisać postępu.')); }
      const restart = button('Ucz się ponownie', () => { ratings.clear(); answers.clear(); questions = root.ChemQuizOcclusionModel ? root.ChemQuizOcclusionModel.expand(sourceQuestions) : sourceQuestions; index = 0; finished = false; render(); });
      node.append(restart);
    }
    function onKeydown(event) {
      if (!node.isConnected || finished) return;
      if (event.repeat || event.target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const revealBtn = node.querySelector('[data-flashcard-reveal]');
      const isRevealed = revealBtn?.getAttribute('aria-expanded') === 'true';
      if ((event.code === 'Space' || event.key === ' ') && revealBtn && !isRevealed) {
        event.preventDefault();
        revealBtn.click();
        return;
      }
      if (isRevealed && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        node.querySelector(`[data-flashcard-rating="${event.key}"]`)?.click();
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        index -= 1;
        render();
        return;
      }
      if (event.key === 'ArrowRight' && index < questions.length - 1) {
        event.preventDefault();
        index += 1;
        render();
        return;
      }
    }
    node.addEventListener('keydown', onKeydown);
    if (questions.length) render();
    else node.append(create('p', '', 'Ta pula nie zawiera jeszcze fiszek.'));
    return node;
  }

  function generateAbcd(questions, options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const extractText = (face) => {
      if (!face) return '';
      if (typeof face === 'string') return face.trim();
      return String(face.text || face.label || face.prompt || '').trim();
    };

    const flashcards = (questions || []).filter((q) => q && q.type === 'flashcard' && extractText(q.front) && extractText(q.back));
    if (!flashcards.length) return [];

    const selectedCards = flashcards.slice(0, limit);
    const allBacks = Array.from(new Set(flashcards.map((q) => extractText(q.back)).filter(Boolean)));

    if (allBacks.length < 4) return [];
    const shuffled = (items) => { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; };
    return selectedCards.map((cardItem, cardIdx) => {
      const qText = extractText(cardItem.front);
      const correctAns = extractText(cardItem.back);

      const otherBacks = allBacks.filter((b) => b !== correctAns);
      const shuffledOthers = shuffled(otherBacks);
      const distractors = shuffledOthers.slice(0, 3);
      const rawOptions = [
        { text: correctAns, correct: true },
        ...distractors.map((d) => ({ text: d, correct: false }))
      ];
      const shuffledOptions = shuffled(rawOptions);

      return {
        questionId: `gen-abcd-${cardIdx + 1}`,
        type: 'single',
        interaction: 'single',
        prompt: qText,
        points: 1,
        options: shuffledOptions.map((opt, optIdx) => ({
          optionId: `gen-${cardIdx + 1}-opt-${String.fromCharCode(97 + optIdx)}`,
          text: opt.text,
          correct: opt.correct
        })),
        explanation: cardItem.explanation || `Poprawna odpowiedź: ${correctAns}`
      };
    });
  }

  const api = Object.freeze({ text, face, card, study, image, imageCache, feedback, practiceCard, generateAbcd });
  root.ChemQuizFlashcards = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

