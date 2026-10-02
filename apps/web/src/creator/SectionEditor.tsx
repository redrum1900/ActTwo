import { useMemo, useState } from 'react';
import { fieldLabels, labelOf, starterEntry } from './sections.js';
import ManifestEditor from './ManifestEditor.js';
import LocationsEditor from './LocationsEditor.js';
import StoryEventRuleControls from './StoryEventRuleControls.js';
import ItemsEditor from './ItemsEditor.js';
import GalleryEditor from './GalleryEditor.js';
import type { ConditionSources } from './condition-tree.js';

interface Props { path: string; content: string; onChange: (value: string) => void;
  savedLocations?: { id: string; name: string }[]; projectId?: string;
  savedStoryEvents?: { id: string; label: string }[];
  referencedStoryEventIds?: readonly string[];
  conditionSources?: ConditionSources;
  coverFile?: File | null; onCoverFileChange?: (file: File | null) => void;
  itemImageFiles?: Record<string, File>; onItemImageFileChange?: (id: string, file: File | null) => void }
const stringify = (value: unknown) => JSON.stringify(value, null, 2);
const primitive = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value);

export default function SectionEditor({ path, content, onChange, savedLocations = [], savedStoryEvents = [], referencedStoryEventIds = [], conditionSources, projectId, coverFile, onCoverFileChange,
  itemImageFiles, onItemImageFileChange }: Props) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const parsed = useMemo(() => { try { return { value: JSON.parse(content) as unknown, error: '' }; }
    catch (error) { return { value: undefined, error: error instanceof Error ? error.message : 'JSON 格式错误' }; } }, [content]);
  const invalidLocations = path === 'locations.json' && Array.isArray(parsed.value)
    && parsed.value.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string');
  const tabbedPath = ['items.json', 'endings.json', 'achievements.json'].includes(path);
  const invalidTabbedEntries = tabbedPath && Array.isArray(parsed.value)
    && parsed.value.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !entry.id);
  const info = labelOf(path);
  const sources: ConditionSources = conditionSources ?? { storyEvents: savedStoryEvents, items: [], npcs: [], locations: savedLocations,
    playerIndicators: [], periods: [], playerFields: [], rules: [] };
  const update = (value: unknown) => onChange(stringify(value));
  const renderObject = (value: Record<string, unknown>, commit: (next: Record<string, unknown>) => void) =>
    <div className="creator-fields">{Object.entries(value).map(([key, current]) => <label className="creator-field" key={key}>
      <span>{fieldLabels[key] ? `${fieldLabels[key]} · ${key}` : key}</span>
      {typeof current === 'boolean' ? <select value={String(current)} onChange={event => commit({ ...value, [key]: event.target.value === 'true' })}>
        <option value="true">是 / true</option><option value="false">否 / false</option></select>
        : primitive(current) ? <input value={String(current)} onChange={event => commit({ ...value,
          [key]: typeof current === 'number' ? (Number(event.target.value) || 0) : event.target.value })} />
          : <><textarea rows={Math.min(8, Math.max(3, stringify(current).split('\n').length))} value={stringify(current)} readOnly
            aria-label={`${key} 复杂结构预览`} /><button className="creator-small" type="button" onClick={() => setMode('json')}>在 JSON 模式编辑此结构 ↗</button></>}
    </label>)}<button className="creator-add-field" type="button" onClick={() => {
      const key = prompt('新字段名称（请按剧本配置规范填写）');
      if (key?.trim() && !(key.trim() in value)) commit({ ...value, [key.trim()]: '' });
    }}>＋ 添加字段</button></div>;
  const value = parsed.value;
  return <section className="creator-section-editor">
    <div className="creator-section-head"><div><div className="creator-kicker">CONFIGURATION / {path}</div><h2>{info.name}</h2><p>{info.help}</p></div>
      <div className="creator-mode" role="group" aria-label="编辑模式"><button className={mode === 'form' ? 'active' : ''} disabled={!!parsed.error || invalidLocations || invalidTabbedEntries} onClick={() => setMode('form')}>表单</button>
        <button className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>JSON</button></div></div>
    {parsed.error && <div className="creator-error" role="alert">JSON 尚未完成：{parsed.error}。原文会保留，请修正后再切回表单。</div>}
    {invalidLocations && <div className="creator-error" role="alert">地点列表存在缺少 ID 的条目，请在 JSON 模式修正；原文不会被覆盖。</div>}
    {invalidTabbedEntries && <div className="creator-error" role="alert">列表存在缺少 ID 的条目，请在 JSON 模式修正；原文不会被覆盖。</div>}
    {mode === 'json' || parsed.error || invalidLocations || invalidTabbedEntries ? <textarea className="creator-json" spellCheck={false} aria-label={`${info.name} JSON`}
      value={content} onChange={event => onChange(event.target.value)} />
      : path === 'manifest.json' && value && typeof value === 'object' && !Array.isArray(value)
        ? <ManifestEditor content={content} onChange={onChange} savedLocations={savedLocations} projectId={projectId}
          coverFile={coverFile} onCoverFileChange={onCoverFileChange} referencedStoryEventIds={referencedStoryEventIds} />
      : path === 'locations.json' && Array.isArray(value)
        ? <LocationsEditor content={content} onChange={onChange} />
      : path === 'items.json' && Array.isArray(value)
        ? <ItemsEditor content={content} onChange={onChange} projectId={projectId} imageFiles={itemImageFiles} onImageFileChange={onItemImageFileChange} />
      : (path === 'endings.json' || path === 'achievements.json') && Array.isArray(value)
        ? <GalleryEditor content={content} onChange={onChange} kind={path === 'endings.json' ? '结局' : '成就'} sources={sources} onJson={() => setMode('json')} />
      : Array.isArray(value) ? <div className="creator-entries">
        <div className="creator-entry-toolbar"><span>共 {value.length} 项</span><button onClick={() => update([...value, starterEntry(path, value.length)])}>＋ 添加一项</button></div>
        {value.length === 0 && <div className="creator-empty-inline">暂无内容。点击“添加一项”开始配置。</div>}
        {value.map((entry, index) => <div className="creator-entry" key={index}><div className="creator-entry-head"><strong>{typeof entry === 'object' && entry !== null && 'name' in entry ? String(entry.name) : `第 ${index + 1} 项`}</strong>
          <button className="creator-danger-link" onClick={() => update(value.filter((_, i) => i !== index))}>移除</button></div>
          {entry && typeof entry === 'object' && !Array.isArray(entry) ? renderObject(entry as Record<string, unknown>, next => update(value.map((item, i) => i === index ? next : item)))
            : <textarea value={stringify(entry)} onChange={event => { try { const next = JSON.parse(event.target.value); update(value.map((item, i) => i === index ? next : item)); } catch { /* Advanced JSON editor supports incomplete input. */ } }} />}
          {entry && typeof entry === 'object' && !Array.isArray(entry) && (path === 'player/rules.json' || path.endsWith('/rules.json')) &&
            <StoryEventRuleControls rule={entry as Record<string, unknown>} savedStoryEvents={savedStoryEvents}
              sources={{ ...sources, ownerNpcId: /^npcs\/([^/]+)\/rules\.json$/.exec(path)?.[1] }} onJson={() => setMode('json')}
              onChange={next => update(value.map((item, i) => i === index ? next : item))} />}
          <button className="creator-small" onClick={() => { setMode('json'); }}>编辑完整结构 ↗</button>
        </div>)}</div>
        : value && typeof value === 'object' ? renderObject(value as Record<string, unknown>, update)
          : <div className="creator-error">此配置项应为对象或数组，请在 JSON 模式调整。</div>}
  </section>;
}
