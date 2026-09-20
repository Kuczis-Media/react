(function (root) {
  'use strict';
  const api = () => root.ChemProgress;
  const clients = new Set();
  function connect(repositoryId, deckId) {
    const ownerId = root.ChemAuth?.getUser?.()?.id;
    const query = { view: 'study', repo: repositoryId, deck: deckId };
    let records = Object.create(null), resetVersions = Object.create(null), queue = [], inFlight = null, timer = null, generation = '', enabled = true, error = '', stopped = false, clockOffset = 0;
    const listeners = new Set();
    const announce = () => listeners.forEach((fn) => fn({ pending: queue.length, error, enabled }));
    const client = {
      async load(inspect = false) {
        const result = await api().studyRequest('GET', null, { ...query, ...(inspect ? { inspect: '1' } : {}) });
        if (stopped) throw new Error('Sesja konta się zmieniła. Odśwież stronę.');
        records = Object.assign(Object.create(null), result.records); resetVersions = Object.assign(Object.create(null), result.resetVersions); generation = result.generation; enabled = result.enabled;
        if (Number.isFinite(Date.parse(result.serverNow))) clockOffset = Date.parse(result.serverNow) - Date.now();
        if (result.repositoryId) query.repo = result.repositoryId;
        return client;
      },
      get records() { return records; },
      now: () => Date.now() + clockOffset,
      get enabled() { return enabled; },
      get canReset() { return enabled && Boolean(generation) && !stopped; },
      onStatus(fn) { listeners.add(fn); announce(); return () => listeners.delete(fn); },
      rate(card, grade, answer, correct) {
        if (stopped) throw new Error('Sesja konta się zmieniła. Odśwież stronę.');
        if (queue.length >= 200) throw new Error('Zapisz oczekujące oceny przed dalszą nauką.');
        const effectiveGrade = correct === false ? 1 : grade;
        const next = root.ChemStudyScheduler.review(records[card.studyKey], effectiveGrade, client.now(), answer, correct);
        records[card.studyKey] = next;
        if (enabled) {
          queue.push({ eventId: root.crypto.randomUUID(), cardId: card.studyKey, resetVersion: resetVersions[card.studyKey] || 0, grade: effectiveGrade, answer: answer ?? null });
          if (!timer) timer = root.setTimeout(() => { timer = null; void client.flush().catch(() => {}); }, 15000);
          if (queue.length >= 20) void client.flush().catch(() => {});
        }
        announce(); return next;
      },
      resetCard(card) { return client.resetCards([card.studyKey]); },
      resetCards(ids) {
        if (stopped) throw new Error('Sesja konta się zmieniła. Odśwież stronę.');
        if (!client.canReset) throw new Error('Ta pula nie ma zapisanego postępu lub zapis jest wyłączony.');
        const unique = [...new Set(ids)];
        if (!unique.length || unique.length > 200 || queue.length + unique.length > 200) throw new Error('Zapisz oczekujące zmiany; jednorazowo można zresetować do 200 kart.');
        for (const id of unique) {
          queue.push({ eventId: root.crypto.randomUUID(), cardId: id, resetVersion: resetVersions[id] || 0, action: 'reset' });
          resetVersions[id] = (resetVersions[id] || 0) + 1;
          delete records[id];
        }
        announce(); return client.flush();
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
          for (const [id, value] of Object.entries(result.records || {})) if (!queue.some((event) => event.cardId === id)) {
            if (value == null) delete records[id]; else records[id] = value;
            resetVersions[id] = Object.hasOwn(result.resetVersions || {}, id) ? result.resetVersions[id] : 0;
          }
          error = ''; announce(); root.dispatchEvent(new root.CustomEvent('nextmed-study-saved'));
        }).catch((failure) => {
          if (stopped) throw failure;
          error = ['STUDY_RESET', 'STUDY_CARD_RESET'].includes(failure.code) ? 'Postęp został zresetowany. Odśwież stronę przed kolejną nauką.' : 'Nie zapisano ocen. Pozostań na stronie i kliknij „Ponów zapis”.';
          if (['STUDY_RESET', 'STUDY_CARD_RESET'].includes(failure.code)) stopped = true;
          announce(); throw failure;
        }).finally(() => { inFlight = null; });
        await inFlight;
        if (queue.length) return client.flush(keepalive);
      },
      dispose() { if (queue.length) throw new Error('Najpierw zapisz oczekujące zmiany.'); stopped = true; root.clearTimeout(timer); listeners.clear(); clients.delete(client); },
      stop() { stopped = true; queue = []; records = Object.create(null); resetVersions = Object.create(null); error = 'Sesja konta się zmieniła. Odśwież stronę.'; root.clearTimeout(timer); clients.delete(client); announce(); },
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
