(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemQuizPractice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DECK_TYPES = Object.freeze(['flashcard', 'single', 'multiple', 'text', 'image_occlusion']);
  function settings(value = {}) {
    return {
      ignoreCase: value?.ignoreCase !== false,
      collapseWhitespace: value?.collapseWhitespace !== false,
      ignoreFinalPeriod: value?.ignoreFinalPeriod === true,
      maxTypos: Math.max(0, Math.min(2, Math.floor(Number(value?.maxTypos) || 0)))
    };
  }
  function normalize(value, options) {
    let result = String(value ?? '').slice(0, 500).normalize('NFC').trim();
    if (options.collapseWhitespace) result = result.replace(/\s+/gu, ' ');
    if (options.ignoreFinalPeriod) result = result.replace(/\.$/u, '').trimEnd();
    if (options.ignoreCase) result = result.toLocaleLowerCase('pl');
    return result;
  }
  // Bounded Unicode edit distance. Candidate selection uses O(n) memory;
  // only the winning answer gets a trace for the learner's character diff.
  function distance(actual, expected) {
    let previous = Uint16Array.from({ length: expected.length + 1 }, (_, i) => i);
    let current = new Uint16Array(expected.length + 1);
    for (let i = 1; i <= actual.length; i++) {
      current[0] = i;
      for (let j = 1; j <= expected.length; j++) {
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (actual[i - 1] === expected[j - 1] ? 0 : 1));
      }
      [previous, current] = [current, previous];
    }
    return previous[expected.length];
  }
  function diff(actual, expected) {
    const width = expected.length + 1;
    const table = new Uint16Array((actual.length + 1) * width);
    for (let i = 0; i <= actual.length; i++) table[i * width] = i;
    for (let j = 0; j <= expected.length; j++) table[j] = j;
    for (let i = 1; i <= actual.length; i++) for (let j = 1; j <= expected.length; j++) {
      table[i * width + j] = Math.min(table[(i - 1) * width + j] + 1, table[i * width + j - 1] + 1,
        table[(i - 1) * width + j - 1] + (actual[i - 1] === expected[j - 1] ? 0 : 1));
    }
    const parts = [];
    let i = actual.length, j = expected.length;
    while (i || j) {
      const cost = table[i * width + j];
      if (i && j && actual[i - 1] === expected[j - 1]) {
        parts.push({ type: 'equal', text: actual[--i] }); j--;
      } else if (i && j && cost === table[(i - 1) * width + j - 1] + 1) {
        parts.push({ type: 'missing', text: expected[--j] }, { type: 'wrong', text: actual[--i] });
      } else if (i && cost === table[(i - 1) * width + j] + 1) parts.push({ type: 'wrong', text: actual[--i] });
      else parts.push({ type: 'missing', text: expected[--j] });
    }
    return parts.reverse().reduce((result, part) => {
      if (result.at(-1)?.type === part.type) result.at(-1).text += part.text;
      else result.push(part);
      return result;
    }, []);
  }
  function compare(answer, acceptedAnswers, configuration) {
    const options = settings(configuration);
    const normalized = normalize(answer, options), actual = Array.from(normalized);
    let best = null;
    for (const value of (acceptedAnswers || []).slice(0, 20)) {
      const expected = normalize(value, options);
      if (!expected) continue;
      const letters = Array.from(expected), edits = distance(actual, letters);
      const similarity = Math.round(100 * (1 - edits / Math.max(actual.length, letters.length, 1)));
      if (!best || similarity > best.similarity || (similarity === best.similarity && edits < best.edits)) {
        best = { expected: String(value).slice(0, 500), normalizedExpected: expected, edits, similarity, letters };
      }
      if (edits === 0) break;
    }
    best ||= { expected: '', normalizedExpected: '', edits: actual.length, similarity: 0, letters: [] };
    const { letters, ...result } = best;
    // Avoid accepting a different short chemical symbol as a "small typo".
    const correct = Boolean(normalized && letters.length) && (best.edits === 0 || (best.edits <= options.maxTypos && best.similarity >= 80));
    return { ...result, actual: normalized, correct, tolerated: correct && best.edits > 0, segments: diff(actual, letters) };
  }
  function evaluate(question, answer) {
    if (question.type === 'text') {
      const comparison = compare(answer, question.acceptedAnswers, question.textCompare);
      return { correct: comparison.correct, comparison, correctAnswers: [comparison.expected] };
    }
    const selected = new Set(Array.isArray(answer) ? answer : answer ? [answer] : []);
    const expected = question.options.filter((option) => option.correct);
    const correct = selected.size === expected.length && expected.every((option) => selected.has(option.optionId));
    return {
      correct, correctAnswers: expected.map((option) => option.text),
      optionStates: question.options.map((option) => ({ optionId: option.optionId, selected: selected.has(option.optionId),
        status: option.correct ? (selected.has(option.optionId) ? 'correct' : 'missed') : (selected.has(option.optionId) ? 'wrong' : 'neutral') }))
    };
  }
  return Object.freeze({ DECK_TYPES, settings, compare, evaluate });
});
