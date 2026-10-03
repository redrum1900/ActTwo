# NPC Creator Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw NPC base, lore and persona fields with compact authoring forms while preserving existing script data and runtime behavior.

**Architecture:** Three focused editors plug into `SectionEditor`; pure section patch helpers retain hidden fields and make state transitions testable. Lore gains explicit type/name metadata, with legacy type inference in one shared helper used by authoring, validation and AI-context selection.

**Tech Stack:** React 19, Ant Design, TypeScript, Node test runner, SQLite-backed creator API.

**Spec:** `docs/superpowers/specs/2026-10-02-npc-creator-forms-design.md`

## Global Constraints

- Keep current beige/dark visual system, left-side vertical tab pattern, compact Ant Design controls, and existing save/reset semantics.
- Do not expose or rewrite existing IDs; generate UUIDs only for new lore/persona entries, retaining the reserved `common` persona ID.
- Preserve hidden `portrait`, `accent`, and other advanced NPC fields on form saves.
- New NPC-held items start visible without a condition; old items with no `itemVisibility` entry remain hidden.
- Do not alter unrelated changes already present in the dirty worktree.

## Review Focus

- A new NPC item already placed at another location/NPC must be excluded from the add dialog.
- Removing an initial item must remove only its matching `itemVisibility` entry, retaining unrelated fields.
- A legacy lore entry with no `type` must keep its old keyword behavior; opening the form alone must not mutate it.
- Comma-separated keyword input must trim, deduplicate, and ignore empty fragments on Enter and Space.
- `common` persona cannot be deleted or assigned a condition, including when it was not first in old data.

---

### Task 1: NPC basic information and item visibility

**Files:**
- Create: `apps/web/src/creator/NpcBaseEditor.tsx`
- Modify: `apps/web/src/creator/section-forms.ts`
- Modify: `apps/web/src/creator/condition-sources.ts`, `apps/web/src/creator/condition-tree.ts`
- Modify: `apps/web/src/creator/SectionEditor.tsx`
- Modify: `apps/web/src/creator/creator.css`
- Test: `tests/creator-section-forms.test.ts`, `tests/creator-editor.test.ts`, `tests/creator-condition-tree.test.ts`

**Interfaces:**
- `NpcBaseEditor({ content, onChange, sources, onJson, npcId }: { content: string; onChange: (value: string) => void; sources: ConditionSources; onJson: () => void; npcId: string })`.
- Extend `ConditionSources.locations` with optional `items?: string[]` populated from `locations.json`; the NPC editor uses these and other NPCs' `initialItems` to exclude occupied item options.
- Pure `patchNpcBase(content, patch)`, `addNpcInitialItems(content, itemIds)`, `removeNpcInitialItem(content, itemId)`, `setNpcItemVisibility(content, itemId, condition | null | undefined)`; undefined means hidden, null means always visible.

- [ ] Write failing helper tests for preserved hidden fields, multi-add, removal cleanup, existing hidden items, and per-item visibility transitions; write SSR test for labels, Selects, textarea, tabs and no ID/add-field controls.
- [ ] Run `npx tsx --test tests/creator-section-forms.test.ts tests/creator-editor.test.ts tests/creator-condition-tree.test.ts` and observe relevant failures.
- [ ] Implement helpers and editor using the location-item add-modal/tab/condition pattern. Exclude items occupied by other owners using `ConditionSources` and location placements.
- [ ] Run the targeted tests until green; run `npm run build` to catch prop/type regressions.

### Task 2: Lore authoring and runtime semantics

**Files:**
- Create: `packages/script/src/lore.ts`
- Create: `apps/web/src/creator/NpcLoreEditor.tsx`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/script/package.json` (export `./lore`)
- Modify: `packages/script/src/index.ts`
- Modify: `apps/api/src/ai-adapter.ts`
- Modify: `apps/web/src/creator/SectionEditor.tsx`
- Modify: `apps/web/src/creator/creator.css`
- Test: `tests/script.test.ts`, `tests/chat.test.ts`, `tests/creator-section-forms.test.ts`, `tests/creator-editor.test.ts`

**Interfaces:**
- Lore entries extend existing shape with optional `name?: string` and `type?: 'always' | 'triggered'`; `loreType(entry): 'always' | 'triggered'` infers legacy behavior from keywords.
- `NpcLoreEditor({ content, onChange }: { content: string; onChange: (value: string) => void })` writes UUID IDs for new entries; a pure `splitLoreKeywords(text, existing): string[]` handles separators.
- AI selection calls `loreType` after existing `when` evaluation. Triggered entries need at least one keyword to pass script validation.

- [ ] Write failing tests for legacy lore, explicit always/triggered matching, empty-trigger validation, keyword splitting, SSR form layout and hidden IDs.
- [ ] Run the targeted tests and observe relevant failures.
- [ ] Implement the shared type resolver, contract, validator and AI selection, then the lore editor with vertical tabs and tag input.
- [ ] Run targeted tests and build until green.

### Task 3: Persona authoring and end-to-end preservation

**Files:**
- Create: `apps/web/src/creator/NpcPersonasEditor.tsx`
- Modify: `apps/web/src/creator/SectionEditor.tsx`
- Modify: `apps/web/src/creator/creator.css`
- Test: `tests/creator-editor.test.ts`, `tests/creator-section-forms.test.ts`, `tests/creator-project.test.ts`

**Interfaces:**
- `NpcPersonasEditor({ content, onChange, sources, onJson }: { content: string; onChange: (value: string) => void; sources: ConditionSources; onJson: () => void })` uses `ConditionEditor` for non-common entries.
- Pure helpers preserve unknown fields and `id`; common is pinned to the top and cannot be removed or conditioned, and a missing common is created only on explicit action.

- [ ] Write failing tests for common ordering/protection, UUID creation, optional condition editing, textarea, no ID/add-field controls, and review/publication preserving new lore metadata.
- [ ] Run targeted tests and observe relevant failures.
- [ ] Implement persona editor and section routing; ensure source NPC context is supplied to `ConditionEditor`.
- [ ] Run targeted tests, `npm test`, `npm run build`, and `git diff --check`; inspect the changed-file diff for unrelated edits.
