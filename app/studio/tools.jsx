import React, { useEffect, useState } from 'react';
import { register } from '../shared/runtime.jsx';

const normalize = (value) => String(value || '').toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const categories = [['all', 'Wszystkie'], ['content', 'Tworzenie treści'], ['appearance', 'Wygląd platformy'], ['management', 'Zarządzanie']];
// Trusted inline icon primitives from the existing HTML catalog, not raw HTML.
function Icon({ node }) {
  if (!node || !['svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(node.tag)) return null;
  return React.createElement(node.tag, node.attrs, node.children?.map((child, index) => <Icon key={index} node={child} />));
}
register('studio-tools', ({ cards, onOpen, onFilter }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const visible = cards.filter((card) => (category === 'all' || card.group === category) && terms.every((term) => normalize(`${card.kicker} ${card.title} ${card.description}`).includes(term)));
  const hideLibrary = ['management', 'appearance'].includes(category) || terms.length > 0;
  useEffect(() => { onFilter(hideLibrary); }, [hideLibrary, onFilter]);
  return <><div className="tool-filters" role="group" aria-label="Znajdź narzędzie"><div className="tool-categories" role="group" aria-label="Kategorie narzędzi">
    {categories.map(([id, label]) => <button type="button" key={id} data-tool-filter={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>)}
  </div><label className="tool-search"><span className="sr-only">Szukaj narzędzia</span><input id="studio-tool-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj narzędzia…" autoComplete="off" /></label></div>
    <p id="studio-tool-count" className="tool-count" role="status" aria-live="polite">Dostępne narzędzia: {visible.length}</p>
    <div className="project-choices">{visible.map((card) => { const Tag = card.href ? 'a' : 'button'; return <Tag key={card.id} className={card.className} href={card.href || undefined} type={card.href ? undefined : 'button'} data-tool-group={card.group} onClick={card.href ? undefined : () => onOpen(card)}>
      <span className="project-icon" aria-hidden="true"><Icon node={card.icon} /></span><span className="project-copy"><small>{card.kicker}</small><strong>{card.title}</strong><span>{card.description}</span></span><span className="project-arrow" aria-hidden="true">→</span>
    </Tag>; })}</div><nav className="studio-admin-navigation" aria-label="Pozostałe ustawienia platformy">
      {[['users', 'Użytkownicy i dostęp'], ['forms', 'Formularze i wiadomości'], ['content', 'Biblioteki materiałów'], ['landing', 'Publikacja strony głównej']].map(([tab, label]) => <a key={tab} href={`/members/module/studio/admin/?tab=${tab}`}>{label}</a>)}
    </nav><p id="studio-tools-empty" className="tool-empty" hidden={visible.length > 0}>Nie znaleziono narzędzia. Zmień wyszukiwanie lub wybierz inną kategorię.</p>
  </>;
});
register('studio-tool-switch', ({ groups, initial, onSelect }) => <>
  <span className="tool-switch-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><path d="M14 17.5h7M17.5 14v7" /></svg></span>
  <label htmlFor="studio-tool-select">Twoja przestrzeń robocza</label><select id="studio-tool-select" defaultValue={initial} onChange={(event) => onSelect(event.target.value)}>
    {groups.map((group, index) => group.label ? <optgroup key={index} label={group.label}>{group.options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup> : group.options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>))}
  </select><svg className="tool-switch-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
</>);
