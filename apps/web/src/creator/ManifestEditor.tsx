import { useEffect, useRef, useState } from 'react';
import { changePeriod, movePeriod, patchManifest, removePeriod } from './section-forms.js';

interface Props {
  content: string;
  onChange: (value: string) => void;
  savedLocations: { id: string; name: string }[];
  projectId?: string;
  coverFile?: File | null;
  onCoverFileChange?: (file: File | null) => void;
}

export default function ManifestEditor({ content, onChange, savedLocations, projectId, coverFile = null, onCoverFileChange }: Props) {
  const manifest = JSON.parse(content) as Record<string, unknown>;
  const periods = Array.isArray(manifest.periods) ? manifest.periods.map(String) : [];
  const selectedLocation = String(manifest.startLocation ?? '');
  const missingLocation = !!selectedLocation && !savedLocations.some(location => location.id === selectedLocation);
  const [periodModal, setPeriodModal] = useState<number | 'new' | null>(null);
  const [periodName, setPeriodName] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [coverError, setCoverError] = useState('');
  const coverInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!coverFile) { setCoverPreview(''); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);
  const savedCover = String(manifest.cover ?? '');
  const savedImage = savedCover.startsWith('/api/covers/') && projectId
    ? `/api/creator/projects/${encodeURIComponent(projectId)}/covers/${savedCover.split('/').at(-1)}` : '';
  const patch = (fields: Record<string, unknown>) => onChange(patchManifest(content, fields));
  const openPeriod = (index: number | 'new') => {
    setPeriodName(index === 'new' ? '' : periods[index]); setPeriodModal(index);
  };
  const savePeriod = () => {
    if (!periodName.trim()) return;
    patch({ periods: periodModal === 'new' ? [...periods, periodName.trim()] : changePeriod(periods, Number(periodModal), periodName) });
    setPeriodModal(null);
  };
  return <div className="creator-special-form">
    <div className="creator-form-grid">
      <label className="creator-field"><span>标题</span><input value={String(manifest.title ?? '')}
        onChange={event => patch({ title: event.target.value })} placeholder="为故事取一个名字" /></label>
      <label className="creator-field"><span>副标题</span><input value={String(manifest.subtitle ?? '')}
        onChange={event => patch({ subtitle: event.target.value })} placeholder="一句话补充故事气质（可选）" /></label>
      <label className="creator-field creator-wide"><span>简介 / 描述</span><textarea rows={4} value={String(manifest.description ?? '')}
        onChange={event => patch({ description: event.target.value })} placeholder="玩家在故事列表中看到的简介" /></label>
      <label className="creator-field creator-wide"><span>世界背景</span><textarea rows={6} value={String(manifest.world ?? '')}
        onChange={event => patch({ world: event.target.value })} placeholder="描述世界、时代与故事所处的环境" /></label>
      <div className="creator-field creator-wide"><span>封面</span><div className="creator-cover-picker">
        {(coverPreview || savedImage) ? <img src={coverPreview || savedImage} alt="封面预览" />
          : <div className="creator-cover-empty">{savedCover || '暂无封面'}</div>}
        <div><strong>{coverFile ? coverFile.name : '故事封面'}</strong><p>支持 PNG、JPEG、WebP，最大 5 MB。选择图片后，点击页面底部「保存」才会上传。</p>
          <button type="button" onClick={() => coverInput.current?.click()}>选择图片</button>
          {(coverFile || savedCover) && <button type="button" className="creator-cover-remove" onClick={() => {
            if (coverFile) onCoverFileChange?.(null);
            else patch({ cover: '' });
          }}>{coverFile ? '取消选择' : '移除封面'}</button>}
          {coverError && <small className="creator-field-warning" role="alert">{coverError}</small>}
        </div>
        <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="选择封面图片"
          onChange={event => { const file = event.target.files?.[0]; if (!file) return;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
              setCoverError('请选择不超过 5 MB 的 PNG、JPEG 或 WebP 图片'); event.target.value = ''; return;
            }
            setCoverError(''); onCoverFileChange?.(file); event.target.value = '';
          }} />
      </div></div>
      <label className="creator-field creator-wide"><span>开局地点</span>
        <select value={selectedLocation} onChange={event => patch({ startLocation: event.target.value })}>
          {missingLocation && <option value={selectedLocation}>无效地点 · {selectedLocation}</option>}
          {!selectedLocation && <option value="">请选择开局地点</option>}
          {savedLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        {missingLocation && <small className="creator-field-warning">当前开局地点已不存在。请先在地点页保存地点，再重新选择。</small>}
        {!savedLocations.length && <small>暂无已保存地点。先到「地点」页新增并保存。</small>}
      </label>
    </div>
    <div className="creator-period-section"><div className="creator-period-heading"><div><strong>时间段</strong><p>点击标签编辑；用箭头调整游戏中的顺序。</p></div><button type="button" onClick={() => openPeriod('new')}>＋ 新增时间段</button></div>
      <div className="creator-period-list">{periods.map((period, index) => <div className="creator-period-tag" key={`${index}-${period}`}>
        <button type="button" className="creator-period-name" onClick={() => openPeriod(index)}>{period}</button>
        <button type="button" aria-label={`上移 ${period}`} disabled={index === 0} onClick={() => patch({ periods: movePeriod(periods, index, -1) })}>←</button>
        <button type="button" aria-label={`下移 ${period}`} disabled={index === periods.length - 1} onClick={() => patch({ periods: movePeriod(periods, index, 1) })}>→</button>
      </div>)}</div>
    </div>
    {periodModal !== null && <div className="creator-modal-backdrop"><div className="creator-modal creator-period-modal" role="dialog" aria-modal="true" aria-labelledby="creator-period-title">
      <div className="creator-kicker">STORY TIME</div><div className="creator-period-modal-head"><h2 id="creator-period-title">{periodModal === 'new' ? '新增时间段' : '编辑时间段'}</h2>
        {periodModal !== 'new' && <button className="creator-danger-link" type="button" disabled={periods.length <= 1}
          title={periods.length <= 1 ? '至少保留一个时间段' : '删除时间段'} onClick={() => {
            patch({ periods: removePeriod(periods, periodModal) }); setPeriodModal(null);
          }}>删除</button>}</div>
      <label>名称<input autoFocus maxLength={30} value={periodName} onChange={event => setPeriodName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') savePeriod(); }} /></label>
      <div className="creator-modal-actions"><button type="button" onClick={() => setPeriodModal(null)}>取消</button>
        <button className="creator-primary" type="button" disabled={!periodName.trim()} onClick={savePeriod}>确定</button></div>
    </div></div>}
  </div>;
}
