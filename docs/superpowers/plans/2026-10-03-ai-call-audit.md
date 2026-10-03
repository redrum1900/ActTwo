# AI Call Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every post-launch upstream AI attempt and provide account-scoped player reports and admin-wide reports.

**Architecture:** A small audit sink receives sanitized metadata from both model clients. MySQL stores per-attempt rows and account/month rollups; model calls never depend on successful audit writes. Explicit attribution travels from the authenticated route through chat and memory work to the adapter.

**Tech Stack:** TypeScript, Express 5, MySQL, React 19, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-03-ai-call-audit-design.md`

## Global Constraints

- Implement after unified account auth; never associate new rows with `gd_guest`, never backfill old JSONL rows.
- One row per actual upstream attempt, including failures, retries and fallback models.
- Token fields are nullable: absent provider usage means unknown, not zero. Do not persist prompts, replies or credentials.
- Detail retention is 180 days; monthly account summaries survive detail deletion. Deleting playtest records does not delete audit history.
- Audit failure never changes an otherwise successful game or import result; emit an operational warning.
- Current worktree contains unrelated changes; stage only task-owned files and run remote MySQL checks only against a disposable schema.

## Review Focus

- Provider returns only cached-read tokens, not cached-write tokens: write remains NULL; Task 2 tests this.
- Timeout before response has no token usage but has an outcome row; Task 2 tests this.
- Primary retry then fallback produces separate rows tied to one operation; Task 2 tests this.
- Background summary after the player disconnects stays attributed to that account; Task 2 tests this.
- Deleting 181-day details keeps previously rolled-up totals, including deleted playtests; Task 1 tests this.

---

### Task 1: Schema, Sanitized Store and Retention

**Files:** Modify `apps/api/src/db/migrations.ts`; create `apps/api/src/ai-audit.ts`, `apps/api/src/db/mysql-ai-audit-store.ts`; test `tests/ai-audit-store.test.ts`.

**Interfaces:** `AiAttribution = { accountId: string | null; source: 'formal' | 'playtest' | 'import' | 'system'; storyId: string | null; playtestId?: string; releaseVersion?: string; operationId: string }`; `AiCallRecord = AiAttribution & { id: string; purpose: string; model: string; providerIndex: number; startedAt: string; durationMs: number; httpStatus: number | null; outcome: string; inputTokens: number | null; outputTokens: number | null; cacheWriteTokens: number | null; cacheReadTokens: number | null }`; `AiAuditSink.record(row: AiCallRecord): Promise<void>`; `createMysqlAiAuditStore(pool)` produces `record`, `listOwn`, `listAll`, `summarizeOwn`, `summarizeAll`, `expireDetails(cutoff: string)`, `eraseAccount(accountId: string)`.

- [ ] **Step 1: Write failing tests** asserting `assert.equal(row.cacheWriteTokens, null)`, `assert.ok((await store.listOwn('A')).every(row => row.accountId === 'A'))`, monthly totals remain equal before/after `expireDetails` for an old deleted-playtest row, and `eraseAccount('A')` removes account-linked details and summaries.
- [ ] **Step 2: Run** `npx tsx --test tests/ai-audit-store.test.ts`; expect failure.
- [ ] **Step 3: Add** version-5 MySQL migration for indexed `ai_call_records` and `ai_call_monthly` tables; implement the store with cursor-based detail pagination, transactional monthly aggregation when recording, detail expiry, account erasure and no content/credential columns. Make migration from version 4 and fresh database paths both work.
- [ ] **Step 4: Run** `npx tsx --test tests/ai-audit-store.test.ts tests/mysql-save-api.test.ts`; expect PASS (remote MySQL checks use existing opt-in flag).
- [ ] **Step 5: Commit** only this task's files with `feat: store sanitized AI attempt usage`.

### Task 2: Instrument Chat, Memory and Import Calls

**Files:** Modify `apps/api/src/ai-stream.ts`, `apps/api/src/ai-adapter.ts`, `apps/api/src/chat-service.ts`, `apps/api/src/memory-worker.ts`, `apps/api/src/creator/import-ai.ts`, `apps/api/src/creator/import-worker.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`; test `tests/ai-audit-integration.test.ts`, `tests/ai-errors.test.ts`, `tests/ai-stream.test.ts`.

**Interfaces:** Consume `AiAttribution`/`AiAuditSink` from Task 1. Add `audit?: AiAttribution` to `ChatContext`, `deriveChatContext(..., audit?: AiAttribution)`, and `runChat` options; extend `createMemoryWorker` returned function with optional attribution. Adapter and import client configs accept `auditSink?: AiAuditSink`; import client's `complete(system, user, attribution)` receives explicit attribution. Shared helper `recordAuditSafely(sink, row): Promise<void>` catches store errors and logs a warning.

- [ ] **Step 1: Write failing tests** asserting `assert.equal(rows.length, upstreamCalls)` across 429 retry, fallback model, timeout and successful stream; `assert.equal(success.cacheWriteTokens, null)` when absent; `assert.ok(!JSON.stringify(rows).includes('SECRET_KEY'))`; memory summary has the triggering `accountId`; import has `source === 'import'`.
- [ ] **Step 2: Run** `npx tsx --test tests/ai-audit-integration.test.ts tests/ai-errors.test.ts tests/ai-stream.test.ts`; expect new assertions to fail.
- [ ] **Step 3: Extend** stream usage parsing for provider-reported cache read/write fields without inventing missing values; request streamed usage with `stream_options.include_usage` where the provider accepts it, treating unsupported options as an explicit compatibility case. Thread attribution from formal chat routes and memory worker into each model attempt, wire the MySQL sink at startup, and safely record results in `finally`. Keep existing local file logs optional and non-authoritative.
- [ ] **Step 4: Run** the Step 2 command; expect PASS, including successful game/import result despite a rejecting audit sink.
- [ ] **Step 5: Commit** only this task's files with `feat: attribute and audit AI calls`.

### Task 3: Permissioned Usage APIs and Screens

**Files:** Create `apps/api/src/ai-audit-router.ts`, `apps/web/src/AiUsagePage.tsx`, `apps/web/src/creator/AdminAiUsage.tsx`; modify `apps/api/src/app.ts`, `apps/web/src/api.ts`, `apps/web/src/main.tsx`, `apps/web/src/creator/CreatorApp.tsx`, `apps/web/src/styles.css`; test `tests/ai-audit-api.test.ts`, `tests/ai-audit-ui.test.ts`.

**Interfaces:** `createAiAuditRouter(accounts, auditStore)` exposes `GET /api/usage/me` and `GET /api/usage/admin` with paginated details and summaries; the former derives account ID from the session, the latter requires `admin`. Web views consume these endpoints, show `未知` for null token values, and show no estimated price to players.

- [ ] **Step 1: Write failing API/UI tests**: `assert.equal(anonymous.status, 401)`, `assert.ok(ownRows.every(row => row.accountId === account.id))`, `assert.equal(authorAdminRequest.status, 403)`; assert admin filters, `未知` for null cache, “试玩记录已删除” for orphan IDs, and no estimated price in player view.
- [ ] **Step 2: Run** `npx tsx --test tests/ai-audit-api.test.ts tests/ai-audit-ui.test.ts`; expect failure.
- [ ] **Step 3: Implement** the router and account/admin views with date, story, source, model and purpose filters; schedule `expireDetails` from API startup and surface an admin warning if the sink reports failed writes.
- [ ] **Step 4: Run** `npx tsx --test tests/ai-audit-api.test.ts tests/ai-audit-ui.test.ts && npm run build && npm test`; expect PASS.
- [ ] **Step 5: Commit** only this task's files with `feat: show account and admin AI usage`.
