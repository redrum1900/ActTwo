import type { ChatMessage, MemorySegment } from '../../../packages/contracts/src/index.js';

export interface SelectedMemory {
  raw: ChatMessage[];
  summaries: MemorySegment[];
  relevantExcerpts: ChatMessage[];
  compressed: boolean;
}

function similarity(text: string, query: string): number {
  const grams = new Set<string>();
  for (let index = 0; index < query.length - 1; index++) grams.add(query.slice(index, index + 2));
  let score = 0;
  for (const gram of grams) if (text.includes(gram)) score++;
  return score;
}

export function selectChatMemory(history: ChatMessage[], segments: MemorySegment[], query: string, budgetChars = 22000): SelectedMemory {
  const total = history.reduce((sum, message) => sum + message.text.length, 0);
  if (total <= budgetChars) return { raw: history, summaries: [], relevantExcerpts: [], compressed: false };
  const recentBudget = Math.floor(budgetChars * 0.55);
  const raw: ChatMessage[] = [];
  let used = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (used + entry.text.length > recentBudget && raw.length) break;
    raw.unshift(entry); used += entry.text.length;
  }
  const older = history.slice(0, history.length - raw.length);
  const excerptBudget = Math.floor(budgetChars * 0.25);
  const ranked = older.map((entry, index) => ({ entry, index, score: similarity(entry.text, query) }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const excerpts: ChatMessage[] = [];
  let excerptChars = 0;
  for (const match of ranked) {
    if (!match.score || excerptChars + match.entry.text.length > excerptBudget) continue;
    excerpts.push(match.entry); excerptChars += match.entry.text.length;
  }
  excerpts.sort((a, b) => older.indexOf(a) - older.indexOf(b));
  const summaryBudget = budgetChars - used - excerptChars;
  const selected: MemorySegment[] = [];
  let summaryChars = 0;
  for (let index = segments.length - 1; index >= 0; index--) {
    const entry = segments[index];
    if (summaryChars + entry.summary.length > summaryBudget) continue;
    selected.unshift(entry); summaryChars += entry.summary.length;
  }
  return { raw, summaries: selected, relevantExcerpts: excerpts, compressed: true };
}
