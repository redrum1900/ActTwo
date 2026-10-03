import { useState, type FormEvent } from 'react';
import type { FieldDefinition } from '@game/contracts';

export default function PlayerForm({ fields, onSubmit, busy }: { fields: FieldDefinition[]; onSubmit: (values: Record<string, string | string[]>) => void; busy: boolean }) {
  const initial = Object.fromEntries(fields.map(field => [field.id, field.default ?? (field.type === 'checkbox' ? [] : '')])) as Record<string, string | string[]>;
  const [values, setValues] = useState(initial);
  const set = (id: string, value: string | string[]) => setValues(current => ({ ...current, [id]: value }));
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(values); };
  return <form className="player-form" onSubmit={submit}>
    {fields.map(field => <div className="form-field" key={field.id}>
      <label className="field-label" htmlFor={field.id}>{field.label}<span className="required"> *</span></label>
      {field.type === 'input' && <input id={field.id} value={values[field.id] as string} disabled={field.editable === false} required onChange={event => set(field.id, event.target.value)} />}
      {field.type === 'textarea' && <textarea id={field.id} value={values[field.id] as string} disabled={field.editable === false} required onChange={event => set(field.id, event.target.value)} />}
      {field.type === 'date' && <input id={field.id} type="date" value={values[field.id] as string} disabled={field.editable === false} required onChange={event => set(field.id, event.target.value)} />}
      {field.type === 'select' && <select id={field.id} value={values[field.id] as string} disabled={field.editable === false} required onChange={event => set(field.id, event.target.value)}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
      {field.type === 'radio' && <div className="choice-row">{field.options?.map(option => <label className={`choice ${values[field.id] === option.value ? 'selected' : ''}`} key={option.value}><input type="radio" name={field.id} value={option.value} checked={values[field.id] === option.value} disabled={field.editable === false} required onChange={() => set(field.id, option.value)} />{option.label}</label>)}</div>}
      {field.type === 'checkbox' && <div className="choice-row">{field.options?.map(option => <label className={`choice ${(values[field.id] as string[]).includes(option.value) ? 'selected' : ''}`} key={option.value}><input type="checkbox" checked={(values[field.id] as string[]).includes(option.value)} disabled={field.editable === false} onChange={event => set(field.id, event.target.checked ? [...values[field.id] as string[], option.value] : (values[field.id] as string[]).filter(value => value !== option.value))} />{option.label}</label>)}</div>}
      {field.editable === false && <small className="field-help">由剧本设定</small>}
    </div>)}
    <button className="button button-primary form-submit" disabled={busy} type="submit">{busy ? '正在创建…' : '确认，进入游戏'}<span>↗</span></button>
  </form>;
}
