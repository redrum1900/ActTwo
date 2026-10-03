# Remove Item Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Remove item-specific tags without losing the training-note story branch.

**Architecture:** Keep item identity and ownership in the item runtime. Represent the persistent reading permission with the existing story-event flag mechanism. Reject legacy item-tag configuration at publication rather than silently ignoring it.

**Tech Stack:** TypeScript, React, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-02-remove-item-tags-design.md`

## Global Constraints

- Preserve player/NPC tags and tag-valued indicators.
- Keep `hasItem` owner and item matching, item variants, and item image behavior.
- No migration of old saves; author drafts remain editable, but obsolete fields fail validation.
- Preserve unrelated uncommitted location-item work.

## Review Focus

- A creator draft with `initialTags`, `hiddenTags`, `hasItem.tags`, or item-tag effects must report the exact path.
- A player without the training note cannot trigger reading permission; a player with it can record the event once.
- Item details and the home persona must change after the event, not on possession alone.
- Player/NPC tag-based rules must continue to work.
- AI state and player view must not expose obsolete item tags.

---

### Task 1: Story-content migration and validation

**Files:** `content/sword-and-screen/{manifest.json,items.json,npcs/su-nian/rules.json,npcs/su-nian/personas.json}`, `packages/script/src/index.ts`, `tests/{script-parts,su-nian-flow}.test.ts`

**Interfaces:** Story event ID is a new UUID shared by rule effects and conditions. `inspectScript` reports path-specific legacy-tag errors.

- [x] Add failing tests for legacy-field paths and permission-event behavior.
- [x] Run targeted tests and observe expected failures.
- [x] Migrate sample content and add publication validation.
- [x] Run targeted tests to green.

### Task 2: Remove runtime and contract item tags

**Files:** `packages/contracts/src/index.ts`, `packages/engine/src/index.ts`, `apps/api/src/ai-adapter.ts`, `apps/web/src/App.tsx`, `tests/{engine,acceptance,chat}.test.ts`

**Interfaces:** `ItemRuntime` has owner/discovered only; item views and AI item summaries contain no tags.

- [x] Add failing tests for tag-free item runtime, view, and AI state.
- [x] Run targeted tests and observe expected failures.
- [x] Remove item-tag contract, condition, effect, and presentation branches.
- [x] Run targeted tests to green.

### Task 3: Remove creator item-tag controls

**Files:** `apps/web/src/creator/{ItemsEditor.tsx,section-forms.ts,creator.css}`, `tests/{creator-editor,creator-section-forms}.test.ts`

**Interfaces:** New item JSON excludes `initialTags`; editor has no item-tag controls, while unrelated fields remain preserved until validation.

- [x] Add failing render test for no item-tag controls and adjust obsolete helper tests.
- [x] Run targeted tests and observe expected failure.
- [x] Remove controls/helpers/styles and update affected tests.
- [x] Run targeted tests, full suite, build, and `git diff --check`.
