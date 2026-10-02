# Creator Editor Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make story settings and locations usable structured forms, with explicit save and a start-location select backed by saved locations.

**Architecture:** Keep the existing JSON section contract and revisioned API. Split the generic editor into specialized manifest/location forms plus a generic fallback; keep one draft per active section and make navigation explicitly resolve dirty state. Cover images use an authenticated project asset endpoint and a published public asset read path.

**Tech Stack:** React 19, TypeScript, Express 5, SQLite, node:test, Vite; selectively styled Ant Design controls if they improve the forms.

**Spec:** `docs/superpowers/specs/2026-10-02-creator-editor-usability-design.md`

## Global Constraints

- Only clicking Save writes a section draft; there is no idle or tab-switch autosave.
- Saved `locations.json` supplies the start-location options; labels are names and stored values are IDs.
- Preserve hidden manifest properties, `spots`, `items`, and unknown properties during form edits.
- Keep existing site palette, typography, fixed header and sidebar; no default-library visual takeover.
- Images: PNG/JPEG/WebP only, no SVG; draft assets private, published covers readable by players.
- Existing stories and legacy text covers remain readable without migration.

## Review Focus

- Invalid JSON while switching modes: keep the exact text and show a parse error, not stale form values (Task 3).
- Editing a location while another tab is selected: retain all local edits until Save/Reset (Task 3).
- Deleting the start location: show an invalid reference and block publication, not silently choose another (Task 3).
- A failed or conflicting cover save: retain the selected file and draft; do not say “saved” (Task 4).
- A second browser tab saving first: return a revision conflict without overwriting it (Task 2).

---

### Task 1: Server-generated story IDs and defaults

**Files:** Modify `apps/api/src/creator/project-router.ts`, `apps/web/src/creator/client.ts`, `apps/web/src/creator/CreatorApp.tsx`, `packages/script/src/parts.ts`; test `tests/creator-api.test.ts`, `tests/script-parts.test.ts`.

**Interfaces:** Produce `creatorApi.create(title: string, templateId?: string): Promise<Project>`; project IDs are `story-<uuid>` and manifest ID matches. Preserve existing `ProjectStore.create(owner,id,title,template)` internally.

- [ ] Write tests: POST creates unique IDs without an `id`, template copy gets a different ID, empty-story periods equal `['白天','下午','晚上']`.
- [ ] Run `npx tsx --test tests/creator-api.test.ts tests/script-parts.test.ts`; expect new assertions to fail.
- [ ] Implement server ID generation and client create dialog without story-ID input; update blank defaults.
- [ ] Run the same command; expect pass. Commit Task 1.

### Task 2: Explicit Save/Reset and dirty navigation

**Files:** Modify `apps/web/src/creator/CreatorApp.tsx`, `apps/web/src/creator/creator.css`; create `apps/web/src/creator/editor-session.ts`, `tests/creator-editor-session.test.ts`.

**Interfaces:** Produce pure `hasUnsavedChanges(draft: string, saved: string): boolean` and `resolveDirtyChoice(choice: 'save'|'discard'|'cancel', save: () => Promise<boolean>): Promise<boolean>`. `CreatorApp` exposes Save and Reset bottom actions and uses these on navigation, validation, submission, deletion and logout. No timer invokes save.

- [ ] Write tests for dirty detection, save failure/cancel blocking transition, discard allowing it, revision-conflict response retaining local content; add source-level check that no 750 ms autosave remains.
- [ ] Run `npx tsx --test tests/creator-editor-session.test.ts`; expect fail.
- [ ] Implement explicit controls, native beforeunload guard, three-choice in-app prompt, and conflict status. Reset confirms only when dirty. Validation/submission require saved state.
- [ ] Run focused tests and `npm run build`; expect pass. Commit Task 2.

### Task 3: Specialized story and location forms

**Files:** Create `apps/web/src/creator/ManifestEditor.tsx`, `apps/web/src/creator/LocationsEditor.tsx`, `apps/web/src/creator/section-forms.ts`; modify `apps/web/src/creator/SectionEditor.tsx`, `apps/web/src/creator/CreatorApp.tsx`, `apps/web/src/creator/creator.css`; test `tests/creator-editor.test.ts`, create `tests/creator-section-forms.test.ts`.

**Interfaces:** `SectionEditor` additionally consumes `savedLocations?: {id:string;name:string}[]`. Pure helpers in `section-forms.ts`: `patchManifest(content, patch): string`, `patchLocation(content,id,patch): string`, `newLocationId(): string`, preserving all other JSON keys. Manifest form stores `startLocation` ID; locations form edits one tab at a time.

- [ ] Write tests for hidden-field and unknown-field preservation, `spots`/`items` preservation, unique new location ID, missing selected start-location feedback, periods add/edit/reorder/minimum-one, and SSR form labels/select options. Test invalid JSON does not replace text.
- [ ] Run `npx tsx --test tests/creator-editor.test.ts tests/creator-section-forms.test.ts`; expect fail.
- [ ] Implement specialized forms with readable labels, multiline text, interaction-mode select, location tabs, period tags/modal, and saved-location select. Keep JSON mode and generic fallback. Hide unfinished spots/items in form only.
- [ ] Run focused tests and `npm run build`; expect pass. Commit Task 3.

### Task 4: Cover asset lifecycle

**Files:** Create `apps/api/src/creator/cover-assets.ts`; modify `apps/api/src/creator/project-router.ts`, `apps/api/src/app.ts`, `apps/web/src/creator/client.ts`, `apps/web/src/creator/ManifestEditor.tsx`, `apps/web/src/App.tsx`, `apps/web/src/creator/creator.css`; test `tests/creator-api.test.ts`, `tests/creator-editor.test.ts`.

**Interfaces:** `creatorApi.uploadCover(projectId: string, file: File): Promise<{cover:string}>`; accept bounded PNG/JPEG/WebP bytes only, validate session and ownership, store random resource ID, serve draft to owner and published cover to players. Manifest Save uploads selected file then writes its resource reference; failed section save removes or schedules removal of unreferenced resource.

- [ ] Write tests for accepted/rejected formats and size, owner access, anonymous draft denial, published access, legacy text cover rendering, and upload/section failure state.
- [ ] Run focused tests; expect fail.
- [ ] Implement upload, asset reads and cleanup, image preview/removal, save sequencing and catalog image rendering.
- [ ] Run focused tests and `npm run build`; expect pass. Commit Task 4.

### Task 5: Full workflow and visual verification

**Files:** Modify tests or styling where verification finds defects; no new functionality outside the spec.

**Interfaces:** Uses Tasks 1–4 without changing their contracts.

- [ ] Add workflow tests: create story, add/save location, choose it as start, save/reload manifest, validate; confirm no implicit save on tab switch and unknown fields survive.
- [ ] Run new tests RED, apply minimum corrections, run them GREEN.
- [ ] Run `npm test` and `npm run build`; inspect desktop and narrow-screen creator pages in a browser, including bottom actions and location tabs.
- [ ] Commit integration fixes and record any remaining limitations in the handoff.
