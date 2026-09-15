'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rich = require('../public/assets/js/assessment-text.js');

test('chemistry preview shows indices, charges, phases, coefficients and conditions without a rendering engine', () => {
  assert.match(rich.formulaPreview('\\ce{2 H2 + O2 -> 2 H2O}'), /^2 H<sub>2<\/sub> \+ O<sub>2<\/sub>/);
  assert.match(rich.formulaPreview('\\ce{Fe^{3+}}'), /^Fe<sup>3\+<\/sup>$/);
  assert.match(rich.formulaPreview('\\ce{SO4^{2-}}'), /^SO<sub>4<\/sub><sup>2-<\/sup>$/);
  assert.match(rich.formulaPreview('\\ce{Ca(OH)2}'), /^Ca\(OH\)<sub>2<\/sub>$/);
  assert.match(rich.formulaPreview('\\ce{[Fe(CN)6]^{3-}}'), /^\[Fe\(CN\)<sub>6<\/sub>\]<sup>3-<\/sup>$/);
  assert.match(rich.formulaPreview('\\ce{CuSO4 * 5 H2O}'), /SO<sub>4<\/sub>.*·.*5 H<sub>2<\/sub>O/);
  assert.match(rich.formulaPreview('\\ce{Ag^{+} + Cl^{-} -> AgCl(s)}'), /Ag<sup>\+<\/sup>.*Cl<sup>-<\/sup>.*assessment-chem-phase">\(s\)/);
  assert.match(rich.formulaPreview('\\ce{N2 + 3 H2 <=>[Pt] 2 NH3}'), /assessment-chem-condition">Pt<\/span><span>⇌/);
  assert.match(rich.formulaPreview('\\ce{2 H2 + O2 ->[\\Delta] 2 H2O}'), /assessment-chem-condition">Δ/);
  assert.match(rich.formulaPreview('\\ce{HCl + NaOH -> NaCl + H2O}'), /HCl \+ NaOH.*NaCl \+ H<sub>2<\/sub>O/);
  assert.match(rich.formulaPreview('\\ce{CH4 + 2 O2 -> CO2 + 2 H2O}'), /CH<sub>4<\/sub>.*CO<sub>2<\/sub>/);
});

test('unsupported and ambiguous chemistry is left to MathJax instead of receiving a misleading local rendering', () => {
  for (const expression of [
    '\\ce{}', '\\ce{2}', '\\ce{H2 ->}', '\\ce{H2 + }', '\\ce{Ca(OH2}',
    '\\ce{H2)}', '\\ce{()}', '\\ce{Ca_{+}}', '\\ce{Fe2+}', '\\ce{NH4+}',
    '\\ce{^{14}C}', '\\ce{H2 ->[a[b]] H2}', '\\ce{H2 ->[\\text{UV}] H2}',
    '\\ce{Xx2}', '\\ce{H2^{}}', '\\ce{H2^{2+}', '\\ce{H2} trailing', '\\ce{C=C}'
  ]) assert.equal(rich.formulaPreview(expression), null, expression);
  const output = rich.html('\\[\\ce{Fe2+}\\]');
  assert.match(output, /data-assessment-math/);
  assert.match(output, /\\ce\{Fe2\+\}/);
  assert.doesNotMatch(output, /assessment-math-fallback/);
});

test('simple mathematical indices, fractions and roots are visible immediately; advanced notation is preserved for MathJax', () => {
  assert.match(rich.formulaPreview('x^{2} + y_{1}'), /<i>x<\/i><sup>2<\/sup>.*<i>y<\/i><sub>1<\/sub>/);
  const quadratic = rich.formulaPreview('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');
  assert.match(quadratic, /assessment-math-fraction/);
  assert.match(quadratic, /assessment-math-radicand/);
  assert.match(quadratic, /<sup>2<\/sup>/);
  assert.match(quadratic, /±/);
  for (const expression of ['x^{2', '\\frac{1}{}', '\\sqrt{x', '\\sum_{i=1}^{n}i', '\\begin{matrix}1&2\\end{matrix}', 'x % comment']) {
    assert.equal(rich.formulaPreview(expression), null, expression);
    assert.match(rich.html(`\\[${expression}\\]`), /data-assessment-math/);
  }
});

test('preview HTML escapes untrusted input, has bounded complexity and never enables unsafe TeX extensions', () => {
  for (const expression of [
    '\\ce{<img src=x onerror=alert(1)>}', '\\ce{H2 ->[<script>alert(1)</script>] H2}',
    '\\href{javascript:alert(1)}{x}', '\\style{color:red}{x}', '\\ce{\\require{html}}',
    '\\sqrt{'.repeat(20) + 'x' + '}'.repeat(20), 'x'.repeat(2001)
  ]) assert.equal(rich.formulaPreview(expression), null, expression);
  const plain = rich.formulaPreview('<script>');
  assert.doesNotMatch(plain, /<script>/);
  assert.match(plain, /&lt;/);
  const text = '\\[\\ce{SO4^{2-}}\\]';
  const output = rich.html(text);
  assert.match(output, /assessment-math-fallback">SO<sub>4<\/sub><sup>2-<\/sup>/);
  assert.match(output, /assessment-math-source is-pending" aria-hidden="true">\\\[\\ce\{SO4\^\{2-\}\}\\\]/);
  assert.doesNotMatch(output, /assessment-math-source[^>]* hidden/);
  assert.equal(JSON.parse(JSON.stringify({ prompt: text })).prompt, text);
});

function fixture(engine) {
  const scripts = [], timers = new Map(), listeners = new Map();
  const context = {
    Promise, MathJax: engine,
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); }
  };
  context.document = {
    querySelector() { return scripts.find((script) => !script.removed); },
    addEventListener: context.addEventListener, removeEventListener: context.removeEventListener,
    createElement() { return { remove() { this.removed = true; } }; },
    head: { append(script) { scripts.push(script); } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/assessment-text.js'), 'utf8'), context);
  function target() {
    return {
      style: {}, classList: { add() {} }, isConnected: true, nodes: [],
      set innerHTML(value) {
        this.nodes.forEach((node) => { node.isConnected = false; node.source.isConnected = false; });
        this.markup = value;
        this.nodes = value.includes('data-assessment-math') ? [{
          isConnected: true,
          source: { isConnected: true, pending: true, ariaHidden: true, rendered: false, error: false,
            get classList() { return { remove: () => { this.pending = false; } }; },
            removeAttribute(name) { if (name === 'aria-hidden') this.ariaHidden = false; },
            querySelector(selector) { return selector === 'mjx-container' ? (this.rendered ? {} : null) : (this.error ? {} : null); }
          },
          fallback: { hidden: false },
          querySelector(selector) { return selector === '.assessment-math-source' ? this.source : this.fallback; }
        }] : [];
      },
      get innerHTML() { return this.markup; },
      querySelectorAll() { return this.nodes; }
    };
  }
  return { context, scripts, timers, listeners, target, flush: () => new Promise((resolve) => setImmediate(resolve)) };
}

test('learner rendering shows chemistry immediately and replaces it only after successful MathJax output', async () => {
  let finish;
  const engine = { typesetPromise(nodes) { return new Promise((resolve) => { finish = () => { nodes.forEach((node) => { node.rendered = true; }); resolve(); }; }); } };
  const env = fixture(engine), target = env.target();
  env.context.ChemAssessmentText.render(target, '\\[\\ce{H2O}\\]');
  assert.match(target.innerHTML, /H<sub>2<\/sub>O/);
  assert.equal(target.nodes[0].fallback.hidden, false);
  await env.flush();
  assert.equal(target.nodes[0].source.pending, true);
  assert.equal(target.nodes[0].source.ariaHidden, true);
  finish();
  await env.flush();
  assert.equal(target.nodes[0].source.pending, false);
  assert.equal(target.nodes[0].source.ariaHidden, false);
  assert.equal(target.nodes[0].fallback.hidden, true);
  assert.equal(env.scripts.length, 0);
});

test('rendering errors preserve the local preview and failed CDN downloads have a retry cooldown while typing', async () => {
  for (const behavior of ['reject', 'parse-error']) {
    const env = fixture({ async typesetPromise(nodes) {
      if (behavior === 'reject') throw new Error('offline');
      nodes.forEach((node) => { node.rendered = true; node.error = true; });
    } });
    const target = env.target();
    env.context.ChemAssessmentText.render(target, '\\[\\ce{Fe^{3+}}\\]');
    await env.flush();
    assert.equal(target.nodes[0].source.pending, true);
    assert.equal(target.nodes[0].fallback.hidden, false);
  }
  const env = fixture(), target = env.target();
  env.context.ChemAssessmentText.render(target, '\\[\\ce{H2O}\\]');
  await env.flush();
  env.scripts[0].onerror();
  await env.flush();
  for (let i = 0; i < 10; i += 1) env.context.ChemAssessmentText.render(target, '\\[\\ce{H2O}\\]');
  await env.flush();
  assert.equal(env.scripts.length, 1);
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
  assert.equal(target.nodes[0].fallback.hidden, false);
});

test('an older asynchronous equation render cannot replace a newer preview', async () => {
  const pending = [], cleared = [];
  const env = fixture({
    typesetPromise(nodes) { return new Promise((resolve) => pending.push(() => { nodes.forEach((node) => { node.rendered = true; }); resolve(); })); },
    typesetClear(nodes) { cleared.push(...nodes); }
  });
  const target = env.target();
  env.context.ChemAssessmentText.render(target, '\\[\\ce{H2O}\\]');
  await env.flush();
  const old = target.nodes[0];
  env.context.ChemAssessmentText.render(target, '\\[\\ce{CO2}\\]');
  pending.shift()();
  await env.flush();
  assert.equal(old.source.pending, true);
  assert.ok(cleared.includes(old.source));
  assert.match(target.innerHTML, /CO<sub>2<\/sub>/);
  assert.equal(target.nodes[0].fallback.hidden, false);
  pending.shift()();
  await env.flush();
  assert.equal(target.nodes[0].fallback.hidden, true);
});

test('the existing Studio MathJax initialization is reused and detached previews do not start downloads', async () => {
  const detachedEnv = fixture(), detached = detachedEnv.target();
  detached.isConnected = false;
  detachedEnv.context.ChemAssessmentText.render(detached, '\\[\\ce{H2O}\\]');
  await detachedEnv.flush();
  assert.equal(detachedEnv.scripts.length, 0);
  assert.match(detached.innerHTML, /H<sub>2<\/sub>O/);

  const env = fixture(), target = env.target();
  env.scripts.push({ externalStudioEngine: true });
  env.context.ChemAssessmentText.render(target, '\\[\\ce{H2O}\\]');
  await env.flush();
  assert.equal(env.scripts.length, 1);
  assert.equal(target.nodes[0].fallback.hidden, false);
  let calls = 0;
  env.context.MathJax = { async typesetPromise(nodes) { calls += 1; nodes.forEach((node) => { node.rendered = true; }); } };
  env.listeners.get('chem-mathjax-ready')();
  await env.flush();
  assert.equal(calls, 1);
  assert.equal(target.nodes[0].fallback.hidden, true);
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
});
