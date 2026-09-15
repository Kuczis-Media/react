import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const roots = new Map();
const components = new Map();
let observer;
class ViewBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.entry.failed = true; }
  render() { return this.state.failed ? null : this.props.children; }
}
export function register(name, component) { components.set(name, component); }
export function release(container) {
  const entry = roots.get(container);
  if (!entry) return;
  roots.delete(container);
  entry.root.unmount();
  delete container.dataset.reactView;
}
export function releaseWithin(container) {
  for (const host of [...roots.keys()]) if (host === container || container.contains(host)) release(host);
}
export function render(name, container, props) {
  if (!container || new URL(location.href).searchParams.get('uiRenderer') === 'legacy') return false;
  const Component = components.get(name);
  if (!Component) return false;
  let entry = roots.get(container);
  if (!entry) {
    // Do not log component props: the ENV editor may contain credentials.
    entry = { root: createRoot(container, { onCaughtError() {} }), failed: false };
    roots.set(container, entry);
  }
  container.dataset.reactView = name;
  // Legacy controllers read these hosts immediately after rendering. Never
  // render a root from an effect: callbacks are event handlers or controllers.
  flushSync(() => entry.root.render(<ViewBoundary entry={entry}><Component {...props} /></ViewBoundary>));
  if (entry.failed) { release(container); return false; }
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const host of [...roots.keys()]) if (!host.isConnected) release(host);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return true;
}

// Dedicated boundary for established rich editors/media widgets. Their DOM is
// never reconciled by React; disposal runs when the surrounding view changes.
export function Widget({ factory, revision, className, as: Tag = 'div' }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const host = ref.current;
    const node = factory();
    if (node) host.replaceChildren(node);
    return () => { host.replaceChildren(); };
  }, [revision, factory]);
  return <Tag ref={ref} className={className} style={{ display: 'contents' }} />;
}

export function RichText({ value, format, as: Tag = 'div', className }) {
  const ref = useRef(null);
  const signature = JSON.stringify(format || {});
  useLayoutEffect(() => {
    if (window.ChemAssessmentText) window.ChemAssessmentText.render(ref.current, value || '', format);
    else ref.current.textContent = value || '';
  }, [value, signature]);
  return <Tag ref={ref} className={className} />;
}

export function LazyImage({ image, getUrl, className = '', eager = false }) {
  const ref = useRef(null);
  const [state, setState] = useState({ url: '', error: false });
  useLayoutEffect(() => {
    let live = true, observer, started = false;
    setState({ url: '', error: false });
    const load = () => {
      if (started) return;
      started = true;
      observer?.disconnect();
      Promise.resolve().then(() => getUrl(image.ref)).then(
        (url) => { if (live) setState({ url, error: false }); },
        () => { if (live) setState({ url: '', error: true }); }
      );
    };
    if (!eager && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) load(); }, { rootMargin: '400px 0px' });
      observer.observe(ref.current);
    } else load();
    return () => { live = false; observer?.disconnect(); };
  }, [image.ref, getUrl, eager]);
  return <><img ref={ref} hidden={state.error} src={state.url || undefined} alt={image.alt || 'Ilustracja'} decoding="async" loading={eager ? 'eager' : 'lazy'}
    onError={() => { if (state.url) setState({ url: '', error: true }); }}
    className={`${className}${state.url ? '' : ' is-loading'}`} style={state.url ? undefined : { minHeight: 100, minWidth: 120 }} aria-busy={!state.url && !state.error} />
    {state.error && <p role="status">Nie udało się wczytać obrazu.</p>}</>;
}

export function Images({ images = [], getUrl, className = 'exam-question-images' }) {
  return images.length ? <div className={className}>{images.map((image, i) => <LazyImage key={`${image.ref}:${i}`} image={image} getUrl={getUrl} />)}</div> : null;
}

export function LimitedList({ items, renderItem, pageSize = 24, label = 'elementów' }) {
  const [limit, setLimit] = useState(pageSize);
  return <>{items.slice(0, limit).map(renderItem)}{items.length > limit && <div className="react-list-more">
    <span>{Math.min(limit, items.length)} z {items.length} {label}</span>
    <button className="button mini-button" type="button" onClick={() => setLimit((value) => value + pageSize)}>Pokaż więcej</button>
  </div>}</>;
}
