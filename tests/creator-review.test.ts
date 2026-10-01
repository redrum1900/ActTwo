import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';
import { createReviewStore } from '../apps/api/src/creator/review-store.js';

test('submission freezes valid draft and approval alone publishes it', () => {
  const accounts = createCreatorStore(':memory:');
  const projects = createProjectStore(accounts.db);
  const reviews = createReviewStore(accounts.db, projects);
  try {
    const author = accounts.register('writer', 'writer-password-1').account.id;
    const admin = accounts.createAdmin('moderator', 'moderator-pass-1').id;
    projects.create(author, 'review-story', '待审版本');
    const submitted = reviews.submit(author, 'review-story');
    assert.equal(submitted.status, 'pending');
    assert.equal(projects.getPublished('review-story'), null);
    const manifest = projects.get(author, 'review-story')!.sections['manifest.json'];
    projects.putSection(author, 'review-story', 'manifest.json', manifest.content.replace('待审版本', '编辑中的草稿'), manifest.revision);
    assert.equal(reviews.get(submitted.id)?.script.title, '待审版本');
    assert.equal(reviews.listPending()[0]?.projectTitle, '待审版本');
    assert.throws(() => reviews.submit(author, 'review-story'), /待审/);
    assert.throws(() => reviews.approve(author, submitted.id), /管理员|权限/);
    const approved = reviews.approve(admin, submitted.id);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.reviewerId, admin);
    assert.equal(projects.getPublished('review-story')?.title, '待审版本');
    assert.equal(reviews.latestForProject(author, 'review-story')?.status, 'approved');
    assert.throws(() => reviews.approve(admin, submitted.id), /已审核|待审/);
  } finally { accounts.close(); }
});

test('rejected revision leaves the prior release online and records a reason', () => {
  const accounts = createCreatorStore(':memory:');
  const projects = createProjectStore(accounts.db);
  const reviews = createReviewStore(accounts.db, projects);
  try {
    const author = accounts.register('writer', 'writer-password-1').account.id;
    const admin = accounts.createAdmin('moderator', 'moderator-pass-1').id;
    projects.create(author, 'ongoing', '线上旧版');
    reviews.approve(admin, reviews.submit(author, 'ongoing').id);
    const manifest = projects.get(author, 'ongoing')!.sections['manifest.json'];
    projects.putSection(author, 'ongoing', 'manifest.json', manifest.content.replace('线上旧版', '准备新版'), manifest.revision);
    const pending = reviews.submit(author, 'ongoing');
    assert.equal(projects.getPublished('ongoing')?.title, '线上旧版');
    assert.throws(() => reviews.reject(admin, pending.id, ''), /原因/);
    const rejected = reviews.reject(admin, pending.id, '故事信息还不完整');
    assert.equal(rejected.status, 'rejected');
    assert.equal(reviews.latestForProject(author, 'ongoing')?.rejectionReason, '故事信息还不完整');
    assert.equal(projects.getPublished('ongoing')?.title, '线上旧版');
    assert.throws(() => reviews.reject(admin, pending.id, '再拒绝'), /已审核|待审/);
    assert.equal(reviews.submit(author, 'ongoing').status, 'pending');
  } finally { accounts.close(); }
});

test('deleted pending story cannot be approved and disappears from moderation queue', () => {
  const accounts = createCreatorStore(':memory:');
  const projects = createProjectStore(accounts.db);
  const reviews = createReviewStore(accounts.db, projects);
  try {
    const author = accounts.register('writer', 'writer-password-1').account.id;
    const admin = accounts.createAdmin('moderator', 'moderator-pass-1').id;
    projects.create(author, 'removed', '准备下架');
    const submitted = reviews.submit(author, 'removed');
    assert.equal(reviews.listPending().length, 1);
    projects.delete(author, 'removed');
    assert.deepEqual(reviews.listPending(), []);
    assert.throws(() => reviews.approve(admin, submitted.id), /已删除|不存在/);
    assert.equal(projects.getPublished('removed'), null);
  } finally { accounts.close(); }
});
