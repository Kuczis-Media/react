'use strict';

const { json, mutationGuard, parseJsonBody, requireAdmin, responseForFailure } = require('../admin-common.js');
const landing = require('../landing-content.js');
const siteAssets = require('../site-assets.js');
const deliveryModel = require('../../public/assets/js/landing-delivery-model.js');

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: { Allow: 'GET, PUT, POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
  if (!['GET', 'PUT', 'POST'].includes(method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, POST, OPTIONS' });
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);
  try {
    if (method === 'GET') {
      const [stored, remote] = await Promise.allSettled([
        Promise.resolve().then(() => landing.readEditorState(landing.getLandingStore())),
        siteAssets.readLandingRoute().then(async (route) => ({
          ...await siteAssets.readLandingConfig(process.env, { target: route.settings.target }), route
        }))
      ]);
      const control = stored.status === 'fulfilled' ? stored.value.publication : null;
      const blobActive = control?.mode === 'netlify-blobs';
      const published = blobActive ? control.model : remote.status === 'fulfilled' ? remote.value.model : null;
      const draft = stored.status === 'fulfilled' && stored.value.draftExists
        ? stored.value.draft : published || (stored.status === 'fulfilled' ? stored.value.draft : landing.defaultModel());
      return json({
        draft,
        published,
        storage: stored.status === 'fulfilled' ? { available: true } : { available: false, error: 'LANDING_STORAGE_UNAVAILABLE' },
        publication: {
          available: stored.status === 'fulfilled' || remote.status === 'fulfilled',
          mode: blobActive || remote.status !== 'fulfilled' ? 'netlify-blobs' : 'static-github',
          activeMode: control?.mode || 'static-github', version: control?.version ?? null,
          sha: remote.status === 'fulfilled' ? remote.value.sha : null,
          routeSha: remote.status === 'fulfilled' ? remote.value.route.sha : null,
          modes: { 'netlify-blobs': stored.status === 'fulfilled', 'static-github': remote.status === 'fulfilled' },
          ...(remote.status === 'rejected' ? { githubError: remote.reason?.code || 'LANDING_STATIC_PUBLISH_FAILED' } : {})
        },
        staticConfigUrl: remote.status === 'fulfilled' ? deliveryModel.rawUrl(remote.value.route.settings.target) : siteAssets.publicConfiguration().landingConfigUrl
      });
    }
    const guard = mutationGuard(event, { maxBodyBytes: 64_000 });
    if (!guard.ok) return responseForFailure(guard);
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return responseForFailure(parsed);
    const allowed = method === 'PUT' ? ['model'] : ['action', 'model', 'expectedPublishedSha', 'expectedRouteSha', 'publishMode', 'expectedPublicationVersion'];
    if (Object.keys(parsed.value).some((key) => !allowed.includes(key))) return json({ error: 'UNEXPECTED_FIELDS' }, 400);
    if (!parsed.value.model || typeof parsed.value.model !== 'object' || Array.isArray(parsed.value.model)) {
      return json({ error: 'INVALID_LANDING_MODEL' }, 400);
    }
    if (method === 'PUT') return json({ draft: await landing.saveDraft(landing.getLandingStore(), parsed.value.model, auth.userId) });
    if (parsed.value.action !== 'publish') return json({ error: 'INVALID_LANDING_ACTION' }, 400);
    const mode = parsed.value.publishMode || 'static-github';
    if (!['static-github', 'netlify-blobs'].includes(mode)) return json({ error: 'INVALID_LANDING_PUBLICATION_MODE' }, 400);
    if (mode === 'static-github' && (!Object.hasOwn(parsed.value, 'expectedPublishedSha')
      || (parsed.value.expectedPublishedSha !== null && !/^[a-f0-9]{40}$/i.test(parsed.value.expectedPublishedSha)))) {
      return json({ error: 'LANDING_PUBLICATION_REQUIRED' }, 400);
    }
    const input = landing.normalizeModel(parsed.value.model, true);
    const expectedVersion = parsed.value.expectedPublicationVersion ?? null;
    if (expectedVersion !== null && (typeof expectedVersion !== 'string' || !/^[a-f0-9-]{36}$/i.test(expectedVersion))) return json({ error: 'LANDING_PUBLICATION_REQUIRED' }, 400);
    let store = null;
    let currentDraft = null;
    let currentPublication = null;
    try { store = landing.getLandingStore(); } catch {}
    if (store) {
      // A temporary store read failure must not hide an already active Blob
      // publication behind a new GitHub write.
      currentPublication = await landing.readPublication(store);
      if (currentPublication.version !== expectedVersion) return json({ error: 'LANDING_DESTINATION_CHANGED' }, 409);
      currentDraft = await landing.readModel(store, landing.DRAFT_KEY);
    } else if (mode === 'netlify-blobs' || expectedVersion !== null) return json({ error: 'LANDING_STORAGE_UNAVAILABLE' }, 503);
    if (currentDraft?.exists && input.revision !== currentDraft.model.revision
      && landing.comparableModel(input) !== landing.comparableModel(currentDraft.model)) {
      return json({ error: 'LANDING_CONFLICT' }, 409);
    }
    if (mode === 'netlify-blobs') {
      const draft = currentDraft?.exists && input.revision !== currentDraft.model.revision
        ? currentDraft.model : await landing.saveDraft(store, input, auth.userId);
      const published = landing.normalizeModel({ ...draft, publishedAt: new Date().toISOString() }, true);
      const control = await landing.setPublication(store, { mode, model: published }, expectedVersion);
      return json({
        draft, published: landing.publicModel(published),
        delivery: { static: false, mode, url: '/.netlify/functions/landing' },
        publication: { available: true, mode, activeMode: mode, version: control.version },
        storage: { available: true }
      });
    }
    const route = await siteAssets.readLandingRoute();
    if ((parsed.value.expectedRouteSha ?? null) !== route.sha) return json({ error: 'LANDING_DESTINATION_CHANGED' }, 409);
    // GitHub is the publication source. A failure must never be reported as a
    // successful Blob publish which an older public GitHub artifact would hide.
    const result = await siteAssets.publishLandingConfig(input, process.env, { expectedSha: parsed.value.expectedPublishedSha, target: route.settings.target });
    const { model: published, ...delivery } = result;
    const control = store ? await landing.setPublication(store, { mode }, expectedVersion) : null;
    let draft = published;
    let draftWarning = '';
    if (store) {
      try {
        draft = await landing.saveDraft(store, {
          ...published,
          revision: currentDraft?.exists ? currentDraft.model.revision : input.revision
        }, auth.userId);
      } catch (error) { draftWarning = error?.code || 'LANDING_DRAFT_SYNC_FAILED'; }
    }
    return json({
      published,
      draft,
      delivery: { ...delivery, static: true },
      publication: { available: true, mode, activeMode: mode, version: control?.version ?? null, sha: delivery.sha, routeSha: route.sha },
      draftWarning,
      storage: { available: Boolean(store) && !draftWarning }
    });
  } catch (error) {
    return json({ error: error && error.code || 'LANDING_STORAGE_UNAVAILABLE' }, Number.isInteger(error && error.status) ? error.status : 503);
  }
};
