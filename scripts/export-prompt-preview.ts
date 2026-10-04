import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { createChatAdapter, createCombinedChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { runChat } from '../apps/api/src/modules/gameplay/chat-service.js';
import { loadProbeSource, probeArgument } from './probe-source.js';

const { script, state } = await loadProbeSource(true);
if (!state) throw new Error('没有可预览的存档');
if (!script.npcs.some(npc => npc.id === 'su-nian')) throw new Error('该探针只支持包含 su-nian 的故事');
const text = probeArgument('--text') || '这里是哪里？';
const mode = process.env.AI_CHAT_MODE || 'settled';
const requests: { model: string; messages: { role: string; content: string }[]; [key: string]: unknown }[] = [];
const original = globalThis.fetch;
// Capture request bodies only. No network, authorization headers, logs or save writes.
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  requests.push(body);
  return new Response(JSON.stringify({ choices: [{ message: { content: body.response_format
    ? JSON.stringify({ message: '离线模拟回复', proposedEventIds: [] }) : '离线模拟回复' }, finish_reason: 'stop' }] }));
};
try {
  const factory = mode === 'combined' ? createCombinedChatAdapter : createChatAdapter;
  const adapter = factory({ apiKey: 'offline-placeholder', model: process.env.AI_MODEL || 'Cot-18',
    temperatures: { generate: Number(process.env.AI_TEMPERATURE_GENERATE || 0.7),
      classify: Number(process.env.AI_TEMPERATURE_UTILITY || 0.2) } });
  await runChat(script, state, 'su-nian', text, adapter);
} finally { globalThis.fetch = original; }
const note = '当前存档的离线重建，不是历史请求抓包。玩家本轮发言为预览输入；规则判断模拟为空，因此回复请求展示无事件结算的状态。未调用AI、未修改存档、不含密钥。下方消息正文完整保留。';
await mkdir('data/prompt-preview', { recursive: true });
const prefix = `data/prompt-preview/full-${Date.now()}`;
await writeFile(`${prefix}.json`, JSON.stringify({ note, mode, requests }, null, 2), { mode: 0o600 });
const rendered = [note, `模式：${mode}`, `预览发言：${text}`, ...requests.flatMap((request, index) => [
  `\n========== 请求 ${index + 1} (${request.messages.length}条消息) ==========`,
  `请求参数：${JSON.stringify(Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'messages')))}`,
  ...request.messages.map((message, i) => `\n---------- 消息 ${i + 1} / ${message.role} / ${message.content.length} 字符 ----------\n${message.content}`),
])].join('\n');
await writeFile(`${prefix}.txt`, rendered, { mode: 0o600 });
console.log(JSON.stringify({ files: [`${prefix}.txt`, `${prefix}.json`], requests: requests.map(request => ({ messages: request.messages.length,
  contentChars: request.messages.reduce((sum, message) => sum + message.content.length, 0) })) }));
