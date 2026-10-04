import { useState } from 'react';
import { Select } from 'antd';
import TabbedEntriesEditor from './TabbedEntriesEditor.js';
import StoryEventRuleControls from './StoryEventRuleControls.js';
import { newEntryId } from '../model/section-forms.js';
import type { ConditionSources } from '../model/condition-tree.js';

interface RuleDraft { id: string; intent?: string; editorGroup?: string; [key: string]: unknown }
interface Props { entries: RuleDraft[]; path: string; onChange: (value: string) => void;
  savedStoryEvents: { id: string; label: string }[]; sources: ConditionSources; onJson: () => void }
const ungrouped = '\0ungrouped';
const groupOf = (rule: RuleDraft) => typeof rule.editorGroup === 'string' ? rule.editorGroup.trim() : '';

export default function RulesEditor({ entries, path, onChange, savedStoryEvents, sources, onJson }: Props) {
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const update = (next: RuleDraft[]) => onChange(JSON.stringify(next, null, 2));
  const groups = [...new Set(entries.map(groupOf).filter(Boolean))];
  const options = [...groups.map(group => ({ value: group, label: group })), { value: ungrouped, label: '未分组' }];
  const namedEntries = entries.map(entry => ({ ...entry, name: String(entry.intent ?? '未命名规则') }));
  const visibleEntries = !selectedGroups.length ? namedEntries : namedEntries.filter(entry => {
    const group = groupOf(entry) || ungrouped;
    return selectedGroups.includes(group);
  });
  return <>
    <div className="creator-rule-filter"><label><span>筛选分组</span><Select mode="multiple" size="small" allowClear
      aria-label="筛选分组" placeholder="全部分组（含未分组）" value={selectedGroups} options={options} onChange={setSelectedGroups} /></label></div>
    <TabbedEntriesEditor entries={namedEntries} visibleEntries={visibleEntries} kind="规则" layout="side" onAdd={() => {
      setSelectedGroups([]);
      const rule = { id: newEntryId(), intent: '新规则', trigger: path === 'player/rules.json' ? 'automatic' : 'semantic', once: false, effects: [] };
      update([...entries, rule]); return { ...rule, name: rule.intent };
    }} onRemove={id => update(entries.filter(entry => entry.id !== id))}
      render={entry => <StoryEventRuleControls rule={entries.find(rule => rule.id === entry.id) as RuleDraft}
        groupOptions={groups} savedStoryEvents={savedStoryEvents}
        sources={{ ...sources, ownerNpcId: /^npcs\/([^/]+)\/rules\.json$/.exec(path)?.[1] }} onJson={onJson}
        onChange={next => update(entries.map(rule => rule.id === entry.id ? next as RuleDraft : rule))} />} />
  </>;
}
