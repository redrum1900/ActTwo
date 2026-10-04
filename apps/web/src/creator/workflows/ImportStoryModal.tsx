import { useEffect, useState } from 'react';
import { Modal } from 'antd';
import { creatorApi, type ImportJob, type Project } from '../api/client.js';
import { labelOf } from '../model/sections.js';
import { confirmAction } from '../../app/dialogs.js';

const permitted = '.txt,.md,.doc,.docx,.json';
const storageKey = (id: string) => `game-dd-import:${id}`;
const progressName: Record<string, string> = {
  reading: '读取素材', generating: '生成草稿配置', ready: '等待作者确认',
  failed: '导入失败', cancelled: '已取消', applied: '已写入草稿',
};

interface Props { projectId: string; onClose: () => void; onApplied: (project: Project) => void }

export function ImportStorySource({ file, source, onFile, onSource }: {
  file: File | null; source: string; onFile: (file: File | null) => void; onSource: (value: string) => void;
}) {
  return <div className="creator-import-source"><p>素材会发送给你配置的导入模型处理；生成结果会先供你检查，确认后才替换这个故事的草稿。</p>
    <label>选择文件<input type="file" accept={permitted} onChange={event => onFile(event.target.files?.[0] ?? null)} /></label>
    <div className="creator-import-or">或粘贴文本</div>
    <label>粘贴文本<textarea value={source} onChange={event => onSource(event.target.value)}
      placeholder="粘贴小说正文、角色卡或故事梗概" disabled={!!file} /></label>
    {file && <button className="creator-text-button" type="button" onClick={() => onFile(null)}>移除所选文件：{file.name}</button>}
    <small>支持 TXT、MD、DOC、DOCX、JSON；完整素材仅发送一次模型请求。超出模型上下文时会失败，不会覆盖草稿。</small></div>;
}

export default function ImportStoryModal({ projectId, onClose, onApplied }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState('manifest.json');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setJobId(window.localStorage.getItem(storageKey(projectId))); }, [projectId]);
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const poll = async () => {
      try {
        const next = await creatorApi.importJob(projectId, jobId);
        if (!alive) return;
        setJob(next);
        if (next.status === 'cancelled' || next.status === 'applied') window.localStorage.removeItem(storageKey(projectId));
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : '查询导入进度失败'); }
    };
    void poll();
    const timer = window.setInterval(() => { if (!job || job.status === 'running') void poll(); }, 2500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [projectId, jobId, job?.status]);

  const start = async () => {
    if (!file && !source.trim()) { setError('请选择文件或粘贴文本'); return; }
    setBusy(true); setError('');
    try {
      const upload = file ?? new Blob([source], { type: 'text/plain;charset=utf-8' });
      const result = await creatorApi.uploadImport(projectId, upload, file?.name ?? 'pasted.txt');
      if (result.projectId !== projectId) throw new Error('导入任务返回了不同的故事 ID');
      window.localStorage.setItem(storageKey(projectId), result.jobId);
      setJobId(result.jobId); setJob(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!jobId) { onClose(); return; }
    setBusy(true); setError('');
    try {
      await creatorApi.cancelImport(projectId, jobId);
      window.localStorage.removeItem(storageKey(projectId));
      setJobId(null); setJob(null); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '取消失败'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!jobId || job?.status !== 'ready') return;
    if (!await confirmAction('确认用生成结果替换当前故事的全部草稿配置？已发布版本与旧存档不会改变。', true)) return;
    setBusy(true); setError('');
    try {
      const result = await creatorApi.applyImport(projectId, jobId);
      if (result.projectId !== projectId) throw new Error('写入结果的故事 ID 不一致');
      window.localStorage.removeItem(storageKey(projectId));
      onApplied(result.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '写入失败'); }
    finally { setBusy(false); }
  };
  const paths = Object.keys(job?.parts ?? {});
  return <Modal className="creator-form-dialog creator-import-dialog" title="导入小说或角色卡" open width={1080}
    onCancel={onClose} footer={null} destroyOnHidden><section className="creator-modal creator-import-modal">
      <div className="creator-import-heading"><div className="creator-kicker">STORY / {projectId}</div></div>
      {!jobId && <ImportStorySource file={file} source={source}
        onFile={next => { setFile(next); setError(''); }} onSource={setSource} />}
      {jobId && <div className="creator-import-progress" role="status"><strong>{progressName[job?.progress ?? 'reading'] ?? '处理中'}</strong>
        <span>{job?.status === 'running' || !job ? '可以关闭窗口，稍后回来继续查看。' : job.status === 'ready' ? '请先检查推断、结构问题和配置，再决定是否写入。' : job.error}</span></div>}
      {job?.status === 'ready' && <div className="creator-import-result">
        <div className="creator-import-summary"><h3>故事概要</h3><strong>{(() => { try { return JSON.parse(job.parts?.['manifest.json'] ?? '{}').title ?? '未命名故事'; } catch { return '未命名故事'; } })()}</strong>
          <p>{(() => { try { return JSON.parse(job.parts?.['manifest.json'] ?? '{}').description ?? ''; } catch { return ''; } })()}</p>
          <small>这是可编辑草稿；可能仍有结构问题或剧情矛盾，需作者自行核对。只有完整校验通过后才能试玩或提交。</small></div>
        <div className="creator-import-review"><section><h3>AI 补足的设定</h3>{job.report?.inferences.length
          ? <ul>{job.report.inferences.map((entry, index) => <li key={index}>{entry}</li>)}</ul> : <p>未报告额外推断。</p>}</section>
          <section><h3>本地结构问题</h3>{job.report?.issues?.length
            ? <ul>{job.report.issues.map((entry, index) => <li key={index}><strong>{entry.path}</strong><span>{entry.message}</span></li>)}</ul>
            : <p>未发现结构问题；剧情矛盾仍请作者自行核对。</p>}</section></div>
        <div className="creator-import-preview"><h3>配置预览</h3><div className="creator-import-preview-layout"><nav aria-label="生成的配置项">
          {paths.map(path => <button type="button" key={path} className={path === selectedPath ? 'active' : ''}
            onClick={() => setSelectedPath(path)}>{labelOf(path).name}</button>)}</nav>
          <pre>{job.parts?.[selectedPath] ?? ''}</pre></div></div></div>}
      {error && <p className="creator-error" role="alert">{error}</p>}
      <div className="creator-modal-actions"><button type="button" onClick={onClose}>稍后处理</button>
        {jobId && job?.status !== 'applied' && <button type="button" onClick={() => void cancel()} disabled={busy}>取消任务</button>}
        {!jobId ? <button type="button" className="creator-primary" onClick={() => void start()} disabled={busy}>开始生成</button>
          : job?.status === 'ready' ? <button type="button" className="creator-primary" onClick={() => void apply()} disabled={busy}>确认写入草稿</button> : null}</div>
    </section></Modal>;
}
