import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../apps/api/src/app.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';
import { createReviewStore } from '../apps/api/src/creator/review-store.js';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlW37YAAAAASUVORK5CYII=', 'base64');

test('cover upload is owned, format checked, and public only after publication', async () => {
  const coversDir = mkdtempSync(path.join(tmpdir(), 'game-dd-covers-'));
  const accounts = createCreatorStore(':memory:');
  const projects = createProjectStore(accounts.db);
  const reviews = createReviewStore(accounts.db, projects);
  const saves = createSaveStore(':memory:');
  const author = accounts.register('coverauthor', 'author-password-1');
  const other = accounts.register('coverother', 'other-password-1');
  const admin = accounts.createAdmin('coveradmin', 'admin-password-1');
  const project = projects.create(author.account.id, 'cover-story', '封面故事');
  const server = createApp(saves, createChatAdapter({}), { creatorStore: accounts, projectStore: projects, reviewStore: reviews, coversDir }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = async (username: string, password: string) => {
    const response = await fetch(`${base}/api/creator/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  try {
    const authorCookie = await login('coverauthor', 'author-password-1');
    const otherCookie = await login('coverother', 'other-password-1');
    const upload = async (cookie: string, bytes: Buffer, type = 'image/png') => fetch(`${base}/api/creator/projects/${project.id}/cover`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': type }, body: bytes as unknown as BodyInit });
    assert.equal((await upload(authorCookie, Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
    assert.equal((await upload(authorCookie, Buffer.from('not-png'))).status, 415);
    assert.equal((await upload(otherCookie, tinyPng)).status, 404);
    const uploaded = await upload(authorCookie, tinyPng);
    assert.equal(uploaded.status, 201);
    const { cover } = await uploaded.json() as { cover: string };
    assert.match(cover, /^\/api\/covers\/[0-9a-f-]{36}$/);
    const assetId = cover.split('/').at(-1)!;
    assert.equal((await fetch(`${base}${cover}`)).status, 404);
    assert.equal((await fetch(`${base}/api/creator/projects/${project.id}/covers/${assetId}`)).status, 401);
    assert.equal((await fetch(`${base}/api/creator/projects/${project.id}/covers/${assetId}`, { headers: { Cookie: otherCookie } })).status, 404);
    const preview = await fetch(`${base}/api/creator/projects/${project.id}/covers/${assetId}`, { headers: { Cookie: authorCookie } });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
    const manifest = JSON.parse(project.sections['manifest.json'].content);
    projects.putSection(author.account.id, project.id, 'manifest.json', JSON.stringify({ ...manifest, cover }), 1);
    const review = reviews.submit(author.account.id, project.id);
    reviews.approve(admin.id, review.id);
    const publicImage = await fetch(`${base}${cover}`);
    assert.equal(publicImage.status, 200);
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), tinyPng);
    assert.equal((await upload(authorCookie, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  } finally { server.close(); accounts.close(); saves.close(); rmSync(coversDir, { recursive: true, force: true }); }
});

test('item image stays private until approved and cannot be referenced across projects', async () => {
  const coversDir = mkdtempSync(path.join(tmpdir(), 'game-dd-item-images-'));
  const accounts = createCreatorStore(':memory:');
  const projects = createProjectStore(accounts.db);
  const reviews = createReviewStore(accounts.db, projects);
  const saves = createSaveStore(':memory:');
  const author = accounts.register('itemauthor', 'author-password-1');
  const other = accounts.register('itemother', 'other-password-1');
  const admin = accounts.createAdmin('itemadmin', 'admin-password-1');
  const project = projects.create(author.account.id, 'item-story', '道具故事');
  const otherProject = projects.create(other.account.id, 'other-item-story', '别人的故事');
  const server = createApp(saves, createChatAdapter({}), { creatorStore: accounts, projectStore: projects, reviewStore: reviews, coversDir }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = async (username: string, password: string) => {
    const response = await fetch(`${base}/api/creator/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }) });
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  try {
    const cookie = await login('itemauthor', 'author-password-1');
    const otherCookie = await login('itemother', 'other-password-1');
    const upload = (bytes: Buffer, mime = 'image/png', auth = cookie) => fetch(`${base}/api/creator/projects/${project.id}/item-image`, {
      method: 'POST', headers: { Cookie: auth, 'Content-Type': mime }, body: bytes as unknown as BodyInit });
    assert.equal((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
    assert.equal((await upload(Buffer.from('not-png'))).status, 415);
    assert.equal((await upload(tinyPng, 'image/png', otherCookie)).status, 404);
    const response = await upload(tinyPng);
    assert.equal(response.status, 201);
    const { image } = await response.json() as { image: string };
    assert.match(image, /^\/api\/item-images\/[0-9a-f-]{36}$/);
    const id = image.split('/').at(-1)!;
    assert.equal((await fetch(`${base}${image}`)).status, 404);
    assert.equal((await fetch(`${base}/api/creator/projects/${project.id}/item-images/${id}`)).status, 401);
    assert.equal((await fetch(`${base}/api/creator/projects/${project.id}/item-images/${id}`, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/creator/projects/${project.id}/item-images/${id}`, { headers: { Cookie: cookie } })).status, 200);
    const otherItems = otherProject.sections['items.json'];
    projects.putSection(other.account.id, otherProject.id, 'items.json', JSON.stringify([{ id: 'stolen', name: '偷来的图', image }]), otherItems.revision);
    assert.ok(projects.validate(other.account.id, otherProject.id).errors.some(issue => issue.message.includes('图片')));
    const items = project.sections['items.json'];
    projects.putSection(author.account.id, project.id, 'items.json', JSON.stringify([{ id: 'photo', name: '照片', description: '', image }]), items.revision);
    assert.equal((await fetch(`${base}/api/creator/projects/${project.id}/item-images/${id}`, { method: 'DELETE', headers: { Cookie: cookie } })).status, 409);
    const review = reviews.submit(author.account.id, project.id);
    reviews.approve(admin.id, review.id);
    const publicImage = await fetch(`${base}${image}`);
    assert.equal(publicImage.status, 200);
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), tinyPng);
    assert.equal((await fetch(`${base}/api/creator/projects/${project.id}/item-images/${id}`, { method: 'DELETE', headers: { Cookie: cookie } })).status, 409);
  } finally { server.close(); accounts.close(); saves.close(); rmSync(coversDir, { recursive: true, force: true }); }
});
