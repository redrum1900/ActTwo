import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreatorAuthView } from '../apps/web/src/creator/app/CreatorAuthView.js';
import { CreatorLibraryView } from '../apps/web/src/creator/app/CreatorLibraryView.js';

test('creator account and story list remain distinct entry views', () => {
  const auth = renderToStaticMarkup(createElement(CreatorAuthView, {
    authMode: 'login', username: '', password: '', message: '', onAuthenticate: () => {},
    onUsernameChange: () => {}, onPasswordChange: () => {}, onToggleAuthMode: () => {},
  }));
  assert.match(auth, /登录创作中心/);
  assert.match(auth, /创建角色、地点和规则/);

  const library = renderToStaticMarkup(createElement(CreatorLibraryView, {
    username: 'author', projects: [{ id: 'story-a', title: '雨夜来信', subtitle: '一场重逢', createdAt: '', updatedAt: '2026-10-03',
      publishedAt: null, review: null }], message: '', showCreate: false, newTitle: '', templateId: '', templates: [],
    onPrepareCreate: () => {}, onCloseCreate: () => {}, onCreate: () => {}, onNewTitleChange: () => {},
    onTemplateIdChange: () => {}, onOpenProject: () => {},
  }));
  assert.match(library, /我的故事/);
  assert.match(library, /雨夜来信/);
  assert.match(library, /一场重逢/);
  assert.doesNotMatch(library, /登录创作中心/);
});
