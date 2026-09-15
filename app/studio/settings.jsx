import React, { useCallback, useEffect, useState } from 'react';
import { register, LimitedList, Widget } from '../shared/runtime.jsx';
import { ModelInput } from './canvases.jsx';

function UserEditor({ user, renderUser }) {
  const factory = useCallback(() => renderUser(user), [user, renderUser]);
  return <Widget factory={factory} />;
}
register('studio-admin-users', ({ users, query, renderUser }) => <LimitedList key={query} items={users} label="użytkowników"
  renderItem={(user) => <UserEditor key={user.id} user={user} renderUser={renderUser} />} />);

const entryIds = new WeakMap();
let nextId = 0;
const entryId = (entry) => { if (!entryIds.has(entry)) entryIds.set(entry, ++nextId); return entryIds.get(entry); };
function EnvRow({ entry, index, onChange, onRemove, looksSecret }) {
  const [name, setName] = useState(entry.name || '');
  const [value, setValue] = useState(entry.value || '');
  const [revealed, setRevealed] = useState(false);
  const [secret, setSecret] = useState(entry.secret);
  useEffect(() => { setName(entry.name || ''); setValue(entry.value || ''); setSecret(entry.secret); setRevealed(false); }, [entry.name, entry.value, entry.secret]);
  function rename(next) {
    const hidden = secret || looksSecret(next.trim());
    setName(next); setSecret(hidden); setRevealed(false);
    onChange(entry, { name: next.trim(), secret: hidden });
  }
  function changeValue(next) { setValue(next); onChange(entry, { value: next }); }
  return <article className="env-row" data-index={index}>
    <div className="env-row-meta"><span className="env-group">{entry.group || 'Własna'}</span><strong className="env-label">{name || 'Nowa zmienna'}</strong><small className="env-description">{entry.description || 'Własna zmienna środowiskowa.'}</small></div>
    <label><span>Nazwa</span><input className="env-name" type="text" maxLength="120" spellCheck={false} autoComplete="off" value={name} readOnly={entry.name === 'GIT_PROVIDER'} onChange={(event) => rename(event.target.value)} /></label>
    <label><span>Wartość</span><span className="value-field">{entry.name === 'GIT_PROVIDER'
      ? <select className="env-value" aria-label="Provider repozytoriów" value={value} onChange={(event) => changeValue(event.target.value)}><option value="">Wybierz dostawcę</option><option value="gitea">Gitea</option><option value="github">GitHub</option></select>
      : <input className="env-value" type={secret && !revealed ? 'password' : 'text'} maxLength="20000" spellCheck={false} autoComplete="new-password" value={value} onChange={(event) => changeValue(event.target.value)} />}
      <button className="reveal-button" type="button" hidden={!secret} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? 'Ukryj' : 'Pokaż'}</button></span></label>
    <button className="remove-button" type="button" aria-label="Usuń zmienną" onClick={() => onRemove(entry)}>×</button>
  </article>;
}
register('studio-env', ({ entries, ...props }) => <>{entries.map((entry, index) => <EnvRow key={entryId(entry)} entry={entry} index={index} {...props} />)}</>);

register('studio-progress-users', ({ users, percent, dateLabel, onSelect }) => <>{users.map((user) => <button key={user.id} type="button" className="admin-progress-user" onClick={() => onSelect(user.id)}>
  <span><strong>{user.name || user.email || user.id}</strong><small>{user.email || 'Brak e-maila'} · {user.id}</small></span>
  <span className="admin-progress-user-stats"><strong>{percent(user.progressPercent)}</strong><small>{user.completed} ukończonych · {user.started} rozpoczętych · {user.notOpened} nieotwartych</small></span>
  <time>{dateLabel(user.lastActivityAt, 'Brak aktywności')}</time>
</button>)}</>);

register('studio-ai-table', ({ rows = [], reset, label, cost, onLimits, onDetail, onReset }) => <div className="admin-ai-table-scroll"><table className="admin-ai-usage-table">
  <thead><tr>{['Nazwa / ID', 'Żądania', 'OK', 'Błędy', 'Wejście', 'Wyjście', 'Łącznie', 'Śr./request', 'Koszt', ...(reset ? ['Limit bazowy', 'Użycie bazowe', 'Akcje'] : [])].map((text) => <th key={text}>{text}</th>)}</tr></thead>
  <tbody>{rows.map((row, index) => {
    const average = row.avgTokensPerRequest ?? (row.requests ? Math.round(Number(row.totalTokens || 0) / row.requests) : 0);
    const values = [label ? label(row) : row.id, row.requests || 0, row.successfulRequests || 0, row.errors || 0, row.inputTokens || 0, row.outputTokens || 0, row.totalTokens || 0, average, cost(row.estimatedCostMicros),
      ...(reset ? [row.mode === 'disabled' ? 'wyłączone' : row.limit ?? '∞', `${Number(row.usagePercent || 0)}%`] : [])];
    return <tr key={row.userId || row.id || index} data-warning={row.warning?.level || 'ok'}>{values.map((value, i) => { const Tag = i ? 'td' : 'th'; return <Tag key={i}>{typeof value === 'number' ? value.toLocaleString('pl-PL') : String(value || '—')}</Tag>; })}
      {reset && <td><button type="button" className="button button-secondary" onClick={() => onLimits(row.userId)}>Limity</button><button type="button" className="button button-secondary" onClick={() => onDetail(row)}>Szczegóły</button><button type="button" className="button button-secondary button-danger-soft" onClick={() => onReset(row.userId)}>Wyzeruj</button></td>}
    </tr>;
  })}{!rows.length && <tr><td colSpan={reset ? 12 : 9}>Brak danych w tym okresie.</td></tr>}</tbody>
</table></div>);

register('studio-ai-limit-grid', ({ metrics, periods, values, disabled, selection, labels, periodLabels }) => <table className="admin-ai-limit-table"><thead><tr><th>Metryka</th>{periods.map((period) => <th key={period}>{periodLabels[period]}</th>)}</tr></thead>
  <tbody>{metrics.map((metric) => <tr key={metric}><th>{labels[metric]}</th>{periods.map((period) => <td key={period}><ModelInput key={selection} type="number" min="0" step="1" className="text-field" disabled={disabled}
    data-ai-limit-metric={metric} data-ai-limit-period={period} value={values?.[metric]?.[period] ?? ''} aria-label={`${labels[metric]} — ${periodLabels[period]}`} /></td>)}</tr>)}</tbody>
</table>);

// Uncontrolled form fields retain the existing validation, currency conversion,
// permission checks and submit handler. Only their markup is React-owned.
register('studio-price-fields', () => <>{[['hour', '1 godzina'], ['day', '1 dzień'], ['week', '1 tydzień'], ['month', '1 miesiąc'], ['halfyear', 'pół roku'], ['year', '1 rok']].map(([id, label]) => <div className="admin-price-plan" key={id}>
  <label className="admin-plan-enabled"><input id={`admin-enabled-${id}`} type="checkbox" /> Dostępny: {label}</label>
  <label><span className="field-label">Cena</span><input className="text-field" id={`admin-price-${id}`} name={id} type="number" min="1" max="10000" step="0.01" inputMode="decimal" required /></label>
</div>)}</>);
