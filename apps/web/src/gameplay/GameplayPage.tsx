import { useEffect, useRef, useState } from 'react';
import { ApiError, api, post, postChatStream, type GameDetail, type SessionPayload, type SlotSummary } from '../app/api.js';
import { appendPendingDraft, beginPendingTurn, failPendingTurn, npcLeftCurrentLocation, type PendingTurn } from './chat-stream.js';
import { npcChannelLabel } from './npc-channel.js';
import { useAccount } from '../app/AccountGate.js';
import { playtestClient, type PlaytestLink } from './playtest-client.js';
import { confirmAction, promptAction } from '../app/dialogs.js';

type Pane = 'home' | 'location' | 'chat';
type Drawer = 'bag' | 'npcs' | 'profile' | 'gallery' | 'saves' | 'log' | null;

function initials(name: string) { return name.slice(0, 1) || '?'; }
function displayDate(value: string) { return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
export function gameDeepLink(pathname: string): { gameId: string; continue: boolean } | null {
  const match = pathname.match(/^\/games\/([^/]+)(\/continue)?\/?$/);
  return match ? { gameId: decodeURIComponent(match[1]), continue: !!match[2] } : null;
}

export function GameplayPage({ storyId, playtest, onExit, onNoSave }: { storyId: string; playtest?: PlaytestLink; onExit(): void; onNoSave(message: string): void }) {
  const preview = playtest ? playtestClient(playtest) : null;
  const { account, loading: accountLoading, requestLogin } = useAccount();
  const [pane, setPane] = useState<Pane>('home');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [game, setGame] = useState<GameDetail | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [chatNpc, setChatNpc] = useState<string | null>(null);
  const [selectedNpc, setSelectedNpc] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!account) { if (!accountLoading) requestLogin(() => {}); return; }
    let live = true;
    setLoading(true); setError(''); setUnavailable(false);
    void (async () => {
      let detailLoaded = false;
      try {
        const detail = preview ? (await preview.detail()).detail : await api<GameDetail>(`/games/${encodeURIComponent(storyId)}`);
        detailLoaded = true;
        const current = preview ? await preview.current() : await api<SessionPayload>(`/games/${encodeURIComponent(storyId)}/current`);
        if (live) { setGame(detail); setSession(current); setPane('home'); setDrawer(null); }
      } catch (reason) {
        if (!live) return;
        if (reason instanceof ApiError && reason.status === 404) {
          if (!detailLoaded) { setUnavailable(true); setError(preview ? '试玩记录不可用。' : '故事不可用。'); }
          else if (preview) onNoSave('还没有试玩自动存档，请先开始试玩。');
          else onNoSave('还没有自动存档，请先开始新游戏。');
        } else setError(reason instanceof Error ? reason.message : '游戏暂不可用');
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [storyId, playtest?.playtestId, account?.id, accountLoading, loadAttempt]);
  useEffect(() => { if (pane === 'chat' && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; }, [session?.view.chats, pendingTurn?.npcText, pendingTurn?.status, pane]);

  const guarded = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (reason) { if (mountedRef.current) setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { if (mountedRef.current) setBusy(false); }
  };
  const loadSlots = () => game && guarded(async () => setSlots((await api<{ slots: SlotSummary[] }>(`/games/${game.id}/slots`)).slots));
  const openSaves = () => { void loadSlots(); setDrawer('saves'); };
  const runAction = (body: object, after?: () => void) => game && session && guarded(async () => {
    const data = preview ? await preview.action(body, session.revision)
      : await post<SessionPayload>(`/games/${game.id}/action`, { ...body, revision: session.revision });
    if (!mountedRef.current) return;
    setSession(data);
    const left = pane === 'chat' && chatNpc && npcLeftCurrentLocation(session.view, data.view, chatNpc);
    const npcName = session.view.npcs.find((npc) => npc.id === chatNpc)?.name ?? '对方';
    setNotice([...(data.changes?.map((change) => change.text) ?? (data.actionText ? [data.actionText] : [])),
      ...(left ? [`${npcName}已离开这里`] : [])].join('；'));
    if (left) setPane('location');
    after?.();
  });
  const sendChat = async (text: string, retry?: PendingTurn) => {
    if (!game || !session || !chatNpc || !text.trim() || busy || sendingRef.current) return;
    sendingRef.current = true;
    const npcId = chatNpc;
    const turn = retry ?? beginPendingTurn(crypto.randomUUID(), npcId, text.trim());
    setPendingTurn({ ...turn, status: 'sending', npcText: '', statusText: undefined });
    setDraft(''); setBusy(true); setError('');
    try {
      const data = await (preview ? preview.chat.bind(preview) : (body: object, handlers: Parameters<typeof postChatStream>[2]) => postChatStream(`/games/${game.id}/chat/stream`, body, handlers))(
        { npcId, text: turn.playerText, revision: session.revision, turnId: turn.id },
        { onDraft: (delta) => { if (mountedRef.current) setPendingTurn((current) => current?.id === turn.id ? appendPendingDraft(current, delta) : current); },
          onStatus: (text) => { if (mountedRef.current) setPendingTurn((current) => current?.id === turn.id ? { ...current, statusText: text } : current); } });
      if (!mountedRef.current) return;
      setSession(data);
      setPendingTurn(null);
      const left = npcLeftCurrentLocation(session.view, data.view, npcId);
      const npcName = session.view.npcs.find((npc) => npc.id === npcId)?.name ?? '对方';
      setNotice([...(data.changes?.map((change) => change.text) ?? []), ...(left ? [`${npcName}已离开这里`] : [])].join('；'));
      if (left) window.setTimeout(() => { if (mountedRef.current) setPane((current) => current === 'chat' ? 'location' : current); }, 1400);
    } catch (reason) {
      if (!mountedRef.current) return;
      setPendingTurn((current) => current?.id === turn.id ? failPendingTurn(current) : current);
      setError(reason instanceof Error ? reason.message : '对话失败，请重试');
    } finally { sendingRef.current = false; if (mountedRef.current) setBusy(false); }
  };
  const saveManual = (slot: number) => game && session && guarded(async () => {
    const old = slots.find((item) => item.slot === slot);
    if (old && !await confirmAction(`覆盖“${old.label}”？`, true)) return;
    const label = await promptAction('给这个存档命名', old?.label ?? `手动存档 ${slot}`);
    if (label === null) return;
    await post(`/games/${game.id}/slots/${slot}`, { label });
    setSlots((await api<{ slots: SlotSummary[] }>(`/games/${game.id}/slots`)).slots);
    setNotice('手动存档已保存');
  });
  const loadManual = (slot: number) => game && guarded(async () => {
    const data = await post<SessionPayload>(`/games/${game.id}/slots/${slot}/load`, {});
    setSession(data); setPendingTurn(null); setPane('home'); setDrawer(null); setNotice('已从手动存档继续，自动存档已同步');
  });
  const deleteManual = (slot: number) => game && guarded(async () => {
    if (!await confirmAction('删除这个手动存档？', true)) return;
    await api(`/games/${game.id}/slots/${slot}`, { method: 'DELETE' });
    setSlots((await api<{ slots: SlotSummary[] }>(`/games/${game.id}/slots`)).slots);
  });
  const importSave = (file: File | undefined) => game && file && guarded(async () => {
    const data = JSON.parse(await file.text());
    const loaded = await post<SessionPayload>(`/games/${game.id}/import`, data);
    setSession(loaded); setPendingTurn(null); setPane('home'); setDrawer(null); setNotice('存档已导入');
  });

  const view = session?.view;
  const activeNpc = view?.npcs.find((npc) => npc.id === chatNpc) ?? view?.knownNpcs.find((npc) => npc.id === chatNpc);
  const activeNpcHere = !!view?.npcs.some((npc) => npc.id === chatNpc);
  const detailNpc = view?.knownNpcs.find((npc) => npc.id === selectedNpc);
  const isGame = !!view;
  const saveContent = <div className="save-list">
    {Array.from({ length: 6 }, (_, slot) => {
      const data = slots.find((entry) => entry.slot === slot);
      return <div className={`save-slot ${data ? 'filled' : ''}`} key={slot}>
        <div className="slot-number">{slot === 0 ? 'AUTO' : String(slot).padStart(2, '0')}</div>
        <div className="slot-main"><strong>{data?.label ?? (slot === 0 ? '暂无自动存档' : '空存档')}</strong>
          {data && <span>版本 {data.scriptVersion} · {displayDate(data.updatedAt)} · 第 {data.day} 天 · {data.location}{data.loadable === false ? ' · 剧本快照不可用' : ''}</span>}</div>
        <div className="slot-actions">
          {slot > 0 && session && <button onClick={() => saveManual(slot)} disabled={busy}>{data ? '覆盖' : '保存'}</button>}
          {slot > 0 && data && <button onClick={() => loadManual(slot)} disabled={busy || data.loadable === false}>读取</button>}
          {data && <a href={`/api/games/${game?.id}/slots/${slot}/export`} download>导出</a>}
          {slot > 0 && data && <button className="danger" onClick={() => deleteManual(slot)} disabled={busy}>删除</button>}
        </div>
      </div>;
    })}
    <div className="import-row"><span>已有存档文件？</span><button onClick={() => importRef.current?.click()}>导入 JSON 存档</button>
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => importSave(event.target.files?.[0])} /></div>
  </div>;

  return <div className={`app-shell ${isGame ? 'in-game' : ''}`}>
    {error && <div className="floating-alert error" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
    {notice && <div className="floating-alert notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
    {!session && <main className="menu-screen page-enter">{loading ? <p>正在恢复自动存档…</p> : <><h1>{unavailable ? (playtest ? '试玩记录不可用' : '故事不可用') : '游戏暂不可用'}</h1><button onClick={() => setLoadAttempt(value => value + 1)}>重试</button><button onClick={unavailable && playtest ? () => { window.location.href = `/creator/${encodeURIComponent(playtest.projectId)}`; } : onExit}>{unavailable && playtest ? '返回创作中心' : '返回游戏详情'}</button></>}</main>}
    {isGame && view && <div className={`game-frame ${pane === 'chat' ? 'chat-layout' : ''}`}>
      <header className="game-header"><div className="game-header-left"><button className="header-brand" onClick={() => { setPane('home'); setDrawer(null); }}>ACT II<span>/ {view.script.title}</span></button>
          <div className="status-separator" /><div className="status-block"><small>当前位置</small><strong>{view.location?.name}</strong></div>
          <button className="status-block status-button" onClick={() => runAction({ type: 'wait' })} disabled={busy} title="推进到下一时段"><small>当前时间 · 点击切换</small><strong>第 {view.day} 天 / {view.period} ↻</strong></button></div>
        <nav className="game-actions" aria-label="快捷菜单"><button onClick={() => setDrawer('log')}>游戏日志</button><button onClick={() => setDrawer('bag')}>背包 <span>{view.items.length}</span></button><button onClick={() => setDrawer('npcs')}>人物</button><button onClick={() => setDrawer('profile')}>个人信息</button><button onClick={() => setDrawer('gallery')}>图鉴</button>{!playtest && <button onClick={openSaves}>存档</button>}<button className="exit-button" disabled={busy} onClick={onExit}>退出</button></nav></header>
      <main className={`game-main ${pane === 'chat' ? 'chat-main' : ''}`}>
        {pane === 'home' && <div className="game-content page-enter"><div className="game-overline">STORY <span>／</span> {view.script.title}</div><div className="home-heading"><div><h1>前往何处</h1><p>选择地点，探索并与在场人物交谈。</p></div><div className="day-stamp">DAY <strong>{String(view.day).padStart(2, '0')}</strong></div></div>
          <div className="location-grid">{view.locations.map((location, index) => <button className={`location-card ${location.id === view.locationId ? 'current' : ''}`} key={location.id} disabled={busy || (location.id !== view.locationId && !location.enterable)}
            onClick={() => location.id === view.locationId ? setPane('location') : runAction({ type: 'move', locationId: location.id }, () => setPane('location'))}>
            <div className="location-number">{String(index + 1).padStart(2, '0')} <span>{location.id === view.locationId ? '当前地点' : location.enterable ? '可前往' : '暂不可进入'}</span></div><div className="location-icon">{location.name.slice(0, 1)}</div><h2>{location.name}</h2><p>{location.description}</p><div className="location-arrow">{location.enterable || location.id === view.locationId ? '进入地点' : '暂不可进入'} <span>↗</span></div></button>)}</div>
          <div className="home-bottom"><span>LOCATION INDEX</span><span>已开放 {view.locations.length} 个地点</span></div></div>}

        {pane === 'location' && <div className="game-content page-enter"><button className="inline-back" onClick={() => setPane('home')}>← 所有地点</button><div className="place-header"><div className="eyebrow">LOCATION / {view.locationId.toUpperCase()}</div><h1>{view.location?.name}</h1><p>{view.location?.description}</p></div>
          <div className="place-columns"><section className="place-section"><div className="section-head"><span>在场人物</span><span>{view.npcs.length.toString().padStart(2, '0')}</span></div>
            {view.npcs.length ? view.npcs.map((npc) => <button className="npc-row" key={npc.id} onClick={() => { setChatNpc(npc.id); setPane('chat'); setDraft(''); }}><div className="avatar" style={{ backgroundColor: npc.accent || '#6d7780' }}>{initials(npc.name)}</div><div><strong>{npc.name}</strong><small className="npc-channel-label">{npcChannelLabel(npc.channel)}</small><p>{npc.description}</p></div><span className="row-arrow">开始对话 ↗</span></button>) : <div className="empty-state">此刻没有人在这里。换个时段再来看看。</div>}</section>
            <section className="place-section"><div className="section-head"><span>探索地点</span><button disabled={busy} onClick={() => runAction({ type: 'search' })}>搜索此处 ↗</button></div>
              {view.location?.items.map((item) => <div className="spot-row" key={item.id}><div className="spot-mark">◇</div><div><strong>[{item.name}]</strong><p>{item.description}</p><button className="text-action" onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}>查看详情</button>{expandedItem === item.id && <>{item.image && <img className="item-detail-image" src={item.image} alt={item.name} />}<p>{item.detail}</p></>}</div><button disabled={busy} onClick={() => runAction({ type: 'take', itemId: item.id })}>{item.canTake ? '获取 →' : '尝试获取 →'}</button></div>)}
              <div className="section-head"><span>可以调查</span><span>{view.location?.spots.length ?? 0}</span></div>
              {view.location?.spots.length ? view.location.spots.map((spot) => <button className="spot-row" key={spot.id} disabled={busy || spot.done} onClick={() => runAction({ type: 'explore', spotId: spot.id })}><div className="spot-mark">⌕</div><div><strong>{spot.name}</strong><p>{spot.done ? '已经调查过' : spot.description}</p></div><span>{spot.done ? '已完成' : '调查 →'}</span></button>) : <div className="empty-state">这里暂时没有可调查的事物。</div>}</section></div></div>}

        {pane === 'chat' && activeNpc && <div className="chat-shell page-enter"><div className="chat-top"><button className="inline-back" onClick={() => setPane('location')}>← 返回地点</button><div className="chat-person"><div className="avatar" style={{ backgroundColor: activeNpc.accent || '#6d7780' }}>{initials(activeNpc.name)}</div><div><strong>{activeNpc.name}</strong><small>{npcChannelLabel(activeNpc.channel)} · {view.location?.name} · {view.period}</small></div></div><button className="chat-profile-button" onClick={() => { setSelectedNpc(activeNpc.id); setDrawer('npcs'); }}>查看资料 →</button></div>
          <div className="chat-messages" ref={messagesRef}><div className="chat-intro"><span>对话档案</span><strong>{activeNpc.name}</strong><p>{activeNpc.description}</p></div>
            {(view.chats[activeNpc.id] ?? []).map((message) => <div className={`message-line ${message.role === 'player' ? 'mine' : 'theirs'}`} key={message.id} data-message-id={message.id}>
              {message.role !== 'player' && <div className="mini-avatar" style={{ backgroundColor: activeNpc.accent || '#6d7780' }}>{initials(activeNpc.name)}</div>}
              <div className="message-body"><span>{message.role === 'player' ? String(view.player.name ?? '你') : activeNpc.name} · {displayDate(message.at)}</span><div className="bubble">{message.text}</div></div></div>)}
            {pendingTurn?.npcId === activeNpc.id && <><div className="message-line mine pending-message"><div className="message-body"><span>{String(view.player.name ?? '你')} · {pendingTurn.status === 'failed' ? '发送失败' : '发送中'}</span><div className="bubble">{pendingTurn.playerText}</div>{pendingTurn.status === 'failed' && <button className="text-action" onClick={() => sendChat(pendingTurn.playerText, pendingTurn)}>重新发送 ↗</button>}</div></div>
              {pendingTurn.status === 'sending' && (pendingTurn.npcText ? <div className="message-line theirs pending-message"><div className="mini-avatar" style={{ backgroundColor: activeNpc.accent || '#6d7780' }}>{initials(activeNpc.name)}</div><div className="message-body"><span>{activeNpc.name} · {pendingTurn.statusText ?? '生成中'}</span><div className="bubble">{pendingTurn.npcText}<span className="stream-cursor" /></div></div></div> : <div className="typing-indicator">{activeNpc.name} {pendingTurn.statusText ?? '正在思考…'}</div>)}</>}</div>
          <div className="chat-composer">
            <form onSubmit={(event) => { event.preventDefault(); sendChat(draft); }}><textarea placeholder={`和${activeNpc.name}说点什么…`} value={draft} disabled={busy || !activeNpcHere} maxLength={2000} rows={2}
              onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendChat(draft); } }} />
              <button className="send-button" type="submit" disabled={busy || !activeNpcHere || !draft.trim()}>发送 ↗</button></form>
            <div className="composer-note">{session?.aiMode === 'demo' ? '演示对话模式 · 配置服务器 AI_API_KEY 后启用 AI' : 'AI 角色对话 · 剧情变化由游戏规则确认'} <span>Enter 发送 · Shift + Enter 换行</span></div></div></div>}
      </main>
      <footer className="game-footer"><span>ACT II / {view.script.title} · {view.script.version}</span><span>自动存档已开启</span></footer>
    </div>}

    {drawer && isGame && view && <div className="drawer-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawer(null); }}><aside className="drawer" role="dialog" aria-modal="true" aria-label={drawer}>
      <div className="drawer-head"><div><small>ACT II</small><h2>{{ bag: '背包', npcs: '人物档案', profile: '个人信息', gallery: '结局与成就', saves: '存档', log: '游戏日志' }[drawer]}</h2></div><button onClick={() => setDrawer(null)} aria-label="关闭">×</button></div>
      <div className="drawer-body">
        {drawer === 'log' && <><p className="drawer-lead">这里记录你实际做过的事，以及已经发生的变化。读取旧存档会回到那条时间线。</p>
          {view.activityLog.length ? [...view.activityLog].reverse().map((entry) => <details className="activity-entry" key={entry.id}><summary><span className="activity-time">第 {entry.day} 天 · {entry.period}</span><strong>{entry.summary}</strong></summary>
            <div className="activity-detail">{entry.details.length ? entry.details.map((detail, index) => <p key={`${detail.kind}-${index}`}>{detail.text}</p>) : <p>没有发生其他变化。</p>}
              {entry.npcId && entry.chatMessageId && <button className="text-action" onClick={() => { setChatNpc(entry.npcId!); setPane('chat'); setDrawer(null);
                window.setTimeout(() => { const container = messagesRef.current; const target = container?.querySelector(`[data-message-id="${entry.chatMessageId}"]`) as HTMLElement | null;
                  if (container && target) container.scrollTop = target.offsetTop - container.offsetTop - 20; }, 50); }}>查看原对话 ↗</button>}</div></details>) : <div className="empty-state">还没有游戏记录。开始对话或探索后，这里会留下时间线。</div>}</>}
        {drawer === 'bag' && <><p className="drawer-lead">旅途中得到的物品。它们也许会改变某段对话。</p>{view.items.length ? view.items.map((item) => <div className="inventory-item" key={item.id}><div className="item-glyph">{item.image ? <img src={item.image} alt="" /> : initials(item.name)}</div><div><strong>{item.name}</strong><p>{item.description}</p><button className="text-action" onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}>查看详情</button>{expandedItem === item.id && <>{item.image && <img className="item-detail-image" src={item.image} alt={item.name} />}<p>{item.detail}</p></>}</div></div>) : <div className="empty-state">背包里还没有物品。试着调查地点，或与人物交谈。</div>}</>}
        {drawer === 'npcs' && <><p className="drawer-lead">你已经认识的人。资料会随着故事逐步出现。</p><div className="npc-directory">{view.knownNpcs.map((npc) => <button className={selectedNpc === npc.id ? 'active' : ''} key={npc.id} onClick={() => setSelectedNpc(npc.id)}>{npc.name}</button>)}</div>
          {detailNpc ? <div className="npc-detail"><div className="detail-avatar" style={{ backgroundColor: detailNpc.accent || '#6d7780' }}>{initials(detailNpc.name)}</div><h3>{detailNpc.name}</h3><p>{detailNpc.description}</p>
            {detailNpc.profile.map((field) => <div className="detail-line" key={field.label}><span>{field.label}</span><strong>{field.value}</strong></div>)}
            {detailNpc.stats.map((stat) => <div className="detail-line" key={stat.id}><span>{stat.name}</span><strong>{stat.value}</strong></div>)}
            <h4>已知持有物</h4>{detailNpc.items.length ? detailNpc.items.map((item) => <div className="inventory-item" key={item.id}><div><strong>{item.name}</strong><p>{item.description}</p><button className="text-action" onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}>查看详情</button>{expandedItem === item.id && <p>{item.detail}</p>}</div></div>) : <p className="muted">尚未发现</p>}</div> : <div className="empty-state">选择一个人物查看资料。</div>}</>}
        {drawer === 'profile' && <><p className="drawer-lead">故事开始时写下的资料，当前无法修改。</p>{game?.playerFields.map((field) => <div className="detail-line" key={field.id}><span>{field.label}</span><strong>{Array.isArray(view.player[field.id]) ? (view.player[field.id] as string[]).map((value) => field.options?.find((option) => option.value === value)?.label ?? value).join('、') : field.options?.find((option) => option.value === view.player[field.id])?.label ?? view.player[field.id]}</strong></div>)}</>}
        {drawer === 'gallery' && <><p className="drawer-lead">这些记录独立于存档。读回旧档也不会抹去已经获得的结局与成就。</p><h3 className="drawer-section-title">结局</h3>{session?.gallery.filter((entry) => entry.kind === 'ending').map((entry) => <div className={`gallery-entry ${entry.unlocked ? 'unlocked' : ''}`} key={entry.id}><span>{entry.unlocked ? '已获得' : '未解锁'}</span><strong>{entry.name}</strong><p>{entry.description}</p></div>)}<h3 className="drawer-section-title">成就</h3>{session?.gallery.filter((entry) => entry.kind === 'achievement').map((entry) => <div className={`gallery-entry ${entry.unlocked ? 'unlocked' : ''}`} key={entry.id}><span>{entry.unlocked ? '已获得' : '未解锁'}</span><strong>{entry.name}</strong><p>{entry.description}</p></div>)}</>}
        {drawer === 'saves' && <><p className="drawer-lead">当前进度会自动保存。你也可以留下最多五个手动存档。</p>{saveContent}</>}
      </div>
    </aside></div>}
  </div>;
}
