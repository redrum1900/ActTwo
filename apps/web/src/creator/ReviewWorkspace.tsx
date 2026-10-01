import { useEffect, useState } from 'react';
import { creatorApi, type ReviewDetail, type ReviewSummary } from './client.js';

const errorText = (error: unknown) => error instanceof Error ? error.message : '审核操作失败';

export function ReviewDecision({ reason, onReasonChange, onApprove, onReject, busy }: {
  reason: string; onReasonChange: (value: string) => void; onApprove: () => void; onReject: () => void; busy: boolean;
}) {
  return <div className="creator-review-decision"><div><strong>审核决定</strong><p>批准后，这份提交快照会成为玩家可见的正式版本。</p></div>
    <button className="creator-primary" type="button" disabled={busy} onClick={onApprove}>批准上架 ↗</button>
    <label>驳回原因<textarea value={reason} onChange={event => onReasonChange(event.target.value)}
      placeholder="请说明需要作者修改的内容" maxLength={1000} rows={3} /></label>
    <button className="creator-review-reject" type="button" disabled={busy || !reason.trim()} onClick={onReject}>驳回并通知作者</button>
  </div>;
}

export default function ReviewWorkspace() {
  const [queue, setQueue] = useState<ReviewSummary[]>([]);
  const [selected, setSelected] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => { const result = await creatorApi.reviews(); setQueue(result.reviews); };
  useEffect(() => { void refresh().catch(problem => setError(errorText(problem))).finally(() => setLoading(false)); }, []);
  const open = async (id: string) => { setError(''); setReason('');
    try { setSelected(await creatorApi.review(id)); } catch (problem) { setError(errorText(problem)); } };
  const decide = async (action: 'approve' | 'reject') => {
    if (!selected || busy || (action === 'reject' && !reason.trim())) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'approve') await creatorApi.approve(selected.id);
      else await creatorApi.reject(selected.id, reason.trim());
      setMessage(action === 'approve' ? '审核通过，故事已更新到玩家目录。' : '已驳回，作者可查看原因并重新提交。');
      setSelected(null); setReason(''); await refresh();
    } catch (problem) { setError(errorText(problem)); }
    finally { setBusy(false); }
  };
  return <main className="creator-review-workspace"><div className="creator-kicker">MODERATION / REVIEW QUEUE</div>
    <div className="creator-review-header"><div><h1>发布审核</h1><p>审核作者提交时冻结的故事版本；草稿后续修改不会影响这里的内容。</p></div>
      <span>{queue.length} 件待审</span></div>
    {message && <div className="creator-success" role="status">{message}</div>}
    {error && <div className="creator-error" role="alert">{error}</div>}
    <div className="creator-review-layout"><div className="creator-review-list">
      {loading ? <div className="creator-review-empty">正在读取待审故事…</div>
        : queue.length === 0 ? <div className="creator-review-empty">目前没有待审故事。</div>
          : queue.map((entry, index) => <button key={entry.id} className={`creator-review-row ${selected?.id === entry.id ? 'active' : ''}`}
            onClick={() => void open(entry.id)}><span className="creator-review-index">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{entry.projectTitle}</strong><small>{entry.authorUsername} · 版本 {entry.version}</small>
              <small>提交于 {new Date(entry.submittedAt).toLocaleString('zh-CN')}</small></span><span>查看 ↗</span></button>)}
    </div><section className="creator-review-detail">{selected ? <>
      <div className="creator-kicker">SUBMITTED SNAPSHOT / {selected.projectId}</div><h2>{selected.projectTitle}</h2>
      <div className="creator-review-meta"><span>作者：{selected.authorUsername}</span><span>版本：{selected.version}</span>
        <span>提交：{new Date(selected.submittedAt).toLocaleString('zh-CN')}</span></div>
      <p className="creator-review-desc">{String(selected.script.description ?? '暂无简介')}</p>
      <details className="creator-review-json"><summary>查看提交版本的完整配置 JSON</summary><pre>{JSON.stringify(selected.script, null, 2)}</pre></details>
      <ReviewDecision reason={reason} onReasonChange={setReason} onApprove={() => void decide('approve')}
        onReject={() => void decide('reject')} busy={busy} />
    </> : <div className="creator-review-placeholder"><span>审</span><h2>选择一份故事</h2><p>左侧待审列表中的每一项都是提交时冻结的版本。</p></div>}</section></div>
  </main>;
}
