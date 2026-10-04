import { useState, type ReactNode } from 'react';
import { confirmAction } from '../../app/dialogs.js';

interface Entry { id: string; name?: string; [key: string]: unknown }
interface Props<T extends Entry> {
  entries: T[];
  kind: string;
  onAdd: () => T;
  onRemove: (id: string) => void;
  render: (entry: T) => ReactNode;
  layout?: 'horizontal' | 'side';
  visibleEntries?: T[];
  canRemove?: (entry: T) => boolean;
}

export default function TabbedEntriesEditor<T extends Entry>({ entries, kind, onAdd, onRemove, render, layout = 'horizontal', visibleEntries = entries, canRemove = () => true }: Props<T>) {
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? '');
  const selected = visibleEntries.find(entry => entry.id === selectedId) ?? visibleEntries[0];
  const add = () => { const entry = onAdd(); setSelectedId(entry.id); };
  const remove = async () => {
    if (!selected || !await confirmAction(`确定删除${kind}「${selected.name || '未命名'}」？引用它的配置可能无法通过校验。`, true)) return;
    onRemove(selected.id);
    setSelectedId(visibleEntries.find(entry => entry.id !== selected.id)?.id ?? '');
  };
  const addButton = <button type="button" className="creator-location-add" onClick={add}>＋ 新增{kind}</button>;
  const tabs = <div className="creator-location-tabs" role="tablist" aria-label={`${kind}列表`}>
    {visibleEntries.map(entry => <button type="button" role="tab" key={entry.id} aria-selected={selected?.id === entry.id}
      className={selected?.id === entry.id ? 'active' : ''} onClick={() => setSelectedId(entry.id)}>{entry.name || `未命名${kind}`}</button>)}
    {layout === 'horizontal' && addButton}
  </div>;
  return <div className={`creator-special-form${layout === 'side' ? ' creator-side-entry-layout' : ''}`}>
    {layout === 'side' ? <div className="creator-side-entry-nav">{addButton}{tabs}</div> : tabs}
    {selected ? <div className="creator-location-panel" role="tabpanel">
      <div className="creator-location-panel-head"><div><span>{kind.toUpperCase()} / {String(entries.indexOf(selected) + 1).padStart(2, '0')}</span>
        <h3>{selected.name || `未命名${kind}`}</h3></div>{canRemove(selected) && <button type="button" className="creator-danger-link" onClick={remove}>删除{kind}</button>}</div>
      {render(selected)}
    </div> : <div className="creator-empty-inline">{entries.length ? `当前筛选下没有${kind}。` : `还没有${kind}。点击「新增${kind}」开始配置。`}</div>}
  </div>;
}
