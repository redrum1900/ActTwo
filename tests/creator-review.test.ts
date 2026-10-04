import test from 'node:test';
import assert from 'node:assert/strict';
import { withCreatorMysql } from './support/creator-mysql.js';

test('submission freezes valid draft and approval alone publishes it', async () => {
  await withCreatorMysql(async ({ accounts, projects, reviews }) => {
    const author = (await accounts.register('writer', 'writer-password-1')).account.id;
    const admin = (await accounts.createAdmin('moderator', 'moderator-pass-1')).id;
    await projects.create(author, 'review-story', '待审版本');
    const submitted = await reviews.submit(author, 'review-story');
    assert.equal(submitted.status, 'pending');
    assert.equal(await projects.getPublished('review-story'), null);
    const manifest = (await projects.get(author, 'review-story'))!.sections['manifest.json'];
    await projects.putSection(author, 'review-story', 'manifest.json', manifest.content.replace('待审版本', '编辑中的草稿'), manifest.revision);
    assert.equal((await reviews.get(submitted.id))?.script.title, '待审版本');
    assert.equal((await reviews.listPending())[0]?.projectTitle, '待审版本');
    await assert.rejects(reviews.submit(author, 'review-story'), /待审/);
    await assert.rejects(reviews.approve(author, submitted.id), /管理员|权限/);
    const approved = await reviews.approve(admin, submitted.id);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.reviewerId, admin);
    assert.equal((await projects.getPublished('review-story'))?.title, '待审版本');
    assert.equal((await reviews.latestForProject(author, 'review-story'))?.status, 'approved');
    await assert.rejects(reviews.approve(admin, submitted.id), /已审核|待审/);
  });
});

test('rejected revision leaves the prior release online and records a reason', async () => {
  await withCreatorMysql(async ({ accounts, projects, reviews }) => {
    const author = (await accounts.register('writer', 'writer-password-1')).account.id;
    const admin = (await accounts.createAdmin('moderator', 'moderator-pass-1')).id;
    await projects.create(author, 'ongoing', '线上旧版');
    await reviews.approve(admin, (await reviews.submit(author, 'ongoing')).id);
    const manifest = (await projects.get(author, 'ongoing'))!.sections['manifest.json'];
    await projects.putSection(author, 'ongoing', 'manifest.json', manifest.content.replace('线上旧版', '准备新版'), manifest.revision);
    const pending = await reviews.submit(author, 'ongoing');
    assert.equal((await projects.getPublished('ongoing'))?.title, '线上旧版');
    await assert.rejects(reviews.reject(admin, pending.id, ''), /原因/);
    const rejected = await reviews.reject(admin, pending.id, '故事信息还不完整');
    assert.equal(rejected.status, 'rejected');
    assert.equal((await reviews.latestForProject(author, 'ongoing'))?.rejectionReason, '故事信息还不完整');
    assert.equal((await projects.getPublished('ongoing'))?.title, '线上旧版');
    await assert.rejects(reviews.reject(admin, pending.id, '再拒绝'), /已审核|待审/);
    assert.equal((await reviews.submit(author, 'ongoing')).status, 'pending');
  });
});

test('deleted pending story cannot be approved and disappears from moderation queue', async () => {
  await withCreatorMysql(async ({ accounts, projects, reviews }) => {
    const author = (await accounts.register('writer', 'writer-password-1')).account.id;
    const admin = (await accounts.createAdmin('moderator', 'moderator-pass-1')).id;
    await projects.create(author, 'removed', '准备下架');
    const submitted = await reviews.submit(author, 'removed');
    assert.equal((await reviews.listPending()).length, 1);
    await projects.delete(author, 'removed');
    assert.deepEqual(await reviews.listPending(), []);
    await assert.rejects(reviews.approve(admin, submitted.id), /已删除|不存在/);
    assert.equal(await projects.getPublished('removed'), null);
  });
});
