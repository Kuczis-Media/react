import React, { useLayoutEffect, useRef } from 'react';
import { register, render } from '../shared/runtime.jsx';

// Static HTML remains the no-JS/Netlify Forms/standalone-export fallback. Read
// its layout once; subsequent publications reconcile keyed React sections.
const templates = new WeakMap();
const bindings = {
  home: { title: '.text-2', subtitle: '.text-1', body: '.text-3', cta: '#login-cta' },
  about: { title: '.title', subtitle: '.column.right .text', body: '.column.right p', cta: '.column.right a' },
  services: { title: '.title', subtitle: '.landing-section-subtitle', body: '.landing-section-body', cta: '.landing-section-cta' },
  pricing: { title: '.title', subtitle: '.landing-section-subtitle', body: '.pricing-intro', cta: '.landing-section-cta' },
  skills: { title: '.title', subtitle: '.column.left .text', body: '.column.left p', cta: '.column.left a' },
  contact: { title: '.title', subtitle: '.column.left .text', body: '.column.left > p', cta: '.landing-section-cta' }
};
const attrNames = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', fetchpriority: 'fetchPriority', 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule' };
const camel = (name) => name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const color = (value) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : undefined;
function imageUrl(value) {
  try { const url = new URL(value || '', location.origin); return value && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function safeHref(value, enabled) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text.startsWith('#')) return enabled.has(text.slice(1)) ? text : '';
  if (!text || text.startsWith('//') || /[\u0000-\u0020\\]/.test(text)) return '';
  try { const url = new URL(text, location.origin); return ['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? text : ''; } catch { return ''; }
}
function capture(container) {
  return [...container.querySelectorAll(':scope > section')].map((section) => {
    const targets = new Map(Object.entries(bindings[section.id] || {}).map(([key, selector]) => [section.querySelector(selector), key]));
    function visit(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return null;
      // These established widgets own their canvas/CAPTCHA/checkout DOM. Keep
      // the actual nodes, input values, listeners and 3D instance when reordering.
      if (node.matches('#hero-biomolecule, form[name="contact"], [data-pricing], .hero-typewriter, .hero-scene, .contact-list')) return { widget: node };
      const attrs = {};
      for (const attr of node.attributes) {
        if (/^on/i.test(attr.name) || attr.name === 'style') continue;
        attrs[attrNames[attr.name] || attr.name] = ['hidden', 'required'].includes(attr.name) ? true : attr.value;
      }
      if (node.hasAttribute('style')) attrs.style = Object.fromEntries(Array.from(node.style).map((key) => [camel(key), node.style.getPropertyValue(key)]));
      return { tag: node.localName, attrs, binding: targets.get(node), image: section.id === 'about' && node.matches('.column.left img'), children: [...node.childNodes].map(visit).filter((value) => value !== null) };
    }
    return { id: section.id, node: visit(section) };
  });
}
function NativeWidget({ node }) {
  const ref = useRef(null);
  useLayoutEffect(() => { ref.current.append(node); return () => { node.remove(); }; }, [node]);
  return <div ref={ref} style={{ display: 'contents' }} />;
}
function ManagedLink({ tag, attrs, text }) {
  const ref = useRef(null);
  // The session hint replaces this label after each publication. Do not let
  // it detach a Text node owned by React and leave a stale login label behind.
  useLayoutEffect(() => {
    ref.current.textContent = text;
    if (attrs.href) ref.current.setAttribute('href', attrs.href);
    else ref.current.removeAttribute('href');
  });
  return React.createElement(tag, { ...attrs, ref });
}
function Template({ node, config, enabled, root = false }) {
  if (typeof node === 'string') return node;
  if (node.widget) return <NativeWidget node={node.widget} />;
  const attrs = { ...node.attrs };
  let children = node.children;
  if (config && node.binding) {
    if (node.binding === 'cta') {
      const href = safeHref(config.ctaHref, enabled);
      attrs.href = href || undefined; attrs.hidden = !href || !config.ctaLabel?.trim(); attrs['data-landing-managed'] = 'true';
      return <ManagedLink tag={node.tag} attrs={attrs} text={config.ctaLabel || ''} />;
    } else if (typeof config[node.binding] === 'string') children = [config[node.binding]];
  }
  if (config && node.image) {
    attrs.src = imageUrl(config.imageUrl) || undefined; attrs.hidden = !attrs.src; attrs.alt = config.imageAlt || '';
  }
  if (root && config) {
    attrs.hidden = config.enabled === false;
    attrs['data-landing-managed'] = 'true';
    attrs.style = { ...attrs.style, backgroundColor: color(config.backgroundColor), color: color(config.textColor), '--landing-background': color(config.backgroundColor), '--landing-text': color(config.textColor), '--landing-accent': color(config.accentColor) };
    if (config.id === 'home') {
      const visual = config.heroVisual === 'image' ? 'image' : config.heroVisual === 'biomolecule-banner' ? 'biomolecule-banner' : 'biomolecule';
      const image = visual === 'image' ? imageUrl(config.imageUrl) : '';
      attrs.className = ['home', visual !== 'image' && 'has-biomolecule', visual === 'biomolecule-banner' && 'has-biomolecule-banner', image && 'has-hero-image'].filter(Boolean).join(' ');
      attrs['data-hero-visual'] = visual;
      attrs.style.backgroundImage = image ? `linear-gradient(100deg, rgba(5,15,30,.72), rgba(5,15,30,.3)), url("${image.replace(/["\\]/g, '')}")` : undefined;
    }
    if (config.id === 'about') attrs.className = `about${imageUrl(config.imageUrl) ? '' : ' landing-no-image'}`;
    if (config.id === 'contact') for (const [key, variable] of Object.entries({ formBackgroundColor: '--contact-form-background', fieldBackgroundColor: '--contact-field-background', fieldTextColor: '--contact-field-text', fieldBorderColor: '--contact-field-border', fieldFocusColor: '--contact-field-focus', labelTextColor: '--contact-label-text' })) attrs.style[variable] = color(config[key]);
  }
  const rendered = children.map((child, i) => <Template key={i} node={child} config={config} enabled={enabled} />);
  if (config && !['home', 'about'].includes(config.id) && node.attrs?.className === 'max-width') rendered.push(<img key="managed-image" className="landing-section-image" src={imageUrl(config.imageUrl) || undefined} alt={config.imageAlt || ''} hidden={!imageUrl(config.imageUrl)} width="1200" height="675" loading="lazy" decoding="async" />);
  return React.createElement(node.tag, attrs, ['img', 'input', 'br', 'hr', 'wbr', 'source'].includes(node.tag) ? undefined : rendered);
}
register('landing-page', ({ template, model }) => {
  const sections = model ? [...model.sections].sort((a, b) => a.order - b.order) : template;
  const enabled = new Set(sections.filter((section) => section.enabled !== false).map((section) => section.id));
  return <>{sections.map((section) => { const source = template.find((item) => item.id === section.id); return source ? <Template key={section.id} node={source.node} config={model ? section : null} enabled={enabled} root /> : null; })}</>;
});
export function renderLanding(container, model = null) {
  if (!container || new URL(location.href).searchParams.get('uiRenderer') === 'legacy') return false;
  if (!templates.has(container)) templates.set(container, capture(container));
  return render('landing-page', container, { template: templates.get(container), model });
}
