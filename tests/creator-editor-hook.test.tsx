import test from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { installPlayerDom } from './player-dom.js';
import { creatorApi, type Project, type Section } from '../apps/web/src/creator/api/client.js';
import { useProjectEditor } from '../apps/web/src/creator/session/useProjectEditor.js';

test('saving an older draft keeps edits made while the request is in flight', async () => {
  const cleanup = installPlayerDom('/creator');
  let finishSave!: (section: Section) => void;
  const persistence = { ...creatorApi, save: async () => new Promise<Section>(resolve => { finishSave = resolve; }) };
  const project: Project = { id: 'story-a', title: '测试', createdAt: '', updatedAt: '', publishedAt: null, review: null,
    sections: { 'manifest.json': { content: '原稿', revision: 1, updatedAt: '' } } };
  const hook = renderHook(() => useProjectEditor(persistence));
  try {
    act(() => hook.result.current.openProject(project));
    act(() => hook.result.current.updateDraft('第一个修改'));
    let saving!: Promise<boolean>;
    act(() => { saving = hook.result.current.save(); });
    act(() => hook.result.current.updateDraft('继续修改'));
    await act(async () => { finishSave({ content: '第一个修改', revision: 2, updatedAt: '' }); await saving; });
    assert.equal(hook.result.current.draft, '继续修改');
    assert.equal(hook.result.current.project?.sections['manifest.json'].revision, 2);
    assert.equal(hook.result.current.saveState, 'dirty');
    assert.equal(hook.result.current.isDirty(), true);
  } finally { hook.unmount(); cleanup(); }
});
