# Player Page Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the catalog, story detail, and gameplay independent URLs and page components, including the corresponding playtest pages, without changing save semantics.

**Architecture:** A small route parser and history adapter make URL the source of truth. `App.tsx` becomes a route shell; catalog, detail, and gameplay components own their respective data loading and local UI state. Existing API and save endpoints remain authoritative for published and playtest snapshots.

**Tech Stack:** React 19, TypeScript, browser History API, Node `tsx --test`, `@testing-library/react` + `jsdom` for interactive page tests; no new router dependency.

**Spec:** `docs/superpowers/specs/2026-10-03-player-page-routing-design.md`

## Global Constraints

- Main URLs: `/`, `/games/:id`, `/games/:id/play`.
- Playtest URLs: `/playtest/:projectId/:playtestId` and the same path with `/play`.
- `/games/:id/continue` remains compatible and canonicalizes to `/games/:id/play` via replace, not push.
- Detail shows latest published version; gameplay shows the auto-save's pinned version. Direct `/play` must not create or overwrite a save.
- Player-form and save-selection steps have no new URL and may reset on refresh. Gameplay panes remain local state.
- Reuse existing save, publication, login, and playtest APIs. Do not change save format or game rules.

## Review Focus

- Percent-encoded IDs and trailing slashes resolve to one canonical page; Task 1 route tests.
- Browser back/forward after loading a manual save restores the current auto-save without reloading that manual slot; Tasks 1 and 3 tests.
- Account loading or login dialog cannot be mistaken for a missing auto-save; Task 4 auth-navigation test.
- A deleted story/expired playtest differs from a temporary network failure; Tasks 2 and 3 error-state tests.
- A late chat/action response after navigation cannot change the new page or repeat a mutation; Task 3 lifecycle test.

---

## File Structure

- Create `apps/web/src/player-route.ts`: route union, parser, path builders, canonicalization.
- Create `apps/web/src/player-navigation.ts`: History API navigation and `popstate` subscription; URL-based React hook.
- Create `apps/web/src/StoryCatalogPage.tsx`: catalog loading and cards.
- Create `apps/web/src/StoryDetailPage.tsx`: latest detail, transient new-game form/save selection, login-gated mutations.
- Create `apps/web/src/GameplayPage.tsx`: current auto-save loading, gameplay UI and actions; existing UI moved from `App.tsx`.
- Create `tests/player-dom.ts`: jsdom initialization for interactive React tests.
- Modify `apps/web/src/App.tsx`: page routing only, shared notices/errors, and transitions between page components.
- Modify `apps/web/src/main.tsx` and `apps/web/src/playtest-client.ts`: recognize both playtest routes and preserve other app entry points.
- Modify `apps/web/src/api.ts` only if typed API errors are needed to distinguish 404/no-save from temporary failure.
- Test in `tests/player-route.test.ts`, `tests/player-navigation.test.ts`, `tests/player-pages.test.ts`, and existing auth/playtest/versioned-save tests. The `.test.ts` suffix ensures the repository's `npm test` glob includes the file.

### Task 1: URL Model and Browser History

**Files:** Create `apps/web/src/player-route.ts`, `apps/web/src/player-navigation.ts`, `tests/player-route.test.ts`, `tests/player-navigation.test.ts`.

**Interfaces:** Produce `PlayerRoute` discriminated union (`catalog`, `story-detail`, `story-play`, `playtest-detail`, `playtest-play`, `not-found`); `parsePlayerRoute(pathname: string): { route: PlayerRoute; canonicalPath?: string }`; `playerRoutePath(route: PlayerRoute): string`; `usePlayerRoute(): [PlayerRoute, (route: PlayerRoute, replace?: boolean) => void]`. Consumers must not keep a second main-page state.

- [ ] **Step 1: Write failing parser tests.** Assert `/`, `/games/sword`, `/games/sword/play`, both playtest paths, encoded IDs, trailing slash, and `/games/sword/continue` → canonical `/games/sword/play`; an unrelated path is `not-found`.
- [ ] **Step 2: Run `npx tsx --test tests/player-route.test.ts`; verify failures are missing route behavior.**
- [ ] **Step 3: Implement `parsePlayerRoute` and `playerRoutePath` with safe decode and round-trip encode.** Keep creator and usage URLs outside this parser's mount point.
- [ ] **Step 4: Write failing navigation tests.** A fake History API receives push for ordinary navigation, replace for legacy canonicalization; a `popstate` event emits the route at the new pathname, without another push.
- [ ] **Step 5: Run `npx tsx --test tests/player-navigation.test.ts`; verify red.**
- [ ] **Step 6: Implement History adapter and `usePlayerRoute`.**
- [ ] **Step 7: Run both route tests and `npm run build`; verify green.**
- [ ] **Step 8: Commit only Task 1 files.**

### Task 2: Catalog and Detail Pages

**Files:** Create `apps/web/src/StoryCatalogPage.tsx`, `apps/web/src/StoryDetailPage.tsx`, `tests/player-dom.ts`, `tests/player-pages.test.ts`; modify `apps/web/src/App.tsx`, `package.json`, `package-lock.json`.

**Interfaces:** `StoryCatalogPage({ onOpen }: { onOpen(id: string): void })`; `StoryDetailPage({ storyId, playtest, onPlay, onBack }: { storyId: string; playtest?: PlaytestLink; onPlay(): void; onBack(): void })`. Detail owns `overview | new | saves` transient step, latest `GameDetail`, start/continue/manual-load/import operations, and returns to overview on remount.

- [ ] **Step 1: Add jsdom and React Testing Library dev dependencies and initialize them in `tests/player-dom.ts`.**
- [ ] **Step 2: Write failing page tests.** Render catalog/detail with controlled API responses: catalog card opens the detail URL; detail exposes latest version, new-game and saves steps do not alter route; deleted story/expired playtest renders unavailable, while transient failure offers retry.
- [ ] **Step 3: Run `npx tsx --test tests/player-pages.test.ts`; verify red.**
- [ ] **Step 4: Extract catalog and detail JSX/logic from `App.tsx` into the two components.** Keep existing form, cover, confirmation and save behavior; after successful start/load/import call `onPlay`, never call it on cancel or failure. Use status-aware API errors only where necessary.
- [ ] **Step 5: Run page tests, existing `tests/player-form-runtime.test.ts`, and `npm run build`; verify green.**
- [ ] **Step 6: Commit only Task 2 files.**

### Task 3: Gameplay Page and Auto-Save Recovery

**Files:** Create `apps/web/src/GameplayPage.tsx`; extend `tests/player-pages.test.ts`; modify `apps/web/src/App.tsx` to remove moved gameplay state/UI.

**Interfaces:** `GameplayPage({ storyId, playtest, onExit, onNoSave }: { storyId: string; playtest?: PlaytestLink; onExit(): void; onNoSave(message: string): void })`. It loads `/games/:id/current` or `playtestClient(link).current()` on mount and owns panes, chat stream, action, drawers, and manual-save drawer. No `new` or manual-load call occurs from route mount.

- [ ] **Step 1: Write failing tests.** Direct gameplay mount issues one `current` read and shows its pinned version; missing auto-save calls `onNoSave` without mutation; expired playtest is unavailable; network failure remains on the same route with retry; manual-load then back/forward re-reads auto only; late response after unmount is ignored.
- [ ] **Step 2: Run `npx tsx --test tests/player-pages.test.ts`; verify red.**
- [ ] **Step 3: Move existing gameplay UI/handlers into `GameplayPage`; guard async completions after unmount.** Preserve versioned-save, action revision, chat retry and playtest API behavior.
- [ ] **Step 4: Run page tests, chat/stream/versioned-save tests, and `npm run build`; verify green.**
- [ ] **Step 5: Commit only Task 3 files.**

### Task 4: App Integration, Auth, and Deep Links

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/playtest-client.ts`; extend `tests/player-route.test.ts`, `tests/player-auth-ui.test.ts`, `tests/creator-playtest-ui.test.ts`, `tests/player-pages.test.ts`.

**Interfaces:** `App` selects exactly one of the three page components from `usePlayerRoute`; route builders from Task 1 drive all catalog/detail/playtest transitions. `AccountGate` keeps the requested `/play` target through login, then gameplay reads `current` once. Non-player paths continue to their current roots.

- [ ] **Step 1: Write failing integration tests.** Verify direct link, refresh, back/forward, legacy `/continue` replace, login then play, no-save redirect with notice, playtest route isolation, and missing-story vs network-error handling.
- [ ] **Step 2: Run the relevant test files; verify red.**
- [ ] **Step 3: Wire route shell and both playtest paths; remove `screen` as the main-page source of truth.** Keep transient detail steps and gameplay panes local. Preserve current `/creator` and `/usage` dispatch.
- [ ] **Step 4: Run focused tests, `npm test`, `npm run build`, and `git diff --check`; verify all results.** Inspect desktop/narrow layouts and browser console if a browser is available; report if not.
- [ ] **Step 5: Commit only Task 4 files and test updates.**
