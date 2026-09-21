(function (root) {
  'use strict';

  const googleMedia = typeof module === 'object' && module.exports ? require('../../../assets/js/google-media.js') : root.NextMedGoogleMedia;

  const SCHEMA_VERSION = 1;
  const MAX_SOURCE_CHARS = 512 * 1024;
  const MAX_SLIDES = 100;
  const SAFE_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.md$/i;
  const SAFE_PROMPT_FILENAME = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(?:json|txt)$/i;
  const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const SAFE_BOARD_PATH = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.json$/i;
  const SAFE_MEDIA_REF = /^(?:photos\/|assets\/shared\/)(?!.*\.\.)[a-z0-9][a-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/i;
  const SAFE_QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
  const MAX_AI_AUTHOR_CONTEXT_CHARS = 6000;
  const MAX_OPEN_QUESTION_CHARS = 8000;
  const MAX_STUDENT_ANSWER_CHARS = 6000;
  const MAX_ANSWER_KEY_CHARS = 10000;
  const MAX_AI_REVIEW_INSTRUCTION_CHARS = 2000;
  const TASK_START = /^\s*:::(?:task|zadanie)\s*$/i;
  const QUESTION_START = /^\s*:::question\s*$/i;
  const SLIDE_SETTINGS_START = /^\s*:::slide\s*$/i;
  const CONTAINER_START = /^\s*:::(style|accordion|layout|youtube|googleslides|googlemedia|presentation|quiz|pdf|atonom|formula|linkcard|aihelp|board|contactform|flashcards|table|exam|image|studentanswer|answerreview)(?:\s+(.*?))?\s*$/i;
  const CONTAINER_END = /^\s*:::\s*$/;
  const STYLE_FONTS = Object.freeze([
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
  const STYLE_SIZES = Object.freeze(['small', 'normal', 'large', 'xlarge']);
  const STYLE_ALIGNS = Object.freeze(['left', 'center', 'right']);
  const TABLE_ALIGNS = Object.freeze(['left', 'center', 'right']);
  const STYLE_COLOR = /^#[0-9a-f]{6}$/i;
  const LINK_ICONS = Object.freeze(['link', 'book', 'video', 'chemistry', 'math', 'file', 'external']);
  const SLIDE_TRANSITIONS = Object.freeze(['none', 'fade', 'rise', 'slide', 'zoom']);
  const SLIDE_BACKGROUNDS = Object.freeze([
    'default', 'paper', 'grid', 'dots', 'mint', 'sky', 'lavender', 'sand', 'gradient', 'night', 'custom'
  ]);
  const SLIDE_DECORATIONS = Object.freeze(['none', 'molecules', 'bubbles', 'glow']);
  const SLIDE_TEXT_TONES = Object.freeze(['auto', 'dark', 'light']);
  const FORMULA_ARROWS = Object.freeze(['', '->', '<-', '<->', '<=>', '<=>>', '<<=>']);
  const SAFE_MATH_COMMANDS = new Set([
    'alpha', 'beta', 'gamma', 'delta', 'Delta', 'theta', 'lambda', 'mu', 'pi', 'rho', 'sigma',
    'omega', 'Omega', 'cdot', 'times', 'div', 'pm', 'mp', 'approx', 'neq', 'le', 'leq', 'ge',
    'geq', 'infty', 'frac', 'sqrt', 'sum', 'prod', 'int', 'oint', 'lim', 'min', 'max',
    'sin', 'cos', 'tan', 'log', 'ln', 'partial', 'nabla', 'rightarrow', 'leftarrow',
    'leftrightarrow', 'text', 'mathrm', 'mathbf', 'overline', 'vec', 'left', 'right'
  ]);
  const BLOCK_TYPES = Object.freeze([
    'heading',
    'text',
    'list',
    'table',
    'image',
    'quote',
    'callout',
    'code',
    'style',
    'accordion',
    'youtube',
    'slides',
    'google',
    'presentation',
    'quiz',
    'study',
    'pdf',
    'atonom',
    'formula',
    'link',
    'ai',
    'board',
    'contact',
    'exam',
    'flashcards',
    'student-answer',
    'answer-review'
  ]);
  const TASK_TYPES = Object.freeze(['text', 'number', 'choice', 'abcd', 'gaps', 'gaps-text']);

  let idSequence = 0;
  // A restored draft may contain IDs from any previous editor session.
  const idNamespace = root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  class StudioLessonError extends Error {
    constructor(code, message, path) {
      super(message || code);
      this.name = 'StudioLessonError';
      this.code = code;
      this.path = path || '';
    }
  }

  function nextId(prefix) {
    idSequence += 1;
    return `${prefix}-${idNamespace}-${idSequence.toString(36)}`;
  }

  function normalizeNewlines(value) {
    return String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\0/g, '');
  }

  function oneLine(value) {
    return normalizeNewlines(value).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function booleanSetting(value, fallback) {
    if (value === true || /^(?:1|true|yes|tak|on)$/i.test(oneLine(value))) return true;
    if (value === false || /^(?:0|false|no|nie|off)$/i.test(oneLine(value))) return false;
    return fallback;
  }

  function normalizeKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  function validateFilename(value) {
    const filename = oneLine(value);
    return SAFE_FILENAME.test(filename) ? filename : '';
  }

  function slugify(value) {
    const slug = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70);
    return `${slug || 'nowa-lekcja'}.md`;
  }

  function safeImageUrl(value) {
    const raw = oneLine(value);
    if (
      !raw
      || raw.startsWith('//')
      || raw.includes('\\')
      || /[\u0000-\u0020<>()]/.test(raw)
    ) return '';
    return /^https:\/\/[^\s]+$/i.test(raw) ? raw : '';
  }

  function safeLinkUrl(value) {
    const raw = oneLine(value);
    if (
      !raw
      || raw.startsWith('//')
      || raw.includes('\\')
      || /[\u0000-\u0020<>"'`]/.test(raw)
    ) return '';
    if (raw.startsWith('/') || raw.startsWith('#')) return raw;
    return /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(raw) ? raw : '';
  }

  function safePdfReference(value, protection) {
    const reference = oneLine(value);
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

  function youtubeVideoId(value) {
    const raw = oneLine(value);
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

  function googleSlidesReference(value) {
    const raw = oneLine(value);
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

  function safeAtonomFormula(value) {
    const formula = oneLine(value);
    return formula && formula.length <= 140 && !/[\u0000-\u001f<>\\]/.test(formula)
      ? formula
      : '';
  }

  function cleanDirectiveValue(value) {
    return oneLine(value).replace(/:::/g, '').slice(0, 500);
  }

  function migrateRemovedModuleLinks(value) {
    return String(value || '')
      .replace(/\/members\/module\/filmv1(?=\/(?:[?#]|$))/gi, '/members/module/film');
  }

  function cleanInline(value) {
    return oneLine(migrateRemovedModuleLinks(value)).replace(/\]/g, '').replace(/\r|\n/g, '');
  }

  function protectStructuralLines(value) {
    return normalizeNewlines(migrateRemovedModuleLinks(value))
      .split('\n')
      .map((line) => {
        if (/^\s*---\s*$/.test(line)) return '`---`';
        if (/^\s*:::(?:task|zadanie|question|slide|style|accordion|youtube|googleslides|googlemedia|presentation|quiz|pdf|atonom|formula|linkcard|aihelp|board|contactform|flashcards|table|exam|image|studentanswer|answerreview)?(?:\s+.*?)?\s*$/i.test(line)) {
          return `\`${line.trim()}\``;
        }
        return line.replace(/\s+$/g, '');
      })
      .join('\n')
      .trim();
  }

  function normalizeStyle(value) {
    const source = value && typeof value === 'object' ? value : {};
    const requestedFont = oneLine(source.font).toLowerCase();
    const requestedSize = oneLine(source.size).toLowerCase();
    const requestedAlign = oneLine(source.align).toLowerCase();
    const font = STYLE_FONTS.includes(requestedFont) ? requestedFont : 'sans';
    const size = STYLE_SIZES.includes(requestedSize) ? requestedSize : 'normal';
    const align = STYLE_ALIGNS.includes(requestedAlign) ? requestedAlign : 'left';
    const bold = source.bold === true || /^(?:1|true|yes|tak|bold|700)$/i.test(oneLine(source.bold));
    const color = STYLE_COLOR.test(String(source.color || '')) ? String(source.color).toLowerCase() : '';
    const background = STYLE_COLOR.test(String(source.background || ''))
      ? String(source.background).toLowerCase()
      : '';
    return { font, color, background, size, align, bold };
  }

  function normalizeBlockLayout(value) {
    const source = value && typeof value === 'object' ? value : {};
    if (String(source.mode || '').toLowerCase() !== 'canvas') return null;
    const clamp = (number, minimum, maximum, fallback) => {
      const parsed = Number(number);
      return Math.round((Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback))) * 10) / 10;
    };
    return {
      mode: 'canvas',
      x: clamp(source.x, 0, 92, 5),
      y: clamp(source.y, 0, 92, 5),
      width: clamp(source.width, 8, 100, 44),
      height: clamp(source.height, 8, 100, 28)
    };
  }

  function normalizeTableCell(value) {
    return oneLine(value)
      .replace(/:::/g, '')
      .replace(/\|/g, '¦')
      .slice(0, 240);
  }

  function normalizeTableCells(value) {
    const source = Array.isArray(value) ? value : String(value || '').split('|');
    return source.map(normalizeTableCell).slice(0, 8);
  }

  function normalizeTableRows(value) {
    const source = Array.isArray(value)
      ? value
      : normalizeNewlines(value).split('\n').filter((line) => line.trim());
    return source
      .map((row) => normalizeTableCells(row))
      .filter((row) => row.some(Boolean))
      .slice(0, 30);
  }

  function safeChemistryText(value, condition) {
    const text = oneLine(value);
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
    const expression = oneLine(value);
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

  function createBlock(typeOrSeed, maybeSeed) {
    const source = typeof typeOrSeed === 'string'
      ? { ...(maybeSeed || {}), type: typeOrSeed }
      : { ...(typeOrSeed || {}) };
    const type = String(source.type || 'text').toLowerCase();
    if (!BLOCK_TYPES.includes(type)) {
      throw new StudioLessonError('UNKNOWN_BLOCK', `Nieznany typ bloku: ${type}.`, 'block.type');
    }

    const layout = normalizeBlockLayout(source.layout);
    const base = {
      id: oneLine(source.id) || nextId('block'),
      type,
      ...(layout ? { layout } : {})
    };
    if (type === 'heading') {
      return { ...base, level: Math.min(3, Math.max(1, Number(source.level) || 2)), text: oneLine(source.text) };
    }
    if (type === 'text') {
      return { ...base, text: normalizeNewlines(source.text).trim() };
    }
    if (type === 'list') {
      return {
        ...base,
        ordered: Boolean(source.ordered),
        items: (Array.isArray(source.items) ? source.items : []).map(oneLine).filter(Boolean)
      };
    }
    if (type === 'table') {
      const requestedAlign = oneLine(source.align).toLowerCase();
      return {
        ...base,
        caption: oneLine(source.caption).replace(/:::/g, '').slice(0, 180),
        align: TABLE_ALIGNS.includes(requestedAlign) ? requestedAlign : 'left',
        headers: normalizeTableCells(source.headers || source.columns),
        rows: normalizeTableRows(source.rows)
      };
    }
    if (type === 'image') {
      const requestedAlign = oneLine(source.align).toLowerCase();
      return {
        ...base,
        url: oneLine(source.url),
        ref: oneLine(source.ref).toLowerCase(),
        repositoryId: oneLine(source.repositoryId || source.repository).toLowerCase(),
        owner: oneLine(source.owner || source.mediaOwnerId),
        alt: oneLine(source.alt) || 'Ilustracja',
        width: Math.max(20, Math.min(100, Number(source.width) || 100)),
        align: ['left', 'center', 'right'].includes(requestedAlign) ? requestedAlign : 'center'
      };
    }
    if (type === 'quote') {
      return { ...base, text: normalizeNewlines(source.text).trim() };
    }
    if (type === 'callout') {
      const tone = ['info', 'tip', 'warning', 'success'].includes(source.tone) ? source.tone : 'info';
      const defaultTitles = {
        info: 'Ważne',
        tip: 'Wskazówka',
        warning: 'Uwaga',
        success: 'Brawo'
      };
      return {
        ...base,
        tone,
        title: oneLine(source.title) || defaultTitles[tone],
        text: normalizeNewlines(source.text).trim()
      };
    }
    if (type === 'code') {
      return {
        ...base,
        language: oneLine(source.language).replace(/[^a-z0-9_+-]/gi, '').slice(0, 24),
        code: normalizeNewlines(source.code).replace(/\n+$/g, '')
      };
    }
    if (type === 'youtube') {
      return {
        ...base,
        video: oneLine(source.video || source.url || source.videoId),
        title: oneLine(source.title) || 'Film do lekcji'
      };
    }
    if (type === 'slides') {
      const reference = googleSlidesReference(source.presentation || source.url || source.presentationId);
      const controls = source.controls !== false
        && !/^(?:0|false|no|nie|off)$/i.test(oneLine(source.controls));
      return {
        ...base,
        presentation: reference?.id || oneLine(source.presentation || source.url || source.presentationId),
        published: reference?.published === true
          || source.published === true
          || /^(?:1|true|yes|tak)$/i.test(oneLine(source.published)),
        controls,
        title: oneLine(source.title) || 'Prezentacja Google Slides'
      };
    }
    if (type === 'google') {
      const url = oneLine(source.url || source.resourceId);
      return { ...base, title: oneLine(source.title) || 'Materiał Google', url: googleMedia.resolve(url)?.href || url, ...googleMedia.dimensions(source) };
    }
    if (type === 'presentation') {
      return {
        ...base,
        title: oneLine(source.title) || 'Prezentacja',
        description: oneLine(source.description) || 'Otwórz prezentację przygotowaną na platformie.',
        button: oneLine(source.button) || 'Otwórz prezentację',
        repositoryId: oneLine(source.repositoryId || source.repository).toLowerCase(),
        presentationId: oneLine(source.presentationId || source.presentation).toLowerCase()
      };
    }
    if (type === 'quiz' || type === 'study') {
      return {
        ...base,
        title: oneLine(source.title) || (type === 'study' ? 'Powtórka / Fiszki' : 'Quiz'),
        description: oneLine(source.description) || 'Rozwiąż quiz przygotowany do tej lekcji.',
        button: oneLine(source.button) || 'Otwórz quiz',
        repositoryId: oneLine(source.repositoryId || source.repository).toLowerCase(),
        quizId: oneLine(source.quizId || source.quiz).toLowerCase()
      };
    }
    if (type === 'pdf') {
      const requestedProtection = oneLine(source.protection || source.viewerType || '1');
      return {
        ...base,
        title: oneLine(source.title) || 'Dokument PDF',
        description: oneLine(source.description) || 'Otwórz dokument PDF do tej lekcji.',
        button: oneLine(source.button) || 'Otwórz PDF',
        pdfId: oneLine(source.pdfId || source.id || source.url),
        protection: ['1', '2', '3', '4', '5'].includes(requestedProtection) ? requestedProtection : '1'
      };
    }
    if (type === 'atonom') {
      return {
        ...base,
        formula: oneLine(source.formula) || 'fenol',
        title: oneLine(source.title) || 'Model cząsteczki w ATONOM'
      };
    }
    if (type === 'formula') {
      const mode = ['math', 'matematyka'].includes(oneLine(source.mode).toLowerCase())
        ? 'math'
        : 'chemistry';
      const requestedArrow = Object.prototype.hasOwnProperty.call(source, 'arrow')
        ? oneLine(source.arrow)
        : '->';
      return {
        ...base,
        mode,
        title: oneLine(source.title) || (mode === 'math' ? 'Wzór matematyczny' : 'Równanie reakcji'),
        expression: oneLine(source.expression),
        left: oneLine(source.left),
        right: oneLine(source.right),
        arrow: FORMULA_ARROWS.includes(requestedArrow) ? requestedArrow : '->',
        above: oneLine(source.above),
        below: oneLine(source.below)
      };
    }
    if (type === 'ai') {
      const promptFile = oneLine(source.promptFile || source.prompt);
      const point = Number(source.promptPoint ?? source.point);
      const authorContext = normalizeNewlines(
        source.authorContext ?? source.contextNotes ?? source.context ?? ''
      ).trim().slice(0, MAX_AI_AUTHOR_CONTEXT_CHARS);
      return {
        ...base,
        title: oneLine(source.title) || 'Masz pytanie do tego slajdu?',
        description: oneLine(source.description) || 'Otwórz asystenta AI z treścią tego slajdu jako kontekstem.',
        button: oneLine(source.button) || 'Zapytaj AI',
        repositoryId: oneLine(source.repositoryId || source.repository).toLowerCase(),
        promptFile,
        promptPoint: Number.isSafeInteger(point) && point > 0 && point <= 9999 ? point : 1,
        authorContext,
        includeSlide: source.includeSlide !== false
          && !/^(?:0|false|no|nie|off)$/i.test(oneLine(source.includeSlide ?? source.include_slide)),
        includeTask: source.includeTask !== false
          && !/^(?:0|false|no|nie|off)$/i.test(oneLine(source.includeTask ?? source.include_task))
      };
    }
    if (type === 'board') {
      const variant = oneLine(source.variant).toLowerCase() === 'bitpaper' ? 'bitpaper' : 'whiteboard';
      return {
        ...base,
        title: oneLine(source.title) || (variant === 'bitpaper' ? 'Otwórz tablicę BitPaper' : 'Otwórz białą tablicę'),
        description: oneLine(source.description) || 'Szkicuj rozwiązanie, wzory i notatki na interaktywnej tablicy.',
        button: oneLine(source.button) || 'Otwórz tablicę',
        variant,
        path: oneLine(source.path),
        newTab: source.newTab !== false && !/^(?:0|false|no|nie)$/i.test(oneLine(source.newTab))
      };
    }
    if (type === 'contact') {
      return {
        ...base,
        title: oneLine(source.title) || 'Masz pytanie do prowadzącego?',
        description: oneLine(source.description) || 'Wyślij wiadomość przez formularz kontaktowy platformy.',
        button: oneLine(source.button) || 'Otwórz formularz',
        internal: oneLine(source.internal).slice(0, 240),
        newTab: source.newTab === true || /^(?:1|true|yes|tak|new)$/i.test(oneLine(source.newTab))
      };
    }
    if (type === 'exam') {
      const requirement = ['optional', 'completed', 'passed', 'minimum_score'].includes(source.requirement)
        ? source.requirement : 'optional';
      return {
        ...base,
        title: oneLine(source.title) || 'Egzamin',
        description: oneLine(source.description) || 'Rozwiąż egzamin w bezpiecznym odtwarzaczu egzaminów.',
        button: oneLine(source.button) || 'Otwórz egzamin',
        repositoryId: oneLine(source.repositoryId || source.repository).toLowerCase(),
        examId: oneLine(source.examId || source.exam).toLowerCase(),
        requirement,
        minimumScore: Math.max(0, Math.min(100, Number(source.minimumScore) || 0))
      };
    }
    if (type === 'student-answer') {
      const requestedHeight = Number(source.minHeight ?? source.min_height);
      const requestedLimit = Number(source.maxLength ?? source.max_length);
      return {
        ...base,
        questionId: oneLine(source.questionId || source.question_id) || nextId('question'),
        question: normalizeNewlines(source.question).trim().slice(0, MAX_OPEN_QUESTION_CHARS),
        label: oneLine(source.label) || 'Twoja odpowiedź',
        placeholder: oneLine(source.placeholder) || 'Wpisz swoją odpowiedź…',
        minHeight: Math.round(Math.max(80, Math.min(800, Number.isFinite(requestedHeight) ? requestedHeight : 180))),
        multiline: booleanSetting(source.multiline, true),
        maxLength: Math.round(Math.max(0, Math.min(
          MAX_STUDENT_ANSWER_CHARS,
          Number.isFinite(requestedLimit) ? requestedLimit : 0
        ))),
        required: booleanSetting(source.required, true),
        saveToProgress: booleanSetting(source.saveToProgress ?? source.save_progress ?? source.persist, true),
        allowEdit: booleanSetting(source.allowEdit ?? source.allow_edit, true),
        button: oneLine(source.button) || 'Zapisz odpowiedź'
      };
    }
    if (type === 'answer-review') {
      const order = oneLine(source.order).toLowerCase() === 'key-first' ? 'key-first' : 'student-first';
      return {
        ...base,
        questionId: oneLine(source.questionId || source.question_id),
        question: normalizeNewlines(source.question).trim().slice(0, MAX_OPEN_QUESTION_CHARS),
        showStudentAnswer: booleanSetting(
          source.showStudentAnswer ?? source.show_student_answer ?? source.show_answer,
          true
        ),
        aiEnabled: booleanSetting(source.aiEnabled ?? source.ai_enabled, true),
        aiInstruction: normalizeNewlines(source.aiInstruction ?? source.ai_instruction).trim(),
        order,
        answerKeyBlocks: normalizeAnswerKeyBlocks(source.answerKeyBlocks ?? source.blocks)
      };
    }
    if (type === 'link') {
      const icon = oneLine(source.icon).toLowerCase();
      return {
        ...base,
        title: oneLine(source.title) || 'Otwórz materiał',
        description: oneLine(source.description) || 'Przejdź do dodatkowego materiału.',
        url: oneLine(source.url) || '/members/',
        icon: LINK_ICONS.includes(icon) ? icon : 'link',
        color: STYLE_COLOR.test(String(source.color || '')) ? String(source.color).toLowerCase() : '#0e665a',
        newTab: source.newTab === true || /^(?:1|true|yes|tak|new)$/i.test(oneLine(source.newTab))
      };
    }
    if (type === 'flashcards') {
      const cards = (Array.isArray(source.cards) ? source.cards : [])
        .map((card) => ({
          front: oneLine(card && (card.front ?? card.question)),
          back: oneLine(card && (card.back ?? card.answer))
        }))
        .filter((card) => card.front || card.back)
        .slice(0, 20);
      return {
        ...base,
        title: oneLine(source.title) || 'Fiszki do utrwalenia',
        color: STYLE_COLOR.test(String(source.color || '')) ? String(source.color).toLowerCase() : '#7c3aed',
        cards
      };
    }
    if (type === 'style') {
      return {
        ...base,
        ...normalizeStyle(source),
        blocks: normalizeNestedBlocks(source.blocks)
      };
    }
    return {
      ...base,
      title: oneLine(source.title) || 'Więcej informacji',
      open: Boolean(source.open),
      blocks: normalizeNestedBlocks(source.blocks)
    };
  }

  function normalizeNestedBlocks(blocks) {
    const normalized = (Array.isArray(blocks) ? blocks : []).map((block) => createBlock(block));
    if (normalized.some((block) => (
      ['style', 'accordion', 'student-answer', 'answer-review'].includes(block.type)
    ))) {
      throw new StudioLessonError(
        'NESTED_CONTAINER',
        'Harmonijki, stylowane sekcje i pytania otwarte nie mogą być zagnieżdżane.',
        'block.blocks'
      );
    }
    return normalized;
  }

  function normalizeAnswerKeyBlocks(blocks) {
    const normalized = (Array.isArray(blocks) ? blocks : []).map((block) => createBlock(block));
    const unsupported = normalized.find((block) => (
      ['style', 'accordion', 'student-answer', 'answer-review'].includes(block.type)
    ));
    if (unsupported) {
      throw new StudioLessonError(
        'NESTED_ANSWER_KEY_CONTAINER',
        'Klucz odpowiedzi nie może zawierać kontenerów ani kolejnego pytania otwartego.',
        'block.answerKeyBlocks'
      );
    }
    return normalized;
  }

  function resolveAbcdAnswer(source, options) {
    const direct = source.correctOption ?? source.answer ?? (Array.isArray(source.answers) ? source.answers[0] : '');
    if (Number.isInteger(direct) && direct >= 0 && direct < 4) return String.fromCharCode(65 + direct);
    if (source.correctOption !== undefined && /^[0-3]$/.test(oneLine(direct))) {
      return String.fromCharCode(65 + Number(direct));
    }
    const text = oneLine(direct);
    if (/^[A-D]$/i.test(text)) return text.toUpperCase();
    const optionIndex = options.findIndex((option) => (
      oneLine(option).toLocaleLowerCase('pl') === text.toLocaleLowerCase('pl')
    ));
    return optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : text;
  }

  function createTask(seed) {
    if (!seed) return null;
    const source = typeof seed === 'string' ? { type: seed } : { ...seed };
    const type = String(source.type || 'text').toLowerCase();
    if (!TASK_TYPES.includes(type)) {
      throw new StudioLessonError('UNKNOWN_TASK', `Nieznany typ pytania: ${type}.`, 'task.type');
    }
    const multiline = (value) => normalizeNewlines(value).trim();
    const options = (Array.isArray(source.options) ? source.options : []).map(multiline).filter(Boolean);
    const answers = type === 'abcd'
      ? [resolveAbcdAnswer(source, options)].filter(Boolean)
      : (Array.isArray(source.answers) ? source.answers : [source.answer])
        .map(multiline)
        .filter(Boolean);
    return {
      id: oneLine(source.id) || nextId('task'),
      type,
      question: normalizeNewlines(source.question).trim(),
      text: normalizeNewlines(source.text || source.gapText).trim(),
      label: multiline(source.label) || (
        ['choice', 'abcd', 'gaps'].includes(type)
          ? 'Wybierz odpowiedź'
          : type === 'gaps-text' ? 'Wpisz odpowiedzi w luki' : 'Twoja odpowiedź'
      ),
      placeholder: oneLine(source.placeholder),
      options,
      answers,
      caseSensitive: Boolean(source.caseSensitive),
      checkMode: source.checkMode === 'each' ? 'each' : 'all',
      hint: multiline(source.hint),
      feedback: multiline(source.feedback ?? source.success) || 'Dobrze! Możesz przejść dalej.'
    };
  }

  function normalizeStepCondition(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const supported = [
      'next_click', 'previous_completed', 'material_completed', 'quiz_completed', 'correct_answer',
      'exam_completed', 'exam_passed', 'minimum_score'
    ];
    return {
      type: supported.includes(source.type) ? source.type : 'next_click',
      materialId: oneLine(source.materialId).slice(0, 128),
      minimumScore: Math.max(0, Math.min(100, Number(source.minimumScore) || 0))
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

  function createSlide(seed) {
    const source = seed && typeof seed === 'object' ? seed : {};
    const blocks = Array.isArray(source.blocks) ? source.blocks.map((block) => createBlock(block)) : [];
    if (source.title && !blocks.some((block) => block.type === 'heading')) {
      blocks.unshift(createBlock('heading', { level: source.level || 2, text: source.title }));
    }
    const examBlock = blocks.find((block) => block.type === 'exam' && block.requirement !== 'optional');
    const derivedCondition = examBlock ? {
      type: examBlock.requirement === 'completed' ? 'exam_completed'
        : examBlock.requirement === 'passed' ? 'exam_passed' : 'minimum_score',
      materialId: `exam:${examBlock.repositoryId || 'default'}:${examBlock.examId}`.slice(0, 128),
      minimumScore: examBlock.requirement === 'minimum_score' ? examBlock.minimumScore : 0
    } : source.condition;
    return {
      id: oneLine(source.id) || nextId('slide'),
      layout: oneLine(source.layout).toLowerCase() === 'canvas' ? 'canvas' : 'flow',
      transition: SLIDE_TRANSITIONS.includes(oneLine(source.transition).toLowerCase())
        ? oneLine(source.transition).toLowerCase()
        : 'fade',
      background: SLIDE_BACKGROUNDS.includes(oneLine(source.background).toLowerCase())
        ? oneLine(source.background).toLowerCase()
        : 'default',
      backgroundColor: STYLE_COLOR.test(oneLine(source.backgroundColor || source.background_color))
        ? oneLine(source.backgroundColor || source.background_color).toLowerCase()
        : '#f8fafc',
      decoration: SLIDE_DECORATIONS.includes(oneLine(source.decoration).toLowerCase())
        ? oneLine(source.decoration).toLowerCase()
        : 'none',
      textTone: SLIDE_TEXT_TONES.includes(oneLine(source.textTone || source.text_tone).toLowerCase())
        ? oneLine(source.textTone || source.text_tone).toLowerCase()
        : 'auto',
      blocks,
      task: createTask(source.task),
      includeInLesson: ['ON', 'OFF', 'INHERIT'].includes(String(source.includeInLesson || '').toUpperCase())
        ? String(source.includeInLesson).toUpperCase() : 'INHERIT',
      requiredToAdvance: source.requiredToAdvance !== false,
      condition: normalizeStepCondition(derivedCondition),
      progressConfigured: source.progressConfigured === true
    };
  }

  function uniqueEditorIds(lesson) {
    const entries = [{ node: lesson, prefix: 'lesson' }];
    const visit = (blocks) => blocks.forEach((block) => {
      entries.push({ node: block, prefix: 'block' });
      if (Array.isArray(block.blocks)) visit(block.blocks);
      if (Array.isArray(block.answerKeyBlocks)) visit(block.answerKeyBlocks);
    });
    lesson.slides.forEach((slide) => {
      entries.push({ node: slide, prefix: 'slide' });
      visit(slide.blocks);
      if (slide.task) entries.push({ node: slide.task, prefix: 'task' });
    });
    const reserved = new Set(entries.map(({ node }) => node.id)), seen = new Set();
    entries.forEach(({ node, prefix }) => {
      if (seen.has(node.id)) {
        let id;
        do { id = nextId(prefix); } while (reserved.has(id));
        node.id = id;
        reserved.add(id);
      }
      seen.add(node.id);
    });
    return lesson;
  }

  function createLesson(seed) {
    const source = seed && typeof seed === 'object' ? seed : {};
    const title = oneLine(source.title) || 'Nowa lekcja';
    const slides = (Array.isArray(source.slides) && source.slides.length ? source.slides : [{}])
      .map((slide) => createSlide(slide));
    const questions = new Map();
    slides.forEach((slide) => {
      slide.blocks.forEach((block) => {
        if (block.type === 'student-answer' && !questions.has(block.questionId)) {
          questions.set(block.questionId, block.question);
        }
      });
    });
    slides.forEach((slide) => {
      slide.blocks.forEach((block) => {
        if (block.type === 'answer-review' && questions.has(block.questionId)) {
          block.question = questions.get(block.questionId);
        }
      });
    });
    return uniqueEditorIds({
      version: SCHEMA_VERSION,
      id: oneLine(source.id) || nextId('lesson'),
      title,
      filename: validateFilename(source.filename) || slugify(title),
      navigation: source.navigation === 'free' ? 'free' : 'sequential',
      navigationConfigured: source.navigationConfigured === true,
      slides
    });
  }

  function createStarterLesson(filename) {
    const safeFilename = validateFilename(filename) || 'nowa-lekcja.md';
    const baseTitle = safeFilename
      .replace(/\.md$/i, '')
      .replace(/[._-]+/g, ' ')
      .trim() || 'nowa lekcja';
    const title = `${baseTitle.charAt(0).toLocaleUpperCase('pl')}${baseTitle.slice(1)}`;
    return createLesson({
      title,
      filename: safeFilename,
      slides: [{
        blocks: [
          createBlock('heading', { level: 2, text: 'Wprowadzenie' }),
          createBlock('style', {
            font: 'sans',
            size: 'normal',
            align: 'left',
            blocks: [
              createBlock('text', { text: 'Wpisz tutaj treść pierwszego slajdu.' })
            ]
          })
        ]
      }]
    });
  }

  function validateTask(task, path, errors) {
    if (!task) return;
    if (!TASK_TYPES.includes(task.type)) {
      errors.push({ code: 'UNKNOWN_TASK', path: `${path}.type`, message: 'Nieznany typ pytania.' });
      return;
    }
    if (!task.answers.length || task.answers.some((answer) => !answer || answer.includes('|'))) {
      errors.push({ code: 'INVALID_ANSWER', path: `${path}.answers`, message: 'Dodaj poprawną odpowiedź bez znaku |.' });
    }
    if (
      task.type === 'number'
      && task.answers.some((answer) => !Number.isFinite(Number(String(answer).replace(',', '.'))))
    ) {
      errors.push({ code: 'INVALID_NUMBER_ANSWER', path: `${path}.answers`, message: 'Odpowiedź liczbowa musi być prawidłową liczbą.' });
    }
    if (task.type === 'abcd' && task.options.length !== 4) {
      errors.push({ code: 'INVALID_ABCD_OPTIONS', path: `${path}.options`, message: 'Quiz ABCD wymaga dokładnie czterech odpowiedzi.' });
    }
    if ((task.type === 'choice' || task.type === 'gaps') && task.options.length < 2) {
      errors.push({ code: 'MISSING_OPTIONS', path: `${path}.options`, message: 'Pytanie wyboru wymaga co najmniej dwóch odpowiedzi.' });
    }
    if (task.options.some((option) => option.includes('|'))) {
      errors.push({ code: 'INVALID_OPTION', path: `${path}.options`, message: 'Odpowiedź nie może zawierać znaku |.' });
    }
    if ((task.type === 'choice' || task.type === 'abcd' || task.type === 'gaps')) {
      const expectedAnswers = task.type === 'abcd'
        ? task.answers.map((answer) => task.options[(answer || '').toUpperCase().charCodeAt(0) - 65])
        : task.answers;
      const allAnswersMatch = expectedAnswers.every((answer) => task.options.some((option) => (
        task.caseSensitive
          ? answer === option
          : String(answer).toLocaleLowerCase('pl') === String(option).toLocaleLowerCase('pl')
      )));
      if (!allAnswersMatch) {
        errors.push({ code: 'ANSWER_NOT_IN_OPTIONS', path: `${path}.answers`, message: 'Poprawna odpowiedź musi występować na liście opcji.' });
      }
    }
    if (task.type === 'gaps' || task.type === 'gaps-text') {
      const gapCount = (task.text.match(/\{\{[^{}]*\}\}/g) || []).length;
      if (!task.text || gapCount < 1 || gapCount !== task.answers.length) {
        errors.push({
          code: 'INVALID_GAPS',
          path: `${path}.text`,
          message: 'Tekst luk musi zawierać po jednym znaczniku {{luka}} dla każdej poprawnej odpowiedzi.'
        });
      }
    }
    if (task.type === 'gaps-text' && !['each', 'all'].includes(task.checkMode)) {
      errors.push({ code: 'INVALID_GAP_CHECK_MODE', path: `${path}.checkMode`, message: 'Wybierz sposób sprawdzania luk tekstowych.' });
    }
  }

  function validateBlock(block, path, errors) {
    if (!BLOCK_TYPES.includes(block.type)) {
      errors.push({ code: 'UNKNOWN_BLOCK', path: `${path}.type`, message: 'Nieznany typ bloku.' });
      return;
    }
    if (block.type === 'image' && !SAFE_MEDIA_REF.test(block.ref) && !safeImageUrl(block.url)) {
      errors.push({ code: 'UNSAFE_IMAGE_URL', path: `${path}.url`, message: 'Wybierz obraz z Media Managera albo podaj pełny adres HTTPS.' });
    }
    if (block.type === 'image' && block.repositoryId && !SAFE_REPOSITORY_ID.test(block.repositoryId)) {
      errors.push({ code: 'INVALID_MEDIA_REPOSITORY', path: `${path}.repositoryId`, message: 'Repozytorium obrazu jest nieprawidłowe.' });
    }
    if (block.type === 'image' && block.owner && !SAFE_FILENAME.test(block.owner)) {
      errors.push({ code: 'INVALID_MEDIA_OWNER', path: `${path}.owner`, message: 'Folder źródłowy obrazu jest nieprawidłowy.' });
    }
    if (block.type === 'youtube' && !youtubeVideoId(block.video)) {
      errors.push({ code: 'INVALID_YOUTUBE', path: `${path}.video`, message: 'Podaj prawidłowy link lub ID filmu YouTube.' });
    }
    if (block.type === 'slides' && !googleSlidesReference(block.presentation)) {
      errors.push({ code: 'INVALID_GOOGLE_SLIDES', path: `${path}.presentation`, message: 'Podaj prawidłowy link lub ID prezentacji Google Slides.' });
    }
    if (block.type === 'google' && !googleMedia.resolve(block.url)) {
      errors.push({ code: 'INVALID_GOOGLE_MEDIA', path: `${path}.url`, message: 'Wklej link do pliku lub folderu Google Drive, dokumentu Google albo notatnika Google.' });
    }
    if (block.type === 'presentation' && (
      !SAFE_REPOSITORY_ID.test(block.repositoryId || '')
      || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(block.presentationId || '')
    )) {
      errors.push({ code: 'INVALID_PRESENTATION_REFERENCE', path, message: 'Wybierz prawidłowe repozytorium i prezentację z biblioteki.' });
    }
    if (['quiz', 'study'].includes(block.type) && (
      !SAFE_REPOSITORY_ID.test(block.repositoryId || '')
      || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(block.quizId || '')
    )) {
      errors.push({ code: 'INVALID_QUIZ_REFERENCE', path, message: 'Wybierz prawidłowe repozytorium i quiz z biblioteki.' });
    }
    if (block.type === 'pdf' && !safePdfReference(block.pdfId, block.protection)) {
      errors.push({ code: 'INVALID_PDF_REFERENCE', path: `${path}.pdfId`, message: 'Podaj prawidłowy identyfikator Dysku Google albo adres HTTPS zgodny z wybranym trybem.' });
    }
    if (block.type === 'atonom' && !safeAtonomFormula(block.formula)) {
      errors.push({ code: 'INVALID_ATONOM_FORMULA', path: `${path}.formula`, message: 'Podaj nazwę związku dla ATONOM.' });
    }
    if (block.type === 'ai') {
      if (!block.title) {
        errors.push({ code: 'INVALID_AI_HELP', path: `${path}.title`, message: 'Klocek AI wymaga tytułu.' });
      }
      if (block.repositoryId && !SAFE_REPOSITORY_ID.test(block.repositoryId)) {
        errors.push({ code: 'INVALID_AI_REPOSITORY', path: `${path}.repositoryId`, message: 'Wybierz prawidłowe repozytorium promptu AI.' });
      }
      if (block.promptFile && !SAFE_PROMPT_FILENAME.test(block.promptFile)) {
        errors.push({ code: 'INVALID_AI_PROMPT', path: `${path}.promptFile`, message: 'Prompt AI musi być plikiem .json albo .txt bez ścieżki.' });
      }
      if (/\.txt$/i.test(block.promptFile) && (!Number.isSafeInteger(block.promptPoint) || block.promptPoint < 1)) {
        errors.push({ code: 'INVALID_AI_PROMPT_POINT', path: `${path}.promptPoint`, message: 'Prompt TXT wymaga dodatniego numeru punktu.' });
      }
    }
    if (block.type === 'board') {
      if (!block.title || !['whiteboard', 'bitpaper'].includes(block.variant)) {
        errors.push({ code: 'INVALID_BOARD', path, message: 'Wybierz obsługiwany rodzaj tablicy i wpisz tytuł.' });
      }
      if (block.path && (block.variant !== 'bitpaper' || !SAFE_BOARD_PATH.test(block.path))) {
        errors.push({ code: 'INVALID_BOARD_PATH', path: `${path}.path`, message: 'Plansza BitPaper musi wskazywać bezpieczną nazwę pliku .json.' });
      }
    }
    if (block.type === 'link') {
      if (!block.title || !safeLinkUrl(block.url)) {
        errors.push({
          code: 'INVALID_LINK_CARD',
          path: `${path}.url`,
          message: 'Kafelek wymaga tytułu i bezpiecznego adresu http/https, mailto:, /ścieżki albo #kotwicy.'
        });
      }
      if (!LINK_ICONS.includes(block.icon) || !STYLE_COLOR.test(block.color)) {
        errors.push({ code: 'INVALID_LINK_STYLE', path, message: 'Wybierz obsługiwaną ikonę i kolor kafelka.' });
      }
    }
    if (block.type === 'contact') {
      if (!block.title || !block.button || block.internal.length > 240) {
        errors.push({
          code: 'INVALID_CONTACT_FORM',
          path,
          message: 'Formularz kontaktowy wymaga tytułu i tekstu przycisku; wstępna wiadomość może mieć maksymalnie 240 znaków.'
        });
      }
    }
    if (block.type === 'exam') {
      if (
        !SAFE_REPOSITORY_ID.test(block.repositoryId || '')
        || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(block.examId || '')
        || !['optional', 'completed', 'passed', 'minimum_score'].includes(block.requirement)
      ) {
        errors.push({ code: 'INVALID_EXAM_REFERENCE', path, message: 'Wybierz prawidłowe repozytorium i egzamin z biblioteki.' });
      }
    }
    if (block.type === 'student-answer') {
      if (!SAFE_QUESTION_ID.test(block.questionId)) {
        errors.push({
          code: 'INVALID_OPEN_QUESTION_ID',
          path: `${path}.questionId`,
          message: 'Identyfikator pytania może zawierać litery, cyfry oraz znaki . _ : - (maksymalnie 96 znaków).'
        });
      }
      if (!block.question || block.question.length > MAX_OPEN_QUESTION_CHARS) {
        errors.push({ code: 'EMPTY_OPEN_QUESTION', path: `${path}.question`, message: 'Pytanie otwarte wymaga treści.' });
      }
      if (
        !Number.isInteger(block.minHeight)
        || block.minHeight < 80
        || block.minHeight > 800
        || !Number.isInteger(block.maxLength)
        || block.maxLength < 0
        || block.maxLength > MAX_STUDENT_ANSWER_CHARS
      ) {
        errors.push({ code: 'INVALID_OPEN_QUESTION_LIMIT', path, message: 'Wysokość lub limit odpowiedzi jest nieprawidłowy.' });
      }
    }
    if (block.type === 'answer-review') {
      if (!SAFE_QUESTION_ID.test(block.questionId)) {
        errors.push({
          code: 'INVALID_ANSWER_REVIEW_ID',
          path: `${path}.questionId`,
          message: 'Omówienie musi wskazywać prawidłowy identyfikator pytania.'
        });
      }
      if (!block.question || block.question.length > MAX_OPEN_QUESTION_CHARS) {
        errors.push({
          code: 'MISSING_ANSWER_REVIEW_QUESTION',
          path: `${path}.question`,
          message: 'Omówienie musi zawierać kopię treści powiązanego pytania.'
        });
      }
      if (!['student-first', 'key-first'].includes(block.order)) {
        errors.push({ code: 'INVALID_ANSWER_REVIEW_ORDER', path: `${path}.order`, message: 'Wybierz kolejność odpowiedzi i klucza.' });
      }
      if (!block.answerKeyBlocks.length) {
        errors.push({ code: 'EMPTY_ANSWER_KEY', path: `${path}.answerKeyBlocks`, message: 'Dodaj treść klucza odpowiedzi.' });
      }
      if (block.aiInstruction.length > MAX_AI_REVIEW_INSTRUCTION_CHARS) {
        errors.push({
          code: 'AI_REVIEW_INSTRUCTION_TOO_LONG',
          path: `${path}.aiInstruction`,
          message: `Instrukcja AI może mieć maksymalnie ${MAX_AI_REVIEW_INSTRUCTION_CHARS} znaków.`
        });
      }
      const serializedAnswerKey = block.answerKeyBlocks.map(serializeBlock).join('\n\n');
      if (serializedAnswerKey.length > MAX_ANSWER_KEY_CHARS) {
        errors.push({
          code: 'ANSWER_KEY_TOO_LONG',
          path: `${path}.answerKeyBlocks`,
          message: `Klucz odpowiedzi może mieć maksymalnie ${MAX_ANSWER_KEY_CHARS} znaków po zapisaniu.`
        });
      }
      block.answerKeyBlocks.forEach((child, index) => (
        validateBlock(child, `${path}.answerKeyBlocks[${index}]`, errors)
      ));
    }
    if (block.type === 'formula') {
      if (block.mode === 'math') {
        if (!safeMathExpression(block.expression)) {
          errors.push({
            code: 'INVALID_MATH_FORMULA',
            path: `${path}.expression`,
            message: 'Wpisz poprawny wzór matematyczny, używając dostępnych symboli.'
          });
        }
      } else {
        if (!safeChemistryText(block.left, false)) {
          errors.push({
            code: 'INVALID_CHEMISTRY_FORMULA',
            path: `${path}.left`,
            message: 'Wpisz wzór związku albo substraty reakcji.'
          });
        }
        if (!FORMULA_ARROWS.includes(block.arrow)) {
          errors.push({ code: 'INVALID_FORMULA_ARROW', path: `${path}.arrow`, message: 'Wybierz obsługiwany typ strzałki.' });
        }
        if (block.arrow && !safeChemistryText(block.right, false)) {
          errors.push({
            code: 'MISSING_REACTION_PRODUCTS',
            path: `${path}.right`,
            message: 'Reakcja ze strzałką wymaga produktów po prawej stronie.'
          });
        }
        if (
          (block.above && !safeChemistryText(block.above, true))
          || (block.below && !safeChemistryText(block.below, true))
        ) {
          errors.push({
            code: 'INVALID_REACTION_CONDITION',
            path: `${path}.above`,
            message: 'Warunki reakcji zawierają niedozwolone znaki.'
          });
        }
      }
    }
    if (
      block.type === 'flashcards'
      && (
        block.cards.length < 2
        || block.cards.some((card) => !card.front || !card.back || card.front.includes('=>') || card.back.includes('=>'))
      )
    ) {
      errors.push({ code: 'INVALID_FLASHCARDS', path: `${path}.cards`, message: 'Dodaj co najmniej dwie kompletne fiszki bez znaku =>.' });
    }
    if (
      block.type === 'table'
      && (
        block.headers.length < 2
        || block.headers.some((header) => !header)
        || block.rows.length < 1
        || block.rows.some((row) => row.length !== block.headers.length)
        || !TABLE_ALIGNS.includes(block.align)
      )
    ) {
      errors.push({
        code: 'INVALID_TABLE',
        path,
        message: 'Tabela wymaga od 2 do 8 nagłówków oraz co najmniej jednego wiersza z taką samą liczbą komórek.'
      });
    }
    if (
      (block.type === 'heading' && !block.text)
      || (block.type === 'text' && !block.text.trim())
      || (block.type === 'list' && !block.items.length)
      || (block.type === 'quote' && !block.text.trim())
    ) {
      errors.push({ code: 'EMPTY_BLOCK', path, message: 'Blok nie może być pusty.' });
    }
    if (block.type === 'code' && block.code.split('\n').some((line) => /^\s*```/.test(line))) {
      errors.push({ code: 'CODE_FENCE_COLLISION', path: `${path}.code`, message: 'Wiersz kodu nie może zaczynać się od ```.' });
    }
    if ((block.type === 'style' || block.type === 'accordion')) {
      if (!block.blocks.length) {
        errors.push({ code: 'EMPTY_CONTAINER', path: `${path}.blocks`, message: 'Kontener nie może być pusty.' });
      }
      block.blocks.forEach((child, index) => validateBlock(child, `${path}.blocks[${index}]`, errors));
    }
  }

  function validateLesson(input) {
    const requestedFilename = input && typeof input === 'object' ? oneLine(input.filename) : '';
    let lesson;
    try {
      lesson = createLesson(input);
    } catch (error) {
      return {
        valid: false,
        errors: [{
          code: error.code || 'INVALID_MODEL',
          path: error.path || '',
          message: error.message || 'Nieprawidłowy model lekcji.'
        }]
      };
    }
    const errors = [];
    if (!lesson.title) errors.push({ code: 'MISSING_TITLE', path: 'title', message: 'Lekcja wymaga tytułu.' });
    if ((requestedFilename && !validateFilename(requestedFilename)) || !validateFilename(lesson.filename)) {
      errors.push({ code: 'INVALID_FILENAME', path: 'filename', message: 'Nazwa pliku musi kończyć się na .md.' });
    }
    if (!lesson.slides.length || lesson.slides.length > MAX_SLIDES) {
      errors.push({ code: 'INVALID_SLIDE_COUNT', path: 'slides', message: `Lekcja może mieć od 1 do ${MAX_SLIDES} slajdów.` });
    }
    const openQuestions = new Map();
    const reviews = [];
    lesson.slides.forEach((slide, slideIndex) => {
      const slidePath = `slides[${slideIndex}]`;
      if (!slide.blocks.length && !slide.task && !(slideIndex === 0 && lesson.title)) {
        errors.push({ code: 'EMPTY_SLIDE', path: slidePath, message: 'Slajd nie może być pusty.' });
      }
      slide.blocks.forEach((block, blockIndex) => {
        validateBlock(block, `${slidePath}.blocks[${blockIndex}]`, errors);
        if (block.type === 'student-answer') {
          if (openQuestions.has(block.questionId)) {
            errors.push({
              code: 'DUPLICATE_OPEN_QUESTION_ID',
              path: `${slidePath}.blocks[${blockIndex}].questionId`,
              message: 'Każde pytanie otwarte musi mieć unikalny questionId.'
            });
          } else {
            openQuestions.set(block.questionId, slideIndex);
          }
        }
        if (block.type === 'answer-review') {
          reviews.push({ block, slideIndex, path: `${slidePath}.blocks[${blockIndex}].questionId` });
        }
      });
      validateTask(slide.task, `${slidePath}.task`, errors);
    });
    reviews.forEach(({ block, slideIndex, path }) => {
      if (!openQuestions.has(block.questionId)) {
        errors.push({
          code: 'MISSING_OPEN_QUESTION',
          path,
          message: 'Powiązane pytanie otwarte nie istnieje w tej lekcji.'
        });
      } else if (openQuestions.get(block.questionId) >= slideIndex) {
        errors.push({
          code: 'ANSWER_REVIEW_BEFORE_QUESTION',
          path,
          message: 'Omówienie odpowiedzi musi znajdować się po powiązanym pytaniu.'
        });
      }
    });
    return { valid: errors.length === 0, errors, lesson };
  }

  function serializeBlockCore(input) {
    const block = createBlock(input);
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${cleanInline(block.text)}`;
    if (block.type === 'text') return protectStructuralLines(block.text);
    if (block.type === 'list') {
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${cleanInline(item)}`).join('\n');
    }
    if (block.type === 'table') {
      return [
        ':::table',
        `caption: ${cleanDirectiveValue(block.caption)}`,
        `align: ${block.align}`,
        `headers: ${block.headers.map(cleanDirectiveValue).join(' | ')}`,
        ...block.rows.map((row) => `row: ${row.map(cleanDirectiveValue).join(' | ')}`),
        ':::'
      ].join('\n');
    }
    if (block.type === 'image') {
      if (SAFE_MEDIA_REF.test(block.ref)) {
        return [
          ':::image',
          `ref: ${cleanDirectiveValue(block.ref)}`,
          `repository: ${cleanDirectiveValue(block.repositoryId)}`,
          ...(SAFE_FILENAME.test(block.owner) ? [`owner: ${cleanDirectiveValue(block.owner)}`] : []),
          `alt: ${cleanDirectiveValue(block.alt)}`,
          `width: ${block.width}`,
          `align: ${block.align}`,
          ':::'
        ].join('\n');
      }
      return `![${cleanInline(block.alt)}](${safeImageUrl(block.url)})`;
    }
    if (block.type === 'quote') {
      return protectStructuralLines(block.text).split('\n').map((line) => `> ${line}`).join('\n');
    }
    if (block.type === 'callout') {
      const lines = protectStructuralLines(block.text).split('\n');
      const first = `> **${cleanInline(block.title)}:**${lines[0] ? ` ${lines[0]}` : ''}`;
      return [first, ...lines.slice(1).map((line) => `> ${line}`)].join('\n');
    }
    if (block.type === 'code') {
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    }
    if (block.type === 'youtube') {
      return [
        ':::youtube',
        `id: ${youtubeVideoId(block.video)}`,
        `title: ${cleanDirectiveValue(block.title)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'slides') {
      const reference = googleSlidesReference(block.presentation);
      return [
        ':::googleslides',
        `id: ${reference?.id || ''}`,
        `published: ${block.published || reference?.published ? 'true' : 'false'}`,
        `controls: ${block.controls ? 'true' : 'false'}`,
        `title: ${cleanDirectiveValue(block.title)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'google') {
      return [':::googlemedia', `url: ${cleanDirectiveValue(block.url)}`, `title: ${cleanDirectiveValue(block.title)}`, `width: ${block.width}`, `height_percent: ${block.heightPercent}`, ':::'].join('\n');
    }
    if (block.type === 'presentation') {
      return [
        ':::presentation',
        `repository: ${cleanDirectiveValue(block.repositoryId)}`,
        `presentation: ${cleanDirectiveValue(block.presentationId)}`,
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'quiz' || block.type === 'study') {
      return [
        ':::quiz',
        ...(block.type === 'study' ? ['study: true'] : []),
        `repository: ${cleanDirectiveValue(block.repositoryId)}`,
        `quiz: ${cleanDirectiveValue(block.quizId)}`,
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'pdf') {
      return [
        ':::pdf',
        `id: ${cleanDirectiveValue(block.pdfId)}`,
        `protection: ${block.protection}`,
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'atonom') {
      return [
        ':::atonom',
        `formula: ${cleanDirectiveValue(block.formula)}`,
        `title: ${cleanDirectiveValue(block.title)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'formula') {
      const lines = [
        ':::formula',
        `mode: ${block.mode}`,
        `title: ${cleanDirectiveValue(block.title)}`
      ];
      if (block.mode === 'math') {
        lines.push(`expression: ${cleanDirectiveValue(block.expression)}`);
      } else {
        lines.push(
          `left: ${cleanDirectiveValue(block.left)}`,
          `arrow: ${block.arrow}`,
          `above: ${cleanDirectiveValue(block.above)}`,
          `below: ${cleanDirectiveValue(block.below)}`,
          `right: ${cleanDirectiveValue(block.right)}`
        );
      }
      lines.push(':::');
      return lines.join('\n');
    }
    if (block.type === 'ai') {
      return [
        ':::aihelp',
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        `repository: ${cleanDirectiveValue(block.repositoryId)}`,
        `prompt: ${cleanDirectiveValue(block.promptFile)}`,
        `point: ${block.promptPoint}`,
        `include_slide: ${block.includeSlide ? 'true' : 'false'}`,
        `include_task: ${block.includeTask ? 'true' : 'false'}`,
        `context_json: ${JSON.stringify(block.authorContext || '')}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'board') {
      return [
        ':::board',
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        `variant: ${block.variant}`,
        `path: ${cleanDirectiveValue(block.path)}`,
        `new_tab: ${block.newTab ? 'true' : 'false'}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'contact') {
      return [
        ':::contactform',
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        `internal: ${cleanDirectiveValue(block.internal)}`,
        `new_tab: ${block.newTab ? 'true' : 'false'}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'exam') {
      return [
        ':::exam',
        `repository: ${cleanDirectiveValue(block.repositoryId)}`,
        `exam: ${cleanDirectiveValue(block.examId)}`,
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        `requirement: ${block.requirement}`,
        `minimum_score: ${block.minimumScore}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'student-answer') {
      return [
        ':::studentanswer',
        `question_id: ${cleanDirectiveValue(block.questionId)}`,
        `question_json: ${JSON.stringify(block.question)}`,
        `label: ${cleanDirectiveValue(block.label)}`,
        `placeholder_json: ${JSON.stringify(block.placeholder)}`,
        `min_height: ${block.minHeight}`,
        `multiline: ${block.multiline ? 'true' : 'false'}`,
        `max_length: ${block.maxLength}`,
        `required: ${block.required ? 'true' : 'false'}`,
        `save_progress: ${block.saveToProgress ? 'true' : 'false'}`,
        `allow_edit: ${block.allowEdit ? 'true' : 'false'}`,
        `button: ${cleanDirectiveValue(block.button)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'answer-review') {
      const keyMarkdown = block.answerKeyBlocks.map(serializeBlock).join('\n\n');
      return [
        ':::answerreview',
        `question_id: ${cleanDirectiveValue(block.questionId)}`,
        `question_json: ${JSON.stringify(block.question || '')}`,
        `show_student_answer: ${block.showStudentAnswer ? 'true' : 'false'}`,
        `ai_enabled: ${block.aiEnabled ? 'true' : 'false'}`,
        `ai_instruction_json: ${JSON.stringify(block.aiInstruction || '')}`,
        `order: ${block.order}`,
        `key_json: ${JSON.stringify(keyMarkdown)}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'link') {
      return [
        ':::linkcard',
        `title: ${cleanDirectiveValue(block.title)}`,
        `description: ${cleanDirectiveValue(block.description)}`,
        `url: ${cleanDirectiveValue(safeLinkUrl(block.url))}`,
        `icon: ${block.icon}`,
        `color: ${block.color}`,
        `new_tab: ${block.newTab ? 'true' : 'false'}`,
        ':::'
      ].join('\n');
    }
    if (block.type === 'flashcards') {
      return [
        ':::flashcards',
        `title: ${cleanDirectiveValue(block.title)}`,
        `color: ${block.color}`,
        ...block.cards.map((card) => `${cleanDirectiveValue(card.front)} => ${cleanDirectiveValue(card.back)}`),
        ':::'
      ].join('\n');
    }
    if (block.type === 'style') {
      const attrs = [`font=${block.font}`];
      if (block.color) attrs.push(`color=${block.color}`);
      if (block.background) attrs.push(`background=${block.background}`);
      if (block.bold) attrs.push('bold=true');
      attrs.push(`size=${block.size}`, `align=${block.align}`);
      return `:::style ${attrs.join(' ')}\n${block.blocks.map(serializeBlock).join('\n\n')}\n:::`;
    }
    const open = block.open ? ' open=true' : '';
    return `:::accordion ${cleanInline(block.title)}${open}\n${block.blocks.map(serializeBlock).join('\n\n')}\n:::`;
  }

  function serializeBlock(input) {
    const block = createBlock(input);
    const serialized = serializeBlockCore(block);
    if (!serialized || !block.layout || block.layout.mode !== 'canvas') return serialized;
    const layout = normalizeBlockLayout(block.layout);
    return [
      `:::layout id=${cleanDirectiveValue(block.id)} x=${layout.x} y=${layout.y} width=${layout.width} height=${layout.height}`,
      serialized,
      ':::'
    ].join('\n');
  }

  function serializeTask(input) {
    const task = createTask(input);
    const lines = [':::task', `type: ${task.type}`];
    const writeText = (key, value) => { if (value) lines.push(/\n/.test(value) ? `${key}_json: ${JSON.stringify(value)}` : `${key}: ${value}`); };
    const writeList = (key, values) => lines.push(values.some((value) => /[\n|]/.test(value)) ? `${key}_json: ${JSON.stringify(values)}` : `${key}: ${values.join(' | ')}`);
    writeText('label', task.label);
    if (task.placeholder) lines.push(`placeholder: ${task.placeholder}`);
    if (task.type === 'choice' || task.type === 'abcd' || task.type === 'gaps') {
      writeList('options', task.options);
    }
    if (task.type === 'gaps' || task.type === 'gaps-text') {
      lines.push(/\n/.test(task.text) ? `text_json: ${JSON.stringify(task.text)}` : `text: ${task.text}`);
    }
    if (task.type === 'gaps-text') lines.push(`check_mode: ${task.checkMode}`);
    writeList('answer', task.answers);
    if (task.caseSensitive && (task.type === 'text' || task.type === 'gaps-text')) {
      lines.push('case_sensitive: true');
    }
    writeText('hint', task.hint);
    writeText('success', task.feedback);
    lines.push(':::');
    return lines.join('\n');
  }

  function serializeQuestion(value) {
    const question = protectStructuralLines(value);
    const needsBoundary = /\n\s*\n/.test(question)
      || /^(?:#{1,3}\s+|\s*```|\s*>\s?|\s*!\[|\s*[-*+]\s+|\s*\d+[.)]\s+)/m.test(question);
    return needsBoundary
      ? `:::question\n${question}\n:::`
      : question;
  }

  function serializeLesson(input) {
    const result = validateLesson(input);
    if (!result.valid) {
      const first = result.errors[0];
      throw new StudioLessonError(first.code, first.message, first.path);
    }
    const lesson = result.lesson;
    const slides = lesson.slides.map((slide, slideIndex) => {
      const blocks = slide.blocks.map((block) => ({ ...block }));
      if (slideIndex === 0) {
        const titleBlock = blocks.find((block) => block.type === 'heading' && block.level === 1);
        if (titleBlock) titleBlock.text = lesson.title;
        else blocks.unshift(createBlock('heading', {
          level: 1,
          text: lesson.title,
          ...(slide.layout === 'canvas'
            ? { layout: { mode: 'canvas', x: 4, y: 2, width: 92, height: 16 } }
            : {})
        }));
      }
      const parts = blocks.map(serializeBlock).filter(Boolean);
      if (slide.progressConfigured) {
        parts.unshift(`<!-- chemdisk-step:${JSON.stringify({
          id: slide.id,
          includeInLesson: slide.includeInLesson,
          requiredToAdvance: slide.requiredToAdvance,
          condition: slide.condition
        })} -->`);
      }
      if (
        slide.transition !== 'fade'
        || slide.layout === 'canvas'
        || slide.background !== 'default'
        || slide.decoration !== 'none'
        || slide.textTone !== 'auto'
      ) {
        const settings = [':::slide', `transition: ${slide.transition}`];
        if (slide.layout === 'canvas') settings.push('layout: canvas');
        if (slide.background !== 'default') settings.push(`background: ${slide.background}`);
        if (slide.background === 'custom') settings.push(`background_color: ${slide.backgroundColor}`);
        if (slide.decoration !== 'none') settings.push(`decoration: ${slide.decoration}`);
        if (slide.textTone !== 'auto') settings.push(`text_tone: ${slide.textTone}`);
        settings.push(':::');
        parts.unshift(settings.join('\n'));
      }
      if (slide.task) {
        if (slide.task.question) parts.push(serializeQuestion(slide.task.question));
        parts.push(serializeTask(slide.task));
      }
      return parts.join('\n\n').trim();
    });
    if (lesson.navigationConfigured || lesson.navigation === 'free') {
      slides[0] = `<!-- chemdisk-lesson:${JSON.stringify({ navigation: lesson.navigation })} -->\n\n${slides[0]}`;
    }
    return `${slides.join('\n\n---\n\n')}\n`;
  }

  function splitSlides(markdown) {
    const parts = [];
    let current = [];
    let inCode = false;
    let containerDepth = 0;
    for (const line of normalizeNewlines(markdown).split('\n')) {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        current.push(line);
        continue;
      }
      if (!inCode) {
        if (TASK_START.test(line) || SLIDE_SETTINGS_START.test(line) || CONTAINER_START.test(line)) containerDepth += 1;
        else if (CONTAINER_END.test(line) && containerDepth > 0) containerDepth -= 1;
        if (containerDepth === 0 && /^\s*---\s*$/.test(line)) {
          parts.push(current.join('\n').trim());
          current = [];
          continue;
        }
      }
      current.push(line);
    }
    if (current.join('\n').trim()) parts.push(current.join('\n').trim());
    return parts;
  }

  function parseTaskLines(lines) {
    const aliases = {
      options_json: 'optionsJson', answer_json: 'answerJson', label_json: 'labelJson', hint_json: 'hintJson', success_json: 'feedbackJson',
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
      success: 'feedback',
      sukces: 'feedback',
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
    lines.forEach((line) => {
      if (!line.trim() || line.trim().startsWith('#')) return;
      const match = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line);
      if (!match) {
        throw new StudioLessonError('INVALID_TASK_FIELD', 'Każdy wiersz zadania musi mieć postać „pole: wartość”.', 'task');
      }
      const key = aliases[normalizeKey(match[1])];
      if (!key) {
        throw new StudioLessonError('UNKNOWN_TASK_FIELD', `Nieznane pole zadania: ${match[1].trim()}.`, 'task');
      }
      values[key] = match[2];
    });
    for (const [field, list] of [['options', true], ['answer', true], ['label', false], ['hint', false], ['feedback', false]]) {
      if (values[`${field}Json`] === undefined) continue;
      let decoded;
      try { decoded = JSON.parse(values[`${field}Json`]); } catch (_) { /* validation below */ }
      if (list ? !Array.isArray(decoded) || decoded.some((value) => typeof value !== 'string') : typeof decoded !== 'string') {
        throw new StudioLessonError('INVALID_TASK_FIELD', `Niepoprawny zapis pola ${field}_json.`, 'task');
      }
      values[field] = decoded;
    }
    let taskText = values.text || '';
    if (values.textJson !== undefined) {
      try { taskText = JSON.parse(values.textJson); }
      catch (_) { throw new StudioLessonError('INVALID_TASK_TEXT', 'Wielowierszowy tekst zadania jest uszkodzony.', 'task.text'); }
      if (typeof taskText !== 'string') {
        throw new StudioLessonError('INVALID_TASK_TEXT', 'Wielowierszowy tekst zadania musi być tekstem.', 'task.text');
      }
    }
    const rawType = normalizeKey(values.type || 'text');
    const type = rawType === 'liczba' ? 'number'
      : rawType === 'tekst' ? 'text'
        : rawType === 'wybor' ? 'choice'
          : ['gaps_text', 'luki_tekstowe'].includes(rawType) ? 'gaps-text'
            : rawType;
    const readList = (value) => (Array.isArray(value) ? value : String(value || '').split('|')).map((item) => normalizeNewlines(item).trim()).filter(Boolean);
    const options = readList(values.options);
    const answers = readList(values.answer);
    return createTask({
      type,
      label: values.label,
      placeholder: values.placeholder,
      hint: values.hint,
      feedback: values.feedback,
      text: taskText,
      checkMode: values.checkMode,
      options,
      answers,
      answer: answers[0],
      caseSensitive: /^(?:1|true|tak|yes)$/i.test(values.caseSensitive || '')
    });
  }

  function parseStyleAttributes(value) {
    const attrs = {};
    String(value || '').split(/\s+/).forEach((part) => {
      const match = /^([a-z]+)=(\S+)$/i.exec(part);
      if (match) attrs[match[1].toLowerCase()] = match[2];
    });
    return normalizeStyle(attrs);
  }

  function parseLayoutAttributes(value) {
    const attrs = {};
    String(value || '').replace(/([a-z_]+)=([^\s]+)/gi, (_, key, rawValue) => {
      attrs[key.toLowerCase()] = rawValue;
      return '';
    });
    return {
      id: oneLine(attrs.id),
      layout: normalizeBlockLayout({
        mode: 'canvas',
        x: attrs.x,
        y: attrs.y,
        width: attrs.width,
        height: attrs.height
      })
    };
  }

  function parseDirectiveFields(lines) {
    const values = {};
    lines.forEach((line) => {
      const match = /^\s*([a-z_]+):\s*(.*?)\s*$/i.exec(line);
      if (match) values[match[1].toLowerCase()] = match[2];
    });
    return values;
  }

  function parseJsonDirectiveText(values, key, fallbackKey, maxChars, path) {
    let value = values[fallbackKey] || '';
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      try { value = JSON.parse(values[key]); }
      catch (_) {
        throw new StudioLessonError('INVALID_JSON_TEXT', `Pole ${key} zawiera uszkodzony tekst.`, path);
      }
      if (typeof value !== 'string') {
        throw new StudioLessonError('INVALID_JSON_TEXT', `Pole ${key} musi zawierać tekst.`, path);
      }
    }
    const normalized = normalizeNewlines(value).replace(/\0/g, '');
    if (normalized.length > maxChars) {
      throw new StudioLessonError('TEXT_TOO_LONG', `Pole ${key} jest zbyt długie.`, path);
    }
    return normalized.trim();
  }

  function findContainerEnd(lines, startIndex) {
    let depth = 1;
    let inCode = false;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (/^\s*```/.test(lines[index])) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      if (CONTAINER_START.test(lines[index])) depth += 1;
      else if (CONTAINER_END.test(lines[index])) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  function parseBlocks(source, allowContainers) {
    const lines = normalizeNewlines(source).split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const containerMatch = CONTAINER_START.exec(line);
      const container = containerMatch && (
        allowContainers !== false
        || !['style', 'accordion'].includes(containerMatch[1].toLowerCase())
      ) ? containerMatch : null;
      if (container) {
        const end = findContainerEnd(lines, index);
        if (end > index) {
          const type = container[1].toLowerCase();
          const bodyLines = lines.slice(index + 1, end);
          const children = type === 'layout'
            ? parseBlocks(bodyLines.join('\n'), true)
            : ['style', 'accordion'].includes(type)
              ? parseBlocks(bodyLines.join('\n'), false)
              : [];
          if (type === 'layout') {
            const child = children[0];
            if (child) {
              const positioned = parseLayoutAttributes(container[2]);
              blocks.push(createBlock({
                ...child,
                id: positioned.id || child.id,
                layout: positioned.layout
              }));
            }
          } else if (type === 'style') {
            blocks.push(createBlock({ type: 'style', ...parseStyleAttributes(container[2]), blocks: children }));
          } else if (type === 'accordion') {
            const rawTitle = oneLine(container[2]);
            blocks.push(createBlock({
              type: 'accordion',
              title: rawTitle.replace(/\s+open=true$/i, ''),
              open: /\sopen=true$/i.test(rawTitle),
              blocks: children
            }));
          } else if (type === 'image') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type,
              ref: values.ref,
              repositoryId: values.repository,
              owner: values.owner,
              alt: values.alt,
              width: values.width,
              align: values.align
            }));
          } else if (type === 'youtube') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({ type, video: values.id || values.url, title: values.title }));
          } else if (type === 'googleslides') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'slides',
              presentation: values.id || values.url,
              published: values.published,
              controls: values.controls,
              title: values.title
            }));
          } else if (type === 'googlemedia') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({ type: 'google', url: values.url || values.id, title: values.title, width: values.width, height: values.height, heightPercent: values.height_percent }));
          } else if (type === 'presentation') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'presentation',
              repositoryId: values.repository,
              presentationId: values.presentation,
              title: values.title,
              description: values.description,
              button: values.button
            }));
          } else if (type === 'quiz') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: values.study === 'true' ? 'study' : 'quiz',
              repositoryId: values.repository,
              quizId: values.quiz,
              title: values.title,
              description: values.description,
              button: values.button
            }));
          } else if (type === 'pdf') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'pdf',
              pdfId: values.id || values.url,
              protection: values.protection || values.type,
              title: values.title,
              description: values.description,
              button: values.button
            }));
          } else if (type === 'atonom') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({ type, formula: values.formula, title: values.title }));
          } else if (type === 'formula') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type,
              mode: values.mode,
              title: values.title,
              expression: values.expression,
              left: values.left,
              arrow: values.arrow,
              above: values.above,
              below: values.below,
              right: values.right
            }));
          } else if (type === 'aihelp') {
            const values = parseDirectiveFields(bodyLines);
            let authorContext = values.context || '';
            if (Object.prototype.hasOwnProperty.call(values, 'context_json')) {
              try {
                const parsedContext = JSON.parse(values.context_json);
                if (typeof parsedContext !== 'string') throw new TypeError('AI context must be text');
                authorContext = parsedContext;
              } catch (_) {
                throw new StudioLessonError(
                  'INVALID_AI_CONTEXT',
                  'Dodatkowy kontekst klocka AI jest uszkodzony.',
                  'block.authorContext'
                );
              }
            }
            if (normalizeNewlines(authorContext).trim().length > MAX_AI_AUTHOR_CONTEXT_CHARS) {
              throw new StudioLessonError(
                'AI_CONTEXT_TOO_LONG',
                `Dodatkowy kontekst klocka AI może mieć maksymalnie ${MAX_AI_AUTHOR_CONTEXT_CHARS} znaków.`,
                'block.authorContext'
              );
            }
            blocks.push(createBlock({
              type: 'ai',
              title: values.title,
              description: values.description,
              button: values.button,
              repositoryId: values.repository,
              promptFile: values.prompt,
              promptPoint: values.point,
              authorContext,
              includeSlide: values.include_slide,
              includeTask: values.include_task
            }));
          } else if (type === 'board') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'board',
              title: values.title,
              description: values.description,
              button: values.button,
              variant: values.variant,
              path: values.path,
              newTab: values.new_tab
            }));
          } else if (type === 'contactform') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'contact',
              title: values.title,
              description: values.description,
              button: values.button,
              internal: values.internal,
              newTab: values.new_tab
            }));
          } else if (type === 'exam') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'exam',
              repositoryId: values.repository,
              examId: values.exam,
              title: values.title,
              description: values.description,
              button: values.button,
              requirement: values.requirement,
              minimumScore: values.minimum_score
            }));
          } else if (type === 'studentanswer') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'student-answer',
              questionId: values.question_id,
              question: parseJsonDirectiveText(
                values,
                'question_json',
                'question',
                MAX_OPEN_QUESTION_CHARS,
                'block.question'
              ),
              label: values.label,
              placeholder: parseJsonDirectiveText(
                values,
                'placeholder_json',
                'placeholder',
                500,
                'block.placeholder'
              ),
              minHeight: values.min_height,
              multiline: values.multiline,
              maxLength: values.max_length,
              required: values.required,
              saveToProgress: values.save_progress,
              allowEdit: values.allow_edit,
              button: values.button
            }));
          } else if (type === 'answerreview') {
            const values = parseDirectiveFields(bodyLines);
            const keyMarkdown = parseJsonDirectiveText(
              values,
              'key_json',
              'key',
              MAX_ANSWER_KEY_CHARS,
              'block.answerKeyBlocks'
            );
            blocks.push(createBlock({
              type: 'answer-review',
              questionId: values.question_id,
              question: parseJsonDirectiveText(
                values,
                'question_json',
                'question',
                MAX_OPEN_QUESTION_CHARS,
                'block.question'
              ),
              showStudentAnswer: values.show_student_answer,
              aiEnabled: values.ai_enabled,
              aiInstruction: parseJsonDirectiveText(
                values,
                'ai_instruction_json',
                'ai_instruction',
                MAX_AI_REVIEW_INSTRUCTION_CHARS,
                'block.aiInstruction'
              ),
              order: values.order,
              answerKeyBlocks: keyMarkdown ? parseBlocks(keyMarkdown, true) : []
            }));
          } else if (type === 'linkcard') {
            const values = parseDirectiveFields(bodyLines);
            blocks.push(createBlock({
              type: 'link',
              title: values.title,
              description: values.description,
              url: values.url,
              icon: values.icon,
              color: values.color,
              newTab: values.new_tab
            }));
          } else if (type === 'table') {
            const values = parseDirectiveFields(bodyLines);
            const rows = bodyLines
              .map((bodyLine) => /^\s*row:\s*(.*?)\s*$/i.exec(bodyLine))
              .filter(Boolean)
              .map((match) => match[1].split('|'));
            blocks.push(createBlock({
              type: 'table',
              caption: values.caption,
              align: values.align,
              headers: String(values.headers || '').split('|'),
              rows
            }));
          } else {
            const values = parseDirectiveFields(bodyLines);
            const cards = bodyLines
              .filter((bodyLine) => !/^\s*(?:title|color):/i.test(bodyLine))
              .map((bodyLine) => bodyLine.split(/\s*=>\s*/, 2))
              .filter((parts) => parts.length === 2)
              .map(([front, back]) => ({ front, back }));
            blocks.push(createBlock({ type: 'flashcards', title: values.title, color: values.color, cards }));
          }
          index = end + 1;
          continue;
        }
      }

      const fence = /^\s*```([^\s`]*)\s*$/.exec(line);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^\s*```/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push(createBlock({ type: 'code', language: fence[1], code: code.join('\n') }));
        continue;
      }

      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        blocks.push(createBlock({ type: 'heading', level: heading[1].length, text: heading[2].trim() }));
        index += 1;
        continue;
      }

      const image = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
      if (image) {
        blocks.push(createBlock({ type: 'image', alt: image[1], url: image[2] }));
        index += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        const callout = /^\*\*(.+?):\*\*\s*(.*)$/.exec(quoteLines[0] || '');
        const title = callout ? callout[1] : '';
        const normalizedTitle = normalizeKey(title);
        const tone = /^(?:uwaga|ostrzezenie)$/.test(normalizedTitle) ? 'warning'
          : /^(?:wskazowka|podpowiedz)$/.test(normalizedTitle) ? 'tip'
            : /^(?:brawo|sukces)$/.test(normalizedTitle) ? 'success'
              : 'info';
        blocks.push(callout
          ? createBlock({ type: 'callout', tone, title, text: [callout[2], ...quoteLines.slice(1)].join('\n') })
          : createBlock({ type: 'quote', text: quoteLines.join('\n') }));
        continue;
      }

      const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (unordered || ordered) {
        const isOrdered = Boolean(ordered);
        const items = [];
        while (index < lines.length) {
          const match = isOrdered
            ? /^\s*\d+[.)]\s+(.+)$/.exec(lines[index])
            : /^\s*[-*+]\s+(.+)$/.exec(lines[index]);
          if (!match) break;
          items.push(match[1]);
          index += 1;
        }
        blocks.push(createBlock({ type: 'list', ordered: isOrdered, items }));
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (
        index < lines.length
        && lines[index].trim()
        && !/^(?:#{1,3}\s+|\s*```|\s*>\s?|\s*!\[|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[index])
        && !(
          CONTAINER_START.test(lines[index])
          && (
            allowContainers !== false
            || !/^\s*:::(?:style|accordion)\b/i.test(lines[index])
          )
        )
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push(createBlock({ type: 'text', text: paragraph.join('\n') }));
    }
    return blocks;
  }

  function parseSlide(source) {
    let stepMetadata = null;
    const cleanedSource = normalizeNewlines(source).replace(/^\s*<!--\s*chemdisk-step:(\{.*\})\s*-->\s*$/im, (match, json) => {
      try { stepMetadata = JSON.parse(json); }
      catch (_) { throw new StudioLessonError('INVALID_STEP_METADATA', 'Ustawienia postępu kroku są nieprawidłowe.', 'slide.progress'); }
      return '';
    });
    const lines = cleanedSource.split('\n');
    const content = [];
    let task = null;
    let taskLines = null;
    let taskEndedAt = -1;
    let explicitQuestion = '';
    let questionLines = null;
    let questionSeen = false;
    let slideSettingsLines = null;
    let slideSettingsSeen = false;
    let transition = 'fade';
    let layout = 'flow';
    let background = 'default';
    let backgroundColor = '#f8fafc';
    let decoration = 'none';
    let textTone = 'auto';
    let containerDepth = 0;
    let inCode = false;
    lines.forEach((line, index) => {
      if (/^\s*```/.test(line)) inCode = !inCode;
      if (
        !inCode
        && !taskLines
        && !questionLines
        && !slideSettingsLines
        && CONTAINER_START.test(line)
      ) containerDepth += 1;
      if (
        !inCode
        && !taskLines
        && !questionLines
        && !slideSettingsLines
        && CONTAINER_END.test(line)
        && containerDepth > 0
      ) containerDepth -= 1;

      if (slideSettingsLines) {
        if (CONTAINER_END.test(line)) {
          const values = parseDirectiveFields(slideSettingsLines);
          transition = SLIDE_TRANSITIONS.includes(oneLine(values.transition).toLowerCase())
            ? oneLine(values.transition).toLowerCase()
            : 'fade';
          layout = oneLine(values.layout).toLowerCase() === 'canvas' ? 'canvas' : 'flow';
          background = SLIDE_BACKGROUNDS.includes(oneLine(values.background).toLowerCase())
            ? oneLine(values.background).toLowerCase()
            : 'default';
          backgroundColor = STYLE_COLOR.test(oneLine(values.background_color))
            ? oneLine(values.background_color).toLowerCase()
            : '#f8fafc';
          decoration = SLIDE_DECORATIONS.includes(oneLine(values.decoration).toLowerCase())
            ? oneLine(values.decoration).toLowerCase()
            : 'none';
          textTone = SLIDE_TEXT_TONES.includes(oneLine(values.text_tone).toLowerCase())
            ? oneLine(values.text_tone).toLowerCase()
            : 'auto';
          slideSettingsLines = null;
        } else slideSettingsLines.push(line);
        return;
      }
      if (taskLines) {
        if (CONTAINER_END.test(line)) {
          task = parseTaskLines(taskLines);
          taskLines = null;
          taskEndedAt = index;
        } else taskLines.push(line);
        return;
      }
      if (questionLines) {
        if (CONTAINER_END.test(line)) {
          explicitQuestion = normalizeNewlines(questionLines.join('\n')).trim();
          questionLines = null;
        } else questionLines.push(line);
        return;
      }
      if (!inCode && containerDepth === 0 && QUESTION_START.test(line)) {
        if (questionSeen) {
          throw new StudioLessonError(
            'MULTIPLE_QUESTIONS',
            'Slajd może zawierać tylko jeden jawny blok pytania.',
            'task.question'
          );
        }
        questionSeen = true;
        questionLines = [];
        return;
      }
      if (!inCode && containerDepth === 0 && SLIDE_SETTINGS_START.test(line)) {
        if (slideSettingsSeen) {
          throw new StudioLessonError(
            'MULTIPLE_SLIDE_SETTINGS',
            'Slajd może zawierać tylko jeden blok ustawień przejścia.',
            'slide.transition'
          );
        }
        slideSettingsSeen = true;
        slideSettingsLines = [];
        return;
      }
      if (!inCode && containerDepth === 0 && TASK_START.test(line)) {
        if (task) {
          throw new StudioLessonError('MULTIPLE_TASKS', 'Slajd może zawierać tylko jedno zadanie.', 'task');
        }
        taskLines = [];
        return;
      }
      content.push(line);
    });
    if (taskLines) {
      throw new StudioLessonError('UNCLOSED_TASK', 'Blok zadania musi kończyć się linią :::.', 'task');
    }
    if (questionLines) {
      throw new StudioLessonError(
        'UNCLOSED_QUESTION',
        'Blok pytania musi kończyć się linią :::.',
        'task.question'
      );
    }
    if (slideSettingsLines) {
      throw new StudioLessonError(
        'UNCLOSED_SLIDE_SETTINGS',
        'Blok ustawień slajdu musi kończyć się linią :::.',
        'slide.transition'
      );
    }
    if (questionSeen && !explicitQuestion) {
      throw new StudioLessonError('EMPTY_QUESTION', 'Blok pytania nie może być pusty.', 'task.question');
    }
    if (questionSeen && !task) {
      throw new StudioLessonError(
        'QUESTION_WITHOUT_TASK',
        'Jawny blok pytania wymaga znajdującego się po nim zadania.',
        'task.question'
      );
    }

    const blocks = parseBlocks(content.join('\n'), true);
    if (task && explicitQuestion) {
      task.question = explicitQuestion;
    } else if (task && taskEndedAt === lines.length - 1) {
      const candidate = blocks[blocks.length - 1];
      const structuralQuestionTypes = new Set([
        'heading',
        'list',
        'image',
        'quote',
        'callout'
      ]);
      if (candidate && candidate.type === 'text') {
        const questionBlocks = [];
        while (blocks.length && blocks[blocks.length - 1].type === 'text') {
          questionBlocks.unshift(blocks.pop());
        }
        task.question = questionBlocks.map(serializeBlock).join('\n\n');
      } else if (candidate && structuralQuestionTypes.has(candidate.type)) {
        task.question = serializeBlock(candidate);
        blocks.pop();
      }
    }
    return createSlide({
      id: typeof stepMetadata?.id === 'string' ? stepMetadata.id : stableStepId(cleanedSource),
      blocks,
      task,
      transition,
      layout,
      background,
      backgroundColor,
      decoration,
      textTone,
      includeInLesson: stepMetadata?.includeInLesson,
      requiredToAdvance: stepMetadata?.requiredToAdvance,
      condition: stepMetadata?.condition,
      progressConfigured: Boolean(stepMetadata)
    });
  }

  function stripMarkdown(value) {
    return String(value || '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~^]/g, '')
      .trim();
  }

  function parseLesson(markdown, filename) {
    const raw = String(markdown ?? '');
    if (raw.includes('\0')) {
      throw new StudioLessonError('INVALID_LESSON', 'Plik lekcji zawiera niedozwolone znaki.', '');
    }
    let text = normalizeNewlines(raw);
    if (!text.trim()) throw new StudioLessonError('EMPTY_LESSON', 'Plik lekcji jest pusty.', '');
    if (text.length > MAX_SOURCE_CHARS) {
      throw new StudioLessonError('LESSON_TOO_LARGE', 'Plik lekcji jest zbyt duży.', '');
    }
    let lessonMetadata = null;
    text = text.replace(/^\s*<!--\s*chemdisk-lesson:(\{.*\})\s*-->\s*$/im, (match, json) => {
      try { lessonMetadata = JSON.parse(json); }
      catch (_) { throw new StudioLessonError('INVALID_LESSON_METADATA', 'Ustawienia postępu lekcji są nieprawidłowe.', 'lesson.navigation'); }
      return '';
    });
    const parts = splitSlides(text);
    if (!parts.length || parts.some((part) => !part.trim())) {
      throw new StudioLessonError('EMPTY_SLIDE', 'Lekcja zawiera pusty slajd.', 'slides');
    }
    if (parts.length > MAX_SLIDES) {
      throw new StudioLessonError('TOO_MANY_SLIDES', `Lekcja może mieć maksymalnie ${MAX_SLIDES} slajdów.`, 'slides');
    }
    const titleMatch = text.match(/^\s*#\s+(.+?)\s*$/m);
    const safeName = validateFilename(filename) || '';
    const fallback = (safeName || 'Nowa lekcja').replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
    const lesson = createLesson({
      title: titleMatch ? stripMarkdown(titleMatch[1]) : fallback,
      filename: safeName || slugify(fallback),
      navigation: lessonMetadata?.navigation === 'free' ? 'free' : 'sequential',
      navigationConfigured: Boolean(lessonMetadata),
      slides: parts.map(parseSlide)
    });
    const assignMediaOwner = (blocks) => (blocks || []).forEach((block) => {
      if (block.type === 'image' && block.ref.startsWith('photos/') && !block.owner) {
        block.owner = lesson.filename;
      }
      if (Array.isArray(block.blocks)) assignMediaOwner(block.blocks);
    });
    lesson.slides.forEach((slide) => assignMediaOwner(slide.blocks));
    return lesson;
  }

  function parseEditableLesson(markdown, filename) {
    return String(markdown ?? '').trim()
      ? parseLesson(markdown, filename)
      : createStarterLesson(filename);
  }

  const capabilities = Object.freeze({
    markdown: true,
    imagesFromHttps: true,
    tasks: Object.freeze(['text', 'number', 'choice', 'abcd', 'gaps', 'gaps-text']),
    styledContainers: true,
    youtube: true,
    googleSlides: true,
    googleMedia: true,
    presentations: true,
    quizzes: true,
    pdfs: true,
    atonom: true,
    formulas: true,
    aiHelp: true,
    interactiveBoards: true,
    contactForms: true,
    linkCards: true,
    flashcards: true,
    tables: true,
    exams: true,
    studentAnswers: true,
    answerReviews: true,
    answerReviewOrders: Object.freeze(['student-first', 'key-first']),
    canvasLayout: true,
    accordions: true,
    nestedContainers: false,
    styleFonts: STYLE_FONTS,
    styleSizes: STYLE_SIZES,
    styleAligns: STYLE_ALIGNS,
    slideTransitions: SLIDE_TRANSITIONS,
    slideBackgrounds: SLIDE_BACKGROUNDS,
    slideDecorations: SLIDE_DECORATIONS,
    slideTextTones: SLIDE_TEXT_TONES,
    styleColorFormat: '#RRGGBB',
    requiresLessonParserContainers: true
  });

  const api = {
    BLOCK_TYPES,
    MAX_AI_REVIEW_INSTRUCTION_CHARS,
    MAX_ANSWER_KEY_CHARS,
    MAX_OPEN_QUESTION_CHARS,
    MAX_STUDENT_ANSWER_CHARS,
    SCHEMA_VERSION,
    STYLE_ALIGNS,
    STYLE_FONTS,
    STYLE_SIZES,
    TABLE_ALIGNS,
    FORMULA_ARROWS,
    LINK_ICONS,
    SLIDE_TRANSITIONS,
    SLIDE_BACKGROUNDS,
    SLIDE_DECORATIONS,
    SLIDE_TEXT_TONES,
    TASK_TYPES,
    StudioLessonError,
    capabilities,
    createBlock,
    createLesson,
    createStarterLesson,
    createSlide,
    createTask,
    parseEditableLesson,
    parseLesson,
    safeChemistryText,
    safeImageUrl,
    safeLinkUrl,
    safeMathExpression,
    serializeBlock,
    serializeLesson,
    serializeTask,
    validateFilename,
    validateLesson
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemLessonStudioModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
