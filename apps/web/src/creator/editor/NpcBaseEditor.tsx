import { useState } from 'react';
import { Modal, Select, Switch } from 'antd';
import { confirmAction } from '../../app/dialogs.js';
import type { Condition } from '@game/contracts';
import ConditionEditor from './ConditionEditor.js';
import type { ConditionSources } from '../model/condition-tree.js';
import { addNpcInitialItems, patchNpcBase, removeNpcInitialItem, setNpcItemVisibility } from '../model/section-forms.js';

interface NpcBase {
  id: string; name?: string; description?: string; initialLocationId?: string;
  initialItems?: string[]; itemVisibility?: Record<string, Condition | null>;
}
interface Props { content: string; onChange: (value: string) => void; sources: ConditionSources; onJson: () => void; npcId: string }

export default function NpcBaseEditor({ content, onChange, sources, onJson, npcId }: Props) {
  const base = JSON.parse(content) as NpcBase;
  const [selectedItemId, setSelectedItemId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState<string[]>([]);
  const initialItems = base.initialItems ?? [];
  const currentItem = initialItems.includes(selectedItemId) ? selectedItemId : initialItems[0];
  const visibility = base.itemVisibility ?? {};
  const visible = !!currentItem && Object.hasOwn(visibility, currentItem);
  const currentCondition = currentItem ? visibility[currentItem] : undefined;
  const occupied = new Set([
    ...sources.locations.flatMap(location => location.items ?? []),
    ...sources.npcs.filter(npc => npc.id !== npcId).flatMap(npc => npc.initialItems ?? []),
    ...initialItems,
  ]);
  const available = sources.items.filter(item => !occupied.has(item.id));
  const itemName = (id: string) => sources.items.find(item => item.id === id)?.name ?? `未知道具 · ${id}`;
  const setVisibility = (next: Condition | null | undefined) => {
    if (currentItem) onChange(setNpcItemVisibility(content, currentItem, next));
  };
  return <div className="creator-special-form creator-npc-base">
    <div className="creator-form-grid">
      <label className="creator-field"><span>角色名称</span><input value={base.name ?? ''}
        onChange={event => onChange(patchNpcBase(content, { name: event.target.value }))} /></label>
      <label className="creator-field"><span>初始地点</span><Select value={base.initialLocationId || undefined} showSearch
        aria-label="初始地点" placeholder="选择地点" options={sources.locations.map(location => ({ value: location.id, label: location.name }))}
        onChange={initialLocationId => onChange(patchNpcBase(content, { initialLocationId }))} /></label>
      <label className="creator-field creator-wide"><span>简介 / 描述</span><textarea rows={5} value={base.description ?? ''}
        onChange={event => onChange(patchNpcBase(content, { description: event.target.value }))} /></label>
    </div>
    <section className="creator-location-items" aria-label="NPC 初始道具"><div className="creator-period-heading"><div><strong>初始道具</strong>
      <p>道具先在「道具」页创建。可逐件设置玩家是否看得到。</p></div>
      <button type="button" onClick={() => { setPendingItems([]); setAddOpen(true); }}>＋ 添加道具</button></div>
      {initialItems.length ? <><div className="creator-location-item-tabs" role="tablist" aria-label="道具列表">
        {initialItems.map(item => <button type="button" role="tab" key={item} aria-selected={currentItem === item}
          className={currentItem === item ? 'active' : ''} onClick={() => setSelectedItemId(item)}>{itemName(item)}</button>)}
      </div>{currentItem && <div className="creator-location-item-panel" role="tabpanel">
        <div className="creator-location-item-head"><strong>{itemName(currentItem)}</strong><button type="button" className="creator-danger-link"
          onClick={() => void (async () => { if (!await confirmAction(`从「${base.name ?? npcId}」移除这件道具？道具定义不会删除。`, true)) return;
            onChange(removeNpcInitialItem(content, currentItem)); setSelectedItemId(initialItems.find(item => item !== currentItem) ?? ''); })()}>从 NPC 移除</button></div>
        <div className="creator-npc-visible"><span>玩家可见</span><Switch checked={visible} onChange={checked => setVisibility(checked ? null : undefined)} /></div>
        {visible && <div className="creator-location-item-condition"><div className="creator-location-item-condition-head"><strong>可见条件</strong>
          {currentCondition ? <button type="button" onClick={() => setVisibility(null)}>清除条件</button>
            : <button type="button" onClick={() => setVisibility({ hasItem: { owner: `npc:${npcId}`, item: currentItem } })}>＋ 设置条件</button>}</div>
          {currentCondition ? <ConditionEditor value={currentCondition} sources={{ ...sources, ownerNpcId: npcId }} onJson={onJson} onChange={setVisibility} />
            : <p>无条件：玩家始终可以看到。</p>}</div>}
        {!visible && <p className="creator-form-note">当前隐藏；玩家通过剧情发现这件道具后仍可看到。</p>}
      </div>}</> : <p className="creator-location-items-empty">还没有初始道具。</p>}
    </section>
  <Modal className="creator-location-item-modal" title="添加 NPC 初始道具" open={addOpen} okText="添加道具" cancelText="取消"
    okButtonProps={{ disabled: !pendingItems.length }} onOk={() => { onChange(addNpcInitialItems(content, pendingItems)); setSelectedItemId(pendingItems[0]);
      setPendingItems([]); setAddOpen(false); }} onCancel={() => { setAddOpen(false); setPendingItems([]); }} destroyOnHidden>
    <p className="creator-location-item-modal-help">选择尚未放在地点、也未由其他 NPC 初始持有的道具。</p>
    <Select mode="multiple" aria-label="选择道具" showSearch value={pendingItems} onChange={setPendingItems} placeholder="选择已保存的道具"
      options={available.map(item => ({ value: item.id, label: item.name }))} style={{ width: '100%' }} />
    {!available.length && <p className="creator-field-warning">没有可添加的道具。请先在「道具」页创建并保存。</p>}
  </Modal>
  </div>;
}
