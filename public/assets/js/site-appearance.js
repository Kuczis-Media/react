(function exposeSiteAppearance(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NextMedAppearance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSiteAppearance() {
  'use strict';

  const FIELDS = Object.freeze(['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor']);
  const SCOPES = Object.freeze(['dashboard', 'studio', 'account']);
  const DEFAULT_PALETTE = Object.freeze({
    primaryColor: '#176b54', secondaryColor: '#29655d', accentColor: '#e7754b',
    backgroundColor: '#f5f4ee', surfaceColor: '#ffffff', textColor: '#182923', mutedColor: '#607169'
  });
  const plain = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const color = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
  function invalid() {
    throw Object.assign(new Error('INVALID_SITE_PALETTE'), { code: 'INVALID_SITE_PALETTE', status: 400 });
  }

  // Snapshot the old shared palette once, before editing. Each scope owns a
  // complete independent copy; changing the landing later cannot recolor it.
  function normalizePalettes(branding, strict = false) {
    const brand = plain(branding) ? branding : {};
    const raw = brand.palettes;
    if (strict && raw !== undefined && (!plain(raw) || Object.keys(raw).some((key) => !SCOPES.includes(key)))) invalid();
    return Object.fromEntries(SCOPES.map((scope) => {
      const candidate = plain(raw) && Object.hasOwn(raw, scope) ? raw[scope] : undefined;
      if (strict && candidate !== undefined && !plain(candidate)) invalid();
      const source = plain(candidate) ? candidate : {};
      const palette = Object.fromEntries(FIELDS.map((field) => {
        if (strict && Object.hasOwn(source, field) && !color(source[field])) invalid();
        return [field, color(source[field]) || color(brand[field]) || DEFAULT_PALETTE[field]];
      }));
      return [scope, palette];
    }));
  }

  function scopeForPath(pathname) {
    const path = String(pathname || '');
    if (/^\/members\/module\/studio(?:\/|$)/.test(path)) return 'studio';
    if (/^\/members(?:\/index\.html)?\/?$/.test(path)) return 'dashboard';
    if (/^\/(?:login|purchase|payment-success)(?:\/|$)/.test(path) || /^\/time(?:\.html)?\/?$/.test(path)) return 'account';
    return 'landing';
  }

  // Public readers keep supporting older JSON without palettes. Invalid CSS
  // is ignored, never interpolated; scopes never fall back to each other.
  function paletteFor(branding, scope) {
    const brand = plain(branding) ? branding : {};
    const source = SCOPES.includes(scope) && plain(brand.palettes) && plain(brand.palettes[scope]) ? brand.palettes[scope] : brand;
    return Object.fromEntries(FIELDS.filter((field) => color(source[field])).map((field) => [field, color(source[field])]));
  }

  function updatePalette(branding, scope, changes) {
    if (scope !== 'landing' && !SCOPES.includes(scope)) invalid();
    if (!plain(branding) || !plain(changes) || Object.keys(changes).some((field) => !FIELDS.includes(field) || !color(changes[field]))) invalid();
    branding.palettes = normalizePalettes(branding, true);
    const target = scope === 'landing' ? branding : branding.palettes[scope];
    for (const [field, value] of Object.entries(changes)) target[field] = color(value);
    return target;
  }

  return Object.freeze({ FIELDS, SCOPES, DEFAULT_PALETTE, normalizePalettes, scopeForPath, paletteFor, updatePalette });
});
