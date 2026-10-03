# Creator Draft Playtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a creator launch and resume up to ten independent playtests, each with its own immutable draft snapshot and auto-save in one MySQL row.

**Architecture:** A creator-owned `creator_playtests` row is the complete aggregate. Creator-only APIs load its frozen script and state, then reuse the existing engine and AI adapter; the web game view switches between formal and playtest runtime clients. Each new playtest opens a new tab.

**Tech Stack:** TypeScript, Express 5, MySQL, React 19, game engine packages, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-03-creator-playtest-design.md`

## Global Constraints

- Requires unified account auth and AI audit; all playtest operations require the owning creator account.
- Exactly one row per playtest contains immutable `script_json` and nullable `auto_state_json`; do not create a second playtest-save table or write formal `save_slots`.
- At most ten records per story; the eleventh creation deletes the oldest row in the same transaction.
- Invalid saved drafts cannot start a playtest, but may remain saved; unsaved editor changes must be saved first.
- Chat uses real AI and records `playtest` usage; deleting a playtest does not delete its usage history.
- Current worktree contains unrelated changes; stage only task-owned files and run remote MySQL checks only against a disposable schema.

## Review Focus

- Two concurrent creates cannot leave eleven rows; Task 1 tests transactional serialization.
- A playtest row without an auto-save resumes at the player form after refresh; Tasks 1 and 3 test this.
- Concurrent actions with the same revision cannot overwrite one another; Tasks 1 and 2 test this.
- Deleting an open playtest makes its next request fail, not load live draft; Task 2 tests this.
- A newly published formal version cannot alter an existing playtest snapshot; Task 2 tests this.

---

### Task 1: One-Row Playtest Store and Migration

**Files:** Modify `apps/api/src/db/migrations.ts`; create `apps/api/src/db/mysql-playtest-store.ts`; test `tests/mysql-playtest-store.test.ts`.

**Interfaces:** `PlaytestRecord = { id: string; projectId: string; ownerId: string; script: GameScript; scriptHash: string; auto: SaveRecord | null; createdAt: string; playedAt: string | null }`; `createMysqlPlaytestStore(pool)` produces `list(ownerId, projectId)`, `create(ownerId, projectId, script)`, `get(ownerId, projectId, playtestId)`, `delete(ownerId, projectId, playtestId)`, `initialize(ownerId, projectId, playtestId, state)`, `updateAuto(ownerId, projectId, playtestId, expectedRevision, state)`.

- [ ] **Step 1: Write failing tests**: `assert.notEqual(first.id, second.id)`, `assert.equal(first.auto, null)`, `assert.equal((await store.list(owner, project)).length, 10)` after eleven/concurrent creates; stale CAS rejects; delete removes the row; wrong owner gets null.
- [ ] **Step 2: Run** `npx tsx --test tests/mysql-playtest-store.test.ts`; expect failure.
- [ ] **Step 3: Add** version-6 migration for `creator_playtests` with `script_json`, `script_hash`, nullable `auto_state_json`, `auto_revision`, timestamps and ownership indexes; implement store using row locks and a project-scoped lock for 10-record enforcement. Handle fresh schema plus upgrade from version 5.
- [ ] **Step 4: Run** the Step 2 command; expect PASS (remote MySQL tests use existing opt-in flag).
- [ ] **Step 5: Commit** only this task's files with `feat: persist creator playtest snapshot and save together`.

### Task 2: Creator Playtest Runtime API

**Files:** Create `apps/api/src/creator/playtest-router.ts`, `apps/api/src/playtest-session.ts`; modify `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/chat-service.ts`, `apps/api/src/memory-worker.ts`; test `tests/creator-playtest-api.test.ts`.

**Interfaces:** `createPlaytestRouter(accounts, projects, playtests, adapter)` exposes `GET/POST /api/creator/projects/:id/playtests`, `GET/DELETE /:playtestId`, `POST /:playtestId/new`, `GET /:playtestId/current`, `POST /:playtestId/action`, `POST /:playtestId/chat/stream`. `playtest-session.ts` exports `playtestDetail(record)`, `playtestPayload(record, adapter)`, and action/chat settlement helpers consuming the frozen script and existing engine. Chat attribution uses `{ accountId, source: 'playtest', storyId, playtestId, operationId: turnId }`.

- [ ] **Step 1: Write failing tests**: `assert.equal(invalidCreate.status, 400)` with a config path and unchanged row count; a valid draft with no player fields initializes auto-save directly; old ID retains its original hash after draft edit/publication; unauthorized/deleted ID returns 404; stale revision returns 409; repeated `turnId` leaves `aiCalls === 1`; draft images require creator authorization.
- [ ] **Step 2: Run** `npx tsx --test tests/creator-playtest-api.test.ts`; expect failure.
- [ ] **Step 3: Implement** creator-authenticated routes and shared session helpers using `readPlayer`, `createInitialState`, action/settlement/view and `runChat` from existing engine/service; initialize only this row's auto-save, use CAS updates, preserve stream retry semantics, and pass playtest attribution to AI/memory calls. Do not use the published repository or formal save store.
- [ ] **Step 4: Run** `npx tsx --test tests/creator-playtest-api.test.ts tests/api.test.ts tests/chat.test.ts`; expect PASS.
- [ ] **Step 5: Commit** only this task's files with `feat: run draft playtests through creator API`.

### Task 3: Drawer, New-Tab Route and Reused Game UI

**Files:** Create `apps/web/src/creator/PlaytestDrawer.tsx`, `apps/web/src/playtest-client.ts`; modify `apps/web/src/creator/CreatorApp.tsx`, `apps/web/src/creator/client.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/creator/creator.css`, `apps/web/src/styles.css`; test `tests/creator-playtest-ui.test.ts`.

**Interfaces:** `playtestClient(projectId, playtestId)` returns `detail`, `current`, `start`, `action`, `chat` methods matching formal game payloads. `App` receives optional `playtest?: { projectId: string; playtestId: string }`; when present it boots that record, hides formal catalog/manual-save/import/export controls and never calls `/api/games/:gameId`.

- [ ] **Step 1: Write failing UI tests**: `assert.equal(items[0].id, newestId)` and render includes date/short ID/未开始; unsaved edits leave `createCalls === 0`; start opens a new ID URL with `_blank`, continue opens the old ID, deletion asks confirmation; playtest view hides formal save controls and calls no `/api/games/` endpoint.
- [ ] **Step 2: Run** `npx tsx --test tests/creator-playtest-ui.test.ts`; expect failure.
- [ ] **Step 3: Add** toolbar entry and drawer, route handling in `main.tsx`, runtime client selection in `App`, and playtest-only UI restrictions. Reuse the existing `PlayerForm`, game panes and chat stream, including real AI loading/error states.
- [ ] **Step 4: Run** `npx tsx --test tests/creator-playtest-ui.test.ts && npm run build && npm test`; expect PASS. Manually verify a fresh and a resumed playtest in separate tabs against a saved draft.
- [ ] **Step 5: Commit** only this task's files with `feat: launch and resume draft playtests`.
