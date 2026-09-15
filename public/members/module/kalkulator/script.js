(async () => {
  'use strict';

  const authState = await window.ChemAuth.ready;
  if (!authState?.authenticated || !authState.session?.ok) return;

  const viewport = document.querySelector('.viewport');
  const frame = document.getElementById('calculator');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const retry = document.getElementById('retry');
  let slowTimer = 0;

  if (!viewport || !frame || !status || !statusText || !retry) return;

  const load = () => {
    window.clearTimeout(slowTimer);
    viewport.classList.remove('ready');
    status.hidden = false;
    status.classList.remove('slow');
    statusText.textContent = 'Ładowanie kalkulatora…';
    retry.hidden = true;

    const source = frame.dataset.src;
    frame.src = source || '';
    slowTimer = window.setTimeout(() => {
      status.classList.add('slow');
      statusText.textContent = 'Kalkulator ładuje się dłużej niż zwykle. Sprawdź połączenie i spróbuj ponownie.';
      retry.hidden = false;
    }, 12000);
  };

  frame.addEventListener('load', () => {
    try {
      if (frame.contentWindow && frame.contentWindow.location.href === 'about:blank') return;
    } catch {
      // Docelowy kalkulator jest cross-origin, więc odczyt lokalizacji ma rzucić wyjątek.
    }
    window.clearTimeout(slowTimer);
    viewport.classList.add('ready');
    status.hidden = true;
  });
  retry.addEventListener('click', load);
  window.addEventListener('online', () => {
    if (!viewport.classList.contains('ready')) load();
  });

  load();
})();
