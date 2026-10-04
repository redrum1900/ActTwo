import { useEffect, useRef, useState } from 'react';
import { ApiError, api, post, type GameDetail, type SlotSummary } from '../app/api.js';
import { useAccount } from '../app/AccountGate.js';
import CoverArtwork from '../shared/cover-artwork.js';
import { confirmAction } from '../app/dialogs.js';
import PlayerForm from './PlayerForm.js';
import { playtestClient, type PlaytestLink } from '../gameplay/playtest-client.js';

type Step = 'overview' | 'new' | 'saves';
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });

export default function StoryDetailPage({ storyId, playtest, onPlay, onBack }: { storyId: string; playtest?: PlaytestLink; onPlay(): void; onBack(): void }) {
  const { account, requestLogin } = useAccount();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [step, setStep] = useState<Step>('overview');
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const preview = playtest ? playtestClient(playtest) : null;
  useEffect(() => {
    let live = true;
    setError(''); setUnavailable(false);
    void (preview ? preview.detail().then(data => data.detail) : api<GameDetail>(`/games/${encodeURIComponent(storyId)}`))
      .then(data => { if (live) setGame(data); })
      .catch(reason => { if (live) { if (reason instanceof ApiError && reason.status === 404) setUnavailable(true);
        else setError(reason instanceof Error ? reason.message : '故事暂不可用'); } });
    return () => { live = false; };
  }, [storyId, playtest?.playtestId, account?.id, attempt]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (reason) { if (mountedRef.current) setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { if (mountedRef.current) setBusy(false); }
  };
  const start = (player: Record<string, string | string[]>) => void run(async () => {
    if (!game) return;
    const latest = preview ? (await preview.detail()).detail : await api<GameDetail>(`/games/${encodeURIComponent(storyId)}`);
    if (!mountedRef.current) return;
    setGame(latest);
    if (latest.hasAuto && !await confirmAction('新游戏将覆盖当前自动存档。手动存档会保留。确定继续吗？', true)) return;
    if (!mountedRef.current) return;
    if (preview) await preview.start(player); else await post(`/games/${encodeURIComponent(storyId)}/new`, { player });
    if (mountedRef.current) onPlay();
  });
  const begin = () => requestLogin(() => { if (!mountedRef.current) return;
    if (game?.playerFields.length) setStep('new'); else start({}); });
  const resume = () => requestLogin(() => { if (!mountedRef.current) return; void run(async () => {
    if (preview) await preview.current(); else await api(`/games/${encodeURIComponent(storyId)}/current`);
    if (mountedRef.current) onPlay();
  }); });
  const openSaves = () => requestLogin(() => { if (!mountedRef.current) return; void run(async () => {
    const next = (await api<{ slots: SlotSummary[] }>(`/games/${encodeURIComponent(storyId)}/slots`)).slots;
    if (mountedRef.current) { setSlots(next); setStep('saves'); }
  }); });
  const load = (slot: number) => void run(async () => {
    await post(`/games/${encodeURIComponent(storyId)}/slots/${slot}/load`, {});
    if (mountedRef.current) onPlay();
  });
  const remove = (slot: number) => void run(async () => {
    if (!await confirmAction('删除这个手动存档？', true)) return;
    if (!mountedRef.current) return;
    await api(`/games/${encodeURIComponent(storyId)}/slots/${slot}`, { method: 'DELETE' });
    const next = (await api<{ slots: SlotSummary[] }>(`/games/${encodeURIComponent(storyId)}/slots`)).slots;
    if (mountedRef.current) setSlots(next);
  });
  const importSave = (file?: File) => file && void run(async () => {
    const content = JSON.parse(await file.text());
    if (!mountedRef.current) return;
    await post(`/games/${encodeURIComponent(storyId)}/import`, content);
    if (mountedRef.current) onPlay();
  });
  if (unavailable) return <main className="menu-screen page-enter"><header className="subpage-header"><button className="back-link" onClick={onBack}>← {playtest ? '返回创作中心' : '返回故事目录'}</button></header><h1>{playtest ? '试玩记录不可用' : '故事不可用'}</h1><p>这条记录可能已被删除，或故事尚未发布。</p><button className="button button-outline" onClick={onBack}>{playtest ? '返回创作中心' : '返回故事目录'}</button></main>;
  if (!game) return <main className="menu-screen page-enter"><p>{error || '正在加载故事…'}</p>{error && <button onClick={() => setAttempt(value => value + 1)}>重试</button>}</main>;
  return <>
    {error && <div className="floating-alert error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {step === 'overview' && <main className="menu-screen page-enter"><header className="subpage-header"><button className="back-link" onClick={onBack}>← {playtest ? '返回创作中心' : '返回故事目录'}</button></header>
      <div className="menu-layout"><div className="menu-art"><div className="menu-art-top">ACT II <span>{game.version}</span></div><div className="menu-art-character"><CoverArtwork cover={game.cover} fallback={game.title.slice(0, 1)} /></div><div className="menu-art-bottom">{game.title}<span>{game.subtitle}</span></div></div>
        <div className="menu-copy"><div className="eyebrow">{playtest ? '试玩草稿版本' : '最新发布版本'} {game.version}</div><h1>{game.title}</h1><p className="menu-subtitle">{game.subtitle}</p><div className="menu-rule" /><p className="menu-description">{game.description}</p><div className="menu-actions">
          {game.hasAuto && <button className="button button-primary" disabled={busy} onClick={resume}>{playtest ? '继续试玩' : '继续游戏'} <span>↗</span></button>}
          {(!playtest || !game.hasAuto) && <button className="button button-outline" disabled={busy} onClick={begin}>{playtest ? '开始试玩' : '新游戏'} <span>＋</span></button>}
          {!playtest && <button className="button button-text" disabled={busy} onClick={openSaves}>存档 <span>→</span></button>}</div>
          {account && !game.hasAuto && <p className="menu-tip">还没有自动存档。创建新游戏后即可使用“继续”。</p>}</div></div></main>}
    {step === 'new' && <main className="form-screen page-enter"><header className="subpage-header"><button className="back-link" onClick={() => setStep('overview')}>← 返回游戏首页</button></header><div className="form-layout"><div className="form-intro"><div className="eyebrow">NEW STORY / 角色档案</div><h1>你将以怎样的身份，<br />走进这个故事？</h1><p>这些信息会成为故事的一部分。部分资料由剧本预设，开始后无法更改。</p><div className="form-ornament">01 <span>／</span> PERSONA</div></div><div className="form-panel"><div className="panel-heading"><span>人物登记表</span><span>PLAYER FILE</span></div><PlayerForm fields={game.playerFields} onSubmit={start} busy={busy} /></div></div></main>}
    {step === 'saves' && <main className="saves-screen page-enter"><header className="subpage-header"><button className="back-link" onClick={() => setStep('overview')}>← 返回游戏首页</button></header><div className="eyebrow">GAME RECORD / 存档</div><h1>旅途的切片</h1><p className="muted">自动存档始终位于第一位。读取手动档后，它会立刻成为当前自动档。</p><div className="save-list">
      {Array.from({ length: 6 }, (_, slot) => { const data = slots.find(entry => entry.slot === slot); return <div className={`save-slot ${data ? 'filled' : ''}`} key={slot}><div className="slot-number">{slot === 0 ? 'AUTO' : String(slot).padStart(2, '0')}</div><div className="slot-main"><strong>{data?.label ?? (slot === 0 ? '暂无自动存档' : '空存档')}</strong>{data && <span>版本 {data.scriptVersion} · {date(data.updatedAt)} · 第 {data.day} 天 · {data.location}{data.loadable === false ? ' · 剧本快照不可用' : ''}</span>}</div><div className="slot-actions">{slot > 0 && data && <button onClick={() => load(slot)} disabled={busy || data.loadable === false}>读取</button>}{data && <a href={`/api/games/${encodeURIComponent(storyId)}/slots/${slot}/export`} download>导出</a>}{slot > 0 && data && <button className="danger" onClick={() => remove(slot)} disabled={busy}>删除</button>}</div></div>; })}
      <div className="import-row"><span>已有存档文件？</span><button onClick={() => importRef.current?.click()}>导入 JSON 存档</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={event => importSave(event.target.files?.[0])} /></div></div></main>}
  </>;
}
