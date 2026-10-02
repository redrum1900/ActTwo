import { useState } from 'react';
import { Tag } from 'antd';
import TabbedEntriesEditor from './TabbedEntriesEditor.js';
import { addEntry, addEntryTag, newEntryId, patchEntryById, removeEntry, removeEntryTag } from './section-forms.js';

interface ItemDraft { id: string; name: string; description?: string; detail?: string; initialTags?: string[]; [key: string]: unknown }
interface Props { content: string; onChange: (value: string) => void }

export default function ItemsEditor({ content, onChange }: Props) {
  const entries = JSON.parse(content) as ItemDraft[];
  const [newTag, setNewTag] = useState('');
  const patch = (id: string, fields: Record<string, unknown>) => onChange(patchEntryById(content, id, fields));
  return <TabbedEntriesEditor entries={entries} kind="道具" onAdd={() => {
    const item = { id: newEntryId(), name: '新道具', description: '', detail: '', initialTags: [] };
    onChange(addEntry(content, item)); return item;
  }} onRemove={id => onChange(removeEntry(content, id))} render={item => <>
    <div className="creator-form-grid">
      <label className="creator-field"><span>道具名称</span><input value={item.name} onChange={event => patch(item.id, { name: event.target.value })} /></label>
      <label className="creator-field creator-wide"><span>简介 / 描述</span><textarea rows={3} value={item.description ?? ''}
        onChange={event => patch(item.id, { description: event.target.value })} /></label>
      <label className="creator-field creator-wide"><span>完整详情</span><textarea rows={5} value={item.detail ?? ''}
        onChange={event => patch(item.id, { detail: event.target.value })} /></label>
    </div>
    <div className="creator-item-tags"><strong>初始标签</strong><div>{(item.initialTags ?? []).map(tag =>
      <Tag key={tag} closable onClose={event => { event.preventDefault(); onChange(removeEntryTag(content, item.id, tag)); }}>{tag}</Tag>)}</div>
      <div className="creator-item-tags-add"><input aria-label="新标签" value={newTag} placeholder="输入标签" onChange={event => setNewTag(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onChange(addEntryTag(content, item.id, newTag)); setNewTag(''); } }} />
        <button type="button" onClick={() => { onChange(addEntryTag(content, item.id, newTag)); setNewTag(''); }} disabled={!newTag.trim()}>添加标签</button></div>
    </div>
    <p className="creator-form-note">道具变体等高级配置会保留；需要修改时可切换 JSON 模式。</p>
  </>} />;
}
