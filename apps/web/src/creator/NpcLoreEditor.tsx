import { useState } from 'react';
import { Select, Tag } from 'antd';
import { loreType } from '@game/script/lore';
import TabbedEntriesEditor from './TabbedEntriesEditor.js';
import { newEntryId, splitLoreKeywords } from './section-forms.js';

interface LoreDraft { id: string; name?: string; type?: 'always' | 'triggered'; keywords: string[]; content: string; [key: string]: unknown }
interface Props { content: string; onChange: (value: string) => void }

function KeywordInput({ keywords, onChange }: { keywords: string[]; onChange: (value: string[]) => void }) {
  const [input, setInput] = useState('');
  const commit = () => { onChange(splitLoreKeywords(input, keywords)); setInput(''); };
  return <div className="creator-lore-keywords">
    <div className="creator-lore-tags">{keywords.map(keyword => <Tag key={keyword} closable onClose={event => { event.preventDefault(); onChange(keywords.filter(entry => entry !== keyword)); }}>{keyword}</Tag>)}</div>
    <input aria-label="输入触发词" value={input} placeholder="输入词语，空格或回车添加；逗号分隔多个"
      onChange={event => setInput(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commit(); }
      }} onBlur={() => { if (input.trim()) commit(); }} />
  </div>;
}

export default function NpcLoreEditor({ content, onChange }: Props) {
  const entries = JSON.parse(content) as LoreDraft[];
  const update = (next: LoreDraft[]) => onChange(JSON.stringify(next, null, 2));
  const namedEntries = entries.map(entry => ({ ...entry, name: entry.name || entry.keywords?.[0] || '未命名世界书' }));
  return <TabbedEntriesEditor entries={namedEntries} kind="世界书" layout="side"
    onAdd={() => { const entry: LoreDraft = { id: newEntryId(), name: '新世界书', type: 'always', keywords: [], content: '' };
      update([...entries, entry]); return entry; }}
    onRemove={id => update(entries.filter(entry => entry.id !== id))}
    render={selected => {
      const entry = entries.find(item => item.id === selected.id)!;
      const patch = (fields: Partial<LoreDraft>) => update(entries.map(item => item.id === entry.id ? { ...item, ...fields, id: item.id } : item));
      const type = loreType(entry);
      return <div className="creator-form-grid creator-lore-form">
        <label className="creator-field"><span>名称</span><input value={entry.name ?? ''} placeholder={selected.name}
          onChange={event => patch({ name: event.target.value })} /></label>
        <label className="creator-field"><span>类型</span><Select aria-label="世界书类型" value={type}
          options={[{ value: 'always', label: '常驻' }, { value: 'triggered', label: '触发' }]}
          onChange={value => patch({ type: value })} /></label>
        {type === 'triggered' && <div className="creator-field creator-wide"><span>触发词</span>
          <KeywordInput keywords={entry.keywords ?? []} onChange={keywords => patch({ keywords })} /></div>}
        <label className="creator-field creator-wide"><span>内容</span><textarea rows={7} value={entry.content ?? ''}
          onChange={event => patch({ content: event.target.value })} /></label>
      </div>;
    }} />;
}
