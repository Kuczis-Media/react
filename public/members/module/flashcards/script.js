(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const node = (tag, text, cls = '') => { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
  const button = (label, action, cls = 'flashcards-action-btn') => { const e = node('button', label, cls); e.type = 'button'; e.addEventListener('click', action); return e; };
  const scheduler = root.ChemStudyScheduler, rich = root.ChemQuizFlashcards;
  const params = new URLSearchParams(root.location.search), pools = new Map(), selected = new Set();
  let ownerId, sequence = 0, active = null, data = null, cursor = null, page = 0, filter = 'all', query = '', busy = false, moreBusy = false, searchTimer, lastSelected = '';
  const PAGE_SIZE = 25;
  const status = (text) => { $('flashcards-sync-status').textContent = text || ''; };
  const key = (repo, id) => `${repo}:${id}`;
  const valid = (repo, id) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(repo) && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
  const owned = () => ownerId && ownerId === root.ChemAuth.getUser()?.id;
  function cardText(c) {
    return [c.type === 'flashcard' ? c.front.text : c.prompt, c.back?.text, ...(c.acceptedAnswers || []),
      ...(c.options || []).map((o) => o.text), ...(c.occlusion?.masks || []).filter((m) => c.activeMaskIds?.includes(m.maskId)).map((m) => `${m.name} ${m.answer}`)].filter(Boolean).join(' ');
  }
  function matches(c) {
    const r = data.client.records[c.studyKey];
    if (filter === 'learned' && !(r?.interval >= 3 && r.lastGrade >= 3)) return false;
    if (filter === 'learning' && !(r?.attempts && (r.interval < 3 || r.lastGrade === 1))) return false;
    if (['new', 'hard', 'due'].includes(filter) && !scheduler.matches(r, filter, data.client.now())) return false;
    return !query || cardText(c).toLocaleLowerCase('pl').includes(query);
  }
  function caption(c) {
    const text = c.type === 'flashcard' ? c.front.text : c.prompt;
    const masks = (c.occlusion?.masks || []).filter((m) => c.activeMaskIds?.includes(m.maskId));
    return ((text || 'Fiszka z obrazem').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ')) + (masks.length ? ` · ${masks.map((m) => m.name || `Maska ${c.occlusion.masks.indexOf(m) + 1}`).join(', ')}` : '');
  }
  function studyLink(pool, extra = {}) {
    return `/members/module/quiz/?${new URLSearchParams({ repo: pool.repositoryId, quiz: pool.deckId, study: 'all', order: $('btn-study-order-toggle').dataset.order || 'sequential', ...($('session-card-limit').value ? { limit: $('session-card-limit').value } : {}), ...(root.ChemModuleReturn?.url ? { lesson_return: root.ChemModuleReturn.url } : {}), ...extra })}`;
  }
  function addPool(pool) {
    const repo = pool.repositoryId || 'default', id = pool.deckId;
    if (!valid(repo, id)) return;
    const k = key(repo, id); pools.set(k, { ...pools.get(k), ...pool, repositoryId: repo, deckId: id, key: k });
  }
  function renderPools() {
    const search = $('pool-search-input').value.trim().toLocaleLowerCase('pl');
    $('pools-list').replaceChildren(); $('pools-count').textContent = `${pools.size} ${pools.size === 1 ? 'pula' : pools.size % 10 >= 2 && pools.size % 10 <= 4 && (pools.size % 100 < 12 || pools.size % 100 > 14) ? 'pule' : 'pul'}`;
    for (const pool of pools.values()) {
      if (search && !`${pool.title} ${pool.deckId}`.toLocaleLowerCase('pl').includes(search)) continue;
      const item = button('', () => void openPool(pool), `flashcards-pool-item${active?.key === pool.key ? ' is-active' : ''}`);
      item.setAttribute('aria-current', String(active?.key === pool.key));
      item.append(node('strong', pool.title || pool.deckId), node('small', pool.due ? `${pool.due} do powtórzenia` : 'Otwórz pulę'));
      $('pools-list').append(item);
    }
    $('pools-more').hidden = !cursor; $('pools-more').disabled = moreBusy;
  }
  async function loadMore() {
    if (moreBusy || !owned()) return;
    moreBusy = true; renderPools();
    try {
      const result = await root.ChemProgress.studyRequest('GET', null, { view: 'study-summary', ...(cursor ? { cursor } : {}) });
      if (!owned()) return;
      for (const pool of result.decks || []) addPool(pool);
      cursor = result.cursor;
    } catch (_) { status('Nie udało się wczytać kolejnych pul. Spróbuj ponownie.'); }
    finally { moreBusy = false; renderPools(); }
  }
  function clearCards() { root.MathJax?.typesetClear?.([$('cards-container')]); $('cards-container').replaceChildren(); }
  async function openPool(pool) {
    if (busy || !owned()) return;
    if (data?.client.pending) { status('Najpierw ponów zapis oczekujących zmian.'); return; }
    const current = ++sequence;
    data?.client.dispose(); data?.images.clear(); data = null; active = pool;
    selected.clear(); lastSelected = ''; page = 0; clearCards(); controls(); renderPools();
    $('active-pool-title').textContent = pool.title || pool.deckId; $('active-pool-desc').textContent = 'Wczytywanie puli…';
    $('pool-stats-strip').replaceChildren(); $('btn-study-pool').href = studyLink(pool);
    let client;
    try {
      const token = await root.ChemAuth.getAccessToken();
      const response = await root.fetch(`/.netlify/functions/quiz?${new URLSearchParams({ repo: pool.repositoryId, quiz: pool.deckId })}`, { credentials: 'same-origin', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error === 'SEQUENCE_LOCKED' ? 'Ta pula wymaga ukończenia wcześniejszych materiałów.' : 'Pula jest niedostępna lub została wyłączona.');
      const quiz = payload.quiz;
      if (quiz?.mode !== 'deck') throw new Error('Ten materiał jest zwykłym quizem. Otwórz go w module Quiz.');
      if (current !== sequence || !owned()) return;
      client = root.ChemStudyClient.connect(payload.repositoryId || pool.repositoryId, pool.deckId);
      await client.load(true);
      if (current !== sequence || !owned()) { client.dispose(); return; }
      const images = rich.imageCache((reference) => root.ChemContentLibrary.readMediaBlob({ reference, repositoryId: payload.repositoryId || pool.repositoryId,
        scope: reference.startsWith('assets/shared/') ? 'shared' : 'local', materialKind: reference.startsWith('assets/shared/') ? '' : 'quiz', materialId: reference.startsWith('assets/shared/') ? '' : pool.deckId }));
      data = { quiz, cards: scheduler.cards(quiz.questions), client, images };
      client.onStatus((s) => { if (current !== sequence) return; status(s.error || (s.pending ? `Oczekuje na zapis: ${s.pending}.` : !s.enabled ? 'Zapisywanie postępu jest wyłączone.' : '')); $('retry-save').hidden = !s.pending; });
      $('active-pool-title').textContent = quiz.metadata.title; $('active-pool-desc').textContent = quiz.metadata.description || 'Rozwiń kartę, aby zobaczyć treść. Shift + klik zaznacza zakres. Przeglądanie nie rozpoczyna nauki.';
      const url = new URL(root.location.href); url.searchParams.set('repo', pool.repositoryId); url.searchParams.set('quiz', pool.deckId); root.history.replaceState(null, '', url);
      renderCards();
    } catch (error) {
      if (current !== sequence || !owned()) return;
      client?.dispose(); $('active-pool-desc').textContent = error.message;
      $('cards-container').append(button('Spróbuj ponownie', () => void openPool(pool)));
    }
  }
  function controls() {
    const ready = Boolean(data) && !busy && owned(), pending = data?.client.pending > 0;
    $('btn-reset-selected').disabled = !ready || !data.client.canReset || ![...selected].some((id) => data.client.records[id]?.attempts) || pending;
    $('btn-reset-whole-pool').disabled = !ready || !data.client.canReset || pending;
    $('btn-study-selected').disabled = !ready || !selected.size || pending;
    $('btn-select-all').disabled = $('btn-select-page').disabled = !ready;
    $('btn-clear-selection').disabled = !ready || !selected.size;
    $('bulk-selected-label').textContent = `Zaznaczono: ${selected.size}`;
    $('btn-study-selected').textContent = `Ucz się wybranych (${selected.size})`;
    $('btn-study-pool').setAttribute('aria-disabled', String(!ready || pending));
    $('btn-study-order-toggle').disabled = !ready || pending;
    $('session-card-limit').disabled = $('session-limit-reset').disabled = !ready;
  }
  function badge(c) {
    const r = data.client.records[c.studyKey];
    if (!r?.attempts) return ['Nowa', 'new'];
    if (r.lastGrade === 1) return ['Do ponownej nauki', 'hard'];
    if (r.lastGrade === 2) return ['Trudna', 'hard'];
    if (scheduler.matches(r, 'due', data.client.now())) return ['Do powtórki', 'due'];
    return r.interval >= 3 ? ['Zapamiętana', 'learned'] : ['W nauce', 'learning'];
  }
  function detail(c) {
    if (c.type === 'image_occlusion') return root.ChemQuizOcclusion.card(c, data.images.get);
    const host = node('div', null, 'flashcards-detail-body');
    if (c.type === 'flashcard') host.append(node('h4', 'Przód'), rich.face(c.front, data.images.get), node('h4', 'Tył'), rich.face(c.back, data.images.get));
    else {
      host.append(rich.text(c.prompt, data.images.get));
      if (c.image?.ref) host.append(rich.image(c.image, data.images.get));
      for (const o of c.options || []) {
        const item = node('div', null, o.correct ? 'flashcards-correct-option' : '');
        item.append(node('span', o.correct ? '✓ Poprawna: ' : ''), rich.text(o.text, data.images.get));
        if (o.image?.ref) item.append(rich.image(o.image, data.images.get)); host.append(item);
      }
      for (const answer of c.acceptedAnswers || []) host.append(rich.text(answer, data.images.get));
    }
    if (c.explanation) host.append(node('h4', 'Wyjaśnienie'), rich.text(c.explanation, data.images.get));
    return host;
  }
  function renderCards() {
    if (!data || !owned()) return;
    clearCards();
    const totals = scheduler.stats(data.cards, data.client.records, data.client.now());
    $('pool-stats-strip').replaceChildren(...[['Razem', totals.total], ['Nowe', totals.new], ['Do powtórki', totals.due], ['Trudne', totals.hard], ['Poprawne', `${totals.correct}/${totals.attempts}`]].map(([label, value]) => node('span', `${label}: ${value}`, 'flashcards-stat-badge')));
    const filtered = data.cards.filter(matches); page = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
    $('btn-select-all').textContent = filtered.length && filtered.every((c) => selected.has(c.studyKey)) ? 'Odznacz pasujące' : `Zaznacz pasujące (${filtered.length})`;
    for (const c of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const row = node('article', null, 'flashcards-card-row'); row.dataset.cardId = c.studyKey;
      const check = node('input'); check.type = 'checkbox'; check.checked = selected.has(c.studyKey); check.disabled = busy;
      check.setAttribute('aria-label', `Zaznacz: ${caption(c)}`);
      check.addEventListener('click', (event) => {
        const from = filtered.findIndex((q) => q.studyKey === lastSelected), to = filtered.indexOf(c);
        const targets = event.shiftKey && from >= 0 ? filtered.slice(Math.min(from, to), Math.max(from, to) + 1) : [c];
        targets.forEach((q) => check.checked ? selected.add(q.studyKey) : selected.delete(q.studyKey)); lastSelected = c.studyKey;
        for (const r of $('cards-container').querySelectorAll('.flashcards-card-row')) r.querySelector('input').checked = selected.has(r.dataset.cardId);
        controls();
      });
      const details = node('details'), summary = node('summary'); const [label, cls] = badge(c);
      summary.append(node('span', caption(c), 'flashcards-row-title'), node('span', label, `flashcards-stat-badge flashcards-badge-${cls}`)); details.append(summary);
      details.addEventListener('toggle', () => {
        if (details.open && details.children.length === 1) details.append(detail(c));
        else if (!details.open && details.children.length > 1) { root.MathJax?.typesetClear?.([details]); details.lastElementChild.remove(); }
      });
      const actions = node('div', null, 'flashcards-row-actions'), learn = node('a', 'Ucz się'); learn.href = studyLink(active, { cards: c.studyKey });
      learn.addEventListener('click', (event) => { if (busy || data.client.pending) event.preventDefault(); });
      const reset = button('Resetuj', () => void resetCards([c.studyKey]), 'flashcards-card-reset-btn'); reset.disabled = busy || !data.client.canReset || !data.client.records[c.studyKey]?.attempts || data.client.pending > 0;
      actions.append(learn, reset); row.append(check, details, actions); $('cards-container').append(row);
    }
    if (!filtered.length) $('cards-container').append(node('p', 'Brak kart pasujących do filtra.', 'flashcards-empty-card'));
    const paging = node('nav', null, 'flashcards-paging'); paging.setAttribute('aria-label', 'Strony fiszek');
    const prev = button('← Poprzednie', () => { page--; renderCards(); }), next = button('Następne →', () => { page++; renderCards(); });
    prev.disabled = page === 0; next.disabled = (page + 1) * PAGE_SIZE >= filtered.length;
    paging.append(prev, node('span', `Strona ${page + 1}/${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))} · ${filtered.length} kart`), next); $('cards-container').append(paging); controls();
  }
  async function resetCards(ids) {
    if (busy || !data?.client.canReset || data.client.pending || !owned()) return;
    ids = ids.filter((id) => data.client.records[id]?.attempts);
    if (!ids.length) return;
    if (!root.confirm(`Wyzerować postęp ${ids.length} ${ids.length === 1 ? 'karty' : 'kart'}? Pozostałe karty zachowają postęp.`)) return;
    busy = true; renderCards();
    try {
      for (let offset = 0; offset < ids.length; offset += 20) { await data.client.resetCards(ids.slice(offset, offset + 20)); ids.slice(offset, offset + 20).forEach((id) => selected.delete(id)); }
      status('Zresetowano wybrane karty.');
    } catch (error) { status(error.message || 'Nie udało się zapisać resetu. Ponów zapis.'); }
    finally { busy = false; renderCards(); }
  }
  $('btn-reset-selected').addEventListener('click', () => void resetCards([...selected]));
  $('btn-reset-whole-pool').addEventListener('click', async () => {
    if (busy || !data?.client.canReset || data.client.pending || !owned() || !root.confirm('Wyzerować postęp całej puli?')) return;
    busy = true; controls();
    try { await root.ChemProgress.reset(`quiz:${active.repositoryId}:${active.deckId}`); busy = false; await openPool(active); status('Postęp puli został wyzerowany.'); }
    catch (error) { status(error.message); }
    finally { busy = false; controls(); }
  });
  $('retry-save').addEventListener('click', async () => { if (busy || !data || !owned()) return; busy = true; controls(); try { await data.client.flush(); } catch (_) {} finally { busy = false; renderCards(); } });
  $('btn-select-all').addEventListener('click', () => {
    if (!data) return; const filtered = data.cards.filter(matches), all = filtered.every((c) => selected.has(c.studyKey));
    filtered.forEach((c) => all ? selected.delete(c.studyKey) : selected.add(c.studyKey)); renderCards();
  });
  $('btn-select-page').addEventListener('click', () => { if (data) { data.cards.filter(matches).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((c) => selected.add(c.studyKey)); renderCards(); } });
  $('btn-clear-selection').addEventListener('click', () => { selected.clear(); lastSelected = ''; renderCards(); });
  $('btn-study-selected').addEventListener('click', () => {
    if (!selected.size || !owned() || busy || data.client.pending) return;
    try {
      const token = root.crypto.randomUUID();
      root.sessionStorage.setItem('chem.study.selection', JSON.stringify({ token, userId: ownerId, repo: active.repositoryId, quiz: active.deckId, expiresAt: Date.now() + 30 * 60000, cards: [...selected] }));
      root.location.assign(studyLink(active, { selection: token }));
    } catch (_) { status('Nie można zapisać wyboru kart w przeglądarce. Włącz pamięć sesji i spróbuj ponownie.'); }
  });
  $('btn-study-pool').addEventListener('click', (event) => { if (!data || busy || data.client.pending) event.preventDefault(); });
  $('btn-study-order-toggle').addEventListener('click', () => { const b = $('btn-study-order-toggle'); b.dataset.order = b.dataset.order === 'shuffle' ? 'sequential' : 'shuffle'; b.textContent = b.dataset.order === 'shuffle' ? 'Losowo' : 'Po kolei'; b.setAttribute('aria-pressed', String(b.dataset.order === 'shuffle')); if (active) $('btn-study-pool').href = studyLink(active); });
  $('session-card-limit').addEventListener('change', () => {
    const input = $('session-card-limit');
    if (input.value && (!Number.isInteger(Number(input.value)) || Number(input.value) < 1 || Number(input.value) > 10000)) { input.value = ''; status('Wpisz liczbę od 1 do 10 000; puste pole oznacza brak limitu.'); }
    if (active) $('btn-study-pool').href = studyLink(active); renderCards();
  });
  $('session-limit-reset').addEventListener('click', () => { $('session-card-limit').value = ''; if (active) $('btn-study-pool').href = studyLink(active); renderCards(); });
  $('pool-search-input').addEventListener('input', renderPools);
  $('card-search-input').addEventListener('input', () => { root.clearTimeout(searchTimer); searchTimer = root.setTimeout(() => { query = $('card-search-input').value.trim().toLocaleLowerCase('pl'); page = 0; renderCards(); }, 150); });
  $('filter-pills').addEventListener('click', (event) => { const pill = event.target.closest('[data-filter]'); if (!pill) return; filter = pill.dataset.filter; page = 0; for (const b of $('filter-pills').children) { b.classList.toggle('is-active', b === pill); b.setAttribute('aria-pressed', String(b === pill)); } renderCards(); });
  $('pools-more').addEventListener('click', () => void loadMore());
  $('theme-toggle').addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { root.localStorage.setItem('chem.theme', next); } catch (_) {} });
  root.addEventListener('chem-auth-user-changed', (event) => {
    if (event.detail?.authenticated === true && owned()) return;
    sequence++; data?.client.stop(); data?.images.clear(); data = null; pools.clear(); selected.clear(); clearCards(); $('pools-list').replaceChildren();
    $('flashcards-workspace').hidden = true; $('flashcards-error').hidden = false; $('flashcards-error-message').textContent = 'Sesja konta się zmieniła. Zaloguj się i odśwież stronę.';
  });
  async function init() {
    const auth = await window.ChemAuth.ready;
    if (!auth?.authenticated || !auth.session?.ok || !root.ChemAuth.getUser()?.id) throw new Error('Zaloguj się na konto z dostępem do kursu.');
    ownerId = root.ChemAuth.getUser().id;
    const state = await root.ChemProgress.load();
    if (!owned() || (state.userId && state.userId !== ownerId)) throw new Error('Sesja konta się zmieniła. Odśwież stronę.');
    for (const n of state.catalog?.nodes || []) if (n.type === 'quiz' && (n.settings?.quizId || n.settings?.contentFile) && state.access?.[n.id]?.allowed !== false) addPool({ repositoryId: n.settings.repositoryId, deckId: n.settings.quizId || n.settings.contentFile, title: n.title });
    await loadMore(); if (!owned()) return;
    const requested = params.get('quiz') || params.get('deck'), repo = params.get('repo') || 'default';
    if (requested) addPool({ repositoryId: repo, deckId: requested, title: pools.get(key(repo, requested))?.title || requested });
    $('flashcards-loading').hidden = true; $('flashcards-workspace').hidden = false; renderPools(); controls();
    const first = pools.get(key(repo, requested)) || pools.values().next().value;
    if (first) await openPool(first); else { $('active-pool-title').textContent = 'Brak rozpoczętych pul'; $('active-pool-desc').textContent = 'Otwórz pulę z lekcji lub kafelka kursu. Tutaj znajdziesz ją ponownie.'; }
  }
  init().catch((error) => { $('flashcards-loading').hidden = true; $('flashcards-workspace').hidden = true; $('flashcards-error').hidden = false; $('flashcards-error-message').textContent = error.message; });
})(window);
