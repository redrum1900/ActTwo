import { Select } from 'antd';
import type { Condition } from '@game/contracts';
import ConditionEditor from './ConditionEditor.js';
import type { ConditionSources } from './condition-tree.js';
import { currentRecordedStoryEvents, setRecordedStoryEvents } from './story-event-rule.js';

interface EventOption { id: string; label: string }
interface Props { rule: Record<string, unknown>; savedStoryEvents: EventOption[]; sources: ConditionSources;
  onChange: (rule: Record<string, unknown>) => void; onJson?: () => void }

export default function StoryEventRuleControls({ rule, savedStoryEvents, sources, onChange, onJson }: Props) {
  const condition = (rule.when ?? rule.condition) as Condition | undefined;
  const recordedIds = currentRecordedStoryEvents(rule);
  const options = savedStoryEvents.map(event => ({ value: event.id, label: event.label }));
  const missing = [...new Set(recordedIds.filter(id => !savedStoryEvents.some(event => event.id === id)))];
  return <div className="creator-story-rule-controls">
    <div className="creator-rule-condition"><strong>前置条件</strong>{condition
      ? <ConditionEditor value={condition} sources={sources} onJson={onJson} onChange={when => onChange({ ...rule, when, condition: undefined })} />
      : <button type="button" onClick={() => onChange({ ...rule, when: { all: [{ storyEvent: savedStoryEvents[0]?.id ?? '' }] } })}>＋ 添加前置条件</button>}</div>
    <label><span>成功后记录剧情事件</span><Select mode="multiple" placeholder="选择已保存的事件" value={recordedIds}
      options={options} onChange={values => onChange(setRecordedStoryEvents(rule, values))} />
    </label>
    {missing.length > 0 && <small className="creator-field-warning">此规则引用的事件已不存在：{missing.join('、')}。请重新选择，否则无法提交审核。</small>}
    {!savedStoryEvents.length && <small>先在「故事设定」新增并保存剧情事件，再来绑定规则。</small>}
  </div>;
}
