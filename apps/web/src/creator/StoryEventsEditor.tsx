import { useState } from 'react';
import { confirmAction } from '../dialogs.js';
import { newStoryEvent, patchManifest, patchStoryEvent, removeStoryEvent } from './section-forms.js';

interface StoryEvent { id: string; label: string; detail: string }
interface Props { content: string; onChange: (value: string) => void; referencedIds?: readonly string[] }

export default function StoryEventsEditor({ content, onChange, referencedIds = [] }: Props) {
  const manifest = JSON.parse(content) as { storyEvents?: StoryEvent[] };
  const events = Array.isArray(manifest.storyEvents) ? manifest.storyEvents : [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find(event => event.id === selectedId) ?? events[0];
  const add = () => {
    const next = newStoryEvent();
    onChange(patchManifest(content, { storyEvents: [...events, next] }));
    setSelectedId(next.id);
  };
  const remove = async (event: StoryEvent) => {
    if (!await confirmAction(referencedIds.includes(event.id)
      ? `剧情事件「${event.label || '未命名'}」仍被配置引用。删除后将无法提交审核，确定删除？`
      : `确定删除剧情事件「${event.label || '未命名'}」？`, true)) return;
    onChange(removeStoryEvent(content, event.id));
    if (selected?.id === event.id) setSelectedId(events.find(entry => entry.id !== event.id)?.id ?? null);
  };
  return <section className="creator-story-events" aria-label="剧情事件">
    <div className="creator-period-heading"><div><strong>剧情事件</strong><p>规则触发后写入剧本快照；后续条件可引用。名称和详情不自动展示给玩家。</p></div>
      <button type="button" onClick={add}>＋ 新增事件</button></div>
    {!events.length ? <p className="creator-empty-inline">还没有剧情事件。需要跨对话记住某件事时，在这里新增。</p>
      : <div className="creator-story-event-layout">
        <div className="creator-story-event-tabs" role="tablist" aria-label="剧情事件列表">{events.map(event =>
          <button type="button" role="tab" aria-selected={selected?.id === event.id} className={selected?.id === event.id ? 'active' : ''}
            key={event.id} onClick={() => setSelectedId(event.id)}>{event.label || '未命名事件'}</button>)}</div>
        {selected && <div className="creator-story-event-form" role="tabpanel">
          <label className="creator-field"><span>事件名称</span><input value={selected.label}
            onChange={event => onChange(patchStoryEvent(content, selected.id, { label: event.target.value }))} placeholder="例如：首次告白" /></label>
          <label className="creator-field"><span>事件详情</span><textarea rows={3} value={selected.detail}
            onChange={event => onChange(patchStoryEvent(content, selected.id, { detail: event.target.value }))} placeholder="供作者辨认，不自动进入玩家日志" /></label>
          {referencedIds.includes(selected.id) && <small className="creator-field-warning">此事件已被其他配置引用。删除前请先解除引用。</small>}
          <button type="button" className="creator-danger-link" onClick={() => remove(selected)}>删除此事件</button>
        </div>}
      </div>}
  </section>;
}
