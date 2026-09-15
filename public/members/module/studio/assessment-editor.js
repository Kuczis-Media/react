(function exposeAssessmentEditor(root) {
  'use strict';
  const rich = root.ChemAssessmentText;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function field(label, control) {
    const node = element('label', 'exam-field');
    node.append(element('span', '', label), control);
    return node;
  }
  function select(options, value) {
    const node = element('select');
    Object.entries(options).forEach(([key, label]) => {
      const option = element('option', '', label); option.value = key; node.append(option);
    });
    node.value = value;
    return node;
  }
  function insert(input, before, after = '', placeholder = '') {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const selected = after ? input.value.slice(start, end) || placeholder : '';
    const replacement = before + selected + after;
    if (input.maxLength > 0 && input.value.length - (end - start) + replacement.length > input.maxLength) return false;
    input.setRangeText(replacement, start, end, 'end');
    input.focus();
    if (after) input.setSelectionRange(start + before.length, start + before.length + selected.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function create(value, format, onChange) {
    const box = element('div', 'assessment-editor');
    let style = rich.normalizeFormat(format);
    const text = element('textarea');
    text.value = value || ''; text.rows = 6; text.maxLength = 10_000;
    text.setAttribute('aria-label', 'Treść pytania');
    const preview = element('div', 'assessment-editor-preview');
    preview.setAttribute('aria-label', 'Podgląd treści pytania');
    let timer = 0;
    function changed() {
      onChange(text.value, { ...style });
      root.clearTimeout(timer);
      timer = root.setTimeout(() => rich.render(preview, text.value, style), 180);
    }
    text.addEventListener('input', changed);
    const toolbar = element('div', 'assessment-toolbar');
    toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Formatowanie zaznaczonego tekstu');
    for (const [label, title, marker] of [['B', 'Pogrubienie', '**'], ['I', 'Kursywa', '*'], ['U', 'Podkreślenie', '__'], ['x₂', 'Indeks dolny', '~'], ['x²', 'Indeks górny', '^']]) {
      const button = element('button', '', label); button.type = 'button'; button.title = title; button.setAttribute('aria-label', title);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => insert(text, marker, marker));
      toolbar.append(button);
    }
    const controls = element('div', 'assessment-format-controls');
    const font = select({ sans: 'Nowoczesna', serif: 'Szeryfowa', mono: 'Monospace', arial: 'Arial' }, style.font);
    const align = select({ left: 'Do lewej', center: 'Wyśrodkowanie', right: 'Do prawej', justify: 'Justowanie' }, style.align);
    const size = select({ small: 'Mały', normal: 'Normalny', large: 'Duży', xlarge: 'Bardzo duży' }, style.size);
    const color = element('input'); color.type = 'color'; color.value = style.color || '#172033';
    const bold = element('input'); bold.type = 'checkbox'; bold.checked = style.bold;
    for (const [control, key] of [[font, 'font'], [align, 'align'], [size, 'size'], [color, 'color'], [bold, 'bold']]) {
      control.addEventListener('input', () => { style[key] = control.type === 'checkbox' ? control.checked : control.value; changed(); });
    }
    const resetColor = element('button', 'button button-soft', 'Kolor domyślny'); resetColor.type = 'button';
    resetColor.addEventListener('click', () => { style.color = ''; color.value = '#172033'; changed(); });
    controls.append(field('Czcionka całego pytania', font), field('Wyrównanie', align), field('Rozmiar', size), field('Kolor tekstu', color), field('Całe pytanie pogrubione', bold), resetColor);
    const previewBox = element('section', 'assessment-question-preview');
    previewBox.append(element('strong', 'assessment-preview-label', 'Tak zobaczy to uczestnik'), preview);
    box.append(element('strong', '', 'Treść pytania'), toolbar, text, controls, formulaBuilder((formula) => insert(text, `\n\\[${formula}\\]\n`)), previewBox);
    rich.render(preview, text.value, style);
    return box;
  }

  function formulaBuilder(onInsert, options = {}) {
    const box = element('details', 'assessment-formula-builder');
    const summary = element('summary');
    const summaryCopy = element('span');
    summaryCopy.append(element('strong', '', 'Kreator równań'), element('small', '', 'Chemia i matematyka · podgląd na żywo'));
    const icon = element('span', 'assessment-formula-icon', 'H₂'); icon.setAttribute('aria-hidden', 'true');
    const expand = element('span', 'assessment-formula-expand', '+'); expand.setAttribute('aria-hidden', 'true');
    summary.append(icon, summaryCopy, expand);
    box.append(summary);
    const content = element('div', 'assessment-formula-content');
    let mode = options.mode || 'chemistry';
    const modes = element('div', 'assessment-formula-modes');
    modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Rodzaj równania');
    const chemistryButton = action('Chemia', 'Równanie chemiczne', () => changeMode('chemistry'));
    const mathButton = action('Matematyka', 'Wzór matematyczny', () => changeMode('math'));
    modes.append(chemistryButton, mathButton);
    const chemistry = element('div', 'assessment-chemistry-fields');
    const left = element('input'); left.value = '2 H2 + O2'; left.maxLength = 1000; left.setAttribute('aria-label', 'Substraty');
    const right = element('input'); right.value = '2 H2O'; right.maxLength = 1000; right.setAttribute('aria-label', 'Produkty');
    const arrow = select({ '->': '→ reakcja', '<=>': '⇌ równowaga', '<-': '← reakcja w lewo' }, '->');
    const above = element('input'); above.placeholder = 'np. Δ, UV lub Pt'; above.maxLength = 200;
    const leftPreview = element('span', 'assessment-field-preview');
    const rightPreview = element('span', 'assessment-field-preview');
    const leftField = field('Substraty', left); leftField.append(leftPreview);
    const rightField = field('Produkty', right); rightField.append(rightPreview);
    const reaction = element('div', 'assessment-reaction-fields');
    reaction.append(leftField, field('Przebieg reakcji', arrow), rightField);
    const conditions = element('div', 'assessment-reaction-conditions');
    conditions.append(field('Warunek nad strzałką (opcjonalnie)', above));
    const swap = action('⇄ Zamień strony', 'Zamień substraty z produktami', () => {
      [left.value, right.value] = [right.value, left.value];
      if (arrow.value === '->') arrow.value = '<-';
      else if (arrow.value === '<-') arrow.value = '->';
      refresh();
    });
    conditions.append(swap);
    const chemPresets = select({ water: 'Powstawanie wody', neutralization: 'Zobojętnianie', equilibrium: 'Równowaga chemiczna', ions: 'Strącanie osadu', combustion: 'Spalanie metanu' }, 'water');
    const reactions = {
      water: ['2 H2 + O2', '->', '2 H2O'], neutralization: ['HCl + NaOH', '->', 'NaCl + H2O'],
      equilibrium: ['N2 + 3 H2', '<=>', '2 NH3'], ions: ['Ag^{+} + Cl^{-}', '->', 'AgCl(s)'],
      combustion: ['CH4 + 2 O2', '->', 'CO2 + 2 H2O']
    };
    const chemExamples = element('div', 'assessment-formula-examples');
    chemExamples.append(field('Zacznij od przykładu', chemPresets), action('Użyj przykładu', 'Wstaw wybraną reakcję do kreatora', () => {
      [left.value, arrow.value, right.value] = reactions[chemPresets.value]; above.value = ''; refresh();
    }));
    chemistry.append(element('p', 'assessment-formula-help', 'Wpisuj jak zwykle, np. H2O. Cyfry przy symbolach zamienią się w indeksy w podglądzie. Współczynniki przed wzorami pozostaną na swoim miejscu.'), reaction, conditions, chemExamples);
    const math = element('div', 'assessment-math-fields'); math.hidden = true;
    const expression = element('textarea'); expression.rows = 3; expression.maxLength = 3000; expression.value = 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}';
    expression.setAttribute('aria-label', 'Wzór matematyczny');
    const presets = select({ quadratic: 'Równanie kwadratowe', fraction: 'Ułamek', root: 'Pierwiastek', power: 'Potęga', sum: 'Suma', integral: 'Całka', water: 'H₂O — woda', carbon: 'CO₂', sodium: 'Na⁺', calcium: 'Ca²⁺' }, 'quadratic');
    const snippets = { quadratic: expression.value, fraction: '\\frac{a}{b}', root: '\\sqrt{x}', power: 'x^{2}', sum: '\\sum_{i=1}^{n} x_i', integral: '\\int_{a}^{b} f(x)\\,dx', water: '\\ce{H2O}', carbon: '\\ce{CO2}', sodium: '\\ce{Na+}', calcium: '\\ce{Ca^{2+}}' };
    const mathExamples = element('div', 'assessment-formula-examples');
    mathExamples.append(field('Zacznij od przykładu', presets), action('Użyj przykładu', 'Wstaw wybrany wzór do kreatora', () => { expression.value = snippets[presets.value]; refresh(); }));
    math.append(element('p', 'assessment-formula-help', 'Wybierz przykład lub wpisz własny wzór. Przyciski poniżej pomogą dodać indeksy, potęgi i ułamki.'), field('Zapis wzoru', expression), mathExamples);
    [left, right, above, expression].forEach((input) => { input.spellcheck = false; input.autocomplete = 'off'; input.setAttribute('autocapitalize', 'off'); });
    let activeChemistry = left;
    [left, right].forEach((input) => input.addEventListener('focus', () => { activeChemistry = input; updateTools(); }));
    const tools = element('div', 'assessment-formula-tools');
    const toolLabel = element('small', 'assessment-formula-help');
    const commonTools = element('div', 'assessment-toolbar');
    commonTools.setAttribute('role', 'group'); commonTools.setAttribute('aria-label', 'Indeksy we wzorze');
    commonTools.append(
      action('x₂ Indeks dolny', 'Wstaw indeks dolny do wzoru', () => insertAtCursor('_{', '}', '2')),
      action('x² Indeks górny', 'Wstaw indeks górny do wzoru', () => insertAtCursor('^{', '}', '2'))
    );
    const chemTools = element('div', 'assessment-toolbar');
    chemTools.setAttribute('role', 'group'); chemTools.setAttribute('aria-label', 'Symbole chemiczne');
    for (const [label, title, value] of [['⁺', 'Ładunek dodatni', '^{+}'], ['⁻', 'Ładunek ujemny', '^{-}'], ['²⁺', 'Ładunek dwa plus', '^{2+}'], ['²⁻', 'Ładunek dwa minus', '^{2-}'], ['+', 'Dodaj składnik reakcji', ' + '], ['(aq)', 'Roztwór wodny', '(aq)'], ['(s)', 'Ciało stałe', '(s)'], ['(g)', 'Gaz', '(g)'], ['(l)', 'Ciecz', '(l)']]) {
      chemTools.append(action(label, title, () => insertAtCursor(value)));
    }
    const mathTools = element('div', 'assessment-toolbar');
    mathTools.setAttribute('role', 'group'); mathTools.setAttribute('aria-label', 'Symbole matematyczne');
    for (const [label, title, before, after, placeholder] of [['a/b', 'Wstaw ułamek', '\\frac{', '}{b}', 'a'], ['√x', 'Wstaw pierwiastek', '\\sqrt{', '}', 'x'], ['±', 'Plus minus', ' \\pm '], ['×', 'Mnożenie', ' \\times '], ['·', 'Iloczyn', ' \\cdot '], ['π', 'Liczba pi', '\\pi '], ['≤', 'Mniejsze lub równe', ' \\leq ']]) {
      mathTools.append(action(label, title, () => insertAtCursor(before, after, placeholder)));
    }
    for (const [label, title, value] of [['α', 'Alfa', '\\alpha '], ['β', 'Beta', '\\beta '], ['γ', 'Gamma', '\\gamma '], ['→', 'Strzałka reakcji', ' \\rightarrow '], ['⇌', 'Równowaga', ' \\rightleftharpoons '], ['Σ', 'Suma', '\\sum_{i=1}^{n} '], ['∫', 'Całka', '\\int_{a}^{b} '], ['H₂O', 'Woda', '\\ce{H2O}'], ['CO₂', 'Dwutlenek węgla', '\\ce{CO2}'], ['Na⁺', 'Jon sodu', '\\ce{Na+}'], ['Ca²⁺', 'Jon wapnia', '\\ce{Ca^{2+}}']]) {
      mathTools.append(action(label, title, () => insertAtCursor(value)));
    }
    tools.append(toolLabel, commonTools, chemTools, mathTools);
    const canvas = element('section', 'assessment-formula-canvas');
    const previewHeading = element('div', 'assessment-formula-preview-heading');
    previewHeading.append(element('strong', '', 'Podgląd na żywo'), element('span', 'assessment-live-badge', 'Widok uczestnika'));
    const preview = element('div'); preview.setAttribute('aria-label', 'Podgląd równania');
    canvas.append(previewHeading, preview);
    const note = element('p', 'assessment-formula-note'); note.setAttribute('role', 'status');
    const button = action(options.insertLabel || 'Wstaw równanie do pytania', options.insertLabel || 'Wstaw równanie do pytania', () => {
      const problem = validation();
      if (problem) { note.textContent = problem; return; }
      if (onInsert(formula()) === false) { note.textContent = options.insertLabel ? 'Nie można wstawić wzoru. Pole jest za długie lub nie jest już dostępne.' : 'Treść pytania jest za długa. Skróć ją przed dodaniem równania.'; return; }
      note.textContent = 'Równanie dodane. Zobacz podgląd pytania poniżej.';
    });
    button.className = 'button assessment-formula-insert';
    const formula = () => mode === 'math' ? expression.value.trim() : `\\ce{${left.value.trim()} ${arrow.value}${above.value.trim() ? `[${above.value.trim()}]` : ''} ${right.value.trim()}}`;
    function action(label, title, callback) {
      const node = element('button', 'button button-soft', label); node.type = 'button'; node.title = title; node.setAttribute('aria-label', title);
      node.addEventListener('mousedown', (event) => event.preventDefault()); node.addEventListener('click', callback);
      return node;
    }
    function changeMode(next) { mode = next; refresh(); }
    function updateTools() {
      toolLabel.textContent = mode === 'math' ? 'Wstaw w miejscu kursora we wzorze. Zaznacz fragment, aby zmienić go w indeks.' : `Wstaw w polu: ${activeChemistry === left ? 'substraty' : 'produkty'}. Kliknij pole, aby wybrać miejsce.`;
    }
    function insertAtCursor(before, after, placeholder) {
      if (!insert(mode === 'math' ? expression : activeChemistry, before, after, placeholder)) note.textContent = 'To pole jest za długie. Skróć zapis, aby dodać symbol.';
    }
    function balanced(value) {
      let depth = 0;
      for (const char of value) {
        if (char === '{') depth += 1;
        if (char === '}' && --depth < 0) return false;
      }
      return depth === 0;
    }
    function completeCompound(value) {
      const pairs = { '(': ')', '[': ']', '{': '}' }, stack = [];
      for (const char of value) {
        if (pairs[char]) stack.push(pairs[char]);
        else if (')]}'.includes(char) && stack.pop() !== char) return false;
      }
      return !stack.length && !/(?:^|\s)\+\s*$|(?:->|<-|<=>)\s*$|\{\s*\}/.test(value) && /[A-Za-z]/.test(value);
    }
    function validation() {
      if (mode === 'chemistry' && (!left.value.trim() || !right.value.trim())) return 'Uzupełnij substraty i produkty, aby dodać równanie.';
      if (mode === 'math' && !expression.value.trim()) return 'Wpisz wzór lub wybierz gotowy przykład.';
      if (mode === 'chemistry' && /[\[\]{}\\]/.test(above.value)) return 'W warunku wpisz sam symbol lub nazwę, np. Δ, UV albo Pt.';
      if (!(mode === 'math' ? [expression.value] : [left.value, right.value]).every(balanced)) return 'Domknij nawiasy klamrowe w zapisie indeksu lub wzoru.';
      if (mode === 'chemistry' && ![left.value, right.value].every(completeCompound)) return 'Sprawdź nawiasy i uzupełnij składniki po obu stronach reakcji.';
      if (!rich.safeFormula(formula())) return 'Ten zapis nie jest obsługiwany. Użyj symboli z paska lub jednego z przykładów.';
      return '';
    }
    function refresh() {
      chemistry.hidden = chemTools.hidden = mode !== 'chemistry'; math.hidden = mathTools.hidden = mode !== 'math';
      chemistryButton.setAttribute('aria-pressed', String(mode === 'chemistry')); mathButton.setAttribute('aria-pressed', String(mode === 'math'));
      updateTools();
      const problem = validation(); button.disabled = Boolean(problem);
      const message = problem || 'Podgląd zmienia się podczas pisania. Wstawienie wzoru nie zmienia punktacji ani nie uruchamia oceniania.';
      if (note.textContent !== message) note.textContent = message;
      for (const [input, fieldPreview] of [[left, leftPreview], [right, rightPreview]]) {
        const rendered = rich.formulaPreview?.(`\\ce{${input.value}}`);
        if (rendered != null) fieldPreview.innerHTML = rendered;
        else fieldPreview.textContent = input.value ? 'Pełny zapis zobaczysz w podglądzie poniżej.' : 'Tutaj pojawi się Twój wzór';
      }
      if (box.open) rich.render(preview, problem ? 'Uzupełnij zapis — tutaj pojawi się równanie.' : `\\[${formula()}\\]`, { size: 'xlarge', align: 'center' });
    }
    [left, right, arrow, above, expression].forEach((node) => node.addEventListener('input', refresh));
    box.addEventListener('toggle', () => { if (box.open) refresh(); });
    content.append(modes, chemistry, math, tools, canvas, note, button); box.append(content);
    refresh();
    return box;
  }

  let activeDialog = null;
  function openFor(input) {
    if (!input?.isConnected || input.disabled || input.readOnly) return;
    activeDialog?.remove();
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const dialog = element('dialog', 'assessment-equation-dialog');
    activeDialog = dialog;
    dialog.setAttribute('aria-label', 'Dodaj równanie do wybranego pola');
    const close = () => {
      rich.clear?.(dialog);
      root.MathJax?.typesetClear?.([dialog]);
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
      if (input.isConnected) input.focus({ preventScroll: true });
    };
    const cancel = element('button', 'button button-soft', 'Zamknij kreator'); cancel.type = 'button';
    cancel.addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    const builder = formulaBuilder((formula) => {
      if (!input.isConnected || input.disabled || input.readOnly) return false;
      input.setSelectionRange(start, end);
      if (!insert(input, `\\(${formula}\\)`)) return false;
      close(); return true;
    }, { mode: 'math', insertLabel: 'Wstaw do wybranego pola' });
    builder.open = true;
    dialog.append(cancel, builder); document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    builder.dispatchEvent(new Event('toggle'));
  }
  function equationButton(input) {
    const button = element('button', 'mini-button quiz-player-button is-secondary assessment-equation-trigger', 'fx · Dodaj równanie');
    button.type = 'button'; button.setAttribute('aria-label', 'Dodaj równanie');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => { event.preventDefault(); openFor(input); });
    return button;
  }
  root.ChemAssessmentEditor = Object.freeze({ create, openFor, equationButton });
})(window);
