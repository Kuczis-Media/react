import React from 'react';
import { register, LimitedList } from '../shared/runtime.jsx';

register('studio-exam-review-roster', ({ users, selected, busy, loading, more, onOpen, onMore }) => <>
  <p className="exam-review-count" role="status">{loading ? 'Wczytuję listę…' : `${users.length} pasujących uczniów we wczytanej liście`}</p>
  <LimitedList items={users} label="uczniów" renderItem={(user) => <button type="button" key={user.userId}
    className={`exam-review-user${selected === user.userId ? ' is-selected' : ''}`} aria-pressed={selected === user.userId}
    disabled={busy} onClick={() => onOpen(user.userId)} data-review-user={user.userId}>
    <strong>{user.profile?.name || user.profile?.email || user.userId}</strong>
    {user.profile?.name && user.profile?.email && <small>{user.profile.email}</small>}
    <span>{user.pending ? `Do sprawdzenia: ${user.pending}` : 'Brak oczekujących ocen'} · prób na liście: {user.count}</span>
  </button>} />
  {!users.length && !loading && <p>Brak pasujących prób. Zmień filtr lub wczytaj kolejną część listy.</p>}
  {more && <button type="button" className="button button-soft" disabled={loading} onClick={onMore} data-review-more>Wczytaj kolejnych</button>}
</>);
