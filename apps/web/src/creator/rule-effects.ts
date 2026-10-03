import type { Effect, IndicatorValue } from '@game/contracts';
import type { ConditionSources } from './condition-tree.js';

type IndicatorEffect = Extract<Effect, { type: 'changeIndicator' | 'setIndicator' | 'addIndicatorTag' | 'removeIndicatorTag' }>;
type IndicatorSource = { id: string; name: string; type: string };

export function ruleIndicatorDefinitions(sources: ConditionSources, target: string): IndicatorSource[] {
  return target === 'story' ? (sources.storyIndicators ?? []).filter(entry => !entry.systemRole) :
    target === 'player' ? sources.playerIndicators : sources.npcs.find(npc => `npc:${npc.id}` === target)?.indicators ?? [];
}

export function initialIndicatorValue(type: string): IndicatorValue {
  return type === 'number' ? 0 : type === 'boolean' ? false : type === 'tags' ? [] : '';
}

export function retargetRuleEffect(effect: IndicatorEffect, sources: ConditionSources, target: string, id?: string): IndicatorEffect {
  const definitions = ruleIndicatorDefinitions(sources, target).filter(entry => effect.type === 'changeIndicator' ? entry.type === 'number' :
    effect.type === 'addIndicatorTag' || effect.type === 'removeIndicatorTag' ? entry.type === 'tags' : true);
  const selected = definitions.find(entry => entry.id === id) ?? definitions[0];
  if (effect.type === 'setIndicator') return { ...effect, target: target as IndicatorEffect['target'], id: selected?.id ?? '', value: initialIndicatorValue(selected?.type ?? 'text') };
  return { ...effect, target: target as IndicatorEffect['target'], id: selected?.id ?? '' };
}

export function makeRuleEffect(type: string, sources: ConditionSources): Effect {
  if (type === 'recordStoryEvent' || type === 'removeStoryEvent') return { type, eventId: sources.storyEvents[0]?.id ?? '' };
  if (type === 'giveItem') return { type, to: 'player', item: sources.items[0]?.id ?? '' };
  if (type === 'removeItem') return { type, from: 'player', item: sources.items[0]?.id ?? '' };
  if (type === 'transferItem') return { type, from: 'player', to: 'player', item: sources.items[0]?.id ?? '' };
  if (type === 'changeIndicator') return retargetRuleEffect({ type, target: 'player', id: '', by: 1 }, sources, 'player');
  if (type === 'setIndicator') return retargetRuleEffect({ type, target: 'player', id: '', value: '' }, sources, 'player');
  return retargetRuleEffect({ type: type as 'addIndicatorTag' | 'removeIndicatorTag', target: 'player', id: '', tag: '' }, sources, 'player');
}
