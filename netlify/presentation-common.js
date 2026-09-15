'use strict';

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_ELEMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_MEDIA_REF = /^(?:photos\/|assets\/shared\/)[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/i;
const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ELEMENT_TYPES = new Set(['text', 'heading', 'image', 'shape', 'formula', 'icon', 'table', 'button', 'code', 'embed']);
const LAYOUTS = new Set(['blank', 'title', 'title-content', 'title-image', 'text-image', 'two-columns', 'image-full', 'quote', 'table', 'question', 'section']);
const FONTS = new Set(['inter', 'roboto', 'open-sans', 'montserrat', 'poppins', 'lato', 'nunito', 'arial', 'verdana', 'lora', 'merriweather', 'playfair', 'georgia', 'times', 'jetbrains-mono', 'source-code-pro', 'mono']);

function line(value, limit = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function text(value, limit = 20000) {
  return String(value ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n').trim().slice(0, limit);
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function color(value, fallback = '') {
  const candidate = line(value, 32).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
}

function stableId(value, fallback) {
  const candidate = line(value, 128);
  return SAFE_ELEMENT_ID.test(candidate) ? candidate : fallback;
}

function safeLink(value) {
  const candidate = line(value, 500);
  if (/^(?:\/[^/]|#|mailto:)/i.test(candidate)) return candidate;
  try { const parsed = new URL(candidate); return parsed.protocol === 'https:' ? parsed.toString() : ''; }
  catch { return ''; }
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
  } catch {}
  return '';
}

function geometry(source = {}) {
  return {
    x: number(source.x, 10, 0, 100),
    y: number(source.y, 10, 0, 100),
    width: number(source.width, 40, 2, 100),
    height: number(source.height, 25, 2, 100),
    rotation: number(source.rotation, 0, -180, 180),
    z: Math.round(number(source.z, 1, 0, 999)),
    locked: source.locked === true
  };
}

function normalizeElement(value, index) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const type = ELEMENT_TYPES.has(source.type) ? source.type : 'text';
  const base = {
    elementId: stableId(source.elementId, `element-${index + 1}`),
    type,
    ...geometry(source)
  };
  if (type === 'text' || type === 'heading') {
    const font = FONTS.has(source.fontFamily) ? source.fontFamily : 'inter';
    return {
      ...base,
      content: text(source.content, 10000),
      fontFamily: font,
      fontSize: number(source.fontSize, type === 'heading' ? 44 : 32, 8, 160),
      fontWeight: Math.round(number(source.fontWeight, source.bold === true ? 800 : (type === 'heading' ? 700 : 400), 100, 900) / 100) * 100,
      color: color(source.color, '#17233a'),
      bold: source.bold === true,
      italic: source.italic === true,
      underline: source.underline === true,
      align: ['left', 'center', 'right'].includes(source.align) ? source.align : 'left',
      verticalAlign: ['top', 'center', 'bottom'].includes(source.verticalAlign) ? source.verticalAlign : 'top',
      lineHeight: number(source.lineHeight, 1.15, .8, 3),
      letterSpacing: number(source.letterSpacing, 0, -5, 20)
    };
  }
  if (type === 'image') {
    const ref = line(source.ref, 240);
    return {
      ...base,
      ref: SAFE_MEDIA_REF.test(ref) ? ref : '',
      repositoryId: SAFE_REPOSITORY_ID.test(line(source.repositoryId, 40)) ? line(source.repositoryId, 40) : '',
      alt: line(source.alt, 300) || 'Ilustracja',
      fit: source.fit === 'cover' ? 'cover' : 'contain',
      cropMode: source.cropMode === true,
      aspectLocked: source.aspectLocked !== false,
      focalX: number(source.focalX, 50, 0, 100),
      focalY: number(source.focalY, 50, 0, 100),
      borderRadius: number(source.borderRadius, 0, 0, 80),
      opacity: number(source.opacity, 1, 0, 1)
    };
  }
  if (type === 'formula') {
    return {
      ...base,
      expression: line(source.expression, 1000),
      mode: source.mode === 'math' ? 'math' : 'chemistry',
      color: color(source.color, '#17233a'),
      fontSize: number(source.fontSize, 42, 12, 140)
    };
  }
  if (type === 'icon') return {
    ...base,
    symbol: line(source.symbol, 12) || '⚗',
    color: color(source.color, '#0d7a6a'),
    background: color(source.background, '#dff4ef'),
    fontSize: number(source.fontSize, 56, 12, 180),
    borderRadius: number(source.borderRadius, 24, 0, 80)
  };
  if (type === 'table') return {
    ...base,
    headers: (Array.isArray(source.headers) ? source.headers : ['Kolumna 1', 'Kolumna 2']).map((item) => line(item, 160)).slice(0, 8),
    rows: (Array.isArray(source.rows) ? source.rows : [['Wartość', 'Wartość']]).slice(0, 20).map((row) => (Array.isArray(row) ? row : []).map((item) => line(item, 240)).slice(0, 8)),
    headerColor: color(source.headerColor, '#0d7a6a'),
    accentColor: color(source.accentColor, '#dff4ef'),
    fontSize: number(source.fontSize, 18, 8, 48)
  };
  if (type === 'button') return {
    ...base,
    label: line(source.label, 120) || 'Otwórz',
    href: safeLink(source.href),
    color: color(source.color, '#ffffff'),
    background: color(source.background, '#0d7a6a'),
    borderRadius: number(source.borderRadius, 14, 0, 80)
  };
  if (type === 'code') return {
    ...base,
    code: text(source.code, 10000),
    language: line(source.language, 24),
    color: color(source.color, '#e8eef8'),
    background: color(source.background, '#101927'),
    fontSize: number(source.fontSize, 18, 8, 48)
  };
  if (type === 'embed') return { ...base, url: safeEmbed(source.url), title: line(source.title, 180) || 'Osadzony materiał' };
  return {
    ...base,
    shape: ['rectangle', 'rounded', 'circle', 'line'].includes(source.shape) ? source.shape : 'rectangle',
    fill: color(source.fill, '#dff4ef'),
    border: color(source.border, '#0d7a6a'),
    borderWidth: number(source.borderWidth, 1, 0, 12),
    opacity: number(source.opacity, 1, 0, 1)
  };
}

function normalizeSlide(value, index) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const elements = (Array.isArray(source.elements) ? source.elements : []).slice(0, 100).map(normalizeElement);
  return {
    slideId: stableId(source.slideId, `slide-${index + 1}`),
    title: line(source.title, 180) || `Slajd ${index + 1}`,
    layout: LAYOUTS.has(source.layout) ? source.layout : 'blank',
    backgroundType: ['solid', 'gradient', 'image', 'theme'].includes(source.backgroundType) ? source.backgroundType : (source.backgroundRef ? 'image' : 'solid'),
    background: color(source.background, '#ffffff'),
    gradientFrom: color(source.gradientFrom, '#eaf7f3'),
    gradientTo: color(source.gradientTo, '#ffffff'),
    gradientAngle: number(source.gradientAngle, 135, 0, 360),
    backgroundRef: SAFE_MEDIA_REF.test(line(source.backgroundRef, 240)) ? line(source.backgroundRef, 240) : '',
    notes: text(source.notes, 5000),
    required: source.required !== false,
    elements
  };
}

function normalizeDefinition(value, requestedId = '') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const presentationId = line(source.presentationId || requestedId, 80).toLowerCase();
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
  const progress = source.progress && typeof source.progress === 'object' ? source.progress : {};
  const slides = (Array.isArray(source.slides) && source.slides.length ? source.slides : [{}]).slice(0, 300).map(normalizeSlide);
  return {
    version: 2,
    presentationId,
    metadata: {
      title: line(metadata.title, 180) || 'Nowa prezentacja',
      description: line(metadata.description, 800),
      status: metadata.status === 'published' ? 'published' : 'draft',
      tags: (Array.isArray(metadata.tags) ? metadata.tags : []).map((tag) => line(tag, 60)).filter(Boolean).slice(0, 20)
    },
    settings: {
      aspectRatio: ['16:9', '4:3'].includes(settings.aspectRatio) ? settings.aspectRatio : '16:9',
      theme: ['light', 'dark', 'chemistry', 'minimal'].includes(settings.theme) ? settings.theme : 'light',
      fontFamily: FONTS.has(settings.fontFamily) ? settings.fontFamily : 'inter',
      headingFont: FONTS.has(settings.headingFont) ? settings.headingFont : 'inter',
      bodyFont: FONTS.has(settings.bodyFont) ? settings.bodyFont : 'inter',
      showSlideNumbers: settings.showSlideNumbers !== false,
      allowFullscreen: settings.allowFullscreen !== false
    },
    progress: {
      mode: ['highest', 'visited', 'all_required'].includes(progress.mode) ? progress.mode : 'visited'
    },
    slides
  };
}

function validateDefinition(value, requestedId = '') {
  const definition = normalizeDefinition(value, requestedId);
  const errors = [];
  if (!SAFE_ID.test(definition.presentationId) || (requestedId && definition.presentationId !== requestedId)) {
    errors.push({ code: 'PRESENTATION_ID_INVALID', path: 'presentationId' });
  }
  if (!definition.slides.length) errors.push({ code: 'PRESENTATION_SLIDES_REQUIRED', path: 'slides' });
  const slideIds = new Set();
  const elementIds = new Set();
  definition.slides.forEach((slide, slideIndex) => {
    if (slideIds.has(slide.slideId)) errors.push({ code: 'PRESENTATION_SLIDE_ID_DUPLICATE', path: `slides[${slideIndex}].slideId` });
    slideIds.add(slide.slideId);
    slide.elements.forEach((element, elementIndex) => {
      if (elementIds.has(element.elementId)) errors.push({ code: 'PRESENTATION_ELEMENT_ID_DUPLICATE', path: `slides[${slideIndex}].elements[${elementIndex}].elementId` });
      elementIds.add(element.elementId);
      if (element.type === 'image' && !element.ref) errors.push({ code: 'PRESENTATION_IMAGE_INVALID', path: `slides[${slideIndex}].elements[${elementIndex}].ref` });
      if (element.type === 'embed' && !element.url) errors.push({ code: 'PRESENTATION_EMBED_INVALID', path: `slides[${slideIndex}].elements[${elementIndex}].url` });
      if (element.type === 'button' && !element.href) errors.push({ code: 'PRESENTATION_BUTTON_LINK_INVALID', path: `slides[${slideIndex}].elements[${elementIndex}].href` });
    });
  });
  return { valid: errors.length === 0, errors, definition };
}

function safeStudentDefinition(value, requestedId = '') {
  const definition = normalizeDefinition(value, requestedId);
  return definition;
}

module.exports = {
  ELEMENT_TYPES,
  SAFE_ID,
  SAFE_MEDIA_REF,
  normalizeDefinition,
  safeStudentDefinition,
  validateDefinition
};
