# Story, Player, and NPC Runtime Implementation Plan

> Later author decision: merge script-level `placements.json` into `locations.json`. Any task below naming `GameScript.placements` or the former file is implemented as `LocationDefinition.visibleWhen` / `enterWhen` in the single location file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inferred NPC placement with persisted location, add optional player indicators/rules and runtime snapshots, and make Su Nian the sole current script without migrating old saves.

**Architecture:** JSON files remain definitions. The save owns mutable facts; the engine computes story/player/NPC views, evaluates all gates, and settles effects before API persistence. Existing NPC semantic classification stays NPC-local, while player rules and NPC automatic rules share a deterministic one-pass settlement.

**Tech Stack:** TypeScript, Node.js/Express, React, better-sqlite3, `tsx --test`, Vite.

**Spec:** `docs/superpowers/specs/2026-10-01-story-player-npc-runtime-design.md`

## Global Constraints

- `locations.json` holds each location's permanent visibility and current-entry conditions; NPC position is stored in `GameState.npcLocations`.
- NPC `base.initialLocationId` starts at `电脑上` for Su Nian; `moveNpc` changes it independently of player access.
- Optional player files are `player/indicators.json` and `player/rules.json`; NPC rules default their effect target to self, player rules to player.
- Existing saves are not migrated. Remove `content/mystery-town/`, its legacy engine branches and tests, and only precisely identified old database rows; leave backups and AI logs untouched.
- The repository has no `.git` directory: omit commit steps rather than initializing a repository. Run focused tests during development and the full suite plus build after all tasks, as the user requested for final acceptance.

## Review Focus

1. A visible but non-enterable location must remain visible, reject direct API movement, and keep a player already inside until they leave (Task 3).
2. A missing cross-target NPC must skip only that effect; another valid effect must apply, and an all-skipped `once` rule must remain available (Task 4).
3. A hidden player indicator must not appear in public view, log, AI state, or an AI candidate that lacks the NPC knowledge gate (Tasks 5 and 6).
4. An NPC moving to a still-locked location must disappear from the old scene and close chat only after a coherent final reply (Tasks 3 and 6).
5. A same-version script JSON edit must invalidate its existing save, while the album stays durable across manual save loads (Task 7).

---

### Task 1: Contracts and script loading

**Files:** Modify `packages/contracts/src/index.ts`, `packages/script/src/index.ts`; create `tests/runtime-script.test.ts` and a minimal new-schema fixture under `tests/fixtures/runtime-story/`.

**Interfaces:** Produce `GameScript.placements`, `GameScript.playerIndicators`, `GameScript.playerRules`, `NpcDefinition.initialLocationId`, `LocationDefinition.interactionMode`, `Condition.playerIndicator/playerField/npcLocation`, `Effect.target/moveNpc`, and `GameState.playerIndicators/npcLocations/scriptHash`. `loadScript(id, root = contentRoot)` reads optional player parts and required new `placements.json`; the explicit `root` lets tests load the new-schema fixture before Su Nian content is migrated. `validateScript` checks one placement per location and target types.

- [ ] Write `tests/runtime-script.test.ts`: load the minimal fixture through the `root` argument; assert global placements, optional player files default to `[]`, no NPC placement, and bad location/indicator/target references produce path-bearing diagnostics.
- [ ] Run `npx tsx --test tests/runtime-script.test.ts`; expect missing schema/loading tests to fail.
- [ ] Add the declared types, loader normalization, and validation. Keep name-to-ID normalization for location, item, NPC and target references. Unknown target is a diagnostic warning, not a runtime crash.
- [ ] Run the focused test; expect pass. Run `npm run build` to catch type errors before the next task.

### Task 2: Player/NPC canonical state and condition evaluator

**Files:** Modify `packages/engine/src/index.ts`, `packages/engine/src/state-migration.ts`; create `tests/runtime-state.test.ts`.

**Interfaces:** `createInitialState(script, player)` fills `playerIndicators` and `npcLocations`; `evaluateCondition` supports `playerIndicator`, `playerField`, and `npcLocation`; `deriveNpcSnapshot` reads `state.npcLocations[npcId]` and current persona. `itemStates` stays the sole inventory owner.

- [ ] Write tests asserting initial NPC position equals `initialLocationId`, player indicator initial values and visibility are copied, a target NPC can be at a locked location, and nested `all/any/not` conditions read player fields/indicators/NPC location.
- [ ] Run `npx tsx --test tests/runtime-state.test.ts`; expect failure on missing canonical fields.
- [ ] Implement initialization and condition checks. Remove legacy state hydration from the new flow rather than silently reconstructing old saves.
- [ ] Run the focused test and `npm run build`; expect pass.

### Task 3: Story snapshot, location access, and NPC presence

**Files:** Modify `packages/engine/src/index.ts`, `apps/api/src/app.ts`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`; create `tests/location-access.test.ts`.

**Interfaces:** `canEnterLocation(script: GameScript, state: GameState, locationId: string): boolean` is shared by `makeView` and API move. `makeView` returns each unlocked location with `enterable`, current-scene NPCs from `npcLocations`, and player snapshot fields. A location's `interactionMode` supplies the UI/AI channel label.

- [ ] Write tests: permanent visible unlock remains after its condition turns false; `enterWhen` flips `enterable` and direct move authorization; current player is not ejected; NPC movement is independent of place unlock.
- [ ] Run `npx tsx --test tests/location-access.test.ts`; expect failure.
- [ ] Implement the shared access function, change `refreshWorld` to read global placements, change `npcPresent` and `makeView`, then update API move and disabled-card UI to use `enterable`.
- [ ] Run focused tests and `npm run build`; expect pass.

### Task 4: Targeted effects and one-pass player/NPC settlement

**Files:** Modify `packages/engine/src/index.ts`, `packages/engine/src/activity-log.ts`, `packages/contracts/src/index.ts`; create `tests/player-rules.test.ts`.

**Interfaces:** Indicator effects resolve optional `target` against rule owner; `moveNpc` accepts NPC only. `settleWorld(script, before, afterEffects, action)` collects eligible player/NPC automatic rules against a shared post-primary state and applies them in stable priority/ID order without same-operation cascade. Action rules honor `actions`; `once` completes only after a real state change.

- [ ] Write tests: default self target for NPC/player; explicit cross-target change; absent target skips only its effect; all-skipped `once` stays pending; invalid non-target effect rolls back its rule; action filter; two-stage automatic chain waits for another valid operation; owner-scoped exclusive groups.
- [ ] Run `npx tsx --test tests/player-rules.test.ts`; expect failure.
- [ ] Implement rule-owner resolution and per-effect diagnostics without weakening non-target validation. Add player rule execution to settlement, keeping the current NPC semantic candidate path separate.
- [ ] Run focused tests and `npm run build`; expect pass.

### Task 5: Logs, gallery, and public snapshot filtering

**Files:** Modify `packages/engine/src/activity-log.ts`, `packages/engine/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/save-store.ts`; modify `tests/activity-log.test.ts`, `tests/save-store.test.ts`.

**Interfaces:** Activity changes include visible player indicator and NPC move; hidden indicator changes have no public detail. `createSaveStore` gains an atomic auto-save+gallery-awards method; GET paths read but never award gallery. Public view masks hidden story/NPC/player data.

- [ ] Write tests: hidden curse changes leave public log/view clean but rule narration may be shown; NPC move appears in log; ending/achievement awards survive manual load; GET current/catalog never mutates gallery; save/gallery commit is atomic.
- [ ] Run the two focused test files; expect failure.
- [ ] Implement filtering, change collection and transactional save/gallery persistence. Keep album keyed by owner/game/kind/id.
- [ ] Run focused tests and `npm run build`; expect pass.

### Task 6: AI context, semantic candidate privacy, and departing NPC

**Files:** Modify `apps/api/src/ai-adapter.ts`, `apps/api/src/chat-service.ts`, `apps/web/src/App.tsx`; modify `tests/chat.test.ts`, `tests/ai-errors.test.ts`, `tests/chat-stream.test.ts`.

**Interfaces:** `buildAIState` uses current location mode and current NPC persona; no blanket player-indicator dump. Current NPC `candidateWhen` gates semantic candidates; backend still validates full `when`. Movement during chat forces reply reconciliation and the final view removes the NPC, after which the existing UI departure handler closes chat.

- [ ] Write tests: hidden player curse absent from prompt/candidates before NPC knows; after a targeted knowledge indicator change, matching persona/lore and candidate appear; only current NPC candidates sent; movement produces a coherent final reply, removes NPC from current view, and UI departure predicate detects it.
- [ ] Run focused tests; expect failure.
- [ ] Implement the AI projection and movement-aware reply rewrite, with existing raw-history compression and streamed pending player message behavior preserved.
- [ ] Run focused tests and `npm run build`; expect pass.

### Task 7: Su Nian migration, version binding, and obsolete-content removal

**Files:** Modify `content/sword-and-screen/{manifest,locations}.json`, `content/sword-and-screen/npcs/su-nian/{base,rules,personas}.json`, `packages/script/src/index.ts`, `apps/api/src/app.ts`; create `content/sword-and-screen/placements.json`, optional `content/sword-and-screen/player/{indicators,rules}.json`, `tests/su-nian-flow.test.ts`; delete `content/sword-and-screen/npcs/su-nian/placements.json`, `content/mystery-town/` and obsolete legacy tests/engine branches; update remaining tests.

**Interfaces:** `loadScript` yields a deterministic normalized content hash; new save stores it and `compatible` checks it plus version. Su Nian opens at `电脑上`, moves explicitly to restaurant/home via rules, with player modules allowed to be empty. Catalog contains only `sword-and-screen`.

- [ ] Write end-to-end tests for Su Nian fresh game → online chat → rule-driven restaurant move → unlocked restaurant → later home; assert catalog has one story and same-version JSON hash mismatch rejects old save.
- [ ] Run `npx tsx --test tests/su-nian-flow.test.ts`; expect failure.
- [ ] Migrate Su Nian JSON and raise version; remove old story and its stage-only engine branches. Replace mystery-town-based tests with small in-memory new-schema fixtures rather than deleting coverage for save, API or AI errors.
- [ ] Run focused story/API/script/engine tests and `npm run build`; expect pass.

### Task 8: Documentation, scoped data cleanup, and final verification

**Files:** Modify `README.md`, `docs/苏念剧本配置入门.md`, `docs/architecture.md`; modify exact rows in `data/game.sqlite` after read-only count check. Do not edit `data/backups/` or `data/ai-requests.jsonl`.

**Interfaces:** Public docs describe only the new config paths and ownership model. Cleanup targets existing `save_slots` for `mystery-town` and `sword-and-screen`, plus `gallery` for deleted `mystery-town`; Su Nian gallery remains.

- [ ] Update documentation with JSON examples for global placements, NPC initial position/move, optional player files, target defaults, snapshot boundaries, and no old-save migration.
- [ ] Run read-only SQL counts grouped by game ID; record exact rows before deletion. Then delete only the specified `save_slots`/`gallery` rows in one transaction, after verifying no other game IDs are selected.
- [ ] Run `npm test` and `npm run build`; expect all tests and type/build checks to pass. Run a fresh Su Nian game through online → restaurant → home, including a visible-but-locked location and an NPC departure; report the observed result and any residual issue.
