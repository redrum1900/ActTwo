import { useEffect, useState } from 'react';
import { Modal } from 'antd';
import { confirmAction, promptAction } from '../../app/dialogs.js';
import { creatorApi, type ProjectSummary } from '../api/client.js';
import { groupedSections, labelOf } from '../model/sections.js';
import SectionEditor from '../editor/SectionEditor.js';
import ReviewWorkspace from '../workflows/ReviewWorkspace.js';
import { CreatorNavigation } from './CreatorNavigation.js';
import { workspaceForPath, reviewStatusLabel, type CreatorWorkspace } from '../model/review-ui.js';
import { referencedStoryEventIds } from '../model/story-event-references.js';
import { conditionSourcesFromSections } from '../model/condition-sources.js';
import ImportStoryModal from '../workflows/ImportStoryModal.js';
import PlaytestDrawer from '../workflows/PlaytestDrawer.js';
import { useProjectEditor } from '../session/useProjectEditor.js';
import { CreatorAuthView } from './CreatorAuthView.js';
import { CreatorLibraryView } from './CreatorLibraryView.js';
import { useAccount } from '../../app/AccountGate.js';
import '../creator.css';

function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请稍后重试'; }

export default function CreatorApp() {
  const { account, loading, login, register, logout } = useAccount();
  const [workspace, setWorkspace] = useState<CreatorWorkspace>('library');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const { project, path, draft, coverFile, itemImageFiles, saveState, message, report, showDirtyChoice,
    setMessage, setReport, openProject, replaceProject, closeProject, currentProject,
    updateDraft, updateCoverFile, updateItemImageFile, isDirty, resetDraft, save,
    chooseDirty, runWithDraftGuard, switchPath } = useProjectEditor();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPlaytests, setShowPlaytests] = useState(false);
  const refreshList = async () => { const data = await creatorApi.list(); setProjects(data.projects); };
  useEffect(() => { if (!account) return;
    const next = workspaceForPath(account.role, window.location.pathname); setWorkspace(next);
    if (next === 'library') {
      if (window.location.pathname === '/creator/review') window.history.replaceState({}, '', '/creator');
      void refreshList();
    }
  }, [account?.id]);

  useEffect(() => {
    if (!account || workspace === 'review' || project) return;
    const id = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
    if (id) void creatorApi.get(id).then(openProject).catch(error => setMessage(errorText(error)));
  }, [account, workspace]);

  const goLibrary = () => void runWithDraftGuard(async () => {
    closeProject(); setReport(null);
    setWorkspace('library');
    window.history.replaceState({}, '', '/creator'); await refreshList();
  });
  const goReview = () => {
    if (account?.role !== 'admin') return;
    void runWithDraftGuard(async () => {
      closeProject(); setReport(null); setMessage('');
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
    replaceProject(next);
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
    const active = currentProject()!;
    const revisions = Object.fromEntries(Object.entries(active.sections).map(([sectionPath, section]) => [sectionPath, section.revision]));
    openProject(await creatorApi.migrateStats(active.id, revisions));
    setMessage('旧属性已迁移。请检查各指标及规则后保存／提交。');
  });
  const submit = () => void runWithDraftGuard(async () => {
    const check = await creatorApi.validate(project!.id); setReport(check);
    if (check.errors.length) { setMessage('校验未通过，不能提交审核。'); return; }
    await creatorApi.submit(project!.id); setMessage('提交成功，正在等待管理员审核；尚未更新玩家目录。');
    const next = await creatorApi.get(project!.id); replaceProject(next);
  });
  const deleteProject = () => void runWithDraftGuard(async () => {
    if (!await confirmAction(`确定删除「${project!.title}」？发布版本会下架，草稿将无法恢复。`, true)) return;
    await creatorApi.delete(project!.id); closeProject();
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
    <header className="creator-header"><a className="creator-brand" href="/">ACT II <span>／ 创作中心</span></a>
      {account && <CreatorNavigation role={account.role} workspace={workspace} onLibrary={goLibrary} onReview={goReview} />}
      <div className="creator-header-right"><a href="/">玩家入口 ↗</a>{account && <><a href={account.role === 'admin' ? '/creator/usage' : '/usage'}>AI 用量</a><span>{account.username}{account.role === 'admin' ? ' · 管理员' : ''}</span><button onClick={() => void runWithDraftGuard(async () => {
        await logout(); closeProject();
        setWorkspace('library'); window.history.replaceState({}, '', '/creator'); })}>退出</button></>}</div></header>
    {!account ? <CreatorAuthView authMode={authMode} username={username} password={password} message={message}
      onAuthenticate={authenticate} onUsernameChange={setUsername} onPasswordChange={setPassword}
      onToggleAuthMode={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setMessage(''); }} />
      : account.role === 'admin' && workspace === 'review' ? <ReviewWorkspace />
      : !project ? <CreatorLibraryView username={account.username} projects={projects} message={message}
        showCreate={showCreate} newTitle={newTitle} templateId={templateId} templates={templates}
        onPrepareCreate={() => { setShowCreate(true); void creatorApi.templates().then(data => setTemplates(data.templates)); }}
        onCloseCreate={() => setShowCreate(false)} onCreate={create} onNewTitleChange={setNewTitle}
        onTemplateIdChange={setTemplateId}
        onOpenProject={id => void creatorApi.get(id).then(openProject).catch(error => setMessage(errorText(error)))} />
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
              <div><button type="button" disabled={saveState === 'saving' || !isDirty()} onClick={resetDraft}>重置</button>
                <button className="creator-primary" type="button" disabled={saveState === 'saving' || !isDirty()} onClick={() => void save()}>保存</button></div></div>
            <div className="creator-bottom-actions"><button className="creator-danger-link" onClick={deleteProject}>删除这个故事</button>
              {project.publishedAt && <a href={`/`} target="_blank" rel="noreferrer">前往玩家目录 ↗</a>}</div></main></div>}
    {showImport && project && <ImportStoryModal projectId={project.id} onClose={() => setShowImport(false)} onApplied={next => {
      openProject({ ...next, review: project.review }); setShowImport(false); setMessage('导入结果已写入当前故事草稿，请检查后提交审核。');
    }} />}
    {showPlaytests && project && <PlaytestDrawer projectId={project.id} onClose={() => setShowPlaytests(false)}
      unsaved={saveState !== 'saved' || isDirty()} />}
    <Modal className="creator-form-dialog" title="当前配置尚未保存" open={showDirtyChoice} onCancel={() => chooseDirty('cancel')}
      footer={null} closable={false} mask={{ closable: false }} destroyOnHidden><div className="creator-modal">
      <div className="creator-kicker">UNSAVED CHANGES</div><p>离开后，未保存的修改会丢失。</p>
      <div className="creator-modal-actions"><button type="button" onClick={() => chooseDirty('cancel')}>继续编辑</button>
        <button type="button" onClick={() => chooseDirty('discard')}>放弃修改</button>
        <button className="creator-primary" type="button" onClick={() => chooseDirty('save')}>保存并继续</button></div></div></Modal>
  </div>;
}
