import { useEffect, useState } from 'react';
import { creatorApi, type PlaytestSummary } from './client.js';
import { confirmAction } from '../dialogs.js';

export async function startPlaytestInNewTab(projectId: string, actions: {
  openBlank: () => { location: { href: string }; close: () => void } | null;
  create: () => Promise<{ id: string }>;
  refresh: () => Promise<void>;
}) {
  const tab = actions.openBlank();
  if (!tab) throw new Error('浏览器阻止了新标签页，请允许弹出窗口后重试。');
  let created = false;
  try {
    const run = await actions.create();
    created = true;
    tab.location.href = `/playtest/${encodeURIComponent(projectId)}/${encodeURIComponent(run.id)}`;
    await actions.refresh();
  } catch (error) {
    if (!created) tab.close();
    throw error;
  }
}

export default function PlaytestDrawer({ projectId, onClose, unsaved, records }: {
  projectId: string; onClose: () => void; unsaved: boolean; records?: PlaytestSummary[] }) {
  const [items, setItems] = useState<PlaytestSummary[]>(records ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => setItems((await creatorApi.listPlaytests(projectId)).playtests);
  useEffect(() => { if (!records) void refresh().catch(reason => setError(reason.message)); }, [projectId]);
  const open = (id: string) => window.open(`/playtest/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`, '_blank', 'noopener');
  const start = async () => {
    if (unsaved) { setError('请先保存当前草稿，再开始试玩。'); return; }
    setBusy(true); setError('');
    try { await startPlaytestInNewTab(projectId, {
      openBlank: () => { const tab = window.open('about:blank', '_blank'); if (tab) tab.opener = null; return tab; },
      create: () => creatorApi.createPlaytest(projectId), refresh,
    }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法创建试玩'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!await confirmAction('删除这条试玩记录和它的自动存档？此操作不可恢复。', true)) return;
    setBusy(true); setError('');
    try { await creatorApi.deletePlaytest(projectId, id); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败'); }
    finally { setBusy(false); }
  };
  return <div className="creator-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="creator-playtest-drawer" role="dialog" aria-modal="true" aria-label="试玩记录">
      <header><div><div className="creator-kicker">DRAFT PLAYTEST</div><h2>试玩记录</h2></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <button className="creator-primary" disabled={busy || unsaved} onClick={() => void start()}>＋ 开始新的试玩</button>
      <p>每次开始都会冻结当前已保存草稿，生成独立试玩 ID 与自动存档。最多保留 10 条，新增时自动移除最旧记录。</p>
      {unsaved && <p role="alert">当前有未保存的修改，请先保存后再试玩。</p>}
      {error && <p className="creator-error" role="alert">{error}</p>}
      <ol>{[...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(item =>
        <li key={item.id}><div><strong>{item.started ? '继续试玩' : '未开始'}</strong><small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
          <code>{item.id}</code></div><div><button onClick={() => open(item.id)}>打开 ↗</button>
          <button disabled={busy} onClick={() => void remove(item.id)}>删除</button></div></li>)}</ol>
      {!items.length && <p>还没有试玩记录。</p>}
    </aside></div>;
}
