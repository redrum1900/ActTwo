import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportStorySource } from '../apps/web/src/creator/ImportStoryModal.js';

test('import dialog offers supported files, pasted text, and no byte-size cap copy', () => {
  const html = renderToStaticMarkup(createElement(ImportStorySource, {
    file: null, source: '', onFile: () => {}, onSource: () => {},
  }));
  assert.match(html, /小说正文、角色卡/);
  assert.match(html, /\.txt,\.md,\.doc,\.docx,\.json/);
  assert.match(html, /粘贴文本/);
  assert.doesNotMatch(html, /字节上限|文件过大/);
});
