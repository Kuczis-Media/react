import React, { useState, useEffect } from 'react';
import { register, RichText, Images, LimitedList } from '../shared/runtime.jsx';

function Answer({ question: q, value, change, disabled, getUrl }) {
  const common = { disabled, 'data-answer-input': '1' };
  if (q.options) {
    const multiple = q.type === 'multiple_choice';
    return <fieldset className="exam-options" aria-label="Odpowiedzi">{q.options.map((option) => <label className="exam-option" key={option.answerId}>
      <input {...common} type={multiple ? 'checkbox' : 'radio'} name={`answer-${q.questionId}`} value={option.answerId}
        checked={multiple ? Array.isArray(value) && value.includes(option.answerId) : value === option.answerId}
        onChange={(e) => change(multiple ? e.target.checked ? [...(value || []), option.answerId] : (value || []).filter((id) => id !== option.answerId) : option.answerId)} />
      <div>{option.text}</div><Images images={option.images} getUrl={getUrl} className="exam-answer-images" />
    </label>)}</fieldset>;
  }
  if (['short_text', 'number', 'open_answer'].includes(q.type)) {
    const multiline = q.type === 'open_answer' && q.multiline !== false;
    const Tag = multiline ? 'textarea' : 'input';
    return <Tag {...common} className={`exam-text-answer${q.type === 'open_answer' ? ' exam-open-answer' : ''}`} type={multiline ? undefined : 'text'}
      rows={multiline ? 7 : undefined} inputMode={q.type === 'number' ? 'decimal' : 'text'} autoComplete="off" value={value ?? ''}
      maxLength={q.type === 'open_answer' ? 8000 : undefined} aria-label="Twoja odpowiedź" onChange={(e) => change(e.target.value)} />;
  }
  if (q.type === 'matching') return <div className="exam-matching">
    <div className="exam-matching-answer-legend">{q.right.filter((item) => item.images?.length).map((item) => <div key={item.answerId}><strong>{item.text}</strong><Images images={item.images} getUrl={getUrl} className="exam-answer-images" /></div>)}</div>
    {q.left.map((left) => <label key={left.pairId}><div>{left.text}<Images images={left.images} getUrl={getUrl} className="exam-answer-images" /></div>
      <select {...common} data-match-left={left.pairId} value={value?.[left.pairId] || ''} onChange={(e) => change({ ...(value || {}), [left.pairId]: e.target.value })}>
        <option value="">Wybierz dopasowanie…</option>{q.right.map((right) => <option key={right.answerId} value={right.answerId}>{right.text}</option>)}
      </select></label>)}
  </div>;
  if (q.type === 'ordering') {
    const order = Array.isArray(value) && value.length === q.items.length ? value : q.items.map((item) => item.itemId);
    return <div className="exam-ordering">{order.map((id, index) => {
      const item = q.items.find((entry) => entry.itemId === id);
      if (!item) return null;
      return <div className="exam-order-item" data-item-id={id} key={id}><strong>{index + 1}</strong><div>{item.text}<Images images={item.images} getUrl={getUrl} className="exam-answer-images" /></div>
        <span>{[-1, 1].map((offset) => <button type="button" key={offset} disabled={disabled || index + offset < 0 || index + offset >= order.length}
          aria-label={offset < 0 ? 'Przesuń wyżej' : 'Przesuń niżej'} onClick={() => { const next = order.slice(); [next[index], next[index + offset]] = [next[index + offset], next[index]]; change(next); }}>{offset < 0 ? '↑' : '↓'}</button>)}</span>
      </div>;
    })}</div>;
  }
  let blankIndex = 0;
  return <div className="exam-blanks"><p className="exam-blank-sentence">{String(q.template || '').split(/(\{\{[^{}]*\}\})/).map((part, index) => {
    if (!/^\{\{[^{}]*\}\}$/.test(part)) return part;
    const blank = q.blanks[blankIndex++];
    return blank ? <input {...common} key={index} className="exam-text-answer" data-blank-id={blank.blankId} value={value?.[blank.blankId] || ''}
      placeholder={part.slice(2, -2)} aria-label={`Luka ${blankIndex}`} onChange={(e) => change({ ...(value || {}), [blank.blankId]: e.target.value })} /> : null;
  })}</p></div>;
}

function DisplayAnswer({ label, values }) {
  return Array.isArray(values) ? <div className="exam-result-answer"><small>{label}</small><RichText value={values.length ? values.join('\n') : 'Brak odpowiedzi'} format={{ size: 'small' }} /></div> : null;
}
function Feedback({ feedback }) {
  if (feedback.deferred) return <div className="exam-immediate-feedback is-deferred"><strong>{feedback.message || 'Odpowiedź zapisana. Ocena pojawi się po zakończeniu.'}</strong></div>;
  return <div className={`exam-immediate-feedback ${feedback.correct ? 'is-correct' : 'is-incorrect'}`}><strong>{feedback.correct ? 'Odpowiedź poprawna' : 'Odpowiedź niepoprawna'}</strong>
    <DisplayAnswer label="Prawidłowa odpowiedź" values={feedback.correctAnswerDisplay} /><RichText value={feedback.explanation} as="p" />
  </div>;
}
function Question({ question, index, attempt, getUrl, onAnswer, onConfirm, typeLabel }) {
  const incoming = attempt.answers[question.questionId];
  const [value, setValue] = useState(incoming);
  const signature = JSON.stringify(incoming);
  useEffect(() => { setValue(incoming); }, [signature]);
  const confirmed = attempt.confirmedQuestionIds?.includes(question.questionId);
  const timedOut = attempt.timedOutQuestionIds?.includes(question.questionId);
  const immediate = attempt.exam.resultVisibility?.feedbackMode === 'immediate';
  function change(next) { if (confirmed || timedOut) return; setValue(next); onAnswer(question.questionId, next); }
  return <article className="exam-question" data-question-id={question.questionId} data-question-index={index}>
    <small>{index + 1}. {typeLabel(question.type)}</small><RichText as="h2" value={question.prompt || question.template} format={question.promptFormat} />
    <Images images={question.images} getUrl={getUrl} /><Answer question={question} value={value} change={change} disabled={confirmed || timedOut} getUrl={getUrl} />
    {immediate && <div className="exam-question-check"><button type="button" className="exam-button is-primary" data-confirm-question={question.questionId} disabled={confirmed || timedOut} onClick={() => onConfirm(question.questionId)}>{confirmed ? 'Odpowiedź zatwierdzona' : 'Zatwierdź i sprawdź odpowiedź'}</button></div>}
    {immediate && confirmed && attempt.immediateFeedback?.[question.questionId] && <Feedback feedback={attempt.immediateFeedback[question.questionId]} />}
    {timedOut && <p className="exam-message">Czas na to pytanie minął. Odpowiedź jest zablokowana.</p>}
  </article>;
}
register('exam-questions', ({ indices, attempt, ...adapters }) => <>{indices.map((index) => <Question key={`${attempt.attemptId}:${attempt.questions[index].questionId}`} question={attempt.questions[index]} index={index} attempt={attempt} {...adapters} />)}</>);
register('exam-navigator', ({ attempt, visible, blocked, answerPresent, onNavigate }) => <>{attempt.questions.map((q, index) => <button type="button" key={q.questionId} data-question-index={index}
  aria-label={`Pytanie ${index + 1}`} aria-current={visible.includes(index) ? 'step' : 'false'}
  className={[visible.includes(index) && 'is-current', answerPresent(attempt.answers[q.questionId]) && 'is-answered', attempt.flags.includes(q.questionId) && 'is-flagged'].filter(Boolean).join(' ')}
  disabled={blocked || (!attempt.exam.navigation.allowFreeNavigation && index > attempt.highestReachedIndex + 1)} onClick={() => onNavigate(index)}>{index + 1}</button>)}</>);
register('exam-results', ({ questions }) => <LimitedList items={questions} label="pytań" renderItem={(q, index) => <article className="exam-result-question" key={q.questionId || index}>
  <RichText as="strong" value={`${index + 1}. ${q.prompt}`} format={q.promptFormat} />
  {Object.hasOwn(q, 'correct') && <small>{q.correct ? 'Odpowiedź poprawna' : 'Odpowiedź niepoprawna'}</small>}
  {q.reviewStatus === 'pending' && <small>Oczekuje na ocenę sprawdzającego</small>}{q.reviewStatus === 'not_scored' && <small>Pytanie nie wpływa na wynik</small>}
  {q.points != null && q.maxPoints != null && <small>{q.points}/{q.maxPoints} pkt</small>}
  <DisplayAnswer label="Twoja odpowiedź" values={q.answerDisplay} /><DisplayAnswer label="Prawidłowa odpowiedź" values={q.correctAnswerDisplay} />
  <RichText value={q.feedback} /><RichText value={q.explanation} />
</article>} />);
register('exam-history', ({ attempts, onResume, onResult }) => <>{attempts.slice().reverse().map((a) => <button type="button" key={a.attemptId} onClick={() => a.status === 'active' ? onResume(a.attemptId) : onResult(a.attemptId)}>
  <strong>Próba {a.number}</strong><span>{a.status === 'active' ? 'Wznów' : a.gradingStatus === 'pending_review' ? 'Oczekuje na ocenę' : a.gradingStatus === 'not_scored' ? 'Bez punktacji' : a.scorePercent == null ? 'Wynik ukryty' : `${a.scorePercent}%${a.passed == null ? '' : a.passed ? ' · zaliczona' : ' · niezaliczona'}`}</span>
</button>)}</>);
