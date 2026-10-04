import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractImportText } from '../apps/api/src/modules/creator/import/import-extract.js';

async function withSource(name: string, bytes: Buffer, run: (file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'game-import-test-'));
  const file = path.join(directory, name);
  try {
    await writeFile(file, bytes);
    await run(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('plain text strips UTF-8 BOM without changing the story', async () => {
  await withSource('card.txt', Buffer.from('\uFEFF林秋经营一家书店。'), async file => {
    assert.equal(await extractImportText('card.txt', file), '林秋经营一家书店。');
  });
});

test('Markdown and JSON cards remain source material', async () => {
  await withSource('novel.md', Buffer.from('# 第一章\n旧钥匙'), async file => {
    assert.equal(await extractImportText('novel.md', file), '# 第一章\n旧钥匙');
  });
  await withSource('card.json', Buffer.from('{"name":"林秋"}'), async file => {
    assert.equal(await extractImportText('card.json', file), '{"name":"林秋"}');
  });
});

test('empty text and invalid Word signature are rejected before AI', async () => {
  await withSource('empty.txt', Buffer.from(' \n '), async file => {
    await assert.rejects(extractImportText('empty.txt', file), /没有可读取的文字/);
  });
  await withSource('fake.doc', Buffer.from('not a Word file'), async file => {
    await assert.rejects(extractImportText('fake.doc', file), /Word 文件格式无效/);
  });
});

test('renamed binary and malformed UTF-8 text never reach the model', async () => {
  await withSource('fake.txt', Buffer.from([0x00, 0x01, 0x02, 0x03]), async file => {
    await assert.rejects(extractImportText('fake.txt', file), /不是有效的 UTF-8 文本|二进制/);
  });
  await withSource('invalid.md', Buffer.from([0xff, 0xfe, 0x61]), async file => {
    await assert.rejects(extractImportText('invalid.md', file), /不是有效的 UTF-8 文本/);
  });
});

test('a large text file is not rejected by a preset byte cap', async () => {
  const source = '角色卡段落。'.repeat(200_000);
  await withSource('long.txt', Buffer.from(source), async file => {
    assert.equal((await extractImportText('long.txt', file)).length, source.length);
  });
});

test('legacy DOC and DOCX expose their body text without embedded markup', async () => {
  for (const extension of ['doc', 'docx']) {
    const file = path.join('tests', 'fixtures', `import-card.${extension}`);
    assert.match(await extractImportText(`card.${extension}`, file), /林秋在旧书店里保管一把钥匙/);
  }
});
