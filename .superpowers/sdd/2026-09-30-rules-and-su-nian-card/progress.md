# SDD ledger — plan: docs/superpowers/plans/2026-09-30-rules-and-su-nian-card.md

Ruling: Work in the existing directory because this project has no Git repository or worktree capability — no commits or isolated workspace until the user initializes Git — risk: changes are not versioned during this run.
Ruling: User explicitly requested development before testing — defer test and build runs until all planned implementation tasks are coded — risk: integration failures will be found later and may take longer to isolate.
Pre-flight: Task 1 canonical item state is consumed by Tasks 2, 3, 6 and 8; preserve one source of truth and adapt legacy reads.
Pre-flight: Task 4 settlement is consumed by Task 6 chat orchestration; conditions for player events use pre-turn state and system events run once afterward.
Pre-flight: Task 5 validation is consumed by Task 7 card content; ensure new fields normalize names to IDs.
Pre-flight: Task 6 context selection is consumed by Task 7 stage/lore data; never send future-stage content.
Implementation: Canonical item state, migration, cross-NPC conditions/effects, location discovery/taking, stage offers, deterministic event settlement, one-call structured AI and adaptive memory are wired through API and React.
Implementation: Per user correction, Su Nian NPC is split into `content/sword-and-screen/npcs/su-nian/` parts; legacy top-level `npcs.json` remains supported by the loader.
Implementation: Su Nian card coverage audit and playtest checklist added; the original card's non-consensual directives and infinite spontaneous inventory are not copied as executable mechanics.
Verification: `npm test` passed 27/27 after correcting optional form input handling; `npm run build` passed. Real Cot-18 in-memory chat succeeded in online, restaurant and her-home stages. The first online response invented concrete game tactics; a stronger prompt restriction was added afterward.
Environment: Dev API and Vite server started at localhost:3001 and localhost:5173. CUA browser inventory is empty, so visual UI inspection is not possible in this environment; HTTP/API and build checks remain available.
Final verification: After additional NPC interaction rules and current-stage AI-state privacy correction, `npm test` passed 29/29 and `npm run build` passed. The development server used for inspection was stopped because its default host binds to all interfaces and the current pre-account prototype should not remain exposed with an AI key.
Continuation verification: Added a full three-stage HTTP acceptance route including hidden item gates, item transfer, ending and continued chat; `npm test` passed 30/30 and `npm run build` passed. The player guide now routes pending offers to acceptance instead of repeating its suggested chat line. Active lore is filtered by topic keywords and unknown player items are explicitly off-limits to the NPC prompt.
Ruling: The user asked for a playable address before accounts exist — dev web/API now bind to 127.0.0.1 by default to allow same-machine play without exposing the AI-backed prototype to the LAN; production may explicitly set `GAME_API_HOST` when auth is ready.
Environment: Current `npm run dev` session is running at http://127.0.0.1:5173/ (web) and http://127.0.0.1:3001/ (API, ai mode); HTTP 200 and both catalog games verified. No CUA browser was available, so no visual screenshot inspection.
