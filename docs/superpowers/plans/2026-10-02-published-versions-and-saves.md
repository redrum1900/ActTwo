# Published Versions and Pinned Saves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every approved script snapshot and make each save playable only with its original published version while new games use the latest.

**Architecture:** Add append-only MySQL publication history beside the latest-publication lookup. Approval allocates a release number and hashes its frozen review snapshot atomically. Save APIs resolve scripts by the saved `(scriptId, scriptVersion, scriptHash)` before reads or overwrites; the UI distinguishes latest version from save version.

**Tech Stack:** TypeScript, MySQL 8/mysql2, Express, React, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-02-published-versions-and-saves-design.md`

## Global Constraints

- First new publication: `1.0`; next: `1.1`, `1.2`, …, `1.10`.
- No author-editable release version; pending/rejected reviews do not reserve one.
- New game overwrites auto slot 0; manual slots 1–5 remain unchanged.
- Existing published JSON, version, and hash must survive MySQL v1→v2 migration byte-for-byte.
- Missing or mismatched saved snapshot never falls back to the latest script or overwrites auto.
- Do not log or expose MySQL/AI credentials; do not use production story data as test fixtures.

## Review Focus

- Duplicate concurrent approval of one review: one succeeds, the other conflicts, and only one sequence is consumed (Task 2 test).
- Migration run twice or interrupted after table creation: recover/backfill without duplicate history (Task 1 test).
- Old manual save contains a location removed in the latest release: render the saved location from its own snapshot (Task 4 test).
- Missing or altered historical snapshot: show the slot but disable loading, preserve auto on attempted load/import (Task 3 test).
- Old snapshot references an image removed from the latest draft: public image read and cleanup still retain it (Task 5 test).

---

### Task 1: MySQL publication history and migration

**Files:** Modify `apps/api/src/db/migrations.ts`; create `apps/api/src/db/mysql-published-versions.ts`; test `tests/mysql-published-versions.test.ts`.

**Interfaces:** Produce `getLatest(projectId): Promise<GameScript | null>`, `getExact(projectId, version, hash): Promise<GameScript | null>`, `listLatest(): Promise<GameScript[]>`, and a transaction-scoped `publish(connection, projectId, reviewId, frozenScript): Promise<GameScript>` in a dedicated store. `publish` owns release numbering, version assignment, rehashing and history/latest writes; caller owns the surrounding transaction/project lock.

- [ ] Add a failing migration test using a disposable test database (never the configured production schema): v1 current row backfills as sequence 1 with unchanged JSON/version/hash, repeated migrate is idempotent, and partial table creation can resume. Keep a mock-pool unit test runnable without MySQL.
- [ ] Run `npx tsx --test tests/mysql-published-versions.test.ts`; expect the new unit assertions to fail before implementation.
- [ ] Implement v1→v2 migration and the publication store with unique `(project_id, release_sequence)` and `(project_id, version)` constraints. Do not alter a legacy row's version/hash during backfill.
- [ ] Run the focused test again; expect PASS. Run `npm run build`; expect exit 0.
- [ ] Commit only Task 1 files.

### Task 2: Approval creates an immutable, system-numbered publication

**Files:** Modify `apps/api/src/db/mysql-review-store.ts`, `apps/api/src/db/mysql-project-store.ts`, `apps/api/src/creator/review-store.ts` only if the SQLite test compatibility path needs the same public response; test `tests/mysql-published-versions.test.ts`.

**Interfaces:** Consume Task 1 `publish`. The MySQL project store delegates latest/exact/list lookups to publication history and exposes `getPublishedExact(id, version, hash)`. Approved review summaries show assigned version; pending/rejected summaries do not advertise draft version as a release.

- [ ] Add failing tests: first approval yields `1.0`, next yields `1.1`, rejection consumes no number, first approved JSON remains unchanged, and duplicate concurrent approval of one review consumes only one sequence.
- [ ] Run focused test; expect these new assertions to fail.
- [ ] Make `approve` lock the project, validate frozen content, call `publish`, and update the review with its allocated version in the same transaction; route project reads through history.
- [ ] Run focused tests and `npm run build`; expect PASS.
- [ ] Commit only Task 2 files.

### Task 3: Pin all save/gameplay API reads to their recorded snapshot

**Files:** Modify `apps/api/src/script-repository.ts`, `apps/api/src/app.ts`, `apps/api/src/db/mysql-save-store.ts` only if slot metadata or transaction boundaries require it; test `tests/mysql-save-api.test.ts` and `tests/api.test.ts`.

**Interfaces:** Add `getExact(id, version, hash)` to async script repository. `resolveSaveScript(save.state)` uses that exact lookup and verifies `scriptId`. `GET /games/:id/slots` returns `scriptVersion`, `updatedAt`, `loadable` and saved-version location for every slot. `current` and manual/import paths use exact lookup; `/new` keeps using latest.

- [ ] Add failing API tests: an old auto save continues after 1.1; `/new` starts 1.1 and replaces only auto; old manual slot remains listed/loadable, loading restores 1.0; export/import retains 1.0; missing/hash-mismatched snapshot leaves auto unchanged.
- [ ] Run focused tests; expect version-pinning assertions to fail.
- [ ] Implement exact lookup and route current/chat/action/debug/memory/slot-load/import through it. Keep unresolved slots visible with `loadable=false`; never silently use latest.
- [ ] Run focused tests and `npm run build`; expect PASS.
- [ ] Commit only Task 3 files.

### Task 4: Show latest and saved versions distinctly

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/App.tsx`; test `tests/api.test.ts` or a focused UI contract test in `tests/`.

**Interfaces:** Catalog/menu `version` is latest. Slot summary adds `scriptVersion` and `loadable`; session `view.script.version` remains the pinned version.

- [ ] Add failing tests for catalog/menu latest version, slot version/time with saved-snapshot location, and `loadable=false` UI/API behavior.
- [ ] Run focused tests; expect FAIL.
- [ ] Show latest version on catalog/menu, slot version with full saved date/time, active-session version in game; disable load for unresolved slots while leaving them visible.
- [ ] Run focused tests and `npm run build`; expect PASS.
- [ ] Commit only Task 4 files.

### Task 5: Keep old-version images reachable

**Files:** Modify `apps/api/src/db/mysql-cover-assets.ts`; test `tests/creator-item-image-ui.test.ts` and a focused MySQL asset test.

**Interfaces:** `linked(kind, asset, published)` checks all retained published snapshots for public reads, cleanup, and discard protection, not just latest.

- [ ] Add failing test: an image referenced only by 1.0 remains publicly readable after 1.1 removes it and cannot be orphan-cleaned or discarded.
- [ ] Run focused test; expect FAIL.
- [ ] Extend published linkage to retained versions; keep draft linkage behavior unchanged.
- [ ] Run focused tests, `npm test`, and `npm run build`; expect PASS.
- [ ] Commit only Task 5 files.

### Task 6: Remote MySQL smoke and migration handoff

**Files:** Update `docs/architecture.md` and `README.md` only for observable version/save behavior.

**Interfaces:** No new runtime interfaces. Production data is never reset; test records use unique IDs and clean up exactly their own rows in foreign-key order.

- [ ] Run `npm test` and `npm run build`; expect both PASS.
- [ ] Run write-capable MySQL integration tests only against an explicitly separate disposable test schema. Check the configured remote production schema read-only for migration compatibility and report the result; applying its v2 migration requires a separate deployment step and backup, not a test command. Do not print credentials or existing story JSON.
- [ ] Document system-numbered releases, old-save behavior, and auto overwrite; run `git diff --check`; expect no whitespace errors.
- [ ] Commit only documentation changed by this task.
