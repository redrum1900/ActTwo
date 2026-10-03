import { Checkbox, Input, Select } from 'antd';
import type { FieldDefinition } from '@game/contracts';
import { newEntryId } from './section-forms.js';

interface Props { content: string; onChange: (content: string) => void }
const choices = ['select', 'radio', 'checkbox'];
const types = [
  { value: 'input', label: '单行文本' }, { value: 'textarea', label: '多行文本' },
  { value: 'date', label: '日期' }, { value: 'select', label: '下拉选择' },
  { value: 'radio', label: '单项选择' }, { value: 'checkbox', label: '多项选择' },
];

export default function PlayerFormEditor({ content, onChange }: Props) {
  const fields = JSON.parse(content) as FieldDefinition[];
  const commit = (next: FieldDefinition[]) => onChange(JSON.stringify(next.map(field => ({ ...field, required: true })), null, 2));
  const patch = (index: number, changes: Partial<FieldDefinition>) => commit(fields.map((field, position) => position === index ? { ...field, ...changes, id: field.id } : field));
  const move = (index: number, to: number) => {
    const next = [...fields];
    [next[index], next[to]] = [next[to], next[index]];
    commit(next);
  };
  return <div className="creator-player-form">
    <div className="creator-entry-toolbar"><span>共 {fields.length} 项 · 可全部删除，玩家将直接开始游戏</span>
      <button type="button" onClick={() => commit([...fields, { id: newEntryId(), label: '新问题', type: 'input', default: '', required: true, editable: true, public: true }])}>＋ 新增问题</button></div>
    {fields.map((field, index) => <section className="creator-player-question" key={field.id}>
      <div className="creator-entry-head"><strong>{index + 1}. {field.label || '未命名问题'}</strong><div className="creator-player-actions">
        <button type="button" disabled={index === 0} onClick={() => move(index, index - 1)} aria-label="上移问题">↑</button>
        <button type="button" disabled={index === fields.length - 1} onClick={() => move(index, index + 1)} aria-label="下移问题">↓</button>
        <button type="button" className="creator-danger-link" onClick={() => commit(fields.filter((_, position) => position !== index))}>删除</button>
      </div></div>
      <div className="creator-player-grid"><label><span>标题</span><Input size="small" value={field.label} onChange={event => patch(index, { label: event.target.value })} /></label>
        <label><span>类型</span><Select aria-label="问题类型" size="small" value={field.type} options={types} onChange={type => patch(index, {
          type, options: choices.includes(type) ? [{ value: newEntryId(), label: '选项 1' }] : undefined,
          default: type === 'checkbox' ? [] : '',
        })} /></label></div>
      {choices.includes(field.type) && <div className="creator-player-options"><div className="creator-player-subhead">选项</div>
        {(field.options ?? []).map((option, optionIndex) => <div className="creator-player-option" key={option.value}>
          <span>{optionIndex + 1}</span><Input size="small" aria-label={`选项 ${optionIndex + 1}`} value={option.label} onChange={event => patch(index, {
            options: field.options?.map((current, position) => position === optionIndex ? { ...current, label: event.target.value } : current),
          })} /><button type="button" disabled={(field.options?.length ?? 0) <= 1} onClick={() => patch(index, {
            options: field.options?.filter((_, position) => position !== optionIndex),
            default: field.type === 'checkbox' ? (field.default as string[] ?? []).filter(value => value !== option.value) : field.default === option.value ? '' : field.default,
          })}>删除</button></div>)}
        <button type="button" className="creator-small" onClick={() => patch(index, { options: [...(field.options ?? []), { value: newEntryId(), label: `选项 ${(field.options?.length ?? 0) + 1}` }] })}>＋ 新增选项</button>
      </div>}
      <label className="creator-player-default"><span>默认值</span>
        {field.type === 'textarea' ? <Input.TextArea rows={2} value={typeof field.default === 'string' ? field.default : ''} onChange={event => patch(index, { default: event.target.value })} /> :
          field.type === 'date' ? <Input size="small" type="date" value={typeof field.default === 'string' ? field.default : ''} onChange={event => patch(index, { default: event.target.value })} /> :
          field.type === 'checkbox' ? <Select mode="multiple" size="small" aria-label="默认值" value={Array.isArray(field.default) ? field.default : []}
            options={field.options?.map(option => ({ value: option.value, label: option.label }))} onChange={value => patch(index, { default: value })} /> :
          field.type === 'select' || field.type === 'radio' ? <Select size="small" aria-label="默认值" allowClear value={typeof field.default === 'string' ? field.default || undefined : undefined}
            options={field.options?.map(option => ({ value: option.value, label: option.label }))} onChange={value => patch(index, { default: value ?? '' })} /> :
            <Input size="small" value={typeof field.default === 'string' ? field.default : ''} onChange={event => patch(index, { default: event.target.value })} />}
      </label>
      <details className="creator-player-advanced"><summary>高级设置</summary><div>
        <Checkbox checked={field.editable !== false} onChange={event => patch(index, { editable: event.target.checked })}>允许编辑</Checkbox>
        <Checkbox checked={field.public !== false} onChange={event => patch(index, { public: event.target.checked })}>公开给角色</Checkbox>
      </div></details>
    </section>)}
    {!fields.length && <div className="creator-empty-inline">无需开局资料；新游戏将直接进入故事。</div>}
  </div>;
}
