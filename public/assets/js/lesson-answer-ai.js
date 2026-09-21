(function (root) {
  'use strict';
  function collectImages(container) {
    if (!container) return [];
    return [...container.querySelectorAll('[data-lesson-media-ref], img')].filter((node) => !node.matches('img') || !node.closest('[data-lesson-media-ref]')).map((node) => {
      if (node.dataset.lessonMediaRef) return {
        reference: node.dataset.lessonMediaRef, repositoryId: node.dataset.lessonMediaRepository || '',
        materialId: node.dataset.lessonMediaOwner || '', scope: node.dataset.lessonMediaScope === 'shared' ? 'shared' : 'local',
        alt: node.dataset.lessonMediaAlt || 'Ilustracja'
      };
      return { src: node.getAttribute('src') || '', alt: node.getAttribute('alt') || 'Ilustracja' };
    });
  }
  function context({ slides, questionId, fallbackQuestion, keyRoot, document, parser }) {
    let question = fallbackQuestion || '', source = null;
    for (const slide of slides || []) {
      const candidate = document.createElement('div'); candidate.innerHTML = slide.html || '';
      const card = [...candidate.querySelectorAll('.lesson-student-answer[data-question-id]')].find((node) => node.dataset.questionId === questionId);
      if (!card) continue;
      question = card.dataset.question || question;
      candidate.querySelectorAll('.lesson-answer-review, .lesson-ai-help').forEach((node) => node.remove());
      candidate.querySelectorAll('.lesson-student-answer').forEach((node) => { if (node !== card) node.remove(); });
      // Preserve images embedded in the linked question; unrelated questions and reviews are excluded.
      source = candidate; break;
    }
    const images = [], seen = new Set();
    for (const item of [...collectImages(source), ...collectImages(keyRoot)]) {
      const id = item.src || `${item.repositoryId}:${item.materialId}:${item.scope}:${item.reference}`;
      if (seen.has(id)) continue; seen.add(id); images.push(item);
    }
    const surroundingRoot = source?.cloneNode(true);
    surroundingRoot?.querySelectorAll('.lesson-student-answer').forEach((node) => node.remove());
    const surroundings = surroundingRoot && parser?.buildLessonAiContext ? parser.buildLessonAiContext({ root: surroundingRoot, includeTask: false, maxChars: 5000 }) : '';
    const captions = images.map((item, index) => `Obraz ${index + 1} — ALT: ${item.alt}`).join('\n');
    // The explicit question and image descriptions take precedence over long slide context.
    return { question: [question, captions, surroundings].filter(Boolean).join('\n\n').slice(0, 8000), images };
  }
  const api = { context, collectImages };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChemLessonAnswerAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
