const test = require('node:test');
const assert = require('node:assert/strict');

const progressCommon = require('../netlify/progress-common.js');
const examProgress = require('../netlify/exam-progress.js');
const progressFunction = require('../netlify/functions/progress.js');
const adminProgressFunction = require('../netlify/functions/admin-progress.js');
const { CATALOG_KEY, listEntries } = require('../netlify/progress-storage.js');

const USER_ONE = '11111111-1111-4111-8111-111111111111';
const USER_TWO = '22222222-2222-4222-8222-222222222222';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY_URL = 'https://course.example/.netlify/identity';

function progress(overrides = {}) {
  return {
    tracking: 'INHERIT',
    showProgress: 'INHERIT',
    includeInSection: true,
    includeInDepartment: true,
    includeInCourse: true,
    weight: 1,
    ...overrides
  };
}

function catalog(overrides = {}) {
  return progressCommon.normalizeCatalog({
    global: { tracking: 'ON', showProgress: 'ON', recordOpens: true },
    nodes: [
      { id: 'course', type: 'course', title: 'ChemDisk', progress: progress({ tracking: 'ON' }) },
      { id: 'organic', parentId: 'course', type: 'department', title: 'Organiczna', progress: progress() },
      { id: 'alcohols', parentId: 'organic', type: 'section', title: 'Alkohole', progress: progress() },
      { id: 'accordion', parentId: 'alcohols', type: 'other', title: 'Harmonijka', progress: progress() },
      { id: 'slides', parentId: 'accordion', type: 'presentation', title: 'Slajdy', progress: progress({ weight: 3 }) },
      { id: 'video', parentId: 'alcohols', type: 'video', title: 'Film', progress: progress({ weight: 1 }), settings: { videoCompletionThreshold: 90 } }
    ],
    ...overrides
  });
}

function merge(existing, event, options = {}) {
  const normalizedCatalog = options.catalog || catalog();
  const resolved = progressCommon.effectiveSettings(normalizedCatalog);
  const node = options.node || resolved.byId.get(event.materialId) || null;
  return progressCommon.mergeProgressEvent(existing, event, {
    userId: USER_ONE,
    node,
    effective: node ? resolved.effective.get(node.id) : { tracking: true, showProgress: true },
    global: options.global || normalizedCatalog.global,
    preferences: options.preferences || {},
    isAdmin: options.isAdmin === true,
    records: options.records || {},
    isLeaf: options.isLeaf,
    now: options.now || '2026-08-15T10:00:00.000Z'
  });
}

test('tracking inheritance supports section OFF and a material ON override', () => {
  const source = catalog({
    nodes: [
      { id: 'course', type: 'course', progress: progress({ tracking: 'ON', showProgress: 'ON' }) },
      { id: 'section', parentId: 'course', type: 'section', progress: progress({ tracking: 'OFF', showProgress: 'OFF' }) },
      { id: 'inherited', parentId: 'section', type: 'pdf', progress: progress() },
      { id: 'override', parentId: 'section', type: 'pdf', progress: progress({ tracking: 'ON', showProgress: 'ON' }) }
    ]
  });
  const resolved = progressCommon.effectiveSettings(source).effective;
  assert.equal(resolved.get('inherited').tracking, false);
  assert.equal(resolved.get('inherited').showProgress, false);
  assert.equal(resolved.get('override').tracking, true);
  assert.equal(resolved.get('override').showProgress, true);
});

test('dashboard organizer unlocks each module only after all previous modules are complete', () => {
  const source = progressCommon.normalizeCatalog({
    global: { tracking: 'ON', showProgress: 'ON', recordOpens: true },
    nodes: [
      { id: 'course', type: 'course', progress: progress({ tracking: 'ON' }) },
      { id: 'path', parentId: 'course', type: 'section', title: 'Ścieżka', progress: progress(), settings: { navigation: 'sequential' } },
      { id: 'slides-step', parentId: 'path', type: 'presentation', title: 'Slajdy', order: 1, progress: progress(), settings: { manualCompletion: true } },
      { id: 'lesson-step', parentId: 'path', type: 'lesson', title: 'Lekcja', order: 2, progress: progress() },
      { id: 'exam-step', parentId: 'path', type: 'exam', title: 'Egzamin', order: 3, progress: progress() }
    ]
  });
  const accessFor = (records) => {
    const user = progressCommon.normalizeUserDocument({ records }, USER_ONE);
    return progressCommon.sequenceAccessMap(source, progressCommon.aggregateUser(user, source), user.preferences);
  };

  let access = accessFor({});
  assert.equal(access['slides-step'].allowed, true);
  assert.equal(access['lesson-step'].allowed, false);
  assert.equal(access['lesson-step'].prerequisiteId, 'slides-step');
  assert.equal(access['exam-step'].allowed, false);

  access = accessFor({
    'slides-step': { status: 'completed', progressPercent: 100, completedAt: '2026-08-15T10:00:00.000Z' }
  });
  assert.equal(access['lesson-step'].allowed, true);
  assert.equal(access['exam-step'].allowed, false);
  assert.equal(access['exam-step'].prerequisiteId, 'lesson-step');

  access = accessFor({
    'slides-step': { status: 'completed', progressPercent: 100, completedAt: '2026-08-15T10:00:00.000Z' },
    'lesson-step': { status: 'completed', progressPercent: 100, completedAt: '2026-08-15T10:05:00.000Z' }
  });
  assert.equal(access['exam-step'].allowed, true);
});

test('global progress OFF suppresses percentages but can keep open history', () => {
  const off = catalog({ global: { tracking: 'OFF', showProgress: 'OFF', recordOpens: true } });
  const opened = merge(null, {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }, { catalog: off });
  assert.equal(opened.record.status, 'opened');
  assert.equal(opened.record.openCount, 1);

  const unchanged = merge(opened.record, {
    materialId: 'slides', materialType: 'presentation', action: 'presentation',
    details: { lastSlideId: '17', lastSlideIndex: 16, highestReachedSlide: 17, totalSlides: 25 }
  }, { catalog: off });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.record.progressPercent, 0);

  const noOpens = catalog({ global: { tracking: 'OFF', showProgress: 'OFF', recordOpens: false } });
  const ignored = merge(null, {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }, { catalog: noOpens });
  assert.equal(ignored.changed, false);
  assert.equal(ignored.record, null);
});

test('opening a non-lesson leaf completes it while lessons and containers keep exact progress', () => {
  const openedPresentation = merge(null, {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  });
  assert.equal(openedPresentation.record.progressPercent, 100);
  assert.equal(openedPresentation.record.status, 'completed');
  assert.equal(openedPresentation.record.openCount, 1);

  const legacyManualPresentation = progressCommon.normalizeCatalog({ nodes: [{
    id: 'legacy-slides', type: 'presentation', progress: progress({ tracking: 'ON' }),
    settings: { manualCompletion: true }
  }] }).nodes[0];
  const openedLegacyPresentation = merge(null, {
    materialId: 'legacy-slides', materialType: 'presentation', action: 'open', opened: true
  }, { node: legacyManualPresentation });
  assert.equal(openedLegacyPresentation.record.progressPercent, 100);
  assert.equal(openedLegacyPresentation.record.status, 'completed');

  const lessonNode = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson', type: 'lesson', progress: progress({ tracking: 'ON' })
  }] }).nodes[0];
  const openedLesson = merge(null, {
    materialId: 'lesson', materialType: 'lesson', action: 'open', opened: true
  }, { node: lessonNode });
  assert.equal(openedLesson.record.progressPercent, 0);
  assert.equal(openedLesson.record.status, 'opened');

  const disguisedLesson = merge(null, {
    materialId: 'lesson', materialType: 'presentation', action: 'open', opened: true
  }, { node: lessonNode });
  assert.equal(disguisedLesson.record.materialType, 'lesson');
  assert.equal(disguisedLesson.record.progressPercent, 0);

  const openedContainer = merge(null, {
    materialId: 'accordion', materialType: 'other', action: 'open', opened: true
  }, { isLeaf: false });
  assert.equal(openedContainer.record.progressPercent, 0);
  assert.equal(openedContainer.record.status, 'opened');

  const examNode = progressCommon.normalizeCatalog({ nodes: [{
    id: 'exam-one', type: 'exam', progress: progress({ tracking: 'ON' })
  }] }).nodes[0];
  const openedExam = merge(null, {
    materialId: 'exam-one', materialType: 'exam', action: 'open', opened: true
  }, { node: examNode });
  assert.equal(openedExam.record.progressPercent, 0);
  assert.equal(openedExam.record.status, 'opened');

  const opensDisabled = catalog({ global: { tracking: 'ON', showProgress: 'ON', recordOpens: false } });
  const completedWithoutOpenTelemetry = merge(null, {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }, { catalog: opensDisabled });
  assert.equal(completedWithoutOpenTelemetry.record.progressPercent, 100);
  assert.equal(completedWithoutOpenTelemetry.record.opened, false);
  assert.equal(completedWithoutOpenTelemetry.record.openCount, 0);
});

test('exam progress keeps the student result visibility policy for lesson embeds', () => {
  const examNode = progressCommon.normalizeCatalog({ nodes: [{
    id: 'exam-private-result', type: 'exam', progress: progress({ tracking: 'ON' })
  }] }).nodes[0];
  const completed = merge(null, {
    materialId: 'exam-private-result',
    materialType: 'exam',
    action: 'exam',
    details: {
      started: true,
      completed: true,
      answeredQuestions: 10,
      totalQuestions: 10,
      scorePercent: 80,
      passed: true,
      studentResultVisible: false
    }
  }, { node: examNode });

  assert.equal(completed.record.status, 'completed');
  assert.equal(completed.record.details.studentResultVisible, false);
  assert.equal(completed.record.details.scorePercent, 80);
  assert.equal(completed.record.details.passed, true);
});

test('hierarchical aggregation weights enabled direct children at every level', () => {
  const user = progressCommon.normalizeUserDocument({
    userId: USER_ONE,
    records: {
      slides: { materialType: 'presentation', progressPercent: 100, completedAt: '2026-08-15T10:00:00Z' },
      video: { materialType: 'video', progressPercent: 0 }
    }
  }, USER_ONE);
  const aggregate = progressCommon.aggregateUser(user, catalog());
  assert.equal(aggregate.course.progressPercent, 50);
  assert.equal(aggregate.nodes.accordion.progressPercent, 100);
  assert.equal(aggregate.nodes.alcohols.trackedCount, 2);
  assert.equal(aggregate.course.completedCount, 1);
});

test('a lesson is an aggregate leaf and contributes its saved progress to section and course', () => {
  const source = catalog({
    nodes: [
      { id: 'course', type: 'course', progress: progress({ tracking: 'ON' }) },
      { id: 'department', parentId: 'course', type: 'department', progress: progress() },
      { id: 'section', parentId: 'department', type: 'section', progress: progress() },
      {
        id: 'lesson-card', parentId: 'section', type: 'lesson', progress: progress(),
        settings: { contentFile: 'lekcja.md', repositoryId: 'default' }
      }
    ]
  });
  const user = progressCommon.normalizeUserDocument({
    userId: USER_ONE,
    records: {
      'lesson-card': {
        materialType: 'lesson', progressPercent: 100,
        completedAt: '2026-08-15T10:00:00Z', lastActivityAt: '2026-08-15T10:00:00Z'
      }
    }
  }, USER_ONE);
  const aggregate = progressCommon.aggregateUser(user, source);
  assert.equal(aggregate.nodes['lesson-card'].tracked, true);
  assert.equal(aggregate.nodes['lesson-card'].trackedCount, 1);
  assert.equal(aggregate.nodes.section.progressPercent, 100);
  assert.equal(aggregate.course.progressPercent, 100);
  assert.equal(aggregate.course.completedCount, 1);
});

test('exam aggregation recovers a completed canonical record when an older dashboard card is only opened', () => {
  const source = catalog({
    nodes: [
      { id: 'course', type: 'course', progress: progress({ tracking: 'ON' }) },
      {
        id: 'exam-card', parentId: 'course', type: 'exam', progress: progress(),
        settings: { repositoryId: 'default', examId: 'organic-final' }
      }
    ]
  });
  const user = progressCommon.normalizeUserDocument({
    userId: USER_ONE,
    records: {
      'exam-card': {
        materialType: 'exam', opened: true, progressPercent: 0,
        lastActivityAt: '2026-08-15T10:00:00Z'
      },
      'exam:default:organic-final': {
        materialType: 'exam', opened: true, progressPercent: 100,
        completedAt: '2026-08-15T11:00:00Z', lastActivityAt: '2026-08-15T11:00:00Z',
        details: { scorePercent: 86, passed: true }
      }
    }
  }, USER_ONE);
  const aggregate = progressCommon.aggregateUser(user, source);
  assert.equal(aggregate.nodes['exam-card'].progressPercent, 100);
  assert.equal(aggregate.nodes['exam-card'].record.materialId, 'exam-card');
  assert.equal(aggregate.nodes['exam-card'].record.details.scorePercent, 86);
  assert.equal(aggregate.course.progressPercent, 100);
  assert.equal(aggregate.counts.completed, 1);
});

test('legacy inclusion flags are ignored and every enabled child contributes to all ancestors', () => {
  const source = catalog({
    nodes: [
      { id: 'course', type: 'course', progress: progress({ tracking: 'ON' }) },
      { id: 'dep', parentId: 'course', type: 'department', progress: progress() },
      { id: 'sec', parentId: 'dep', type: 'section', progress: progress() },
      { id: 'required', parentId: 'sec', type: 'pdf', progress: progress() },
      { id: 'extra', parentId: 'sec', type: 'pdf', progress: progress({ includeInSection: false, includeInDepartment: false, includeInCourse: false }) }
    ]
  });
  const user = progressCommon.normalizeUserDocument({ records: {
    required: { progressPercent: 50 },
    extra: { progressPercent: 100, completedAt: '2026-08-15T10:00:00Z' }
  } }, USER_ONE);
  const aggregate = progressCommon.aggregateUser(user, source);
  assert.equal(aggregate.nodes.sec.progressPercent, 75);
  assert.equal(aggregate.nodes.dep.progressPercent, 75);
  assert.equal(aggregate.course.progressPercent, 75);
});

test('containers with no enabled descendants have zero tracked items', () => {
  const source = catalog({
    nodes: [
      { id: 'course', type: 'course', progress: progress({ tracking: 'ON' }) },
      { id: 'sec', parentId: 'course', type: 'section', progress: progress() },
      { id: 'one', parentId: 'sec', type: 'pdf', progress: progress({ tracking: 'OFF' }) },
      { id: 'two', parentId: 'sec', type: 'video', progress: progress({ tracking: 'OFF' }) }
    ]
  });
  const aggregate = progressCommon.aggregateUser({ userId: USER_ONE }, source);
  assert.equal(aggregate.nodes.sec.trackedCount, 0);
  assert.equal(aggregate.course.trackedCount, 0);
  assert.equal(aggregate.course.progressPercent, 0);
});

test('lesson percentage excludes optional steps and uses stable step IDs', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson', type: 'lesson', progress: progress({ tracking: 'ON' }),
    settings: {
      navigation: 'sequential',
      steps: [
        { id: 'intro', includeInLesson: true },
        { id: 'extra', includeInLesson: false },
        { id: 'task', includeInLesson: true }
      ]
    }
  }] }).nodes[0];
  const result = merge(null, {
    materialId: 'lesson', materialType: 'lesson', action: 'lesson_step',
    details: { currentStepId: 'intro', completedStepIds: ['intro'] }
  }, { node });
  assert.equal(result.ok, true);
  assert.equal(result.record.progressPercent, 50);
  assert.equal(result.record.details.totalTrackedSteps, 2);
  assert.deepEqual(result.record.details.completedStepIds, ['intro']);
});

test('server lesson navigation blocks jumps and honors per-user allow/deny/lock overrides', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson', type: 'lesson', progress: progress({ tracking: 'ON' }),
    settings: { navigation: 'sequential', steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
  }] }).nodes[0];
  const jump = merge(null, {
    materialId: 'lesson', action: 'lesson_step', details: { currentStepId: 'c', completedStepIds: ['a', 'b'] }
  }, { node });
  assert.equal(jump.code, 'STEP_NOT_UNLOCKED');

  const allowed = merge(null, {
    materialId: 'lesson', action: 'lesson_step', details: { currentStepId: 'c' }
  }, { node, preferences: { skipMode: 'ALLOW' } });
  assert.equal(allowed.ok, true);

  const freeNode = { ...node, settings: { ...node.settings, navigation: 'free' } };
  const denied = merge(null, {
    materialId: 'lesson', action: 'lesson_step', details: { currentStepId: 'c' }
  }, { node: freeNode, preferences: { skipMode: 'DENY' } });
  assert.equal(denied.code, 'STEP_NOT_UNLOCKED');

  const locked = merge(null, {
    materialId: 'lesson', action: 'lesson_step', details: { currentStepId: 'b', completedStepIds: ['a'] }
  }, { node, preferences: { skipMode: 'ALLOW', lockedStepIds: ['b'] } });
  assert.equal(locked.code, 'STEP_LOCKED');
  const adminJump = merge(null, {
    materialId: 'lesson', action: 'lesson_step', details: { currentStepId: 'c' }
  }, { node, isAdmin: true, preferences: { skipMode: 'DENY', lockedStepIds: ['c'] } });
  assert.equal(adminJump.ok, true);
  assert.equal(adminJump.record.progressPercent, 0, 'Skipping does not complete the task');

  const bypass = merge(null, {
    materialId: 'lesson', action: 'complete', details: { currentStepId: 'c', completedStepIds: ['c'] }
  }, { node });
  assert.equal(bypass.code, 'LESSON_INCOMPLETE');
  const finished = merge(null, {
    materialId: 'lesson', action: 'complete', details: { currentStepId: 'c', completedStepIds: ['a', 'b', 'c'] }
  }, { node });
  assert.equal(finished.record.status, 'completed');
  assert.deepEqual(finished.record.details.completedStepIds, ['a', 'b', 'c']);
});

test('free lesson navigation counts completed stable steps in any order', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson-free', type: 'lesson', progress: progress({ tracking: 'ON' }),
    settings: { navigation: 'free', steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
  }] }).nodes[0];
  const firstJump = merge(null, {
    materialId: 'lesson-free', action: 'lesson_step',
    details: { currentStepId: 'c', completedStepIds: ['a'] }
  }, { node });
  assert.equal(firstJump.ok, true);
  assert.equal(Math.round(firstJump.record.progressPercent), 33);

  const secondJump = merge(firstJump.record, {
    materialId: 'lesson-free', action: 'lesson_step',
    details: { currentStepId: 'b', completedStepIds: ['a', 'c'] }
  }, { node });
  assert.equal(secondJump.ok, true);
  assert.equal(Math.round(secondJump.record.progressPercent), 67);
  assert.deepEqual(secondJump.record.details.completedStepIds, ['a', 'c']);
});

test('lesson open answers persist multiline text and merge by stable question id', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson-open-answer', type: 'lesson', progress: progress({ tracking: 'ON' }),
    settings: { navigation: 'free', steps: [{ id: 'question' }, { id: 'review' }] }
  }] }).nodes[0];
  const first = merge(null, {
    materialId: 'lesson-open-answer', action: 'lesson_step',
    details: {
      currentStepId: 'question',
      lessonAnswers: {
        q_chem_001: {
          answer: 'Pierwszy wiersz.\nDrugi wiersz odpowiedzi ucznia.',
          answeredAt: '2026-08-15T09:59:00.000Z',
          updatedAt: '2026-08-15T10:00:00.000Z',
          version: 1,
          aiUsed: false
        }
      }
    }
  }, { node });
  assert.equal(first.ok, true);
  assert.equal(
    first.record.details.lessonAnswers.q_chem_001.answer,
    'Pierwszy wiersz.\nDrugi wiersz odpowiedzi ucznia.'
  );
  assert.equal(first.record.details.lessonAnswers.q_chem_001.version, 1);

  const withAi = merge(first.record, {
    materialId: 'lesson-open-answer', action: 'lesson_step',
    details: {
      currentStepId: 'review',
      lessonAnswers: {
        q_chem_001: {
          answer: 'Pierwszy wiersz.\nDrugi wiersz odpowiedzi ucznia.',
          updatedAt: '2026-08-15T10:01:00.000Z',
          version: 1,
          aiUsed: true,
          aiCheckedAnswerVersion: 1,
          aiResponse: 'Odpowiedź jest poprawna.\nZawiera oba wymagane elementy.',
          aiCheckedAt: '2026-08-15T10:01:30.000Z'
        },
        q_chem_002: {
          answer: 'Druga niezależna odpowiedź.',
          updatedAt: '2026-08-15T10:01:00.000Z',
          version: 1,
          aiUsed: false
        }
      }
    }
  }, { node, now: '2026-08-15T10:02:00.000Z' });
  assert.equal(withAi.record.details.lessonAnswers.q_chem_001.aiUsed, true);
  assert.match(withAi.record.details.lessonAnswers.q_chem_001.aiResponse, /\n/);
  assert.equal(withAi.record.details.lessonAnswers.q_chem_002.answer, 'Druga niezależna odpowiedź.');

  const edited = merge(withAi.record, {
    materialId: 'lesson-open-answer', action: 'lesson_step',
    details: {
      currentStepId: 'question',
      lessonAnswers: {
        q_chem_001: {
          answer: 'Najnowsza poprawiona odpowiedź.',
          answeredAt: '2026-08-15T09:59:00.000Z',
          updatedAt: '2026-08-15T10:03:00.000Z',
          version: 2,
          aiUsed: false,
          aiCheckedAnswerVersion: '',
          aiResponse: '',
          aiCheckedAt: null
        }
      }
    }
  }, { node, now: '2026-08-15T10:03:00.000Z' });
  assert.equal(edited.record.details.lessonAnswers.q_chem_001.answer, 'Najnowsza poprawiona odpowiedź.');
  assert.equal(edited.record.details.lessonAnswers.q_chem_001.aiUsed, false);
  assert.equal(edited.record.details.lessonAnswers.q_chem_001.aiResponse, '');
  assert.equal(edited.record.details.lessonAnswers.q_chem_002.answer, 'Druga niezależna odpowiedź.');
});

test('lesson open answer normalization rejects unsafe ids and stale overwrites', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson-answer-order', type: 'lesson', progress: progress({ tracking: 'ON' }),
    settings: { navigation: 'free', steps: [{ id: 'question' }] }
  }] }).nodes[0];
  const existing = merge(null, {
    materialId: 'lesson-answer-order', action: 'lesson_step',
    details: { currentStepId: 'question', lessonAnswers: {
      stable_question: {
        answer: 'Nowsza odpowiedź', updatedAt: '2026-08-15T10:05:00.000Z', version: 2
      },
      'niebezpieczne id!': { answer: 'Nie zapisuj mnie' }
    } }
  }, { node, now: '2026-08-15T10:05:00.000Z' });
  assert.equal(existing.record.details.lessonAnswers['niebezpieczne id!'], undefined);

  const stale = merge(existing.record, {
    materialId: 'lesson-answer-order', action: 'lesson_step',
    details: { currentStepId: 'question', lessonAnswers: {
      stable_question: {
        answer: 'Stara odpowiedź', updatedAt: '2026-08-15T10:04:00.000Z', version: 1
      }
    } }
  }, { node, now: '2026-08-15T10:06:00.000Z' });
  assert.equal(stale.record.details.lessonAnswers.stable_question.answer, 'Nowsza odpowiedź');
  assert.equal(stale.record.details.lessonAnswers.stable_question.version, 2);
});

test('lesson exam conditions stay locked after a failed attempt and unlock after pass or minimum score', () => {
  const examMaterialId = 'exam:default:egzamin-testowy';
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson-exam', type: 'lesson', progress: progress({ tracking: 'ON' }),
    settings: {
      navigation: 'sequential',
      steps: [
        { id: 'exam-step', includeInLesson: false, requiredToAdvance: true, condition: { type: 'exam_passed', materialId: examMaterialId } },
        { id: 'summary', includeInLesson: true, requiredToAdvance: true }
      ]
    }
  }] }).nodes[0];
  const failedRecord = { status: 'completed', details: { scorePercent: 45, passed: false } };
  const blocked = merge(null, {
    materialId: 'lesson-exam', action: 'lesson_step', details: { currentStepId: 'summary', completedStepIds: ['exam-step'] }
  }, { node, records: { [examMaterialId]: failedRecord } });
  assert.equal(blocked.code, 'STEP_NOT_UNLOCKED');

  const passed = merge(null, {
    materialId: 'lesson-exam', action: 'lesson_step', details: { currentStepId: 'summary', completedStepIds: ['exam-step'] }
  }, { node, records: { [examMaterialId]: { status: 'completed', details: { scorePercent: 75, passed: true } } } });
  assert.equal(passed.ok, true);

  const minimumNode = {
    ...node,
    settings: {
      ...node.settings,
      steps: [
        { id: 'exam-step', includeInLesson: false, requiredToAdvance: true, condition: { type: 'minimum_score', materialId: examMaterialId, minimumScore: 80 } },
        node.settings.steps[1]
      ]
    }
  };
  const belowMinimum = merge(null, {
    materialId: 'lesson-exam', action: 'lesson_step', details: { currentStepId: 'summary', completedStepIds: ['exam-step'] }
  }, { node: minimumNode, records: { [examMaterialId]: { status: 'completed', details: { scorePercent: 79, passed: true } } } });
  assert.equal(belowMinimum.code, 'STEP_NOT_UNLOCKED');
  const atMinimum = merge(null, {
    materialId: 'lesson-exam', action: 'lesson_step', details: { currentStepId: 'summary', completedStepIds: ['exam-step'] }
  }, { node: minimumNode, records: { [examMaterialId]: { status: 'completed', details: { scorePercent: 80, passed: true } } } });
  assert.equal(atMinimum.ok, true);
  const pendingWithoutScore = merge(null, {
    materialId: 'lesson-exam', action: 'lesson_step', details: { currentStepId: 'summary', completedStepIds: ['exam-step'] }
  }, { node: minimumNode, records: { [examMaterialId]: { status: 'completed', details: { scorePercent: null, passed: null } } } });
  assert.equal(pendingWithoutScore.code, 'STEP_NOT_UNLOCKED');
});

test('lesson completion requirements are independent from percentage inclusion', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'lesson-separate', type: 'lesson', progress: progress({ tracking: 'ON' }),
    settings: { navigation: 'sequential', steps: [
      { id: 'tracked-optional', includeInLesson: true, requiredToAdvance: false },
      { id: 'untracked-required', includeInLesson: false, requiredToAdvance: true }
    ] }
  }] }).nodes[0];
  const incomplete = merge(null, {
    materialId: 'lesson-separate', action: 'complete', details: { currentStepId: 'tracked-optional', completedStepIds: ['tracked-optional'] }
  }, { node });
  assert.equal(incomplete.code, 'LESSON_INCOMPLETE');
  const completed = merge(null, {
    materialId: 'lesson-separate', action: 'complete', details: { currentStepId: 'untracked-required', completedStepIds: ['untracked-required'] }
  }, { node });
  assert.equal(completed.record.status, 'completed');
});

test('presentation supports visited slides and preserves resumable position', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'deck', type: 'presentation', progress: progress({ tracking: 'ON' }),
    settings: { presentationMode: 'visited' }
  }] }).nodes[0];
  const result = merge(null, {
    materialId: 'deck', materialType: 'presentation', action: 'presentation',
    details: { lastSlideId: 's17', lastSlideIndex: 16, highestReachedSlide: 17, visitedSlides: ['s1', 's17'], totalSlides: 25 }
  }, { node });
  assert.equal(result.record.progressPercent, 8);
  assert.deepEqual(result.record.lastPosition, { slideId: 's17', slideIndex: 16 });
  assert.equal(result.record.details.highestReachedSlide, 17);
});

test('video counts watched ranges instead of seek position and applies completion threshold', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'movie', type: 'video', progress: progress({ tracking: 'ON' }),
    settings: { videoCompletionThreshold: 80 }
  }] }).nodes[0];
  const first = merge(null, {
    materialId: 'movie', materialType: 'video', action: 'video',
    details: { playbackStarted: true, duration: 100, lastPlaybackPosition: 99, watchedRanges: [[0, 40]] }
  }, { node });
  assert.equal(first.record.progressPercent, 40);
  const second = merge(first.record, {
    materialId: 'movie', materialType: 'video', action: 'video',
    details: { duration: 100, lastPlaybackPosition: 80, watchedRanges: [[40, 80]] }
  }, { node });
  assert.equal(second.record.progressPercent, 100);
  assert.equal(second.record.status, 'completed');
  assert.deepEqual(second.record.details.watchedRanges, [[0, 80]]);
});

test('PDF progress is explicitly navigational and quiz progress differs from score', () => {
  const pdf = merge(null, {
    materialId: 'document', materialType: 'pdf', action: 'pdf',
    details: { lastPage: 3, highestVisitedPage: 4, totalPages: 10 }
  });
  assert.equal(pdf.record.progressPercent, 40);
  assert.equal(pdf.record.details.navigationOnly, true);
  assert.deepEqual(pdf.record.lastPosition, { page: 3, totalPages: 10 });

  const quiz = merge(null, {
    materialId: 'quiz-one', materialType: 'quiz', action: 'quiz', progressPercent: 60,
    details: { started: true, completed: false, scorePercent: 25, attempts: 2, passed: false }
  });
  assert.equal(quiz.record.progressPercent, 60);
  assert.equal(quiz.record.details.scorePercent, 25);
  assert.equal(quiz.record.details.attempts, 2);
  assert.equal(quiz.record.details.passed, false);
});

test('quiz progress clears a previous score for a newer pending attempt and ignores late grading of an older attempt', () => {
  const first = merge(null, {
    materialId: 'quiz-latest', materialType: 'quiz', action: 'quiz',
    details: { started: true, completed: true, attempts: 1, attemptId: 'attempt-one', scorePercent: 90, passed: true, gradingStatus: 'graded' }
  });
  const pending = merge(first.record, {
    materialId: 'quiz-latest', materialType: 'quiz', action: 'quiz',
    details: { started: true, completed: true, attempts: 2, attemptId: 'attempt-two', scorePercent: null, passed: null, gradingStatus: 'pending_review' }
  });
  assert.equal(pending.record.details.scorePercent, null);
  assert.equal(pending.record.details.passed, null);
  assert.equal(pending.record.details.attemptId, 'attempt-two');
  const staleGrade = merge(pending.record, {
    materialId: 'quiz-latest', materialType: 'quiz', action: 'quiz',
    details: { started: true, completed: true, attempts: 1, attemptId: 'attempt-one', scorePercent: 100, passed: true, gradingStatus: 'graded' }
  });
  assert.equal(staleGrade.record.details.scorePercent, null);
  assert.equal(staleGrade.record.details.passed, null);
  assert.equal(staleGrade.record.details.attemptId, 'attempt-two');
  assert.equal(staleGrade.record.details.gradingStatus, 'pending_review');
});

test('a native dashboard quiz stays incomplete on open and completes after answers are submitted', () => {
  const node = progressCommon.normalizeCatalog({ nodes: [{
    id: 'native-quiz', type: 'quiz', progress: progress({ tracking: 'ON' }),
    settings: { manualCompletion: true }
  }] }).nodes[0];
  const opened = merge(null, {
    materialId: 'native-quiz', materialType: 'quiz', action: 'open', opened: true
  }, { node });
  assert.equal(opened.record.status, 'opened');
  assert.equal(opened.record.progressPercent, 0);

  const submitted = merge(opened.record, {
    materialId: 'native-quiz', materialType: 'quiz', action: 'quiz',
    details: { started: true, completed: true, scorePercent: 80, passed: true, attempts: 1 }
  }, { node });
  assert.equal(submitted.record.status, 'completed');
  assert.equal(submitted.record.progressPercent, 100);
  assert.equal(submitted.record.details.passed, true);
});

class MemoryStore {
  constructor() {
    this.entries = new Map();
    this.revision = 0;
  }

  async getWithMetadata(key) {
    const entry = this.entries.get(key);
    return entry ? { data: entry.data, etag: entry.etag, metadata: entry.metadata } : null;
  }

  async set(key, data, options = {}) {
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    this.revision += 1;
    this.entries.set(key, { data, etag: `etag-${this.revision}`, metadata: options.metadata || {} });
    return { modified: true };
  }

  async list(options = {}) {
    const prefix = options.prefix || '';
    return {
      blobs: [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })),
      cursor: null
    };
  }
}

test('Blob listing is bounded and exposes a resumable cursor', async () => {
  const store = new MemoryStore();
  await store.set('users/a.json', JSON.stringify({ userId: 'a' }));
  await store.set('users/b.json', JSON.stringify({ userId: 'b' }));
  await store.set('users/c.json', JSON.stringify({ userId: 'c' }));
  const first = await listEntries(store, { prefix: 'users/', limit: 2 });
  assert.deepEqual(first.entries.map((entry) => entry.value.userId), ['a', 'b']);
  assert.equal(first.cursor, 'offset:2');
  const second = await listEntries(store, { prefix: 'users/', limit: 2, cursor: first.cursor });
  assert.deepEqual(second.entries.map((entry) => entry.value.userId), ['c']);
  assert.equal(second.cursor, null);
});

function contextFor(user) {
  return { clientContext: { user, identity: { url: IDENTITY_URL } } };
}

function eventFor(method, body, query = {}) {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer signed-client-token',
      accept: 'application/json',
      'content-type': 'application/json',
      origin: 'https://course.example',
      host: 'course.example',
      'x-forwarded-proto': 'https'
    },
    queryStringParameters: query,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('lesson manifests survive Dashboard publication and protect lessons opened directly', async (t) => {
  const navigation = require('../public/assets/js/lesson-navigation.js');
  const store = new MemoryStore();
  progressFunction._test.setStoreFactory(() => store);
  adminProgressFunction._test.setStoreFactory(() => store);
  const originalFetch = global.fetch;
  let canonical = { id: ADMIN, email: 'admin@example.com', app_metadata: { roles: ['admin'] } };
  global.fetch = async () => responseJson(canonical);
  t.after(() => {
    global.fetch = originalFetch;
    progressFunction._test.setStoreFactory(null);
    adminProgressFunction._test.setStoreFactory(null);
  });
  const manifest = { navigation: 'sequential', steps: [{ id: 'start' }, { id: 'task' }, { id: 'end' }] };
  const saved = await adminProgressFunction.handler(eventFor('PUT', {
    action: 'lesson_manifest', filename: 'test.md', repositoryId: 'biology', manifest
  }), contextFor(canonical));
  assert.equal(saved.statusCode, 200);
  const id = navigation.materialId('biology', 'test.md');
  let stored = JSON.parse(store.entries.get(CATALOG_KEY).data);
  assert.equal(stored.lessonManifests[id].settings.navigation, 'sequential');
  const published = await adminProgressFunction.handler(eventFor('PUT', {
    action: 'catalog', catalog: { nodes: [{
      id: 'dashboard-lesson', type: 'lesson', settings: { contentFile: 'test.md', repositoryId: 'biology', navigation: 'free' }
    }] }
  }), contextFor(canonical));
  assert.equal(published.statusCode, 200);
  stored = JSON.parse(store.entries.get(CATALOG_KEY).data);
  assert.equal(stored.nodes[0].settings.navigation, 'sequential');
  assert.equal(stored.nodes[0].settings.steps.length, 3);
  assert.ok(stored.lessonManifests[id]);

  const jump = { materialId: id, materialType: 'lesson', action: 'lesson_step', details: { currentStepId: 'end' } };
  const admin = await progressFunction.handler(eventFor('POST', jump), contextFor(canonical));
  assert.equal(admin.statusCode, 200);
  canonical = { id: USER_ONE, email: 'student@example.com', app_metadata: { roles: ['active'] } };
  const student = await progressFunction.handler(eventFor('POST', jump), contextFor(canonical));
  assert.equal(student.statusCode, 409);
  assert.equal(JSON.parse(student.body).error, 'STEP_NOT_UNLOCKED');
  const spoof = await progressFunction.handler(eventFor('POST', { ...jump, isAdmin: true }), contextFor(canonical));
  assert.equal(spoof.statusCode, 400);
});

test('shared player/server policy gives individual preferences priority and never restricts admins', () => {
  const navigation = require('../public/assets/js/lesson-navigation.js');
  for (const mode of ['free', 'sequential']) {
    assert.equal(navigation.policy(mode, { skipMode: 'ALLOW' }).sequential, false);
    assert.equal(navigation.policy(mode, { skipMode: 'DENY' }).sequential, true);
    assert.equal(navigation.policy(mode, { skipMode: 'DENY' }, true).sequential, false);
  }
  assert.equal(navigation.policy('free', { skipMode: 'DEFAULT' }).sequential, false);
  assert.equal(navigation.policy('sequential', { skipMode: 'DEFAULT' }).sequential, true);
  assert.equal(navigation.stepOverride('step', { skipMode: 'ALLOW', lockedStepIds: ['step'] }), 'deny');
  assert.equal(navigation.stepOverride('step', { lockedStepIds: ['step'] }, true), 'allow');
});

test('progress endpoints derive the learner from Identity, deny privilege escalation, reset and audit admin changes', async (t) => {
  const store = new MemoryStore();
  await store.set(CATALOG_KEY, JSON.stringify(catalog()), { onlyIfNew: true });
  progressFunction._test.setStoreFactory(() => store);
  adminProgressFunction._test.setStoreFactory(() => store);
  t.after(() => {
    progressFunction._test.setStoreFactory(null);
    adminProgressFunction._test.setStoreFactory(null);
  });

  const originalFetch = global.fetch;
  let canonical = { id: USER_ONE, email: 'jan@example.com', app_metadata: { roles: ['active'] } };
  global.fetch = async () => responseJson(canonical);
  t.after(() => { global.fetch = originalFetch; });

  const userOneContext = contextFor(canonical);
  const opened = await progressFunction.handler(eventFor('POST', {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }), userOneContext);
  assert.equal(opened.statusCode, 200);
  assert.equal(JSON.parse(opened.body).record.userId, USER_ONE);

  const forged = await progressFunction.handler(eventFor('POST', {
    userId: USER_TWO, materialId: 'slides', materialType: 'presentation', action: 'complete'
  }), userOneContext);
  assert.equal(forged.statusCode, 400);
  assert.equal(JSON.parse(forged.body).error, 'UNEXPECTED_FIELDS');

  const refusedForeignQuery = await progressFunction.handler(eventFor('GET', undefined, { userId: USER_TWO }), userOneContext);
  assert.equal(refusedForeignQuery.statusCode, 400);
  assert.equal(JSON.parse(refusedForeignQuery.body).error, 'UNEXPECTED_QUERY');
  const ownRead = await progressFunction.handler(eventFor('GET'), userOneContext);
  assert.equal(JSON.parse(ownRead.body).userId, USER_ONE);
  assert.equal(JSON.parse(ownRead.body).records.slides.openCount, 1);
  assert.equal(JSON.parse(ownRead.body).records.slides.progressPercent, 100);

  const ownMaterialReset = await progressFunction.handler(eventFor('DELETE', {
    materialId: 'slides'
  }), userOneContext);
  assert.equal(ownMaterialReset.statusCode, 200);
  assert.equal(JSON.parse(ownMaterialReset.body).existed, true);
  await progressFunction.handler(eventFor('POST', {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }), userOneContext);
  const ownCourseReset = await progressFunction.handler(eventFor('DELETE', {
    scope: 'course'
  }), userOneContext);
  assert.equal(ownCourseReset.statusCode, 200);
  assert.equal(JSON.parse(ownCourseReset.body).removed, 1);
  const afterOwnCourseReset = await progressFunction.handler(eventFor('GET'), userOneContext);
  assert.deepEqual(JSON.parse(afterOwnCourseReset.body).records, {});
  const forgedOwnReset = await progressFunction.handler(eventFor('DELETE', {
    scope: 'course', targetUserId: USER_TWO
  }), userOneContext);
  assert.equal(forgedOwnReset.statusCode, 400);
  await progressFunction.handler(eventFor('POST', {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }), userOneContext);

  canonical = { id: USER_TWO, email: 'anna@example.com', app_metadata: { roles: ['active'] } };
  const foreignRead = await progressFunction.handler(eventFor('GET', undefined, { userId: USER_ONE }), contextFor(canonical));
  assert.equal(foreignRead.statusCode, 400);
  const userTwoOwnRead = await progressFunction.handler(eventFor('GET'), contextFor(canonical));
  assert.equal(JSON.parse(userTwoOwnRead.body).userId, USER_TWO);
  assert.deepEqual(JSON.parse(userTwoOwnRead.body).records, {});

  const notAdmin = await adminProgressFunction.handler(eventFor('GET', undefined, { view: 'user', userId: USER_ONE }), contextFor(canonical));
  assert.equal(notAdmin.statusCode, 403);
  assert.equal(JSON.parse(notAdmin.body).error, 'ADMIN_REQUIRED');

  canonical = { id: ADMIN, email: 'admin@example.com', app_metadata: { roles: ['admin'] } };
  const adminContext = contextFor(canonical);
  const completed = await adminProgressFunction.handler(eventFor('PUT', {
    action: 'mark_completed', targetUserId: USER_ONE, materialId: 'slides'
  }), adminContext);
  assert.equal(completed.statusCode, 200);
  assert.equal(JSON.parse(completed.body).record.status, 'completed');

  const reset = await adminProgressFunction.handler(eventFor('DELETE', {
    targetUserId: USER_ONE, scope: 'material', materialId: 'slides'
  }), adminContext);
  assert.equal(reset.statusCode, 200);
  assert.equal(JSON.parse(reset.body).removed, 1);

  const report = await adminProgressFunction.handler(eventFor('GET', undefined, { view: 'user', userId: USER_ONE }), adminContext);
  assert.equal(JSON.parse(report.body).user.records.slides, undefined);
  const audit = await adminProgressFunction.handler(eventFor('GET', undefined, { view: 'audit' }), adminContext);
  const actions = JSON.parse(audit.body).audit.map((entry) => entry.action);
  assert.ok(actions.includes('progress.mark_completed'));
  assert.ok(actions.includes('progress.reset.material'));
});

test('removing a dashboard node invalidates learner records without scanning every user Blob', async (t) => {
  const store = new MemoryStore();
  await store.set(CATALOG_KEY, JSON.stringify(catalog()), { onlyIfNew: true });
  progressFunction._test.setStoreFactory(() => store);
  adminProgressFunction._test.setStoreFactory(() => store);
  t.after(() => {
    progressFunction._test.setStoreFactory(null);
    adminProgressFunction._test.setStoreFactory(null);
  });

  const originalFetch = global.fetch;
  let canonical = { id: USER_ONE, email: 'jan@example.com', app_metadata: { roles: ['active'] } };
  global.fetch = async () => responseJson(canonical);
  t.after(() => { global.fetch = originalFetch; });

  const userContext = contextFor(canonical);
  await progressFunction.handler(eventFor('POST', {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }), userContext);

  canonical = { id: ADMIN, email: 'admin@example.com', app_metadata: { roles: ['admin'] } };
  const adminContext = contextFor(canonical);
  const withoutSlides = catalog({
    nodes: catalog().nodes.filter((node) => node.id !== 'slides')
  });
  const removed = await adminProgressFunction.handler(eventFor('PUT', {
    action: 'catalog', catalog: withoutSlides
  }), adminContext);
  assert.equal(removed.statusCode, 200);
  assert.equal(JSON.parse(removed.body).removedCount, 1);
  assert.ok(JSON.parse(removed.body).catalog.invalidatedAt.slides);

  canonical = { id: USER_ONE, email: 'jan@example.com', app_metadata: { roles: ['active'] } };
  const afterRemoval = await progressFunction.handler(eventFor('GET'), contextFor(canonical));
  assert.equal(JSON.parse(afterRemoval.body).records.slides, undefined);
  const retiredWrite = await progressFunction.handler(eventFor('POST', {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }), contextFor(canonical));
  assert.equal(JSON.parse(retiredWrite.body).saved, false);
  assert.equal(JSON.parse(retiredWrite.body).record, null);

  canonical = { id: ADMIN, email: 'admin@example.com', app_metadata: { roles: ['admin'] } };
  await adminProgressFunction.handler(eventFor('PUT', {
    action: 'catalog', catalog: catalog()
  }), contextFor(canonical));

  canonical = { id: USER_ONE, email: 'jan@example.com', app_metadata: { roles: ['active'] } };
  const afterReadding = await progressFunction.handler(eventFor('GET'), contextFor(canonical));
  assert.equal(JSON.parse(afterReadding.body).records.slides, undefined);
  await progressFunction.handler(eventFor('POST', {
    materialId: 'slides', materialType: 'presentation', action: 'open', opened: true
  }), contextFor(canonical));
  const freshProgress = await progressFunction.handler(eventFor('GET'), contextFor(canonical));
  assert.equal(JSON.parse(freshProgress.body).records.slides.progressPercent, 100);
});

test('a racing write cannot resurrect a retired dashboard node, while a fresh re-added node can progress', () => {
  const invalidatedAt = '2026-08-15T10:00:00.000Z';
  const completedAfterRemoval = progressCommon.normalizeUserDocument({
    records: {
      slides: {
        materialType: 'presentation',
        status: 'completed',
        progressPercent: 100,
        completedAt: '2026-08-15T10:00:01.000Z',
        lastActivityAt: '2026-08-15T10:00:01.000Z'
      }
    }
  }, USER_ONE);
  const withoutSlides = catalog({
    nodes: catalog().nodes.filter((node) => node.id !== 'slides'),
    invalidatedAt: { slides: invalidatedAt }
  });

  assert.equal(
    progressCommon.activeUserDocument(completedAfterRemoval, withoutSlides).records.slides,
    undefined,
    'a node absent from the active dashboard must stay retired even if its racing write is newer'
  );

  const readded = catalog({ invalidatedAt: { slides: invalidatedAt } });
  assert.equal(
    progressCommon.activeUserDocument(completedAfterRemoval, readded).records.slides?.status,
    'completed',
    'after deliberately re-adding the same ID, genuinely newer progress remains valid'
  );
});

test('progress endpoint rejects opening a locked organizer step and unlocks it after completion', async (t) => {
  const store = new MemoryStore();
  const sequentialCatalog = progressCommon.normalizeCatalog({
    global: { tracking: 'ON', showProgress: 'ON', recordOpens: true },
    nodes: [
      { id: 'course', type: 'course', progress: progress({ tracking: 'ON' }) },
      { id: 'path', parentId: 'course', type: 'section', title: 'Organizer', progress: progress(), settings: { navigation: 'sequential' } },
      { id: 'slides-step', parentId: 'path', type: 'presentation', title: 'Slajdy', order: 1, progress: progress(), settings: { manualCompletion: true } },
      { id: 'pdf-step', parentId: 'path', type: 'pdf', title: 'PDF', order: 2, progress: progress() },
      { id: 'lesson-step', parentId: 'path', type: 'lesson', title: 'Lekcja', order: 3, progress: progress() },
      {
        id: 'exam-step', parentId: 'path', type: 'exam', title: 'Egzamin', order: 4, progress: progress(),
        settings: { repositoryId: 'default', examId: 'exam-one' }
      }
    ]
  });
  await store.set(CATALOG_KEY, JSON.stringify(sequentialCatalog), { onlyIfNew: true });
  progressFunction._test.setStoreFactory(() => store);
  t.after(() => progressFunction._test.setStoreFactory(null));

  const originalFetch = global.fetch;
  const canonical = { id: USER_ONE, email: 'jan@example.com', app_metadata: { roles: ['active'] } };
  global.fetch = async () => responseJson(canonical);
  t.after(() => { global.fetch = originalFetch; });
  const userContext = contextFor(canonical);

  const locked = await progressFunction.handler(eventFor('POST', {
    materialId: 'lesson-step', materialType: 'lesson', action: 'open', opened: true
  }), userContext);
  assert.equal(locked.statusCode, 409);
  assert.equal(JSON.parse(locked.body).error, 'SEQUENCE_LOCKED');

  const completedFirst = await progressFunction.handler(eventFor('POST', {
    materialId: 'slides-step', materialType: 'presentation', action: 'open', opened: true
  }), userContext);
  assert.equal(completedFirst.statusCode, 200);
  assert.equal(JSON.parse(completedFirst.body).record.status, 'completed');
  assert.equal(JSON.parse(completedFirst.body).completion.manualRequired, false);

  const openedPdf = await progressFunction.handler(eventFor('POST', {
    materialId: 'pdf-step', materialType: 'pdf', action: 'open', opened: true
  }), userContext);
  assert.equal(openedPdf.statusCode, 200);
  assert.equal(JSON.parse(openedPdf.body).record.status, 'completed');

  const unlocked = await progressFunction.handler(eventFor('POST', {
    materialId: 'lesson-step', materialType: 'lesson', action: 'open', opened: true
  }), userContext);
  assert.equal(unlocked.statusCode, 200);
  assert.equal(JSON.parse(unlocked.body).record.status, 'opened');
  await assert.rejects(
    examProgress.assertExamSequenceAccess({
      store,
      userId: USER_ONE,
      user: canonical,
      repositoryId: 'default',
      examId: 'exam-one',
      materialId: 'exam-step'
    }),
    (error) => error.code === 'SEQUENCE_LOCKED'
  );

  const lessonCompleted = await progressFunction.handler(eventFor('POST', {
    materialId: 'lesson-step', materialType: 'lesson', action: 'complete'
  }), userContext);
  assert.equal(lessonCompleted.statusCode, 200);
  await assert.doesNotReject(examProgress.assertExamSequenceAccess({
    store,
    userId: USER_ONE,
    user: canonical,
    repositoryId: 'default',
    examId: 'exam-one',
    materialId: 'exam-step'
  }));
  const state = JSON.parse((await progressFunction.handler(eventFor('GET'), userContext)).body);
  assert.equal(state.access['lesson-step'].allowed, true);
  assert.equal(state.access['exam-step'].allowed, true);
});
