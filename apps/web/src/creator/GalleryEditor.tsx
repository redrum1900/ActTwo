import TabbedEntriesEditor from './TabbedEntriesEditor.js';
import { addEntry, newEntryId, patchEntryById, removeEntry } from './section-forms.js';
import type { Condition } from '@game/contracts';
import ConditionEditor from './ConditionEditor.js';
import type { ConditionSources } from './condition-tree.js';

interface GalleryDraft { id: string; name: string; description?: string; hidden?: boolean; condition?: unknown; [key: string]: unknown }
interface Props { content: string; onChange: (value: string) => void; kind: '结局' | '成就'; sources: ConditionSources; onJson?: () => void }

export default function GalleryEditor({ content, onChange, kind, sources, onJson }: Props) {
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
      {entry.condition ? <ConditionEditor value={entry.condition as Condition} sources={sources} onJson={onJson}
        onChange={condition => patch(entry.id, { condition })} /> : <><p className="creator-field-warning">尚未设置条件。可保存草稿，但提交审核前必须设置。</p>
          <button type="button" className="creator-small" onClick={() => patch(entry.id, { condition: { all: [{ storyEvent: sources.storyEvents[0]?.id ?? '' }] } })}>＋ 添加触发条件</button></>}
    </div>
  </>} />;
}
