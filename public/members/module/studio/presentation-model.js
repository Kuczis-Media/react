(function exposePresentationModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemPresentationStudioModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPresentationModel() {
  'use strict';

  const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const SAFE_STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  const SAFE_MEDIA_REF = /^(?:photos\/|assets\/shared\/)[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/i;
  const ELEMENT_TYPES = Object.freeze(['text', 'heading', 'image', 'shape', 'formula', 'icon', 'table', 'button', 'code', 'embed', 'quiz']);
  const LAYOUTS = Object.freeze(['blank', 'title', 'title-content', 'title-image', 'text-image', 'two-columns', 'image-full', 'quote', 'table', 'question', 'section']);
  const FONTS = Object.freeze(['inter', 'roboto', 'open-sans', 'montserrat', 'poppins', 'lato', 'nunito', 'arial', 'verdana', 'lora', 'merriweather', 'playfair', 'georgia', 'times', 'jetbrains-mono', 'source-code-pro', 'mono']);
  let sequence = 0;

  function id(prefix) {
    sequence += 1;
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8) || sequence.toString(36);
    return `${prefix}-${random}`;
  }

  function line(value, limit = 500) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function clamp(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }

  function color(value, fallback) {
    const candidate = line(value, 20).toLowerCase();
    return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
  }

  function stable(value, prefix) {
    const candidate = line(value, 128);
    return SAFE_STABLE_ID.test(candidate) ? candidate : id(prefix);
  }

  function safeLink(value) {
    const candidate = line(value, 500);
    if (/^(?:\/[^/]|#|mailto:)/i.test(candidate)) return candidate;
    try { const parsed = new URL(candidate); return parsed.protocol === 'https:' ? parsed.toString() : ''; }
    catch (_) { return ''; }
  }

  function safeEmbed(value) {
    const candidate = line(value, 500);
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== 'https:') return '';
      if (['www.youtube.com', 'www.youtube-nocookie.com'].includes(host) && /^\/embed\/[A-Za-z0-9_-]{6,20}$/.test(parsed.pathname)) return parsed.toString();
      if (host === 'docs.google.com' && /^\/(?:presentation|document|spreadsheets|forms)\//.test(parsed.pathname)) return parsed.toString();
      if (host === 'drive.google.com' && /^\/file\/d\/[A-Za-z0-9_-]+\/preview$/.test(parsed.pathname)) return parsed.toString();
    } catch (_) {}
    return '';
  }

  function textElement(base, source, heading) {
    return {
      ...base,
      content: String(source.content || '').replace(/\0/g, '').slice(0, 10000),
      fontFamily: FONTS.includes(source.fontFamily) ? source.fontFamily : 'inter',
      fontSize: clamp(source.fontSize, heading ? 44 : 32, 8, 160),
      fontWeight: Math.round(clamp(source.fontWeight, source.bold === true ? 800 : (heading ? 700 : 400), 100, 900) / 100) * 100,
      color: color(source.color, '#17233a'),
      bold: source.bold === true,
      italic: source.italic === true,
      underline: source.underline === true,
      strikethrough: source.strikethrough === true,
      align: ['left', 'center', 'right', 'justify'].includes(source.align) ? source.align : 'left',
      verticalAlign: ['top', 'center', 'bottom'].includes(source.verticalAlign) ? source.verticalAlign : 'top',
      lineHeight: clamp(source.lineHeight, 1.15, .8, 3),
      letterSpacing: clamp(source.letterSpacing, 0, -5, 20)
    };
  }

  function baseElement(source, type) {
    return {
      elementId: stable(source.elementId, 'element'),
      type,
      x: clamp(source.x, 10, 0, 98),
      y: clamp(source.y, 10, 0, 98),
      width: clamp(source.width, 40, 2, 100),
      height: clamp(source.height, 25, 2, 100),
      rotation: clamp(source.rotation, 0, -180, 180),
      z: Math.round(clamp(source.z, 1, 0, 999)),
      locked: source.locked === true,
      groupId: source.groupId ? line(source.groupId, 128) : '',
      animationType: ['none', 'fade-in', 'slide-up', 'zoom-in'].includes(source.animationType) ? source.animationType : 'none',
      animationOrder: Math.round(clamp(source.animationOrder, 0, 0, 99))
    };
  }

  function createElement(typeOrSeed, maybeSeed = {}) {
    const source = typeof typeOrSeed === 'string' ? { ...maybeSeed, type: typeOrSeed } : { ...(typeOrSeed || {}) };
    const type = ELEMENT_TYPES.includes(source.type) ? source.type : 'text';
    const base = baseElement(source, type);
    if (type === 'text' || type === 'heading') return textElement(base, source, type === 'heading');
    if (type === 'image') return {
      ...base,
      ref: SAFE_MEDIA_REF.test(line(source.ref, 240)) ? line(source.ref, 240) : '',
      repositoryId: line(source.repositoryId, 40).toLowerCase(),
      alt: line(source.alt, 300) || 'Ilustracja',
      fit: source.fit === 'cover' ? 'cover' : 'contain',
      cropMode: source.cropMode === true,
      aspectLocked: source.aspectLocked !== false,
      focalX: clamp(source.focalX, 50, 0, 100),
      focalY: clamp(source.focalY, 50, 0, 100),
      borderRadius: clamp(source.borderRadius, 0, 0, 80),
      opacity: clamp(source.opacity, 1, 0, 1)
    };
    if (type === 'formula') return {
      ...base,
      expression: line(source.expression, 1000) || 'H2O',
      mode: source.mode === 'math' ? 'math' : 'chemistry',
      color: color(source.color, '#17233a'),
      fontSize: clamp(source.fontSize, 42, 12, 140)
    };
    if (type === 'icon') return {
      ...base,
      symbol: line(source.symbol, 12) || '⚗',
      color: color(source.color, '#0d7a6a'),
      background: color(source.background, '#dff4ef'),
      fontSize: clamp(source.fontSize, 56, 12, 180),
      borderRadius: clamp(source.borderRadius, 24, 0, 80)
    };
    if (type === 'table') return {
      ...base,
      headers: (Array.isArray(source.headers) ? source.headers : ['Kolumna 1', 'Kolumna 2']).map((item) => line(item, 160)).slice(0, 8),
      rows: (Array.isArray(source.rows) ? source.rows : [['Wartość', 'Wartość']]).slice(0, 20).map((row) => (Array.isArray(row) ? row : []).map((item) => line(item, 240)).slice(0, 8)),
      headerColor: color(source.headerColor, '#0d7a6a'),
      accentColor: color(source.accentColor, '#dff4ef'),
      fontSize: clamp(source.fontSize, 18, 8, 48)
    };
    if (type === 'button') return {
      ...base,
      label: line(source.label, 120) || 'Otwórz',
      href: safeLink(source.href),
      color: color(source.color, '#ffffff'),
      background: color(source.background, '#0d7a6a'),
      borderRadius: clamp(source.borderRadius, 14, 0, 80)
    };
    if (type === 'code') return {
      ...base,
      code: String(source.code || '').replace(/\0/g, '').slice(0, 10000),
      language: line(source.language, 24),
      color: color(source.color, '#e8eef8'),
      background: color(source.background, '#101927'),
      fontSize: clamp(source.fontSize, 18, 8, 48)
    };
    if (type === 'embed') return {
      ...base,
      url: safeEmbed(source.url),
      title: line(source.title, 180) || 'Osadzony materiał'
    };
    if (type === 'quiz') {
      const options = Array.isArray(source.options) && source.options.length
        ? source.options.slice(0, 6).map((opt, i) => ({
            id: opt.id || `opt-${i + 1}`,
            text: line(opt.text || opt.label, 300) || `Odpowiedź ${String.fromCharCode(65 + i)}`,
            correct: Boolean(opt.correct)
          }))
        : [
            { id: 'opt-1', text: 'Odpowiedź A', correct: true },
            { id: 'opt-2', text: 'Odpowiedź B', correct: false },
            { id: 'opt-3', text: 'Odpowiedź C', correct: false },
            { id: 'opt-4', text: 'Odpowiedź D', correct: false }
          ];
      if (!options.some((o) => o.correct) && options.length > 0) options[0].correct = true;
      return {
        ...base,
        question: line(source.question || source.content, 1000) || 'Wybierz poprawną odpowiedź:',
        options,
        explanation: line(source.explanation, 1000),
        blockNextUntilCorrect: Boolean(source.blockNextUntilCorrect ?? source.lockNext),
        fontSize: clamp(source.fontSize, 18, 12, 48),
        color: color(source.color, '#17233a'),
        background: color(source.background, '#ffffff'),
        borderColor: color(source.borderColor, '#d9e2ec'),
        borderRadius: clamp(source.borderRadius, 14, 0, 40)
      };
    }

    return {
      ...base,
      shape: ['rectangle', 'rounded', 'circle', 'line', 'arrow'].includes(source.shape) ? source.shape : 'rounded',
      fill: color(source.fill, '#dff4ef'),
      border: color(source.border, '#0d7a6a'),
      borderWidth: clamp(source.borderWidth, 1, 0, 12),
      opacity: clamp(source.opacity, 1, 0, 1)
    };
  }

  function layoutElements(layout) {
    if (layout === 'title') return [
      createElement('text', { x: 9, y: 30, width: 82, height: 25, content: 'Tytuł prezentacji', fontSize: 54, bold: true, align: 'center', verticalAlign: 'center' }),
      createElement('text', { x: 18, y: 58, width: 64, height: 12, content: 'Podtytuł', fontSize: 24, align: 'center', color: '#65728a' })
    ];
    if (layout === 'title-content') return [
      createElement('text', { x: 6, y: 6, width: 88, height: 15, content: 'Tytuł slajdu', fontSize: 36, bold: true }),
      createElement('text', { x: 8, y: 27, width: 84, height: 58, content: 'Dodaj najważniejsze informacje…', fontSize: 25, color: '#38465c' })
    ];
    if (layout === 'title-image') return [
      createElement('heading', { x: 6, y: 6, width: 88, height: 14, content: 'Tytuł slajdu', fontSize: 34 }),
      createElement('image', { x: 12, y: 25, width: 76, height: 62, alt: 'Wybierz obraz z Media Managera' })
    ];
    if (layout === 'text-image') return [
      createElement('heading', { x: 6, y: 6, width: 88, height: 14, content: 'Tytuł slajdu', fontSize: 34 }),
      createElement('text', { x: 6, y: 25, width: 42, height: 62, content: 'Treść', fontSize: 22 }),
      createElement('image', { x: 53, y: 25, width: 41, height: 62, alt: 'Wybierz obraz z Media Managera' })
    ];
    if (layout === 'two-columns') return [
      createElement('text', { x: 6, y: 6, width: 88, height: 14, content: 'Tytuł slajdu', fontSize: 34, bold: true }),
      createElement('text', { x: 6, y: 25, width: 41, height: 62, content: 'Lewa kolumna', fontSize: 23 }),
      createElement('text', { x: 53, y: 25, width: 41, height: 62, content: 'Prawa kolumna', fontSize: 23 })
    ];
    if (layout === 'section') return [
      createElement('shape', { x: 0, y: 0, width: 100, height: 100, fill: '#0d7a6a', border: '#0d7a6a', z: 0 }),
      createElement('text', { x: 10, y: 34, width: 80, height: 28, content: 'Nowy dział', fontSize: 54, bold: true, align: 'center', verticalAlign: 'center', color: '#ffffff', z: 1 })
    ];
    if (layout === 'image-full') return [createElement('image', { x: 0, y: 0, width: 100, height: 100, fit: 'cover', alt: 'Wybierz obraz z Media Managera' })];
    if (layout === 'quote') return [
      createElement('text', { x: 13, y: 23, width: 74, height: 42, content: '„Najważniejszy cytat lub definicja.”', fontFamily: 'lora', fontSize: 38, italic: true, align: 'center', verticalAlign: 'center' }),
      createElement('text', { x: 28, y: 70, width: 44, height: 9, content: 'Autor / źródło', fontSize: 17, align: 'center', color: '#65728a' })
    ];
    if (layout === 'table') return [
      createElement('heading', { x: 6, y: 5, width: 88, height: 13, content: 'Porównanie', fontSize: 32 }),
      createElement('table', { x: 7, y: 22, width: 86, height: 67 })
    ];
    if (layout === 'question') return [
      createElement('heading', { x: 8, y: 12, width: 84, height: 18, content: 'Pytanie do grupy', fontSize: 38, align: 'center' }),
      createElement('shape', { x: 12, y: 38, width: 76, height: 42, fill: '#f1f6fa', border: '#d5dfeb' }),
      createElement('text', { x: 17, y: 48, width: 66, height: 22, content: 'Zapisz odpowiedzi i omów je wspólnie.', fontSize: 24, align: 'center', verticalAlign: 'center', z: 2 })
    ];
    return [];
  }

  function createSlide(seed = {}) {
    const layout = LAYOUTS.includes(seed.layout) ? seed.layout : 'blank';
    const sourceElements = Array.isArray(seed.elements) ? seed.elements : layoutElements(layout);
    return {
      slideId: stable(seed.slideId, 'slide'),
      title: line(seed.title, 180) || 'Nowy slajd',
      layout,
      backgroundType: ['solid', 'gradient', 'image', 'theme'].includes(seed.backgroundType) ? seed.backgroundType : (seed.backgroundRef ? 'image' : 'solid'),
      background: color(seed.background, '#ffffff'),
      gradientFrom: color(seed.gradientFrom, '#eaf7f3'),
      gradientTo: color(seed.gradientTo, '#ffffff'),
      gradientAngle: clamp(seed.gradientAngle, 135, 0, 360),
      backgroundRef: SAFE_MEDIA_REF.test(line(seed.backgroundRef, 240)) ? line(seed.backgroundRef, 240) : '',
      backgroundRepositoryId: /^[a-z0-9][a-z0-9-]{0,39}$/.test(line(seed.backgroundRepositoryId, 40)) ? line(seed.backgroundRepositoryId, 40) : '',
      notes: String(seed.notes || '').replace(/\0/g, '').slice(0, 5000),
      required: seed.required !== false,
      elements: sourceElements.slice(0, 100).map(createElement)
    };
  }

  function createPresentation(seed = {}) {
    const metadata = seed.metadata || {};
    const settings = seed.settings || {};
    const progress = seed.progress || {};
    return {
      version: 2,
      presentationId: line(seed.presentationId || 'nowa-prezentacja', 80).toLowerCase(),
      metadata: {
        title: line(metadata.title, 180) || 'Nowa prezentacja',
        description: line(metadata.description, 800),
        status: metadata.status === 'published' ? 'published' : 'draft',
        tags: (Array.isArray(metadata.tags) ? metadata.tags : []).map((tag) => line(tag, 60)).filter(Boolean).slice(0, 20)
      },
      settings: {
        aspectRatio: settings.aspectRatio === '4:3' ? '4:3' : '16:9',
        theme: ['light', 'dark', 'chemistry', 'minimal'].includes(settings.theme) ? settings.theme : 'light',
        fontFamily: FONTS.includes(settings.fontFamily) ? settings.fontFamily : 'inter',
        headingFont: FONTS.includes(settings.headingFont) ? settings.headingFont : 'inter',
        bodyFont: FONTS.includes(settings.bodyFont) ? settings.bodyFont : 'inter',
        showSlideNumbers: settings.showSlideNumbers !== false,
        allowFullscreen: settings.allowFullscreen !== false
      },
      progress: { mode: ['highest', 'visited', 'all_required'].includes(progress.mode) ? progress.mode : 'visited' },
      slides: (Array.isArray(seed.slides) && seed.slides.length ? seed.slides : [createSlide({ layout: 'title', title: 'Slajd tytułowy' })]).slice(0, 300).map(createSlide)
    };
  }

  function validate(value) {
    const presentation = createPresentation(value);
    const errors = [];
    if (!SAFE_ID.test(presentation.presentationId)) errors.push({ code: 'PRESENTATION_ID_INVALID', message: 'ID może zawierać małe litery, cyfry i myślniki.' });
    const ids = new Set();
    presentation.slides.forEach((slide) => {
      if (ids.has(slide.slideId)) errors.push({ code: 'PRESENTATION_SLIDE_ID_DUPLICATE', message: `Powtórzony slideId: ${slide.slideId}` });
      ids.add(slide.slideId);
      slide.elements.forEach((element) => {
        if (ids.has(element.elementId)) errors.push({ code: 'PRESENTATION_ELEMENT_ID_DUPLICATE', message: `Powtórzony elementId: ${element.elementId}` });
        ids.add(element.elementId);
        if (element.type === 'image' && !element.ref) errors.push({ code: 'PRESENTATION_IMAGE_INVALID', message: 'Wybierz obraz z Media Managera.' });
        if (element.type === 'embed' && !element.url) errors.push({ code: 'PRESENTATION_EMBED_INVALID', message: 'Wpisz dozwolony adres osadzenia HTTPS.' });
        if (element.type === 'button' && !element.href) errors.push({ code: 'PRESENTATION_BUTTON_LINK_INVALID', message: 'Wpisz bezpieczny adres przycisku.' });
      });
    });
    return { valid: errors.length === 0, errors, presentation };
  }

  function serialize(value) {
    const result = validate(value);
    if (!result.valid) throw new Error(result.errors[0].message);
    return `${JSON.stringify(result.presentation, null, 2)}\n`;
  }

  function parse(source, presentationId = '') {
    const parsed = typeof source === 'string' ? JSON.parse(source) : source;
    const presentation = createPresentation(parsed);
    if (presentationId && presentation.presentationId !== presentationId) throw new Error('ID prezentacji nie pasuje do folderu.');
    return presentation;
  }

  function duplicateSlide(slide) {
    const copy = createSlide(JSON.parse(JSON.stringify(slide)));
    copy.slideId = id('slide');
    copy.title = `${slide.title} — kopia`;
    const groupMap = new Map();
    copy.elements.forEach((element) => {
      element.elementId = id('element');
      if (element.groupId) {
        if (!groupMap.has(element.groupId)) groupMap.set(element.groupId, id('group'));
        element.groupId = groupMap.get(element.groupId);
      }
    });
    return copy;
  }

  return Object.freeze({
    ELEMENT_TYPES,
    FONTS,
    LAYOUTS,
    SAFE_ID,
    SAFE_MEDIA_REF,
    createElement,
    createPresentation,
    createSlide,
    duplicateSlide,
    parse,
    serialize,
    validate
  });
});
