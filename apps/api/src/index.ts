import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import express from 'express';
import { createApp } from './app.js';
import { createChatAdapter, createCombinedChatAdapter } from './ai-adapter.js';
import { createMysqlPool } from './db/mysql.js';
import { migrateMysql } from './db/migrations.js';
import { createMysqlSaveStore } from './db/mysql-save-store.js';
import { createMysqlCreatorStore } from './db/mysql-auth-store.js';
import { createMysqlProjectStore } from './db/mysql-project-store.js';
import { createMysqlReviewStore } from './db/mysql-review-store.js';
import { createMysqlCreatorImportStore } from './db/mysql-creator-import.js';
import { readAiFallbacks } from './ai-config.js';
import { createMysqlAiAuditStore } from './db/mysql-ai-audit-store.js';
import { createMysqlPlaytestStore } from './db/mysql-playtest-store.js';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: path.join(projectRoot, '.env') });
const dataDir = path.join(projectRoot, 'data');
mkdirSync(dataDir, { recursive: true });
const numberEnv = (name: string, fallback: number, min: number, max: number, integer = false) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    throw new Error(`${name} 必须是 ${min}–${max} 之间的${integer ? '整数' : '数字'}`);
  return value;
};
const pool = createMysqlPool(process.env);
await migrateMysql(pool);
const store = createMysqlSaveStore(pool);
const creatorStore = createMysqlCreatorStore(pool);
const projectStore = createMysqlProjectStore(pool);
const reviewStore = createMysqlReviewStore(pool, projectStore);
const importStore = createMysqlCreatorImportStore(pool);
const auditStore = createMysqlAiAuditStore(pool);
const playtestStore = createMysqlPlaytestStore(pool);
void auditStore.expireDetails(new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()).catch(() => {});
await importStore.recoverInterrupted();
setInterval(() => { void importStore.expireOldReady().catch(() => {}); }, 60 * 60 * 1000).unref();
setInterval(() => { void auditStore.expireDetails(new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()).catch(() => {}); }, 24 * 60 * 60 * 1000).unref();
const utilityTemperature = numberEnv('AI_TEMPERATURE_UTILITY', 0.2, 0, 2);
const chatMode = process.env.AI_CHAT_MODE || 'settled';
if (!['combined', 'settled'].includes(chatMode)) throw new Error('AI_CHAT_MODE 必须为 combined 或 settled');
const adapter = (chatMode === 'combined' ? createCombinedChatAdapter : createChatAdapter)({
  apiKey: process.env.AI_API_KEY,
  baseUrl: process.env.AI_BASE_URL,
  model: process.env.AI_MODEL,
  fallbacks: readAiFallbacks(process.env),
  logPath: process.env.AI_REQUEST_LOG_PATH || path.join(dataDir, 'ai-requests.jsonl'),
  auditSink: auditStore,
  streamUsage: process.env.AI_STREAM_USAGE === '1',
  temperatures: { generate: numberEnv('AI_TEMPERATURE_GENERATE', 0.7, 0, 2),
    classify: utilityTemperature, rewrite: utilityTemperature, summarize: utilityTemperature },
});
const app = createApp(store, adapter, { debugEnabled: process.env.NODE_ENV !== 'production' && process.env.GAME_DEV_DEBUG === '1',
  creatorStore, projectStore, reviewStore, mysqlPool: pool, importStore, auditStore, playtestStore });
if (process.env.NODE_ENV === 'production') {
  const webDir = path.join(projectRoot, 'dist/web');
  app.use(express.static(webDir));
  app.get(/^\/creator(?:\/.*)?$/, (_req, res) => res.type('html').send(readFileSync(path.join(webDir, 'index.html'))));
  app.get(/^\/games(?:\/.*)?$/, (_req, res) => res.type('html').send(readFileSync(path.join(webDir, 'index.html'))));
  app.get(/^\/playtest(?:\/.*)?$/, (_req, res) => res.type('html').send(readFileSync(path.join(webDir, 'index.html'))));
  app.get(/^\/usage\/?$/, (_req, res) => res.type('html').send(readFileSync(path.join(webDir, 'index.html'))));
}
const port = Number(process.env.PORT || 3001);
const host = process.env.GAME_API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
app.listen(port, host, () => console.log(`Game DD API listening on http://${host}:${port} (${adapter.mode})`));
