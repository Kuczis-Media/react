(function exposeAssessmentText(root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemAssessmentText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAssessmentText(root) {
  'use strict';
  const FONTS = Object.freeze({ sans: 'Inter, system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, monospace', arial: 'Arial, sans-serif' });
  const SIZES = Object.freeze({ small: '0.95rem', normal: '1.1rem', large: '1.35rem', xlarge: '1.65rem' });
  const COMMANDS = new Set('ce frac dfrac tfrac sqrt sum prod int iint oint left right text textrm textbf mathrm mathbf mathit mathbb mathcal operatorname pm mp cdot times div le leq ge geq ne neq approx equiv sim infty Delta delta alpha beta gamma pi theta Omega omega lambda mu nu sigma tau phi sin cos tan log ln lim to rightarrow leftarrow leftrightarrow rightleftharpoons overset underset overline underline vec hat bar begin end in notin subset cup cap quad qquad degree'.split(' '));
  const escape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function normalizeFormat(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      color: typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color) ? source.color.toLowerCase() : '',
      align: ['left', 'center', 'right', 'justify'].includes(source.align) ? source.align : 'left',
      font: Object.hasOwn(FONTS, source.font) ? source.font : 'sans',
      size: Object.hasOwn(SIZES, source.size) ? source.size : 'normal',
      bold: source.bold === true
    };
  }

  function inline(text) {
    return escape(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/__([^_\n]+)__/g, '<u>$1</u>')
      .replace(/\^([^^\n]{1,100})\^/g, '<sup>$1</sup>')
      .replace(/~([^~\n]{1,100})~/g, '<sub>$1</sub>')
      .replace(/\n/g, '<br>');
  }

  function safeFormula(value) {
    return typeof value === 'string' && value.length <= 4000
      && [...value.matchAll(/\\([A-Za-z]+)/g)].every((match) => COMMANDS.has(match[1]));
  }

  // A small, deliberately conservative renderer keeps common school equations
  // readable immediately, including offline. Complex TeX still uses MathJax.
  const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));
  const SYMBOLS = Object.freeze({ Delta: 'Δ', delta: 'δ', alpha: 'α', beta: 'β', gamma: 'γ', pi: 'π', theta: 'θ', Omega: 'Ω', omega: 'ω', lambda: 'λ', mu: 'μ', nu: 'ν', sigma: 'σ', tau: 'τ', phi: 'φ', pm: '±', mp: '∓', cdot: '·', times: '×', div: '÷', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', rightleftharpoons: '⇌', degree: '°' });

  function chemistryPreview(source) {
    let offset = 0, output = '', hasAtom = false, needsCompound = true;
    const groups = [];
    while (offset < source.length) {
      const remaining = source.slice(offset);
      let match;
      if ((match = remaining.match(/^\s+/))) {
        output += ' '; offset += match[0].length; continue;
      }
      if ((match = remaining.match(/^(<=>|<->|->|<-)(?:\[([^\[\]]{0,200})\])?/))) {
        if (!hasAtom || needsCompound || groups.length) return null;
        const label = (match[2] || '').replace(/\\([A-Za-z]+)/g, (full, command) => SYMBOLS[command] || full);
        if (!/^[\p{L}\p{N}\s.,;:+−°Δδ()\/-]*$/u.test(label)) return null;
        const arrow = { '<=>': '⇌', '<->': '↔', '->': '→', '<-': '←' }[match[1]];
        output += `<span class="assessment-chem-arrow">${label ? `<span class="assessment-chem-condition">${escape(label)}</span>` : ''}<span>${arrow}</span></span>`;
        offset += match[0].length; needsCompound = true; continue;
      }
      if (remaining[0] === '+' && (offset === 0 || /\s/.test(source[offset - 1])) && /\s/.test(remaining[1] || '')) {
        if (needsCompound || groups.length) return null;
        output += '+'; offset += 1; needsCompound = true; continue;
      }
      if ((match = remaining.match(/^\((aq|s|l|g)\)/))) {
        if (needsCompound) return null;
        output += `<span class="assessment-chem-phase">${escape(match[0])}</span>`;
        offset += match[0].length; continue;
      }
      if (remaining[0] === '(' || remaining[0] === '[') {
        groups.push({ close: remaining[0] === '(' ? ')' : ']', atom: false });
        output += remaining[0]; offset += 1; continue;
      }
      if (remaining[0] === ')' || remaining[0] === ']') {
        const group = groups.pop();
        if (!group || group.close !== remaining[0] || !group.atom) return null;
        output += remaining[0]; offset += 1; needsCompound = false; continue;
      }
      if ((match = remaining.match(/^([_^])(?:\{([0-9+\-−]{1,12})\}|([0-9]+[+\-−]?|[+\-−]))/))) {
        if (needsCompound) return null;
        const tag = match[1] === '_' ? 'sub' : 'sup';
        if (tag === 'sub' && !/^\d+$/.test(match[2] || match[3])) return null;
        output += `<${tag}>${escape(match[2] || match[3])}</${tag}>`;
        offset += match[0].length; continue;
      }
      if ((match = remaining.match(/^\d+(?:\.\d+)?/))) {
        if (needsCompound) output += escape(match[0]);
        else if (match[0].includes('.')) return null;
        // Bare Fe2+ and NH4+ have different mhchem charge/index rules. Leave
        // these ambiguous forms to the full engine; explicit ^{...} is instant.
        else if (/^[+\-−](?=\s|$|\()/.test(remaining.slice(match[0].length))) return null;
        else output += `<sub>${match[0]}</sub>`;
        offset += match[0].length; continue;
      }
      if ((match = remaining.match(/^(?:[A-Z][a-z]?|e)/))) {
        if (match[0] !== 'e' && !ELEMENTS.has(match[0])) return null;
        output += escape(match[0]); offset += match[0].length;
        hasAtom = true; needsCompound = false;
        groups.forEach((group) => { group.atom = true; });
        continue;
      }
      if ((match = remaining.match(/^[+\-−](?=\s|$|\()/))) {
        if (needsCompound || groups.length) return null;
        output += `<sup>${escape(match[0])}</sup>`; offset += 1; continue;
      }
      if (remaining[0] === '·' || remaining[0] === '*') {
        if (needsCompound || groups.length) return null;
        output += ' · '; offset += 1; needsCompound = true; continue;
      }
      if (remaining[0] === '↑' || remaining[0] === '↓') {
        if (needsCompound || groups.length) return null;
        output += remaining[0]; offset += 1; continue;
      }
      return null;
    }
    return hasAtom && !needsCompound && !groups.length ? output.trim() : null;
  }

  function simpleMathPreview(source) {
    let offset = 0;
    function group(depth) {
      if (depth > 8 || source[offset] !== '{') return null;
      offset += 1;
      const value = sequence(depth + 1, true);
      return value === null || source[offset++] !== '}' ? null : value;
    }
    function sequence(depth, nested = false) {
      let output = '', hasBase = false;
      while (offset < source.length && (!nested || source[offset] !== '}')) {
        const remaining = source.slice(offset);
        let match;
        if ((match = remaining.match(/^\s+/))) { offset += match[0].length; output += ' '; continue; }
        if (remaining[0] === '^' || remaining[0] === '_') {
          if (!hasBase) return null;
          const tag = remaining[0] === '^' ? 'sup' : 'sub'; offset += 1;
          let content;
          if (source[offset] === '{') content = group(depth);
          else if (/^[A-Za-z0-9]$/.test(source[offset] || '')) content = escape(source[offset++]);
          else return null;
          if (!content) return null;
          output += `<${tag}>${content}</${tag}>`; continue;
        }
        if ((match = remaining.match(/^\\([A-Za-z]+)/))) {
          offset += match[0].length;
          const command = match[1];
          if (SYMBOLS[command]) output += SYMBOLS[command];
          else if (['frac', 'dfrac', 'tfrac'].includes(command)) {
            const numerator = group(depth), denominator = group(depth);
            if (!numerator || !denominator) return null;
            output += `<span class="assessment-math-fraction"><span>${numerator}</span><span>${denominator}</span></span>`;
          } else if (command === 'sqrt') {
            const radicand = group(depth);
            if (!radicand) return null;
            output += `<span class="assessment-math-root">√<span class="assessment-math-radicand">${radicand}</span></span>`;
          } else return null;
          hasBase = true; continue;
        }
        if ((match = remaining.match(/^[A-Za-z]+/))) {
          output += `<i>${match[0]}</i>`; offset += match[0].length; hasBase = true; continue;
        }
        if ((match = remaining.match(/^[0-9.,()+\-=<>|/!:;\[\] α-ωΑ-Ω±×÷·∞≤≥≠≈]+/))) {
          output += escape(match[0]); offset += match[0].length; hasBase = true; continue;
        }
        return null;
      }
      return output;
    }
    return sequence(0) || null;
  }

  function formulaPreview(expression) {
    if (!safeFormula(expression) || expression.length > 2000) return null;
    const source = expression.trim();
    const chemistry = source.match(/^\\ce\{([\s\S]*)\}$/);
    return chemistry ? chemistryPreview(chemistry[1]) : simpleMathPreview(source);
  }

  function html(value) {
    const text = String(value ?? '').replace(/\0/g, '').slice(0, 20_000);
    const math = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|(?<![\\$])\$([^$\n]+?)(?<!\\)\$(?!\$)/g;
    let output = '', offset = 0;
    for (const match of text.matchAll(math)) {
      output += inline(text.slice(offset, match.index));
      const expression = match[1] ?? match[2] ?? match[3] ?? match[4];
      const display = match[2] !== undefined || match[3] !== undefined;
      if (safeFormula(expression)) {
        const preview = formulaPreview(expression);
        const source = escape(display ? `\\[${expression}\\]` : `\\(${expression}\\)`);
        output += `<span class="assessment-math${display ? ' is-display' : ''}" data-assessment-math>${preview ? `<span class="assessment-math-fallback">${preview}</span><span class="assessment-math-source is-pending" aria-hidden="true">${source}</span>` : source}</span>`;
      } else output += escape(match[0]);
      offset = match.index + match[0].length;
    }
    return output + inline(text.slice(offset));
  }

  let mathPromise = null;
  let mathRetryAfter = 0;
  let typesetQueue = Promise.resolve();
  function loadMath() {
    if (root.MathJax?.typesetPromise) return Promise.resolve(root.MathJax);
    if (mathPromise) return mathPromise;
    if (Date.now() < mathRetryAfter) return Promise.resolve(null);
    mathPromise = new Promise((resolve, reject) => {
      const document = root.document;
      let script = null;
      const cleanup = () => {
        root.clearTimeout(timeout);
        document.removeEventListener('chemdisk-mathjax-ready', ready);
        root.removeEventListener('chem-mathjax-ready', ready);
      };
      const failed = () => {
        cleanup();
        script?.remove();
        reject(new Error('Math rendering unavailable'));
      };
      const ready = () => {
        if (!root.MathJax?.typesetPromise) return;
        cleanup();
        resolve(root.MathJax);
      };
      const timeout = root.setTimeout(failed, 15_000);
      document.addEventListener('chemdisk-mathjax-ready', ready);
      root.addEventListener('chem-mathjax-ready', ready);
      if (!document.querySelector('script[src*="mathjax"]')) {
        root.MathJax = { loader: { load: ['[tex]/mhchem'] }, tex: { packages: { '[+]': ['mhchem'] } }, startup: { typeset: false }, options: { renderActions: { addMenu: [] } } };
        script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-mml-chtml.js';
        script.onload = () => Promise.resolve(root.MathJax?.startup?.promise).then(ready, failed);
        script.onerror = failed;
        document.head.append(script);
      }
    }).catch((error) => { mathPromise = null; mathRetryAfter = Date.now() + 30_000; throw error; });
    return mathPromise;
  }

  function render(target, value, format) {
    const style = normalizeFormat(format);
    try { root.MathJax?.typesetClear?.([target]); } catch { /* Math must not interrupt a question. */ }
    target.classList.add('assessment-rich-text');
    target.style.color = style.color;
    target.style.textAlign = style.align;
    target.style.fontFamily = FONTS[style.font];
    target.style.fontSize = SIZES[style.size];
    target.style.fontWeight = style.bold ? '700' : '400';
    target.innerHTML = html(value);
    const formulas = [...target.querySelectorAll('[data-assessment-math]')];
    if (!formulas.length) return;
    const loading = Promise.resolve().then(() => target.isConnected ? loadMath() : null);
    typesetQueue = Promise.all([typesetQueue.catch(() => {}), loading]).then(async ([, math]) => {
      if (!math || !target.isConnected) return;
      const current = formulas.filter((node) => node.isConnected);
      const entries = current.map((node) => ({ node, source: node.querySelector?.('.assessment-math-source'), fallback: node.querySelector?.('.assessment-math-fallback') }));
      if (!entries.length) return;
      try {
        await math.typesetPromise(entries.map((entry) => entry.source || entry.node));
        for (const { source, fallback } of entries) {
          // Keep the local preview on any MathJax parse error. Never replace a
          // useful equation with raw syntax or an error banner during an exam.
          if (source?.isConnected && source.querySelector('mjx-container') && !source.querySelector('[data-mjx-error], mjx-merror')) {
            source.classList.remove('is-pending');
            source.removeAttribute('aria-hidden');
            if (fallback) fallback.hidden = true;
          }
        }
      } finally {
        // A newer keystroke can replace a source while MathJax is working on it.
        // Release those completed-but-detached math items from its document.
        const stale = entries.filter((entry) => !entry.node.isConnected).map((entry) => entry.source || entry.node);
        if (stale.length) math.typesetClear?.(stale);
      }
    }).catch(() => { /* The local preview or escaped source stays visible; never block an exam. */ });
  }

  return Object.freeze({ FONTS, SIZES, normalizeFormat, html, render, safeFormula, formulaPreview });
});
