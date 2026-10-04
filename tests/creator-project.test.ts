import test from 'node:test';
import assert from 'node:assert/strict';
import { withCreatorMysql } from './support/creator-mysql.js';

test('project list exposes the saved subtitle and tolerates an invalid draft manifest', async () => {
  await withCreatorMysql(async ({ accounts, projects }) => {
    const owner = (await accounts.register('subtitle-author', 'password-password')).account.id;
    const project = await projects.create(owner, 'subtitle-story', '标题');
    const manifest = project.sections['manifest.json'];
    await projects.putSection(owner, project.id, 'manifest.json', JSON.stringify({ title: '标题', subtitle: '一段副标题' }), manifest.revision);
    assert.equal((await projects.list(owner))[0].subtitle, '一段副标题');
    await projects.putSection(owner, project.id, 'manifest.json', '{invalid', manifest.revision + 1);
    assert.equal((await projects.list(owner))[0].subtitle, '');
  });
});

test('authors own isolated drafts; sections use revisions and invalid JSON can be saved', async () => {
  await withCreatorMysql(async ({ accounts, projects, reviews }) => {
    const alice = (await accounts.register('alice', 'alice-password-1')).account.id;
    const bob = (await accounts.register('bobby', 'bobby-password-1')).account.id;
    const created = await projects.create(alice, 'first-story', '第一部故事');
    assert.equal(created.sections['manifest.json'].revision, 1);
    assert.equal((await projects.list(bob)).length, 0);
    assert.equal(await projects.get(bob, 'first-story'), null);
    await assert.rejects(projects.putSection(bob, 'first-story', 'manifest.json', '{}', 1), /无权|不存在/);
    const section = await projects.putSection(alice, 'first-story', 'manifest.json', '{', 1);
    assert.equal(section.revision, 2);
    await assert.rejects(projects.putSection(alice, 'first-story', 'manifest.json', '{}', 1), /冲突/);
    assert.ok((await projects.validate(alice, 'first-story')).errors.some(issue => issue.path === 'manifest.json'));
    await assert.rejects(reviews.submit(alice, 'first-story'), /校验/);
    assert.equal(await projects.getPublished('first-story'), null);
  });
});

test('NPC changes, valid publish and soft deletion preserve prior published data', async () => {
  await withCreatorMysql(async ({ accounts, projects, reviews }) => {
    const author = (await accounts.register('writer', 'writer-password-1')).account.id;
    await projects.create(author, 'scene-book', '场景故事');
    await projects.addNpc(author, 'scene-book', 'friend', '朋友');
    assert.ok((await projects.get(author, 'scene-book'))?.sections['npcs/friend/base.json']);
    await projects.removeNpc(author, 'scene-book', 'friend');
    assert.equal((await projects.get(author, 'scene-book'))?.sections['npcs/friend/base.json'], undefined);
    const submission = await reviews.submit(author, 'scene-book');
    assert.equal(await projects.getPublished('scene-book'), null);
    const published = (await reviews.approve((await accounts.createAdmin('admin_one', 'admin-password-1')).id, submission.id)).script;
    assert.equal(published.title, '场景故事');
    const before = (await projects.getPublished('scene-book'))!;
    const current = (await projects.get(author, 'scene-book'))!.sections['manifest.json'];
    await projects.putSection(author, 'scene-book', 'manifest.json', current.content.replace('场景故事', '草稿新名字'), current.revision);
    assert.equal((await projects.getPublished('scene-book'))?.title, before.title);
    await projects.delete(author, 'scene-book');
    assert.equal(await projects.getPublished('scene-book'), null);
    assert.equal((await projects.list(author)).length, 0);
    assert.ok(await projects.getArchivedPublished('scene-book'));
  });
});

test('project store accepts story indicator section and migrates legacy stats atomically', async () => {
  await withCreatorMysql(async ({ pool, accounts, projects }) => {
    const author = (await accounts.register('migrator', 'migrator-password-1')).account.id;
    const project = await projects.create(author, 'migrate-story', '迁移故事');
    const stat = JSON.stringify([{ id: 'score', owner: 'world', initial: 1, min: 0, max: 10 }]);
    const current = project.sections['story/indicators.json'];
    assert.equal((await projects.putSection(author, project.id, 'story/indicators.json', current.content, current.revision)).revision, 2);
    await pool.execute('INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,?,?)',
      [project.id, 'stats.json', stat, 1, new Date().toISOString()]);
    const before = (await projects.get(author, project.id))!;
    const revisions = Object.fromEntries(Object.entries(before.sections).map(([path, section]) => [path, section.revision]));
    const migrated = await projects.migrateStats(author, project.id, revisions);
    assert.deepEqual(JSON.parse(migrated.sections['stats.json'].content), []);
    assert.ok(JSON.parse(migrated.sections['story/indicators.json'].content).some((entry: { id: string }) => entry.id === 'score'));
    await assert.rejects(projects.migrateStats(author, project.id, revisions), /冲突/);
  });
});

test('player and NPC rule editor groups survive draft saves, review, and publication', async () => {
  await withCreatorMysql(async ({ accounts, projects, reviews }) => {
    const author = (await accounts.register('group_writer', 'group-password-1')).account.id;
    const project = await projects.create(author, 'grouped-story', '分组故事');
    const rules = [
      { path: 'player/rules.json', rule: { id: 'explore-once', intent: '探索', trigger: 'automatic', editorGroup: '探索', effects: [] } },
      { path: 'npcs/character/rules.json', rule: { id: 'greeting', intent: '寒暄', trigger: 'semantic', editorGroup: '关系', effects: [] } },
    ];
    for (const { path, rule } of rules) {
      const current = project.sections[path];
      assert.ok(current, `${path} should exist in the new project`);
      await projects.putSection(author, project.id, path, JSON.stringify([rule]), current.revision);
      assert.equal(JSON.parse((await projects.get(author, project.id))!.sections[path].content)[0].editorGroup, rule.editorGroup);
    }
    const submission = await reviews.submit(author, project.id);
    assert.equal(submission.script.playerRules?.[0].editorGroup, '探索');
    assert.equal(submission.script.npcs[0].rules?.[0].editorGroup, '关系');
    const published = (await reviews.approve((await accounts.createAdmin('group_admin', 'admin-password-1')).id, submission.id)).script;
    assert.equal(published.playerRules?.[0].editorGroup, '探索');
    assert.equal((await projects.getPublished(project.id))?.npcs[0].rules?.[0].editorGroup, '关系');
  });
});

test('NPC world book names and types survive draft, review and publication', async () => {
  await withCreatorMysql(async ({ accounts, projects, reviews }) => {
    const author = (await accounts.register('lore_writer', 'lore-password-1')).account.id;
    const project = await projects.create(author, 'lore-story', '世界书故事');
    const path = 'npcs/character/lore.json';
    const lore = [{ id: 'book-one', name: '人物背景', type: 'always', keywords: [], content: '始终记得。' }];
    await projects.putSection(author, project.id, path, JSON.stringify(lore), project.sections[path].revision);
    assert.deepEqual(JSON.parse((await projects.get(author, project.id))!.sections[path].content), lore);
    const submission = await reviews.submit(author, project.id);
    assert.equal(submission.script.npcs[0].lore?.[0].name, '人物背景');
    assert.equal(submission.script.npcs[0].lore?.[0].type, 'always');
    await reviews.approve((await accounts.createAdmin('lore_admin', 'admin-password-1')).id, submission.id);
    assert.deepEqual((await projects.getPublished(project.id))?.npcs[0].lore, lore);
  });
});
