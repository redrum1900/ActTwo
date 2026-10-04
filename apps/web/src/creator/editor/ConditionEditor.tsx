import { useEffect, useState } from 'react';
import { Select } from 'antd';
import { pruneLegacyCondition, type Condition, type ValueComparison } from '@game/contracts';
import { changeConditionKind, conditionIssues, defaultComparison, patchCondition, type ConditionPath, type ConditionSources } from '../model/condition-tree.js';
import TypedComparisonEditor from './TypedComparisonEditor.js';

interface Props { value: Condition; sources: ConditionSources; onChange: (value: Condition) => void; onJson?: () => void }

const kindOptions = [
  { value: 'storyEvent', label: '剧情事件' }, { value: 'hasItem', label: '持有道具' },
  { value: 'indicator', label: 'NPC 指标' }, { value: 'playerIndicator', label: '玩家指标' }, { value: 'storyIndicator', label: '剧本指标' },
  { value: 'location', label: '当前位置' }, { value: 'unlockedLocation', label: '已解锁地点' },
  { value: 'period', label: '时间段' }, { value: 'discoveredNpc', label: '已认识角色' },
  { value: 'npcLocation', label: 'NPC 所在地' }, { value: 'playerField', label: '开局资料' },
] as const;
type Kind = typeof kindOptions[number]['value'];

function kindOf(node: Condition): Kind | 'advanced' {
  for (const option of kindOptions) if (option.value in node) return option.value;
  return 'advanced';
}
function fresh(kind: Kind, sources: ConditionSources): Condition {
  const item = sources.items[0]?.id ?? '';
  const npc = sources.npcs[0]?.id ?? '';
  const indicator = sources.npcs[0]?.indicators?.[0]?.id ?? '';
  if (kind === 'storyEvent') return { storyEvent: sources.storyEvents[0]?.id ?? '' };
  if (kind === 'hasItem') return { hasItem: { owner: 'player', item } };
  if (kind === 'indicator') {
    const definition = sources.npcs[0]?.indicators?.[0];
    return { indicator: { npcId: npc, id: indicator, ...defaultComparison(definition?.type ?? 'number', definition?.options) } };
  }
  if (kind === 'playerIndicator') {
    const definition = sources.playerIndicators[0];
    return { playerIndicator: { id: definition?.id ?? '', ...defaultComparison(definition?.type ?? 'number', definition?.options) } };
  }
  if (kind === 'storyIndicator') {
    const definition = sources.storyIndicators?.[0];
    return { storyIndicator: { id: definition?.id ?? '', ...defaultComparison(definition?.type ?? 'number', definition?.options) } };
  }
  if (kind === 'location') return { location: sources.locations[0]?.id ?? '' };
  if (kind === 'unlockedLocation') return { unlockedLocation: sources.locations[0]?.id ?? '' };
  if (kind === 'period') return { period: sources.periods[0] ?? '' };
  if (kind === 'discoveredNpc') return { discoveredNpc: npc };
  if (kind === 'npcLocation') return { npcLocation: { npcId: npc, locationId: sources.locations[0]?.id ?? '' } };
  const field = sources.playerFields[0];
  return { playerField: { id: field?.id ?? '', ...defaultComparison(field?.type ?? 'input', field?.options?.map(option => option.value)) } };
}

function optionsWithMissing(options: { value: string; label: string }[], current: string) {
  return current && !options.some(option => option.value === current)
    ? [{ value: current, label: `无效引用 · ${current}` }, ...options] : options;
}

export default function ConditionEditor({ value, sources, onChange }: Props) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const cleanValue = pruneLegacyCondition(value);
  useEffect(() => { if (JSON.stringify(value) !== JSON.stringify(cleanValue)) onChange(cleanValue); }, [value, onChange]);
  const issueList = conditionIssues(cleanValue, sources);
  const replace = (path: ConditionPath, next: Condition) => onChange(patchCondition(cleanValue, path, { type: 'replace', value: next }));
  const edit = (path: ConditionPath, action: Parameters<typeof patchCondition>[2]) => onChange(patchCondition(cleanValue, path, action));
  const toggleNot = (path: ConditionPath, node: Condition) => replace(path, 'not' in node ? node.not : { not: node });
  const renderLeaf = (node: Condition, path: ConditionPath) => {
    const kind = kindOf(node);
    const select = (current: string, options: { value: string; label: string }[], change: (next: string) => void, label: string) =>
      <Select aria-label={label} size="small" value={current || undefined} placeholder="请选择" options={optionsWithMissing(options, current)} onChange={change} />;
    const itemOptions = sources.items.map(entry => ({ value: entry.id, label: entry.name }));
    const npcOptions = sources.npcs.map(entry => ({ value: entry.id, label: entry.name }));
    const locationOptions = sources.locations.map(entry => ({ value: entry.id, label: entry.name }));
    const ownerOptions = [{ value: 'player', label: '玩家' }, ...sources.npcs.map(entry => ({ value: `npc:${entry.id}`, label: `NPC · ${entry.name}` })),
      ...sources.locations.map(entry => ({ value: `location:${entry.id}`, label: `地点 · ${entry.name}` }))];
    let fields: React.ReactNode = null;
    if ('storyEvent' in node) fields = select(node.storyEvent, sources.storyEvents.map(entry => ({ value: entry.id, label: entry.label })),
      next => replace(path, { storyEvent: next }), '剧情事件');
    else if ('hasItem' in node) fields = <>{select(node.hasItem.item, itemOptions, next => replace(path, { hasItem: { ...node.hasItem, item: next } }), '道具')}
      {select(node.hasItem.owner, ownerOptions, next => replace(path, { hasItem: { ...node.hasItem, owner: next as typeof node.hasItem.owner } }), '持有者')}</>;
    else if ('location' in node) fields = select(node.location, locationOptions, next => replace(path, { location: next }), '当前位置');
    else if ('unlockedLocation' in node) fields = select(node.unlockedLocation, locationOptions, next => replace(path, { unlockedLocation: next }), '已解锁地点');
    else if ('period' in node) fields = select(node.period, sources.periods.map(entry => ({ value: entry, label: entry })), next => replace(path, { period: next }), '时间段');
    else if ('discoveredNpc' in node) fields = select(node.discoveredNpc, npcOptions, next => replace(path, { discoveredNpc: next }), '角色');
    else if ('npcLocation' in node) fields = <>{select(node.npcLocation.npcId, npcOptions, next => replace(path, { npcLocation: { ...node.npcLocation, npcId: next } }), 'NPC')}
      {select(node.npcLocation.locationId, locationOptions, next => replace(path, { npcLocation: { ...node.npcLocation, locationId: next } }), 'NPC 所在地')}</>;
    else if ('indicator' in node || 'playerIndicator' in node || 'storyIndicator' in node || 'playerField' in node) {
      const kind = 'indicator' in node ? 'indicator' : 'playerIndicator' in node ? 'playerIndicator' : 'storyIndicator' in node ? 'storyIndicator' : 'playerField';
      const source = 'indicator' in node ? node.indicator : 'playerIndicator' in node ? node.playerIndicator :
        'storyIndicator' in node ? node.storyIndicator : node.playerField;
      const npcId = 'indicator' in node ? node.indicator.npcId ?? sources.ownerNpcId ?? '' : '';
      const definitions = kind === 'indicator' ? sources.npcs.find(entry => entry.id === npcId)?.indicators ?? [] :
        kind === 'playerIndicator' ? sources.playerIndicators : kind === 'storyIndicator' ? sources.storyIndicators ?? [] :
        sources.playerFields.map(entry => ({ id: entry.id, name: entry.label, type: entry.type ?? 'input', options: entry.options?.map(option => option.value) }));
      const definition = definitions.find(entry => entry.id === source.id);
      const type = definition?.type ?? 'input';
      const construct = (id: string, compare: ValueComparison, targetNpc = npcId): Condition =>
        kind === 'indicator' ? { indicator: { id, npcId: targetNpc, ...compare } } :
        kind === 'playerIndicator' ? { playerIndicator: { id, ...compare } } :
        kind === 'storyIndicator' ? { storyIndicator: { id, ...compare } } : { playerField: { id, ...compare } };
      const options = kind === 'playerField' ? sources.playerFields.find(entry => entry.id === source.id)?.options ?? [] :
        (definition?.options ?? []).map(entry => ({ value: entry, label: entry }));
      fields = <>
        {kind === 'indicator' && select(npcId, npcOptions, next => { const first = sources.npcs.find(entry => entry.id === next)?.indicators?.[0];
          replace(path, { indicator: { npcId: next, id: first?.id ?? '', ...defaultComparison(first?.type ?? 'number', first?.options) } }); }, 'NPC')}
        {select(source.id, definitions.map(entry => ({ value: entry.id, label: entry.name })), next => { const found = definitions.find(entry => entry.id === next);
          replace(path, construct(next, defaultComparison(found?.type ?? 'input', found?.options))); },
        kind === 'indicator' ? 'NPC 指标' : kind === 'playerIndicator' ? '玩家指标' : kind === 'storyIndicator' ? '剧本指标' : '开局资料')}
        <TypedComparisonEditor value={source} type={type} options={options} onChange={compare => replace(path, construct(source.id, compare))} />
      </>;
    } else fields = <span className="creator-condition-advanced">无法识别的旧条件已移除</span>;
    return <div className="creator-condition-leaf">
      <Select<string> aria-label="条件类型" size="small" value={kind} options={[...kindOptions]}
        onChange={next => { if (next !== 'advanced') replace(path, fresh(next as Kind, sources)); }} />
      {fields}
    </div>;
  };
  const renderNode = (node: Condition, path: ConditionPath, depth: number, parent?: { index: number; count: number; path: ConditionPath }) => {
    const key = path.join('.');
    if ('not' in node) return <div className="creator-condition-not" key={key}><div className="creator-condition-toolbar"><strong>不满足（NOT）</strong>
      <span className="creator-condition-toolbar-end" /><button type="button" onClick={() => toggleNot(path, node)}>取消取反</button>
      {parent && <><button type="button" aria-label="上移条件" disabled={parent.index === 0} onClick={() => edit(parent.path, { type: 'move', from: parent.index, to: parent.index - 1 })}>↑</button>
        <button type="button" aria-label="下移条件" disabled={parent.index === parent.count - 1} onClick={() => edit(parent.path, { type: 'move', from: parent.index, to: parent.index + 1 })}>↓</button>
        <button type="button" aria-label="删除条件" disabled={parent.count <= 1} onClick={() => edit(parent.path, { type: 'remove', index: parent.index })}>删除</button></>}</div>
      {renderNode(node.not, [...path, 'not'], depth + 1)}</div>;
    const isGroup = 'all' in node || 'any' in node;
    const children = 'all' in node ? node.all : 'any' in node ? node.any : null;
    const hidden = collapsed.includes(key);
    return <div className={isGroup ? 'creator-condition-group' : 'creator-condition-row'} key={key}>
      <div className="creator-condition-toolbar">
        {isGroup ? <><button type="button" aria-label={hidden ? '展开分组' : '折叠分组'} onClick={() => setCollapsed(hidden ? collapsed.filter(entry => entry !== key) : [...collapsed, key])}>{hidden ? '▸' : '▾'}</button>
          <Select aria-label="分组关系" size="small" value={'all' in node ? 'all' : 'any'} options={[{ value: 'all', label: '全部满足（AND）' }, { value: 'any', label: '满足任一（OR）' }]}
            onChange={next => replace(path, changeConditionKind(node, next as 'all' | 'any'))} /></> : <span className="creator-condition-index">条件</span>}
        <span className="creator-condition-toolbar-end" />
        {!isGroup && <button type="button" aria-label="转为分组" onClick={() => replace(path, { all: [node] })}>转为分组</button>}
        <button type="button" aria-label="取反" onClick={() => toggleNot(path, node)}>取反</button>
        {parent && <><button type="button" aria-label="上移条件" disabled={parent.index === 0} onClick={() => edit(parent.path, { type: 'move', from: parent.index, to: parent.index - 1 })}>↑</button>
          <button type="button" aria-label="下移条件" disabled={parent.index === parent.count - 1} onClick={() => edit(parent.path, { type: 'move', from: parent.index, to: parent.index + 1 })}>↓</button>
          <button type="button" aria-label="删除条件" disabled={parent.count <= 1} onClick={() => edit(parent.path, { type: 'remove', index: parent.index })}>删除</button></>}
      </div>
      {!hidden && (isGroup ? <><div className="creator-condition-children">{children?.map((child, index) => renderNode(child, [...path, index], depth + 1, { index, count: children.length, path }))}</div>
        <div className="creator-condition-add"><button type="button" onClick={() => edit(path, { type: 'insert', index: children?.length ?? 0, value: fresh('storyEvent', sources) })}>＋ 添加条件</button>
          <button type="button" onClick={() => edit(path, { type: 'insert', index: children?.length ?? 0, value: { all: [fresh('storyEvent', sources)] } })}>＋ 添加子分组</button></div></>
        : renderLeaf(node, path))}
    </div>;
  };
  return <div className="creator-condition-editor" aria-label="条件编辑器">
    {renderNode(cleanValue, [], 0)}
    {issueList.length > 0 && <div className="creator-condition-issues" role="alert">{issueList.map((issue, index) => <p key={`${index}-${issue}`}>{issue}</p>)}</div>}
  </div>;
}
