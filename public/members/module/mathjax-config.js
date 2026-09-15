window.MathJax = {
  loader: { load: ['[tex]/mhchem'] },
  tex: {
    packages: { '[+]': ['mhchem'] },
    inlineMath: [['$', '$'], ['\\(', '\\)']],
    displayMath: [['$$', '$$'], ['\\[', '\\]']]
  },
  options: { renderActions: { addMenu: [] } },
  startup: {
    typeset: false,
    ready() {
      window.MathJax.startup.defaultReady();
      window.MathJax.startup.promise.then(() => {
        window.dispatchEvent(new CustomEvent('chem-mathjax-ready'));
      });
    }
  }
};
