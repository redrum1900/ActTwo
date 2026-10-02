import TabbedEntriesEditor from './TabbedEntriesEditor.js';
import { addEntry, newEntryId, patchEntryById, removeEntry } from './section-forms.js';

interface GalleryDraft { id: string; name: string; description?: string; hidden?: boolean; condition?: unknown; [key: string]: unknown }
interface Props { content: string; onChange: (value: string) => void; kind: '结局' | '成就' }

export default function GalleryEditor({ content, onChange, kind }: Props) {
  const entries = JSON.parse(content) as GalleryDraft[];
  const patch = (id: string, fields: Record<string, unknown>) => onChange(patchEntryById(content, id, fields));
  return <TabbedEntriesEditor entries={entries} kind={kind} onAdd={() => {
    const entry = { id: newEntryId(), name: `新${kind}`, description: '', hidden: false };
    onChange(addEntry(content, entry)); return entry;
  }} onRemove={id => onChange(removeEntry(content, id))} render={entry => <>
    <div className="creator-form-grid">
      <label className="creator-field"><span>{kind}名称</span><input value={entry.name} onChange={event => patch(entry.id, { name: event.target.value })} /></label>
      <label className="creator-field creator-wide"><span>简介 / 描述</span><textarea rows={5} value={entry.description ?? ''}
        onChange={event => patch(entry.id, { description: event.target.value })} /></label>
      <label className="creator-field creator-check"><input type="checkbox" checked={entry.hidden ?? false}
        onChange={event => patch(entry.id, { hidden: event.target.checked })} /><span>隐藏条目（满足条件前不显示）</span></label>
    </div>
    <div className="creator-condition-preview"><strong>触发条件</strong>
      {entry.condition ? <code>{JSON.stringify(entry.condition)}</code> : <p className="creator-field-warning">尚未设置条件。可保存草稿，但提交审核前必须设置。</p>}
      <small>下一步接入可视化条件编辑器；当前可在 JSON 模式设置，切回表单不会丢失。</small>
    </div>
  </>} />;
}
