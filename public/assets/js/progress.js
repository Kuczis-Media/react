(function exposeChemProgress(root) {
  'use strict';

  const PROGRESS_URL = '/.netlify/functions/progress';
  const CACHE_KEY = 'chem.progress.cache.v1';
  const MATERIAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  const pending = new Map();
  const timers = new Map();
  const batches = new Map();
  const MAX_BATCH_WAIT_MS = 15_000;
  const openedThisPage = new Set();
  let initialUrl = null;
  try { initialUrl = new URL(root.location.href); } catch (_) {}
  let serverState = null;
  let loadPromise = null;
  let accessToken = '';

  function safeJson(value) {
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function cachedState() {
    try {
      const cached = safeJson(localStorage.getItem(CACHE_KEY) || 'null');
      if (!cached || !cached.savedAt || Date.now() - cached.savedAt > 15 * 60 * 1000) return null;
      return cached.state || null;
    } catch (_) { return null; }
  }

  function saveCache(state) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), state })); } catch (_) {}
  }

  function decodePayload(jwt) {
    if (typeof jwt !== 'string') return null;
    const pieces = jwt.split('.');
    if (pieces.length < 2 || !pieces[1]) return null;
    try {
      const normalized = pieces[1].replace(/-/g, '+').replace(/_/g, '/');
      const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
      const text = typeof atob === 'function'
        ? atob(normalized + padding)
        : (typeof Buffer !== 'undefined' ? Buffer.from(normalized + padding, 'base64').toString('utf8') : null);
      return text ? JSON.parse(text) : null;
    } catch (_) {
      return null;
    }
  }

  async function token(forceRefresh = false) {
    if (forceRefresh) accessToken = '';
    if (accessToken) {
      const payload = decodePayload(accessToken);
      if (payload?.exp && payload.exp * 1000 - Date.now() < 60000) {
        accessToken = '';
      }
    }
    if (accessToken && !forceRefresh) return accessToken;
    const auth = root.ChemAuth;
    const authState = await auth?.ready;
    if (!authState?.authenticated || !authState?.session?.ok) throw new Error('AUTH_REQUIRED');
    accessToken = await auth.getAccessToken({ forceRefresh: Boolean(forceRefresh) });
    return accessToken;
  }

  async function request(method, body, query, keepalive, isRetry = false) {
    const authorization = await token(isRetry);
    const response = await fetch(`${PROGRESS_URL}${query || ''}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: Boolean(keepalive),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${authorization}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if ((response.status === 401 || response.status === 403) && !isRetry) {
      accessToken = '';
      return request(method, body, query, keepalive, true);
    }
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(payload?.error || `PROGRESS_HTTP_${response.status}`);
      error.code = payload?.error || 'PROGRESS_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function load(options = {}) {
    if (loadPromise && !options.force) return loadPromise;
    loadPromise = request('GET')
      .then((state) => {
        serverState = state;
        saveCache(state);
        root.dispatchEvent(new CustomEvent('chemdisk-progress-ready', { detail: state }));
        return state;
      })
      .catch((error) => {
        serverState = serverState || cachedState();
        root.dispatchEvent(new CustomEvent('chemdisk-progress-error', { detail: { error } }));
        if (serverState) return serverState;
        throw error;
      });
    return loadPromise;
  }

  function fnv(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function materialId(type, source, explicit) {
    const requested = String(explicit || '').trim();
    if (MATERIAL_ID.test(requested)) return requested;
    const normalizedType = String(type || 'other').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'other';
    return `${normalizedType}-${fnv(`${normalizedType}:${String(source || location.pathname)}`)}`;
  }

  function materialFromLocation(type, source) {
    let explicit = '';
    try { explicit = new URL(location.href).searchParams.get('material') || ''; } catch (_) {}
    return materialId(type, source, explicit);
  }

  function mergeObjects(previous, next) {
    const output = { ...(previous || {}), ...(next || {}) };
    if (previous?.details || next?.details) {
      output.details = { ...(previous?.details || {}), ...(next?.details || {}) };
      if (previous?.details?.lessonAnswers || next?.details?.lessonAnswers) {
        output.details.lessonAnswers = {
          ...(previous?.details?.lessonAnswers || {}),
          ...(next?.details?.lessonAnswers || {})
        };
      }
      ['visitedSlides', 'completedStepIds', 'watchedRanges'].forEach((key) => {
        if (previous?.details?.[key] || next?.details?.[key]) {
          output.details[key] = [
            ...(Array.isArray(previous?.details?.[key]) ? previous.details[key] : []),
            ...(Array.isArray(next?.details?.[key]) ? next.details[key] : [])
          ].slice(-1_000);
        }
      });
    }
    return output;
  }

  async function send(event, options = {}) {
    if (!event || !MATERIAL_ID.test(String(event.materialId || ''))) throw new Error('INVALID_MATERIAL_ID');
    const payload = await request('POST', event, '', options.keepalive);
    if (payload?.record && serverState) {
      serverState.records = serverState.records || {};
      serverState.records[event.materialId] = payload.record;
      saveCache(serverState);
      root.dispatchEvent(new CustomEvent('chemdisk-progress-updated', {
        detail: { materialId: event.materialId, record: payload.record }
      }));
    }
    return payload;
  }

  function update(event, options = {}) {
    const id = event?.materialId;
    if (!MATERIAL_ID.test(String(id || ''))) return Promise.reject(new Error('INVALID_MATERIAL_ID'));
    if (options.immediate) {
      const payload = mergeObjects(pending.get(id), event);
      pending.delete(id);
      root.clearTimeout(timers.get(id));
      timers.delete(id);
      const batch = batches.get(id);
      batches.delete(id);
      return send(payload, options).then((result) => {
        batch?.resolve(result);
        return result;
      }).catch((error) => {
        batch?.resolve(null);
        reportBackgroundError(error);
        if (options.throwOnError) throw error;
        return null;
      });
    }
    pending.set(id, mergeObjects(pending.get(id), event));
    root.clearTimeout(timers.get(id));
    if (!batches.has(id)) {
      const batch = { startedAt: Date.now() };
      batch.promise = new Promise((resolve) => { batch.resolve = resolve; });
      batches.set(id, batch);
    }
    const batch = batches.get(id);
    const delay = Math.min(Math.max(750, Number(options.debounceMs) || 5_000), Math.max(0, MAX_BATCH_WAIT_MS - (Date.now() - batch.startedAt)));
    timers.set(id, root.setTimeout(async () => {
      const payload = pending.get(id);
      pending.delete(id);
      timers.delete(id);
      batches.delete(id);
      try { batch.resolve(await send(payload)); }
      catch (error) { reportBackgroundError(error); batch.resolve(null); }
    }, delay));
    return batch.promise;
  }

  function open(options) {
    const material = options || {};
    if (openedThisPage.has(material.materialId) && material.force !== true) {
      return Promise.resolve({ saved: false, record: record(material.materialId) });
    }
    openedThisPage.add(material.materialId);
    return update({
      materialId: material.materialId,
      materialType: material.materialType || 'other',
      action: 'open',
      opened: true,
      ...(material.details ? { details: material.details } : {})
    }, { immediate: true, throwOnError: true }).then((payload) => {
      if (payload?.completion?.manualRequired && payload?.record?.status !== 'completed') {
        showSequenceCompletion(material);
      }
      return payload;
    }).catch((error) => {
      if (error?.code === 'SEQUENCE_LOCKED') {
        showSequenceLocked();
        throw error;
      }
      reportBackgroundError(error);
      return null;
    });
  }

  function showSequenceLocked() {
    const render = () => {
      if (document.getElementById('chem-sequence-lock')) return;
      document.documentElement.dataset.sequenceLocked = 'true';
      const overlay = document.createElement('section');
      overlay.id = 'chem-sequence-lock';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'chem-sequence-lock-title');
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '🔒';
      const title = document.createElement('h1');
      title.id = 'chem-sequence-lock-title';
      title.textContent = 'Ten krok jest jeszcze zablokowany';
      const copy = document.createElement('p');
      copy.textContent = 'Najpierw ukończ poprzedni moduł organizera. Potem ten krok odblokuje się automatycznie.';
      const back = document.createElement('a');
      back.href = '/members/';
      back.textContent = 'Wróć do dashboardu';
      overlay.append(icon, title, copy, back);
      const style = document.createElement('style');
      style.textContent = '#chem-sequence-lock{position:fixed;z-index:2147483647;inset:0;display:grid;place-content:center;justify-items:center;padding:24px;text-align:center;color:#182536;background:rgba(242,247,249,.98);font-family:Inter,system-ui,sans-serif}#chem-sequence-lock>span{font-size:42px}#chem-sequence-lock h1{margin:18px 0 8px;font-size:clamp(24px,5vw,38px)}#chem-sequence-lock p{max-width:540px;margin:0 0 22px;color:#5d6978;line-height:1.65}#chem-sequence-lock a{padding:12px 18px;color:#fff;background:#176b5f;border-radius:12px;font-weight:750;text-decoration:none}html[data-theme="dark"] #chem-sequence-lock{color:#eef4f7;background:rgba(10,16,23,.98)}html[data-theme="dark"] #chem-sequence-lock p{color:#aebbc8}';
      document.head.append(style);
      document.body.append(overlay);
      back.focus();
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  function showSequenceCompletion(material) {
    const render = () => {
      if (document.getElementById('chem-sequence-completion')) return;
      const panel = document.createElement('aside');
      panel.id = 'chem-sequence-completion';
      panel.setAttribute('aria-label', 'Ukończenie kroku organizera');
      const copy = document.createElement('span');
      copy.textContent = 'Po obejrzeniu slajdów zakończ ten krok, aby odblokować kolejny.';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Zakończ krok';
      panel.append(copy, button);
      const style = document.createElement('style');
      style.textContent = '#chem-sequence-completion{position:fixed;z-index:2147483000;right:18px;bottom:18px;display:flex;align-items:center;gap:14px;max-width:min(560px,calc(100vw - 36px));padding:14px 16px;color:#182536;background:#fff;border:1px solid rgba(23,107,95,.24);border-radius:14px;box-shadow:0 16px 46px rgba(22,39,52,.22);font:650 14px/1.45 Inter,system-ui,sans-serif}#chem-sequence-completion button{flex:none;padding:10px 14px;border:0;border-radius:10px;color:#fff;background:#176b5f;font:inherit;cursor:pointer}#chem-sequence-completion button:disabled{cursor:wait;opacity:.65}@media(max-width:620px){#chem-sequence-completion{left:12px;right:12px;bottom:12px;align-items:stretch;flex-direction:column}#chem-sequence-completion button{width:100%}}html[data-theme="dark"] #chem-sequence-completion{color:#eef4f7;background:#111c27;border-color:rgba(100,211,190,.32)}';
      const removeWhenComplete = (event) => {
        if (event.detail?.materialId !== material.materialId || event.detail?.record?.status !== 'completed') return;
        panel.remove();
        root.removeEventListener('chemdisk-progress-updated', removeWhenComplete);
      };
      root.addEventListener('chemdisk-progress-updated', removeWhenComplete);
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Zapisuję…';
        try {
          await send({
            materialId: material.materialId,
            materialType: material.materialType || 'presentation',
            action: 'complete'
          });
        } catch (error) {
          button.disabled = false;
          button.textContent = 'Spróbuj ponownie';
          reportBackgroundError(error);
        }
      });
      document.head.append(style);
      document.body.append(panel);
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  async function flush() {
    const jobs = [];
    pending.forEach((event, id) => {
      root.clearTimeout(timers.get(id));
      const batch = batches.get(id);
      jobs.push(send(event, { keepalive: true }).catch(reportBackgroundError).then((result) => { batch?.resolve(result); }));
    });
    pending.clear();
    timers.clear();
    batches.clear();
    await Promise.allSettled(jobs);
  }

  function reset(materialIdValue) {
    if (!MATERIAL_ID.test(String(materialIdValue || ''))) return Promise.reject(new Error('INVALID_MATERIAL_ID'));
    return request('DELETE', { materialId: materialIdValue }).then((payload) => {
      if (serverState?.records) delete serverState.records[materialIdValue];
      saveCache(serverState);
      return payload;
    });
  }

  function resetAll() {
    return request('DELETE', { scope: 'course' }).then((payload) => {
      if (serverState) serverState.records = {};
      saveCache(serverState);
      return payload;
    });
  }

  function record(materialIdValue) {
    return serverState?.records?.[materialIdValue] || null;
  }

  function statusLabel(value) {
    const status = typeof value === 'string' ? value : value?.status;
    if (status === 'completed') return 'Ukończono';
    if (status === 'in_progress') return 'W trakcie';
    if (status === 'opened') return 'Otwarto';
    return 'Nie rozpoczęto';
  }

  function percentLabel(value) {
    const percent = Math.max(0, Math.min(100, Number(value) || 0));
    if (percent === 0) return '0%';
    if (percent < 1) return '<1%';
    if (percent < 10) return `${String(Math.round(percent * 10) / 10).replace('.', ',')}%`;
    return `${Math.round(percent)}%`;
  }

  function progressView(input, options = {}) {
    const recordValue = input || null;
    const percent = Math.max(0, Math.min(100, Number(recordValue?.progressPercent) || 0));
    const wrapper = document.createElement('div');
    wrapper.className = `chem-progress${options.compact ? ' is-compact' : ''}`;
    wrapper.dataset.status = recordValue?.status || 'not_started';
    const line = document.createElement('span');
    line.className = 'chem-progress-label';
    const value = document.createElement('strong');
    value.textContent = percentLabel(percent);
    const status = document.createElement('small');
    status.textContent = statusLabel(recordValue);
    line.append(value, status);
    const track = document.createElement('span');
    track.className = 'chem-progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(percent * 10) / 10));
    const bar = document.createElement('span');
    bar.className = 'chem-progress-bar';
    bar.style.width = `${percent}%`;
    bar.style.minWidth = percent > 0 ? '3px' : '0';
    track.append(bar);
    wrapper.append(line, track);
    return wrapper;
  }

  function reportBackgroundError(error) {
    if (!['AUTH_REQUIRED', 'ACCESS_REQUIRED', 'ACCESS_EXPIRED', 'SEQUENCE_LOCKED'].includes(error?.code)) {
      console.warn('Nie udało się zsynchronizować postępu ChemDisk', error?.code || error?.message || error);
    }
    return null;
  }

  root.addEventListener('pagehide', () => { flush(); });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });
  root.addEventListener('chem-auth-user-changed', (event) => {
    accessToken = '';
    if (!event.detail?.authenticated) {
      serverState = null;
      loadPromise = null;
    }
  });

  function automaticMaterial() {
    if (!initialUrl) return null;
    const match = initialUrl.pathname.match(/^\/members\/module\/([^/]+)\/?$/i);
    if (!match || match[1].toLowerCase() === 'studio') return null;
    const moduleName = match[1].toLowerCase();
    // Exam Player i natywny Quiz Player zapisują rozpoczęcie własnym zdarzeniem,
    // które nie zalicza materiału przy samym otwarciu. Drugi automatyczny zapis
    // mógłby zawyżyć openCount albo przedwcześnie ukończyć quiz.
    if (['exam', 'quiz', 'flashcards', 'google'].includes(moduleName)) return null;
    const types = {
      lesson: 'lesson', slides: 'presentation', film: 'video', yt: 'video', pdf: 'pdf', forms: 'quiz', quiz: 'quiz',
      chat: 'script', bitpaper: 'other', whiteboard: 'other', kalkulator: 'other', classic: 'other',
      contact: 'other', atonom: 'embed'
    };
    const source = initialUrl.searchParams.get('file')
      || initialUrl.searchParams.get('quiz')
      || initialUrl.searchParams.get('id')
      || initialUrl.searchParams.get('prompt')
      || `${initialUrl.pathname}?${initialUrl.searchParams.toString()}`;
    const explicit = initialUrl.searchParams.get('material') || '';
    const type = types[moduleName] || 'other';
    return { materialId: materialId(type, source, explicit), materialType: type };
  }

  Promise.resolve(root.ChemAuth?.ready).then((authState) => {
    if (!authState?.authenticated || !authState?.session?.ok) return;
    const material = automaticMaterial();
    if (material) open(material).catch(reportBackgroundError);
  });

  root.ChemProgress = Object.freeze({
    studyRequest: (method, body, params, keepalive) => request(method, body, `?${new URLSearchParams(params)}`, keepalive),
    flush,
    load,
    materialFromLocation,
    materialId,
    open,
    progressView,
    record,
    reset,
    resetAll,
    send,
    percentLabel,
    statusLabel,
    update,
    get state() { return serverState; }
  });
})(window);
