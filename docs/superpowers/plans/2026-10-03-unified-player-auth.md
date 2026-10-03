# Unified Player and Creator Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require the existing creator account for formal play and use its ID for every game save and gallery entry.

**Architecture:** Reuse `creator_accounts`/`creator_sessions` and broaden the session Cookie to `/api`. A focused account middleware supplies trusted `account.id` to game routes; public story browsing remains anonymous, while all stateful game routes require login. The web app reuses the same login/register endpoints.

**Tech Stack:** Express 5, TypeScript, MySQL, React 19, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-03-unified-player-auth-design.md`

## Global Constraints

- A registered `author` can play and create; `admin` alone can review, import and inspect all AI use.
- Anonymous users may browse published stories but cannot create, resume, mutate or read saves.
- Do not migrate, claim, delete or use existing `gd_guest` saves; preserve published version pinning.
- Cookie remains HttpOnly, SameSite=Lax and Secure in production; state-changing routes retain same-origin protection.
- Current worktree contains unrelated changes; stage only task-owned files and run remote MySQL checks only against a disposable schema.

## Review Focus

- A catalog request without login returns public games but no personal `hasAuto`; Task 2 tests this.
- A forged `gd_guest` Cookie cannot start or read a game; Task 2 tests this.
- Account switching cannot reveal the previous account's saves or gallery; Task 2 tests this.
- Logout clears the broadened Cookie path and blocks stateful APIs; Tasks 1 and 3 test this.
- Unauthenticated deep links to a game lead to login and resume after login; Task 3 tests this.

---

### Task 1: Shared Account Session

**Files:** Create `apps/api/src/account-session.ts`; modify `apps/api/src/creator/auth-router.ts`; test `tests/player-auth.test.ts`.

**Interfaces:** Produce `sessionTokenFrom(req: Request): string | undefined`, `accountForRequest(req: Request, store: CreatorStore | MysqlCreatorStore): Promise<CreatorAccount | null>`, and `requireAccount(store): RequestHandler`, setting `res.locals.account` after successful verification. Existing creator login/register/logout continue returning the same account shape.

- [ ] **Step 1: Write failing tests** in `tests/player-auth.test.ts`: assert `setCookie.includes('Path=/api')`, login/logout clear any old `Path=/api/creator` Cookie with the same name, logout clears `Path=/api`, and `assert.equal(anonymous.status, 401)` for missing/expired tokens.
- [ ] **Step 2: Run** `npx tsx --test tests/player-auth.test.ts`; expect failure because shared middleware or path behavior is absent.
- [ ] **Step 3: Implement** the three interfaces above, reuse existing `accountFor`, and move Cookie path from `/api/creator` to `/api` in both set and clear options; preserve origin checks on unsafe methods.
- [ ] **Step 4: Run** `npx tsx --test tests/player-auth.test.ts tests/creator-api.test.ts`; expect PASS.
- [ ] **Step 5: Commit** only this task's files with `feat: share account session across game and creator`.

### Task 2: Bind Formal Game State to Account IDs

**Files:** Modify `apps/api/src/app.ts`; test `tests/player-auth.test.ts`, `tests/api.test.ts`, `tests/mysql-save-api.test.ts`, `tests/versioned-save-api.test.ts`.

**Interfaces:** Consume `accountForRequest`/`requireAccount` from Task 1. `owner(res: Response): string` returns the authenticated account ID only; public catalog/detail compute anonymous-safe payloads without an owner. `queueMemory` continues receiving this account ID.

- [ ] **Step 1: Add failing API assertions**: `assert.equal(catalog.status, 200)` and `assert.equal(catalog.games[0].hasAuto, false)` anonymously; `assert.equal(response.status, 401)` for anonymous `/new`, `/current`, `/slots`, `/action`, `/chat/stream` and save import/export even with `gd_guest`; account B's current request reports no own save after A saves, B's gallery excludes A's unlocks, and cross-origin writes return 403.
- [ ] **Step 2: Run** `npx tsx --test tests/player-auth.test.ts tests/api.test.ts tests/mysql-save-api.test.ts tests/versioned-save-api.test.ts`; expect auth assertions to fail.
- [ ] **Step 3: Replace** guest middleware with account resolution, guard every stateful game and gallery route, preserve public routes, and use the authenticated ID for all save/gallery calls. Add or retain same-origin checks on unsafe game methods.
- [ ] **Step 4: Run** the Step 2 command; expect PASS and existing versioned-save assertions unchanged.
- [ ] **Step 5: Commit** only this task's files with `feat: require account for formal play`.

### Task 3: One Login Experience in Web App

**Files:** Create `apps/web/src/account-client.ts`, `apps/web/src/AccountGate.tsx`; modify `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/creator/CreatorApp.tsx`, `apps/web/src/styles.css`; test `tests/player-auth-ui.test.ts`.

**Interfaces:** `accountClient` exposes `me`, `login`, `register`, `logout` using the existing `/api/creator` auth endpoints; `AccountGate` accepts `{ children, requireLogin }` and shares account state with catalog/game and creator entrypoints. Login completion retries the originally requested start/continue action.

- [ ] **Step 1: Write failing UI tests** asserting `screen === 'catalog'` before login, start/continue yields a login prompt, successful login calls the pending action exactly once, creator route recognizes the same session, and logout leaves no playable session.
- [ ] **Step 2: Run** `npx tsx --test tests/player-auth-ui.test.ts`; expect failure.
- [ ] **Step 3: Implement** shared account state and game login/register/logout UI; avoid a second creator-only login state, preserve current game route and session UI behavior.
- [ ] **Step 4: Run** `npx tsx --test tests/player-auth-ui.test.ts && npm run build && npm test`; expect PASS.
- [ ] **Step 5: Commit** only this task's files with `feat: unify player and creator login UI`.
