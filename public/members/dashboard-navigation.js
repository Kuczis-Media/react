(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemDashboardNavigation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function pickActiveSection(sections, activationLine, atPageEnd) {
    const visible = Array.isArray(sections)
      ? sections.filter((section) => (
        section &&
        typeof section.id === 'string' &&
        section.id &&
        section.hidden !== true &&
        Number.isFinite(section.top)
      ))
      : [];

    if (!visible.length) return '';
    if (atPageEnd) return visible[visible.length - 1].id;

    const line = Number.isFinite(activationLine) ? activationLine : 0;
    let activeId = visible[0].id;
    for (const section of visible) {
      if (section.top > line) break;
      activeId = section.id;
    }
    return activeId;
  }

  return Object.freeze({ pickActiveSection });
});
