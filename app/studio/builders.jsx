import React, { useState } from 'react';
import { register, Widget } from '../shared/runtime.jsx';
import { ModelInput } from './canvases.jsx';

register('studio-exam-list', ({ questions, selected, labels, bank = false, references = [] }) => <>{questions.map(({ question, reference = false }, index) => {
  const id = question.questionId;
  const actions = bank ? [['use-bank-question', references.includes(id) ? 'Dodane' : 'Dodaj do egzaminu'], ['duplicate-bank-question', 'Duplikuj'], ['delete-bank-question', 'Usuń']]
    : reference ? [['remove-bank-reference', 'Usuń odwołanie']] : [['duplicate-question', 'Duplikuj'], ['delete-question', 'Usuń']];
  return <article key={`${id}:${reference}`} className={`exam-question-card${selected.includes(id) ? ' is-selected' : ''}`}>
    <button type="button" className="exam-question-select" data-exam-action={bank ? 'select-bank-question' : reference ? 'select-bank-reference' : 'select-question'} data-question-id={id}>
      <small>{index + 1}. {labels[question.type] || question.type}{reference ? ' · bank' : ''}</small><strong>{question.prompt || question.template || id}</strong>
    </button><span className="exam-question-actions">{actions.map(([action, label]) => <button key={action} type="button" className={`mini-button${/delete|remove/.test(action) ? ' is-danger' : ''}`}
      data-exam-action={action} data-question-id={id} disabled={action === 'use-bank-question' && references.includes(id)}>{label}</button>)}</span>
  </article>;
})}</>);

function Field({ label, children, className, math = false, hidden = false }) {
  const field = <label className={className} hidden={hidden}><span>{label}</span>{children}</label>;
  return math ? <div className="quiz-math-field">{field}<button type="button" className="mini-button assessment-equation-trigger" aria-label={`Dodaj równanie: ${label}`}
    onMouseDown={(e) => e.preventDefault()} onClick={(e) => window.ChemAssessmentEditor?.openFor(e.currentTarget.parentElement.querySelector('textarea,input'))}>fx · Dodaj równanie</button></div> : field;
}
function QuizCard({ question, index, count, renderOptions, renderFlashcard, renderOcclusion, deck, focusQuestionId }) {
  const [open, setOpen] = useState(index < 3 || question.questionId === focusQuestionId);
  return <article className="quiz-question-card" data-question-id={question.questionId}>
    <header className="quiz-question-card-heading"><div><small>{question.type === 'flashcard' ? 'Fiszka' : 'Pytanie'} {index + 1}</small><strong>{['flashcard', 'image_occlusion'].includes(question.type) || deck ? 'Nauka bez punktów' : `${question.points} ${question.points === 1 ? 'punkt' : 'pkt'}`}</strong></div>
      <div className="quiz-question-actions"><button type="button" className="mini-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Zwiń' : 'Edytuj'}</button>
        {[['preview-question', 'Podgląd', 'Podgląd tej karty', false], ['up', '↑', 'Przenieś wyżej', index === 0], ['down', '↓', 'Przenieś niżej', index === count - 1], ['duplicate', 'Duplikuj', 'Duplikuj', false], ['delete', 'Usuń', 'Usuń', count === 1]].map(([action, text, label, disabled]) =>
          <button type="button" key={action} className={`mini-button${action === 'delete' ? ' is-danger' : ''}`} data-quiz-action={action} aria-label={label} disabled={disabled}>{text}</button>)}
      </div></header>
    {!open ? <p>{question.prompt || 'Nowe pytanie'}</p> : question.type === 'image_occlusion' ? <Widget factory={() => renderOcclusion(question)} revision={JSON.stringify(question)} /> : question.type === 'flashcard' ? <Widget factory={() => renderFlashcard(question)} revision={JSON.stringify(question)} /> : <>
      <div className="quiz-question-controls"><Field label="Rodzaj"><ModelInput as="select" className="quiz-question-type" data-quiz-field="type" value={question.type}>
        {[['single', 'Jedna odpowiedź'], ['multiple', 'Wiele odpowiedzi'], ['true_false', 'Prawda / fałsz'], ['text', 'Odpowiedź tekstowa'], ['open', 'Pytanie otwarte'], ['flashcard', 'Fiszka'], ['image_occlusion', 'Obraz z maskami']].filter(([value]) => !deck || window.ChemQuizPractice.DECK_TYPES.includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </ModelInput></Field><Field label="Punkty" hidden={deck}><ModelInput type="number" min="0" max="10000" step="0.1" value={question.points} data-quiz-field="points" /></Field>
        <Field label="Wymagane" className="quiz-inline-check" hidden={deck}><input type="checkbox" defaultChecked={question.required} key={String(question.required)} data-quiz-field="required" /></Field></div>
      <Field label="Treść pytania" math><ModelInput as="textarea" rows="3" maxLength="3000" value={question.prompt} data-quiz-field="prompt" /></Field>
      <div className="quiz-question-media"><div><small>Obraz do pytania</small><code>{question.image.ref || 'Brak obrazu'}</code></div>
        <button className="mini-button" type="button" data-quiz-action="select-media">Wybierz obraz</button><button className="mini-button is-danger" type="button" data-quiz-action="remove-media" disabled={!question.image.ref}>Usuń obraz z pytania</button></div>
      <Widget factory={() => renderOptions(question, index)} revision={JSON.stringify(question)} />
      <Field label="Informacja zwrotna / wyjaśnienie" math><ModelInput as="textarea" rows="2" maxLength="3000" value={question.explanation} data-quiz-field="explanation" placeholder="Opcjonalne wyjaśnienie po sprawdzeniu" /></Field>
    </>}
  </article>;
}
register('studio-quiz', ({ questions, renderOptions, renderFlashcard, renderOcclusion, deck, focusQuestionId }) => <>{questions.map((question, index) => <QuizCard key={question.questionId} question={question} index={index} count={questions.length} renderOptions={renderOptions} renderFlashcard={renderFlashcard} renderOcclusion={renderOcclusion} deck={deck} focusQuestionId={focusQuestionId} />)}</>);

register('studio-presentation-slides', ({ slides, selected, onAction, onMove }) => <>{slides.map((slide, index) => <article key={slide.slideId} className={`presentation-slide-row${selected === slide.slideId ? ' is-selected' : ''}`}
  data-slide-id={slide.slideId} data-slide-index={index} draggable onDragStart={(event) => event.dataTransfer.setData('text/presentation-slide', slide.slideId)} onDragOver={(event) => event.preventDefault()}
  onDrop={(event) => { event.preventDefault(); onMove(event.dataTransfer.getData('text/presentation-slide'), index); }}>
  <span className="presentation-slide-number">{index + 1}</span><button type="button" className="presentation-slide-thumb" style={{ background: slide.backgroundType === 'gradient' ? `linear-gradient(${slide.gradientAngle}deg, ${slide.gradientFrom}, ${slide.gradientTo})` : slide.background }}
    onClick={() => onAction('select', slide.slideId)}><span>{slide.title}</span></button>
  <div className="presentation-slide-actions">{[['up', '↑', 'Przesuń wyżej', !index], ['down', '↓', 'Przesuń niżej', index === slides.length - 1], ['duplicate', '⧉', 'Duplikuj', false], ['delete', '×', 'Usuń', slides.length < 2]].map(([action, text, label, disabled]) =>
    <button type="button" key={action} aria-label={label} title={label} className={action === 'delete' ? 'is-danger' : ''} disabled={disabled} onClick={() => onAction(action, slide.slideId)}>{text}</button>)}</div>
</article>)}</>);

register('studio-landing-sections', ({ sections, selected, labels, onSelect, onMove, onReorder }) => <>{sections.map((section, index) => <article key={section.id} className={`section-item${section.id === selected ? ' is-selected' : ''}${section.enabled ? '' : ' is-disabled'}`}
  data-section-id={section.id} draggable onDragStart={(event) => event.dataTransfer?.setData('text/nextmed-section', section.id)} onDragOver={(event) => event.preventDefault()}
  onDrop={(event) => { event.preventDefault(); onReorder(event.dataTransfer?.getData('text/nextmed-section'), section.id); }}>
  <span className="section-drag" title="Przeciągnij sekcję">⠿</span><button type="button" className="section-select" onClick={() => onSelect(section.id)}><strong>{labels[section.id] || section.id}</strong><small>{section.title || 'Bez tytułu'}</small></button>
  <span className="section-order">{[-1, 1].map((offset) => <button type="button" key={offset} aria-label={offset < 0 ? 'Przenieś wyżej' : 'Przenieś niżej'} disabled={index + offset < 0 || index + offset >= sections.length} onClick={() => onMove(index, index + offset)}>{offset < 0 ? '↑' : '↓'}</button>)}</span>
</article>)}</>);
