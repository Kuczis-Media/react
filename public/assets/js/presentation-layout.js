(function (root) {
  'use strict';
  function fit(width, height, aspect = '16:9', zoom = 'fit') {
    const ratio = aspect === '4:3' ? 4 / 3 : 16 / 9;
    const availableWidth = Math.max(0, Number(width) || 0), availableHeight = Math.max(0, Number(height) || 0);
    const scale = Number(zoom);
    const slideWidth = zoom === 'fit' || !Number.isFinite(scale) || scale <= 0
      ? Math.min(availableWidth, availableHeight * ratio) : 960 * Math.max(.25, Math.min(2, scale));
    return { width: Math.max(0, slideWidth), height: Math.max(0, slideWidth / ratio) };
  }
  function length(value) { return `calc(${Number(value) || 0} * 100cqi / 960)`; }
  // Keep the small formatting vocabulary supported by the renderer while editing.
  function editableText(node) {
    let output = '';
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3) { output += child.textContent || ''; continue; }
      const tag = (child.tagName || '').toLowerCase();
      if (tag === 'br') { output += '\n'; continue; }
      if (['script', 'style'].includes(tag)) continue;
      const text = editableText(child);
      if (tag === 'sub' || tag === 'sup') output += `<${tag}>${text}</${tag}>`;
      else {
        if (['div', 'p'].includes(tag) && output && !output.endsWith('\n')) output += '\n';
        output += text;
      }
    }
    return output;
  }
  const api = { fit, length, editableText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChemPresentationLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
