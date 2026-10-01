import 'dotenv/config';
import Database from 'better-sqlite3';
import { readFile, writeFile } from 'node:fs/promises';
import { createCombinedChatAdapter } from '../apps/api/src/ai-adapter.js';
import { deriveChatContext } from '../apps/api/src/chat-service.js';
import { readChatCompletionStream } from '../apps/api/src/ai-stream.js';
import { loadScript } from '../packages/script/src/index.js';
import type { GameState } from '../packages/contracts/src/index.js';
import { summarizeCosts } from '../apps/api/src/ai-cost.js';

if (!process.argv.includes('--live')) throw new Error('此测试会产生四次付费请求，确认后传入 --live');
if (!process.env.AI_API_KEY) throw new Error('缺少AI密钥');
const db = new Database('data/game.sqlite', { readonly: true });
const row = db.prepare('SELECT state_json FROM save_slots WHERE game_id=? AND slot=0 ORDER BY updated_at DESC LIMIT 1')
  .get('sword-and-screen') as { state_json: string } | undefined;
db.close();
if (!row) throw new Error('没有可测试的存档');
const base: GameState = JSON.parse(row.state_json);
const script = loadScript('sword-and-screen');
const runId = `prefix-${Date.now()}`;
const logPath = `data/${runId}.jsonl`;
const realFetch = globalThis.fetch;
const results: object[] = [];
// Both layouts use exactly the same two controlled inputs; neither result is saved.
try {
  for (const promptLayout of ['dynamic', 'fixed-prefix'] as const) {
    let previous = '';
    for (let i = 0; i < 2; i++) {
      const state = structuredClone(base);
      if (i) state.npcIndicators!['su-nian'].affection.value = Number(state.npcIndicators!['su-nian'].affection.value) + 1;
      const text = i ? '我很在意你的感受，如果累了我们就休息一下。' : '这里是哪里？';
      let request = '';
      let captured: Promise<Awaited<ReturnType<typeof readChatCompletionStream>>> | undefined;
      globalThis.fetch = async (url, init) => {
        request = JSON.stringify(JSON.parse(String(init?.body)).messages);
        const response = await realFetch(url, init);
        if (response.ok) captured = readChatCompletionStream(response.clone(), () => {});
        return response;
      };
      let reply: unknown;
      let error: string | undefined;
      const turnId = `${runId}-${promptLayout}-${i}`;
      try {
        reply = await createCombinedChatAdapter({ apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL,
          model: process.env.AI_MODEL, logPath, promptLayout }).generate(deriveChatContext(script, state, script.npcs.find(n => n.id === 'su-nian')!, text, turnId));
      } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
      const raw = captured ? await captured.catch(() => undefined) : undefined;
      let rawShape = 'unavailable';
      if (raw) {
        try { const parsed = JSON.parse(raw.content); rawShape = Array.isArray(parsed) ? 'array' : typeof parsed === 'object' && parsed ? `object:${Object.keys(parsed).join(',')}` : typeof parsed; }
        catch { rawShape = 'not-json'; }
      }
      let sharedPrefixChars = 0;
      while (sharedPrefixChars < previous.length && previous[sharedPrefixChars] === request[sharedPrefixChars]) sharedPrefixChars++;
      const result = { turnId, promptLayout, sample: i, requestChars: request.length,
        sharedPrefixChars: i ? sharedPrefixChars : null, reply, error, rawShape };
      results.push(result);
      console.log(JSON.stringify(result));
      previous = request;
    }
  }
} finally { globalThis.fetch = realFetch; }
const rows = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const costs = summarizeCosts(rows, { input: 0.8, cached: 0.2, output: 1.5 });
await writeFile(`data/${runId}-report.json`, JSON.stringify({ note: '受控快照变化，历史保持相同；费用按此前截图单价估算，非生产存档写入。', results, costs }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ logPath, costs }));
