import React, { useState, useEffect, useCallback } from 'react';
import { register, LazyImage, LimitedList, Widget } from '../shared/runtime.jsx';

function EducationalText({ value, getUrl }) {
  return window.ChemQuizFlashcards ? <Widget factory={() => window.ChemQuizFlashcards.text(value, getUrl)} revision={value} /> : <span>{value}</span>;
}
function ImageOcclusion({ question, getUrl }) {
  // Loading more quiz questions must not redraw a random mask or hide an
  // answer already uncovered in this card.
  const factory = useCallback(() => window.ChemQuizOcclusion.player(question, getUrl), [question, getUrl]);
  return <Widget factory={factory} revision={question.questionId} />;
}
function QuizQuestion({ question: q, index, answers, results, locked, onAnswer, getUrl, showExplanation = true }) {
  const incoming = answers[q.questionId] ?? (['open', 'text'].includes(q.type) ? '' : []);
  const [value, setValue] = useState(incoming);
  const signature = JSON.stringify(incoming);
  useEffect(() => setValue(incoming), [signature]);
  const result = results[q.questionId];
  const pending = result?.reviewStatus === 'pending', ungraded = result?.reviewStatus === 'not_scored';
  const tone = result && !pending && !ungraded ? result.correct ? 'is-correct' : 'is-wrong' : '';
  function change(next) { if (locked) return; setValue(next); onAnswer(q.questionId, next); }
  const text = ['open', 'text'].includes(q.type);
  const Tag = q.type === 'text' || (q.type === 'open' && q.multiline !== false) ? 'textarea' : 'input';
  if (q.type === 'image_occlusion') return <ImageOcclusion question={q} getUrl={getUrl} />;
  if (q.type === 'flashcard') return <Widget factory={() => window.ChemQuizFlashcards.card(q, getUrl)} revision={q.questionId} />;
  return <fieldset className={`quiz-player-question ${tone}`} data-question-id={q.questionId}>
    <div className="quiz-player-question-heading"><span>Pytanie {index + 1}</span><span>{q.type === 'open' && q.gradingMode === 'ungraded' ? 'bez punktów' : `${q.points} pkt`}</span></div>
    <div className="quiz-player-prompt"><EducationalText value={q.prompt} getUrl={getUrl} /></div>
    {q.image?.ref && <LazyImage image={q.image} getUrl={getUrl} />}
    {text ? <Tag className={`quiz-player-text${q.type === 'open' ? ' quiz-player-open-answer' : ''}`} type={Tag === 'input' ? 'text' : undefined}
      rows={Tag === 'textarea' ? q.type === 'open' ? 7 : 2 : undefined} value={value} maxLength={q.type === 'open' ? 8000 : 500} disabled={locked}
      autoComplete="off" data-answer-text="1" aria-label={`Odpowiedź: ${q.prompt}`} placeholder="Wpisz odpowiedź…" onChange={(e) => change(e.target.value)} />
      : q.options.map((option) => <label className="quiz-player-option" key={option.optionId}>
        <input type={q.type === 'multiple' ? 'checkbox' : 'radio'} name={`quiz-answer-${q.questionId}`} value={option.optionId} disabled={locked}
          checked={Array.isArray(value) && value.includes(option.optionId)} onChange={(e) => change(q.type === 'multiple' ? e.target.checked ? [...value, option.optionId] : value.filter((id) => id !== option.optionId) : [option.optionId])} />
        <EducationalText value={option.text} getUrl={getUrl} />{option.image?.ref && <LazyImage image={option.image} getUrl={getUrl} />}</label>)}
    {text && window.ChemAssessmentEditor && <button type="button" disabled={locked} className="quiz-player-button is-secondary assessment-equation-trigger"
      onMouseDown={(e) => e.preventDefault()} onClick={(e) => window.ChemAssessmentEditor.openFor(e.currentTarget.closest('fieldset').querySelector('[data-answer-text]'))}>fx · Dodaj równanie</button>}
    <p className={`quiz-player-feedback ${tone}`} hidden={!result}>{result && (pending ? 'Odpowiedź zapisana — oczekuje na ocenę.' : ungraded ? 'Odpowiedź zapisana — to pytanie nie wpływa na wynik.'
      : result.message || `${result.correct ? 'Poprawnie' : 'Ocena częściowa lub niepoprawna'} · ${result.points}/${result.maximum} pkt${result.feedback ? ` — ${result.feedback}` : result.explanation ? ` — ${result.explanation}` : ''}`)}</p>
    {result && q.type !== 'open' && window.ChemQuizFlashcards && window.ChemQuizPractice ? <Widget factory={() => window.ChemQuizFlashcards.feedback(q, result.practice || (result.comparison || result.optionStates ? result : window.ChemQuizPractice.evaluate(q, value)), getUrl, showExplanation)} revision={JSON.stringify([result, value])} /> : result?.correctAnswers?.length > 0 && <div className="quiz-player-answer-key" data-local-answer-key="1">
      <strong>{q.type === 'text' ? 'Akceptowane odpowiedzi' : 'Poprawne odpowiedzi'}</strong>
      <ul>{result.correctAnswers.map((answer, index) => <li key={index}>{answer}</li>)}</ul>
    </div>}
  </fieldset>;
}
register('quiz-questions', ({ questions, revealId, ...props }) => {
  const minimum = revealId ? Math.ceil((questions.findIndex((q) => q.questionId === revealId) + 1) / 24) * 24 : 24;
  return <LimitedList key={revealId || 'questions'} items={questions} pageSize={Math.max(24, minimum)} label="pytań" renderItem={(q, index) => <QuizQuestion key={q.questionId} question={q} index={index} {...props} />} />;
});
register('quiz-result', ({ score, title, message, onRefresh }) => <><strong>{score}</strong><div><h2>{title}</h2><p>{message}</p>
  {onRefresh && <button type="button" className="quiz-player-button is-secondary" onClick={(event) => onRefresh(event.currentTarget)}>Odśwież wynik</button>}
</div></>);
register('quiz-deck', (props) => <Widget factory={() => window.ChemQuizFlashcards.study(props)} revision={props.questions} />);
