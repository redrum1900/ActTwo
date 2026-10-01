import 'dotenv/config';
import Database from 'better-sqlite3';
import { writeFile, readFile } from 'node:fs/promises';
import { createChatAdapter, createCombinedChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createMemoryWorker } from '../apps/api/src/memory-worker.js';
import { selectMemory } from '../apps/api/src/memory-policy.js';
import { runChat } from '../apps/api/src/chat-service.js';
import { loadScript } from '../packages/script/src/index.js';
import { summarizeCosts } from '../apps/api/src/ai-cost.js';
import type { GameState } from '../packages/contracts/src/index.js';
import { createInitialState } from '../packages/engine/src/index.js';

if (!process.argv.includes('--live')) throw new Error('会执行10轮付费对话及必要摘要，确认后使用 --live');
if (!process.env.AI_API_KEY) throw new Error('未配置AI密钥');
const script = loadScript('sword-and-screen');
const fresh = process.argv.includes('--fresh');
let source: GameState;
if (fresh) {
  source = createInitialState(script, { name: '阿言' });
} else {
const db = new Database('data/game.sqlite', { readonly: true });
const row = db.prepare('SELECT state_json FROM save_slots WHERE game_id=? AND slot=0 ORDER BY updated_at DESC LIMIT 1')
  .get('sword-and-screen') as { state_json: string } | undefined;
db.close();
if (!row) throw new Error('没有长存档');
source = JSON.parse(row.state_json);
}
const runId = `${fresh ? 'fresh' : 'memory'}-10-${Date.now()}`;
const logPath = `data/${runId}.jsonl`;
const reportPath = `data/${runId}-report.json`;
const mode = process.env.AI_CHAT_MODE || 'settled';
const utility = Number(process.env.AI_TEMPERATURE_UTILITY || 0.2);
const adapter = (mode === 'combined' ? createCombinedChatAdapter : createChatAdapter)({
  apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL, model: process.env.AI_MODEL,
  logPath, temperatures: { generate: Number(process.env.AI_TEMPERATURE_GENERATE || 0.7), classify: utility, summarize: utility, rewrite: utility },
});
const savePath = fresh ? `data/${runId}.sqlite` : ':memory:';
const store = createSaveStore(savePath);
store.putAuto(runId, script.id, source);
const worker = createMemoryWorker(store, adapter);
const prompts = [
  '这里是哪里？',
  '记住一个小习惯：我不喝咖啡，喜欢无糖乌龙茶。',
  '我很在意你的感受，如果你今天累了，我们可以慢慢聊，不用勉强。',
  '明天如果有空，我们可以一起去书店。不过现在只是提议，还没有约定时间。',
  '我不会擅自碰你的东西，想看什么都会先征求你的同意。',
  '我刚才说喜欢什么饮料？',
  '我们现在在哪里，是面对面还是线上聊天？',
  '书店的事情先别当作定好了，等我们确认时间再说。',
  '你还记得我说不喝什么吗？',
  '简单回顾一下我的饮料偏好，以及书店的安排现在有没有确定；不确定的不要编。',
];
const results: any[] = [];
function metrics(state: GameState) {
  const history = state.chats['su-nian'] ?? [];
  const selected = selectMemory(history, state.memorySegments['su-nian'] ?? []);
  return { historyMessages: history.length, historyChars: history.reduce((n, m) => n + m.text.length, 0),
    sentHistoryChars: selected.raw.reduce((n, m) => n + m.text.length, 0) + selected.summary.length,
    summaryChars: selected.summary.length, segments: state.memorySegments['su-nian']?.length ?? 0,
    affection: state.npcIndicators?.['su-nian'].affection.value, location: state.locationId, npcLocation: state.npcLocations?.['su-nian'],
    memoryStatus: state.memoryCompression?.['su-nian'] };
}
const initial = metrics(source);
console.log(JSON.stringify({ runId, model: process.env.AI_MODEL, mode, initial, reportPath, logPath, savePath }));
try {
  for (let index = 0; index < prompts.length; index++) {
    const turnId = `${runId}-${index + 1}`;
    const saved = store.getAuto(runId, script.id)!;
    const before = metrics(saved.state);
    const started = Date.now();
    let output: any;
    let firstDraftMs: number | null = null;
    try {
      const result = await runChat(script, saved.state, 'su-nian', prompts[index], adapter, {
        turnId, onDraft: () => { firstDraftMs ??= Date.now() - started; },
      });
      const replyMs = Date.now() - started;
      const updated = store.updateAutoWithGallery(runId, script.id, saved.revision, result.state);
      await worker(runId, script, updated, 'su-nian');
      const after = store.getAuto(runId, script.id)!;
      output = { round: index + 1, turnId, playerMessage: prompts[index], success: true, firstDraftMs, replyMs,
        totalWithMemoryMs: Date.now() - started, reply: result.reply, appliedEvents: result.appliedEvents,
        diagnostics: result.state.ruleDiagnostics?.at(-1), before, after: metrics(after.state),
        memory: selectMemory(after.state.chats['su-nian'], after.state.memorySegments['su-nian'] ?? []).document };
    } catch (error) {
      output = { round: index + 1, turnId, playerMessage: prompts[index], success: false,
        error: error instanceof Error ? error.message : String(error), totalWithMemoryMs: Date.now() - started,
        before, after: metrics(store.getAuto(runId, script.id)!.state) };
    }
    results.push(output);
    await writeFile(reportPath, JSON.stringify({ runId, model: process.env.AI_MODEL, mode, initial,
      savePath, note: fresh ? '从初始状态创建独立测试存档，不读写正式存档；费用按此前截图单价估算。' : '只读真实数据库，全部游戏更新写入内存数据库；每轮等待后台摘要后再继续。费用按此前截图单价估算。', results }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ round: output.round, success: output.success, reply: output.reply,
      error: output.error, appliedEvents: output.appliedEvents, after: output.after }));
  }
  const rows = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const costs = summarizeCosts(rows, { input: 0.8, cached: 0.2, output: 1.5 });
  const total = costs.reduce((sum, turn) => sum + turn.estimatedUsd, 0);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const costSummary = { totalUsd: total, averagePerAttemptUsd: total / prompts.length,
    successfulTurns: results.filter(r => r.success).length, requests: rows.length,
    byPurpose: Object.fromEntries(['generate', 'classify', 'summarize', 'rewrite'].map(purpose => [purpose, {
      calls: rows.filter(row => row.purpose === purpose).length,
      estimatedUsd: summarizeCosts(rows.filter(row => row.purpose === purpose), { input: 0.8, cached: 0.2, output: 1.5 }).reduce((sum, turn) => sum + turn.estimatedUsd, 0),
    }])) };
  await writeFile(reportPath, JSON.stringify({ ...report, costs, costSummary }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, costs, costSummary }));
} finally { store.close(); }
