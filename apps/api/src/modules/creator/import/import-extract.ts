import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import WordExtractor from 'word-extractor';

const supported = new Set(['.txt', '.md', '.json', '.doc', '.docx']);
const docSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const docxSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function extractImportText(fileName: string, temporaryPath: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase();
  if (!supported.has(extension)) throw new Error('仅支持 TXT、MD、DOC、DOCX 和 JSON 文件');
  let text = '';
  if (extension === '.doc' || extension === '.docx') {
    const handle = await open(temporaryPath, 'r');
    let header: Buffer;
    try {
      header = Buffer.alloc(extension === '.doc' ? docSignature.length : docxSignature.length);
      await handle.read(header, 0, header.length, 0);
    } finally { await handle.close(); }
    if (!(extension === '.doc' ? header.equals(docSignature) : header.equals(docxSignature)))
      throw new Error('Word 文件格式无效或扩展名不匹配');
    try {
      const document = await new WordExtractor().extract(temporaryPath);
      text = document.getBody();
    } catch { throw new Error('无法读取 Word 文件正文'); }
  } else {
    const stream = createReadStream(temporaryPath);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for await (const chunk of stream) {
        const decoded = decoder.decode(chunk as Buffer, { stream: true });
        if (process.memoryUsage().heapUsed + (text.length + decoded.length) * 2 > getHeapStatistics().heap_size_limit * 0.75)
          throw new Error('服务器可用内存不足，无法继续解析当前素材');
        text += decoded;
      }
      text += decoder.decode();
    } catch (error) {
      if (error instanceof Error && error.message.includes('可用内存不足')) throw error;
      throw new Error('文件不是有效的 UTF-8 文本');
    }
    text = text.replace(/^\uFEFF/, '');
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) throw new Error('文件含二进制控制字符，无法作为文本导入');
    if (extension === '.json' && text.trim()) {
      try { JSON.parse(text); }
      catch { throw new Error('JSON 素材格式无效'); }
    }
  }
  if (!text.trim()) throw new Error('文件没有可读取的文字');
  return text;
}
