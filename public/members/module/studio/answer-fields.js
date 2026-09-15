(function exposeAnswerFields(root) {
  'use strict';
  let sequence = 0;
  const make = (tag, className = '', text) => {
    const node = root.document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  function button(label, action, disabled = false) {
    const node = make('button', 'mini-button', label);
    node.type = 'button'; node.disabled = disabled;
    node.addEventListener('click', action);
    return node;
  }
  function textField(label, value, update, multiline = false, maxLength = 1000) {
    const wrap = make('label', 'answer-field');
    const input = make(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    else input.rows = 2;
    input.value = value || ''; input.maxLength = maxLength;
    input.addEventListener('input', () => update(input.value));
    wrap.append(make('span', '', label), input);
    return wrap;
  }
  function container(title, help) {
    const host = make('section', 'answer-configurator');
    host.append(make('h4', '', title));
    if (help) host.append(make('p', 'answer-help', help));
    return host;
  }
  function newId(prefix, existing) {
    let id;
    do { id = `${String(prefix).slice(0, 70)}-${Date.now().toString(36)}-${++sequence}`; } while (existing.includes(id));
    return id;
  }
  function textList(initial, onChange, options = {}) {
    let values = [...initial];
    const host = container(options.title || 'Akceptowane odpowiedzi', 'Każdy wariant wpisz w osobne pole. Nie musisz podawać identyfikatorów.');
    const list = make('div', 'answer-row-list');
    const add = button('＋ Dodaj wariant odpowiedzi', () => {
      values.push(''); onChange([...values]); render();
      list.lastElementChild?.querySelector('input,textarea')?.focus();
    });
    function render() {
      list.replaceChildren();
      values.forEach((value, index) => {
        const row = make('div', 'answer-list-row');
        row.append(textField(`Wariant ${index + 1}`, value, (next) => {
          values[index] = next; onChange([...values]);
        }, options.multiline === true, options.maxLength || 240));
        if (options.equations && root.ChemAssessmentEditor) {
          row.firstElementChild.append(root.ChemAssessmentEditor.equationButton(row.querySelector('input,textarea')));
        }
        const remove = button('Usuń', () => { values.splice(index, 1); onChange([...values]); render(); }, values.length <= 1);
        remove.setAttribute('aria-label', `Usuń wariant ${index + 1}`);
        row.append(remove); list.append(row);
      });
      add.disabled = values.length >= (options.maximum || 30);
    }
    host.append(list, add); render();
    return host;
  }
  function exam(question, onChange) {
    const host = make('div', 'exam-answer-fields');
    const notify = (structural = false) => onChange(structural);
    const action = (label, callback, disabled) => button(label, () => { callback(); notify(true); render(); }, disabled);
    function render() {
      host.replaceChildren();
      if (Array.isArray(question.options)) renderChoices();
      else if (question.type === 'matching') renderPairs();
      else if (question.type === 'ordering') renderOrder();
      else if (question.type === 'fill_blanks') renderGaps();
    }
    function renderChoices() {
      const multiple = question.type === 'multiple_choice';
      const section = container('Odpowiedzi', multiple ? 'Zaznacz wszystkie poprawne odpowiedzi.' : 'Zaznacz kółkiem jedną poprawną odpowiedź.');
      const list = make('div', 'answer-row-list answer-choice-grid');
      question.options.forEach((option, index) => {
        const row = make('div', 'answer-choice-row answer-choice-card');
        const isCorrect = question.correctAnswerIds.includes(option.answerId);
        row.classList.toggle('is-correct', isCorrect);
        
        const letter = String.fromCharCode(65 + index);
        const header = make('div', 'answer-choice-header');
        const badge = make('span', 'answer-choice-letter', letter);
        
        const toggleWrapper = make('label', 'answer-choice-toggle');
        toggleWrapper.title = isCorrect ? 'Poprawna odpowiedź (kliknij aby odznaczyć)' : 'Kliknij, aby oznaczyć jako poprawną';
        const correct = make('input');
        correct.type = multiple ? 'checkbox' : 'radio';
        correct.name = `answer-${question.questionId}`;
        correct.checked = isCorrect;
        correct.setAttribute('aria-label', `Poprawna odpowiedź ${letter}`);
        
        const checkIcon = make('span', 'answer-choice-check-icon', isCorrect ? '✓' : '');
        checkIcon.setAttribute('aria-hidden', 'true');
        toggleWrapper.append(correct, checkIcon);

        const onToggle = () => {
          if (multiple) {
            question.correctAnswerIds = question.options
              .filter((entry) => entry.answerId === option.answerId ? correct.checked : question.correctAnswerIds.includes(entry.answerId))
              .map((entry) => entry.answerId);
          } else {
            question.correctAnswerIds = correct.checked ? [option.answerId] : [];
          }
          list.querySelectorAll('.answer-choice-row').forEach((item, itemIndex) => {
            const opt = question.options[itemIndex];
            const active = opt && question.correctAnswerIds.includes(opt.answerId);
            item.classList.toggle('is-correct', active);
            const icon = item.querySelector('.answer-choice-check-icon');
            if (icon) icon.textContent = active ? '✓' : '';
            const inp = item.querySelector('input');
            if (inp) inp.checked = active;
          });
          notify();
        };

        correct.addEventListener('change', onToggle);
        toggleWrapper.addEventListener('click', (event) => {
          if (event.target !== correct) {
            event.preventDefault();
            if (!multiple) {
              correct.checked = true;
              onToggle();
            } else {
              correct.checked = !correct.checked;
              onToggle();
            }
          }
        });

        header.append(badge, toggleWrapper);
        const textRow = textField(`Odpowiedź ${letter}`, option.text, (value) => { option.text = value; notify(); }, true);
        if (root.ChemAssessmentEditor?.equationButton) {
          const textarea = textRow.querySelector('textarea, input');
          if (textarea) textRow.append(root.ChemAssessmentEditor.equationButton(textarea));
        }

        const deleteButton = action('Usuń', () => {
          question.options.splice(index, 1);
          question.correctAnswerIds = question.correctAnswerIds.filter((id) => id !== option.answerId);
        }, question.type === 'true_false' || question.options.length <= 2);
        deleteButton.classList.toggle('is-danger', true);

        row.append(header, textRow, deleteButton);
        if (option.images?.length) row.append(make('small', 'answer-attached', `${option.images.length} załączonych obrazów — zarządzaj nimi w panelu mediów pytania.`));
        list.append(row);
      });
      section.append(list);
      if (!question.correctAnswerIds.length) section.append(make('p', 'answer-warning', 'Zaznacz poprawną odpowiedź przed publikacją.'));
      if (question.type !== 'true_false') section.append(action('＋ Dodaj odpowiedź', () => {
        question.options.push({ answerId: newId('answer', question.options.map((entry) => entry.answerId)), text: '', images: [] });
      }, question.options.length >= 12));
      host.append(section);
    }
    function renderPairs() {
      const section = container('Połącz w pary', 'Każdy wiersz to poprawna para. Uczniowi elementy zostaną przemieszane.');
      question.pairs.forEach((pair, index) => {
        const row = make('div', 'answer-pair-row');
        row.append(textField(`Lewa strona ${index + 1}`, pair.left, (value) => { pair.left = value; notify(); }),
          make('span', 'answer-connector', '↔'),
          textField(`Prawa strona ${index + 1}`, pair.right, (value) => { pair.right = value; notify(); }),
          action('Usuń parę', () => question.pairs.splice(index, 1), question.pairs.length <= 2));
        section.append(row);
      });
      section.append(action('＋ Dodaj parę', () => question.pairs.push({ pairId: newId('pair', question.pairs.map((pair) => pair.pairId)), left: '', right: '', leftImages: [], rightImages: [] }), question.pairs.length >= 40));
      host.append(section);
    }
    function renderOrder() {
      const section = container('Poprawna kolejność', 'Ułóż elementy strzałkami. Ta kolejność jest kluczem odpowiedzi.');
      const ordered = question.correctOrder.map((id) => question.items.find((item) => item.itemId === id)).filter(Boolean);
      question.items.filter((item) => !ordered.includes(item)).forEach((item) => ordered.push(item));
      ordered.forEach((item, index) => {
        const row = make('div', 'answer-list-row');
        row.append(textField(`Miejsce ${index + 1}`, item.text, (value) => { item.text = value; notify(); }));
        const actions = make('div', 'answer-inline-actions');
        for (const [label, offset] of [['↑', -1], ['↓', 1]]) {
          const move = action(label, () => {
            const next = index + offset;
            [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
            question.correctOrder = ordered.map((entry) => entry.itemId);
          }, index + offset < 0 || index + offset >= ordered.length);
          move.setAttribute('aria-label', `${offset < 0 ? 'Przenieś wyżej' : 'Przenieś niżej'} element ${index + 1}`);
          actions.append(move);
        }
        actions.append(action('Usuń', () => {
          question.items = question.items.filter((entry) => entry !== item);
          question.correctOrder = ordered.filter((entry) => entry !== item).map((entry) => entry.itemId);
        }, ordered.length <= 2));
        row.append(actions); section.append(row);
      });
      section.append(action('＋ Dodaj element', () => {
        const item = { itemId: newId('item', question.items.map((entry) => entry.itemId)), text: '', images: [] };
        question.items.push(item); question.correctOrder = [...ordered.map((entry) => entry.itemId), item.itemId];
      }, question.items.length >= 40));
      host.append(section);
    }
    function renderGaps() {
      const section = container('Zdanie z lukami', 'Wpisz tekst pomiędzy lukami. Dodaj lukę przyciskiem i wpisz pod nią poprawną odpowiedź.');
      const parts = String(question.template || '').split(/\{\{[^{}]*\}\}/g);
      const labels = [...String(question.template || '').matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1]);
      const sync = () => { question.template = parts.map((part, index) => part + (index < labels.length ? `{{${labels[index]}}}` : '')).join(''); };
      if (labels.length !== question.blanks.length) {
        section.append(make('p', 'answer-warning', 'Liczba znaczników w starym tekście różni się od liczby odpowiedzi.'), action('Dopasuj luki, zachowując odpowiedzi', () => {
          while (labels.length < question.blanks.length) { labels.push('luka'); parts.push(''); }
          while (question.blanks.length < labels.length) question.blanks.push({ blankId: newId('blank', question.blanks.map((entry) => entry.blankId)), acceptedAnswers: [''], caseInsensitive: true });
          sync();
        }));
      }
      parts.forEach((part, index) => {
        section.append(textField(index === 0 ? 'Początek zdania' : `Tekst po luce ${index}`, part, (value) => { parts[index] = value; sync(); notify(); }, true, 10000));
        section.append(action('＋ Wstaw lukę tutaj', () => {
          labels.splice(index, 0, 'luka'); parts.splice(index + 1, 0, '');
          question.blanks.splice(index, 0, { blankId: newId('blank', question.blanks.map((entry) => entry.blankId)), acceptedAnswers: [''], caseInsensitive: true });
          sync();
        }, labels.length >= 40 || labels.length !== question.blanks.length));
        const blank = question.blanks[index];
        if (index >= labels.length || !blank) return;
        const card = container(`Luka ${index + 1}`);
        card.append(textList(blank.acceptedAnswers, (values) => { blank.acceptedAnswers = values; notify(); }, { title: 'Poprawna odpowiedź i jej warianty' }));
        const caseLabel = make('label', 'answer-case-toggle');
        const check = make('input'); check.type = 'checkbox'; check.checked = blank.caseInsensitive;
        check.addEventListener('change', () => { blank.caseInsensitive = check.checked; notify(); });
        caseLabel.append(check, make('span', '', 'Ignoruj wielkość liter')); card.append(caseLabel);
        card.append(action('Usuń lukę', () => {
          labels.splice(index, 1); parts.splice(index, 2, parts[index] + parts[index + 1]);
          question.blanks.splice(index, 1); sync();
        }, question.blanks.length <= 1 || labels.length !== question.blanks.length));
        section.append(card);
      });
      host.append(section);
    }
    render();
    return host;
  }
  const api = { textList, exam, newId };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChemAnswerFields = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
