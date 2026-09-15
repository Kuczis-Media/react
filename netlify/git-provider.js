'use strict';

// The only server-side transport that knows the differences between Git APIs.
const { createHash } = require('node:crypto');
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const GITHUB_API_VERSION = '2026-03-10';
function error(code, status = 503) { return Object.assign(new Error(code), { code, status }); }
function providerName(env = process.env) {
  const selected = clean(env.GIT_PROVIDER).toLowerCase();
  if (selected && !['github', 'gitea'].includes(selected)) throw error('INVALID_GIT_PROVIDER');
  // Preserve old deployments; fresh installations default to Gitea.
  return selected || (clean(env.GITEA_BASE_URL) ? 'gitea' : Object.keys(env).some((key) => /^GITHUB_/.test(key) && clean(env[key])) ? 'github' : 'gitea');
}
function httpsBase(value) {
  let url;
  try { url = new URL(value); } catch { throw error('INVALID_GITEA_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw error('INVALID_GITEA_URL');
  return url.href.replace(/\/+$/, '');
}
function settings(env = process.env) {
  const provider = providerName(env);
  if (provider === 'github') return { provider, baseUrl: 'https://github.com', apiUrl: 'https://api.github.com' };
  const baseUrl = clean(env.GITEA_BASE_URL) ? httpsBase(env.GITEA_BASE_URL) : '';
  const apiUrl = clean(env.GITEA_API_URL) ? httpsBase(env.GITEA_API_URL) : baseUrl ? `${baseUrl}/api/v1` : '';
  if (apiUrl && (!baseUrl || new URL(apiUrl).origin !== new URL(baseUrl).origin)) throw error('INVALID_GITEA_URL');
  return { provider, baseUrl, apiUrl };
}
function encodedPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part))) throw error('INVALID_CONTENT_FILENAME', 400);
  return parts.map(encodeURIComponent).join('/');
}
function apiUrl(config, path = '', includeRef = true, resource = 'contents') {
  const base = config.apiUrl || (config.provider !== 'gitea' ? 'https://api.github.com' : '');
  if (!base) throw error('CONTENT_REPOSITORY_NOT_CONFIGURED');
  const suffix = resource === 'branches' ? encodeURIComponent(path) : encodedPath(path);
  const url = new URL(`${base}/repos/${encodedPath(config.repository)}${resource ? `/${resource}` : ''}${suffix ? `/${suffix}` : ''}`);
  if (includeRef && config.ref) url.searchParams.set('ref', config.ref);
  return url;
}
function rawUrl(config, path, version = config.ref, commit = false) {
  if (config.provider === 'gitea') {
    if (!config.baseUrl) throw error('CONTENT_REPOSITORY_NOT_CONFIGURED');
    return `${httpsBase(config.baseUrl)}/${encodedPath(config.repository)}/raw/${commit ? 'commit' : 'branch'}/${encodeURIComponent(version)}/${encodedPath(path)}`;
  }
  return `https://raw.githubusercontent.com/${encodedPath(config.repository)}/${encodeURIComponent(version)}/${encodedPath(path)}`;
}
function webUrl(config, suffix = '') {
  return `${config.baseUrl || 'https://github.com'}/${encodedPath(config.repository)}${suffix}`;
}
function headers(config, raw = false) {
  return {
    Accept: config.provider === 'gitea' ? 'application/json' : raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    ...(config.token ? { Authorization: `${config.provider === 'gitea' ? 'token' : 'Bearer'} ${config.token}` } : {}),
    'User-Agent': 'NextMed-content',
    ...(config.provider === 'gitea' ? {} : { 'X-GitHub-Api-Version': GITHUB_API_VERSION })
  };
}
async function request(config, url, options = {}) {
  const trusted = config.apiUrl || (config.provider !== 'gitea' ? 'https://api.github.com' : '');
  if (!trusted || new URL(url).origin !== new URL(trusted).origin) throw error('INVALID_GITEA_URL');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
  let method = options.method || 'GET';
  if (config.provider === 'gitea' && method === 'PUT' && options.body && !options.body.sha) method = 'POST';
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      method, redirect: 'error', signal: controller.signal,
      headers: { ...headers(config, options.raw), ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    if (!response.ok || !options.raw || config.provider !== 'gitea') return response;
    // Gitea contents ignores GitHub's raw Accept header. Decode its JSON and
    // expose the actual blob SHA, not a proxy/CDN ETag, to optimistic writes.
    const entry = await response.json();
    if (entry?.encoding !== 'base64' || typeof entry.content !== 'string' || entry.content.length > 16 * 1024 * 1024
      || !/^[a-f0-9]{40,64}$/i.test(entry.sha || '')) throw error('CONTENT_REPOSITORY_RESPONSE_INVALID');
    const encoded = entry.content.replace(/\s/g, '');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw error('CONTENT_REPOSITORY_RESPONSE_INVALID');
    return new Response(bytes, { headers: { 'content-length': String(bytes.length), etag: `"${entry.sha}"` } });
  } catch (cause) {
    if (cause?.code && /^CONTENT_|^INVALID_/.test(cause.code)) throw cause;
    throw error(cause?.name === 'AbortError' ? 'CONTENT_REPOSITORY_TIMEOUT' : 'CONTENT_REPOSITORY_UNAVAILABLE', cause?.name === 'AbortError' ? 504 : 503);
  } finally { clearTimeout(timeout); }
}
function cacheIdentity(config) {
  return [config.provider || 'github', config.apiUrl || '', config.repository, config.ref, config.root || '',
    createHash('sha256').update(config.token || '').digest('hex')].join(':');
}
function repositoriesEnvKey(env = process.env) { return providerName(env) === 'gitea' ? 'GITEA_CONTENT_REPOSITORIES' : 'GITHUB_CONTENT_REPOSITORIES'; }
function tokenEnv(env = process.env) { return providerName(env) === 'gitea' ? 'GITEA_TOKEN' : 'GITHUB_CONTENT_TOKEN'; }
function assertGiteaAccess(config, response) {
  if (config.provider !== 'gitea') return;
  if (response.status === 401) throw error('CONTENT_REPOSITORY_AUTH_FAILED');
  if (response.status === 403) throw error('CONTENT_REPOSITORY_FORBIDDEN');
  if (response.status === 429) throw error('CONTENT_REPOSITORY_RATE_LIMITED', 429);
}
module.exports = { providerName, settings, apiUrl, rawUrl, webUrl, headers, request, cacheIdentity, repositoriesEnvKey, tokenEnv, assertGiteaAccess, GITHUB_API_VERSION };
