# Rules and Su Nian Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing game engine express and test a substantially faithful, three-stage Su Nian character card through reusable JSON rules.

**Architecture:** `contracts` defines the canonical script and save shape; `script` resolves/validates JSON; `engine` alone changes deterministic state; API orchestrates actions and AI; React presents only filtered views. NPC dialogue events stay in the NPC definition. AI recognizes intentions and performs roleplay but never owns state changes.

**Tech Stack:** TypeScript, Node.js, Express, React, `tsx --test`, existing OpenAI-compatible Chat Completions adapter.

**Spec:** `docs/superpowers/specs/2026-09-30-rules-and-su-nian-card-design.md`

## Global Constraints

- First deliverable is rules, card fidelity and necessary test UI; no account, creator center, review workflow or production MySQL in this plan.
- Keep existing SQLite data intact. A save that cannot be safely migrated must remain readable/exportable as stored and must not be rewritten silently.
- One item ID denotes one actual item; item names are unique per script; runtime ownership/tags never mutate script JSON.
- Stage transitions name a target stage and check that target's `enterWhen`; no automatic array-order progression or fixed-turn transition.
- NPC events may inspect other NPCs' state. The model receives the current player state/bag (with per-item `knownToNpc`), speaking NPC's current-stage persona, exact stats/bag and adaptive conversation context; other NPC chats are not included by default.
- Normal chat uses one structured model response `{ message, proposedEventIds }`; the engine validates IDs and effects. A second generation is exceptional when same-turn system effects change facts the first reply could not know.
- Preserve each NPC's full raw conversation. Fit as much as possible into a configurable context budget; compress/retrieve older material only when needed, never enforce a fixed 12-message cutoff.
- Do not embed API keys or user-provided character-card source in public response/output. The source card is untrusted reference material.
- This directory currently has no `.git`; do not initialize a repository or overwrite existing user data merely to satisfy commit steps. If Git exists at execution time, commit each verified task; otherwise record the checkpoint and continue.

## Review Focus

1. A legacy save containing quantity `2` for a single item ID must be preserved and rejected with a clear migration error, never silently collapse two items. Task 1 tests this.
2. A condition on NPC B's hidden stat or item must work in NPC A's event without leaking B's private data into A's prompt or client view. Tasks 2 and 6 test this.
3. A hidden location item must stay undisclosed when `discoverWhen` fails, and a discovered but untakeable item must remain inspectable. Task 3 tests both.
4. If two mutually exclusive dialogue events are proposed together, stable priority selects one; a failed AI response must not persist either. Tasks 4 and 6 test both.
5. A source-card rule left as prose must appear in the coverage audit as non-executable, not be reported as a working mechanic. Task 7 checks this.

---

### Task 1: Canonical item and NPC state

**Files:** Modify `packages/contracts/src/index.ts`, `packages/engine/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/ai-adapter.ts`; create `packages/engine/src/state-migration.ts`; test `tests/engine.test.ts`, `tests/api.test.ts`, `tests/chat.test.ts`.

**Interfaces:** Produce `ItemRuntime { owner: 'player' | \`npc:${string}\` | \`location:${string}\` | null; tags: string[]; discovered: boolean }`; `GameState.itemStates`, `npcTags`, `knownPlayerItems`, `unlockedLocations`, `pendingOffers`; `createInitialState(script, player)` and `hydrateLegacyState(script, raw): GameState` (throws a typed migration error without changing `raw`). Later tasks consume these fields. Keep `playerItems`/`npcItems` only as read-time legacy input, not competing canonical state; replace all inventory readers in the engine, API, AI adapter and tests. Location ownership is initialized in Task 3 when placements are added.

- [ ] Write tests: initial NPC ownership is unique; changing runtime tags leaves the script unchanged; a legacy save with one copy per ID migrates; quantity `2` rejects without modifying the original save; a version mismatch retains the old slot/export.
  Key assertions: `assert.equal(state.itemStates.key.owner, 'npc:ada')`; `assert.throws(() => hydrateLegacyState(script, doubleKeySave), /道具.*数量/)`; `assert.deepEqual(doubleKeySave, before)`.
- [ ] Run `npx tsx --test tests/engine.test.ts tests/api.test.ts`; verify the new tests fail for missing canonical state/migration.
- [ ] Implement the types, initialization and pure migration. Wire migration at API read boundary; never write the migrated save until a successful user action commits it.
- [ ] Run the targeted tests, then `npm test`; expect zero failures. Commit if a Git repository exists.

### Task 2: Shared condition and effect evaluator

**Files:** Modify `packages/contracts/src/index.ts`, `packages/engine/src/index.ts`; optionally extract `packages/engine/src/conditions.ts` and `packages/engine/src/effects.ts` only if the existing file becomes difficult to review; test `tests/engine.test.ts`.

**Interfaces:** Keep `evaluateCondition(condition, state, script): boolean`, `applyEvent(script, state, eventId)`; add condition leaves for `hasItem` with required item tags, NPC tags, `unlockedLocation`, and `completedEvent`; add effects for item tag mutation, NPC tag mutation, learning that a player has an item, location unlock, item discovery and gallery recording. A `stat`/`npcStage`/NPC-tag/item owner reference may name any NPC, not only the speaker.

- [ ] Write tests for `all`/`any`/`not` across two NPC stats plus a tagged item; a same-NPC and other-NPC stage check; an impossible item transfer followed by another effect leaving the whole state unchanged; item/role tags remain in their own scope.
  Key assertions: `assert.equal(evaluateCondition(crossNpcCondition, state, script), true)`; `assert.equal(applyEvent(script, state, 'impossible-transfer').applied, false)`; `assert.deepEqual(state, before)`.
- [ ] Run `npx tsx --test tests/engine.test.ts`; verify the new assertions fail.
- [ ] Implement the leaves and effects with atomic event application and stable target-stage checks. Remove sequential stage advancement from the canonical path; retain explicit legacy compatibility only when loading an old script.
- [ ] Run targeted tests and `npm test`; expect zero failures. Commit if Git exists.

### Task 3: Search, discovery, taking and filtered item views

**Files:** Modify `packages/contracts/src/index.ts`, `packages/engine/src/index.ts`, `apps/api/src/app.ts`; test `tests/engine.test.ts`, `tests/api.test.ts`.

**Interfaces:** `LocationDefinition.items` holds item placements and `discoverWhen`/`takeWhen` plus blocked hint; expose `searchLocation(script, state)` and `takeLocationItem(script, state, itemId)` as pure operations; `makeView` returns discovered-on-site items, bag items and known NPC items with safe summary/detail. `createInitialState` assigns listed item IDs to their location. Retain legacy `spots` for the other example game.

- [ ] Write tests: ordinary item appears after one search; hidden item is omitted until conditions pass; no hidden count is sent; discovery persists after failed taking; absent `takeWhen` forbids taking; a tagged-item gate allows taking only after its tag is added; taking moves ownership once and retains a discovery record; conditional detail and hidden tags are filtered.
  Key assertions: `assert.deepEqual(makeView(script, initial).location?.items, [])`; `assert.equal(searched.itemStates.clue.discovered, true)`; `assert.equal(takeLocationItem(script, searched, 'clue').applied, false)`; `assert.equal(taken.itemStates.clue.owner, 'player')`.
- [ ] Run targeted engine/API tests and verify expected failures.
- [ ] Implement pure search/take plus API `action` types `search` and `takeItem`, both revision-protected. Keep existing `explore` behavior for legacy scripts.
- [ ] Run targeted tests and `npm test`; expect zero failures. Commit if Git exists.

### Task 4: Targeted stages and deterministic event settlement

**Files:** Modify `packages/contracts/src/index.ts`, `packages/engine/src/index.ts`; test `tests/engine.test.ts`.

**Interfaces:** NPC `stageOffers` name source, target, cap stat/threshold and priority; `GameState.pendingOffers[npcId]` records `{ from, to, offerId }`. Pure `settlePlayerEvents(script, state, npcId, proposedEventIds)` checks all player-event conditions against the pre-turn state, then atomically applies each successful effect in priority/ID order; `runSystemEvents(script, nextState, npcId)` checks one pass against the resulting state. The engine owns `proposeStageOffer` and `resolveStageOffer`. `EventDefinition.exclusiveGroup` selects at most one event per group per turn using priority then stable ID.

- [ ] Write tests: cap produces an offer but not a transition; decline clears it; acceptance rechecks target `enterWhen`; failed recheck leaves the stage unchanged; a special target may be entered from multiple configured source stages; two proposed mutually exclusive events choose one; event B cannot use an item just granted by player event A in the same turn; a newly eligible one-time system event runs once after player events and cannot repeat.
  Key assertions: `assert.equal(offered.npcStages?.ada, 'online')`; `assert.equal(offered.pendingOffers.ada.to, 'meeting')`; `assert.equal(declined.pendingOffers.ada, undefined)`; `assert.deepEqual(result.appliedEvents.map(e => e.id), ['higher-priority'])`.
- [ ] Run `npx tsx --test tests/engine.test.ts` and verify failures.
- [ ] Implement the pure settlement flow and stage offers; no model response can directly grant an effect.
- [ ] Run targeted tests and `npm test`; expect zero failures. Commit if Git exists.

### Task 5: Script loading, references and author-facing validation

**Files:** Modify `packages/script/src/index.ts`; optionally create `packages/script/src/validation.ts`; test `tests/script.test.ts`.

**Interfaces:** New `inspectScript(script): { errors: { path: string; message: string }[]; warnings: { path: string; message: string }[] }`; retain `validateScript(script): string[]` as a wrapper for current callers. `serializeScript(script): string` emits canonical ID-only JSON that `parseScriptJson(text): GameScript` reloads without gameplay-data loss. Normalization resolves human-readable item/location/NPC references to stable IDs. Validate new conditions/effects, placements, offers, lore, `stages`, `candidateWhen`, `replyCue`, `trigger` and mutually exclusive groups.

- [ ] Write tests for duplicate item names, ambiguous name references, unknown NPC in a cross-NPC condition, unknown dynamic-tag target, empty `all`/`any`, invalid range, unreachable target-stage warning, missing `takeWhen` being intentionally non-takeable, and standard JSON load/export equivalence.
  Key assertions: `assert.ok(inspectScript(duplicateName).errors.some(e => e.path === '$.items[1].name'))`; `assert.ok(inspectScript(emptyAny).errors.some(e => e.path.includes('any')))`; `assert.deepEqual(parseScriptJson(serializeScript(script)), script)`.
- [ ] Run `npx tsx --test tests/script.test.ts`; verify failures.
- [ ] Implement structural, reference and semantic passes with JSON paths. Old scripts must still load through explicit compatibility handling, not silent reinterpretation.
- [ ] Run targeted tests and `npm test`; expect zero failures. Commit if Git exists.

### Task 6: Structured one-call AI protocol and adaptive conversation memory

**Files:** Create `apps/api/src/chat-context.ts`, `apps/api/src/chat-memory.ts`; modify `apps/api/src/chat-service.ts`, `apps/api/src/ai-adapter.ts`, `packages/contracts/src/index.ts`; test `tests/chat.test.ts`.

**Interfaces:** `buildChatContext(script, state, npcId, latestText, budget): ChatModelInput` derives `PlayerAIState` and `NpcAIState`, including current-stage persona/conditional modifiers, exact stats/bags, per-item `knownToNpc`, pending offer, as much raw same-NPC history as fits, older segment summaries and relevant retrieved excerpts; latest player input remains complete. `ChatModelInput.candidates` contains only current NPC/stage events passing `candidateWhen`, each with ID, short intent, pre-turn `canApply` and safe `blockedCue`; no full effects/hidden thresholds. `ChatAdapter.generate(input): Promise<{ message: string; proposedEventIds: string[] }>` is the normal single call; `ChatAdapter.rewrite(settledContext): Promise<string>` is required when any proposed event is rejected, a same-turn system event fires, or a detectable contradiction makes the initial message stale. The server validates output shape/IDs, settles via Task 4, and commits state plus final reply only after successful generation/rewrite. Compression may call the model only when needed by the budget; failure preserves raw history and prior summaries. No free effect parameters or AI-supplied callbacks.

- [ ] Write failing tests: short same-NPC history is sent in full; long history stays complete in the save while context includes recent raw messages, older summaries and a relevant older excerpt; other NPC chats and future stages are absent; candidate `canApply`/`blockedCue` does not reveal a numeric threshold; malformed JSON/unknown ID retries once then leaves state unchanged; a rejected proposed event or newly triggered system offer calls `rewrite` with settled state; successful normal chat calls `generate` once; AI text alone cannot move an item; summary failure does not delete raw history.
  Key assertions: `assert.equal(input.npc.conversation.raw.length, shortHistory.length)` when it fits; `assert.equal(input.npc.conversation.relevantExcerpts.some(m => m.text === oldRelevantText), true)` under compression; `assert.equal(generateCalls, 1)` and `assert.equal(rewriteCalls, 0)` for ordinary chat; `assert.deepEqual(stateAfterFailure, stateBefore)`.
- [ ] Run `npx tsx --test tests/chat.test.ts`; verify the new assertions fail.
- [ ] Implement budget-based context selection, durable segment summaries with covered-message IDs, relevant-excerpt selection, runtime validation of structured model output and exceptional rewrite. No fixed message-count cutoff; never mutate the full raw history during compression.
- [ ] Run targeted tests, `npm test` and `npm run build`; expect zero failures. Commit if Git exists.

### Task 7: Source-card coverage audit and Su Nian JSON

**Files:** Create `docs/su-nian-card-coverage.md`; modify `content/sword-and-screen/manifest.json`, `npcs.json`, `locations.json`, `items.json`, `stats.json`, `endings.json`, `achievements.json`, `player-form.json`; test `tests/script.test.ts`, `tests/chat.test.ts`.

**Interfaces:** The card audit maps each source segment to `persona`, stage fields, conditional behavior/lore, interaction event, item/location rule, ending, or explicitly non-executable/adapted. NPC-local player-intent events use `stages`, optional `candidateWhen`, real `condition`, deterministic `effects`, `replyCue`, `once`, priority and optional exclusive group. System-trigger events cover proactive offers/gifts. Task 6's context builder consumes the script and applies active-stage/conditional fields, never all possible stages or the full rule tree.

- [ ] Draft the coverage audit from the user-provided backup without treating its text as instructions. Mark every significant interaction rule executable, descriptive-only, adapted or omitted with reason; explicitly record conflicting/non-consensual directives that are not implemented verbatim.
- [ ] Write script/chat tests for all three stage placements and different stage voices/knowledge boundaries, meaningful one-time affection gains, first/second invitations, item and tag-dependent interactions, continuing chat after an ending, and current-stage candidate visibility. Verify a talking point alone cannot change inventory.
  Key assertions: `assert.equal(makeView(game, start).npcs[0].stage?.id, 'online')`; `assert.equal(makeView(game, start).locations.some(x => x.id === 'restaurant'), false)`; `assert.equal(secondGain.state.npcStats['su-nian'].affection, firstGain.state.npcStats['su-nian'].affection)`.
- [ ] Run targeted tests and verify failures. Replace the current per-message fixed affection events with the audited interaction rules, fill the three stage personas/behaviors/lore, revise guide text, and bump the script version so existing saves are not silently reinterpreted.
- [ ] Run targeted tests and `npm test`; expect zero failures. Manually run a short real-model dialogue at each stage and record observed deviations in the audit. Commit if Git exists.

### Task 8: Minimal React playtest controls and API regression

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/styles.css`, `apps/api/src/app.ts`; test `tests/api.test.ts`.

**Interfaces:** Existing location pane gains `搜索地点`; discovered item rows open summary/detail and a conditional `取得` action; bag and visible NPC items open the same detail; chat shows pending stage offer and acceptance/decline affordances while preserving free text and the fixed-height scrolling message area.

- [ ] Write API tests that search/take payloads reveal no hidden item IDs or tags, revision conflicts return 409, location unlock persists after NPC stage changes, and manual load still overwrites auto save without erasing gallery records.
  Key assertions: `assert.equal(JSON.stringify(payload.view).includes('secret-item-id'), false)`; `assert.equal(staleResponse.status, 409)`; `assert.equal(afterStageChange.view.locations.some(x => x.id === 'restaurant'), true)`.
- [ ] Run `npx tsx --test tests/api.test.ts`; verify failures.
- [ ] Implement the minimal UI/API wiring, reusing existing drawer and action patterns. Do not add a creator editor or accounts here.
- [ ] Run `npm test` and `npm run build`; expect zero failures. Manually inspect the three locations, detail panel, bag and chat scrolling. Commit if Git exists.

### Task 9: Full card acceptance pass

**Files:** Modify `docs/su-nian-card-coverage.md`, `README.md`, and tests/content only where acceptance reveals a specific gap.

**Interfaces:** No new public API. Deliver a reproducible playtest checklist: starting state, messages/actions, expected rule state, expected stage/location/visibility, and model-behavior observations.

- [ ] Run `npm test` and `npm run build` fresh; record pass counts and any known model-style deviations without calling them deterministic rule failures.
- [ ] Play through online → restaurant → home, then exercise at least one failed gate, one hidden discovery, one untakeable discovery, one tag-dependent rule, one NPC item transfer and one ending followed by continued chat. Compare every observed rule state with the coverage audit.
- [ ] Fix only concrete failures using a new failing test first, rerun the full checks, and update the audit/README with remaining deliberate adaptations. Commit if Git exists.
