import React, { createContext, memo, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { compileDashboard, filterDashboard, materialProgress, sequenceStates } from './model.cjs';

const PAGE_SIZE = 24;
const Runtime = createContext(null);

// An isolated DOM island reuses the existing, accessible progress widget and
// reset flow. React owns the host, the legacy widget owns only its children.
const Progress = memo(function Progress({ id, className }) {
  const { progress, adapters } = useContext(Runtime);
  const host = useRef(null);
  const aggregate = materialProgress(progress, id);
  const visible = aggregate && aggregate.tracked !== false && aggregate.showProgress !== false && !(aggregate.trackedCount <= 0);
  useLayoutEffect(() => {
    const element = host.current;
    element.replaceChildren();
    if (visible && adapters.progressView) {
      element.append(adapters.progressView(aggregate.record || aggregate, { compact: true }));
      if (aggregate.record) element.append(adapters.resetButton('Resetuj', id, aggregate.title));
    }
    return () => element.replaceChildren();
  }, [aggregate, visible, adapters, id]);
  return <div ref={host} className={className} data-progress-host={id || ''} hidden={!visible} />;
});

const Card = memo(function Card({ item, sequence, parentId }) {
  const { adapters } = useContext(Runtime);
  const [opening, setOpening] = useState(false);
  const locked = sequence?.locked;
  const prerequisite = sequence?.prerequisiteTitle;
  const blockedMessage = prerequisite ? `Najpierw ukończ: ${prerequisite}` : 'Najpierw ukończ poprzedni krok.';
  const action = locked ? 'Najpierw ukończ poprzedni krok'
    : !sequence ? 'Otwórz'
      : sequence.status === 'completed' ? 'Otwórz ponownie'
        : ['opened', 'in_progress'].includes(sequence.status) ? 'Kontynuuj' : 'Rozpocznij';

  async function open(event) {
    if (locked) {
      event.preventDefault();
      adapters.onMessage(blockedMessage);
      return;
    }
    // Preserve the current sequential presentation completion policy. No AI,
    // material download, or progress request is triggered just by rendering.
    if (sequence && item.type === 'presentation' && event.button === 0
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      if (opening) return;
      setOpening(true);
      const save = adapters.sendProgress?.({ materialId: item.id, materialType: 'presentation', action: 'complete', opened: true }, { keepalive: true });
      if (save) {
        let timer;
        await Promise.race([Promise.resolve(save).catch(() => null), new Promise((resolve) => { timer = setTimeout(resolve, 1800); })]);
        clearTimeout(timer);
      }
      adapters.navigate(item.href);
      return;
    }
    if (item.id && !item.tracksItself) {
      Promise.resolve(adapters.sendProgress?.({ materialId: item.id, materialType: item.type || 'other', action: 'open', opened: true }, { keepalive: true })).catch(() => {});
    }
  }

  return <article className={`resource-card${locked ? ' is-sequence-locked' : ''}`} data-kind={item.resource.kind}
    data-progress-id={item.id || ''} data-search={item.search}
    data-sequence-parent={sequence ? parentId : undefined} data-sequence-index={sequence?.index}
    data-sequence-title={sequence ? item.title : undefined} data-sequence-locked={sequence ? String(Boolean(locked)) : undefined}
    title={locked ? blockedMessage : undefined}>
    {sequence && <span className="sequence-step" aria-label={`Krok ${sequence.index + 1} z ${sequence.total}`}>{sequence.index + 1}</span>}
    {item.external && <span className="external-mark" aria-hidden="true">↗</span>}
    <span className={`card-icon${item.resource.icon.length > 1 ? ' is-text-icon' : ''}`} aria-hidden="true">{item.resource.icon}</span>
    <h3>{item.title}</h3><p>{item.description || 'Otwórz materiał kursowy.'}</p>
    <Progress id={item.id} className="card-progress-host" />
    <span className="card-open">{opening ? 'Otwieram i zaliczam…' : action} <span aria-hidden="true">{locked ? '🔒' : '→'}</span></span>
    <a className="card-link" href={locked ? undefined : item.href} role={locked ? 'link' : undefined}
      tabIndex={locked ? 0 : undefined} aria-disabled={locked || undefined}
      aria-label={`${locked ? 'Zablokowane' : 'Otwórz'}: ${item.title}`}
      target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}
      onClick={open} onKeyDown={(event) => { if (locked && event.key === 'Enter') open(event); }} />
  </article>;
});

function CardList({ node, query, sequences }) {
  const { adapters } = useContext(Runtime);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const items = node.items.slice(0, limit);
  if (!node.items.length) return null;
  return <>
    <div className="card-grid">{items.map((item) => <Card key={item.key} item={item} sequence={sequences?.get(item.key)} parentId={node.id} />)}</div>
    {limit < node.items.length && <div className="dashboard-more">
      <span role="status">{items.length} z {adapters.resourceLabel(node.items.length)}{query ? ' pasujących do wyszukiwania' : ''}</span>
      <button type="button" className="button button-secondary" onClick={() => setLimit((value) => value + PAGE_SIZE)}
        aria-label={`Pokaż kolejne materiały: ${node.title}`}>Pokaż kolejne {Math.min(PAGE_SIZE, node.items.length - limit)}</button>
    </div>}
  </>;
}

const Notices = memo(function Notices({ values = [] }) {
  return values.map((notice, index) => <p className="section-notice" key={index}>{notice}</p>);
});

function Group({ node, query }) {
  const { adapters, progress } = useContext(Runtime);
  const sequential = node.navigation === 'sequential';
  const [opened, setOpened] = useState(sequential);
  const open = Boolean(query) || opened;
  const sequences = useMemo(() => sequential ? sequenceStates(node, progress) : null, [node, progress, sequential]);
  function toggle(event) {
    // Handle the summary click explicitly: browser toggle events also fire on
    // initial mount and search expansion, which must not record user activity.
    event.preventDefault();
    if (query) return;
    const next = !opened;
    setOpened(next);
    if (next && node.id) Promise.resolve(adapters.openGroup?.({ materialId: node.id, materialType: node.type || 'other' })).catch(() => {});
  }
  const hidden = Boolean(query) && node.count === 0;
  return <details className={`resource-accordion${sequential ? ' is-sequential' : ''}`} open={open} hidden={hidden}
    data-progress-id={node.id || ''} data-accordion-depth={node.depth}>
    <summary onClick={toggle} aria-expanded={open}>
      <span className="accordion-copy"><strong>{node.title}</strong>
        {node.description?.length > 0 && <span>{node.description.join(' ')}</span>}
        {sequential && <span className="sequence-label">Po kolei</span>}
      </span>
      <span className="accordion-meta"><span data-accordion-total={node.total}>{query ? `${node.count} z ${node.total}` : adapters.resourceLabel(node.total)}</span>
        <span className="accordion-chevron" aria-hidden="true">⌄</span></span>
    </summary>
    {open && !hidden && <div className="accordion-body">
      <Progress id={node.id} className="container-progress-host" />
      <Notices values={node.notices} />
      <CardList key={`${node.key}:${query}`} node={node} query={query} sequences={sequences} />
      {node.groups.length > 0 && <div className="accordion-children">{node.groups.map((child) => <Group key={child.key} node={child} query={query} />)}</div>}
      {!node.items.length && !node.groups.length && <div className="empty-section">Materiały w tej liście pojawią się wkrótce.</div>}
    </div>}
  </details>;
}

const Section = memo(function Section({ node, query }) {
  const { adapters } = useContext(Runtime);
  const hidden = Boolean(query) && node.count === 0;
  return <section className="course-section" id={node.anchor} data-progress-id={node.id || ''} hidden={hidden}>
    <div className="section-heading"><div><h2>{node.title}</h2>
      {node.description?.length > 0 && <p>{node.description.join(' ')}</p>}
      <Progress id={node.id} className="section-progress-host" />
    </div><span className="section-total" data-section-total={node.total}>{query ? `${node.count} z ${node.total}` : adapters.resourceLabel(node.total)}</span></div>
    {!hidden && <>
      <Notices values={node.notices} />
      <CardList key={`${node.key}:${query}`} node={node} query={query} />
      {node.groups.map((group) => <Group key={group.key} node={group} query={query} />)}
      {!node.total && !node.groups.length && <div className="empty-section">Materiały w tym dziale pojawią się wkrótce.</div>}
    </>}
  </section>;
});

function Dashboard({ view, progress, adapters }) {
  const runtime = useMemo(() => ({ progress, adapters }), [progress, adapters]);
  useLayoutEffect(() => { adapters.onFiltered(view.count, view.total, Boolean(view.query)); });
  return <Runtime.Provider value={runtime}>{view.sections.map((node) => <Section key={node.key} node={node} query={view.query} />)}</Runtime.Provider>;
}

export function mountDashboard(container, model, adapters) {
  const compiled = compileDashboard(model, adapters);
  let view = filterDashboard(compiled, ''), progress = null, timer = null, destroyed = false;
  const root = createRoot(container, { onUncaughtError: (error) => adapters.onError?.(error) });
  function render(synchronous = false) {
    if (destroyed) return;
    const draw = () => root.render(<Dashboard view={view} progress={progress} adapters={adapters} />);
    if (synchronous) flushSync(draw); else draw();
  }
  // Section anchors must exist before the existing hash navigation runs.
  render(true);
  return {
    sections: compiled.sections.map((node) => ({ id: node.anchor, title: node.title, cardCount: node.total })),
    total: compiled.total,
    search(query, immediate = false) {
      clearTimeout(timer);
      const apply = () => { if (!destroyed) { view = filterDashboard(compiled, query); render(immediate); } };
      // Clearing must be synchronous for sidebar/hash navigation. Typing is
      // coalesced and queries run on the complete index, not the mounted DOM.
      if (immediate || !query.trim()) apply(); else timer = setTimeout(apply, 120);
    },
    setProgress(state) { progress = state; render(); },
    destroy() { destroyed = true; clearTimeout(timer); root.unmount(); }
  };
}
