import { useState } from 'react';
import { Input, InputNumber, Select, Switch } from 'antd';
import { confirmAction } from '../dialogs.js';
import { newEntryId } from './section-forms.js';

interface Entry { id: string; name: string; description?: string; type: string; initial: unknown; min?: number; max?: number;
  options?: string[]; playerVisible?: boolean; systemRole?: string; [key: string]: unknown }
interface Props { content: string; onChange: (content: string) => void; scope: 'story' | 'player' | 'npc' }
const types = [
  { value: 'number', label: '数字' }, { value: 'boolean', label: '是非' }, { value: 'enum', label: '选项' },
  { value: 'text', label: '文本' }, { value: 'tags', label: '标签数组' }, { value: 'date', label: '日期' },
];
const initialFor = (type: string) => type === 'number' ? 0 : type === 'boolean' ? false : type === 'tags' ? [] : '';

export default function IndicatorEditor({ content, onChange, scope }: Props) {
  const entries = JSON.parse(content) as Entry[];
  const [selectedId, setSelectedId] = useState(entries.find(entry => !entry.systemRole)?.id ?? entries[0]?.id ?? '');
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];
  const commit = (next: Entry[]) => onChange(JSON.stringify(next, null, 2));
  const patch = (changes: Partial<Entry>) => selected && commit(entries.map(entry => entry.id === selected.id ? { ...entry, ...changes, id: entry.id } : entry));
  const add = () => {
    const entry: Entry = { id: newEntryId(), name: '新指标', description: '', type: 'number', initial: 0, min: 0, max: 100, playerVisible: false };
    commit([...entries, entry]); setSelectedId(entry.id);
  };
  const remove = async () => {
    if (!selected || selected.systemRole || !await confirmAction(`删除指标「${selected.name}」？引用它的条件和规则将无法通过校验。`, true)) return;
    commit(entries.filter(entry => entry.id !== selected.id)); setSelectedId(entries.find(entry => entry.id !== selected.id)?.id ?? '');
  };
  return <div className="creator-special-form creator-indicators creator-side-entry-layout">
    <div className="creator-side-entry-nav">
      <button type="button" className="creator-location-add" onClick={add}>＋ 新增指标</button>
      <div className="creator-location-tabs" role="tablist" aria-label="指标列表">
        {entries.map(entry => <button type="button" role="tab" key={entry.id} aria-selected={selected?.id === entry.id}
          className={selected?.id === entry.id ? 'active' : ''} onClick={() => setSelectedId(entry.id)}>{entry.name || '未命名指标'}{entry.systemRole ? ' · 系统管理' : ''}</button>)}
      </div>
    </div>
    {selected ? <div className="creator-location-panel" role="tabpanel">
      <div className="creator-location-panel-head"><div><span>{scope.toUpperCase()} INDICATOR</span><h3>{selected.name}</h3></div>
        {!selected.systemRole && <button type="button" className="creator-danger-link" onClick={remove}>删除指标</button>}</div>
      {selected.systemRole ? <div className="creator-indicator-system"><strong>系统管理 · 只读</strong><p>记录「仅触发一次」规则的 ID，不会作为剧情事件展示。</p></div>
        : <div className="creator-indicator-grid">
          <label><span>名称</span><Input size="small" value={selected.name} onChange={event => patch({ name: event.target.value })} /></label>
          <label><span>类型</span><Select size="small" aria-label="指标类型" value={selected.type} options={types} onChange={type => patch({
            type, initial: initialFor(type), options: type === 'enum' ? [] : undefined,
            min: type === 'number' ? 0 : undefined, max: type === 'number' ? 100 : undefined,
          })} /></label>
          <label className="creator-indicator-wide"><span>描述</span><Input.TextArea rows={3} value={selected.description ?? ''} onChange={event => patch({ description: event.target.value })} /></label>
          {selected.type === 'number' && <><label><span>最小值</span><InputNumber size="small" value={selected.min ?? 0} onChange={value => patch({ min: value ?? 0 })} /></label>
            <label><span>最大值</span><InputNumber size="small" value={selected.max ?? 100} onChange={value => patch({ max: value ?? 100 })} /></label></>}
          {selected.type === 'enum' && <label className="creator-indicator-wide"><span>可选项</span><Select mode="tags" size="small" value={selected.options ?? []}
            onChange={options => patch({ options, initial: options.includes(String(selected.initial)) ? selected.initial : options[0] ?? '' })} /></label>}
          <label className="creator-indicator-wide"><span>默认值</span>
            {selected.type === 'number' ? <InputNumber size="small" value={typeof selected.initial === 'number' ? selected.initial : 0}
              min={selected.min} max={selected.max} onChange={value => patch({ initial: value ?? 0 })} /> :
              selected.type === 'boolean' ? <Switch checked={selected.initial === true} checkedChildren="是" unCheckedChildren="否"
                onChange={value => patch({ initial: value })} /> :
              selected.type === 'tags' ? <Select mode="tags" size="small" value={Array.isArray(selected.initial) ? selected.initial : []}
                onChange={initial => patch({ initial })} /> :
              selected.type === 'enum' ? <Select size="small" value={typeof selected.initial === 'string' ? selected.initial || undefined : undefined}
                options={(selected.options ?? []).map(value => ({ value, label: value }))} onChange={initial => patch({ initial })} /> :
              <Input size="small" type={selected.type === 'date' ? 'date' : 'text'} value={typeof selected.initial === 'string' ? selected.initial : ''}
                onChange={event => patch({ initial: event.target.value })} />}
          </label>
          {scope !== 'story' && <label className="creator-indicator-visible"><span>玩家可见</span><Switch checked={selected.playerVisible ?? false}
            onChange={playerVisible => patch({ playerVisible })} /></label>}
        </div>}
    </div> : <div className="creator-empty-inline">暂无指标。点击「新增指标」开始配置。</div>}
  </div>;
}
