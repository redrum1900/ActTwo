import { useEffect, useState } from 'react';
import { api, type CatalogGame } from '../app/api.js';
import { useAccount } from '../app/AccountGate.js';
import CoverArtwork from '../shared/cover-artwork.js';

export default function StoryCatalogPage({ onOpen }: { onOpen(id: string): void }) {
  const { account, requestLogin, logout } = useAccount();
  const [catalog, setCatalog] = useState<CatalogGame[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api<{ games: CatalogGame[] }>('/catalog').then(data => { if (active) setCatalog(data.games); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '故事目录暂不可用'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account?.id, attempt]);
  return <main className="catalog-screen page-enter">
    <header className="site-header"><div className="brand-mark">ACT <span>II</span><small>下一幕 / INTERACTIVE STORIES</small></div><div className="catalog-header-actions"><span className="header-note">一套系统，无数段人生</span><a href="/creator">创作中心 ↗</a>
      {account ? <><a href="/usage">我的 AI 用量</a><span>{account.username}</span><button onClick={() => void logout()}>退出</button></>
        : <button onClick={() => requestLogin(() => {})}>登录／注册</button>}</div></header>
    <section className="catalog-hero"><div className="eyebrow">THE STORY LIBRARY / 故事目录</div><h1>走进故事，<br /><em>留下你的版本。</em></h1><p>在不同的世界中认识角色，与他们对话。每个选择和发现，都会写入属于你的档案。</p></section>
    <div className="section-head"><span>可进入的故事</span><span>{catalog.length.toString().padStart(2, '0')} 部</span></div>
    {loading && <p className="muted">正在加载故事…</p>}
    {error && <div role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
    <div className="catalog-grid">{catalog.map((entry, index) => <button className="game-card" key={entry.id} onClick={() => onOpen(entry.id)}>
      <div className="game-card-art"><span className="cover-index">STORY / {String(index + 1).padStart(2, '0')}</span><div className="cover-symbol"><CoverArtwork cover={entry.cover} fallback={entry.title.slice(0, 1) || '?'} /></div></div>
      <div className="game-card-info"><div className="card-topline"><div className="card-story-meta"><span>互动叙事 · AI 角色对话</span><span className="card-version">版本 {entry.version}</span></div><span>{entry.hasAuto ? '可继续' : '未开始'}</span></div><h2>{entry.title}</h2><p>{entry.subtitle}</p><div className="card-foot">进入故事 <span>↗</span></div></div>
    </button>)}</div>
    <footer className="site-footer">ACT II © 2026 <span>每一段对话，都可能改变故事。</span></footer>
  </main>;
}
