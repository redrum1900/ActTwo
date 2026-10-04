import type { Condition } from '@game/contracts';
import ConditionEditor from './ConditionEditor.js';
import TabbedEntriesEditor from './TabbedEntriesEditor.js';
import type { ConditionSources } from '../model/condition-tree.js';
import { addPersona, patchPersona, removePersona } from '../model/section-forms.js';

interface PersonaDraft { id: string; name?: string; content?: string; when?: Condition | null; [key: string]: unknown }
interface Props { content: string; onChange: (value: string) => void; sources: ConditionSources; onJson: () => void }

export default function NpcPersonasEditor({ content, onChange, sources, onJson }: Props) {
  const entries = JSON.parse(content) as PersonaDraft[];
  const ordered = [...entries.filter(entry => entry.id === 'common'), ...entries.filter(entry => entry.id !== 'common')]
    .map(entry => ({ ...entry, name: entry.name || (entry.id === 'common' ? '通用' : '未命名性格') }));
  const hasCommon = entries.some(entry => entry.id === 'common');
  return <div className="creator-persona-editor">
    {!hasCommon && <div className="creator-persona-missing"><span>当前缺少通用性格，建议先创建。</span>
      <button type="button" className="creator-location-add" onClick={() => onChange(addPersona(content, true))}>＋ 创建通用</button></div>}
    <TabbedEntriesEditor entries={ordered} kind="性格" layout="side" canRemove={entry => entry.id !== 'common'}
      onAdd={() => { const next = addPersona(content); onChange(next); return { ...(JSON.parse(next) as PersonaDraft[]).at(-1)!, name: '新性格' }; }}
      onRemove={id => onChange(removePersona(content, id))}
      render={selected => {
        const persona = entries.find(entry => entry.id === selected.id)!;
        const patch = (fields: Record<string, unknown>) => onChange(patchPersona(content, persona.id, fields));
        return <div className="creator-persona-fields">
          <div className="creator-form-grid">
            <label className="creator-field"><span>名称</span><input value={persona.name ?? ''} placeholder={selected.name}
              onChange={event => patch({ name: event.target.value })} /></label>
            <label className="creator-field creator-wide"><span>内容</span><textarea rows={8} value={persona.content ?? ''}
              onChange={event => patch({ content: event.target.value })} /></label>
          </div>
          {persona.id !== 'common' && <div className="creator-location-item-condition"><div className="creator-location-item-condition-head"><strong>生效条件</strong>
            {persona.when ? <button type="button" onClick={() => patch({ when: undefined })}>清除条件</button>
              : <button type="button" onClick={() => patch({ when: { all: [] } })}>＋ 设置条件</button>}</div>
            {persona.when ? <ConditionEditor value={persona.when} sources={sources} onJson={onJson} onChange={when => patch({ when })} />
              : <p>无条件：此性格内容始终参与角色设定。</p>}</div>}
        </div>;
      }} />
  </div>;
}
