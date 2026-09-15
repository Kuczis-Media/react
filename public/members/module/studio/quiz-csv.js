(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemQuizCsv = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024, MAX_ROWS = 2000, MAX_COLUMNS = 32;
  const FIELDS = Object.freeze(['question', 'answer', 'explanation', 'type', 'tags', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF', 'correct']);
  const aliases = { question: ['question', 'front', 'pytanie', 'przód', 'przod'], answer: ['answer', 'back', 'odpowiedź', 'odpowiedz', 'tył', 'tyl'], explanation: ['explanation', 'wyjaśnienie', 'wyjasnienie'] };
  const normalize = (v) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');
  const key = (question, answer) => JSON.stringify([normalize(question), normalize(answer)]);
  const byteLength = (text) => new TextEncoder().encode(text).length;
  const typeNames = { flashcard: 'flashcard', fiszka: 'flashcard', single: 'single', single_choice: 'single', multiple: 'multiple', multiple_choice: 'multiple', text: 'text', text_compare: 'text' };

  function parseCsv(content, options = {}) {
    const result = { cards: [], count: 0, errors: [], rows: [], headers: [], mapping: {}, hasHeader: options.hasHeader === true, delimiter: ',' };
    const fail = (row, message) => { result.errors.push({ row, message }); return result; };
    if (typeof content !== 'string') return fail(0, 'CSV musi być tekstem UTF-8.');
    if (content.length > MAX_BYTES || byteLength(content) > MAX_BYTES) return fail(0, 'Plik CSV przekracza 2 MiB.');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(content)) return fail(0, 'Nieprawidłowy tekst CSV. Użyj kodowania UTF-8 bez znaków sterujących.');
    const raw = content.replace(/^\uFEFF/, '');
    // Count only separators outside quotes in the first logical record.
    const counts = { ',': 0, ';': 0, '\t': 0 }; let quoted = false;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '"') { if (quoted && raw[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && /[\r\n]/.test(raw[i])) { if (Object.values(counts).some(Boolean)) break; }
      else if (!quoted && Object.hasOwn(counts, raw[i])) counts[raw[i]]++;
    }
    const delimiter = options.delimiter || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!Object.hasOwn(counts, delimiter)) return fail(0, 'Wybierz przecinek, średnik albo tabulator.');
    result.delimiter = delimiter;
    let row = [], cell = '', inQuotes = false, closed = false, line = 1, startLine = 1;
    const pushCell = () => { row.push(cell); cell = ''; closed = false; };
    const pushRow = () => { pushCell(); if (row.some((v) => v.trim())) result.rows.push({ row: startLine, cells: row }); row = []; };
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inQuotes) {
        if (c === '"') { if (raw[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; closed = true; } }
        else { cell += c; if (c === '\n' || (c === '\r' && raw[i + 1] !== '\n')) line++; }
      } else if (c === delimiter) pushCell();
      else if (c === '\r' || c === '\n') {
        pushRow(); if (c === '\r' && raw[i + 1] === '\n') i++;
        line++; startLine = line;
      } else if (c === '"' && !cell && !closed) inQuotes = true;
      else if (c === '"' || closed) return fail(line, 'Nieprawidłowy cudzysłów lub tekst po zamknięciu pola.');
      else cell += c;
      if (cell.length > 10000 || row.length >= MAX_COLUMNS || result.rows.length > MAX_ROWS) return fail(line, 'Przekroczono limit: 10 000 znaków pola, 32 kolumny lub 2000 rekordów.');
    }
    if (inQuotes) return fail(startLine, 'Niezamknięty cudzysłów.');
    if (cell || row.length || closed) pushRow();
    if (result.rows.length > MAX_ROWS) return fail(line, 'CSV może zawierać najwyżej 2000 rekordów.');
    if (!result.rows.length) return result;
    const width = result.rows[0].cells.length;
    result.headers = result.hasHeader ? result.rows[0].cells : Array.from({ length: width }, (_, i) => `Kolumna ${i + 1}`);
    const mapping = Object.fromEntries(FIELDS.map((field) => [field, result.hasHeader
      ? result.headers.findIndex((header) => (aliases[field] || [field.toLowerCase()]).includes(normalize(header)))
      : field === 'question' ? 0 : field === 'answer' ? 1 : -1]));
    for (const field of FIELDS) if (Object.hasOwn(options.mapping || {}, field)) mapping[field] = options.mapping[field];
    result.mapping = mapping;
    if (Object.values(mapping).some((column) => !Number.isInteger(column) || column < -1 || column >= width)) return fail(0, 'Mapowanie wskazuje nieistniejącą kolumnę.');
    const used = Object.values(mapping).filter((v) => v >= 0);
    if (new Set(used).size !== used.length) return fail(0, 'Każde pole musi korzystać z osobnej kolumny.');
    if (mapping.question < 0) return fail(0, 'Wybierz kolumnę pytania.');
    for (const entry of result.rows.slice(result.hasHeader ? 1 : 0)) {
      const cells = entry.cells, get = (field) => cells[mapping[field]] ?? '';
      if (cells.length !== width) { fail(entry.row, `Liczba kolumn: ${cells.length}; oczekiwano ${width}.`); continue; }
      const typeName = normalize(get('type') || options.type || 'flashcard');
      const type = Object.hasOwn(typeNames, typeName) ? typeNames[typeName] : null;
      const front = get('question'), back = get('answer'), explanation = get('explanation');
      if (!type) { fail(entry.row, 'Nieobsługiwany typ. Użyj flashcard, single, multiple lub text.'); continue; }
      if (!front.trim() || (['flashcard', 'text'].includes(type) && !back.trim())) { fail(entry.row, 'Pytanie i odpowiedź nie mogą być puste.'); continue; }
      if (front.length > (type === 'flashcard' ? 10000 : 3000) || back.length > (type === 'text' ? 500 : 10000) || explanation.length > 3000) { fail(entry.row, 'Treść przekracza limit wybranego typu pytania.'); continue; }
      const tags = get('tags').split(/[;|]/).map((tag) => tag.trim()).filter(Boolean);
      if (tags.length > 20 || tags.some((tag) => tag.length > 60)) { fail(entry.row, 'Maksymalnie 20 tagów po 60 znaków; oddziel je średnikiem lub |.'); continue; }
      const card = { row: entry.row, front, back, explanation, tags, type, options: [] };
      if (['single', 'multiple'].includes(type)) {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
        card.options = letters.map((letter) => ({ letter, text: get(`option${letter}`), correct: false })).filter((o) => o.text.trim());
        const correct = get('correct').trim();
        const selected = correct ? correct.toUpperCase().split(/[;,|\s]+/).filter(Boolean) : [];
        if (selected.length) card.options.forEach((o) => { o.correct = selected.includes(o.letter); });
        else if (back.trim()) card.options.forEach((o) => { o.correct = normalize(o.text) === normalize(back); });
        if (card.options.length < 2 || card.options.some((o) => o.text.length > 500)
          || selected.some((letter) => !card.options.some((o) => o.letter === letter))
          || !card.options.some((o) => o.correct) || (type === 'single' && card.options.filter((o) => o.correct).length !== 1)) {
          fail(entry.row, 'Sprawdź opcje A–F i klucz correct (np. A lub A|C).'); continue;
        }
        card.back = card.options.filter((o) => o.correct).map((o) => o.text).sort().join('\n');
      }
      result.cards.push(card);
    }
    result.count = result.cards.length;
    return result;
  }

  function questionKey(q) {
    const answer = q.type === 'flashcard' ? q.back?.text : q.type === 'text' ? q.acceptedAnswers?.[0]
      : (q.options || []).filter((o) => o.correct).map((o) => o.text).sort().join('\n');
    return key(q.type === 'flashcard' ? q.front?.text : q.prompt, answer);
  }

  function importCardsFromCsv(quiz, content, options, model) {
    const parsed = parseCsv(content, options);
    const report = { quiz, count: 0, added: 0, skipped: 0, duplicates: 0, errors: [...parsed.errors], cards: [], parsed };
    const original = options.append === false ? [] : quiz.questions || [];
    const empty = original.length === 1 && original[0].type === 'flashcard'
      && !original[0].front?.text && !original[0].back?.text && !original[0].front?.images?.length && !original[0].back?.images?.length;
    const existing = empty ? [] : original;
    const seen = new Set(existing.map(questionKey));
    for (const card of parsed.cards) {
      const fingerprint = key(card.front, card.back), duplicate = seen.has(fingerprint);
      seen.add(fingerprint);
      if (duplicate) report.duplicates++;
      report.cards.push({ ...card, duplicate });
      if (duplicate && options.duplicates !== 'import') report.skipped++;
    }
    const accepted = report.cards.filter((c) => !c.duplicate || options.duplicates === 'import');
    if (existing.length + accepted.length > 200) report.errors.push({ row: 0, message: 'Pula może zawierać najwyżej 200 pytań. Nie dodano żadnego rekordu.' });
    if (report.errors.length || !accepted.length) return report;
    const candidate = structuredClone(quiz);
    candidate.mode = 'deck';
    candidate.metadata = { ...candidate.metadata, active: candidate.metadata?.active !== false, courseId: candidate.metadata?.courseId || '' };
    candidate.questions = [...existing, ...accepted.map((card) => model.createQuestion({
      type: card.type, prompt: card.front, front: { text: card.front }, back: { text: card.back },
      explanation: card.explanation, tags: card.tags, acceptedAnswers: [card.back], options: card.options
    }))];
    const validation = model.validate(candidate);
    report.errors.push(...validation.errors.map((error) => ({ row: 0, message: error.message })));
    if (byteLength(JSON.stringify(candidate)) > MAX_BYTES) report.errors.push({ row: 0, message: 'Docelowa pula przekracza 2 MiB.' });
    if (report.errors.length) return report;
    report.quiz = candidate; report.count = report.added = accepted.length;
    return report;
  }
  return Object.freeze({ parseCsv, importCardsFromCsv, MAX_BYTES, FIELDS });
});
