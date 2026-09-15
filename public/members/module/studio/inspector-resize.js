(function initializeLessonInspectorResize() {
  'use strict';
  const workspace = document.getElementById('lesson-workspace');
  const handle = document.getElementById('lesson-inspector-resize');
  const layout = workspace?.querySelector('.builder-layout');
  if (!layout || !handle) return;
  const KEY = 'nextmed.studio.lesson.inspector-width.v1';
  const MIN = 300, MAX = 680;
  let preferred = null, drag = null;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (typeof saved === 'number' && Number.isFinite(saved)) preferred = Math.max(MIN, Math.min(MAX, saved));
  } catch { /* Layout preferences are optional. */ }

  const defaultWidth = () => window.innerWidth <= 1240 ? 300 : 340;
  function bounds() {
    const width = layout.getBoundingClientRect().width || window.innerWidth;
    const palette = workspace.classList.contains('is-palette-collapsed') ? 52 : window.innerWidth <= 1240 ? 235 : 270;
    return { min: MIN, max: Math.max(MIN, Math.min(MAX, Math.floor(width - palette - 360))) };
  }
  function fit() {
    const { min, max } = bounds();
    const width = Math.round(Math.max(min, Math.min(max, preferred ?? defaultWidth())));
    workspace.style.setProperty('--lesson-inspector-width', `${width}px`);
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pikseli`);
    handle.tabIndex = window.innerWidth > 1020 && !workspace.classList.contains('is-inspector-collapsed') ? 0 : -1;
    return width;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(preferred)); } catch { /* Keep the session layout. */ }
  }
  function change(width) {
    const { min, max } = bounds();
    preferred = Math.max(min, Math.min(max, width));
    fit();
  }
  function endDrag(event, cancel = false) {
    if (!drag || event.pointerId !== drag.id) return;
    const previous = drag;
    drag = null;
    if (cancel) preferred = previous.preferred;
    workspace.classList.remove('is-inspector-resizing');
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    fit();
    if (!cancel) save();
  }
  handle.addEventListener('pointerdown', (event) => {
    if (drag || event.button !== 0 || window.innerWidth <= 1020 || workspace.classList.contains('is-inspector-collapsed')) return;
    event.preventDefault();
    handle.focus();
    drag = { id: event.pointerId, x: event.clientX, width: fit(), preferred };
    handle.setPointerCapture(event.pointerId);
    workspace.classList.add('is-inspector-resizing');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    change(drag.width + drag.x - event.clientX);
  });
  handle.addEventListener('pointerup', (event) => endDrag(event));
  handle.addEventListener('pointercancel', (event) => endDrag(event, true));
  handle.addEventListener('lostpointercapture', (event) => endDrag(event, true));
  handle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) { endDrag({ pointerId: drag.id }, true); event.preventDefault(); return; }
    if (handle.tabIndex < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const { min, max } = bounds();
    const step = event.shiftKey ? 50 : 20;
    change(event.key === 'Home' ? min : event.key === 'End' ? max : fit() + (event.key === 'ArrowLeft' ? step : -step));
    save();
  });
  handle.addEventListener('dblclick', () => { preferred = null; fit(); save(); });
  window.addEventListener('resize', fit, { passive: true });
  // Switching workspaces or collapsing the library changes the available room.
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(layout);
  if ('MutationObserver' in window) new MutationObserver(fit).observe(workspace, { attributes: true, attributeFilter: ['class', 'hidden'] });
  fit();
})();
