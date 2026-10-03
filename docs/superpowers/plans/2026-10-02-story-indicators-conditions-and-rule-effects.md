# Story Indicators, Typed Conditions and Rule Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors configure story/player/NPC indicators, opening questions, typed conditions, and atomic NPC/player rule effects, including reusable once-only scoring rules.

**Architecture:** Extend the shared script/state contract first, then validate and execute one canonical condition/effect model on the server. The creator UI reads the same definitions and writes stable IDs; legacy published scripts retain their existing runtime path. New features are additive until a draft is explicitly migrated.

**Tech Stack:** TypeScript, React, Vite, Node test runner (`tsx --test`), existing Ant Design creator controls.

**Spec:** `docs/superpowers/specs/2026-10-02-story-indicators-conditions-and-rule-effects-design.md`

## Global Constraints

- Stay on `feature/creator-center`; preserve the current dirty worktree, including unrelated untracked `demo/` and `.superpowers/`.
- New IDs are UUIDs; existing saved IDs and published-script semantics remain stable. No automatic old-save conversion.
- New story indicator definitions live in `story/indicators.json`; the system-managed once-rule tags indicator is persisted, read-only, and never shown as a story event.
- Text comparisons are case-sensitive literal comparisons. Dates are real `YYYY-MM-DD` calendar dates compared by day, without timezone conversion.
- A failed effect sequence commits no partial state and never writes the once-rule ID.
- Keep the existing location-item and item-tag-removal changes intact. Inspect staged diffs before any commit; do not stage unrelated user data.

## Review Focus

1. An invalid date such as `2026-02-30` must fail validation, not compare lexically; covered in Task 2.
2. A missing indicator or a type-incompatible comparator must fail publication instead of silently evaluating false; covered in Task 2.
3. A mixed effect sequence that fails after an earlier successful effect must leave state and once history unchanged; covered in Task 3.
4. Removing a story event must not re-enable an already executed once-only rule; covered in Task 3.
5. Deleting the last opening question must leave a playable story without a questionnaire; covered in Task 4.

---

### Task 1: Contract, script assembly and story indicators

**Files:** Modify `packages/contracts/src/index.ts`, `packages/script/src/index.ts`, `packages/script/src/parts.ts`, `packages/engine/src/index.ts`; test `tests/script-parts.test.ts`, `tests/script.test.ts`, `tests/engine.test.ts`.

**Interfaces:** Produce `GameScript.storyIndicators?: readonly IndicatorDefinition[]` and `GameState.storyIndicators?: Record<string, NpcIndicatorState>`; add `IndicatorDefinition` date variant (`initial: string`) and optional `description`. New blank stories persist `story/indicators.json` with one reserved, read-only tags indicator for executed rule IDs. Legacy `stats` remains accepted at runtime.

- [ ] Write failing tests: blank parts contain `story/indicators.json` and stable reserved ID; assembly loads story indicators; initial state initializes all six value types and preserves old `stats` behavior.
- [ ] Run `npx tsx --test tests/script-parts.test.ts tests/script.test.ts tests/engine.test.ts`; confirm the new assertions fail.
- [ ] Implement only the contract, part loading/assembly, and initial-state changes above. The reserved indicator ID is created once in blank/new draft parts, never randomly during `inspectScriptParts`.
- [ ] Rerun the same tests and `npx tsc --noEmit`; require zero failures.
- [ ] Review `git diff --check` and scoped diff; commit only separable Task 1 changes, otherwise defer the commit rather than absorb existing unrelated edits.

### Task 2: One type-aware condition model and validation

**Files:** Modify `packages/contracts/src/index.ts`, `packages/engine/src/index.ts`, `packages/script/src/index.ts`; create `packages/engine/src/condition-value.ts` if keeping date/type comparison isolated; test `tests/engine.test.ts`, `tests/script.test.ts`.

**Interfaces:** Add `storyIndicator` to `Condition`. Retain old `indicator`, `playerIndicator`, and `playerField` shapes for published content, with additive `gt`, `lt`, `contains`, `notContains`, and `length` comparison fields as appropriate. `evaluateCondition(condition, state, script, npcId)` remains the server authority; `inspectScriptParts` rejects unknown references, invalid comparators/values and deprecated `completedEvent` in new-format drafts.

- [ ] Write failing table tests for numeric `= ≠ > ≥ < ≤`, text equality/literal containment, tags/checkbox membership and count, true/false, enum/select/radio equality, and calendar-valid dates across story/player/NPC/opening sources. Include Review Focus 1 and 2.
- [ ] Run `npx tsx --test tests/engine.test.ts tests/script.test.ts`; confirm failures correspond to missing behavior.
- [ ] Implement shared type/value checks and runtime comparison without changing AND/OR/NOT or existing non-indicator predicates. Reject empty/mismatched operands at script inspection; retain old published condition evaluation.
- [ ] Rerun focused tests and `npx tsc --noEmit`; require zero failures.
- [ ] Review scoped diff and commit if separable; otherwise defer safely.

### Task 3: Atomic effects and once-rule ledger

**Files:** Modify `packages/contracts/src/index.ts`, `packages/engine/src/index.ts`, `packages/script/src/index.ts`; test `tests/npc-rules.test.ts`, `tests/player-rules.test.ts`, `tests/engine.test.ts`.

**Interfaces:** Add `removeStoryEvent`; allow `changeIndicator`, `setIndicator`, `addIndicatorTag`, and `removeIndicatorTag` to target `story` as well as player/NPC. `once` on new-format rules checks/updates the reserved story tags indicator by rule ID; old published scripts continue using `completedEvents`. Rule selection and priority/exclusive ordering remain unchanged.

- [ ] Write failing tests for event record/remove by UUID, item give/remove/transfer, story/player/NPC indicator effects, bounds/type rejection, multiple independent once rules, and Review Focus 3–4. Assert a failed sequence leaves the original state byte-for-byte equivalent.
- [ ] Run `npx tsx --test tests/npc-rules.test.ts tests/player-rules.test.ts tests/engine.test.ts`; confirm failures.
- [ ] Implement effects against a working copy and commit it only on complete success. Validate owner/item/indicator references at publish time; write the rule ID into the reserved tags indicator after real effects succeed.
- [ ] Rerun focused tests and `npx tsc --noEmit`; require zero failures.
- [ ] Review scoped diff and commit if separable; otherwise defer safely.

### Task 4: Draft migration and compact opening form

**Files:** Modify `packages/script/src/parts.ts`, `packages/script/src/index.ts`, `apps/web/src/creator/sections.ts`, `apps/web/src/creator/SectionEditor.tsx`, `apps/web/src/creator/section-forms.ts`; create a focused `apps/web/src/creator/PlayerFormEditor.tsx`; test `tests/script-parts.test.ts`, `tests/script.test.ts`, `tests/creator-section-forms.test.ts`.

**Interfaces:** Existing opening IDs remain stable; new questions use `crypto.randomUUID()`. `FieldDefinition.type` adds `textarea`. New-format drafts may have zero fields; the game skips the opening form. Legacy nonempty `stats.json` blocks publication with a targeted migration error and an explicit migration action mapping world→story, player→player, npc→NPC number indicators; conflicting IDs stop conversion without data loss.

- [ ] Write failing tests for empty form/skip, option and typed-default validation, dangling field references, date/default validation, and lossless/conflict-safe stats migration. Include Review Focus 5.
- [ ] Run `npx tsx --test tests/script-parts.test.ts tests/script.test.ts tests/creator-section-forms.test.ts`; confirm failures.
- [ ] Implement compact item editing (label/type/default, choice options, advanced required/editable/public, add/delete/reorder, save/reset) and migration UI; preserve original JSON mode.
- [ ] Rerun focused tests, `npx tsc --noEmit`, and `npm run build`; require zero failures.
- [ ] Review scoped diff and commit if separable; otherwise defer safely.

### Task 5: Creator indicator, condition and effect editors

**Files:** Modify `apps/web/src/creator/sections.ts`, `apps/web/src/creator/SectionEditor.tsx`, `apps/web/src/creator/condition-sources.ts`, `apps/web/src/creator/condition-tree.ts`, `apps/web/src/creator/ConditionEditor.tsx`, `apps/web/src/creator/StoryEventRuleControls.tsx`, `apps/web/src/creator/creator.css`; create focused `IndicatorEditor.tsx` and `RuleEffectsEditor.tsx` in the same directory; test `tests/creator-condition-tree.test.ts`, `tests/creator-section-forms.test.ts`, `tests/creator-editor.test.ts`.

**Interfaces:** Condition sources expose story/player/NPC indicator and opening-field type metadata. The shared condition editor emits only legal type/operator/value combinations, with existing nested AND/OR/NOT UI intact. Both NPC and player rule forms expose trigger, gate, effects, and once toggle; effects store stable IDs and typed values. Story indicators replace the legacy stats author page; reserved once indicator is read-only.

- [ ] Write failing UI/model tests for all six operator families, cross-source selection, type-switch value reset, nested groups, indicator add/edit/delete/save/reset, and rule effect round-tripping (including story target and event removal).
- [ ] Run `npx tsx --test tests/creator-condition-tree.test.ts tests/creator-section-forms.test.ts tests/creator-editor.test.ts`; confirm failures.
- [ ] Implement the focused components and wire them into SectionEditor; keep selectors compact, use existing Ant Design controls, retain JSON escape hatch and explicit save/reset semantics.
- [ ] Rerun focused tests, `npx tsc --noEmit`, and `npm run build`; require zero failures.
- [ ] Review scoped diff and commit if separable; otherwise defer safely.

### Task 6: Full integration and regression gate

**Files:** Test `tests/acceptance.test.ts`, `tests/su-nian-flow.test.ts`, `tests/player-rules.test.ts`, `tests/npc-rules.test.ts`, `tests/creator-editor.test.ts`; modify implementation only where integration exposes a defect.

**Interfaces:** Demonstrate a new story with no opening questions, two once-only score rules using the same story tags ledger, a removable story event, conditional location item, and a typed gallery condition. Existing 苏念 content and prior location-item behavior remain intact.

- [ ] Add one failing end-to-end test proving the integrated scenario and a regression test for the existing script.
- [ ] Run the new tests and confirm they fail for a specific integration gap.
- [ ] Fix only observed gaps; run `npm test`, `npm run build`, and `git diff --check` with zero failures.
- [ ] Inspect final diff and status; commit only this feature’s safely attributable changes if separable. Report any deferred commit and uncommitted prior work explicitly.
