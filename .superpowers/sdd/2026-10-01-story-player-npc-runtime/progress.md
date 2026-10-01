# SDD ledger — plan: docs/superpowers/plans/2026-10-01-story-player-npc-runtime.md

Baseline: `npm test` 86/86 passed on 2026-10-01 before implementation.
Ruling: This workspace is not a Git repository, so Git worktree and Git-based task scripts cannot run; execute in place, record tests and decisions here, and do not initialize Git. Cost if wrong: less isolation and no commit-by-commit rollback.
Pre-flight: Task 1 contracts/loader → Tasks 2–7 state, effects, AI and migration; property names agree with the spec.
Pre-flight: Task 2 `npcLocations`/`playerIndicators` → Tasks 3–6 views, settlement and AI; canonical state, not derived snapshots, is the shared interface.
Pre-flight: Task 3 `canEnterLocation` → Task 7 Su Nian migration and Task 8 final flow; server remains authority.
Pre-flight: Task 4 targeted effects/settlement → Tasks 5–7 logs, AI, content; one post-primary eligibility pass is binding.
Pre-flight: Task 5 gallery persistence → Task 7 versioned saves; gallery remains account/game scoped.

Task 1: complete — RED `runtime-script.test.ts` failed on root loading, placement coverage, target warning and player-rule target validation; GREEN focused 4/4, `npm run build` exit 0, full `npm test` 90/90.
Task 1: Ruling: Keep global `placements` optional during migration while the old Su Nian source still loads; require exact location coverage whenever the file contains entries, then remove the legacy allowance with Task 7. Cost if wrong: a new story that omits the file could temporarily load before Task 7 hardens validation.
Task 2: complete — RED `runtime-state.test.ts` failed for missing `npcLocations` and player conditions; GREEN focused 2/2, `npm run build` exit 0, full `npm test` 92/92.
Task 2: Ruling: Keep `deriveNpcSnapshot.placement` as a temporary legacy field until Task 7 while adding canonical `locationId`; this avoids breaking old tests mid-migration. Cost if wrong: temporary dual representation could be mistaken for authority before Task 7 removes it.
Task 3: complete — RED `location-access.test.ts` failed for missing access function and inferred NPC presence; GREEN focused 2/2, `npm run build` exit 0, full `npm test` 94/94.
Task 3: Ruling: Direct API gate integration test waits for Task 7's on-disk global placements; meanwhile `canEnterLocation` behavior is exercised directly and the API calls it. Cost if wrong: route wiring regressions could hide until Task 7.
Task 4: complete — RED `player-rules.test.ts` 3 failures for cross-target/missing-target/action-chain; GREEN focused 3/3, `npm run build` exit 0, full `npm test` 97/97.
Task 4: Ruling: Use whole-state equality before world refresh to decide whether an effect bundle changed anything; this preserves empty-effect investigation spots while ensuring all-skipped `once` rules stay pending. Cost if wrong: comparison overhead grows with unusually long saves; can later optimize with per-effect change flags.
Task 5: complete — settlement records public player-indicator and NPC-move changes; gallery awards are committed with auto saves. API, log and save-store tests pass.
Task 6: complete — AI context uses current derived NPC persona, indicators, inventory and relevant chat history; no obsolete stage state is required. AI and chat tests pass.
Task 7: complete — Su Nian is the sole shipped story; NPC positions and player indicators use canonical save state, old stage branches and the removed story package are gone. Author revised the plan: `locations.json` now contains `visibleWhen`/`enterWhen` directly, so no separate script-level `placements.json` exists. Tests pass.
Task 8: complete for automated acceptance — 95/95 tests pass and `npm run build` succeeds. Precisely checked `data/game.sqlite` and deleted one `mystery-town` save and four `mystery-town` gallery rows; no `sword-and-screen` saves were present. No backups or AI logs were deleted. Browser/real-model playtesting remains for author review.
