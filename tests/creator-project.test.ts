import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';

test('authors own isolated drafts; sections use revisions and invalid JSON can be saved', () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  try {
    const alice = creators.register('alice', 'alice-password-1').account.id;
    const bob = creators.register('bobby', 'bobby-password-1').account.id;
    const created = projects.create(alice, 'first-story', '第一部故事');
    assert.equal(created.sections['manifest.json'].revision, 1);
    assert.equal(projects.list(bob).length, 0);
    assert.equal(projects.get(bob, 'first-story'), null);
    assert.throws(() => projects.putSection(bob, 'first-story', 'manifest.json', '{}', 1), /无权|不存在/);
    const section = projects.putSection(alice, 'first-story', 'manifest.json', '{', 1);
    assert.equal(section.revision, 2);
    assert.throws(() => projects.putSection(alice, 'first-story', 'manifest.json', '{}', 1), /冲突/);
    assert.ok(projects.validate(alice, 'first-story').errors.some(issue => issue.path === 'manifest.json'));
    assert.throws(() => projects.publish(alice, 'first-story'), /校验/);
    assert.equal(projects.getPublished('first-story'), null);
  } finally { creators.close(); }
});

test('NPC changes, valid publish and soft deletion preserve prior published data', () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  try {
    const author = creators.register('writer', 'writer-password-1').account.id;
    projects.create(author, 'scene-book', '场景故事');
    projects.addNpc(author, 'scene-book', 'friend', '朋友');
    assert.ok(projects.get(author, 'scene-book')?.sections['npcs/friend/base.json']);
    projects.removeNpc(author, 'scene-book', 'friend');
    assert.equal(projects.get(author, 'scene-book')?.sections['npcs/friend/base.json'], undefined);
    const published = projects.publish(author, 'scene-book');
    assert.equal(published.title, '场景故事');
    const before = projects.getPublished('scene-book')!;
    const current = projects.get(author, 'scene-book')!.sections['manifest.json'];
    projects.putSection(author, 'scene-book', 'manifest.json', current.content.replace('场景故事', '草稿新名字'), current.revision);
    assert.equal(projects.getPublished('scene-book')?.title, before.title);
    projects.delete(author, 'scene-book');
    assert.equal(projects.getPublished('scene-book'), null);
    assert.equal(projects.list(author).length, 0);
    assert.ok(projects.getArchivedPublished('scene-book'));
  } finally { creators.close(); }
});
