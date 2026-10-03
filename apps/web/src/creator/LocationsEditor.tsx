import { useState } from 'react';
import { Modal, Select } from 'antd';
import { confirmAction } from '../dialogs.js';
import type { Condition } from '@game/contracts';
import ConditionEditor from './ConditionEditor.js';
import type { ConditionSources } from './condition-tree.js';
import { addLocationPlacement, availableLocationPlacementItems, newLocationId, patchLocation, patchLocationPlacement, removeLocationPlacement } from './section-forms.js';

interface Props { content: string; onChange: (value: string) => void; sources: ConditionSources; onJson?: () => void }
interface PlacementDraft { item: string; discoverWhen?: Condition | null; takeWhen?: Condition | null; blockedHint?: string; [key: string]: unknown }
interface LocationDraft { id: string; name?: string; description?: string; interactionMode?: string; items?: PlacementDraft[]; [key: string]: unknown }

export default function LocationsEditor({ content, onChange, sources, onJson }: Props) {
  const locations = JSON.parse(content) as LocationDraft[];
  const [selectedId, setSelectedId] = useState(locations[0]?.id ?? '');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItemId, setNewItemId] = useState<string>();
  const selected = locations.find(location => location.id === selectedId) ?? locations[0];
  const placements = selected?.items ?? [];
  const selectedPlacement = placements.find(placement => placement.item === selectedItemId) ?? placements[0];
  const npcOwned = sources.npcs.flatMap(npc => npc.initialItems ?? []);
  const availableItems = availableLocationPlacementItems(content, sources.items, npcOwned);
  const localSources = { ...sources, locations: locations.map(location => ({ id: location.id, name: location.name ?? location.id })) };
  const patch = (fields: Record<string, unknown>) => {
    if (selected) onChange(patchLocation(content, selected.id, fields));
  };
  const patchPlacement = (fields: Record<string, unknown>) => {
    if (selected && selectedPlacement) onChange(patchLocationPlacement(content, selected.id, selectedPlacement.item, fields));
  };
  const attachItem = () => {
    if (!selected || !newItemId) return;
    onChange(addLocationPlacement(content, selected.id, newItemId));
    setSelectedItemId(newItemId); setNewItemId(undefined); setAddItemOpen(false);
  };
  const detachItem = async () => {
    if (!selected || !selectedPlacement || !await confirmAction(`从「${selected.name || selected.id}」移除这件道具？道具定义不会删除。`, true)) return;
    onChange(removeLocationPlacement(content, selected.id, selectedPlacement.item));
    setSelectedItemId(placements.find(placement => placement.item !== selectedPlacement.item)?.item ?? '');
  };
  const add = () => {
    const id = newLocationId();
    onChange(JSON.stringify([...locations, { id, name: '新地点', description: '', interactionMode: 'in-person', spots: [] }], null, 2));
    setSelectedId(id); setSelectedItemId('');
  };
  const remove = async () => {
    if (!selected || !await confirmAction(`确定移除地点「${selected.name || selected.id}」？引用此地点的配置可能无法通过校验。`, true)) return;
    const next = locations.filter(location => location.id !== selected.id);
    onChange(JSON.stringify(next, null, 2)); setSelectedId(next[0]?.id ?? ''); setSelectedItemId('');
  };
  return <><div className="creator-special-form creator-side-entry-layout">
    <div className="creator-side-entry-nav">
      <button type="button" className="creator-location-add" onClick={add}>＋ 新增地点</button>
      <div className="creator-location-tabs" role="tablist" aria-label="地点列表">
        {locations.map(location => <button type="button" key={location.id} role="tab" aria-selected={location.id === selected?.id}
          className={location.id === selected?.id ? 'active' : ''} onClick={() => { setSelectedId(location.id); setSelectedItemId(''); }}>{location.name || '未命名地点'}</button>)}
      </div>
    </div>
    {selected ? <div className="creator-location-panel" role="tabpanel"><div className="creator-location-panel-head"><div><span>LOCATION / {String(locations.indexOf(selected) + 1).padStart(2, '0')}</span><h3>{selected.name || '未命名地点'}</h3></div>
      <button type="button" className="creator-danger-link" onClick={remove}>删除地点</button></div>
      <div className="creator-form-grid">
        <label className="creator-field"><span>地点名称</span><input value={selected.name ?? ''} onChange={event => patch({ name: event.target.value })} placeholder="例如：老街饭店" /></label>
        <label className="creator-field"><span>交流方式</span><Select value={selected.interactionMode ?? 'in-person'}
          onChange={value => patch({ interactionMode: value })} options={[{ value: 'in-person', label: '面对面' }, { value: 'online', label: '线上' }]} /></label>
        <label className="creator-field creator-wide"><span>简介 / 描述</span><textarea rows={6} value={selected.description ?? ''}
          onChange={event => patch({ description: event.target.value })} placeholder="玩家到达这里时所处的环境、氛围与可见内容" /></label>
      </div>
      <section className="creator-location-items" aria-label="地点道具"><div className="creator-period-heading"><div><strong>地点道具</strong>
        <p>先在「道具」页创建并保存；道具被发现后会持续显示，拿走后转入玩家背包。</p></div>
        <button type="button" onClick={() => { setNewItemId(undefined); setAddItemOpen(true); }}>＋ 添加道具</button></div>
        {placements.length ? <><div className="creator-location-item-tabs" role="tablist" aria-label="道具列表">
          {placements.map(placement => <button type="button" role="tab" key={placement.item} aria-selected={selectedPlacement?.item === placement.item}
            className={selectedPlacement?.item === placement.item ? 'active' : ''} onClick={() => setSelectedItemId(placement.item)}>
            {sources.items.find(item => item.id === placement.item)?.name ?? `未知道具 · ${placement.item}`}</button>)}
        </div>{selectedPlacement && <div className="creator-location-item-panel" role="tabpanel"><div className="creator-location-item-head">
          <strong>{sources.items.find(item => item.id === selectedPlacement.item)?.name ?? selectedPlacement.item}</strong>
          <button type="button" className="creator-danger-link" onClick={detachItem}>从地点移除</button></div>
          <div className="creator-location-item-condition"><div className="creator-location-item-condition-head"><strong>发现条件</strong>
            {selectedPlacement.discoverWhen ? <button type="button" onClick={() => patchPlacement({ discoverWhen: undefined, hidden: undefined })}>清除条件</button>
              : <button type="button" onClick={() => patchPlacement({ discoverWhen: { location: selected.id }, hidden: undefined })}>＋ 设置条件</button>}</div>
            {selectedPlacement.discoverWhen ? <ConditionEditor value={selectedPlacement.discoverWhen} sources={localSources} onJson={onJson}
              onChange={discoverWhen => patchPlacement({ discoverWhen, hidden: undefined })} />
              : <p>无条件：玩家搜索此处即可发现。</p>}</div>
          <div className="creator-location-item-condition"><div className="creator-location-item-condition-head"><strong>获取条件</strong>
            {selectedPlacement.takeWhen ? <button type="button" onClick={() => patchPlacement({ takeWhen: undefined })}>清除条件</button>
              : <button type="button" onClick={() => patchPlacement({ takeWhen: { location: selected.id } })}>＋ 设置条件</button>}</div>
            {selectedPlacement.takeWhen ? <ConditionEditor value={selectedPlacement.takeWhen} sources={localSources} onJson={onJson}
              onChange={takeWhen => patchPlacement({ takeWhen })} />
              : <p>无条件：发现后可以直接拿走。</p>}</div>
        </div>}</> : <p className="creator-location-items-empty">此地点还没有道具。</p>}
      </section>
      <p className="creator-form-note">其他高级地点配置暂未提供表单；已有内容会保留，可在 JSON 模式编辑。</p>
    </div> : <div className="creator-empty-inline">还没有地点。点击「新增地点」开始配置。</div>}
  </div>
    <Modal className="creator-location-item-modal" title="添加地点道具" open={addItemOpen} okText="添加道具" cancelText="取消" okButtonProps={{ disabled: !newItemId }}
      onOk={attachItem} onCancel={() => { setAddItemOpen(false); setNewItemId(undefined); }} destroyOnHidden>
      <p className="creator-location-item-modal-help">选择一件尚未放在其他地点、也未由 NPC 初始持有的道具。</p>
      <Select aria-label="选择道具" showSearch value={newItemId} onChange={setNewItemId} placeholder="选择已保存的道具"
        options={availableItems.map(item => ({ value: item.id, label: item.name }))} style={{ width: '100%' }} />
      {!availableItems.length && <p className="creator-field-warning">没有可添加的道具。请先到「道具」页新增并保存，或检查初始归属。</p>}
    </Modal>
  </>;
}
