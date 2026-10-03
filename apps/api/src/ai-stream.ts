export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
}

interface RawUsage { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
function tokenUsage(raw: RawUsage): TokenUsage {
  return { ...(raw.prompt_tokens !== undefined || raw.input_tokens !== undefined ? { promptTokens: raw.prompt_tokens ?? raw.input_tokens } : {}),
    ...(raw.completion_tokens !== undefined || raw.output_tokens !== undefined ? { completionTokens: raw.completion_tokens ?? raw.output_tokens } : {}),
    ...(raw.total_tokens !== undefined ? { totalTokens: raw.total_tokens } : {}),
    ...(raw.cache_read_input_tokens !== undefined || raw.prompt_tokens_details?.cached_tokens !== undefined || raw.input_tokens_details?.cached_tokens !== undefined
      ? { cachedTokens: raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens } : {}),
    ...(raw.cache_creation_input_tokens !== undefined || raw.prompt_tokens_details?.cache_write_tokens !== undefined || raw.input_tokens_details?.cache_write_tokens !== undefined
      ? { cacheWriteTokens: raw.cache_creation_input_tokens ?? raw.prompt_tokens_details?.cache_write_tokens ?? raw.input_tokens_details?.cache_write_tokens } : {}) };
}

function topLevelMessageStart(raw: string): number | null {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let quoteStart = 0;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (quoted) {
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (character !== '"') continue;
      quoted = false;
      if (depth !== 1) continue;
      let key: unknown;
      try { key = JSON.parse(raw.slice(quoteStart, index + 1)); } catch { continue; }
      if (key !== 'message') continue;
      let next = index + 1;
      while (/\s/.test(raw[next] ?? '')) next++;
      if (raw[next] !== ':') continue;
      next++;
      while (/\s/.test(raw[next] ?? '')) next++;
      if (raw[next] === '"') return next + 1;
      continue;
    }
    if (character === '"') { quoted = true; quoteStart = index; }
    else if (character === '{') depth++;
    else if (character === '}') depth--;
  }
  return null;
}

export function createMessageDeltaExtractor(onMessage: (delta: string) => void) {
  let raw = '';
  let emitted = '';
  let taggedBodyStart: number | null = null;
  const tagPrefix = '<<EVENT_IDS:';
  return {
    push(chunk: string) {
      raw += chunk;
      if (taggedBodyStart === null && tagPrefix.startsWith(raw)) return;
      if (taggedBodyStart === null && raw.startsWith(tagPrefix)) {
        const markerEnd = raw.indexOf('>>\n');
        if (markerEnd < 0) return;
        taggedBodyStart = markerEnd + 3;
      }
      if (taggedBodyStart !== null) {
        const body = raw.slice(taggedBodyStart);
        const delta = body.slice(emitted.length);
        emitted = body;
        if (delta) onMessage(delta);
        return;
      }
      if (raw.trimStart() && !raw.trimStart().startsWith('{')) {
        const delta = raw.slice(emitted.length);
        emitted = raw;
        if (delta) onMessage(delta);
        return;
      }
      const start = topLevelMessageStart(raw);
      if (start === null) return;
      let encoded = '';
      let escaping = false;
      for (let index = start; index < raw.length; index++) {
        const character = raw[index];
        if (character === '"' && !escaping) break;
        encoded += character;
        if (character === '\\' && !escaping) escaping = true;
        else escaping = false;
      }
      let safeLength = 0;
      for (let index = 0; index < encoded.length; index++) {
        if (encoded[index] !== '\\') { safeLength = index + 1; continue; }
        if (index + 1 >= encoded.length) break;
        if (encoded[index + 1] === 'u') {
          if (index + 5 >= encoded.length) break;
          index += 5;
        } else index += 1;
        safeLength = index + 1;
      }
      try {
        const decoded = JSON.parse(`"${encoded.slice(0, safeLength)}"`) as string;
        if (decoded.length > emitted.length) {
          const delta = decoded.slice(emitted.length);
          emitted = decoded;
          onMessage(delta);
        }
      } catch { /* Wait for a complete JSON escape before exposing the text. */ }
    },
  };
}

export async function readChatCompletionStream(response: Response, onContent: (delta: string) => void): Promise<{
  content: string;
  usage: TokenUsage | null;
  finishReason: string | null;
}> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json() as {
      choices?: { message?: { content?: string }; finish_reason?: string | null }[];
      usage?: RawUsage;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    if (content) onContent(content);
    return { content, finishReason: data.choices?.[0]?.finish_reason ?? null,
      usage: data.usage ? tokenUsage(data.usage) : null };
  }
  if (!response.body) throw new Error('AI 流式响应缺少内容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let usage: TokenUsage | null = null;
  let finishReason: string | null = null;
  const consume = (event: string) => {
    const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const parsed = JSON.parse(data) as {
      choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
      usage?: RawUsage;
      error?: { message?: string };
    };
    if (parsed.error) throw new Error(parsed.error.message ?? 'AI 流式响应错误');
    for (const choice of parsed.choices ?? []) {
      const delta = choice.delta?.content;
      if (delta) { content += delta; onContent(delta); }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (parsed.usage) usage = tokenUsage(parsed.usage);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, '\n');
      let end = pending.indexOf('\n\n');
      while (end >= 0) {
        consume(pending.slice(0, end));
        pending = pending.slice(end + 2);
        end = pending.indexOf('\n\n');
      }
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending.replace(/\r\n/g, '\n'));
  } finally { reader.releaseLock(); }
  return { content, usage, finishReason };
}
