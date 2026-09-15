import React, { useState } from 'react';
import { register, Widget } from '../shared/runtime.jsx';

const kindLabel = (asset) => ({ lesson: 'MD', exam: 'EXAM', presentation: 'SLIDE', quiz: 'QUIZ' })[asset.kind] || (/\.txt$/i.test(asset.filename) ? 'TXT' : 'JSON');
function Pagination({ paged, label, onMore }) {
  return <div className="studio-list-pagination"><p role="status" aria-live="polite">Wyświetlono {paged.visible} z {paged.total} {label}.</p>
    {paged.remaining > 0 && <button type="button" className="studio-list-more" data-paged-list-more={paged.key} onClick={() => onMore(paged)} aria-label={`Pokaż kolejne ${Math.min(paged.pageSize, paged.remaining)} z ${paged.remaining} ukrytych ${label}`}>Pokaż więcej ({Math.min(paged.pageSize, paged.remaining)})</button>}
  </div>;
}
register('studio-assets', ({ paged, label, actionLabel, onSelect, onMore }) => <>{paged.items.map((asset) => <button type="button" className="repository-asset" data-asset-filename={asset.filename} key={`${asset.repositoryId}:${asset.kind}:${asset.filename}`} onClick={() => onSelect(asset)}>
  <span className="repository-asset-kind">{kindLabel(asset)}</span><span><strong>{asset.title || asset.filename}</strong><small>{asset.description || asset.filename}</small></span><span className="repository-asset-action">{actionLabel}</span>
</button>)}{paged.total > 0 && <Pagination paged={paged} label={label} onMore={onMore} />}</>);

function Folder({ className, initial, summary, onToggle, children, ...attrs }) {
  const [open, setOpen] = useState(initial);
  return <details className={className} open={open} {...attrs}><summary onClick={(event) => { event.preventDefault(); const next = !open; setOpen(next); onToggle(next); }}>{summary}</summary>{open && children}</details>;
}
function Material({ asset, group, adapters }) {
  const key = adapters.mediaKey(group.kind, asset.filename, asset.repositoryId);
  const data = { 'data-explorer-kind': group.kind, 'data-explorer-filename': asset.filename, 'data-explorer-repository': asset.repositoryId || adapters.repositoryId };
  return <Folder className="content-explorer-material" data-explorer-owner-key={key} initial={adapters.open.has(key)} onToggle={(open) => {
    adapters.toggle(key, open); if (open && group.kind !== 'prompt') adapters.loadMedia(group.kind, asset);
  }} summary={<><span className={`content-explorer-file-type is-${group.kind}`}>{kindLabel({ ...asset, kind: group.kind })}</span><span className="content-explorer-file-copy"><strong>{asset.title || asset.filename}</strong><small>{asset.path || asset.filename}</small></span><span className="content-explorer-material-meta">{adapters.size(asset.size)}</span><span className="content-explorer-chevron">⌄</span></>}>
    <div className="content-explorer-material-body"><div className="content-explorer-definition-row"><div className="content-explorer-definition-copy"><span>◇</span><span>{({ exam: 'exam.json', presentation: 'presentation.json', quiz: 'quiz.json' })[group.kind] || asset.filename}</span></div>
      <div className="content-explorer-row-actions"><button type="button" className="content-explorer-open-button" data-explorer-open="1" {...data}>Otwórz</button><button type="button" className="content-explorer-duplicate" data-explorer-duplicate="1" {...data}>Duplikuj</button><button type="button" className="content-explorer-delete" data-explorer-delete="1" {...data} aria-label={`Usuń ${asset.title || asset.filename} z biblioteki`}>Usuń</button></div></div>
      {group.kind !== 'prompt' && <Widget factory={() => adapters.renderMedia(group.kind, asset)} />}
    </div>
  </Folder>;
}
register('studio-library', ({ groups, adapters, loading, error, query }) => <>{groups.map((group) => <Folder key={`${adapters.repositoryId}:${group.kind}`} className="content-explorer-folder" data-explorer-root={group.kind} initial={adapters.open.has(group.kind)} onToggle={(open) => adapters.toggle(group.kind, open)}
  summary={<><span className="content-explorer-folder-icon">{group.icon}</span><span className="content-explorer-folder-copy"><strong>{group.title}</strong><small>{group.kind === 'lesson' ? 'Pliki Markdown i lokalne zdjęcia' : ['exam', 'presentation', 'quiz'].includes(group.kind) ? 'Definicja i lokalny folder photos' : 'Pliki JSON i TXT'}</small></span><small>{group.paged.total}/{group.assets.length}</small><span className="content-explorer-chevron">⌄</span></>}>
  <div className="content-explorer-files">{group.paged.items.map((asset) => <Material key={`${asset.repositoryId}:${asset.filename}`} asset={asset} group={group} adapters={adapters} />)}
    {group.paged.total ? <Pagination paged={group.paged} label="plików" onMore={adapters.more} /> : <p className="content-explorer-empty">{loading ? 'Wczytywanie…' : error ? 'Nie udało się wczytać plików.' : query ? 'Brak pasujących plików.' : 'Nie ma jeszcze materiałów tego typu.'}</p>}
  </div></Folder>)}<Widget key={adapters.repositoryId} factory={adapters.renderShared} /></>);
