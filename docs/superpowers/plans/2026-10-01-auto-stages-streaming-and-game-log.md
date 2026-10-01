# 自动阶段、流式对话与游戏日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 NPC 按剧本条件自动切阶段，玩家与 NPC 的文字即时／流式显示，并把真实操作和结果记录到随存档分支回退的游戏日志。

**Architecture:** 服务端把每次有效操作作为一次结算：先应用动作／事件，再选阶段，生成可见变化及日志，最后原子更新自动存档。AI 上游 SSE 流由后端解析出结构化回复中的 `message` 临时文字，下游 SSE 推送给 React；完成规则校验后用权威最终消息替换临时气泡。

**Tech Stack:** TypeScript、React 19、Express 5、SQLite (`better-sqlite3`)、`tsx --test`、Vite。

**Spec:** `docs/superpowers/specs/2026-10-01-auto-stages-streaming-and-game-log-design.md`

## Global Constraints

- 当前目录没有 `.git`；不要擅自初始化仓库，原本每任务的 Git 提交改为测试与文件检查点。
- 保留现有存档数据及自动／手动存档语义；旧存档补空日志，不伪造历史。
- 每个 NPC 每次有效操作至多切换一次；多个合格目标阶段等概率随机，读取页面不抽签。
- 隐藏物品在真正发现前不提示、不记玩家可见日志；AI 临时稿不写正式存档。
- 现有游戏视觉语言、固定顶部和聊天消息滚动区域保持不变。

## Review Focus

- SSE 数据块从 JSON 字符串转义字符、中文多字节字符中间切开：只显示正确的 `message` 内容，不泄露控制字段（Task 4）。
- 客户端断线发生在服务端提交前或提交后：同一 `turnId` 重试不重复对话／扣费式调用（Task 5）。
- 多个阶段同轮合格且条件持续为真：只抽一次，下一轮不从新阶段错误跳回（Task 2）。
- 旧存档有 `pendingOffers` 且已达阶段门槛：读取不突变，首次有效操作才处理（Task 3）。
- NPC 离开同时解锁地点：最终回复、离开提示和地点提示都能看见，不互相覆盖（Task 7）。

## File map

- `packages/contracts/src/index.ts`：日志记录、聊天 `turnId`、结构化操作结果的共享类型。
- `packages/engine/src/stage-settlement.ts`：阶段候选评估与可注入随机选择。
- `packages/engine/src/activity-log.ts`：前后状态差异转玩家可见结果与日志。
- `packages/engine/src/index.ts`：调用新结算模块，移除当前剧本依赖的旧邀约路径。
- `packages/engine/src/state-migration.ts`：旧存档字段补齐。
- `packages/script/src/index.ts` 与 `content/sword-and-screen/**`：阶段条件校验、苏念阶段及无引导样例。
- `apps/api/src/ai-stream.ts`：上游 SSE 解码与结构化 `message` 增量提取。
- `apps/api/src/ai-adapter.ts`：所有 AI 调用改用上游流式请求并保持用量日志。
- `apps/api/src/chat-service.ts`、`apps/api/src/app.ts`：统一结算、聊天下游 SSE、`turnId` 幂等。
- `apps/web/src/api.ts`、`apps/web/src/App.tsx`、`apps/web/src/styles.css`：流式消费、临时聊天、离开跳转、游戏日志与移除引导。
- `tests/*.test.ts`：各边界的测试；不添加新的运行时依赖。

---

### Task 1: 存档日志与聊天轮次契约

**Files:** Modify `packages/contracts/src/index.ts`, `packages/engine/src/state-migration.ts`, `packages/engine/src/index.ts`; test `tests/engine.test.ts`, `tests/save-store.test.ts`.

**Interfaces:** Produce `GameState.activityLog: ActivityEntry[]`, `ChatMessage.turnId?: string`, `ActivityEntry = { id: string; at: string; day: number; period: string; locationId: string; kind: 'chat'|'move'|'wait'|'search'|'take'|'explore'; summary: string; npcId?: string; chatMessageId?: string; details: ActivityDetail[] }`, `ActivityDetail = { kind: 'event'|'stage'|'stat'|'tag'|'npc_discovered'|'item_discovered'|'item_gained'|'item_removed'|'location_unlocked'|'gallery'; text: string; entityId?: string }`; `hydrateLegacyState` guarantees `activityLog` exists.

- [ ] Add a failing test: create new game → `activityLog=[]`; hydrate legacy save without log → `[]`; manual save/load restores the saved log branch.
- [ ] Run `npx tsx --test tests/engine.test.ts tests/save-store.test.ts`; confirm only the new assertions fail.
- [ ] Add the contract fields, initial value, and non-destructive legacy hydration.
- [ ] Run the same tests and `npm run build`; both pass.

### Task 2: 自动阶段引擎与苏念剧本

**Files:** Create `packages/engine/src/stage-settlement.ts`; modify `packages/engine/src/index.ts`, `packages/script/src/index.ts`, `content/sword-and-screen/npcs/su-nian/stages.json`, `content/sword-and-screen/npcs/su-nian/base.json`, `content/sword-and-screen/manifest.json`; remove `content/sword-and-screen/npcs/su-nian/stage-offers.json`; test `tests/engine.test.ts`, `tests/script.test.ts`.

**Interfaces:** Produce `settleStageTransitions(script: GameScript, state: GameState, random?: () => number): { state: GameState; transitions: { npcId: string; from: string; to: string }[] }`. The function does not mutate inputs or refresh unrelated world state.

- [ ] Add failing tests for one candidate, two candidates with injected `random=0`/`0.99`, distinct NPCs, no more than one transition per NPC, no eligible transition, and conditions that cease to match after changing current stage.
- [ ] Run `npx tsx --test tests/engine.test.ts`; confirm the new tests fail.
- [ ] Implement stage selection; prevent legacy cap/offer transitions from overriding `enterWhen`; retain legacy schema loading without using it for the current story.
- [ ] Add failing script tests: noninitial stage without `enterWhen`, bad stage reference, current-stage constraint warning, and Su Nian progression without offer configuration.
- [ ] Run `npx tsx --test tests/script.test.ts`; confirm the new tests fail, then update loader validation and script JSON (remove guide and offers, preserve three scenes).
- [ ] Run both test files and `npm run build`; pass.

### Task 3: 一次操作的统一结算、提示与游戏日志

**Files:** Create `packages/engine/src/activity-log.ts`; modify `packages/engine/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/chat-service.ts`, `packages/engine/src/state-migration.ts`; test `tests/engine.test.ts`, `tests/api.test.ts`, `tests/acceptance.test.ts`.

**Interfaces:** Produce `ActivityAction = { kind: ActivityEntry['kind']; summary: string; npcId?: string; chatMessageId?: string }`, `VisibleChange = { kind: ActivityDetail['kind']; text: string; entityId?: string }`, `settleWorld(script: GameScript, before: GameState, afterEffects: GameState, action: ActivityAction, random?: () => number): { state: GameState; changes: VisibleChange[] }`, and `appendActivity(state: GameState, action: ActivityAction, changes: VisibleChange[]): GameState`. API responses include `changes` while preserving `actionText` during migration.

- [ ] Add failing tests: move/wait/search/take/explore and chat all reach stage settlement; an ordinary no-discovery search still logs the attempt; invalid input and AI failure do not log.
- [ ] Run `npx tsx --test tests/engine.test.ts tests/api.test.ts`; confirm expected failures.
- [ ] Implement one mutation-only settlement path before `store.updateAuto`; keep `refreshWorld` read-time behavior deterministic and free of stage selection.
- [ ] Add failing tests: first location unlock, stat/tag change and actual item discovery/acquisition/removal emit one change each; eligible-but-undiscovered hidden item emits none; old save with pending offer is unchanged by GET and advances on first valid mutation.
- [ ] Run targeted tests to observe failures; implement before/after diff and activity records, including event/stage/gallery references and safe user-facing labels.
- [ ] Run targeted tests plus `tests/acceptance.test.ts`; pass.

### Task 4: 上游 AI SSE 与结构化回复增量解析

**Files:** Create `apps/api/src/ai-stream.ts`; modify `apps/api/src/ai-adapter.ts`; test `tests/ai-errors.test.ts`, create `tests/ai-stream.test.ts`.

**Interfaces:** Produce `TokenUsage = { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number }`, `readChatCompletionStream(response: Response, onContent: (delta: string) => void): Promise<{ content: string; usage: TokenUsage | null; finishReason: string | null }>` and `extractMessageDeltas(contentChunks: AsyncIterable<string>, onMessage: (delta: string) => void): Promise<string>`; `createChatAdapter` accepts an optional draft callback for `generate`.

- [ ] Add failing decoder tests for split `data:` lines, `[DONE]`, `delta.content`, usage-only final chunk, escaped quotes/backslashes/newlines, Chinese UTF-8 split, and malformed provider data.
- [ ] Run `npx tsx --test tests/ai-stream.test.ts`; confirm failures.
- [ ] Implement text decoding with `TextDecoder` streaming mode and JSON-string `message` tokenizer; no internal `proposedEventIds` content reaches the draft callback.
- [ ] Add failing adapter tests that inspect outbound `stream:true` for generate/repair/rewrite/summarize, assert nonstream `response.json()` is unused, and check 429/timeout mapping and unknown usage.
- [ ] Run AI tests to observe failures; switch `completion` to SSE and preserve request metrics logging.
- [ ] Run both AI test files and `npm run build`; pass.

### Task 5: 下游聊天 SSE、原子提交和 `turnId` 幂等

**Files:** Modify `apps/api/src/chat-service.ts`, `apps/api/src/app.ts`, `apps/api/src/save-store.ts`; test `tests/chat.test.ts`, `tests/api.test.ts`, `tests/ai-errors.test.ts`.

**Interfaces:** Add `POST /api/games/:gameId/chat/stream` with request `{ npcId, text, revision, turnId }`; SSE events `draft {delta}`, `status {text}`, `final {session}`, `error {message,status}`. Keep existing `/chat` endpoint using the same final settlement. `runChat` accepts `turnId` and `onDraft` and returns a fully settled `GameState` plus applied changes.

- [ ] Add failing API tests: draft before final, final includes saved player/NPC pair and log, no save on generator/repair failure, same `turnId` after commit returns prior final without new AI call.
- [ ] Run `npx tsx --test tests/chat.test.ts tests/api.test.ts`; confirm failures.
- [ ] Implement SSE writer and invoke the shared chat service; order stage settlement before final-state rewrite; persist only after all AI calls succeed.
- [ ] Add failing tests for connection drop before and after commit, concurrent identical `turnId`, and revision conflict that must not resend the text.
- [ ] Run targeted tests to observe failures; add idempotency lookup by saved chat `turnId` plus in-flight deduplication scoped to owner/game/turnId.
- [ ] Run targeted tests and `npm run build`; pass.

### Task 6: 前端即时发送与流式气泡

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`; create `apps/web/src/chat-stream.ts`; test `tests/acceptance.test.ts` plus manual browser check.

**Interfaces:** Produce `postChatStream(path, body, handlers)` in `api.ts` and a pure pending-message reducer in `chat-stream.ts` for `draft/final/error` events. `App` renders server `view.chats` plus current pending turn without writing provisional text to session state.

- [ ] Add failing pure reducer tests: submit immediately adds player message and clears draft; draft appends to one NPC bubble; final swaps both provisional bubbles for server messages; failure preserves retryable player text but clears provisional NPC text.
- [ ] Run `npx tsx --test tests/acceptance.test.ts`; confirm failures.
- [ ] Implement browser SSE reader and pending-turn state, keep composer disabled for in-flight same-NPC send, support same-`turnId` retry and auto-scroll.
- [ ] Run tests and `npm run build`; pass; manually check mobile chat viewport and scroll stability.

### Task 7: 玩家日志、提示、离开跳转及引导清理

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/api.ts`, `apps/api/src/app.ts`, `packages/engine/src/index.ts`, `content/sword-and-screen/manifest.json`; test `tests/acceptance.test.ts`, `tests/header-layout.test.ts` plus browser check.

**Interfaces:** `SessionPayload.changes` and `view.activityLog` power toast queue and log drawer. An NPC-leave transition is detected when the active NPC is absent from the *same-location* final `view.npcs`; final message is shown before `pane='location'`.

- [ ] Add failing tests for log newest-first with chat navigation, no guide/objective/offer UI, and queued item/location notices that do not overwrite one another.
- [ ] Run `npx tsx --test tests/acceptance.test.ts tests/header-layout.test.ts`; confirm failures.
- [ ] Implement log drawer, grouped changes, toast queue and remove universal guide/objective/offer markup and scripting hints from visible UI.
- [ ] Add failing test: NPC disappears after final chat while location unlocks; final reply persists, leave + unlock notices both appear, returns to location NPC list. The same post-settlement check applies to any action while the chat pane is open; player moving themselves does not show leave notice.
- [ ] Run targeted tests to observe failures; implement final-view NPC comparison and automatic close after final event.
- [ ] Run targeted tests and `npm run build`; pass; manually check desktop/mobile header and drawer.

### Task 8: End-to-end regression and documentation

**Files:** Modify `README.md`, `docs/architecture.md`, `docs/su-nian-card-coverage.md` only where behavior changed; test all existing files.

**Interfaces:** No new API; verify the completed path against the approved spec.

- [ ] Run `npm test` and `npm run build`; fix only failures caused by this implementation and rerun until green.
- [ ] Start local API/web if not already running; manually play new game through online → restaurant → her-home, inspect provider stream classification, player/NPC streaming, stage logs, unlock notifications and NPC-leave return.
- [ ] Create/read a manual save before a transition and confirm stage, log and random choice restore together; verify old save loads without retroactive log.
- [ ] Update only affected documentation; rerun `npm test` and `npm run build`, record outcomes and any external provider limitation.
