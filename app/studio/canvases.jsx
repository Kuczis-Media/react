import React, { Fragment, useEffect, useState } from 'react';
import { register } from '../shared/runtime.jsx';

export function ModelInput({ value, as: Tag = 'input', ...props }) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  return <Tag {...props} value={local} onChange={(event) => setLocal(event.target.value)} />;
}
function Actions({ lesson = false, task = false, children }) {
  return <span className="node-actions">{children}{[['up', 'Przesuń wyżej', '↑'], ['down', 'Przesuń niżej', '↓'], ['duplicate', 'Duplikuj', '⧉'], ['delete', 'Usuń', '×']].filter(([action]) => !task || ['duplicate', 'delete'].includes(action)).map(([action, title, icon]) =>
    <button key={action} type="button" className={`node-action${action === 'delete' ? ' is-danger' : ''}`} {...{ [lesson ? 'data-lesson-action' : 'data-node-action']: action }} aria-label={title} title={title}>{icon}</button>)}</span>;
}
function Copy({ title, subtitle, symbol, children }) {
  return <><span className="node-symbol" aria-hidden="true">{symbol}</span><span className="node-copy"><strong>{title || 'Bez treści'}</strong><small>{subtitle}</small>{children}</span></>;
}
const Drag = () => <button type="button" className="drag-handle" aria-label="Przeciągnij, aby zmienić kolejność">⠿</button>;
function DashboardDrop({ parent, index, label = 'Upuść tutaj' }) {
  return <div className="drop-zone" data-dashboard-drop-parent={parent} data-dashboard-drop-index={index}>{label}</div>;
}
function DashboardNode({ node, parent, index, model, selected, collapsed, adapters }) {
  const container = ['section', 'group'].includes(node.kind);
  const closed = collapsed.has(node.uid);
  const data = { 'data-node-uid': node.uid, 'data-node-kind': node.kind, 'data-parent-uid': parent, 'data-node-index': index, draggable: true };
  const header = <><Drag /><Copy title={adapters.title(node)} subtitle={adapters.subtitle(node)} symbol={adapters.symbol(node)}>{node.kind === 'module' && <span className="module-chip">{adapters.moduleHref(node)}</span>}</Copy>
    <Actions>{container && <>
      {node.kind === 'group' && node.navigation !== 'sequential' && <button type="button" className="node-action" data-node-action="add-organizer-child" aria-label="Dodaj organizer po kolei">+1→</button>}
      <button type="button" className="node-action dashboard-collapse-action" data-node-action="toggle-collapse" aria-expanded={!closed} aria-label={closed ? 'Rozwiń w edytorze' : 'Zwiń w edytorze'}>{closed ? '⌄' : '⌃'}</button>
    </>}</Actions></>;
  if (!container) return <article {...data} data-node-type={node.kind === 'module' ? node.module : node.kind} className={`block-node${selected === node.uid ? ' is-selected' : ''}`}>
    {header}
  </article>;
  return <article {...data} className={`builder-node ${node.kind === 'section' ? 'section-node' : 'group-node'}${selected === node.uid ? ' is-selected' : ''}${closed ? ' is-editor-collapsed' : ''}${node.navigation === 'sequential' ? ' is-sequential' : ''}`}>
    <header className="node-header">{header}</header>
    {!closed && <div className={node.kind === 'section' ? 'section-body' : 'group-body'}>{node.blocks.map((child, i) => <Fragment key={child.uid}>
      <DashboardDrop parent={node.uid} index={i} /><DashboardNode node={child} parent={node.uid} index={i} model={model} selected={selected} collapsed={collapsed} adapters={adapters} />
    </Fragment>)}<DashboardDrop parent={node.uid} index={node.blocks.length} label={node.navigation === 'sequential' ? 'Dodaj kolejny krok' : 'Dodaj do środka'} /></div>}
  </article>;
}
register('studio-dashboard', ({ model, ...props }) => <>{!model.sections.length && <div className="empty-canvas" data-dashboard-drop-parent={model.uid} data-dashboard-drop-index="0"><strong>Przeciągnij tutaj pierwszą sekcję</strong><p>Możesz też kliknąć klocek w bibliotece.</p></div>}
  {model.sections.map((node, index) => <Fragment key={node.uid}><DashboardDrop parent={model.uid} index={index} label="Upuść sekcję tutaj" /><DashboardNode node={node} index={index} parent={model.uid} model={model} {...props} /></Fragment>)}
  <DashboardDrop parent={model.uid} index={model.sections.length} label="Dodaj sekcję na końcu" />
</>);

function LessonDrop({ slide, parent = '', index }) {
  return <div className="drop-zone" data-lesson-drop-kind={slide ? 'block' : 'slide'} data-lesson-slide-id={slide} data-lesson-parent-block-id={parent} data-lesson-drop-index={index}>Upuść tutaj</div>;
}
function LessonBlock({ block, slide, parent = '', index, selected, adapters }) {
  const container = ['style', 'accordion', 'answer-review'].includes(block.type);
  const nested = container ? adapters.nested(block) || [] : [];
  const header = <><Drag /><Copy title={adapters.title(block)} subtitle={adapters.subtitle(block)} symbol={adapters.symbol(block)} /><Actions lesson>
    {block.type === 'student-answer' && <button type="button" className="node-action" data-lesson-action="create-review" aria-label="Utwórz powiązany slajd z omówieniem">↳</button>}
  </Actions></>;
  return <article className={`${container ? 'builder-node group-node lesson-container' : 'lesson-block'}${block.type === 'answer-review' ? ' answer-review-builder-node' : ''}${selected === block.id ? ' is-selected' : ''}`}
    data-lesson-block-id={block.id} data-lesson-slide-id={slide.id} data-lesson-parent-block-id={parent} data-lesson-index={index} data-block-type={block.type} draggable>
    {container ? <><header className="node-header">{header}</header><div className="group-body">
      {block.type === 'answer-review' && <div className="answer-review-key-header"><strong>Klucz odpowiedzi</strong><small>AI nie uruchamia się w kreatorze.</small></div>}
      {nested.map((child, i) => <Fragment key={child.id}><LessonDrop slide={slide.id} parent={block.id} index={i} /><LessonBlock block={child} slide={slide} parent={block.id} index={i} selected={selected} adapters={adapters} /></Fragment>)}
      <LessonDrop slide={slide.id} parent={block.id} index={nested.length} />
    </div></> : header}
  </article>;
}
function LessonSlide({ slide, index, selected, adapters }) {
  const contains = (blocks) => blocks.some((block) => block.id === selected || contains(adapters.nested(block) || []));
  const selectedInside = Boolean(selected) && (slide.id === selected || slide.task?.id === selected || contains(slide.blocks));
  const [open, setOpen] = useState(index === 0 || selectedInside);
  useEffect(() => { if (selectedInside) setOpen(true); }, [selected, selectedInside]);
  return <article className={`lesson-slide${selected === slide.id ? ' is-selected' : ''}`} data-lesson-slide-id={slide.id} data-lesson-slide-index={index} draggable>
    <header className="slide-header"><Drag /><span className="slide-index">{String(index + 1).padStart(2, '0')}</span><span className="node-copy"><strong>{adapters.slideTitle(slide, index)}</strong><small>{adapters.slideSummary(slide)}</small></span>
      <Actions lesson><button type="button" className="node-action" aria-label={open ? 'Zwiń treść slajdu' : 'Rozwiń treść slajdu'} aria-expanded={open}
        onClickCapture={(event) => { event.stopPropagation(); setOpen(!open); }}>{open ? '⌃' : '⌄'}</button></Actions>
    </header>
    {open && <div className="slide-blocks">{slide.blocks.map((block, i) => <Fragment key={block.id}><LessonDrop slide={slide.id} index={i} /><LessonBlock block={block} slide={slide} index={i} selected={selected} adapters={adapters} /></Fragment>)}<LessonDrop slide={slide.id} index={slide.blocks.length} />
      {slide.task ? <article className={`lesson-block task-block${selected === slide.task.id ? ' is-selected' : ''}`} data-lesson-task-id={slide.task.id} data-lesson-slide-id={slide.id} data-block-type={`task-${slide.task.type}`}>
        <Copy title={slide.task.question || 'Pytanie bez treści'} subtitle={`Pytanie: ${slide.task.type}`} symbol="?" /><Actions lesson task />
      </article> : <section className="question-starter" data-lesson-slide-id={slide.id}><div className="question-starter-copy"><strong>Dodaj pytanie do tego slajdu</strong><small>Odpowiedzi ustawisz w formularzu.</small></div>
        <div className="question-starter-actions">{[['task-abcd', 'Quiz ABCD'], ['task-choice', 'Wybór'], ['task-gaps', 'Luki z listy'], ['task-gaps-text', 'Luki tekstowe'], ['task-text', 'Krótka odpowiedź'], ['student-answer', 'Pytanie otwarte']].map(([type, label]) => <button type="button" className="mini-button" key={type} data-lesson-quick-task={type} data-lesson-slide-id={slide.id}>{label}</button>)}</div>
      </section>}
    </div>}
  </article>;
}
register('studio-lesson', ({ model, selected, adapters }) => <>{model.slides.map((slide, index) => <Fragment key={slide.id}><LessonDrop index={index} /><LessonSlide slide={slide} index={index} selected={selected} adapters={adapters} /></Fragment>)}<LessonDrop index={model.slides.length} /></>);

register('studio-prompt', ({ points, maxLength }) => <>{points.map((point, index) => <article className="prompt-point" data-prompt-point-id={point.id} key={point.id}>
  <div className="prompt-point-header"><label className="prompt-point-number">Numer punktu<ModelInput type="number" min="1" max="9999" value={point.number} data-prompt-point-field="number" /></label><div className="prompt-point-actions">
    {[['up', '↑', 'Przenieś wyżej'], ['down', '↓', 'Przenieś niżej'], ['duplicate', '⧉', 'Duplikuj punkt'], ['delete', '×', 'Usuń punkt']].map(([action, symbol, label]) => <button key={action} type="button" data-prompt-point-action={action} aria-label={label} title={label} disabled={(action === 'up' && !index) || (action === 'down' && index === points.length - 1)}>{symbol}</button>)}
  </div></div><ModelInput as="textarea" value={point.content} maxLength={maxLength} data-prompt-point-field="content" placeholder="Instrukcja dla tego trybu pracy asystenta…" aria-label={`Treść punktu ${point.number}`} />
</article>)}</>);
