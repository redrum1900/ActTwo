import { Input, InputNumber, Select, Switch } from 'antd';
import type { Condition, Effect } from '@game/contracts';
import ConditionEditor from './ConditionEditor.js';
import RuleEffectsEditor from './RuleEffectsEditor.js';
import type { ConditionSources } from './condition-tree.js';

interface EventOption { id: string; label: string }
interface Props { rule: Record<string, unknown>; savedStoryEvents: EventOption[]; sources: ConditionSources;
  groupOptions: string[]; onChange: (rule: Record<string, unknown>) => void; onJson?: () => void }

export default function StoryEventRuleControls({ rule, savedStoryEvents, sources, groupOptions, onChange, onJson }: Props) {
  const condition = (rule.when ?? rule.condition) as Condition | undefined;
  const playerRule = !sources.ownerNpcId;
  const trigger = String(rule.trigger ?? (playerRule ? 'automatic' : 'semantic'));
  const supportedTrigger = playerRule || trigger === 'semantic' || trigger === 'automatic';
  return <div className="creator-story-rule-controls">
    <div className="creator-rule-core">
      <label><span>触发名称／意图</span><Input size="small" value={String(rule.intent ?? '')} onChange={event => onChange({ ...rule, intent: event.target.value })} /></label>
      <label><span>触发方式</span><Select size="small" value={supportedTrigger ? trigger : undefined}
        placeholder="请选择有效触发方式"
        options={playerRule ? [{ value: 'automatic', label: '自动' }, { value: 'action', label: '玩家动作' }] :
          [{ value: 'semantic', label: '语义判断' }, { value: 'automatic', label: '自动' }]}
        onChange={trigger => onChange({ ...rule, trigger })} /></label>
      <label><span>优先级</span><InputNumber size="small" value={typeof rule.priority === 'number' ? rule.priority : 0}
        onChange={priority => onChange({ ...rule, priority: priority ?? 0 })} /></label>
      <label className="creator-rule-once"><span>仅触发一次</span><Switch checked={rule.once === true} onChange={once => onChange({ ...rule, once })} /></label>
      <label><span>编辑分组</span><Select mode="tags" maxCount={1} size="small" allowClear aria-label="编辑分组"
        placeholder="未分组；输入可新建" value={typeof rule.editorGroup === 'string' && rule.editorGroup.trim() ? [rule.editorGroup] : []}
        options={groupOptions.map(group => ({ value: group, label: group }))}
        onChange={groups => onChange({ ...rule, editorGroup: groups.at(-1)?.trim() || undefined })} /></label>
      {playerRule && rule.trigger === 'action' && <label><span>玩家动作</span><Select mode="multiple" size="small" value={Array.isArray(rule.actions) ? rule.actions as string[] : []}
        options={['move', 'wait', 'explore', 'search', 'take', 'chat'].map(action => ({ value: action, label: action }))}
        onChange={actions => onChange({ ...rule, actions })} /></label>}
    </div>
    {!supportedTrigger && <small className="creator-field-warning">旧规则的动作触发方式不会执行；请选择有效触发方式并保存。</small>}
    <div className="creator-rule-condition"><strong>前置条件</strong>{condition
      ? <ConditionEditor value={condition} sources={sources} onJson={onJson} onChange={when => onChange({ ...rule, when, condition: undefined })} />
      : <button type="button" onClick={() => onChange({ ...rule, when: { all: [{ storyEvent: savedStoryEvents[0]?.id ?? '' }] } })}>＋ 添加前置条件</button>}</div>
    <RuleEffectsEditor effects={Array.isArray(rule.effects) ? rule.effects as Effect[] : []} sources={sources}
      onChange={effects => onChange({ ...rule, effects })} onJson={onJson} />
  </div>;
}
