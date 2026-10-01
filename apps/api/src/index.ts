import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { createSaveStore } from './save-store.js';
import { createChatAdapter, createCombinedChatAdapter } from './ai-adapter.js';

const dataDir = path.resolve(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });
const numberEnv = (name: string, fallback: number, min: number, max: number, integer = false) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    throw new Error(`${name} 必须是 ${min}–${max} 之间的${integer ? '整数' : '数字'}`);
  return value;
};
const store = createSaveStore(path.join(dataDir, 'game.sqlite'));
const utilityTemperature = numberEnv('AI_TEMPERATURE_UTILITY', 0.2, 0, 2);
const chatMode = process.env.AI_CHAT_MODE || 'settled';
if (!['combined', 'settled'].includes(chatMode)) throw new Error('AI_CHAT_MODE 必须为 combined 或 settled');
const adapter = (chatMode === 'combined' ? createCombinedChatAdapter : createChatAdapter)({
  apiKey: process.env.AI_API_KEY,
  baseUrl: process.env.AI_BASE_URL,
  model: process.env.AI_MODEL,
  logPath: process.env.AI_REQUEST_LOG_PATH || path.join(dataDir, 'ai-requests.jsonl'),
  temperatures: { generate: numberEnv('AI_TEMPERATURE_GENERATE', 0.7, 0, 2),
    classify: utilityTemperature, rewrite: utilityTemperature, summarize: utilityTemperature },
});
const app = createApp(store, adapter, { debugEnabled: process.env.NODE_ENV !== 'production' && process.env.GAME_DEV_DEBUG === '1' });
if (process.env.NODE_ENV === 'production') app.use(express.static(path.resolve(process.cwd(), 'dist/web')));
const port = Number(process.env.PORT || 3001);
const host = process.env.GAME_API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
app.listen(port, host, () => console.log(`Game DD API listening on http://${host}:${port} (${adapter.mode})`));
