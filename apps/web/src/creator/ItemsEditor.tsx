import { useEffect, useState } from 'react';
import { Tag, Upload } from 'antd';
import TabbedEntriesEditor from './TabbedEntriesEditor.js';
import { addEntry, addEntryTag, newEntryId, patchEntryById, removeEntry, removeEntryTag } from './section-forms.js';

interface ItemDraft { id: string; name: string; description?: string; detail?: string; initialTags?: string[]; image?: string; [key: string]: unknown }
interface Props { content: string; onChange: (value: string) => void; projectId?: string;
  imageFiles?: Record<string, File>; onImageFileChange?: (id: string, file: File | null) => void }

function ItemImagePicker({ item, projectId, file, onFileChange, onRemoveSaved }: {
  item: ItemDraft; projectId?: string; file?: File; onFileChange: (file: File | null) => void; onRemoveSaved: () => void;
}) {
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const savedPreview = item.image?.startsWith('/api/item-images/') && projectId
    ? `/api/creator/projects/${encodeURIComponent(projectId)}/item-images/${item.image.split('/').at(-1)}` : '';
  return <div className="creator-item-image"><strong>道具图片</strong><div className="creator-item-image-picker">
    {(preview || savedPreview) ? <img src={preview || savedPreview} alt={`${item.name}图片预览`} /> : <div className="creator-item-image-empty">暂无图片</div>}
    <div><Upload accept="image/png,image/jpeg,image/webp" maxCount={1} showUploadList={false} beforeUpload={selected => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 5 * 1024 * 1024) {
        setError('请选择不超过 5 MB 的 PNG、JPEG 或 WebP 图片'); return Upload.LIST_IGNORE;
      }
      setError(''); onFileChange(selected); return Upload.LIST_IGNORE;
    }}><button type="button">选择图片</button></Upload>
      {(file || item.image) && <button type="button" className="creator-danger-link" onClick={() => file ? onFileChange(null) : onRemoveSaved()}>{file ? '取消选择' : '移除图片'}</button>}
      <p>PNG、JPEG 或 WebP，最大 5 MB。选择后仅本页预览，点击保存后上传。</p>
      {error && <small className="creator-field-warning" role="alert">{error}</small>}
    </div>
  </div></div>;
}

export default function ItemsEditor({ content, onChange, projectId, imageFiles = {}, onImageFileChange }: Props) {
  const entries = JSON.parse(content) as ItemDraft[];
  const [newTag, setNewTag] = useState('');
  const patch = (id: string, fields: Record<string, unknown>) => onChange(patchEntryById(content, id, fields));
  return <TabbedEntriesEditor entries={entries} kind="道具" onAdd={() => {
    const item = { id: newEntryId(), name: '新道具', description: '', detail: '', initialTags: [] };
    onChange(addEntry(content, item)); return item;
  }} onRemove={id => { onImageFileChange?.(id, null); onChange(removeEntry(content, id)); }} render={item => <>
    <div className="creator-form-grid">
      <label className="creator-field"><span>道具名称</span><input value={item.name} onChange={event => patch(item.id, { name: event.target.value })} /></label>
      <label className="creator-field creator-wide"><span>简介 / 描述</span><textarea rows={3} value={item.description ?? ''}
        onChange={event => patch(item.id, { description: event.target.value })} /></label>
      <label className="creator-field creator-wide"><span>完整详情</span><textarea rows={5} value={item.detail ?? ''}
        onChange={event => patch(item.id, { detail: event.target.value })} /></label>
    </div>
    <ItemImagePicker item={item} projectId={projectId} file={imageFiles[item.id]}
      onFileChange={file => onImageFileChange?.(item.id, file)} onRemoveSaved={() => patch(item.id, { image: undefined })} />
    <div className="creator-item-tags"><strong>初始标签</strong><div>{(item.initialTags ?? []).map(tag =>
      <Tag key={tag} closable onClose={event => { event.preventDefault(); onChange(removeEntryTag(content, item.id, tag)); }}>{tag}</Tag>)}</div>
      <div className="creator-item-tags-add"><input aria-label="新标签" value={newTag} placeholder="输入标签" onChange={event => setNewTag(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onChange(addEntryTag(content, item.id, newTag)); setNewTag(''); } }} />
        <button type="button" onClick={() => { onChange(addEntryTag(content, item.id, newTag)); setNewTag(''); }} disabled={!newTag.trim()}>添加标签</button></div>
    </div>
    <p className="creator-form-note">道具变体等高级配置会保留；需要修改时可切换 JSON 模式。</p>
  </>} />;
}
