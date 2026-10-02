import { useState } from 'react';
import { InputNumber, Select } from 'antd';
import type { Condition } from '@game/contracts';
import { changeConditionKind, conditionIssues, patchCondition, type ConditionPath, type ConditionSources } from './condition-tree.js';

interface Props { value: Condition; sources: ConditionSources; onChange: (value: Condition) => void; onJson?: () => void }
type IndicatorCompare = { gte?: number; lte?: number; eq?: number | string | boolean; ne?: number | string | boolean; has?: string; lacks?: string };

const kindOptions = [
  { value: 'storyEvent', label: '剧情事件' }, { value: 'hasItem', label: '持有道具' },
  { value: 'indicator', label: 'NPC 指标' }, { value: 'playerIndicator', label: '玩家指标' },
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
    return { indicator: { npcId: npc, id: indicator,
      ...(definition?.type === 'tags' ? { has: '' } : { eq: definition?.type === 'boolean' ? false : definition?.type === 'enum' ? definition.options?.[0] ?? '' : 0 }) } };
  }
  if (kind === 'playerIndicator') {
    const definition = sources.playerIndicators[0];
    return { playerIndicator: { id: definition?.id ?? '',
      ...(definition?.type === 'tags' ? { has: '' } : { eq: definition?.type === 'boolean' ? false : definition?.type === 'enum' ? definition.options?.[0] ?? '' : 0 }) } };
  }
  if (kind === 'location') return { location: sources.locations[0]?.id ?? '' };
  if (kind === 'unlockedLocation') return { unlockedLocation: sources.locations[0]?.id ?? '' };
  if (kind === 'period') return { period: sources.periods[0] ?? '' };
  if (kind === 'discoveredNpc') return { discoveredNpc: npc };
  if (kind === 'npcLocation') return { npcLocation: { npcId: npc, locationId: sources.locations[0]?.id ?? '' } };
  return { playerField: { id: sources.playerFields[0]?.id ?? '', eq: '' } };
}

function optionsWithMissing(options: { value: string; label: string }[], current: string) {
  return current && !options.some(option => option.value === current)
    ? [{ value: current, label: `无效引用 · ${current}` }, ...options] : options;
}

function comparison(value: IndicatorCompare, type: string) {
  const operators = type === 'number' ? ['gte', 'lte', 'eq', 'ne'] : type === 'tags' ? ['has', 'lacks'] : ['eq', 'ne'];
  const operator = operators.find(key => value[key as keyof IndicatorCompare] !== undefined) ?? operators[0];
  const current = value[operator as keyof IndicatorCompare];
  return { operators, operator, current };
}

export default function ConditionEditor({ value, sources, onChange, onJson }: Props) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const issueList = conditionIssues(value, sources);
  const replace = (path: ConditionPath, next: Condition) => onChange(patchCondition(value, path, { type: 'replace', value: next }));
  const edit = (path: ConditionPath, action: Parameters<typeof patchCondition>[2]) => onChange(patchCondition(value, path, action));
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
    else if ('playerField' in node) fields = <>{select(node.playerField.id, sources.playerFields.map(entry => ({ value: entry.id, label: entry.label })),
      next => replace(path, { playerField: { ...node.playerField, id: next } }), '开局资料')}
      <input className="creator-condition-value" aria-label="比较内容" value={node.playerField.eq ?? node.playerField.has ?? ''}
        onChange={event => replace(path, { playerField: { id: node.playerField.id, eq: event.target.value } })} /></>;
    else if ('indicator' in node || 'playerIndicator' in node) {
      const npcMode = 'indicator' in node;
      const source = npcMode ? node.indicator : node.playerIndicator;
      const npcId = npcMode ? node.indicator.npcId ?? sources.ownerNpcId ?? '' : '';
      const definitions = npcMode ? sources.npcs.find(entry => entry.id === npcId)?.indicators ?? [] : sources.playerIndicators;
      const definition = definitions.find(entry => entry.id === source.id);
      const type = definition?.type ?? 'number';
      const { operators, operator, current } = comparison(source, type);
      const construct = (id: string, op: string, val: number | string | boolean, targetNpc = npcId): Condition => {
        const compared = { id, [op]: val };
        return npcMode ? { indicator: { ...compared, npcId: targetNpc } } : { playerIndicator: compared };
      };
      fields = <>
        {npcMode && select(npcId, npcOptions, next => { const first = sources.npcs.find(entry => entry.id === next)?.indicators?.[0];
          replace(path, { indicator: { npcId: next, id: first?.id ?? '', eq: first?.type === 'boolean' ? false : first?.type === 'enum' ? first.options?.[0] ?? '' : 0 } }); }, 'NPC')}
        {select(source.id, definitions.map(entry => ({ value: entry.id, label: entry.name })), next => { const found = definitions.find(entry => entry.id === next);
          const op = found?.type === 'tags' ? 'has' : 'eq';
          const val = found?.type === 'boolean' ? false : found?.type === 'enum' ? found.options?.[0] ?? '' : found?.type === 'number' ? 0 : '';
          replace(path, construct(next, op, val)); }, npcMode ? 'NPC 指标' : '玩家指标')}
        <Select aria-label="比较方式" size="small" value={operator} options={operators.map(entry => ({ value: entry, label: ({ gte: '≥', lte: '≤', eq: '=', ne: '≠', has: '包含', lacks: '不含' } as Record<string, string>)[entry] }))}
          onChange={next => replace(path, construct(source.id, next, type === 'boolean' ? false : type === 'number' ? 0 : type === 'enum' ? definition?.options?.[0] ?? '' : ''))} />
        {type === 'number' ? <InputNumber aria-label="比较值" size="small" value={typeof current === 'number' ? current : 0}
          onChange={next => replace(path, construct(source.id, operator, next ?? 0))} />
          : type === 'boolean' ? <Select aria-label="比较值" size="small" value={typeof current === 'boolean' ? current : false}
            options={[{ value: true, label: '是' }, { value: false, label: '否' }]}
            onChange={next => replace(path, construct(source.id, operator, next))} />
          : type === 'enum' ? select(String(current ?? ''), (definition?.options ?? []).map(entry => ({ value: entry, label: entry })),
            next => replace(path, construct(source.id, operator, next)), '比较值')
          : <input className="creator-condition-value" aria-label="比较值" value={String(current ?? '')}
            onChange={event => replace(path, construct(source.id, operator, event.target.value))} />}
      </>;
    } else fields = <span className="creator-condition-advanced">高级条件将原样保留：{JSON.stringify(node)} {onJson && <button type="button" onClick={onJson}>去 JSON 模式编辑</button>}</span>;
    return <div className="creator-condition-leaf">
      <Select<string> aria-label="条件类型" size="small" value={kind} options={kind === 'advanced' ? [{ value: 'advanced', label: '高级条件' }, ...kindOptions] : [...kindOptions]}
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
    {renderNode(value, [], 0)}
    {issueList.length > 0 && <div className="creator-condition-issues" role="alert">{issueList.map((issue, index) => <p key={`${index}-${issue}`}>{issue}</p>)}</div>}
  </div>;
}
