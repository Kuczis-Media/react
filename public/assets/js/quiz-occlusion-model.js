(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemQuizOcclusionModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODES = Object.freeze({ one_per_mask: 'Jedna maska = jedna karta', all: 'Wszystkie maski na jednym obrazie', random: 'Losowa maska' });
  const COLORS = Object.freeze({ teal: '#116b63', blue: '#235ea0', violet: '#7040ad', dark: '#253247' });
  const MAX_MASKS = 50, MIN_SIZE = 0.005;
  const bounded = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
  const round = (n) => Math.round(n * 1e6) / 1e6;
  function rect(value) {
    const x = round(bounded(value.x, 0, 1 - MIN_SIZE)), y = round(bounded(value.y, 0, 1 - MIN_SIZE));
    return { x, y, width: round(bounded(value.width, MIN_SIZE, 1 - x)), height: round(bounded(value.height, MIN_SIZE, 1 - y)) };
  }
  function point(clientX, clientY, bounds) {
    if (!(bounds.width > 0 && bounds.height > 0)) return null;
    return { x: bounded((clientX - bounds.left) / bounds.width, 0, 1), y: bounded((clientY - bounds.top) / bounds.height, 0, 1) };
  }
  function draw(start, end) {
    return rect({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
  }
  function move(original, dx, dy) {
    return { ...rect(original), x: round(bounded(original.x + dx, 0, 1 - original.width)), y: round(bounded(original.y + dy, 0, 1 - original.height)) };
  }
  function resize(original, dx, dy) {
    return rect({ ...original, width: original.width + dx, height: original.height + dy });
  }
  function valid(value, published = false) {
    const str = (s, max) => typeof s === 'string' && s.length <= max && !s.includes('\0');
    if (!value || !Object.hasOwn(MODES, value.mode) || !Object.hasOwn(COLORS, value.color) || !Array.isArray(value.masks) || value.masks.length > MAX_MASKS || (published && !value.masks.length)) return false;
    const ids = new Set();
    return value.masks.every((m) => {
      if (!m || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(m.maskId || '') || ids.has(m.maskId)) return false;
      ids.add(m.maskId);
      if (!str(m.name, 160) || !str(m.answer, 3000) || !str(m.explanation, 3000)) return false;
      return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(m[key])) && m.x >= 0 && m.y >= 0 && m.width >= MIN_SIZE && m.height >= MIN_SIZE && m.x + m.width <= 1 + 1e-8 && m.y + m.height <= 1 + 1e-8;
    });
  }
  function normalize(value = {}, makeId) {
    if (!value || typeof value !== 'object') value = {};
    const text = (s, max) => String(s ?? '').replace(/\0/g, '').trim().slice(0, max);
    return {
      mode: Object.hasOwn(MODES, value.mode) ? value.mode : 'one_per_mask',
      color: Object.hasOwn(COLORS, value.color) ? value.color : 'teal',
      masks: (Array.isArray(value.masks) ? value.masks : []).slice(0, MAX_MASKS).map((entry) => {
        const mask = entry || {};
        return { maskId: makeId(mask.maskId), ...rect(mask), name: text(mask.name, 160), answer: text(mask.answer, 3000), explanation: text(mask.explanation, 3000) };
      })
    };
  }
  function expand(questions, random = Math.random) {
    return questions.flatMap((question) => {
      if (question.type !== 'image_occlusion') return [question];
      const masks = question.occlusion.masks;
      if (!masks.length || question.occlusion.mode === 'all') return [{ ...question, studyKey: `${question.questionId}/all`, activeMaskIds: masks.map((m) => m.maskId) }];
      const selected = question.occlusion.mode === 'random' ? [masks[Math.min(masks.length - 1, Math.floor(bounded(random(), 0, 1) * masks.length))]] : masks;
      return selected.map((mask) => ({ ...question, studyKey: `${question.questionId}/${mask.maskId}`, activeMaskIds: [mask.maskId] }));
    });
  }
  return Object.freeze({ MODES, COLORS, MAX_MASKS, MIN_SIZE, rect, point, draw, move, resize, valid, normalize, expand });
});
