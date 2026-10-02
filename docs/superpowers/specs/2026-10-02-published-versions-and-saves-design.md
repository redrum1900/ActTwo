# Immutable published versions and version-pinned saves

## Intent and scope

Each successful review publishes an immutable snapshot. A new game always uses the latest approved snapshot. An existing auto or manual save always runs against the snapshot recorded in that save, even after later approvals. Starting a new game overwrites the one auto slot; it does not create an automatic backup. Manual slots remain available across releases. The game catalog/menu shows the latest published version; each occupied save slot shows its own version and last-saved time.

This work covers the MySQL runtime, review approval, save APIs, game UI, and published image retention. It does not add a player-selectable version for new games, extra save slots, a version editor, or an automatic migration of old saves to new scripts.

## Version identity and publishing

Use a per-project integer release sequence as the authoritative ordering. The first approval gets sequence 1 and display version `1.0`; subsequent approvals get `1.1`, `1.2`, and so on (`1.10` follows `1.9`). Authors do not enter a release version. The draft's existing `manifest.json.version` may remain an internal placeholder for validation, but it must never determine or display an approved version. A pending/rejected review has no assigned release version; its frozen submitted content is not a playable release.

Within one MySQL transaction, approval locks the project, checks that the submission is pending, obtains the next sequence, sets the frozen submitted script's `version` to the allocated display version, recalculates `contentHash`, inserts an immutable published snapshot, updates the project's latest-publication pointer/metadata, and marks the review approved with the allocated version. A failed transaction consumes no version. Two approvals for one project cannot receive the same sequence. The approved snapshot's JSON, version, hash, and publication timestamp are never updated in place.

The public script repository's normal `get` and `list` return latest publications only. A separate exact-version lookup takes `(projectId, scriptVersion, scriptHash)` and returns a published snapshot only when all three match. The hash is required even though the version is unique, so a malformed or altered save cannot silently bind to different content.

## Schema and existing data

Introduce a `published_script_versions` table keyed by `(project_id, release_sequence)`, with a unique `(project_id, version)` key and fields for full script JSON, content hash, approval/review ID, and publication time. Retain or replace `published_scripts` as the latest pointer; both latest and historical records must be updated atomically. The migration copies each existing `published_scripts` row into the history table as sequence 1 **without changing its stored version, hash, or JSON**, preserving compatibility with any existing saves. The next approval of such a project uses sequence 2 and display version `1.1`. For this legacy case, the first version may display its previous label (for example `1.0.0`) rather than `1.0`.

Migrate the current MySQL schema from version 1 to 2 without clearing data. Run a backfill and consistency check before enabling exact-version play; do not claim success if an existing latest row cannot be copied faithfully. Approval uses the already-frozen review snapshot, not the author's possibly changed current draft. Existing soft-deleted projects keep their current catalog/playability policy; this feature does not change project deletion semantics.

## Game and save flow

`POST /games/:gameId/new` loads the latest approved snapshot and overwrites auto slot 0. Its confirmation continues to state that the auto save is overwritten and manual saves remain. `current`, chat, actions, debug, and derived-memory writes first load auto slot 0, then resolve its exact published snapshot; they never substitute the latest script. Loading a manual slot resolves that slot's snapshot **before** copying it into auto slot 0. Save import does the same for its embedded version/hash before overwriting auto. If the snapshot is absent or hash validation fails, the endpoint returns a clear incompatibility error and leaves the current auto save untouched.

`GET /games/:gameId/slots` returns auto and manual slots regardless of whether they target the latest publication, including `scriptVersion`, `updatedAt`, and location rendered using each slot's own snapshot. It must not filter older-version slots out. An unresolved slot remains visible with its version/time and a disabled load action plus error indicator; it must not be silently dropped. Catalog and game-menu `hasAuto`/Continue refer to a resolvable auto snapshot, not equality with latest. The catalog/menu `version` field is still the latest publication, while an active session presents its actual pinned version. Empty slots have no version/time.

The existing five manual slots and overwrite semantics stay unchanged. Export includes the saved state with its version/hash. Version pinning applies to the full gameplay script, not just labels: rules, items, locations, NPC definitions, achievements, and endings come from the saved snapshot. Cross-release gallery behavior is unchanged for now; entries are displayed from the active snapshot.

## Published assets

An image referenced by any retained published snapshot must remain publicly readable and protected from orphan cleanup or author deletion, even if the latest publication no longer references it. Update cover and item-image linkage checks to search retained versions as well as the current draft. Otherwise an old save could load its script but lose its images.

## API/UI contract and tests

Review submissions display `待发布` until approved; approved review responses include the assigned version. No creator form exposes an editable release version. The catalog and game menu display latest version. Save rows display `版本 1.x · 保存时间 …` (or a legacy label) and retain their normal day/location details. The active game UI uses its pinned version from the session payload.

Tests cover first and subsequent approvals, rejection not incrementing the sequence, concurrent approvals, immutable history, legacy-row backfill, old auto save continuing after a newer release, new game replacing only auto, old manual save loading after a newer release, slot listing and version/time display, export/import, missing/tampered snapshot behavior without overwriting auto, and old-version cover/item-image retention. The existing no-publish/no-play and soft-deletion behavior should remain covered.

## Alternatives considered

Using approved review submissions directly as the runtime archive avoids a new table but couples gameplay to moderation records and complicates version assignment and lookup. Keeping only the current published row is simpler but cannot support old saves. The dedicated immutable publication history is the selected approach.
