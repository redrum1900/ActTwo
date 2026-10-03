import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';

test('project list exposes the saved subtitle and tolerates an invalid draft manifest', () => {
  const creators = createCreatorStore(':memory:');
  try {
    const owner = creators.register('subtitle-author', 'password-password').account.id;
    const projects = createProjectStore(creators.db);
    const project = projects.create(owner, 'subtitle-story', '标题');
    const manifest = project.sections['manifest.json'];
    projects.putSection(owner, project.id, 'manifest.json', JSON.stringify({ title: '标题', subtitle: '一段副标题' }), manifest.revision);
    assert.equal(projects.list(owner)[0].subtitle, '一段副标题');
    projects.putSection(owner, project.id, 'manifest.json', '{invalid', manifest.revision + 1);
    assert.equal(projects.list(owner)[0].subtitle, '');
  } finally { creators.db.close(); }
});
import { createReviewStore } from '../apps/api/src/creator/review-store.js';

test('authors own isolated drafts; sections use revisions and invalid JSON can be saved', () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  const reviews = createReviewStore(creators.db, projects);
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
    assert.throws(() => reviews.submit(alice, 'first-story'), /校验/);
    assert.equal(projects.getPublished('first-story'), null);
  } finally { creators.close(); }
});

test('NPC changes, valid publish and soft deletion preserve prior published data', () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  const reviews = createReviewStore(creators.db, projects);
  try {
    const author = creators.register('writer', 'writer-password-1').account.id;
    projects.create(author, 'scene-book', '场景故事');
    projects.addNpc(author, 'scene-book', 'friend', '朋友');
    assert.ok(projects.get(author, 'scene-book')?.sections['npcs/friend/base.json']);
    projects.removeNpc(author, 'scene-book', 'friend');
    assert.equal(projects.get(author, 'scene-book')?.sections['npcs/friend/base.json'], undefined);
    const submission = reviews.submit(author, 'scene-book');
    assert.equal(projects.getPublished('scene-book'), null);
    const published = reviews.approve(creators.createAdmin('admin_one', 'admin-password-1').id, submission.id).script;
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

test('project store accepts story indicator section and migrates legacy stats atomically', () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  try {
    const author = creators.register('migrator', 'migrator-password-1').account.id;
    const project = projects.create(author, 'migrate-story', '迁移故事');
    const stat = JSON.stringify([{ id: 'score', owner: 'world', initial: 1, min: 0, max: 10 }]);
    const current = project.sections['story/indicators.json'];
    assert.equal(projects.putSection(author, project.id, 'story/indicators.json', current.content, current.revision).revision, 2);
    creators.db.prepare('INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,?,?)')
      .run(project.id, 'stats.json', stat, 1, new Date().toISOString());
    const store = projects as typeof projects & { migrateStats?: (owner: string, id: string, revisions: Record<string, number>) => typeof project };
    assert.ok(store.migrateStats, 'project store must expose atomic migration');
    const before = projects.get(author, project.id)!;
    const revisions = Object.fromEntries(Object.entries(before.sections).map(([path, section]) => [path, section.revision]));
    const migrated = store.migrateStats(author, project.id, revisions);
    assert.deepEqual(JSON.parse(migrated.sections['stats.json'].content), []);
    assert.ok(JSON.parse(migrated.sections['story/indicators.json'].content).some((entry: { id: string }) => entry.id === 'score'));
    assert.throws(() => store.migrateStats!(author, project.id, revisions), /冲突/);
  } finally { creators.close(); }
});

test('player and NPC rule editor groups survive draft saves, review, and publication', () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  const reviews = createReviewStore(creators.db, projects);
  try {
    const author = creators.register('group_writer', 'group-password-1').account.id;
    const project = projects.create(author, 'grouped-story', '分组故事');
    const rules = [
      { path: 'player/rules.json', rule: { id: 'explore-once', intent: '探索', trigger: 'automatic', editorGroup: '探索', effects: [] } },
      { path: 'npcs/character/rules.json', rule: { id: 'greeting', intent: '寒暄', trigger: 'semantic', editorGroup: '关系', effects: [] } },
    ];
    for (const { path, rule } of rules) {
      const current = project.sections[path];
      assert.ok(current, `${path} should exist in the new project`);
      projects.putSection(author, project.id, path, JSON.stringify([rule]), current.revision);
      assert.equal(JSON.parse(projects.get(author, project.id)!.sections[path].content)[0].editorGroup, rule.editorGroup);
    }
    const submission = reviews.submit(author, project.id);
    assert.equal(submission.script.playerRules?.[0].editorGroup, '探索');
    assert.equal(submission.script.npcs[0].rules?.[0].editorGroup, '关系');
    const published = reviews.approve(creators.createAdmin('group_admin', 'admin-password-1').id, submission.id).script;
    assert.equal(published.playerRules?.[0].editorGroup, '探索');
    assert.equal(projects.getPublished(project.id)?.npcs[0].rules?.[0].editorGroup, '关系');
  } finally { creators.close(); }
});

test('NPC world book names and types survive draft, review and publication', () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  const reviews = createReviewStore(creators.db, projects);
  try {
    const author = creators.register('lore_writer', 'lore-password-1').account.id;
    const project = projects.create(author, 'lore-story', '世界书故事');
    const path = 'npcs/character/lore.json';
    const lore = [{ id: 'book-one', name: '人物背景', type: 'always', keywords: [], content: '始终记得。' }];
    projects.putSection(author, project.id, path, JSON.stringify(lore), project.sections[path].revision);
    assert.deepEqual(JSON.parse(projects.get(author, project.id)!.sections[path].content), lore);
    const submission = reviews.submit(author, project.id);
    assert.equal(submission.script.npcs[0].lore?.[0].name, '人物背景');
    assert.equal(submission.script.npcs[0].lore?.[0].type, 'always');
    reviews.approve(creators.createAdmin('lore_admin', 'admin-password-1').id, submission.id);
    assert.deepEqual(projects.getPublished(project.id)?.npcs[0].lore, lore);
  } finally { creators.close(); }
});
