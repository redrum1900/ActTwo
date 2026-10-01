# SDD ledger — plan: docs/superpowers/plans/2026-10-01-auto-stages-streaming-and-game-log.md

Baseline: `npm test` passed 44/44 on 2026-10-01 before product edits.

Setup ruling: This workspace is not a Git repository; worktrees, commits, and the Git-dependent task-start/task-done scripts cannot run. Work in place, preserve existing files/data, and record per-task test checkpoints here. Cost if wrong: no isolated rollback or commit-level review; mitigate with focused patches and full tests.

Pre-flight: Task 1 activity types → Task 3 settlement/log → Task 7 view; Task 2 stage selector → Task 3 settlement; Task 4 streamed adapter → Task 5 SSE endpoint → Task 6 client. Names and consumers match the plan.

Task 1: complete — new/legacy activity log test RED (undefined) → GREEN; engine/save-store tests 17/17 and build passed. Ruling: existing save-store serializes whole `GameState`, so no save-store code change was needed; cost if wrong: manual branch log coverage relies on existing whole-state serialization until integration tests.

Tasks 2–3: complete — target-stage conditions, per-NPC random selection from one pre-transition snapshot, common action/chat settlement, visible changes, and per-operation activity log. Ruling: `appendActivity` takes `script` to resolve the period label; legacy offer functions remain for old scripts, but the current script and UI no longer use them. Hidden tag values are not shown in the player log because the schema has no tag-visibility definition; actual event narration and visible stat/item/stage results are logged.

Tasks 4–5: complete — real upstream `stream:true` SSE, safe top-level message extraction, downstream draft/status/final SSE, atomic commit, saved-turn and in-flight idempotency. A repeated `turnId` with different NPC/text is rejected. One real configured-provider smoke call returned HTTP 200 with nine draft chunks and a final event; the provider was not repeatedly called for the final review to avoid unnecessary token spend.

Tasks 6–7: complete — local pending player/NPC bubbles, retry, synchronous duplicate-send guard, result notices, log drawer, generic guide/offer UI removal, and NPC-leave return. The log drawer links to the saved chat. Browser automation reported no available browser, so visual desktop/mobile QA remains for the user's play review; structural header tests and client stream tests pass.

Task 8: complete for automated and API-level checks. The three-stage Su Nian acceptance test covers discovery, item transfer, and an ending. A manual save/load API smoke check confirmed the activity-log branch restores with the save. Final `npm test`: 60/60 pass. Final `npm run build`: TypeScript and Vite pass. Local frontend/API were listening on `127.0.0.1:5173` and `127.0.0.1:3001`; frontend HTTP check returned 200. No Git repository or independent subagent review was available; self-review checked core contracts, SSE, settlement, UI wiring, and documentation.
