(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemStudyScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, MINUTE = 60000;
  const MODES = Object.freeze({ all: 'Wszystkie karty', due: 'Do powtórzenia dzisiaj', new: 'Nowe', failed: 'Błędne', hard: 'Trudne' });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  // Anki SM-2 Spaced Repetition Engine for NextMed
  function fuzzInterval(interval, random = Math.random) {
    if (interval < 3) return interval;
    const fuzzRange = Math.min(1, interval * 0.05);
    const rnd = clamp(typeof random === 'function' ? random() : Number(random) || 0.5, 0, 1);
    const delta = (rnd * 2 - 1) * fuzzRange;
    return Math.max(1, Math.min(365, Math.round((interval + delta) * 100) / 100));
  }

  function formatInterval(intervalInDays) {
    if (!Number.isFinite(intervalInDays) || intervalInDays <= 0) return '< 10 min';
    if (intervalInDays <= 1 / 144) return '< 10 min';
    if (intervalInDays < 1) {
      const hours = Math.round(intervalInDays * 24);
      return hours <= 1 ? '1 godz.' : `${hours} godz.`;
    }
    const days = Math.round(intervalInDays);
    if (days === 1) return '1 dzień';
    if (days < 30) return `${days} dni`;
    if (days < 365) {
      const months = Math.round(days / 30);
      return months === 1 ? '1 mies.' : `${months} mies.`;
    }
    const years = (days / 365).toFixed(1);
    return `${years} r.`;
  }

  function review(previous, grade, now = Date.now(), answer = null, correct = null, options = {}) {
    if (![1, 2, 3, 4].includes(grade) || !Number.isFinite(now)) throw new Error('INVALID_REVIEW');
    const p = previous || {}, interval = clamp(p.interval, 0, 365), ease = clamp(p.ease || 1, .65, 1.6);
    const nextEase = Math.round(clamp(ease + ({ 1: -.15, 2: -.05, 3: .03, 4: .08 })[grade], .65, 1.6) * 100) / 100;
    let nextInterval = grade === 1 ? MINUTE / DAY
      : grade === 2 ? Math.max(1 / 6, Math.min(2, interval * .6))
        : grade === 3 ? Math.max(1, interval * (1.5 + nextEase * .35))
          : Math.max(3, interval * (2 + nextEase * .6));
    if (options && options.fuzz) {
      nextInterval = fuzzInterval(nextInterval, options.random);
    }
    const ms = Math.min(365 * DAY, Math.round(nextInterval * DAY));
    const wasCorrect = typeof correct === 'boolean' ? correct : grade !== 1;
    const repetitions = Math.min(1e6, (p.repetitions || 0) + 1);
    const intervalDays = ms / DAY;
    const status = grade === 1 || intervalDays < 1 ? 'learning' : repetitions >= 2 ? 'review' : 'learning';
    const dueTime = now + ms;
    const dueIso = new Date(dueTime).toISOString();
    return {
      status,
      easeFactor: nextEase,
      dueDate: dueIso.split('T')[0],
      repetitions,
      interval: intervalDays,
      ease: nextEase,
      dueAt: dueIso,
      lastReviewedAt: new Date(now).toISOString(),
      lastGrade: grade,
      attempts: Math.min(1e6, (p.attempts || 0) + 1),
      correct: Math.min(1e6, (p.correct || 0) + Number(wasCorrect)),
      hardMarks: Math.min(1e6, (p.hardMarks || 0) + Number(grade === 2)),
      incorrect: Math.min(1e6, (p.incorrect || 0) + Number(!wasCorrect)),
      lastCorrect: wasCorrect,
      lastAnswer: Array.isArray(answer) ? answer.slice(0, 6).map((a) => String(a).slice(0, 128)) : answer == null ? null : String(answer).slice(0, 500)
    };
  }

  function predictIntervals(previous, now = Date.now()) {
    const predictions = {};
    [1, 2, 3, 4].forEach((grade) => {
      const next = review(previous, grade, now);
      predictions[grade] = {
        interval: next.interval,
        dueAt: next.dueAt,
        timeLabel: formatInterval(next.interval),
        status: next.status,
        ease: next.ease
      };
    });
    return predictions;
  }

  function calculateStreak(reviewsOrDates, now = Date.now()) {
    if (!reviewsOrDates) return 0;
    const dates = new Set();
    if (Array.isArray(reviewsOrDates)) {
      reviewsOrDates.forEach((item) => {
        const d = typeof item === 'string' ? item : item?.lastReviewedAt || item?.date;
        if (d) dates.add(d.slice(0, 10));
      });
    } else if (typeof reviewsOrDates === 'object') {
      Object.values(reviewsOrDates).forEach((r) => {
        if (r?.lastReviewedAt) dates.add(r.lastReviewedAt.slice(0, 10));
      });
    }
    if (!dates.size) return 0;
    const nowDate = new Date(now);
    const todayStr = nowDate.toISOString().slice(0, 10);
    const yesterdayDate = new Date(now - DAY);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    let currentCheck = dates.has(todayStr) ? nowDate : dates.has(yesterdayStr) ? yesterdayDate : null;
    if (!currentCheck) return 0;

    let streak = 0;
    let checkTime = currentCheck.getTime();
    while (true) {
      const dateStr = new Date(checkTime).toISOString().slice(0, 10);
      if (dates.has(dateStr)) {
        streak++;
        checkTime -= DAY;
      } else {
        break;
      }
    }
    return streak;
  }

  function calculateRetentionStats(records = {}, now = Date.now()) {
    const entries = Object.values(records);
    let totalAttempts = 0, totalCorrect = 0, matureCards = 0, learningCards = 0, newCards = 0;
    const daysMap = {};

    entries.forEach((r) => {
      if (!r) return;
      totalAttempts += Number(r.attempts) || 0;
      totalCorrect += Number(r.correct) || 0;
      if (!r.attempts) {
        newCards++;
      } else if (r.interval >= 21) {
        matureCards++;
      } else {
        learningCards++;
      }
      if (r.lastReviewedAt) {
        const d = r.lastReviewedAt.slice(0, 10);
        daysMap[d] = (daysMap[d] || 0) + (Number(r.attempts) || 1);
      }
    });

    const retentionRate = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 100;
    const streak = calculateStreak(entries, now);

    return {
      totalCards: entries.length,
      totalAttempts,
      totalCorrect,
      retentionRate,
      matureCards,
      learningCards,
      newCards,
      streak,
      activityMap: daysMap
    };
  }

  function cards(questions) {
    return questions.flatMap((q) => {
      if (q.type !== 'image_occlusion') return [{ ...q, studyKey: q.questionId }];
      if (q.occlusion.mode === 'all') return [{ ...q, studyKey: `${q.questionId}/all`, activeMaskIds: q.occlusion.masks.map((m) => m.maskId) }];
      return q.occlusion.masks.map((m) => ({ ...q, studyKey: `${q.questionId}/${m.maskId}`, activeMaskIds: [m.maskId] }));
    });
  }
  function matches(state, mode, now = Date.now()) {
    if (mode === 'new') return !state?.attempts;
    if (mode === 'failed') return state?.lastGrade === 1 || state?.lastCorrect === false;
    if (mode === 'hard') return state?.lastGrade === 2;
    if (mode === 'due') return Boolean(state?.dueAt && Date.parse(state.dueAt) <= now);
    return true;
  }
  function select(all, records, mode, now = Date.now(), random = Math.random) {
    const selected = all.filter((q) => matches(records[q.studyKey], mode, now)), groups = new Map();
    const output = selected.filter((q) => {
      if (q.type !== 'image_occlusion' || q.occlusion.mode !== 'random') return true;
      if (!groups.has(q.questionId)) groups.set(q.questionId, []);
      groups.get(q.questionId).push(q); return false;
    });
    groups.forEach((group) => output.push(group[Math.min(group.length - 1, Math.floor(clamp(random(), 0, 1) * group.length))]));
    return output;
  }
  function stats(all, records, now = Date.now()) {
    const result = { total: all.length, new: 0, due: 0, failed: 0, hard: 0, hardMarks: 0, attempts: 0, correct: 0, incorrect: 0 };
    all.forEach((q) => { const s = records[q.studyKey]; for (const mode of ['new', 'due', 'failed', 'hard']) if (matches(s, mode, now)) result[mode]++;
      for (const key of ['attempts', 'correct', 'incorrect', 'hardMarks']) result[key] += Number(s?.[key]) || 0;
    }); return result;
  }
  return Object.freeze({
    DAY, MINUTE, MODES, review, cards, select, matches, stats,
    fuzzInterval, formatInterval, predictIntervals, calculateStreak, calculateRetentionStats
  });
});
