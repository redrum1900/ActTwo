import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { AiAuditSink, AiCallRecord } from '../ai/ai-audit.js';
import { withTransaction } from './mysql.js';

export interface AiAuditFilters {
  accountId?: string;
  storyId?: string;
  source?: AiCallRecord['source'];
  model?: string;
  purpose?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

interface DetailRow extends RowDataPacket {
  playtest_deleted?: number;
  story_title?: string | null;
  id: string; account_id: string | null; source: AiCallRecord['source']; story_id: string | null;
  playtest_id: string | null; release_version: string | null; operation_id: string; purpose: string;
  model: string; provider_index: number; started_at: string; duration_ms: number; http_status: number | null;
  outcome: string; input_tokens: number | null; output_tokens: number | null;
  cache_write_tokens: number | null; cache_read_tokens: number | null;
}

function detail(row: DetailRow): AiCallRecord {
  return { id: row.id, accountId: row.account_id, source: row.source, storyId: row.story_id,
    storyTitle: row.story_title ?? null,
    playtestDeleted: !!row.playtest_deleted,
    playtestId: row.playtest_id ?? undefined, releaseVersion: row.release_version ?? undefined,
    operationId: row.operation_id, purpose: row.purpose, model: row.model, providerIndex: row.provider_index,
    startedAt: row.started_at, durationMs: row.duration_ms, httpStatus: row.http_status, outcome: row.outcome,
    inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    cacheWriteTokens: row.cache_write_tokens, cacheReadTokens: row.cache_read_tokens };
}

function conditions(filters: AiAuditFilters, own?: string) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (sql: string, value: string) => { where.push(sql); params.push(value); };
  if (own !== undefined) add('account_id=?', own);
  else if (filters.accountId) add('account_id=?', filters.accountId);
  if (filters.storyId) add('story_id=?', filters.storyId);
  if (filters.source) add('source=?', filters.source);
  if (filters.model) add('model=?', filters.model);
  if (filters.purpose) add('purpose=?', filters.purpose);
  if (filters.from) add('started_at>=?', `${filters.from}-01T00:00:00.000Z`);
  if (filters.to) {
    const [year, month] = filters.to.split('-').map(Number);
    add('started_at<?', new Date(Date.UTC(year, month, 1)).toISOString());
  }
  if (filters.cursor) {
    try {
      const value = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString('utf8')) as [string, string];
      if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string') {
        where.push('(started_at<? OR (started_at=? AND ai_call_records.id<?))'); params.push(value[0], value[0], value[1]);
      }
    } catch { /* Invalid cursors start at the newest row. */ }
  }
  return { where: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

export function createMysqlAiAuditStore(pool: Pool): AiAuditSink & {
  listOwn(accountId: string, filters?: AiAuditFilters): Promise<{ rows: AiCallRecord[]; nextCursor: string | null }>;
  listAll(filters?: AiAuditFilters): Promise<{ rows: AiCallRecord[]; nextCursor: string | null }>;
  summarizeOwn(accountId: string, filters?: AiAuditFilters): Promise<RowDataPacket[]>;
  summarizeAll(filters?: AiAuditFilters): Promise<RowDataPacket[]>;
  expireDetails(cutoff: string): Promise<void>;
  eraseAccount(accountId: string): Promise<void>;
} {
  const list = async (filters: AiAuditFilters, own?: string) => {
    const { where, params } = conditions(filters, own);
    const limit = Math.min(100, Math.max(1, Math.trunc(filters.limit ?? 30)));
    const [rows] = await pool.execute<DetailRow[]>(`SELECT ai_call_records.*, creator_projects.title AS story_title,
      (playtest_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM creator_playtests WHERE id=ai_call_records.playtest_id)) AS playtest_deleted
      FROM ai_call_records LEFT JOIN creator_projects ON creator_projects.id=ai_call_records.story_id
      ${where} ORDER BY started_at DESC,ai_call_records.id DESC LIMIT ?`, [...params, limit + 1]);
    const page = rows.slice(0, limit).map(detail);
    const last = page.at(-1);
    return { rows: page, nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify([last.startedAt, last.id])).toString('base64url') : null };
  };
  const summarize = async (filters: AiAuditFilters, own?: string) => {
    const where: string[] = [];
    const params: string[] = [];
    if (own !== undefined) { where.push('account_key=?'); params.push(own); }
    else if (filters.accountId) { where.push('account_key=?'); params.push(filters.accountId); }
    if (filters.storyId) { where.push('story_key=?'); params.push(filters.storyId); }
    if (filters.source) { where.push('source=?'); params.push(filters.source); }
    if (filters.model) { where.push('model=?'); params.push(filters.model); }
    if (filters.purpose) { where.push('purpose=?'); params.push(filters.purpose); }
    if (filters.from) { where.push('month>=?'); params.push(filters.from.slice(0, 7)); }
    if (filters.to) { where.push('month<=?'); params.push(filters.to.slice(0, 7)); }
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT * FROM ai_call_monthly${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY month DESC,account_key,story_key`, params);
    return rows;
  };
  return {
    async record(row) {
      await withTransaction(pool, async connection => {
        await connection.execute(`INSERT INTO ai_call_records
          (id,account_id,source,story_id,playtest_id,release_version,operation_id,purpose,model,provider_index,
           started_at,duration_ms,http_status,outcome,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [row.id, row.accountId, row.source, row.storyId,
          row.playtestId ?? null, row.releaseVersion ?? null, row.operationId, row.purpose, row.model,
          row.providerIndex, row.startedAt, row.durationMs, row.httpStatus, row.outcome,
          row.inputTokens, row.outputTokens, row.cacheWriteTokens, row.cacheReadTokens]);
        const known = (value: number | null) => Number(value !== null);
        await connection.execute(`INSERT INTO ai_call_monthly
          (month,account_key,source,story_key,model,purpose,calls,success_calls,input_tokens,output_tokens,
           cache_write_tokens,cache_read_tokens,input_known,output_known,cache_write_known,cache_read_known,cache_hit_calls)
          VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
           calls=calls+1,success_calls=success_calls+VALUES(success_calls),
           input_tokens=input_tokens+VALUES(input_tokens),output_tokens=output_tokens+VALUES(output_tokens),
           cache_write_tokens=cache_write_tokens+VALUES(cache_write_tokens),cache_read_tokens=cache_read_tokens+VALUES(cache_read_tokens),
           input_known=input_known+VALUES(input_known),output_known=output_known+VALUES(output_known),
           cache_write_known=cache_write_known+VALUES(cache_write_known),cache_read_known=cache_read_known+VALUES(cache_read_known),
           cache_hit_calls=cache_hit_calls+VALUES(cache_hit_calls)`, [row.startedAt.slice(0, 7), row.accountId ?? '', row.source,
          row.storyId ?? '', row.model, row.purpose, Number(row.outcome === 'success'), row.inputTokens ?? 0,
          row.outputTokens ?? 0, row.cacheWriteTokens ?? 0, row.cacheReadTokens ?? 0,
          known(row.inputTokens), known(row.outputTokens), known(row.cacheWriteTokens), known(row.cacheReadTokens),
          Number((row.cacheReadTokens ?? 0) > 0)]);
      });
    },
    listOwn: (accountId, filters = {}) => list(filters, accountId),
    listAll: (filters = {}) => list(filters),
    summarizeOwn: (accountId, filters = {}) => summarize(filters, accountId),
    summarizeAll: (filters = {}) => summarize(filters),
    async expireDetails(cutoff) { await pool.execute('DELETE FROM ai_call_records WHERE started_at<?', [cutoff]); },
    async eraseAccount(accountId) {
      await withTransaction(pool, async connection => {
        await connection.execute('DELETE FROM ai_call_records WHERE account_id=?', [accountId]);
        await connection.execute('DELETE FROM ai_call_monthly WHERE account_key=?', [accountId]);
      });
    },
  };
}

export type MysqlAiAuditStore = ReturnType<typeof createMysqlAiAuditStore>;
