import { useState, type ReactNode } from 'react';

interface Entry { id: string; name?: string; [key: string]: unknown }
interface Props<T extends Entry> {
  entries: T[];
  kind: string;
  onAdd: () => T;
  onRemove: (id: string) => void;
  render: (entry: T) => ReactNode;
}

export default function TabbedEntriesEditor<T extends Entry>({ entries, kind, onAdd, onRemove, render }: Props<T>) {
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? '');
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];
  const add = () => { const entry = onAdd(); setSelectedId(entry.id); };
  const remove = () => {
    if (!selected || !window.confirm(`确定删除${kind}「${selected.name || '未命名'}」？引用它的配置可能无法通过校验。`)) return;
    onRemove(selected.id);
    setSelectedId(entries.find(entry => entry.id !== selected.id)?.id ?? '');
  };
  return <div className="creator-special-form">
    <div className="creator-location-tabs" role="tablist" aria-label={`${kind}列表`}>
      {entries.map(entry => <button type="button" role="tab" key={entry.id} aria-selected={selected?.id === entry.id}
        className={selected?.id === entry.id ? 'active' : ''} onClick={() => setSelectedId(entry.id)}>{entry.name || `未命名${kind}`}</button>)}
      <button type="button" className="creator-location-add" onClick={add}>＋ 新增{kind}</button>
    </div>
    {selected ? <div className="creator-location-panel" role="tabpanel">
      <div className="creator-location-panel-head"><div><span>{kind.toUpperCase()} / {String(entries.indexOf(selected) + 1).padStart(2, '0')}</span>
        <h3>{selected.name || `未命名${kind}`}</h3></div><button type="button" className="creator-danger-link" onClick={remove}>删除{kind}</button></div>
      {render(selected)}
    </div> : <div className="creator-empty-inline">还没有{kind}。点击「新增{kind}」开始配置。</div>}
  </div>;
}
