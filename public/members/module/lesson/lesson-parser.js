(function (root) {
  'use strict';

  const googleMedia = typeof module === 'object' && module.exports ? require('../../../assets/js/google-media.js') : root.NextMedGoogleMedia;

  const MAX_SOURCE_CHARS = 512 * 1024;
  const MAX_SLIDES = 100;
  const SAFE_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.md$/i;
  const SAFE_PROMPT_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(?:json|txt)$/i;
  const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const SAFE_BOARD_PATH = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.json$/i;
  const SAFE_MEDIA_REF = /^(?:photos\/|assets\/shared\/)(?!.*\.\.)[a-z0-9][a-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/i;
  const SAFE_QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
  const MAX_AI_AUTHOR_CONTEXT_CHARS = 6000;
  const MAX_AI_CONTEXT_CHARS = 12000;
  const MAX_OPEN_QUESTION_CHARS = 8000;
  const MAX_STUDENT_ANSWER_CHARS = 6000;
  const MAX_ANSWER_KEY_CHARS = 10000;
  const MAX_AI_REVIEW_INSTRUCTION_CHARS = 2000;
  const TASK_START = /^\s*:::(?:task|zadanie)\s*$/i;
  const TASK_END = /^\s*:::\s*$/;
  const QUESTION_START = /^\s*:::question\s*$/i;
  const SLIDE_SETTINGS_START = /^\s*:::slide\s*$/i;
  const STYLE_START = /^\s*:::style(?:\s+(.+?))?\s*$/i;
  const ACCORDION_START = /^\s*:::accordion(?:\s+(.+?))?\s*$/i;
  const LAYOUT_START = /^\s*:::layout(?:\s+(.+?))?\s*$/i;
  const STRUCTURAL_CONTAINER_START = /^\s*:::(?:task|zadanie|question|slide|style|accordion|layout|youtube|googleslides|googlemedia|presentation|quiz|pdf|atonom|formula|linkcard|aihelp|board|contactform|flashcards|table|exam|image|studentanswer|answerreview)(?:\s+.*?)?\s*$/i;
  const RICH_CONTAINER_END = /^\s*:::\s*$/;
  const SAFE_STYLE_COLOR = /^#[0-9a-f]{6}$/i;
  const LINK_ICONS = new Set(['link', 'book', 'video', 'chemistry', 'math', 'file', 'external']);
  const SLIDE_TRANSITIONS = new Set(['none', 'fade', 'rise', 'slide', 'zoom']);
  const SLIDE_BACKGROUNDS = new Set([
    'default', 'paper', 'grid', 'dots', 'mint', 'sky', 'lavender', 'sand', 'gradient', 'night', 'custom'
  ]);
  const SLIDE_DECORATIONS = new Set(['none', 'molecules', 'bubbles', 'glow']);
  const SLIDE_TEXT_TONES = new Set(['auto', 'dark', 'light']);
  const STYLE_FONTS = new Set([
    'sans',
    'arial',
    'verdana',
    'serif',
    'georgia',
    'times',
    'rounded',
    'mono',
    'courier'
  ]);
  const STYLE_SIZES = new Set(['small', 'normal', 'large', 'xlarge']);
  const STYLE_ALIGNS = new Set(['left', 'center', 'right']);
  const FORMULA_ARROWS = new Set(['', '->', '<-', '<->', '<=>', '<=>>', '<<=>']);
  const SAFE_MATH_COMMANDS = new Set([
    'alpha', 'beta', 'gamma', 'delta', 'Delta', 'theta', 'lambda', 'mu', 'pi', 'rho', 'sigma',
    'omega', 'Omega', 'cdot', 'times', 'div', 'pm', 'mp', 'approx', 'neq', 'le', 'leq', 'ge',
    'geq', 'infty', 'frac', 'sqrt', 'sum', 'prod', 'int', 'oint', 'lim', 'min', 'max',
    'sin', 'cos', 'tan', 'log', 'ln', 'partial', 'nabla', 'rightarrow', 'leftarrow',
    'leftrightarrow', 'text', 'mathrm', 'mathbf', 'overline', 'vec', 'left', 'right'
  ]);
  const INTERACTIVE_START = /^\s*:::(youtube|googleslides|googlemedia|presentation|quiz|pdf|atonom|formula|linkcard|aihelp|board|contactform|flashcards|table|exam|image|studentanswer|answerreview)\s*$/i;

  class LessonFormatError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'LessonFormatError';
      this.code = code;
    }
  }

  function validateFilename(value) {
    const filename = typeof value === 'string' ? value.trim() : '';
    return SAFE_FILENAME.test(filename) ? filename : '';
  }

  function normalizeKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  function normalizeAnswer(value, type, caseSensitive) {
    let normalized = String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ');
    if (type === 'number') {
      const numeric = Number(normalized.replace(',', '.'));
      return Number.isFinite(numeric) ? numeric : Number.NaN;
    }
    if (!caseSensitive) normalized = normalized.toLocaleLowerCase('pl');
    return normalized;
  }

  function checkGapAnswer(task, value, index) {
    if (
      !task
      || !Array.isArray(task.answers)
      || !Number.isSafeInteger(index)
      || index < 0
      || index >= task.answers.length
    ) return false;
    return normalizeAnswer(value, 'text', task.caseSensitive)
      === normalizeAnswer(task.answers[index], 'text', task.caseSensitive);
  }

  function checkAnswer(task, value) {
    if (!task || !Array.isArray(task.answers)) return false;
    if (task.type === 'gaps' || task.type === 'gaps-text') {
      if (!Array.isArray(value) || value.length !== task.answers.length) return false;
      return task.answers.every((_, index) => checkGapAnswer(task, value[index], index));
    }
    const matchesExpected = (answerValue) => {
      const candidate = normalizeAnswer(answerValue, task.type, task.caseSensitive);
      if (task.type === 'number' && Number.isNaN(candidate)) return false;
      return task.answers.some((answer) => {
        const expected = normalizeAnswer(answer, task.type, task.caseSensitive);
        return task.type === 'number'
          ? !Number.isNaN(expected) && candidate === expected
          : candidate === expected;
      });
    };
    if (matchesExpected(value)) return true;

    if (task.choiceStyle === 'abcd' && Array.isArray(task.options)) {
      const letter = String(value || '').trim().toUpperCase();
      const optionIndex = /^[A-D]$/.test(letter) ? letter.charCodeAt(0) - 65 : -1;
      if (optionIndex >= 0 && optionIndex < task.options.length) {
        return matchesExpected(task.options[optionIndex]);
      }
    }
    return false;
  }

  function cleanAiContextText(value, maxChars = MAX_AI_CONTEXT_CHARS, preserveLines = true) {
    const normalized = String(value ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\0/g, '');
    const text = preserveLines
      ? normalized
        .split('\n')
        .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      : normalized.replace(/\s+/g, ' ').trim();
    return text.slice(0, Math.max(0, Number(maxChars) || 0));
  }

  function taskAiContext(task, currentResponse) {
    if (!task || typeof task !== 'object') return '';
    const type = task.type === 'abcd' || task.choiceStyle === 'abcd'
      ? 'wybór ABCD'
      : {
          choice: 'wybór odpowiedzi',
          gaps: 'luki z listy',
          'gaps-text': 'luki wpisywane ręcznie',
          number: 'odpowiedź liczbowa',
          text: 'odpowiedź tekstowa'
        }[task.type] || 'zadanie';
    const parts = [`Zadanie (${type})`];
    const question = cleanAiContextText(task.question || task.label, 1000, false);
    if (question) parts.push(`Polecenie: ${question}`);
    if (task.text) {
      let gapIndex = 0;
      const text = cleanAiContextText(task.text, 3000, true).replace(/\{\{([^{}]*)\}\}/g, (_, label) => {
        gapIndex += 1;
        return `[luka ${gapIndex}${String(label || '').trim() ? `: ${String(label).trim()}` : ''}]`;
      });
      if (text && text !== question) parts.push(`Treść:\n${text}`);
    }
    const options = (Array.isArray(task.options) ? task.options : [])
      .map((option) => cleanAiContextText(option, 500, false))
      .filter(Boolean);
    if (options.length) {
      parts.push(`Możliwe odpowiedzi:\n${options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n')}`);
    }
    const responses = Array.isArray(currentResponse) ? currentResponse : [currentResponse];
    const current = responses
      .map((response, index) => {
        const value = cleanAiContextText(response, 500, false);
        return value ? `${responses.length > 1 ? `Luka ${index + 1}: ` : ''}${value}` : '';
      })
      .filter(Boolean);
    if (current.length) parts.push(`Aktualna odpowiedź ucznia: ${current.join('; ')}`);
    return cleanAiContextText(parts.join('\n'), 5000, true);
  }

  function lessonMediaAiContext(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return '';
    const rows = [];
    const seen = new Set();
    const add = (label, value) => {
      const text = cleanAiContextText(value, 1600, false);
      if (!text) return;
      const key = `${label}:${text}`.toLocaleLowerCase('pl');
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(`${label}: ${text}`);
    };

    root.querySelectorAll('[data-lesson-media-alt]').forEach((figure) => {
      add('Ilustracja', figure.dataset?.lessonMediaAlt || figure.getAttribute?.('data-lesson-media-alt'));
    });
    root.querySelectorAll('img[alt]').forEach((image) => add('Ilustracja', image.getAttribute('alt')));
    root.querySelectorAll('.lesson-google-slides').forEach((figure) => {
      add(
        'Osadzona prezentacja Google Slides (tytuł, nie treść iframe)',
        figure.querySelector('figcaption')?.textContent || figure.querySelector('iframe')?.getAttribute('title')
      );
    });
    root.querySelectorAll('.lesson-youtube iframe[title]').forEach((frame) => {
      add('Osadzony film (tytuł)', frame.getAttribute('title'));
    });
    root.querySelectorAll('.lesson-atonom').forEach((figure) => {
      add('Interaktywny model', figure.dataset?.atonomFormula || figure.querySelector('figcaption')?.textContent);
    });
    root.querySelectorAll('[data-lesson-ai-formula]').forEach((figure) => {
      add('Wzór lub równanie', figure.dataset?.lessonAiFormula || figure.getAttribute?.('data-lesson-ai-formula'));
    });
    root.querySelectorAll('.lesson-flashcard').forEach((card, index) => {
      const front = card.querySelector('.flashcard-front strong')?.textContent;
      const back = card.querySelector('.flashcard-back strong')?.textContent;
      if (front || back) add(`Fiszka ${index + 1}`, `${front || ''}${back ? ` → ${back}` : ''}`);
    });
    return cleanAiContextText(rows.join('\n'), 5000, true);
  }

  function visibleLessonAiContext(root) {
    if (!root || typeof root.cloneNode !== 'function') return '';
    const clone = root.cloneNode(true);
    if (typeof clone.querySelectorAll === 'function') {
      clone.querySelectorAll([
        '.lesson-ai-help',
        '.lesson-preview-meta',
        '.lesson-managed-image-placeholder',
        '.lesson-flashcards',
        '.lesson-google-slides',
        '.lesson-youtube',
        '.lesson-atonom',
        '.lesson-formula',
        '.preview-task',
        '.task-card',
        'button',
        'input',
        'select',
        'textarea',
        'iframe',
        'script',
        'style',
        '[aria-hidden="true"]'
      ].join(', ')).forEach((node) => node.remove());
    }
    return cleanAiContextText(clone.textContent || '', 9000, true);
  }

  function buildLessonAiContext(options = {}) {
    const includeSlide = options.includeSlide !== false;
    const includeTask = options.includeTask !== false;
    const parts = [];
    const authorContext = cleanAiContextText(
      options.authorContext,
      MAX_AI_AUTHOR_CONTEXT_CHARS,
      true
    );
    if (authorContext) parts.push(`Dodatkowy kontekst autora:\n${authorContext}`);
    if (includeTask) {
      const task = taskAiContext(options.task, options.currentResponse);
      if (task) parts.push(task);
    }
    if (includeSlide) {
      const media = lessonMediaAiContext(options.root);
      if (media) parts.push(`Media i elementy interaktywne:\n${media}`);
      const visible = visibleLessonAiContext(options.root);
      if (visible) parts.push(`Widoczna treść slajdu:\n${visible}`);
    }
    return cleanAiContextText(parts.join('\n\n'), options.maxChars || MAX_AI_CONTEXT_CHARS, true);
  }

  function parseTask(lines, slideNumber) {
    const aliases = {
      options_json: 'optionsJson', answer_json: 'answerJson', label_json: 'labelJson', hint_json: 'hintJson', success_json: 'successJson',
      answer: 'answer',
      answers: 'answer',
      odpowiedz: 'answer',
      odpowiedzi: 'answer',
      type: 'type',
      typ: 'type',
      label: 'label',
      etykieta: 'label',
      placeholder: 'placeholder',
      przyklad: 'placeholder',
      hint: 'hint',
      podpowiedz: 'hint',
      success: 'success',
      sukces: 'success',
      options: 'options',
      opcje: 'options',
      text: 'text',
      tekst: 'text',
      text_json: 'textJson',
      check_mode: 'checkMode',
      tryb_sprawdzania: 'checkMode',
      case_sensitive: 'caseSensitive',
      wielkosc_liter: 'caseSensitive'
    };
    const values = {};

    for (const rawLine of lines) {
      if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
      const match = /^\s*([^:]+):\s*(.*)\s*$/.exec(rawLine);
      if (!match) {
        throw new LessonFormatError(
          'INVALID_TASK_FIELD',
          `Slajd ${slideNumber}: każdy wiersz zadania musi mieć postać „pole: wartość”.`
        );
      }
      const rawKey = normalizeKey(match[1]);
      const key = aliases[rawKey];
      if (!key) {
        throw new LessonFormatError(
          'UNKNOWN_TASK_FIELD',
          `Slajd ${slideNumber}: nieznane pole zadania „${match[1].trim()}”.`
        );
      }
      values[key] = match[2].trim();
    }
    for (const [field, list] of [['options', true], ['answer', true], ['label', false], ['hint', false], ['success', false]]) {
      if (values[`${field}Json`] === undefined) continue;
      let decoded;
      try { decoded = JSON.parse(values[`${field}Json`]); } catch (_) { /* validation below */ }
      if (list ? !Array.isArray(decoded) || decoded.some((value) => typeof value !== 'string') : typeof decoded !== 'string') {
        throw new LessonFormatError('INVALID_TASK_FIELD', `Slajd ${slideNumber}: niepoprawny zapis pola ${field}_json.`);
      }
      values[field] = decoded;
    }

    let taskText = values.text || '';
    if (values.textJson !== undefined) {
      try { taskText = JSON.parse(values.textJson); }
      catch (_) {
        throw new LessonFormatError('INVALID_TASK_TEXT', `Slajd ${slideNumber}: wielowierszowy tekst zadania jest uszkodzony.`);
      }
      if (typeof taskText !== 'string') {
        throw new LessonFormatError('INVALID_TASK_TEXT', `Slajd ${slideNumber}: wielowierszowy tekst zadania musi być tekstem.`);
      }
    }

    const typeAliases = {
      liczba: 'number',
      number: 'number',
      tekst: 'text',
      text: 'text',
      wybor: 'choice',
      choice: 'choice',
      abcd: 'abcd',
      gaps: 'gaps',
      luki: 'gaps',
      gaps_text: 'gaps-text',
      luki_tekstowe: 'gaps-text'
    };
    const requestedType = typeAliases[normalizeKey(values.type || 'text')];
    if (!requestedType) {
      throw new LessonFormatError(
        'INVALID_TASK_TYPE',
        `Slajd ${slideNumber}: typ zadania może mieć wartość text, number, choice, abcd, gaps albo gaps-text.`
      );
    }
    const type = requestedType === 'abcd' ? 'choice' : requestedType;
    const choiceStyle = requestedType === 'abcd' ? 'abcd' : 'default';

    const options = (Array.isArray(values.options) ? values.options : String(values.options || '').split('|'))
      .map((option) => option.trim())
      .filter(Boolean);
    if ((type === 'choice' || type === 'gaps') && options.length < 2) {
      throw new LessonFormatError(
        'MISSING_TASK_OPTIONS',
        `Slajd ${slideNumber}: zadanie wyboru wymaga co najmniej dwóch opcji.`
      );
    }
    if (choiceStyle === 'abcd' && options.length !== 4) {
      throw new LessonFormatError(
        'INVALID_ABCD_OPTIONS',
        `Slajd ${slideNumber}: quiz abcd wymaga dokładnie czterech opcji.`
      );
    }

    const answers = (Array.isArray(values.answer) ? values.answer : String(values.answer || '').split('|'))
      .map((answer) => answer.trim())
      .filter(Boolean)
      .map((answer) => {
        if (choiceStyle !== 'abcd') return answer;
        const letter = answer.toUpperCase();
        const optionIndex = /^[A-D]$/.test(letter) ? letter.charCodeAt(0) - 65 : -1;
        return optionIndex >= 0 && optionIndex < options.length ? options[optionIndex] : answer;
      });
    if (!answers.length) {
      throw new LessonFormatError(
        'MISSING_TASK_ANSWER',
        `Slajd ${slideNumber}: zadanie nie zawiera pola answer.`
      );
    }

    const caseSensitive = /^(?:1|true|tak|yes)$/i.test(values.caseSensitive || '');
    const task = {
      type,
      choiceStyle,
      answers,
      options,
      caseSensitive,
      checkMode: values.checkMode === 'each' ? 'each' : 'all',
      label: values.label || (
        type === 'choice' || type === 'gaps'
          ? 'Wybierz odpowiedź'
          : type === 'gaps-text' ? 'Wpisz odpowiedzi w luki' : 'Twoja odpowiedź'
      ),
      placeholder: values.placeholder || '',
      text: taskText.replace(/\r\n?/g, '\n'),
      hint: values.hint || '',
      success: values.success || 'Dobrze! Możesz przejść dalej.'
    };

    const allAnswersMatchOptions = answers.every((answer) => options.some((option) => (
      normalizeAnswer(answer, type, caseSensitive) === normalizeAnswer(option, type, caseSensitive)
    )));
    if ((type === 'choice' || type === 'gaps') && !allAnswersMatchOptions) {
      throw new LessonFormatError(
        'ANSWER_NOT_IN_OPTIONS',
        `Slajd ${slideNumber}: poprawna odpowiedź nie występuje na liście options.`
      );
    }
    if (type === 'gaps' || type === 'gaps-text') {
      const gapCount = (task.text.match(/\{\{[^{}]*\}\}/g) || []).length;
      if (!task.text || gapCount < 1 || gapCount !== answers.length) {
        throw new LessonFormatError(
          'INVALID_GAPS',
          `Slajd ${slideNumber}: liczba znaczników {{luka}} musi odpowiadać liczbie poprawnych odpowiedzi.`
        );
      }
    }
    return task;
  }

  function parseSlide(source, index) {
    const lines = source.split('\n');
    const content = [];
    let task = null;
    let taskLines = null;
    let slideSettingsLines = null;
    let slideSettingsSeen = false;
    let transition = 'fade';
    let layout = 'flow';
    let background = 'default';
    let backgroundColor = '#f8fafc';
    let decoration = 'none';
    let textTone = 'auto';
    let stepMetadata = null;

    for (const line of lines) {
      const metadataMatch = /^\s*<!--\s*chemdisk-step:(\{.*\})\s*-->\s*$/i.exec(line);
      if (metadataMatch) {
        if (stepMetadata) {
          throw new LessonFormatError('MULTIPLE_STEP_METADATA', `Slajd ${index + 1}: dozwolony jest jeden identyfikator kroku.`);
        }
        try { stepMetadata = JSON.parse(metadataMatch[1]); }
        catch (_) { throw new LessonFormatError('INVALID_STEP_METADATA', `Slajd ${index + 1}: ustawienia postępu są nieprawidłowe.`); }
        continue;
      }
      if (slideSettingsLines) {
        if (TASK_END.test(line)) {
          const values = directiveFields(slideSettingsLines.join('\n'));
          const requested = String(values.transition || '').trim().toLowerCase();
          transition = SLIDE_TRANSITIONS.has(requested) ? requested : 'fade';
          layout = String(values.layout || '').trim().toLowerCase() === 'canvas' ? 'canvas' : 'flow';
          const requestedBackground = String(values.background || '').trim().toLowerCase();
          const requestedDecoration = String(values.decoration || '').trim().toLowerCase();
          const requestedTextTone = String(values.text_tone || '').trim().toLowerCase();
          background = SLIDE_BACKGROUNDS.has(requestedBackground) ? requestedBackground : 'default';
          backgroundColor = SAFE_STYLE_COLOR.test(String(values.background_color || '').trim())
            ? String(values.background_color).trim().toLowerCase()
            : '#f8fafc';
          decoration = SLIDE_DECORATIONS.has(requestedDecoration) ? requestedDecoration : 'none';
          textTone = SLIDE_TEXT_TONES.has(requestedTextTone) ? requestedTextTone : 'auto';
          slideSettingsLines = null;
        } else {
          slideSettingsLines.push(line);
        }
        continue;
      }
      if (taskLines) {
        if (TASK_END.test(line)) {
          task = parseTask(taskLines, index + 1);
          taskLines = null;
        } else {
          taskLines.push(line);
        }
        continue;
      }
      if (TASK_START.test(line)) {
        if (task) {
          throw new LessonFormatError(
            'MULTIPLE_TASKS',
            `Slajd ${index + 1}: dozwolone jest tylko jedno zadanie.`
          );
        }
        taskLines = [];
        continue;
      }
      if (SLIDE_SETTINGS_START.test(line)) {
        if (slideSettingsSeen) {
          throw new LessonFormatError(
            'MULTIPLE_SLIDE_SETTINGS',
            `Slajd ${index + 1}: dozwolony jest tylko jeden blok ustawień przejścia.`
          );
        }
        slideSettingsSeen = true;
        slideSettingsLines = [];
        continue;
      }
      content.push(line);
    }

    if (taskLines) {
      throw new LessonFormatError(
        'UNCLOSED_TASK',
        `Slajd ${index + 1}: blok zadania nie został zamknięty linią :::.`
      );
    }
    if (slideSettingsLines) {
      throw new LessonFormatError(
        'UNCLOSED_SLIDE_SETTINGS',
        `Slajd ${index + 1}: blok ustawień slajdu nie został zamknięty linią :::.`
      );
    }

    const markdown = content.join('\n').trim();
    if (!markdown && !task) {
      throw new LessonFormatError('EMPTY_SLIDE', `Slajd ${index + 1} jest pusty.`);
    }
    const heading = markdown.match(/^\s*#{1,3}\s+(.+?)\s*$/m);
    const metadataId = typeof stepMetadata?.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(stepMetadata.id)
      ? stepMetadata.id : stableStepId(markdown);
    const include = ['ON', 'OFF', 'INHERIT'].includes(String(stepMetadata?.includeInLesson || '').toUpperCase())
      ? String(stepMetadata.includeInLesson).toUpperCase() : 'INHERIT';
    return {
      id: metadataId,
      markdown,
      html: renderMarkdown(markdown),
      title: heading ? stripMarkdown(heading[1]) : `Krok ${index + 1}`,
      transition,
      layout,
      background,
      backgroundColor,
      decoration,
      textTone,
      task,
      includeInLesson: include,
      requiredToAdvance: stepMetadata?.requiredToAdvance !== false,
      condition: normalizeStepCondition(stepMetadata?.condition)
    };
  }

  function stableStepId(value) {
    let hash = 2166136261;
    const text = String(value || '').trim();
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `step-${(hash >>> 0).toString(36)}`;
  }

  function normalizeStepCondition(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const supported = new Set([
      'next_click', 'previous_completed', 'material_completed', 'quiz_completed', 'correct_answer',
      'exam_completed', 'exam_passed', 'minimum_score'
    ]);
    return {
      type: supported.has(source.type) ? source.type : 'next_click',
      materialId: typeof source.materialId === 'string' ? source.materialId.slice(0, 128) : null,
      minimumScore: Math.max(0, Math.min(100, Number(source.minimumScore) || 0))
    };
  }

  function parseLesson(source, filename = 'lekcja.md') {
    let text = String(source || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n');
    if (!text.trim()) throw new LessonFormatError('EMPTY_LESSON', 'Plik lekcji jest pusty.');
    if (text.length > MAX_SOURCE_CHARS) {
      throw new LessonFormatError('LESSON_TOO_LARGE', 'Plik lekcji jest zbyt duży.');
    }
    if (text.includes('\0')) {
      throw new LessonFormatError('INVALID_LESSON', 'Plik lekcji zawiera niedozwolone znaki.');
    }

    let lessonMetadata = null;
    text = text.replace(/^\s*<!--\s*chemdisk-lesson:(\{.*\})\s*-->\s*$/im, (match, json) => {
      try { lessonMetadata = JSON.parse(json); }
      catch (_) { throw new LessonFormatError('INVALID_LESSON_METADATA', 'Ustawienia postępu lekcji są nieprawidłowe.'); }
      return '';
    });
    const parts = [];
    let current = [];
    let inCodeFence = false;
    let containerDepth = 0;
    for (const line of text.split('\n')) {
      if (/^\s*```/.test(line)) {
        inCodeFence = !inCodeFence;
        current.push(line);
      } else if (!inCodeFence && STRUCTURAL_CONTAINER_START.test(line)) {
        containerDepth += 1;
        current.push(line);
      } else if (!inCodeFence && TASK_END.test(line) && containerDepth > 0) {
        containerDepth -= 1;
        current.push(line);
      } else if (!inCodeFence && containerDepth === 0 && /^\s*---\s*$/.test(line)) {
        if (!current.join('\n').trim()) {
          throw new LessonFormatError(
            'EMPTY_SLIDE',
            `Slajd ${parts.length + 1} jest pusty. Usuń sąsiadujące separatory ---.`
          );
        }
        parts.push(current.join('\n'));
        current = [];
      } else {
        current.push(line);
      }
    }
    if (current.join('\n').trim()) parts.push(current.join('\n'));
    if (!parts.length) throw new LessonFormatError('EMPTY_LESSON', 'Plik lekcji jest pusty.');
    if (parts.length > MAX_SLIDES) {
      throw new LessonFormatError('TOO_MANY_SLIDES', `Lekcja może mieć maksymalnie ${MAX_SLIDES} slajdów.`);
    }

    const slides = parts.map(parseSlide);
    const firstHeading = text.match(/^\s*#\s+(.+?)\s*$/m);
    const fallback = String(filename || 'Lekcja').replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
    return {
      title: firstHeading ? stripMarkdown(firstHeading[1]) : fallback,
      signature: lessonSignature(text),
      navigation: lessonMetadata?.navigation === 'free' ? 'free' : 'sequential',
      slides
    };
  }

  function lessonSignature(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${value.length}-${(hash >>> 0).toString(36)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function safeUrl(value, image) {
    const raw = String(value || '')
      .trim()
      .replace(/\/members\/module\/filmv1(?=\/(?:[?#]|$))/gi, '/members/module/film');
    if (!raw || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return '';
    if (raw.startsWith('#') && !image) return raw;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
    if (!scheme) return raw;
    const protocol = scheme[1].toLowerCase();
    if (protocol === 'http' || protocol === 'https') return raw;
    if (!image && protocol === 'mailto') return raw;
    return '';
  }

  function safeLinkCardUrl(value) {
    const raw = String(value || '').trim();
    if (
      !raw
      || raw.startsWith('//')
      || raw.includes('\\')
      || /[\u0000-\u0020<>"'`]/.test(raw)
    ) return '';
    if (raw.startsWith('/') || raw.startsWith('#')) return raw;
    return /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(raw) ? raw : '';
  }

  function safePromptFilename(value) {
    const filename = String(value || '').trim();
    return SAFE_PROMPT_FILENAME.test(filename) ? filename : '';
  }

  function safeRepositoryId(value) {
    const repositoryId = String(value || '').trim().toLowerCase();
    return SAFE_REPOSITORY_ID.test(repositoryId) ? repositoryId : '';
  }

  function safeBoardPath(value) {
    const filename = String(value || '').trim();
    return SAFE_BOARD_PATH.test(filename) ? filename : '';
  }

  function safePdfReference(value, protection) {
    const reference = String(value || '').trim();
    const mode = String(protection || '1');
    if (!reference || reference.length > 500 || /[\u0000-\u0020\\]/.test(reference)) return false;
    const idPattern = /^[A-Za-z0-9_-]{10,200}$/;
    if (['4', '5'].includes(mode)) {
      try {
        const url = new URL(reference);
        return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
      } catch (_) {
        return false;
      }
    }
    if (idPattern.test(reference)) return true;
    try {
      const url = new URL(reference);
      if (url.protocol !== 'https:' || url.username || url.password) return false;
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (!['drive.google.com', 'docs.google.com'].includes(host)) return false;
      const pathId = url.pathname.match(
        /\/(?:file|document|presentation|spreadsheets)(?:\/u\/\d+)?\/d\/(?:e\/)?([A-Za-z0-9_-]{10,200})(?:\/|$)/i
      );
      const queryId = url.searchParams.get('id') || '';
      return Boolean((pathId && idPattern.test(pathId[1])) || idPattern.test(queryId));
    } catch (_) {
      return false;
    }
  }

  function googleSlidesReference(value) {
    const raw = String(value || '').trim();
    const isId = (candidate) => /^[A-Za-z0-9_-]{10,200}$/.test(candidate);
    if (isId(raw)) return { id: raw, published: false };
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (!['docs.google.com', 'drive.google.com'].includes(host)) return null;
      const queryId = url.searchParams.get('id') || '';
      if (isId(queryId)) return { id: queryId, published: false };
      const published = url.pathname.match(/^\/presentation\/d\/e\/([A-Za-z0-9_-]{10,200})(?:\/|$)/i);
      if (published && isId(published[1])) return { id: published[1], published: true };
      const standard = url.pathname.match(/^\/presentation(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/i);
      if (standard && isId(standard[1])) return { id: standard[1], published: false };
      const driveFile = url.pathname.match(/^\/file(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/i);
      if (driveFile && isId(driveFile[1])) return { id: driveFile[1], published: false };
      return null;
    } catch (_) {
      return null;
    }
  }

  function parseStyleOptions(source) {
    const values = {};
    String(source || '').replace(
      /([a-z_]+)=("[^"]*"|'[^']*'|[^\s]+)/gi,
      (_, rawKey, rawValue) => {
        const key = rawKey.toLowerCase();
        const value = rawValue.replace(/^(["'])|(["'])$/g, '').trim().toLowerCase();
        values[key] = value;
        return '';
      }
    );
    const font = STYLE_FONTS.has(values.font) ? values.font : 'sans';
    const size = STYLE_SIZES.has(values.size) ? values.size : 'normal';
    const align = STYLE_ALIGNS.has(values.align) ? values.align : 'left';
    const bold = /^(?:1|true|yes|tak|bold|700)$/i.test(values.bold || values.weight || '');
    const color = SAFE_STYLE_COLOR.test(values.color || '') ? values.color.toLowerCase() : '';
    const background = SAFE_STYLE_COLOR.test(values.background || '') ? values.background.toLowerCase() : '';
    return { font, size, align, bold, color, background };
  }

  function parseLayoutOptions(source) {
    const values = {};
    String(source || '').replace(/([a-z_]+)=([^\s]+)/gi, (_, key, value) => {
      values[key.toLowerCase()] = value;
      return '';
    });
    const clamp = (value, minimum, maximum, fallback) => {
      const parsed = Number(value);
      return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
    };
    return {
      id: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(values.id || '') ? values.id : '',
      x: clamp(values.x, 0, 92, 5),
      y: clamp(values.y, 0, 92, 5),
      width: clamp(values.width, 8, 100, 44),
      height: clamp(values.height, 8, 100, 28)
    };
  }

  function layoutContainerHtml(options) {
    const style = [
      `--lesson-canvas-x:${options.x}%`,
      `--lesson-canvas-y:${options.y}%`,
      `--lesson-canvas-width:${options.width}%`,
      `--lesson-canvas-height:${options.height}%`
    ].join(';');
    return `<div class="lesson-canvas-element"${options.id ? ` data-lesson-block-id="${escapeHtml(options.id)}"` : ''} style="${style}">`;
  }

  function styleContainerHtml(options) {
    const classes = [
      'lesson-rich-style',
      `lesson-font-${options.font}`,
      `lesson-size-${options.size}`,
      `lesson-align-${options.align}`
    ];
    if (options.bold) classes.push('lesson-weight-bold');
    if (options.background) classes.push('has-background');
    const style = options.color
      || options.background
      ? ` style="${options.color ? `--lesson-rich-color:${escapeHtml(options.color)};` : ''}${options.background ? `--lesson-rich-background:${escapeHtml(options.background)};` : ''}"`
      : '';
    return `<div class="${classes.join(' ')}"${style}>`;
  }

  function parseAccordionOptions(source) {
    const raw = String(source || '').trim();
    const open = /\s+open=(?:1|true|yes|tak)\s*$/i.test(raw);
    const title = raw.replace(/\s+open=(?:1|true|yes|tak)\s*$/i, '').trim();
    return { open, title: title || 'Więcej informacji' };
  }

  function youtubeVideoId(value) {
    const raw = String(value || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (!['youtu.be', 'youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) return '';
      const candidate = host === 'youtu.be'
        ? url.pathname.split('/').filter(Boolean)[0] || ''
        : url.searchParams.get('v')
          || (url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/) || [])[1]
          || '';
      return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : '';
    } catch (_) {
      return '';
    }
  }

  function directiveFields(body) {
    const values = {};
    String(body || '').split('\n').forEach((line) => {
      const match = /^\s*([a-z_]+):\s*(.*?)\s*$/i.exec(line);
      if (match) values[match[1].toLowerCase()] = match[2];
    });
    return values;
  }

  function directiveJsonText(values, jsonKey, fallbackKey, maxChars) {
    let value = values[fallbackKey] || '';
    if (Object.prototype.hasOwnProperty.call(values, jsonKey)) {
      try {
        value = JSON.parse(values[jsonKey]);
      } catch (_) {
        return null;
      }
      if (typeof value !== 'string') return null;
    }
    const normalized = cleanAiContextText(value, maxChars + 1, true);
    return normalized.length <= maxChars ? normalized : null;
  }

  function directiveRawJsonText(values, jsonKey, fallbackKey, maxChars) {
    let value = values[fallbackKey] || '';
    if (Object.prototype.hasOwnProperty.call(values, jsonKey)) {
      try { value = JSON.parse(values[jsonKey]); }
      catch (_) { return null; }
      if (typeof value !== 'string') return null;
    }
    const normalized = String(value ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\0/g, '');
    return normalized.length <= maxChars ? normalized.trim() : null;
  }

  function directiveBoolean(value, fallback) {
    if (/^(?:1|true|yes|tak|on)$/i.test(String(value ?? '').trim())) return true;
    if (/^(?:0|false|no|nie|off)$/i.test(String(value ?? '').trim())) return false;
    return fallback;
  }

  function safeChemistryText(value, condition) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text || text.length > (condition ? 120 : 300)) return '';
    const forbidden = condition ? /[\\{}[\]$%#&<>]/ : /[\\$%#&<>]/;
    if (forbidden.test(text)) return '';
    if (!condition) {
      let depth = 0;
      for (const character of text) {
        if (character === '{') depth += 1;
        else if (character === '}') depth -= 1;
        if (depth < 0 || depth > 6) return '';
      }
      if (depth !== 0) return '';
    }
    return text;
  }

  function safeMathExpression(value) {
    const expression = String(value || '').trim().replace(/\s+/g, ' ');
    if (!expression || expression.length > 500 || /[$%#&<>]/.test(expression)) return '';
    let depth = 0;
    for (const character of expression) {
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
      if (depth < 0 || depth > 12) return '';
    }
    if (depth !== 0) return '';
    const commands = expression.match(/\\[A-Za-z]+/g) || [];
    if (commands.some((command) => !SAFE_MATH_COMMANDS.has(command.slice(1)))) return '';
    return expression;
  }

  function formulaBlockHtml(values) {
    const mode = /^(?:math|matematyka)$/i.test(values.mode || '') ? 'math' : 'chemistry';
    const title = values.title || (mode === 'math' ? 'Wzór matematyczny' : 'Równanie reakcji');
    if (mode === 'math') {
      const expression = safeMathExpression(values.expression);
      if (!expression) {
        return '<p class="lesson-interactive-error">Nieprawidłowy wzór matematyczny.</p>';
      }
      return `<figure class="lesson-formula lesson-formula-math" data-lesson-ai-formula="${escapeHtml(expression)}"><div class="lesson-formula-display" aria-label="${escapeHtml(title)}">\\(\\displaystyle ${escapeHtml(expression)}\\)</div><figcaption>${escapeHtml(title)}</figcaption></figure>`;
    }

    const left = safeChemistryText(values.left, false);
    const requestedArrow = Object.prototype.hasOwnProperty.call(values, 'arrow')
      ? String(values.arrow || '').trim()
      : '->';
    const arrow = FORMULA_ARROWS.has(requestedArrow)
      ? requestedArrow
      : '->';
    const right = String(values.right || '').trim()
      ? safeChemistryText(values.right, false)
      : '';
    const above = String(values.above || '').trim()
      ? safeChemistryText(values.above, true)
      : '';
    const below = String(values.below || '').trim()
      ? safeChemistryText(values.below, true)
      : '';
    if (!left || (arrow && !right) || (values.above && !above) || (values.below && !below)) {
      return '<p class="lesson-interactive-error">Nieprawidłowy wzór lub warunki reakcji chemicznej.</p>';
    }
    const labels = `${above ? `[${above}]` : ''}${below ? `[${below}]` : ''}`;
    const reaction = `${left}${arrow ? ` ${arrow}${labels} ${right}` : ''}`;
    return `<figure class="lesson-formula lesson-formula-chemistry" data-lesson-ai-formula="${escapeHtml(reaction)}"><div class="lesson-formula-display" aria-label="${escapeHtml(title)}">\\(\\ce{${escapeHtml(reaction)}}\\)</div><figcaption>${escapeHtml(title)}</figcaption></figure>`;
  }

  function tableBlockHtml(body) {
    const lines = String(body || '').split('\n');
    const values = directiveFields(body);
    const splitCells = (value) => String(value || '')
      .split('|')
      .map((cell) => cell.trim());
    const headers = splitCells(values.headers);
    const rows = lines
      .map((line) => /^\s*row:\s*(.*?)\s*$/i.exec(line))
      .filter(Boolean)
      .map((match) => splitCells(match[1]));
    const align = ['left', 'center', 'right'].includes(values.align) ? values.align : 'left';
    const caption = String(values.caption || '').trim();
    const cells = [...headers, ...rows.flat()];
    if (
      headers.length < 2
      || headers.length > 8
      || headers.some((header) => !header)
      || rows.length < 1
      || rows.length > 30
      || rows.some((row) => row.length !== headers.length)
      || cells.some((cell) => cell.length > 240 || cell.includes('\0'))
      || caption.length > 180
    ) {
      return '<p class="lesson-interactive-error">Nieprawidłowa tabela. Sprawdź liczbę nagłówków i komórek.</p>';
    }
    const headingHtml = headers
      .map((header) => `<th scope="col">${renderInline(header)}</th>`)
      .join('');
    const bodyHtml = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
      .join('');
    const label = caption ? '' : ' aria-label="Tabela"';
    return `<figure class="lesson-table lesson-table-align-${align}"><div class="lesson-table-scroll"><table${label}>${caption ? `<caption>${renderInline(caption)}</caption>` : ''}<thead><tr>${headingHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div></figure>`;
  }

  function renderOpenQuestionMarkdown(value) {
    const safeSource = String(value || '')
      .split('\n')
      .map((line) => (
        STRUCTURAL_CONTAINER_START.test(line) || RICH_CONTAINER_END.test(line)
          ? `\`${line.trim()}\``
          : line
      ))
      .join('\n');
    return renderMarkdown(safeSource);
  }

  function interactiveBlockHtml(type, body) {
    const values = directiveFields(body);
    if (type === 'studentanswer') {
      const questionId = String(values.question_id || '').trim();
      const question = directiveRawJsonText(
        values,
        'question_json',
        'question',
        MAX_OPEN_QUESTION_CHARS
      );
      const placeholder = directiveRawJsonText(values, 'placeholder_json', 'placeholder', 500);
      const label = String(values.label || 'Twoja odpowiedź').trim().slice(0, 180);
      const button = String(values.button || 'Zapisz odpowiedź').trim().slice(0, 180);
      const minHeight = Math.round(Math.max(80, Math.min(800, Number(values.min_height) || 180)));
      const rawMaxLength = Number(values.max_length);
      const maxLength = Math.round(Math.max(0, Math.min(
        MAX_STUDENT_ANSWER_CHARS,
        Number.isFinite(rawMaxLength) ? rawMaxLength : 0
      )));
      const multiline = directiveBoolean(values.multiline, true);
      const required = directiveBoolean(values.required, true);
      const persist = directiveBoolean(values.save_progress ?? values.persist, true);
      const allowEdit = directiveBoolean(values.allow_edit, true);
      if (!SAFE_QUESTION_ID.test(questionId) || !question || placeholder === null || !label || !button) {
        return '<p class="lesson-interactive-error">Nieprawidłowe pytanie otwarte.</p>';
      }
      const controlId = `lesson-answer-${questionId}`;
      const maximum = maxLength ? ` maxlength="${maxLength}"` : '';
      const requiredAttribute = required ? ' required' : '';
      const answerControl = multiline
        ? `<textarea id="${escapeHtml(controlId)}" data-student-answer-input rows="5" style="min-height:${minHeight}px" placeholder="${escapeHtml(placeholder || '')}"${maximum}${requiredAttribute}></textarea>`
        : `<input id="${escapeHtml(controlId)}" data-student-answer-input type="text" placeholder="${escapeHtml(placeholder || '')}"${maximum}${requiredAttribute}>`;
      const initialCount = maxLength ? `0 / ${maxLength}` : '0 znaków';
      return `<section class="lesson-student-answer" data-question-id="${escapeHtml(questionId)}" data-required="${required ? 'true' : 'false'}" data-persist="${persist ? 'true' : 'false'}" data-max-length="${maxLength}" data-min-height="${minHeight}" data-multiline="${multiline ? 'true' : 'false'}" data-allow-edit="${allowEdit ? 'true' : 'false'}" data-question="${escapeHtml(question)}"><div class="lesson-student-answer-question"><small>Pytanie otwarte</small>${renderOpenQuestionMarkdown(question)}</div><label for="${escapeHtml(controlId)}">${escapeHtml(label)}</label>${answerControl}<div class="lesson-student-answer-actions"><button type="button" data-student-answer-save>${escapeHtml(button)}</button><span data-student-answer-count aria-live="off">${initialCount}</span><p data-student-answer-status aria-live="polite"></p></div></section>`;
    }
    if (type === 'answerreview') {
      const questionId = String(values.question_id || '').trim();
      const question = directiveRawJsonText(
        values,
        'question_json',
        'question',
        MAX_OPEN_QUESTION_CHARS
      );
      const answerKey = directiveRawJsonText(values, 'key_json', 'key', MAX_ANSWER_KEY_CHARS);
      const aiInstruction = directiveRawJsonText(
        values,
        'ai_instruction_json',
        'ai_instruction',
        MAX_AI_REVIEW_INSTRUCTION_CHARS
      );
      const showStudentAnswer = directiveBoolean(values.show_student_answer ?? values.show_answer, true);
      const aiEnabled = directiveBoolean(values.ai_enabled, true);
      const order = values.order === 'key-first' ? 'key-first' : 'student-first';
      if (
        !SAFE_QUESTION_ID.test(questionId)
        || !question
        || !answerKey
        || aiInstruction === null
        || /^\s*:::(?:studentanswer|answerreview|style|accordion)\b/im.test(answerKey)
      ) {
        return '<p class="lesson-interactive-error">Nieprawidłowe omówienie odpowiedzi.</p>';
      }
      const studentPanel = `<section class="lesson-answer-review-student"${showStudentAnswer ? '' : ' hidden'}><h3>Twoja odpowiedź</h3><blockquote data-student-answer-display>Nie zapisano jeszcze odpowiedzi.</blockquote></section>`;
      const keyPanel = `<section class="lesson-answer-key"><h3>Klucz odpowiedzi</h3><div class="lesson-answer-key-content">${renderMarkdown(answerKey)}</div></section>`;
      const comparison = order === 'key-first'
        ? `${keyPanel}${studentPanel}`
        : `${studentPanel}${keyPanel}`;
      const aiButton = aiEnabled
        ? '<button type="button" data-answer-review-ai>✨ Zapytaj AI</button>'
        : '';
      return `<section class="lesson-answer-review" data-question-id="${escapeHtml(questionId)}" data-show-student-answer="${showStudentAnswer ? 'true' : 'false'}" data-ai-enabled="${aiEnabled ? 'true' : 'false'}" data-ai-instruction="${escapeHtml(aiInstruction || '')}" data-review-order="${order}" data-question="${escapeHtml(question || '')}">${comparison}<div class="lesson-answer-review-actions">${aiButton}<p data-answer-review-status aria-live="polite"></p></div><section class="lesson-answer-ai-result" data-answer-review-result hidden aria-live="polite"></section></section>`;
    }
    if (type === 'table') return tableBlockHtml(body);
    if (type === 'image') {
      const ref = String(values.ref || '').trim().toLowerCase();
      const repository = String(values.repository || '').trim().toLowerCase();
      const owner = String(values.owner || '').trim();
      const alt = String(values.alt || 'Ilustracja').trim().slice(0, 220) || 'Ilustracja';
      const width = Math.max(20, Math.min(100, Number(values.width) || 100));
      const align = ['left', 'center', 'right'].includes(values.align) ? values.align : 'center';
      if (!SAFE_MEDIA_REF.test(ref) || (repository && !SAFE_REPOSITORY_ID.test(repository)) || (owner && !SAFE_FILENAME.test(owner))) {
        return '<p class="lesson-interactive-error">Nieprawidłowa referencja obrazu.</p>';
      }
      const scope = ref.startsWith('assets/shared/') ? 'shared' : 'local';
      return `<figure class="lesson-managed-image lesson-image-align-${align}" style="--lesson-image-width:${width}%" data-lesson-media-ref="${escapeHtml(ref)}" data-lesson-media-repository="${escapeHtml(repository)}" data-lesson-media-owner="${escapeHtml(owner)}" data-lesson-media-scope="${scope}" data-lesson-media-alt="${escapeHtml(alt)}"><div class="lesson-managed-image-placeholder"><span aria-hidden="true">▧</span><small>Wczytywanie obrazu…</small></div></figure>`;
    }
    if (type === 'youtube') {
      const id = youtubeVideoId(values.id || values.url);
      if (!id) return '<p class="lesson-interactive-error">Nieprawidłowy film YouTube.</p>';
      const title = values.title || 'Film do lekcji';
      return `<figure class="lesson-embed lesson-youtube"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(id)}?playsinline=1&amp;rel=0" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe><figcaption>${escapeHtml(title)}</figcaption></figure>`;
    }
    if (type === 'googleslides') {
      const reference = googleSlidesReference(values.id || values.url);
      if (!reference) return '<p class="lesson-interactive-error">Nieprawidłowa prezentacja Google Slides.</p>';
      const published = reference.published || /^(?:1|true|yes|tak)$/i.test(String(values.published || '').trim());
      const encodedId = encodeURIComponent(reference.id);
      const base = published
        ? `https://docs.google.com/presentation/d/e/${encodedId}`
        : `https://docs.google.com/presentation/d/${encodedId}`;
      const title = String(values.title || 'Prezentacja Google Slides').trim().slice(0, 180) || 'Prezentacja Google Slides';
      const controls = !/^(?:0|false|no|nie|off)$/i.test(String(values.controls || 'true').trim());
      const source = `${base}/embed?start=false&amp;loop=false&amp;delayms=3000${controls ? '' : '&amp;rm=minimal'}`;
      return `<figure class="lesson-embed lesson-google-slides"><iframe src="${source}" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="fullscreen" allowfullscreen></iframe><figcaption>${escapeHtml(title)}</figcaption></figure>`;
    }
    if (type === 'googlemedia') return googleMedia.html(values);
    if (type === 'presentation') {
      const repository = safeRepositoryId(values.repository || 'default');
      const presentationId = String(values.presentation || '').trim().toLowerCase();
      const title = String(values.title || 'Prezentacja').trim();
      const description = String(values.description || 'Otwórz prezentację przygotowaną na platformie.').trim();
      const button = String(values.button || 'Otwórz prezentację').trim();
      if (!repository || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(presentationId) || !title || !button) {
        return '<p class="lesson-interactive-error">Nieprawidłowe odwołanie do prezentacji.</p>';
      }
      const href = `/members/module/presentation/?repo=${encodeURIComponent(repository)}&amp;presentation=${encodeURIComponent(presentationId)}`;
      return `<section class="lesson-support-card lesson-presentation-card" data-presentation-repository="${escapeHtml(repository)}" data-presentation-id="${escapeHtml(presentationId)}"><span class="lesson-support-icon" aria-hidden="true">S</span><span class="lesson-support-copy"><small>Prezentacja</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></span><a class="lesson-support-action" href="${href}">${escapeHtml(button)} <b aria-hidden="true">→</b></a></section>`;
    }
    if (type === 'quiz') {
      const repository = safeRepositoryId(values.repository || 'default');
      const quizId = String(values.quiz || '').trim().toLowerCase();
      const title = String(values.title || 'Quiz').trim();
      const description = String(values.description || 'Rozwiąż quiz przygotowany do tej lekcji.').trim();
      const button = String(values.button || 'Otwórz quiz').trim();
      if (!repository || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(quizId) || !title || !button) {
        return '<p class="lesson-interactive-error">Nieprawidłowe odwołanie do quizu.</p>';
      }
      const materialId = `quiz:${repository}:${quizId}`.slice(0, 128);
      if (values.study === 'true') {
        const href = `/members/module/quiz/?repo=${encodeURIComponent(repository)}&amp;quiz=${encodeURIComponent(quizId)}&amp;material=${encodeURIComponent(materialId)}&amp;study=due`;
        return `<section class="lesson-support-card lesson-study-card"><span class="lesson-support-icon" aria-hidden="true">↻</span><span class="lesson-support-copy"><small>Powtórka / Fiszki</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span><small class="lesson-study-hint">Lekcja pozostaje na tym kroku. Nauka otworzy się w nowej karcie, z postępem na Twoim koncie.</small></span><a class="lesson-support-action" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(button)} ↗</a></section>`;
      }
      const href = `/members/module/quiz/?repo=${encodeURIComponent(repository)}&amp;quiz=${encodeURIComponent(quizId)}&amp;material=${encodeURIComponent(materialId)}`;
      return `<section class="lesson-support-card lesson-quiz-card" data-quiz-repository="${escapeHtml(repository)}" data-quiz-id="${escapeHtml(quizId)}" data-quiz-material="${escapeHtml(materialId)}"><span class="lesson-support-icon" aria-hidden="true">Q</span><span class="lesson-support-copy"><small>Quiz</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></span><a class="lesson-support-action" href="${href}">${escapeHtml(button)} <b aria-hidden="true">→</b></a></section>`;
    }
    if (type === 'pdf') {
      const protection = ['1', '2', '3', '4', '5'].includes(String(values.protection || values.type || '1'))
        ? String(values.protection || values.type || '1') : '1';
      const pdfId = String(values.id || values.url || '').trim();
      const title = String(values.title || 'Dokument PDF').trim();
      const description = String(values.description || 'Otwórz dokument PDF do tej lekcji.').trim();
      const button = String(values.button || 'Otwórz PDF').trim();
      if (!safePdfReference(pdfId, protection) || !title || !button) {
        return '<p class="lesson-interactive-error">Nieprawidłowe odwołanie do dokumentu PDF.</p>';
      }
      const href = `/members/module/pdf/?id=${encodeURIComponent(pdfId)}&amp;type=${protection}`;
      return `<section class="lesson-support-card lesson-pdf-card" data-pdf-protection="${protection}"><span class="lesson-support-icon" aria-hidden="true">PDF</span><span class="lesson-support-copy"><small>Dokument PDF</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></span><a class="lesson-support-action" href="${href}">${escapeHtml(button)} <b aria-hidden="true">→</b></a></section>`;
    }
    if (type === 'atonom') {
      const formula = String(values.formula || '').trim();
      if (!formula || formula.length > 140 || /[\u0000-\u001f<>\\]/.test(formula)) {
        return '<p class="lesson-interactive-error">Nieprawidłowa nazwa związku dla ATONOM.</p>';
      }
      const title = values.title || `Model cząsteczki: ${formula}`;
      const src = `/members/module/atonom/?formula=${encodeURIComponent(formula)}`;
      return `<figure class="lesson-embed lesson-atonom" data-atonom-formula="${escapeHtml(formula)}"><div class="lesson-atonom-card"><span class="lesson-atonom-symbol" aria-hidden="true">⚛</span><span class="lesson-atonom-copy"><small>Interaktywny model 3D</small><strong>${escapeHtml(formula)}</strong><span>Model zostanie uruchomiony dopiero po kliknięciu.</span></span><button class="lesson-atonom-open" type="button" data-atonom-src="${escapeHtml(src)}" data-atonom-title="${escapeHtml(title)}" aria-expanded="false">Pokaż związek</button></div><div class="lesson-atonom-frame" hidden></div><figcaption>${escapeHtml(title)}</figcaption></figure>`;
    }
    if (type === 'formula') return formulaBlockHtml(values);
    if (type === 'aihelp') {
      const title = String(values.title || 'Masz pytanie do tego slajdu?').trim();
      const description = String(
        values.description || 'Otwórz asystenta AI z treścią tego slajdu jako kontekstem.'
      ).trim();
      const button = String(values.button || 'Zapytaj AI').trim();
      const rawPrompt = String(values.prompt || '').trim();
      const prompt = rawPrompt ? safePromptFilename(rawPrompt) : '';
      const rawRepository = String(values.repository || '').trim();
      const repository = rawRepository ? safeRepositoryId(rawRepository) : '';
      const rawPoint = String(values.point || '').trim();
      const point = /^[1-9]\d{0,3}$/.test(rawPoint) ? rawPoint : '';
      const authorContext = directiveJsonText(
        values,
        'context_json',
        'context',
        MAX_AI_AUTHOR_CONTEXT_CHARS
      );
      const includeSlide = !/^(?:0|false|no|nie|off)$/i.test(String(values.include_slide || 'true').trim());
      const includeTask = !/^(?:0|false|no|nie|off)$/i.test(String(values.include_task || 'true').trim());
      if (
        !title
        || !button
        || authorContext === null
        || (rawPrompt && !prompt)
        || (rawRepository && !repository)
        || (rawPoint && !point)
      ) {
        return '<p class="lesson-interactive-error">Nieprawidłowy klocek pomocy AI.</p>';
      }
      if (/\.txt$/i.test(prompt) && !point) {
        return '<p class="lesson-interactive-error">Prompt TXT wymaga numeru punktu.</p>';
      }
      return `<section class="lesson-support-card lesson-ai-help" data-ai-prompt="${escapeHtml(prompt)}" data-ai-repository="${escapeHtml(repository)}" data-ai-point="${escapeHtml(point || '1')}" data-ai-author-context="${escapeHtml(JSON.stringify(authorContext))}" data-ai-include-slide="${includeSlide ? 'true' : 'false'}" data-ai-include-task="${includeTask ? 'true' : 'false'}"><span class="lesson-support-icon" aria-hidden="true">✦</span><span class="lesson-support-copy"><small>Pomoc do bieżącego slajdu</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></span><button class="lesson-support-action" type="button" data-lesson-ai-open>${escapeHtml(button)} <b aria-hidden="true">→</b></button></section>`;
    }
    if (type === 'board') {
      const variant = values.variant === 'bitpaper' ? 'bitpaper' : 'whiteboard';
      const rawPath = String(values.path || '').trim();
      const path = rawPath ? safeBoardPath(rawPath) : '';
      const title = String(
        values.title || (variant === 'bitpaper' ? 'Otwórz tablicę BitPaper' : 'Otwórz białą tablicę')
      ).trim();
      const description = String(
        values.description || 'Szkicuj rozwiązanie, wzory i notatki na interaktywnej tablicy.'
      ).trim();
      const button = String(values.button || 'Otwórz tablicę').trim();
      if (!title || !button || (rawPath && (variant !== 'bitpaper' || !path))) {
        return '<p class="lesson-interactive-error">Nieprawidłowy klocek tablicy.</p>';
      }
      const href = variant === 'bitpaper'
        ? `/members/module/bitpaper/${path ? `?path=${encodeURIComponent(path)}` : ''}`
        : '/members/module/whiteboard/';
      const newTab = !/^(?:0|false|no|nie)$/i.test(values.new_tab || 'true');
      const target = newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      const label = variant === 'bitpaper' ? 'Tablica BitPaper' : 'Biała tablica';
      const icon = variant === 'bitpaper' ? '▧' : '✎';
      return `<a class="lesson-support-card lesson-board-card" href="${escapeHtml(href)}"${target}><span class="lesson-support-icon" aria-hidden="true">${icon}</span><span class="lesson-support-copy"><small>${label}</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></span><span class="lesson-support-action">${escapeHtml(button)} <b aria-hidden="true">→</b></span></a>`;
    }
    if (type === 'contactform') {
      const title = String(values.title || 'Masz pytanie do prowadzącego?').trim();
      const description = String(
        values.description || 'Wyślij wiadomość przez formularz kontaktowy platformy.'
      ).trim();
      const button = String(values.button || 'Otwórz formularz').trim();
      const internal = String(values.internal || '').trim();
      if (!title || !button || internal.length > 240 || /[\u0000-\u001f<>]/.test(internal)) {
        return '<p class="lesson-interactive-error">Nieprawidłowy klocek formularza kontaktowego.</p>';
      }
      const href = `/members/module/contact/${internal ? `?internal=${encodeURIComponent(internal)}` : ''}`;
      const newTab = /^(?:1|true|yes|tak|new)$/i.test(values.new_tab || '');
      const target = newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a class="lesson-support-card lesson-contact-card" href="${escapeHtml(href)}"${target}><span class="lesson-support-icon" aria-hidden="true">✉</span><span class="lesson-support-copy"><small>Formularz kontaktowy</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></span><span class="lesson-support-action">${escapeHtml(button)} <b aria-hidden="true">→</b></span></a>`;
    }
    if (type === 'exam') {
      const repository = safeRepositoryId(values.repository || 'default');
      const examId = String(values.exam || '').trim().toLowerCase();
      const title = String(values.title || 'Egzamin').trim();
      const description = String(values.description || 'Rozwiąż egzamin i zapisz wynik na platformie.').trim();
      const button = String(values.button || 'Otwórz egzamin').trim();
      const requirement = ['optional', 'completed', 'passed', 'minimum_score'].includes(values.requirement)
        ? values.requirement : 'optional';
      const minimumScore = Math.max(0, Math.min(100, Number(values.minimum_score) || 0));
      if (!repository || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(examId) || !title || !button) {
        return '<p class="lesson-interactive-error">Nieprawidłowe odwołanie do egzaminu.</p>';
      }
      const materialId = `exam:${repository}:${examId}`.slice(0, 128);
      const href = `/members/module/exam/?repo=${encodeURIComponent(repository)}&amp;exam=${encodeURIComponent(examId)}&amp;material=${encodeURIComponent(materialId)}`;
      return `<section class="lesson-support-card lesson-exam-card" data-exam-repository="${escapeHtml(repository)}" data-exam-id="${escapeHtml(examId)}" data-exam-material="${escapeHtml(materialId)}" data-exam-requirement="${escapeHtml(requirement)}" data-exam-minimum-score="${minimumScore}"><span class="lesson-support-icon" aria-hidden="true">E</span><span class="lesson-support-copy"><small>Egzamin</small><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span><em data-exam-state>Sprawdzanie wyniku…</em></span><a class="lesson-support-action" href="${href}">${escapeHtml(button)} <b aria-hidden="true">→</b></a></section>`;
    }
    if (type === 'linkcard') {
      const url = safeLinkCardUrl(values.url);
      const title = String(values.title || '').trim();
      if (!url || !title) {
        return '<p class="lesson-interactive-error">Nieprawidłowy kafelek z linkiem.</p>';
      }
      const description = String(values.description || '').trim();
      const iconName = LINK_ICONS.has(values.icon) ? values.icon : 'link';
      const icons = {
        link: '↗',
        book: '▤',
        video: '▶',
        chemistry: '⚗',
        math: '∑',
        file: '▧',
        external: '⤴'
      };
      const color = SAFE_STYLE_COLOR.test(values.color || '') ? values.color.toLowerCase() : '#0e665a';
      const newTab = /^(?:1|true|yes|tak|new)$/i.test(values.new_tab || '');
      const target = newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a class="lesson-link-card" href="${escapeHtml(url)}"${target} style="--link-card-color:${escapeHtml(color)}"><span class="lesson-link-icon" aria-hidden="true">${icons[iconName]}</span><span class="lesson-link-copy"><small>Materiał dodatkowy</small><strong>${escapeHtml(title)}</strong>${description ? `<span>${escapeHtml(description)}</span>` : ''}</span><span class="lesson-link-action">${newTab ? 'Otwórz w nowej karcie' : 'Otwórz'} <b aria-hidden="true">→</b></span></a>`;
    }

    const color = SAFE_STYLE_COLOR.test(values.color || '') ? values.color.toLowerCase() : '#7c3aed';
    const title = values.title || 'Fiszki do utrwalenia';
    const cards = String(body || '').split('\n')
      .filter((line) => !/^\s*(?:title|color):/i.test(line))
      .map((line) => line.split(/\s*=>\s*/, 2))
      .filter((parts) => parts.length === 2 && parts[0].trim() && parts[1].trim())
      .slice(0, 20);
    if (cards.length < 2) return '<p class="lesson-interactive-error">Dodaj co najmniej dwie kompletne fiszki.</p>';
    const items = cards.map(([front, back], index) => (
      `<button class="lesson-flashcard" type="button" aria-pressed="false" style="--flashcard-color:${escapeHtml(color)}"><span class="flashcard-face flashcard-front"><small>Fiszka ${index + 1}</small><strong>${escapeHtml(front.trim())}</strong><em>Kliknij, aby odsłonić</em></span><span class="flashcard-face flashcard-back"><small>Odpowiedź</small><strong>${escapeHtml(back.trim())}</strong><em>Kliknij, aby wrócić</em></span></button>`
    )).join('');
    return `<section class="lesson-flashcards" aria-label="${escapeHtml(title)}"><h3>${escapeHtml(title)}</h3><div class="lesson-flashcard-grid">${items}</div></section>`;
  }

  function extractInteractiveBlocks(source, interactiveBlocks) {
    const lines = String(source || '').split('\n');
    const prepared = [];
    let inCode = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        prepared.push(line);
        continue;
      }
      const start = !inCode ? INTERACTIVE_START.exec(line) : null;
      if (!start) {
        prepared.push(line);
        continue;
      }
      const body = [];
      let end = index + 1;
      while (end < lines.length && !RICH_CONTAINER_END.test(lines[end])) {
        body.push(lines[end]);
        end += 1;
      }
      if (end >= lines.length) {
        prepared.push(line);
        continue;
      }
      const html = interactiveBlockHtml(start[1].toLowerCase(), body.join('\n'));
      prepared.push(`CHEMLESSONBLOCK${interactiveBlocks.push(html) - 1}END`);
      index = end;
    }
    return prepared.join('\n');
  }

  function renderInline(source) {
    const tokens = [];
    const keep = (html) => `CHEMLESSONTOKEN${tokens.push(html) - 1}END`;
    let value = String(source || '');

    value = value.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
    value = value.replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (_, alt, rawUrl) => {
      const url = safeUrl(rawUrl, true);
      if (!url) return escapeHtml(alt);
      return keep(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`);
    });
    value = value.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, rawUrl) => {
      const url = safeUrl(rawUrl, false);
      if (!url) return escapeHtml(label);
      const external = /^https?:/i.test(url);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return keep(`<a href="${escapeHtml(url)}"${attrs}>${escapeHtml(label)}</a>`);
    });

    value = escapeHtml(value);
    value = value.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    value = value.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    value = value.replace(/\^([^^\n]{1,40})\^/g, '<sup>$1</sup>');
    value = value.replace(/~([^~\n]{1,40})~/g, '<sub>$1</sub>');
    return value
      .replace(/CHEMLESSONTOKEN(\d+)END/g, (_, index) => tokens[Number(index)] || '')
      .replace(
        /<img\b([^>]*)\sloading="lazy">/g,
        '<img$1 loading="lazy" decoding="async" referrerpolicy="no-referrer">'
      );
  }

  function renderMarkdown(source) {
    const interactiveBlocks = [];
    const preparedSource = extractInteractiveBlocks(source, interactiveBlocks);
    const lines = preparedSource.split('\n');
    let html = '';
    let inCode = false;
    let listType = '';
    let paragraph = [];
    const richContainers = [];

    const closeList = () => {
      if (!listType) return;
      html += `</${listType}>`;
      listType = '';
    };
    const closeParagraph = () => {
      if (!paragraph.length) return;
      html += `<p>${paragraph.map((line) => renderInline(line.trim())).join('<br>')}</p>`;
      paragraph = [];
    };
    const closeBlocks = () => {
      closeParagraph();
      closeList();
    };
    const closeRichContainer = () => {
      const container = richContainers.pop();
      if (!container) return false;
      html += container === 'accordion' ? '</div></details>' : '</div>';
      return true;
    };

    for (const rawLine of lines) {
      const line = rawLine || '';
      const interactive = /^\s*CHEMLESSONBLOCK(\d+)END\s*$/.exec(line);
      if (interactive) {
        closeBlocks();
        html += interactiveBlocks[Number(interactive[1])] || '';
        continue;
      }
      if (/^\s*```/.test(line)) {
        closeBlocks();
        if (inCode) {
          html += '</code></pre>';
          inCode = false;
        } else {
          html += '<pre><code>';
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        html += `${escapeHtml(line)}\n`;
        continue;
      }

      if (QUESTION_START.test(line)) {
        closeBlocks();
        html += '<div class="lesson-question">';
        richContainers.push('question');
        continue;
      }

      const styleStart = STYLE_START.exec(line);
      if (styleStart) {
        closeBlocks();
        html += styleContainerHtml(parseStyleOptions(styleStart[1]));
        richContainers.push('style');
        continue;
      }

      const accordionStart = ACCORDION_START.exec(line);
      if (accordionStart) {
        closeBlocks();
        const accordion = parseAccordionOptions(accordionStart[1]);
        html += `<details class="lesson-accordion"${accordion.open ? ' open' : ''}><summary>${renderInline(accordion.title)}</summary><div class="lesson-accordion-content">`;
        richContainers.push('accordion');
        continue;
      }

      const layoutStart = LAYOUT_START.exec(line);
      if (layoutStart) {
        closeBlocks();
        html += layoutContainerHtml(parseLayoutOptions(layoutStart[1]));
        richContainers.push('layout');
        continue;
      }

      if (RICH_CONTAINER_END.test(line) && richContainers.length) {
        closeBlocks();
        closeRichContainer();
        continue;
      }

      if (!line.trim()) {
        closeBlocks();
        continue;
      }

      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        closeBlocks();
        const level = heading[1].length;
        html += `<h${level}>${renderInline(heading[2].trim())}</h${level}>`;
        continue;
      }

      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) {
        closeBlocks();
        html += `<blockquote>${renderInline(quote[1])}</blockquote>`;
        continue;
      }

      const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (unordered || ordered) {
        closeParagraph();
        const nextType = ordered ? 'ol' : 'ul';
        if (listType && listType !== nextType) closeList();
        if (!listType) {
          listType = nextType;
          html += `<${listType}>`;
        }
        html += `<li>${renderInline((ordered || unordered)[1])}</li>`;
        continue;
      }

      closeList();
      paragraph.push(line);
    }

    closeBlocks();
    if (inCode) html += '</code></pre>';
    while (richContainers.length) closeRichContainer();
    return html;
  }

  function stripMarkdown(value) {
    return String(value || '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~^]/g, '')
      .trim();
  }

  const api = {
    MAX_AI_AUTHOR_CONTEXT_CHARS,
    MAX_AI_CONTEXT_CHARS,
    MAX_AI_REVIEW_INSTRUCTION_CHARS,
    MAX_ANSWER_KEY_CHARS,
    MAX_OPEN_QUESTION_CHARS,
    MAX_STUDENT_ANSWER_CHARS,
    LessonFormatError,
    buildLessonAiContext,
    checkGapAnswer,
    checkAnswer,
    taskAiContext,
    parseLesson,
    renderMarkdown,
    validateFilename
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemLesson = api;
})(typeof window !== 'undefined' ? window : globalThis);
