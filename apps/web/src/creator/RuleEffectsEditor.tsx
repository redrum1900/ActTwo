import { Input, InputNumber, Select } from 'antd';
import type { Effect, IndicatorValue, Owner } from '@game/contracts';
import type { ConditionSources } from './condition-tree.js';
import { makeRuleEffect, retargetRuleEffect, ruleIndicatorDefinitions } from './rule-effects.js';

interface Props { effects: readonly Effect[]; sources: ConditionSources; onChange: (effects: Effect[]) => void; onJson?: () => void }
const kinds = [
  { value: 'recordStoryEvent', label: '记录剧情事件' }, { value: 'removeStoryEvent', label: '移除剧情事件' },
  { value: 'giveItem', label: '给予道具' }, { value: 'removeItem', label: '移除道具' }, { value: 'transferItem', label: '转移道具' },
  { value: 'changeIndicator', label: '增减数字指标' }, { value: 'setIndicator', label: '设置指标值' },
  { value: 'addIndicatorTag', label: '添加指标标签' }, { value: 'removeIndicatorTag', label: '移除指标标签' },
];

export default function RuleEffectsEditor({ effects, sources, onChange, onJson }: Props) {
  const patch = (index: number, effect: Effect) => onChange(effects.map((entry, position) => position === index ? effect : entry));
  const owners = [{ value: 'player', label: '玩家' }, ...sources.npcs.map(npc => ({ value: `npc:${npc.id}`, label: `NPC · ${npc.name}` })),
    ...sources.locations.map(location => ({ value: `location:${location.id}`, label: `地点 · ${location.name}` }))];
  const targets = [{ value: 'story', label: '剧本指标' }, { value: 'player', label: '玩家指标' },
    ...sources.npcs.map(npc => ({ value: `npc:${npc.id}`, label: `NPC · ${npc.name}` }))];
  const definitions = (target: string) => ruleIndicatorDefinitions(sources, target);
  const valueEditor = (effect: Extract<Effect, { type: 'setIndicator' }>, definition?: { type: string; options?: string[] }) => {
    const change = (value: IndicatorValue) => patch(effects.indexOf(effect), { ...effect, value });
    if (definition?.type === 'number') return <InputNumber size="small" aria-label="指标值" value={typeof effect.value === 'number' ? effect.value : 0} onChange={value => change(value ?? 0)} />;
    if (definition?.type === 'boolean') return <Select size="small" aria-label="指标值" value={typeof effect.value === 'boolean' ? effect.value : false}
      options={[{ value: true, label: '是' }, { value: false, label: '否' }]} onChange={change} />;
    if (definition?.type === 'enum') return <Select size="small" aria-label="指标值" value={typeof effect.value === 'string' ? effect.value || undefined : undefined}
      options={definition.options?.map(value => ({ value, label: value }))} onChange={change} />;
    if (definition?.type === 'tags') return <Select mode="tags" size="small" aria-label="指标值" value={Array.isArray(effect.value) ? effect.value : []} onChange={change} />;
    return <Input size="small" aria-label="指标值" type={definition?.type === 'date' ? 'date' : 'text'} value={typeof effect.value === 'string' ? effect.value : ''}
      onChange={event => change(event.target.value)} />;
  };
  return <div className="creator-rule-effects"><div className="creator-period-heading"><div><strong>结算效果</strong><p>按顺序执行；任一效果失败时整条规则不会生效。</p></div>
    <button type="button" onClick={() => onChange([...effects, makeRuleEffect('recordStoryEvent', sources)])}>＋ 添加效果</button></div>
    {effects.map((effect, index) => {
      const known = kinds.some(kind => kind.value === effect.type);
      const target = 'target' in effect ? effect.target ?? 'player' : 'player';
      const indicator = 'id' in effect ? definitions(target).find(entry => entry.id === effect.id) : undefined;
      return <div className="creator-rule-effect" key={index}><div className="creator-rule-effect-main"><span>{index + 1}.</span>
        <Select aria-label="效果类型" size="small" value={known ? effect.type : 'advanced'} options={known ? kinds : [{ value: 'advanced', label: '高级效果' }, ...kinds]}
          onChange={type => patch(index, makeRuleEffect(type, sources))} />
        {!known ? <span>高级效果原样保留 {onJson && <button type="button" onClick={onJson}>JSON ↗</button>}</span> :
          effect.type === 'recordStoryEvent' || effect.type === 'removeStoryEvent' ? <Select aria-label="剧情事件" size="small" value={effect.eventId || undefined}
            options={sources.storyEvents.map(entry => ({ value: entry.id, label: entry.label }))} onChange={eventId => patch(index, { ...effect, eventId })} /> :
          'item' in effect ? <><Select aria-label="道具" size="small" value={effect.item || undefined}
            options={sources.items.map(entry => ({ value: entry.id, label: entry.name }))} onChange={item => patch(index, { ...effect, item })} />
            {'from' in effect && <Select aria-label="原持有者" size="small" value={effect.from} options={owners} onChange={from => patch(index, { ...effect, from: from as Owner })} />}
            {'to' in effect && <Select aria-label="目标持有者" size="small" value={effect.to} options={owners} onChange={to => patch(index, { ...effect, to: to as Owner })} />}</> :
          'id' in effect ? <><Select aria-label="指标范围" size="small" value={target} options={targets} onChange={next => {
            if (effect.type === 'changeIndicator' || effect.type === 'setIndicator' || effect.type === 'addIndicatorTag' || effect.type === 'removeIndicatorTag')
              patch(index, retargetRuleEffect(effect, sources, next));
          }} /><Select aria-label="指标" size="small" value={effect.id || undefined} options={definitions(target)
            .filter(entry => effect.type === 'changeIndicator' ? entry.type === 'number' :
              effect.type === 'addIndicatorTag' || effect.type === 'removeIndicatorTag' ? entry.type === 'tags' : true)
            .map(entry => ({ value: entry.id, label: entry.name }))} onChange={id => {
              if (effect.type === 'changeIndicator' || effect.type === 'setIndicator' || effect.type === 'addIndicatorTag' || effect.type === 'removeIndicatorTag')
                patch(index, retargetRuleEffect(effect, sources, target, id));
            }} />
            {effect.type === 'changeIndicator' ? <InputNumber size="small" aria-label="增减数值" value={effect.by} onChange={by => patch(index, { ...effect, by: by ?? 0 })} /> :
              effect.type === 'setIndicator' ? valueEditor(effect, indicator) :
                effect.type === 'addIndicatorTag' || effect.type === 'removeIndicatorTag' ?
                  <Input size="small" aria-label="标签" value={effect.tag} onChange={event => patch(index, { ...effect, tag: event.target.value })} /> : null}</> : null}
        <button type="button" className="creator-danger-link" onClick={() => onChange(effects.filter((_, position) => position !== index))}>删除</button>
      </div></div>;
    })}
    {!effects.length && <div className="creator-empty-inline">尚无结算效果。规则命中后需要至少一项有效变化。</div>}
  </div>;
}
