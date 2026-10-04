interface UsageRow {
  turnId: string;
  purpose: string;
  startedAt?: string;
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number } | null;
}
export interface TokenRates { input: number; cached: number; output: number }

// Rates are supplied by the caller. This is an estimate, not a provider invoice.
export function summarizeCosts(rows: UsageRow[], rates: TokenRates) {
  const turns = new Map<string, { turnId: string; startedAt?: string; calls: number; purposes: string[];
    promptTokens: number; cachedTokens: number; uncachedTokens: number; outputTokens: number;
    estimatedUsd: number; unknownUsageCalls: number; unknownCacheCalls: number }>();
  for (const row of rows) {
    const turn = turns.get(row.turnId) ?? { turnId: row.turnId, startedAt: row.startedAt, calls: 0, purposes: [],
      promptTokens: 0, cachedTokens: 0, uncachedTokens: 0, outputTokens: 0,
      estimatedUsd: 0, unknownUsageCalls: 0, unknownCacheCalls: 0 };
    turn.calls++;
    turn.purposes.push(row.purpose);
    if (!row.usage) turn.unknownUsageCalls++;
    else {
      const { promptTokens, completionTokens, cachedTokens } = row.usage;
      if (cachedTokens === undefined) turn.unknownCacheCalls++;
      const cached = Math.min(promptTokens, Math.max(0, cachedTokens ?? 0));
      turn.promptTokens += promptTokens;
      turn.cachedTokens += cached;
      turn.uncachedTokens += promptTokens - cached;
      turn.outputTokens += completionTokens;
      turn.estimatedUsd += ((promptTokens - cached) * rates.input + cached * rates.cached + completionTokens * rates.output) / 1_000_000;
    }
    turns.set(row.turnId, turn);
  }
  return [...turns.values()];
}
