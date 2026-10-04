import type { FormEvent } from 'react';
import { Modal } from 'antd';
import type { ProjectSummary } from '../api/client.js';
import { reviewStatusLabel } from '../model/review-ui.js';

export interface CreatorLibraryViewProps {
  username: string;
  projects: ProjectSummary[];
  message: string;
  showCreate: boolean;
  newTitle: string;
  templateId: string;
  templates: { id: string; title: string }[];
  onPrepareCreate: () => void;
  onCloseCreate: () => void;
  onCreate: (event: FormEvent) => void;
  onNewTitleChange: (value: string) => void;
  onTemplateIdChange: (value: string) => void;
  onOpenProject: (id: string) => void;
}

export function CreatorLibraryView({ username, projects, message, showCreate, newTitle, templateId, templates,
  onPrepareCreate, onCloseCreate, onCreate, onNewTitleChange, onTemplateIdChange, onOpenProject }: CreatorLibraryViewProps) {
  return <main className="creator-library"><div className="creator-kicker">YOUR WORKSPACE / {username}</div>
    <div className="creator-library-title"><div><h1>我的故事</h1><p>每个故事由你独立管理。草稿保存后不会影响已经发布的版本。</p></div>
      <button className="creator-primary" onClick={onPrepareCreate}>＋ 新建故事</button></div>
    {message && <p className="creator-error" role="alert">{message}</p>}
    {projects.length ? <div className="creator-project-grid">{projects.map(entry => <button key={entry.id} className="creator-project-card"
      onClick={() => onOpenProject(entry.id)}>
      <span className="creator-project-state">{reviewStatusLabel(entry)}</span><h2>{entry.title}</h2>{entry.subtitle && <span>{entry.subtitle}</span>}
      <footer><span>最近编辑 {new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</span><strong>继续编辑 ↗</strong></footer></button>)}</div>
      : <div className="creator-library-empty"><span>✳</span><h2>还没有故事</h2><p>从一张空白纸开始，或复制内置故事作为模板。</p></div>}
    <Modal className="creator-form-dialog" title="建立一个新世界" open={showCreate} onCancel={onCloseCreate}
      footer={null} destroyOnHidden><form className="creator-modal" onSubmit={onCreate}>
      <div className="creator-kicker">NEW STORY</div>
      <label>故事名称<input value={newTitle} onChange={event => onNewTitleChange(event.target.value)} maxLength={100} required placeholder="例如：雨夜来信" /></label>
      <label>从模板开始<select value={templateId} onChange={event => onTemplateIdChange(event.target.value)}><option value="">空白故事</option>
        {templates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="creator-modal-actions"><button type="button" onClick={onCloseCreate}>取消</button><button className="creator-primary" type="submit">创建故事 ↗</button></div>
      {message && <p className="creator-error" role="alert">{message}</p>}</form></Modal></main>;
}
