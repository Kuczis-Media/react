'use strict';

const { getStore } = require('@netlify/blobs');
const { randomUUID } = require('node:crypto');
const { storageConfig } = require('./progress-storage.js');
const DEFAULT_MODEL = require('../public/assets/data/landing-default.json');
const appearance = require('../public/assets/js/site-appearance.js');

const STORE_NAME = 'chemdisk-landing';
const DRAFT_KEY = 'draft.json';
const PUBLISHED_KEY = 'published.json';
const PUBLICATION_KEY = 'publication.json';
const MAX_RETRIES = 8;
const MODEL_VERSION = 3;
const SECTION_IDS = Object.freeze(['home', 'about', 'services', 'pricing', 'skills', 'contact']);
const DEFAULT_BRANDING = Object.freeze(DEFAULT_MODEL.branding);
let injectedStoreFactory = null;

function getLandingStore() {
  if (injectedStoreFactory) return injectedStoreFactory();
  const config = storageConfig();
  if (!config) throw landingError('LANDING_STORAGE_UNAVAILABLE', 503);
  return getStore({ name: STORE_NAME, siteID: config.siteId, token: config.token, consistency: 'strong' });
}

function defaultModel() {
  return structuredClone(DEFAULT_MODEL);
}

function normalizeModel(raw, strict = false) {
  if (strict && !plainObject(raw)) throw landingError('INVALID_LANDING_MODEL', 400);
  const source = plainObject(raw) ? raw : {};
  if (strict) validateModelShape(source);
  const defaults = defaultModel();
  const legacy = !Number.isSafeInteger(source.version) || source.version < MODEL_VERSION;
  const legacyBlanks = !Number.isSafeInteger(source.version) || source.version < 2;
  const byId = new Map((Array.isArray(source.sections) ? source.sections : []).filter(plainObject).map((section) => [String(section.id || ''), section]));
  const sections = SECTION_IDS.map((id, fallbackOrder) => {
    const value = byId.get(id) || {};
    const fallback = defaults.sections[fallbackOrder];
    return {
      id,
      order: Number.isSafeInteger(value.order) && value.order >= 0 ? value.order : fallbackOrder,
      enabled: value.enabled !== false,
      title: textField(value, 'title', fallback.title, 120, legacyBlanks),
      subtitle: migratedSectionText(id, value, 'subtitle', fallback.subtitle, 180, legacy, legacyBlanks),
      body: textField(value, 'body', fallback.body, 2_000, legacyBlanks),
      imageUrl: urlField(value, 'imageUrl', fallback.imageUrl, 'image', strict, legacyBlanks),
      imageAlt: textField(value, 'imageAlt', fallback.imageAlt, 180),
      backgroundColor: safeColor(value.backgroundColor, strict),
      textColor: safeColor(value.textColor, strict),
      accentColor: safeColor(value.accentColor, strict),
      ...(id === 'home' ? { heroVisual: ['image', 'biomolecule-banner'].includes(value.heroVisual) ? value.heroVisual : 'biomolecule' } : {}),
      ...(id === 'contact' ? Object.fromEntries(['formBackgroundColor', 'fieldBackgroundColor', 'fieldTextColor', 'fieldBorderColor', 'fieldFocusColor', 'labelTextColor'].map((key) => [key, safeColor(value[key], strict)])) : {}),
      ctaLabel: textField(value, 'ctaLabel', fallback.ctaLabel, 80, legacyBlanks),
      ctaHref: urlField(value, 'ctaHref', fallback.ctaHref, 'link', strict, legacyBlanks)
    };
  }).sort((left, right) => left.order - right.order).map((section, order) => ({ ...section, order }));
  if (strict) {
    const enabledIds = new Set(sections.filter((section) => section.enabled !== false).map((section) => section.id));
    for (const section of sections) {
      const target = /^#([A-Za-z][A-Za-z0-9_-]{0,79})$/.exec(section.ctaHref);
      if (section.enabled && section.ctaLabel && target && !enabledIds.has(target[1])) throw landingError('INVALID_LANDING_LINK_TARGET', 400);
    }
  }
  const branding = plainObject(source.branding) ? source.branding : {};
  const brandName = migratedBrandText(branding, 'brandName', DEFAULT_BRANDING.brandName, 120, legacy);
  if (strict && !brandName) throw landingError('INVALID_LANDING_BRAND_NAME', 400);
  return {
    version: MODEL_VERSION,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    branding: {
      brandName,
      tagline: textField(branding, 'tagline', DEFAULT_BRANDING.tagline, 180),
      logoUrl: urlField(branding, 'logoUrl', DEFAULT_BRANDING.logoUrl, 'image', strict),
      logoAlt: migratedBrandText(branding, 'logoAlt', DEFAULT_BRANDING.logoAlt, 120, legacy),
      faviconUrl: urlField(branding, 'faviconUrl', DEFAULT_BRANDING.faviconUrl, 'image', strict),
      siteTitle: migratedBrandText(branding, 'siteTitle', DEFAULT_BRANDING.siteTitle, 160, legacy),
      siteDescription: textField(branding, 'siteDescription', DEFAULT_BRANDING.siteDescription, 320),
      primaryColor: colorField(branding, 'primaryColor', DEFAULT_BRANDING.primaryColor, strict),
      secondaryColor: colorField(branding, 'secondaryColor', DEFAULT_BRANDING.secondaryColor, strict),
      accentColor: colorField(branding, 'accentColor', DEFAULT_BRANDING.accentColor, strict),
      backgroundColor: colorField(branding, 'backgroundColor', DEFAULT_BRANDING.backgroundColor, strict),
      surfaceColor: colorField(branding, 'surfaceColor', DEFAULT_BRANDING.surfaceColor, strict),
      textColor: colorField(branding, 'textColor', DEFAULT_BRANDING.textColor, strict),
      mutedColor: colorField(branding, 'mutedColor', DEFAULT_BRANDING.mutedColor, strict),
      palettes: appearance.normalizePalettes(branding, strict),
      motionEnabled: branding.motionEnabled !== false,
      companyName: migratedBrandText(branding, 'companyName', DEFAULT_BRANDING.companyName, 160, legacy),
      contactEmail: emailField(branding, 'contactEmail', DEFAULT_BRANDING.contactEmail, strict),
      contactPhone: phoneField(branding, 'contactPhone', DEFAULT_BRANDING.contactPhone, strict),
      contactAddress: textField(branding, 'contactAddress', DEFAULT_BRANDING.contactAddress, 240),
      footerText: migratedBrandText(branding, 'footerText', DEFAULT_BRANDING.footerText, 240, legacy)
    },
    sections,
    createdAt: isoOrNull(source.createdAt),
    updatedAt: isoOrNull(source.updatedAt),
    updatedBy: cleanText(source.updatedBy, 160) || null,
    publishedAt: isoOrNull(source.publishedAt)
  };
}

function validateModelShape(source) {
  if (!plainObject(source.branding) || !Array.isArray(source.sections)
    || !Number.isSafeInteger(source.version) || source.version < 1 || source.version > MODEL_VERSION
    || !Number.isSafeInteger(source.revision) || source.revision < 0 || source.revision >= Number.MAX_SAFE_INTEGER - 1) {
    throw landingError('INVALID_LANDING_MODEL', 400);
  }
  for (const [key, value] of Object.entries(source.branding)) {
    if (Object.hasOwn(DEFAULT_BRANDING, key) && typeof value !== typeof DEFAULT_BRANDING[key]) throw landingError('INVALID_LANDING_MODEL', 400);
  }
  const ids = new Set();
  for (const section of source.sections) {
    if (!plainObject(section) || !SECTION_IDS.includes(section.id) || ids.has(section.id)
      || (Object.prototype.hasOwnProperty.call(section, 'enabled') && typeof section.enabled !== 'boolean')
      || (Object.prototype.hasOwnProperty.call(section, 'order') && (!Number.isSafeInteger(section.order) || section.order < 0))) {
      throw landingError('INVALID_LANDING_MODEL', 400);
    }
    ids.add(section.id);
    if (section.id === 'home' && Object.hasOwn(section, 'heroVisual') && !['biomolecule', 'biomolecule-banner', 'image'].includes(section.heroVisual)) throw landingError('INVALID_LANDING_MODEL', 400);
    if (section.id === 'contact') {
      for (const key of ['formBackgroundColor', 'fieldBackgroundColor', 'fieldTextColor', 'fieldBorderColor', 'fieldFocusColor', 'labelTextColor']) {
        if (Object.hasOwn(section, key) && typeof section[key] !== 'string') throw landingError('INVALID_LANDING_MODEL', 400);
      }
    }
    for (const [key, value] of Object.entries(section)) {
      if (Object.hasOwn(DEFAULT_MODEL.sections[0], key) && typeof value !== typeof DEFAULT_MODEL.sections[0][key]) throw landingError('INVALID_LANDING_MODEL', 400);
    }
  }
  if (ids.size !== SECTION_IDS.length) throw landingError('INVALID_LANDING_MODEL', 400);
}

async function readModel(store, key) {
  const entry = await readEntry(store, key);
  return { model: normalizeModel(entry && entry.value), exists: Boolean(entry), etag: entry && entry.etag || null };
}

async function readEditorState(store) {
  const [draft, published, publication] = await Promise.all([readModel(store, DRAFT_KEY), readModel(store, PUBLISHED_KEY), readPublication(store)]);
  return {
    draft: draft.exists ? draft.model : published.exists ? published.model : defaultModel(),
    draftExists: draft.exists,
    published: published.exists ? published.model : null,
    publication
  };
}

// One conditional write changes the active delivery mode and its public model
// together. Historical published.json files never silently override GitHub.
async function readPublication(store) {
  const entry = await readEntry(store, PUBLICATION_KEY);
  if (!entry) return { mode: 'static-github', version: null, model: null };
  const value = entry.value;
  if (!plainObject(value) || !['static-github', 'netlify-blobs'].includes(value.mode)
    || typeof value.version !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.version)) throw landingError('LANDING_STORAGE_INVALID', 503);
  return {
    mode: value.mode, version: value.version,
    model: value.mode === 'netlify-blobs' ? normalizeModel(value.model, true) : null
  };
}

async function setPublication(store, { mode, model }, expectedVersion) {
  if (!['static-github', 'netlify-blobs'].includes(mode)) throw landingError('INVALID_LANDING_PUBLICATION_MODE', 400);
  const current = await readEntry(store, PUBLICATION_KEY);
  if ((current?.value?.version ?? null) !== expectedVersion) throw landingError('LANDING_DESTINATION_CHANGED', 409);
  const next = { mode, version: randomUUID(), ...(mode === 'netlify-blobs' ? { model: normalizeModel(model, true) } : {}) };
  const result = await store.set(PUBLICATION_KEY, JSON.stringify(next), {
    ...(current ? { onlyIfMatch: current.etag } : { onlyIfNew: true }),
    metadata: { mode, version: next.version }
  });
  if (result?.modified !== true) throw landingError('LANDING_DESTINATION_CHANGED', 409);
  return { ...next, model: next.model || null };
}

async function saveDraft(store, raw, adminId) {
  const input = normalizeModel(raw, true);
  const current = await readEntry(store, DRAFT_KEY);
  const previous = normalizeModel(current && current.value);
  if (current && input.revision !== previous.revision) throw landingError('LANDING_CONFLICT', 409);
  const now = new Date().toISOString();
  const next = normalizeModel({
    ...input,
    revision: current ? previous.revision + 1 : input.revision + 1,
    createdAt: previous.createdAt || input.createdAt || now,
    updatedAt: now,
    updatedBy: cleanText(adminId, 160) || null,
    publishedAt: input.publishedAt
  });
  const result = await store.set(DRAFT_KEY, JSON.stringify(next), {
    ...(current ? { onlyIfMatch: current.etag } : { onlyIfNew: true }),
    metadata: { revision: String(next.revision), updatedAt: now, published: 'false' }
  });
  if (!result || result.modified !== true) throw landingError('LANDING_CONFLICT', 409);
  return next;
}

async function publish(store, raw, adminId) {
  const input = normalizeModel(raw, true);
  const current = await readModel(store, DRAFT_KEY);
  const retryDraft = current.exists
    && current.model.revision === input.revision + 1
    && comparableModel(current.model) === comparableModel(input);
  const draft = retryDraft ? current.model : await saveDraft(store, input, adminId);
  return writePublishedModel(store, draft, adminId);
}

function comparableModel(model) {
  const normalized = normalizeModel(model);
  return JSON.stringify({ branding: normalized.branding, sections: normalized.sections });
}

async function writePublishedModel(store, input, adminId) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const current = await readEntry(store, PUBLISHED_KEY);
    const previous = normalizeModel(current && current.value);
    if (current && previous.revision > input.revision) throw landingError('LANDING_CONFLICT', 409);
    const now = new Date().toISOString();
    const next = normalizeModel({
      ...input,
      revision: input.revision,
      createdAt: previous.createdAt || input.createdAt || now,
      updatedAt: now,
      updatedBy: cleanText(adminId, 160) || null,
      publishedAt: now
    });
    const result = await store.set(PUBLISHED_KEY, JSON.stringify(next), {
      ...(current ? { onlyIfMatch: current.etag } : { onlyIfNew: true }),
      metadata: { revision: String(next.revision), updatedAt: now, published: 'true' }
    });
    if (result && result.modified === true) return next;
  }
  throw landingError('LANDING_CONFLICT', 409);
}

async function readEntry(store, key) {
  const entry = await store.getWithMetadata(key, { type: 'text', consistency: 'strong' });
  if (!entry) return null;
  if (typeof entry.data !== 'string' || !entry.etag) throw landingError('LANDING_STORAGE_INVALID', 503);
  try { return { value: JSON.parse(entry.data), etag: entry.etag }; }
  catch { throw landingError('LANDING_STORAGE_INVALID', 503); }
}

function safeUrl(value, kind, strict) {
  if (typeof value === 'string' && /[\\\u0000-\u001f\u007f]/.test(value)) {
    if (strict) throw landingError(kind === 'image' ? 'INVALID_LANDING_IMAGE_URL' : 'INVALID_LANDING_LINK', 400);
    return '';
  }
  const raw = cleanText(value, 1_000);
  if (!raw) return '';
  if (kind === 'link' && /^#[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(raw)) return raw;
  if (/^\/(?!\/)[^\s\\]*$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password) return kind === 'image' ? normalizeGitHubImageUrl(url) : url.toString();
  } catch {}
  if (strict) throw landingError(kind === 'image' ? 'INVALID_LANDING_IMAGE_URL' : 'INVALID_LANDING_LINK', 400);
  return '';
}

function normalizeGitHubImageUrl(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'github.com' && parts.length >= 5 && parts[2] === 'blob') {
    const [owner, repository, , ref, ...path] = parts;
    if (owner && repository && ref && path.length) {
      return `https://cdn.jsdelivr.net/gh/${owner}/${repository}@${ref}/${path.join('/')}`;
    }
  }
  if (url.hostname === 'raw.githubusercontent.com' && parts.length >= 4) {
    const [owner, repository, ref, ...path] = parts;
    if (owner && repository && ref && path.length) {
      return `https://cdn.jsdelivr.net/gh/${owner}/${repository}@${ref}/${path.join('/')}`;
    }
  }
  return url.toString();
}

function textField(source, key, fallback, max, legacyFallback = false) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  const value = cleanText(source[key], max);
  return legacyFallback && !value ? fallback : value;
}

function migratedBrandText(source, key, fallback, max, legacy) {
  const value = textField(source, key, fallback, max);
  if (!legacy) return value;
  const oldDefaults = {
    brandName: 'ChemDisk',
    logoAlt: 'ChemDisk',
    siteTitle: 'ChemDisk — kursy maturalne online',
    companyName: 'Kursy Maturalne',
    footerText: 'Kursy Maturalne · kursy maturalne'
  };
  return !Object.prototype.hasOwnProperty.call(source, key) || value === oldDefaults[key] ? fallback : value;
}

function migratedSectionText(sectionId, source, key, fallback, max, legacy, legacyBlanks) {
  const value = textField(source, key, fallback, max, legacyBlanks);
  if (legacy && sectionId === 'home' && key === 'subtitle' && value === 'Witaj w ChemDisk') return fallback;
  return value;
}

function urlField(source, key, fallback, kind, strict, legacyFallback = false) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  const value = safeUrl(source[key], kind, strict);
  return legacyFallback && !value ? fallback : value;
}

function safeColor(value, strict) {
  const color = cleanText(value, 20);
  if (!color) return '';
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) return color.toLowerCase();
  if (strict) throw landingError('INVALID_LANDING_COLOR', 400);
  return '';
}

function colorField(source, key, fallback, strict) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  return safeColor(source[key], strict) || fallback;
}

function emailField(source, key, fallback, strict) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  const email = cleanText(source[key], 254);
  if (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  if (strict) throw landingError('INVALID_LANDING_EMAIL', 400);
  return fallback;
}

function phoneField(source, key, fallback, strict) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  const phone = cleanText(source[key], 40);
  if (!phone || /^\+?[0-9 ()-]{5,40}$/.test(phone)) return phone;
  if (strict) throw landingError('INVALID_LANDING_PHONE', 400);
  return fallback;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

function isoOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function plainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function publicModel(raw) {
  const model = normalizeModel(raw);
  return { version: model.version, revision: model.revision, branding: model.branding, sections: model.sections, publishedAt: model.publishedAt };
}

function landingError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

module.exports = {
  DRAFT_KEY,
  MODEL_VERSION,
  PUBLISHED_KEY,
  PUBLICATION_KEY,
  SECTION_IDS,
  STORE_NAME,
  defaultModel,
  comparableModel,
  getLandingStore,
  normalizeModel,
  publish,
  publicModel,
  readEditorState,
  readPublication,
  readModel,
  saveDraft,
  setPublication,
  _test: {
    resetStoreFactory() { injectedStoreFactory = null; },
    setStoreFactory(factory) { injectedStoreFactory = typeof factory === 'function' ? factory : null; }
  }
};
