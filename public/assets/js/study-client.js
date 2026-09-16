(function (root) {
  'use strict';
  const api = () => root.ChemProgress;
  const clients = new Set();
  function connect(repositoryId, deckId) {
    const ownerId = root.ChemAuth?.getUser?.()?.id;
    const query = { view: 'study', repo: repositoryId, deck: deckId };
    let records = {}, queue = [], inFlight = null, timer = null, generation = '', enabled = true, error = '', stopped = false, clockOffset = 0;
    const listeners = new Set();
    const announce = () => listeners.forEach((fn) => fn({ pending: queue.length, error, enabled }));
    const client = {
      async load() {
        const result = await api().studyRequest('GET', null, query);
        if (stopped) throw new Error('Sesja konta się zmieniła. Odśwież stronę.');
        records = result.records; generation = result.generation; enabled = result.enabled;
        if (Number.isFinite(Date.parse(result.serverNow))) clockOffset = Date.parse(result.serverNow) - Date.now();
        if (result.repositoryId) query.repo = result.repositoryId;
        return client;
      },
      get records() { return records; },
      now: () => Date.now() + clockOffset,
      get enabled() { return enabled; },
      onStatus(fn) { listeners.add(fn); announce(); return () => listeners.delete(fn); },
      rate(card, grade, answer, correct) {
        if (stopped) throw new Error('Sesja konta się zmieniła. Odśwież stronę.');
        if (queue.length >= 200) throw new Error('Zapisz oczekujące oceny przed dalszą nauką.');
        const effectiveGrade = correct === false ? 1 : grade;
        const next = root.ChemStudyScheduler.review(records[card.studyKey], effectiveGrade, client.now(), answer, correct);
        records[card.studyKey] = next;
        if (enabled) {
          queue.push({ eventId: root.crypto.randomUUID(), cardId: card.studyKey, grade: effectiveGrade, answer: answer ?? null });
          if (!timer) timer = root.setTimeout(() => { timer = null; void client.flush().catch(() => {}); }, 15000);
          if (queue.length >= 20) void client.flush().catch(() => {});
        }
        announce(); return next;
      },
      resetCard(card) {
        if (stopped) throw new Error('Sesja konta się zmieniła. Odśwież stronę.');
        delete records[card.studyKey];
        if (enabled) {
          queue.push({ eventId: root.crypto.randomUUID(), cardId: card.studyKey, action: 'reset' });
          if (!timer) timer = root.setTimeout(() => { timer = null; void client.flush().catch(() => {}); }, 5000);
          void client.flush().catch(() => {});
        }
        announce();
        return null;
      },
      async flush(keepalive = false) {
        if (inFlight) { await inFlight; if (queue.length) return client.flush(keepalive); return; }
        if (!queue.length || stopped || !enabled) return;
        root.clearTimeout(timer); timer = null;
        const batch = queue.slice(0, 20);
        inFlight = api().studyRequest('POST', { generation, reviews: batch }, query, keepalive).then((result) => {
          if (stopped) return;
          if (!result.saved) throw new Error('Zapisywanie powtórek jest wyłączone.');
          queue.splice(0, batch.length);
          for (const [id, value] of Object.entries(result.records || {})) if (!queue.some((event) => event.cardId === id)) records[id] = value;
          error = ''; announce(); root.dispatchEvent(new root.CustomEvent('nextmed-study-saved'));
        }).catch((failure) => {
          if (stopped) throw failure;
          error = failure.code === 'STUDY_RESET' ? 'Postęp został zresetowany. Odśwież stronę przed kolejną nauką.' : 'Nie zapisano ocen. Pozostań na stronie i kliknij „Ponów zapis”.';
          if (failure.code === 'STUDY_RESET') stopped = true;
          announce(); throw failure;
        }).finally(() => { inFlight = null; });
        await inFlight;
        if (queue.length) return client.flush(keepalive);
      },
      stop() { stopped = true; queue = []; records = {}; error = 'Sesja konta się zmieniła. Odśwież stronę.'; root.clearTimeout(timer); clients.delete(client); announce(); },
      accountChanged(event) { if (event.detail?.authenticated !== true || (ownerId && root.ChemAuth?.getUser?.()?.id !== ownerId)) client.stop(); },
      get pending() { return queue.length; }
    };
    clients.add(client); return client;
  }
  root.addEventListener('pagehide', () => clients.forEach((c) => void c.flush(true).catch(() => {})));
  root.document.addEventListener('visibilitychange', () => { if (root.document.hidden) clients.forEach((c) => void c.flush(true).catch(() => {})); });
  root.addEventListener('beforeunload', (event) => { if ([...clients].some((c) => c.pending)) { event.preventDefault(); event.returnValue = ''; } });
  root.addEventListener('chem-auth-user-changed', (event) => clients.forEach((c) => c.accountChanged(event)));
  root.ChemStudyClient = Object.freeze({ connect });
})(window);
