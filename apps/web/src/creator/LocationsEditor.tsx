import { useState } from 'react';
import { newLocationId, patchLocation } from './section-forms.js';

interface Props { content: string; onChange: (value: string) => void }
interface LocationDraft { id: string; name?: string; description?: string; interactionMode?: string; [key: string]: unknown }

export default function LocationsEditor({ content, onChange }: Props) {
  const locations = JSON.parse(content) as LocationDraft[];
  const [selectedId, setSelectedId] = useState(locations[0]?.id ?? '');
  const selected = locations.find(location => location.id === selectedId) ?? locations[0];
  const patch = (fields: Record<string, unknown>) => {
    if (selected) onChange(patchLocation(content, selected.id, fields));
  };
  const add = () => {
    const id = newLocationId();
    onChange(JSON.stringify([...locations, { id, name: '新地点', description: '', interactionMode: 'in-person', spots: [] }], null, 2));
    setSelectedId(id);
  };
  const remove = () => {
    if (!selected || !window.confirm(`确定移除地点「${selected.name || selected.id}」？引用此地点的配置可能无法通过校验。`)) return;
    const next = locations.filter(location => location.id !== selected.id);
    onChange(JSON.stringify(next, null, 2)); setSelectedId(next[0]?.id ?? '');
  };
  return <div className="creator-special-form">
    <div className="creator-location-tabs" role="tablist" aria-label="地点列表">
      {locations.map(location => <button key={location.id} role="tab" aria-selected={location.id === selected?.id}
        className={location.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(location.id)}>{location.name || '未命名地点'}</button>)}
      <button type="button" className="creator-location-add" onClick={add}>＋ 新增地点</button>
    </div>
    {selected ? <div className="creator-location-panel" role="tabpanel"><div className="creator-location-panel-head"><div><span>LOCATION / {String(locations.indexOf(selected) + 1).padStart(2, '0')}</span><h3>{selected.name || '未命名地点'}</h3></div>
      <button type="button" className="creator-danger-link" onClick={remove}>删除地点</button></div>
      <div className="creator-form-grid">
        <label className="creator-field"><span>地点名称</span><input value={selected.name ?? ''} onChange={event => patch({ name: event.target.value })} placeholder="例如：老街饭店" /></label>
        <label className="creator-field"><span>交流方式</span><select value={selected.interactionMode ?? 'in-person'} onChange={event => patch({ interactionMode: event.target.value })}>
          <option value="in-person">面对面</option><option value="online">线上</option></select></label>
        <label className="creator-field creator-wide"><span>简介 / 描述</span><textarea rows={6} value={selected.description ?? ''}
          onChange={event => patch({ description: event.target.value })} placeholder="玩家到达这里时所处的环境、氛围与可见内容" /></label>
      </div>
      <p className="creator-form-note">高级地点配置暂未提供表单；已有内容会保留，可在 JSON 模式编辑。</p>
    </div> : <div className="creator-empty-inline">还没有地点。点击「新增地点」开始配置。</div>}
  </div>;
}
