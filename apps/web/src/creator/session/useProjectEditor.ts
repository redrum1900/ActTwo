import { useEffect, useRef, useState } from 'react';
import { confirmAction } from '../../app/dialogs.js';
import { creatorApi, type Project, type Report } from '../api/client.js';
import { hasUnsavedChanges, resolveDirtyChoice, settleSavedDraft } from './editor-session.js';
import { saveWithCover } from './cover-save.js';
import { patchManifest } from '../model/section-forms.js';
import { patchItemsImages, saveWithItemImages } from './item-image-save.js';

type EditorApi = Pick<typeof creatorApi, 'save' | 'uploadCover' | 'discardCover' | 'uploadItemImage' | 'discardItemImage'>;
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请稍后重试';

export function useProjectEditor(api: EditorApi = creatorApi) {
  const [project, setProject] = useState<Project | null>(null);
  const [path, setPath] = useState('manifest.json');
  const [draft, setDraft] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [itemImageFiles, setItemImageFiles] = useState<Record<string, File>>({});
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'conflict' | 'error'>('saved');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<Report | null>(null);
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
          selected => api.uploadCover(active.id, selected),
          nextContent => api.save(active.id, savingPath, nextContent, revision.current),
          cover => api.discardCover(active.id, cover).then(() => {}))
          : Object.keys(pendingItemFiles).length ? await saveWithItemImages(content, pendingItemFiles,
            selected => api.uploadItemImage(active.id, selected),
            nextContent => api.save(active.id, savingPath, nextContent, revision.current),
            image => api.discardItemImage(active.id, image).then(() => {}))
          : { section: await api.save(active.id, savingPath, content, revision.current), content };
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
  const replaceProject = (next: Project) => { projectRef.current = next; setProject(next); };
  const closeProject = () => { projectRef.current = null; setProject(null); };
  const currentProject = () => projectRef.current;
  return { project, path, draft, coverFile, itemImageFiles, saveState, message, report, showDirtyChoice,
    setMessage, setReport, openProject, replaceProject, closeProject, currentProject,
    updateDraft, updateCoverFile, updateItemImageFile, isDirty, resetDraft, save,
    chooseDirty, runWithDraftGuard, switchPath };
}
