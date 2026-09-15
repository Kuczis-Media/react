(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NextMedLandingDelivery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_TARGET = Object.freeze({ repository: 'Kuczis-Media/logo', ref: 'main', path: 'landing/config.json' });
  const ROUTE_PATH = 'landing/route.json';
  function fail(code) { const error = new Error(code); error.code = code; error.status = 400; throw error; }
  function target(value = DEFAULT_TARGET) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_LANDING_DELIVERY');
    const repository = String(value.repository || '').trim();
    const ref = String(value.ref || 'main').trim();
    const path = String(value.path || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) || repository.includes('..')) fail('INVALID_LANDING_REPOSITORY');
    if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,99}$/.test(ref) || ref.includes('..') || ref.includes('//') || ref.endsWith('/') || ref.endsWith('.lock')) fail('INVALID_LANDING_REF');
    if (path.length > 220 || !/^(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/.test(path) || path.includes('..')) fail('INVALID_LANDING_PATH');
    if (repository.toLowerCase() === DEFAULT_TARGET.repository.toLowerCase() && ref === DEFAULT_TARGET.ref && path === ROUTE_PATH) fail('LANDING_PATH_RESERVED');
    const provider = value.provider || 'github';
    if (!['github', 'gitea'].includes(provider)) fail('INVALID_LANDING_DELIVERY');
    if (provider === 'gitea') {
      let base;
      try { base = new URL(value.baseUrl); } catch { fail('INVALID_LANDING_DELIVERY'); }
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) fail('INVALID_LANDING_DELIVERY');
      return { repository, ref, path, provider, baseUrl: base.href.replace(/\/+$/, '') };
    }
    return { repository, ref, path };
  }
  function externalUrl(value, origin = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.length > 1000) fail('INVALID_EXTERNAL_LANDING_URL');
    let url;
    try { url = new URL(raw.includes('://') ? raw : `https://${raw}`); } catch { fail('INVALID_EXTERNAL_LANDING_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || (url.port && url.port !== '443')) fail('INVALID_EXTERNAL_LANDING_URL');
    if (origin && url.hostname === new URL(origin).hostname) fail('LANDING_REDIRECT_LOOP');
    return url.toString();
  }
  function normalize(value = {}, origin = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_LANDING_DELIVERY');
    if (value.version !== undefined && value.version !== 1) fail('INVALID_LANDING_DELIVERY');
    if (value.externalEnabled !== undefined && typeof value.externalEnabled !== 'boolean') fail('INVALID_LANDING_DELIVERY');
    const url = externalUrl(value.externalUrl, value.externalEnabled ? origin : '');
    if (value.externalEnabled && !url) fail('INVALID_EXTERNAL_LANDING_URL');
    return { version: 1, externalEnabled: value.externalEnabled === true, externalUrl: url, target: target(value.target || DEFAULT_TARGET) };
  }
  function rawUrl(value) {
    const checked = target(value);
    if (checked.provider === 'gitea') return `${checked.baseUrl}/${checked.repository}/raw/branch/${encodeURIComponent(checked.ref)}/${checked.path.split('/').map(encodeURIComponent).join('/')}`;
    return `https://raw.githubusercontent.com/${checked.repository}/${encodeURIComponent(checked.ref)}/${checked.path.split('/').map(encodeURIComponent).join('/')}`;
  }
  const ROUTE_URL = '/.netlify/functions/landing?source=route';
  return Object.freeze({ DEFAULT_TARGET, ROUTE_PATH, ROUTE_URL, target, externalUrl, normalize, rawUrl });
});
