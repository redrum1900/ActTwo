import { useEffect, useRef, useState } from 'react';
import { creatorApi, type Account, type Project, type ProjectSummary, type Report } from './client.js';
import { groupedSections, labelOf } from './sections.js';
import SectionEditor from './SectionEditor.js';
import ReviewWorkspace from './ReviewWorkspace.js';
import { homeForRole, reviewStatusLabel } from './review-ui.js';
import './creator.css';

function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请稍后重试'; }

export default function CreatorApp() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [path, setPath] = useState('manifest.json');
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'conflict' | 'error'>('saved');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const draftRef = useRef(draft);
  const projectRef = useRef(project);
  const pathRef = useRef(path);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const savedContent = useRef('');
  const revision = useRef(1);

  const refreshList = async () => { const data = await creatorApi.list(); setProjects(data.projects); };
  useEffect(() => { void creatorApi.me().then(async user => { setAccount(user); if (user.role === 'admin') window.history.replaceState({}, '', '/creator/review');
    else await refreshList(); })
    .catch(() => {}).finally(() => setLoading(false)); }, []);

  const openProject = (next: Project) => {
    setProject(next); projectRef.current = next;
    const first = next.sections['manifest.json'] ? 'manifest.json' : Object.keys(next.sections)[0];
    setPath(first); pathRef.current = first;
    savedContent.current = next.sections[first]?.content ?? '';
    revision.current = next.sections[first]?.revision ?? 1;
    draftRef.current = savedContent.current; setDraft(savedContent.current);
    setSaveState('saved'); setReport(null); setMessage('');
    window.history.replaceState({}, '', `/creator/${encodeURIComponent(next.id)}`);
  };
  useEffect(() => {
    if (!account || account.role === 'admin' || project) return;
    const id = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
    if (id) void creatorApi.get(id).then(openProject).catch(error => setMessage(errorText(error)));
  }, [account]);

  const updateDraft = (value: string) => { draftRef.current = value; setDraft(value); setSaveState('dirty'); setReport(null); };
  const save = async (): Promise<boolean> => {
    if (savePromise.current) { const previous = await savePromise.current; if (!previous) return false; }
    const active = projectRef.current;
    if (!active || draftRef.current === savedContent.current) { setSaveState('saved'); return true; }
    const savingPath = pathRef.current;
    const content = draftRef.current;
    const task = (async () => {
      setSaveState('saving');
      try {
        const section = await creatorApi.save(active.id, savingPath, content, revision.current);
        revision.current = section.revision;
        savedContent.current = section.content;
        const next = { ...projectRef.current!, sections: { ...projectRef.current!.sections, [savingPath]: section } };
        projectRef.current = next; setProject(next);
        setSaveState(draftRef.current === content ? 'saved' : 'dirty');
        return true;
      } catch (error) {
        setSaveState(errorText(error).includes('冲突') ? 'conflict' : 'error');
        setMessage(errorText(error));
        return false;
      }
    })();
    savePromise.current = task;
    try { return await task; } finally { if (savePromise.current === task) savePromise.current = null; }
  };
  useEffect(() => {
    if (!project || draft === savedContent.current || saveState === 'conflict' || saveState === 'error') return;
    const timer = window.setTimeout(() => { void save(); }, 750);
    return () => window.clearTimeout(timer);
  }, [draft, project?.id, path, saveState]);
  const switchPath = async (nextPath: string) => {
    if (nextPath === path || !(await save())) return;
    const section = projectRef.current?.sections[nextPath];
    if (!section) return;
    setPath(nextPath); pathRef.current = nextPath;
    savedContent.current = section.content; revision.current = section.revision;
    draftRef.current = section.content; setDraft(section.content);
    setSaveState('saved'); setMessage('');
  };
  const runAfterSave = async (action: () => Promise<void>) => { if (await save()) try { setMessage(''); await action(); }
    catch (error) { setMessage(errorText(error)); } };
  const leaveProject = () => void runAfterSave(async () => {
    setProject(null); projectRef.current = null; setReport(null);
    window.history.replaceState({}, '', '/creator'); await refreshList();
  });
  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('');
    try { const user = authMode === 'login' ? await creatorApi.login(username, password) : await creatorApi.register(username, password);
      setAccount(user); setPassword(''); if (user.role === 'admin') window.history.replaceState({}, '', '/creator/review');
      else await refreshList(); }
    catch (error) { setMessage(errorText(error)); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('');
    try { const next = await creatorApi.create(newId.trim(), newTitle.trim(), templateId || undefined);
      openProject(next); setShowCreate(false); setNewId(''); setNewTitle(''); }
    catch (error) { setMessage(errorText(error)); }
  };
  const addNpc = () => void runAfterSave(async () => {
    const id = prompt('NPC ID（英文小写、数字、短横线）'); if (!id) return;
    const name = prompt('NPC 名称'); if (!name) return;
    const next = await creatorApi.addNpc(project!.id, id.trim(), name.trim());
    setProject(next); projectRef.current = next;
    await switchPath(`npcs/${id.trim()}/base.json`);
  });
  const removeNpc = (id: string) => void runAfterSave(async () => {
    if (!confirm(`确定移除 NPC「${id}」及其全部配置？此操作不能撤销。`)) return;
    const next = await creatorApi.removeNpc(project!.id, id);
    openProject(next);
  });
  const validate = () => void runAfterSave(async () => { setReport(await creatorApi.validate(project!.id)); });
  const submit = () => void runAfterSave(async () => {
    const check = await creatorApi.validate(project!.id); setReport(check);
    if (check.errors.length) { setMessage('校验未通过，不能提交审核。'); return; }
    await creatorApi.submit(project!.id); setMessage('提交成功，正在等待管理员审核；尚未更新玩家目录。');
    const next = await creatorApi.get(project!.id); projectRef.current = next; setProject(next);
  });
  const deleteProject = () => void runAfterSave(async () => {
    if (!confirm(`确定删除「${project!.title}」？发布版本会下架，草稿将无法恢复。`)) return;
    await creatorApi.delete(project!.id); setProject(null); projectRef.current = null;
    window.history.replaceState({}, '', '/creator'); await refreshList();
  });
  const groups = project ? groupedSections(Object.keys(project.sections)) : null;

  if (loading) return <div className="creator-loading">正在打开创作中心…</div>;
  return <div className="creator-app">
    <header className="creator-header"><a className="creator-brand" href="/">叙事档案 <span>／ 创作中心</span></a>
      <div className="creator-header-right"><a href="/">玩家入口 ↗</a>{account && <><span>{account.username}{account.role === 'admin' ? ' · 管理员' : ''}</span><button onClick={() => void runAfterSave(async () => {
        await creatorApi.logout(); setAccount(null); setProject(null); projectRef.current = null;
        window.history.replaceState({}, '', '/creator'); })}>退出</button></>}</div></header>
    {!account ? <main className="creator-auth"><div className="creator-auth-copy"><div className="creator-kicker">WRITE YOUR OWN WORLD</div>
      <h1>让故事，<br /><em>从这里开始。</em></h1><p>创建角色、地点和规则，随时保存草稿。完成校验后提交审核，通过后故事会出现在玩家目录。</p>
      <div className="creator-auth-lines"><span>01 / 定义世界</span><span>02 / 塑造角色</span><span>03 / 提交审核</span></div></div>
      <form className="creator-auth-card" onSubmit={authenticate}><div className="creator-kicker">AUTHOR ACCESS</div><h2>{authMode === 'login' ? '欢迎回来' : '创建创作者账号'}</h2>
        <label>用户名<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password}
          onChange={event => setPassword(event.target.value)} minLength={authMode === 'register' ? 10 : undefined} required /></label>
        <button className="creator-primary" type="submit">{authMode === 'login' ? '登录创作中心' : '注册并开始创作'} <span>↗</span></button>
        <button className="creator-text-button" type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setMessage(''); }}>
          {authMode === 'login' ? '没有账号？注册一个' : '已有账号？返回登录'}</button>{message && <p className="creator-error" role="alert">{message}</p>}</form></main>
      : homeForRole(account.role) === 'review' ? <ReviewWorkspace />
      : !project ? <main className="creator-library"><div className="creator-kicker">YOUR WORKSPACE / {account.username}</div>
        <div className="creator-library-title"><div><h1>我的故事</h1><p>每个故事由你独立管理。草稿保存后不会影响已经发布的版本。</p></div>
          <button className="creator-primary" onClick={() => { setShowCreate(true); void creatorApi.templates().then(data => setTemplates(data.templates)); }}>＋ 新建故事</button></div>
        {message && <p className="creator-error" role="alert">{message}</p>}
        {projects.length ? <div className="creator-project-grid">{projects.map(entry => <button key={entry.id} className="creator-project-card"
          onClick={() => void creatorApi.get(entry.id).then(openProject).catch(error => setMessage(errorText(error)))}>
          <span className="creator-project-state">{reviewStatusLabel(entry)}</span><h2>{entry.title}</h2><span>{entry.id}</span>
          <footer><span>最近编辑 {new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</span><strong>继续编辑 ↗</strong></footer></button>)}</div>
          : <div className="creator-library-empty"><span>✳</span><h2>还没有故事</h2><p>从一张空白纸开始，或复制内置故事作为模板。</p></div>}
        {showCreate && <div className="creator-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowCreate(false); }}><form className="creator-modal" onSubmit={create}>
          <div className="creator-kicker">NEW STORY</div><h2>建立一个新世界</h2>
          <label>故事名称<input value={newTitle} onChange={event => setNewTitle(event.target.value)} maxLength={100} required placeholder="例如：雨夜来信" /></label>
          <label>故事 ID<small>用于链接，创建后不可改；小写英文、数字和短横线</small><input value={newId} onChange={event => setNewId(event.target.value.toLowerCase())}
            pattern="[a-z0-9][a-z0-9-]*" required placeholder="rainy-letter" /></label>
          <label>从模板开始<select value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">空白故事</option>
            {templates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <div className="creator-modal-actions"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="creator-primary" type="submit">创建故事 ↗</button></div>
          {message && <p className="creator-error" role="alert">{message}</p>}</form></div>}</main>
        : <div className="creator-workspace"><aside className="creator-sidebar"><button className="creator-back" onClick={leaveProject}>← 我的故事</button>
          <div className="creator-story-heading"><div className="creator-kicker">STORY / {project.id}</div><h1>{project.title}</h1><span>{reviewStatusLabel(project)} · 草稿可继续编辑</span></div>
          <nav aria-label="配置项"><div className="creator-nav-title">剧本</div>{groups!.root.map(entry => <button key={entry} className={path === entry ? 'active' : ''} onClick={() => void switchPath(entry)}>{labelOf(entry).name}</button>)}
            <div className="creator-nav-title">玩家</div>{groups!.player.map(entry => <button key={entry} className={path === entry ? 'active' : ''} onClick={() => void switchPath(entry)}>{labelOf(entry).name}</button>)}
            <div className="creator-nav-title creator-nav-title-between">角色 <button onClick={addNpc} aria-label="添加 NPC">＋</button></div>
            {groups!.npcIds.map(id => <div className="creator-npc-group" key={id}><div className="creator-npc-heading"><strong>{(() => { try { return JSON.parse(project.sections[`npcs/${id}/base.json`]?.content ?? '{}').name ?? id; } catch { return id; } })()}</strong>
              <button onClick={() => removeNpc(id)} aria-label={`移除 ${id}`}>×</button></div>
              {Object.keys(project.sections).filter(entry => entry.startsWith(`npcs/${id}/`)).map(entry => <button key={entry} className={path === entry ? 'active' : ''}
                onClick={() => void switchPath(entry)}>{labelOf(entry).name}</button>)}</div>)}</nav></aside>
          <main className="creator-main"><div className="creator-toolbar"><span className={`creator-save-status ${saveState}`}>
            {saveState === 'saved' ? '✓ 已保存' : saveState === 'dirty' ? '● 待保存' : saveState === 'saving' ? '◌ 保存中' : saveState === 'conflict' ? '! 编辑冲突' : '! 保存失败'}</span>
            <div><button onClick={validate}>校验配置</button><button className="creator-primary" disabled={project.review?.status === 'pending'} onClick={submit}>
              {project.review?.status === 'pending' ? '等待审核' : '提交审核 ↗'}</button></div></div>
            {project.review?.status === 'rejected' && project.review.rejectionReason && <div className="creator-review-reason" role="status">
              <strong>上次提交未通过</strong><p>{project.review.rejectionReason}</p></div>}
            {project.review?.status === 'pending' && <div className="creator-review-note">已提交的版本正在审核。你可以继续编辑草稿，但不会改变待审内容。</div>}
            {message && <div className={message.startsWith('提交成功') ? 'creator-success' : 'creator-error'} role="status">{message}</div>}
            {report && <div className="creator-report"><strong>{report.errors.length ? `校验发现 ${report.errors.length} 个错误` : '校验通过，可以提交审核'}</strong>
              {[...report.errors, ...report.warnings].map((issue, index) => <button key={index} onClick={() => { const target = Object.keys(project.sections).find(entry => issue.path.startsWith(entry)); if (target) void switchPath(target); }}>
                <code>{issue.path}</code> {issue.message}</button>)}</div>}
            <SectionEditor key={path} path={path} content={draft} onChange={updateDraft} />
            <div className="creator-bottom-actions"><button className="creator-danger-link" onClick={deleteProject}>删除这个故事</button>
              {project.publishedAt && <a href={`/`} target="_blank" rel="noreferrer">前往玩家目录 ↗</a>}</div></main></div>}
  </div>;
}
