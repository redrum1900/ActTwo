import { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { confirmAction, promptAction } from '../dialogs.js';
import { creatorApi, type Project, type ProjectSummary, type Report } from './client.js';
import { groupedSections, labelOf } from './sections.js';
import SectionEditor from './SectionEditor.js';
import ReviewWorkspace from './ReviewWorkspace.js';
import { CreatorNavigation } from './CreatorNavigation.js';
import { workspaceForPath, reviewStatusLabel, type CreatorWorkspace } from './review-ui.js';
import { hasUnsavedChanges, resolveDirtyChoice, settleSavedDraft } from './editor-session.js';
import { saveWithCover } from './cover-save.js';
import { patchManifest } from './section-forms.js';
import { referencedStoryEventIds } from './story-event-references.js';
import { conditionSourcesFromSections } from './condition-sources.js';
import { patchItemsImages, saveWithItemImages } from './item-image-save.js';
import ImportStoryModal from './ImportStoryModal.js';
import PlaytestDrawer from './PlaytestDrawer.js';
import { useAccount } from '../AccountGate.js';
import './creator.css';

function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请稍后重试'; }

export default function CreatorApp() {
  const { account, loading, login, register, logout } = useAccount();
  const [workspace, setWorkspace] = useState<CreatorWorkspace>('library');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [path, setPath] = useState('manifest.json');
  const [draft, setDraft] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [itemImageFiles, setItemImageFiles] = useState<Record<string, File>>({});
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'conflict' | 'error'>('saved');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPlaytests, setShowPlaytests] = useState(false);
  const draftRef = useRef(draft);
  const coverFileRef = useRef<File | null>(null);
  const itemImageFilesRef = useRef<Record<string, File>>({});
  const projectRef = useRef(project);
  const pathRef = useRef(path);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const savedContent = useRef('');
  const revision = useRef(1);
  const dirtyChoiceResolver = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null);
  const [showDirtyChoice, setShowDirtyChoice] = useState(false);

  const refreshList = async () => { const data = await creatorApi.list(); setProjects(data.projects); };
  useEffect(() => { if (!account) return;
    const next = workspaceForPath(account.role, window.location.pathname); setWorkspace(next);
    if (next === 'library') {
      if (window.location.pathname === '/creator/review') window.history.replaceState({}, '', '/creator');
      void refreshList();
    }
  }, [account?.id]);

  const openProject = (next: Project) => {
    setProject(next); projectRef.current = next;
    const first = next.sections['manifest.json'] ? 'manifest.json' : Object.keys(next.sections)[0];
    setPath(first); pathRef.current = first;
    savedContent.current = next.sections[first]?.content ?? '';
    revision.current = next.sections[first]?.revision ?? 1;
    draftRef.current = savedContent.current; setDraft(savedContent.current);
    coverFileRef.current = null; setCoverFile(null);
    itemImageFilesRef.current = {}; setItemImageFiles({});
    setSaveState('saved'); setReport(null); setMessage('');
    window.history.replaceState({}, '', `/creator/${encodeURIComponent(next.id)}`);
  };
  useEffect(() => {
    if (!account || workspace === 'review' || project) return;
    const id = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
    if (id) void creatorApi.get(id).then(openProject).catch(error => setMessage(errorText(error)));
  }, [account, workspace]);

  const updateDraft = (value: string) => { draftRef.current = value; setDraft(value); setSaveState('dirty'); setReport(null); };
  const updateCoverFile = (file: File | null) => {
    coverFileRef.current = file; setCoverFile(file);
    setSaveState(file || hasUnsavedChanges(draftRef.current, savedContent.current) ? 'dirty' : 'saved');
    setReport(null);
  };
  const updateItemImageFile = (id: string, file: File | null) => {
    const next = { ...itemImageFilesRef.current };
    if (file) next[id] = file; else delete next[id];
    itemImageFilesRef.current = next; setItemImageFiles(next);
    setSaveState(Object.keys(next).length || hasUnsavedChanges(draftRef.current, savedContent.current) ? 'dirty' : 'saved');
    setReport(null);
  };
  const isDirty = () => hasUnsavedChanges(draftRef.current, savedContent.current) || !!coverFileRef.current || Object.keys(itemImageFilesRef.current).length > 0;
  const resetDraft = async () => {
    if (!isDirty()) return;
    if (!await confirmAction('放弃当前配置中未保存的修改？', true)) return;
    discardDraft();
  };
  const discardDraft = () => {
    draftRef.current = savedContent.current; setDraft(savedContent.current);
    coverFileRef.current = null; setCoverFile(null);
    itemImageFilesRef.current = {}; setItemImageFiles({});
    setSaveState('saved'); setMessage(''); setReport(null);
  };
  const save = async (): Promise<boolean> => {
    if (savePromise.current) { const previous = await savePromise.current; if (!previous) return false; }
    const active = projectRef.current;
    if (!active || !isDirty()) { setSaveState('saved'); return true; }
    const savingPath = pathRef.current;
    const content = draftRef.current;
    const file = savingPath === 'manifest.json' ? coverFileRef.current : null;
    const pendingItemFiles = savingPath === 'items.json' ? { ...itemImageFilesRef.current } : {};
    const task = (async () => {
      setSaveState('saving');
      try {
        const result: { section: Awaited<ReturnType<typeof creatorApi.save>>; content: string;
          images?: Record<string, string>; uploadedIds?: string[] } = file ? await saveWithCover(content, file,
          selected => creatorApi.uploadCover(active.id, selected),
          nextContent => creatorApi.save(active.id, savingPath, nextContent, revision.current),
          cover => creatorApi.discardCover(active.id, cover).then(() => {}))
          : Object.keys(pendingItemFiles).length ? await saveWithItemImages(content, pendingItemFiles,
            selected => creatorApi.uploadItemImage(active.id, selected),
            nextContent => creatorApi.save(active.id, savingPath, nextContent, revision.current),
            image => creatorApi.discardItemImage(active.id, image).then(() => {}))
          : { section: await creatorApi.save(active.id, savingPath, content, revision.current), content };
        const { section } = result;
        revision.current = section.revision;
        savedContent.current = section.content;
        const settled = settleSavedDraft(content, draftRef.current, section.content);
        let nextDraft = settled.draft;
        if (file && !settled.canLeave) {
          try { nextDraft = patchManifest(nextDraft, { cover: JSON.parse(result.content).cover }); }
          catch { /* Keep an in-progress JSON edit exactly as typed. */ }
        }
        if (result.images && !settled.canLeave) {
          try { nextDraft = patchItemsImages(nextDraft, result.images); }
          catch { /* Keep an in-progress JSON edit exactly as typed. */ }
        }
        draftRef.current = nextDraft; setDraft(nextDraft);
        if (file && coverFileRef.current === file) { coverFileRef.current = null; setCoverFile(null); }
        if (result.uploadedIds) {
          const remaining = { ...itemImageFilesRef.current };
          for (const id of result.uploadedIds) if (remaining[id] === pendingItemFiles[id]) delete remaining[id];
          itemImageFilesRef.current = remaining; setItemImageFiles(remaining);
        }
        const title = savingPath === 'manifest.json' ? (() => { try { return JSON.parse(section.content).title as string; } catch { return undefined; } })() : undefined;
        const next = { ...projectRef.current!, ...(title ? { title } : {}), sections: { ...projectRef.current!.sections, [savingPath]: section } };
        projectRef.current = next; setProject(next);
        setSaveState(isDirty() ? 'dirty' : 'saved');
        return !isDirty();
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
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const askDirtyChoice = () => new Promise<'save' | 'discard' | 'cancel'>(resolve => {
    dirtyChoiceResolver.current = resolve; setShowDirtyChoice(true);
  });
  const chooseDirty = (choice: 'save' | 'discard' | 'cancel') => {
    setShowDirtyChoice(false); dirtyChoiceResolver.current?.(choice); dirtyChoiceResolver.current = null;
  };
  const runWithDraftGuard = async (action: () => Promise<void>) => {
    if (isDirty()) {
      const choice = await askDirtyChoice();
      if (!(await resolveDirtyChoice(choice, save))) return;
      if (choice === 'discard') discardDraft();
    }
    try { setMessage(''); await action(); } catch (error) { setMessage(errorText(error)); }
  };
  const switchPath = async (nextPath: string) => {
    if (nextPath === path) return;
    await runWithDraftGuard(async () => {
      const section = projectRef.current?.sections[nextPath];
      if (!section) return;
      setPath(nextPath); pathRef.current = nextPath;
      savedContent.current = section.content; revision.current = section.revision;
      draftRef.current = section.content; setDraft(section.content);
      coverFileRef.current = null; setCoverFile(null);
      itemImageFilesRef.current = {}; setItemImageFiles({});
      setSaveState('saved'); setMessage('');
    });
  };
  const goLibrary = () => void runWithDraftGuard(async () => {
    setProject(null); projectRef.current = null; setReport(null);
    setWorkspace('library');
    window.history.replaceState({}, '', '/creator'); await refreshList();
  });
  const goReview = () => {
    if (account?.role !== 'admin') return;
    void runWithDraftGuard(async () => {
      setProject(null); projectRef.current = null; setReport(null); setMessage('');
      setWorkspace('review'); window.history.replaceState({}, '', '/creator/review');
    });
  };
  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('');
    try { const user = authMode === 'login' ? await login(username, password) : await register(username, password);
      setPassword('');
      const next = workspaceForPath(user.role, window.location.pathname); setWorkspace(next);
      if (next === 'library') {
        if (window.location.pathname === '/creator/review') window.history.replaceState({}, '', '/creator');
        await refreshList();
      } }
    catch (error) { setMessage(errorText(error)); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('');
    try { const next = await creatorApi.create(newTitle.trim(), templateId || undefined);
      openProject(next); setShowCreate(false); setNewTitle(''); }
    catch (error) { setMessage(errorText(error)); }
  };
  const addNpc = () => void runWithDraftGuard(async () => {
    const id = await promptAction('NPC ID（英文小写、数字、短横线）'); if (!id) return;
    const name = await promptAction('NPC 名称'); if (!name) return;
    const next = await creatorApi.addNpc(project!.id, id, name);
    setProject(next); projectRef.current = next;
    await switchPath(`npcs/${id}/base.json`);
  });
  const removeNpc = (id: string) => void runWithDraftGuard(async () => {
    if (!await confirmAction(`确定移除 NPC「${id}」及其全部配置？此操作不能撤销。`, true)) return;
    const next = await creatorApi.removeNpc(project!.id, id);
    openProject(next);
  });
  const validate = () => void runWithDraftGuard(async () => { setReport(await creatorApi.validate(project!.id)); });
  const migrateStats = () => void runWithDraftGuard(async () => {
    if (!await confirmAction('迁移旧属性及其规则引用？若遇到指标 ID 冲突，不会保存任何修改。')) return;
    const active = projectRef.current!;
    const revisions = Object.fromEntries(Object.entries(active.sections).map(([sectionPath, section]) => [sectionPath, section.revision]));
    openProject(await creatorApi.migrateStats(active.id, revisions));
    setMessage('旧属性已迁移。请检查各指标及规则后保存／提交。');
  });
  const submit = () => void runWithDraftGuard(async () => {
    const check = await creatorApi.validate(project!.id); setReport(check);
    if (check.errors.length) { setMessage('校验未通过，不能提交审核。'); return; }
    await creatorApi.submit(project!.id); setMessage('提交成功，正在等待管理员审核；尚未更新玩家目录。');
    const next = await creatorApi.get(project!.id); projectRef.current = next; setProject(next);
  });
  const deleteProject = () => void runWithDraftGuard(async () => {
    if (!await confirmAction(`确定删除「${project!.title}」？发布版本会下架，草稿将无法恢复。`, true)) return;
    await creatorApi.delete(project!.id); setProject(null); projectRef.current = null;
    window.history.replaceState({}, '', '/creator'); await refreshList();
  });
  const groups = project ? groupedSections(Object.keys(project.sections)) : null;
  const savedLocations = (() => {
    try {
      const locations = JSON.parse(project?.sections['locations.json']?.content ?? '[]') as { id?: unknown; name?: unknown }[];
      return locations.filter(location => typeof location.id === 'string' && typeof location.name === 'string') as { id: string; name: string }[];
    } catch { return []; }
  })();
  const savedStoryEvents = (() => {
    try {
      const manifest = JSON.parse(project?.sections['manifest.json']?.content ?? '{}') as { storyEvents?: { id?: unknown; label?: unknown }[] };
      return (manifest.storyEvents ?? []).filter(event => typeof event.id === 'string' && typeof event.label === 'string') as { id: string; label: string }[];
    } catch { return []; }
  })();

  if (loading) return <div className="creator-loading">正在打开创作中心…</div>;
  return <div className={`creator-app${project ? ' creator-app-editing' : ''}`}>
    <header className="creator-header"><a className="creator-brand" href="/">叙事档案 <span>／ 创作中心</span></a>
      {account && <CreatorNavigation role={account.role} workspace={workspace} onLibrary={goLibrary} onReview={goReview} />}
      <div className="creator-header-right"><a href="/">玩家入口 ↗</a>{account && <><a href={account.role === 'admin' ? '/creator/usage' : '/usage'}>AI 用量</a><span>{account.username}{account.role === 'admin' ? ' · 管理员' : ''}</span><button onClick={() => void runWithDraftGuard(async () => {
        await logout(); setProject(null); projectRef.current = null;
        setWorkspace('library'); window.history.replaceState({}, '', '/creator'); })}>退出</button></>}</div></header>
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
      : account.role === 'admin' && workspace === 'review' ? <ReviewWorkspace />
      : !project ? <main className="creator-library"><div className="creator-kicker">YOUR WORKSPACE / {account.username}</div>
        <div className="creator-library-title"><div><h1>我的故事</h1><p>每个故事由你独立管理。草稿保存后不会影响已经发布的版本。</p></div>
          <button className="creator-primary" onClick={() => { setShowCreate(true); void creatorApi.templates().then(data => setTemplates(data.templates)); }}>＋ 新建故事</button></div>
        {message && <p className="creator-error" role="alert">{message}</p>}
        {projects.length ? <div className="creator-project-grid">{projects.map(entry => <button key={entry.id} className="creator-project-card"
          onClick={() => void creatorApi.get(entry.id).then(openProject).catch(error => setMessage(errorText(error)))}>
          <span className="creator-project-state">{reviewStatusLabel(entry)}</span><h2>{entry.title}</h2>{entry.subtitle && <span>{entry.subtitle}</span>}
          <footer><span>最近编辑 {new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</span><strong>继续编辑 ↗</strong></footer></button>)}</div>
          : <div className="creator-library-empty"><span>✳</span><h2>还没有故事</h2><p>从一张空白纸开始，或复制内置故事作为模板。</p></div>}
        <Modal className="creator-form-dialog" title="建立一个新世界" open={showCreate} onCancel={() => setShowCreate(false)}
          footer={null} destroyOnHidden><form className="creator-modal" onSubmit={create}>
          <div className="creator-kicker">NEW STORY</div>
          <label>故事名称<input value={newTitle} onChange={event => setNewTitle(event.target.value)} maxLength={100} required placeholder="例如：雨夜来信" /></label>
          <label>从模板开始<select value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">空白故事</option>
            {templates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <div className="creator-modal-actions"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="creator-primary" type="submit">创建故事 ↗</button></div>
          {message && <p className="creator-error" role="alert">{message}</p>}</form></Modal></main>
        : <div className="creator-workspace"><aside className="creator-sidebar"><div className="creator-sidebar-intro">
          <button className="creator-back" onClick={goLibrary}>← 我的故事</button>
          <div className="creator-story-heading"><div className="creator-kicker">STORY / {project.title}</div><h1>{project.title}</h1><span>{reviewStatusLabel(project)} · 草稿可继续编辑</span></div></div>
          <nav aria-label="配置项"><div className="creator-nav-title">剧本</div>{groups!.root.map(entry => <button key={entry} className={path === entry ? 'active' : ''} onClick={() => void switchPath(entry)}>{labelOf(entry).name}</button>)}
            <div className="creator-nav-title">玩家</div>{groups!.player.map(entry => <button key={entry} className={path === entry ? 'active' : ''} onClick={() => void switchPath(entry)}>{labelOf(entry).name}</button>)}
            <div className="creator-nav-title creator-nav-title-between">角色 <button onClick={addNpc} aria-label="添加 NPC">＋</button></div>
            {groups!.npcIds.map(id => <div className="creator-npc-group" key={id}><div className="creator-npc-heading"><strong>{(() => { try { return JSON.parse(project.sections[`npcs/${id}/base.json`]?.content ?? '{}').name ?? id; } catch { return id; } })()}</strong>
              <button onClick={() => removeNpc(id)} aria-label={`移除 ${id}`}>×</button></div>
              {Object.keys(project.sections).filter(entry => entry.startsWith(`npcs/${id}/`)).map(entry => <button key={entry} className={path === entry ? 'active' : ''}
                onClick={() => void switchPath(entry)}>{labelOf(entry).name}</button>)}</div>)}</nav></aside>
          <main className="creator-main"><div className="creator-toolbar"><span className={`creator-save-status ${saveState}`}>
            {saveState === 'saved' ? '✓ 已保存' : saveState === 'dirty' ? '● 待保存' : saveState === 'saving' ? '◌ 保存中' : saveState === 'conflict' ? '! 编辑冲突' : '! 保存失败'}</span>
            <div><button onClick={() => setShowPlaytests(true)}>试玩</button>{account.role === 'admin' && account.username === 'superadmin' && <button onClick={() => void runWithDraftGuard(async () => setShowImport(true))}>智能导入</button>}<button onClick={validate}>校验配置</button><button className="creator-primary" disabled={project.review?.status === 'pending'} onClick={submit}>
              {project.review?.status === 'pending' ? '等待审核' : '提交审核 ↗'}</button></div></div>
            {project.review?.status === 'rejected' && project.review.rejectionReason && <div className="creator-review-reason" role="status">
              <strong>上次提交未通过</strong><p>{project.review.rejectionReason}</p></div>}
            {project.review?.status === 'pending' && <div className="creator-review-note">已提交的版本正在审核。你可以继续编辑草稿，但不会改变待审内容。</div>}
            {message && <div className={message.startsWith('提交成功') ? 'creator-success' : 'creator-error'} role="status">{message}</div>}
            {report && <div className="creator-report"><strong>{report.errors.length ? `校验发现 ${report.errors.length} 个错误` : '校验通过，可以提交审核'}</strong>
              {[...report.errors, ...report.warnings].map((issue, index) => <button key={index} onClick={() => { const target = Object.keys(project.sections).find(entry => issue.path.startsWith(entry)); if (target) void switchPath(target); }}>
                <code>{issue.path}</code> {issue.message}</button>)}</div>}
            <SectionEditor key={path} path={path} content={draft} onChange={updateDraft} onMigrateStats={migrateStats} savedLocations={savedLocations} savedStoryEvents={savedStoryEvents}
              referencedStoryEventIds={referencedStoryEventIds(project.sections)}
              conditionSources={conditionSourcesFromSections(project.sections)}
              projectId={project.id} coverFile={coverFile} onCoverFileChange={updateCoverFile}
              itemImageFiles={itemImageFiles} onItemImageFileChange={updateItemImageFile} />
            <div className="creator-save-actions"><span>{saveState === 'dirty' ? '修改尚未保存' : saveState === 'conflict' ? '其他窗口已修改，请处理冲突' : saveState === 'error' ? '保存失败，草稿仍在本页' : saveState === 'saving' ? '正在保存…' : '当前配置已保存'}</span>
              <div><button type="button" disabled={saveState === 'saving' || (!hasUnsavedChanges(draft, savedContent.current) && !coverFile && !Object.keys(itemImageFiles).length)} onClick={resetDraft}>重置</button>
                <button className="creator-primary" type="button" disabled={saveState === 'saving' || (!hasUnsavedChanges(draft, savedContent.current) && !coverFile && !Object.keys(itemImageFiles).length)} onClick={() => void save()}>保存</button></div></div>
            <div className="creator-bottom-actions"><button className="creator-danger-link" onClick={deleteProject}>删除这个故事</button>
              {project.publishedAt && <a href={`/`} target="_blank" rel="noreferrer">前往玩家目录 ↗</a>}</div></main></div>}
    {showImport && project && <ImportStoryModal projectId={project.id} onClose={() => setShowImport(false)} onApplied={next => {
      openProject({ ...next, review: project.review }); setShowImport(false); setMessage('导入结果已写入当前故事草稿，请检查后提交审核。');
    }} />}
    {showPlaytests && project && <PlaytestDrawer projectId={project.id} onClose={() => setShowPlaytests(false)}
      unsaved={saveState !== 'saved' || hasUnsavedChanges(draft, savedContent.current) || !!coverFile || !!Object.keys(itemImageFiles).length} />}
    <Modal className="creator-form-dialog" title="当前配置尚未保存" open={showDirtyChoice} onCancel={() => chooseDirty('cancel')}
      footer={null} closable={false} mask={{ closable: false }} destroyOnHidden><div className="creator-modal">
      <div className="creator-kicker">UNSAVED CHANGES</div><p>离开后，未保存的修改会丢失。</p>
      <div className="creator-modal-actions"><button type="button" onClick={() => chooseDirty('cancel')}>继续编辑</button>
        <button type="button" onClick={() => chooseDirty('discard')}>放弃修改</button>
        <button className="creator-primary" type="button" onClick={() => chooseDirty('save')}>保存并继续</button></div></div></Modal>
  </div>;
}
