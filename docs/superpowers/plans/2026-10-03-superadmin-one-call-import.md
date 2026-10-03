# Superadmin One-Call Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an editable story draft from a novel or character card with at most one model request, accessible only to superadmin.

**Architecture:** Keep existing upload/job/preview/apply workflow. Replace summarize-repair-review chaining with one generation call plus local parsing and safety checks; allow safely split but incomplete configuration into draft sections. Retain transactional replacement and revision conflict protection.

**Tech Stack:** TypeScript, Express 5, MySQL, React 19, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-03-superadmin-one-call-import-design.md`

## Global Constraints

- Requires unified account auth and AI audit sink; all import routes require `admin` plus ownership of the target project.
- One import operation invokes the configured model at most once: no AI summary, review, repair, fallback or automatic retry.
- Do not truncate source. Provider context/length errors and malformed JSON fail without changing draft.
- Confirm before replacing every draft section; published, pending-review and playtest snapshots remain unchanged.
- Save incomplete but safely split configuration, with deterministic issues; submit and playtest still require full runtime validation.
- Current worktree contains unrelated changes; stage only task-owned files and run remote MySQL checks only against a disposable schema.

## Review Focus

- Very long source is uploaded without a client byte cap, then provider rejects it without partial write; Task 1 tests this.
- Generated JSON is parseable but has broken references: apply persists editable sections and reports errors; Tasks 1 and 2 test this.
- NPC ID resembles a path traversal or duplicates another ID: import rejects before writing; Task 1 tests this.
- Draft changes while the model runs: apply returns 409 and leaves new edits intact; Task 2 tests this.
- Author directly calls a hidden import endpoint: server returns 403; Task 3 tests this.

---

### Task 1: Single Generation and Safe Tolerant Split

**Files:** Modify `apps/api/src/creator/import-generate.ts`, `apps/api/src/creator/import-worker.ts`, `apps/api/src/creator/import-ai.ts`; create `apps/api/src/creator/import-parts.ts`; test `tests/creator-import-generate.test.ts`, `tests/creator-import-api.test.ts`.

**Interfaces:** `generateImportDraft(projectId: string, sourceText: string, ai: MainAiClient, draftVersion: string, attribution: AiAttribution): Promise<{ parts: ScriptParts; inferences: string[]; issues: ScriptIssue[] }>` invokes `ai.complete` once. `splitImportStory(raw: string, projectId: string, draftVersion: string)` returns that result or throws `ImportGenerationError` only for unparseable/unsafe-to-split data. The `MainAiClient.complete(system, user, attribution)` interface comes from the audit plan.

- [ ] **Step 1: Write failing tests**: `assert.equal(aiCalls, 1)` for a 90,000-character source and `assert.ok(sentPrompt.includes(source.slice(-100)))`; parseable output missing a module returns `parts` plus nonempty `issues`; malformed JSON and unsafe/duplicate NPC IDs reject; provider length failure leaves `aiCalls === 1`.
- [ ] **Step 2: Run** `npx tsx --test tests/creator-import-generate.test.ts tests/creator-import-api.test.ts`; expect new assertions to fail.
- [ ] **Step 3: Remove** `summarizeLongSource`, repair loop and `reviewImport` call; split safe output into existing section paths, inserting editable empty JSON for missing modules without inventing story facts. Make worker finish after local issue detection and sanitize provider errors.
- [ ] **Step 4: Run** the Step 2 command; expect PASS and at most one recorded `source='import'` model attempt per operation.
- [ ] **Step 5: Commit** only this task's files with `feat: generate import draft in one model call`.

### Task 2: Persist Editable Incomplete Draft Atomically

**Files:** Modify `apps/api/src/db/mysql-creator-import.ts`; test `tests/mysql-creator-import.test.ts`, `tests/creator-import-api.test.ts`.

**Interfaces:** `finish(ownerId, projectId, jobId, parts, report)` accepts safely split sections and deterministic issues; `apply(ownerId, projectId, jobId)` returns `{ projectId, project }` after atomic replacement. A shared safe-parts validator checks allowed section paths, project identity, unique/safe entity IDs and valid per-section JSON without requiring `inspectScriptParts(parts).script`.

- [ ] **Step 1: Write failing tests**: `assert.equal(job.status, 'ready')` for incomplete safe parts; unsafe path and wrong project ID reject; changed section revision yields `status === 409` with draft unchanged; published/pending snapshot hashes are unchanged after apply.
- [ ] **Step 2: Run** `npx tsx --test tests/mysql-creator-import.test.ts`; expect failure.
- [ ] **Step 3: Replace** full runtime validation in `finish` and `apply` with the shared safe-parts validator, preserve the existing row locks/revision check/transaction, and store issues in `report_json` for UI display. Derive title from safe `manifest.json` or retain current title when missing.
- [ ] **Step 4: Run** `npx tsx --test tests/mysql-creator-import.test.ts tests/creator-import-api.test.ts`; expect PASS.
- [ ] **Step 5: Commit** only this task's files with `feat: apply incomplete safe import drafts`.

### Task 3: Admin-Only API and Honest Preview

**Files:** Modify `apps/api/src/creator/import-router.ts`, `apps/web/src/creator/CreatorApp.tsx`, `apps/web/src/creator/ImportStoryModal.tsx`, `apps/web/src/creator/client.ts`; test `tests/creator-import-api.test.ts`, `tests/creator-import-ui.test.ts`.

**Interfaces:** Every `/api/creator/projects/:id/import-jobs*` route requires account role `admin`; remove the `/review` retry endpoint and `retryImportReview` client method. `ImportJob.report` exposes `inferences` and deterministic `issues` only; `applyImport` still returns the current `projectId`.

- [ ] **Step 1: Write failing tests**: `assert.equal(authorResponse.status, 403)` for upload/get/apply/cancel, admin response succeeds, the modal has no AI-review or segmented-source copy, renders `report.issues`, and calls `applyImport` only after affirmative confirmation.
- [ ] **Step 2: Run** `npx tsx --test tests/creator-import-api.test.ts tests/creator-import-ui.test.ts`; expect failure.
- [ ] **Step 3: Guard** every import route server-side, render entry only for admin, remove review retry UI/API and obsolete copy, and surface both generated sections and local issues. Keep overwrite confirmation and current project ID validation.
- [ ] **Step 4: Run** `npx tsx --test tests/creator-import-api.test.ts tests/creator-import-ui.test.ts && npm run build && npm test`; expect PASS.
- [ ] **Step 5: Commit** only this task's files with `feat: limit one-call import to superadmin`.
