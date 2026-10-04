import { randomUUID } from 'node:crypto';

export interface AiAttribution {
  accountId: string | null;
  source: 'formal' | 'playtest' | 'import' | 'system';
  storyId: string | null;
  playtestId?: string;
  releaseVersion?: string;
  operationId: string;
}

export interface AiCallRecord extends AiAttribution {
  id: string;
  storyTitle?: string | null;
  playtestDeleted?: boolean;
  purpose: string;
  model: string;
  providerIndex: number;
  startedAt: string;
  durationMs: number;
  httpStatus: number | null;
  outcome: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
}

export interface AiAuditSink { record(row: AiCallRecord): Promise<void> }

type RecordInput = AiAttribution & Pick<AiCallRecord, 'purpose' | 'model' | 'providerIndex' | 'startedAt' | 'durationMs' | 'httpStatus' | 'outcome'> &
  Partial<Pick<AiCallRecord, 'inputTokens' | 'outputTokens' | 'cacheWriteTokens' | 'cacheReadTokens'>>;

function tokenCount(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : null;
}

export function aiCallRecord(input: RecordInput): AiCallRecord {
  return {
    id: randomUUID(), accountId: input.accountId, source: input.source, storyId: input.storyId,
    playtestId: input.playtestId, releaseVersion: input.releaseVersion, operationId: input.operationId,
    purpose: input.purpose, model: input.model, providerIndex: input.providerIndex,
    startedAt: input.startedAt, durationMs: Math.max(0, Math.round(input.durationMs)),
    httpStatus: input.httpStatus, outcome: input.outcome,
    inputTokens: tokenCount(input.inputTokens), outputTokens: tokenCount(input.outputTokens),
    cacheWriteTokens: tokenCount(input.cacheWriteTokens), cacheReadTokens: tokenCount(input.cacheReadTokens),
  };
}

export const auditHealth = { failedWrites: 0, lastFailureAt: null as string | null };

export async function recordAuditSafely(sink: AiAuditSink | undefined, row: AiCallRecord): Promise<void> {
  if (!sink) return;
  try { await sink.record(row); }
  catch (error) {
    auditHealth.failedWrites++;
    auditHealth.lastFailureAt = new Date().toISOString();
    console.warn('AI 调用审计写入失败', error instanceof Error ? error.message : 'unknown');
  }
}
