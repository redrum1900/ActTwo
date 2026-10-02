# MySQL-only persistence design

## Intent and scope

Make MySQL the only runtime database for Game DD before rebuilding the Sword-and-Screen story. The existing remote MySQL 8.0 `mystory` schema is empty (zero tables at design time). Initialize it with no old stories, saves, gallery entries, review submissions, or asset records. Preserve only the existing `superadmin` identity and password verifier so its current login continues to work. Keep `data/game.sqlite` intact as an offline backup, but remove SQLite from runtime, tests, dependencies, and deployment instructions. This phase does not create or publish the new story; that is the next project.

## Storage architecture

- Use a MySQL connection pool configured through uncommitted environment variables. Startup requires a successful encrypted connection and schema-version check; failure stops the API. There is no SQLite fallback. Do not put credentials in code, migrations, logs, test output, or the design document.
- Versioned, idempotent SQL migrations create account/session, project/section, review/published, asset metadata, save-slot, and gallery tables in InnoDB with `utf8mb4`. Keep existing IDs, JSON payloads, timestamps, uniqueness constraints, and foreign-key relationships. Use MySQL-compatible SQL for UPSERTs and pending-review uniqueness; enforce constraints MySQL cannot express directly in transaction logic as well.
- Replace synchronous `better-sqlite3` access with asynchronous MySQL access in `auth-store`, `project-store`, `review-store`, `cover-assets`, and `save-store`. Adapt the HTTP routers, script repository, app bootstrap, and request error handling to await these operations. Multi-statement operations must share one transaction connection. Preserve optimistic revision checks, publication snapshot/hash validation, and save/gallery atomicity.
- Binary cover/item files remain in `data/covers`; only their metadata moves to MySQL. No old files are imported. New uploads remain associated with a creator project.

## Initialization and cutover

1. Preserve the existing SQLite database and WAL state with a consistent backup before any remote write. Do not delete or alter the original files.
2. Recheck the target host, schema name, MySQL version, privileges, and zero-table/zero-story precondition. If the target has changed, stop and re-evaluate rather than clearing it.
3. Apply migrations to the remote `mystory` schema. Copy only the `superadmin` account row (ID, username, role, password salt/hash, creation time) from the local SQLite backup; do not transfer sessions. Verify exactly one administrator and no project/save/gallery rows.
4. Configure and start the MySQL-only API. Verify login, draft creation and section revision conflicts, review approval/publication, player save/load, gallery unlock, and asset metadata operations before declaring cutover complete.
5. After the new API is verified, remove SQLite runtime code/dependency and update README/config examples. Leave the original SQLite files as offline backup. A failed cutover is handled by stopping the new API and diagnosing/retrying MySQL; it must not silently write to the old database.

## Verification without local MySQL

The user chose the remote server for runtime and integration verification; no local MySQL service is required. Pure engine, script, and UI tests run without database access. Store-level tests use isolated test identifiers and assert the same API behavior, including transactions and conflicts. A separately invoked remote smoke suite uses uniquely prefixed temporary records in `mystory`, cleans up only those exact records, and reports any leftover IDs if interrupted. It never drops tables, truncates the schema, or deletes unscoped rows. The remote suite must be guarded by an explicit opt-in environment setting and must not run in parallel with the first cutover or story publication.

## Boundaries and acceptance

- No existing draft, published story, save, gallery, session, or image metadata appears in MySQL after initialization. `superadmin` can log in with the current password.
- Authoring, review/publish, story listing/loading, save slots, gallery, and image upload/read all work through MySQL. Revision conflict, atomic settlement, and authorization behavior match the existing API.
- All application code and documentation describe MySQL as the sole active database; no application path opens SQLite. The old SQLite files are retained only as backup, not removed.
- The old built-in `content/sword-and-screen` removal and new superadmin-owned story creation belong to the following story-redesign phase, not this database phase.
