import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { summarizeCosts } from '../apps/api/src/infrastructure/ai/ai-cost.js';

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} 必须为非负数`);
  return value;
};
const rates = { input: number('AI_PRICE_INPUT_PER_M', 0.8), cached: number('AI_PRICE_CACHED_PER_M', 0.2),
  output: number('AI_PRICE_OUTPUT_PER_M', 1.5) };
const rows = (await readFile(process.argv[2] || process.env.AI_REQUEST_LOG_PATH || 'data/ai-requests.jsonl', 'utf8'))
  .split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { console.warn('跳过一条不完整的日志'); return []; }
  });
const turns = summarizeCosts(rows, rates).slice(-10);
console.log('最近10轮；美元估算，默认单价来自此前平台截图，请以实际账单为准。', rates);
console.table(turns.map(turn => ({ turn: turn.turnId, calls: turn.calls, purposes: turn.purposes.join(' → '),
  cached: turn.cachedTokens, uncached: turn.uncachedTokens, output: turn.outputTokens,
  estimatedUSD: turn.estimatedUsd.toFixed(6), unknownUsage: turn.unknownUsageCalls, unknownCache: turn.unknownCacheCalls })));
console.log('unknownUsage > 0 表示费用不完整；unknownCache > 0 的请求暂按输入全价估算，不等于零缓存。');
