(async () => {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const status = document.getElementById('google-viewer-status');
  const media = window.NextMedGoogleMedia;
  const reference = media.resolve(params.get('id'));
  const auth = await window.ChemAuth.ready;
  if (!auth?.authenticated || !auth.session?.ok) return;
  if (!reference) { status.textContent = 'Nieprawidłowy link Google. Poproś prowadzącego o sprawdzenie materiału.'; return; }
  try {
    // One access/progress check on entry, never a proxy or polling for Google files.
    const progress = window.ChemProgress;
    if (progress) await progress.update({
      materialId: progress.materialId('embed', reference.href, params.get('material') || ''),
      materialType: 'embed', action: 'open', opened: true
    }, { immediate: true });
    media.mount(document.getElementById('google-viewer-content'), {
      url: reference.href, title: params.get('title') || 'Materiał Google', width: params.get('width'), heightPercent: params.get('heightPercent'), height: params.get('height')
    }, { autoOpen: true });
    status.hidden = true;
  } catch (error) {
    status.textContent = error.code === 'SEQUENCE_LOCKED'
      ? 'Najpierw ukończ poprzedni krok kursu.'
      : 'Nie udało się potwierdzić dostępu do materiału. Odśwież stronę i spróbuj ponownie.';
  }
})();
