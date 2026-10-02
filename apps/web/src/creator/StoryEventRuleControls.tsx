import { Select } from 'antd';
import { currentRecordedStoryEvents, currentStoryEventGate, setRecordedStoryEvents, setStoryEventGate } from './story-event-rule.js';

interface EventOption { id: string; label: string }
interface Props { rule: Record<string, unknown>; savedStoryEvents: EventOption[]; onChange: (rule: Record<string, unknown>) => void }

export default function StoryEventRuleControls({ rule, savedStoryEvents, onChange }: Props) {
  const conditionId = currentStoryEventGate(rule);
  const recordedIds = currentRecordedStoryEvents(rule);
  const options = savedStoryEvents.map(event => ({ value: event.id, label: event.label }));
  const missing = [...new Set([conditionId, ...recordedIds].filter((id): id is string => !!id && !savedStoryEvents.some(event => event.id === id)))];
  return <div className="creator-story-rule-controls">
    <label><span>需要已发生的剧情事件</span><Select allowClear placeholder="不设条件" value={conditionId ?? undefined}
      options={options} onChange={value => onChange(setStoryEventGate(rule, value || null))} />
    </label>
    <label><span>成功后记录剧情事件</span><Select mode="multiple" placeholder="选择已保存的事件" value={recordedIds}
      options={options} onChange={values => onChange(setRecordedStoryEvents(rule, values))} />
    </label>
    {missing.length > 0 && <small className="creator-field-warning">此规则引用的事件已不存在：{missing.join('、')}。请重新选择，否则无法提交审核。</small>}
    {!savedStoryEvents.length && <small>先在「故事设定」新增并保存剧情事件，再来绑定规则。</small>}
  </div>;
}
