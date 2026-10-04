import { readChatCompletionStream } from '../../../infrastructure/ai/ai-stream.js';
import { aiCallRecord, recordAuditSafely, type AiAttribution, type AiAuditSink } from '../../../infrastructure/ai/ai-audit.js';

export interface MainAiClient {
  complete(system: string, user: string, audit?: AiAttribution): Promise<string>;
}

export class ImportAiConfigError extends Error {
  constructor(field: string) { super(`导入模型未正确配置：${field}`); this.name = 'ImportAiConfigError'; }
}

export function createMainAiClient(env: Record<string, string | undefined>, auditSink?: AiAuditSink): MainAiClient {
  const apiKey = env.AI_MAIN_API_KEY?.trim();
  const baseUrl = env.AI_MAIN_BASE_URL?.trim();
  const model = env.AI_MAIN_MODEL?.trim();
  if (!apiKey) throw new ImportAiConfigError('AI_MAIN_API_KEY');
  if (!baseUrl) throw new ImportAiConfigError('AI_MAIN_BASE_URL');
  if (!model) throw new ImportAiConfigError('AI_MAIN_MODEL');
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new ImportAiConfigError('AI_MAIN_BASE_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ImportAiConfigError('AI_MAIN_BASE_URL');
  const endpoint = `${url.toString().replace(/\/$/, '')}/chat/completions`;
  return {
    async complete(system, user, audit) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let httpStatus: number | null = null;
      let outcome = 'network_error';
      let usage: Awaited<ReturnType<typeof readChatCompletionStream>>['usage'] = null;
      try {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, temperature: 0.2, max_tokens: 16000, stream: true,
            ...(env.AI_MAIN_STREAM_USAGE === '1' ? { stream_options: { include_usage: true } } : {}),
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
          signal: AbortSignal.timeout(600_000),
        });
      } catch {
        outcome = 'timeout_or_network_error';
        throw new Error('导入模型连接失败或超时，请稍后重试');
      }
      httpStatus = response.status;
      if (!response.ok) outcome = response.status === 429 ? 'rate_limited' : 'http_error';
      if (!response.ok) throw new Error(`导入模型请求失败（HTTP ${response.status}）`);
      let result: Awaited<ReturnType<typeof readChatCompletionStream>>;
      try { result = await readChatCompletionStream(response, () => {}); }
      catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          outcome = 'timeout';
          throw new Error('导入模型生成超时，请稍后重试');
        }
        outcome = 'invalid_response';
        throw new Error('导入模型流式响应中断或格式无效，请稍后重试');
      }
      usage = result.usage;
      if (result.finishReason === 'length') { outcome = 'truncated'; throw new Error('导入模型输出被截断，请缩小单次生成范围后重试'); }
      if (!result.content.trim()) {
        outcome = 'empty_response';
        throw new Error('导入模型未返回可用内容');
      }
      outcome = 'success';
      return result.content;
      } finally {
        await recordAuditSafely(auditSink, aiCallRecord({
          ...(audit ?? { accountId: null, source: 'system', storyId: null, operationId: 'unattributed-import' }),
          purpose: 'import', model, providerIndex: 0, startedAt, durationMs: performance.now() - started,
          httpStatus, outcome, inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens,
          cacheWriteTokens: usage?.cacheWriteTokens, cacheReadTokens: usage?.cachedTokens,
        }));
      }
    },
  };
}
