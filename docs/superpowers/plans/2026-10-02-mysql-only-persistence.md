# MySQL-only Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace active SQLite persistence with the empty remote MySQL `mystory` schema, retaining only the `superadmin` login.

**Architecture:** Build new async MySQL stores beside the sync SQLite stores, then switch the API in one integration task and retire SQLite runtime code. `mysql2/promise` supplies a TLS-required pool and transaction connections. The former SQLite files remain offline backup.

**Tech Stack:** TypeScript, Express 5, MySQL 8, `mysql2/promise`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-02-mysql-only-persistence-design.md`

## Global Constraints

- Recheck the remote host/schema and zero-table precondition immediately before the first migration write; stop if it changed.
- Import only the `superadmin` account and password verifier. Do not import projects, sessions, saves, gallery, reviews, or image metadata.
- Require encrypted MySQL transport. Support `MYSQL_SSL_CA` for strict verification; without a CA, explicitly document that peer identity is not verified.
- Keep secrets in uncommitted environment settings, never command arguments, code, committed docs, or logs. Do not modify original SQLite/WAL/SHM files.
- Remote tests use unique fixture IDs and clean only those IDs; never truncate or clear the schema.
- Remove built-in Sword-and-Screen content only in the later story-redesign plan.

## Review Focus

- Missing DB configuration fails startup without SQLite fallback (Task 1).
- Two writes against one section revision yield one success and one conflict (Task 3).
- Repeated submission/approval cannot duplicate pending review or publish a changed snapshot (Task 4).
- Save and gallery changes commit or roll back together (Task 5).
- Interrupted remote smoke reports exact fixture IDs and avoids unscoped cleanup (Task 6).

---

### Task 1: Pool, migration, and safety gate

**Files:** Create `apps/api/src/db/mysql.ts`, `apps/api/src/db/migrations.ts`, `tests/mysql-config.test.ts`; modify `package.json`, `.env.example`.

**Interfaces:** Export `createMysqlPool(env: NodeJS.ProcessEnv): Pool`, `migrateMysql(pool: Pool): Promise<void>`, `withTransaction<T>(pool: Pool, fn: (connection: PoolConnection) => Promise<T>): Promise<T>`. Required keys: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`; optional `MYSQL_SSL_CA`. Schema uses InnoDB/utf8mb4 and a `schema_migrations` ledger.

- [ ] Write `mysql config rejects missing settings`, `pool requires TLS`, `transaction rolls back`, and `migration is idempotent`: assert missing `MYSQL_HOST` throws; TLS options are present; a forced transaction error leaves no fixture row; two migrations leave one schema-version record.
- [ ] Run `npx tsx --test tests/mysql-config.test.ts`; confirm red.
- [ ] Implement utilities. Before first remote migration, verify exact host/schema and zero tables without logging the password.
- [ ] Run focused test and `npm run build`; confirm green. Commit Task 1 files.

### Task 2: Async creator identity

**Files:** Create `apps/api/src/db/mysql-auth-store.ts`, `tests/mysql-auth.test.ts`.

**Interfaces:** Export `createMysqlCreatorStore(pool: Pool)` with async `register`, `createAdmin`, `login`, `accountFor`, `logout`. Preserve scrypt hash/salt and session-token hashing.

- [ ] Write `mysql auth preserves login and sessions`: assert the copied scrypt verifier logs in, duplicate username rejects, `accountFor(token)` returns that account, and logout makes it return null. Use unique usernames for registration.
- [ ] Run `npx tsx --test tests/mysql-auth.test.ts`; confirm red.
- [ ] Implement MySQL identity store without changing active routes yet.
- [ ] Run focused test and build; confirm green. Commit Task 2 files.

### Task 3: Async projects and sections

**Files:** Create `apps/api/src/db/mysql-project-store.ts`, `tests/mysql-project.test.ts`.

**Interfaces:** Export `createMysqlProjectStore(pool: Pool)` and `type MysqlProjectStore = ReturnType<typeof createMysqlProjectStore>`, with existing project operations as `Promise` methods. Reuse `ProjectError`; preserve validation, ownership, revision checks, and transactions.

- [ ] Write `mysql project revision and ownership`: assert create/read preserves sections, concurrent `putSection(..., revision=1)` yields one revision 2 and one 409 conflict, and wrong owner gets 404. Also assert partial-create rollback and NPC add/remove.
- [ ] Run `npx tsx --test tests/mysql-project.test.ts`; confirm red.
- [ ] Implement MySQL project/section queries and transactions, leaving active routes unchanged.
- [ ] Run focused test and build; confirm green. Commit Task 3 files.

### Task 4: Async review and media metadata

**Files:** Create `apps/api/src/db/mysql-review-store.ts`, `apps/api/src/db/mysql-cover-assets.ts`, `tests/mysql-review-assets.test.ts`.

**Interfaces:** Export `createMysqlReviewStore(pool: Pool, projects: MysqlProjectStore)` and `createMysqlCoverAssets(pool: Pool, directory: string, projects: MysqlProjectStore)`. Approval writes publication, project timestamp, and review status atomically; binary images remain on disk.

- [ ] Write `mysql review publishes one frozen snapshot`: assert second pending submit gets 409, non-admin approve gets 403, tampered hash gets 409, and successful approval publishes the exact submitted JSON. Assert published asset read and orphan cleanup affect only fixture IDs.
- [ ] Run `npx tsx --test tests/mysql-review-assets.test.ts`; confirm red.
- [ ] Implement stores with MySQL-compatible pending uniqueness and transaction locking.
- [ ] Run focused test and build; confirm green. Commit Task 4 files.

### Task 5: Async player store and API cutover

**Files:** Create `apps/api/src/db/mysql-save-store.ts`, `tests/mysql-save-api.test.ts`; modify `apps/api/src/{index,app,script-repository}.ts`, `apps/api/src/creator/{auth-router,project-router,review-router}.ts`, `scripts/create-admin.ts`.

**Interfaces:** Export `createMysqlSaveStore(pool: Pool)` with async equivalents of existing save/gallery methods. API initialization awaits pool/migration and constructs only MySQL stores. All database-calling routes/repository methods await results while preserving status semantics.

- [ ] Write `mysql save is atomic`: assert stale revision rejects without changing state/gallery; successful update records both; manual slot load restores state; mismatched derived-memory revision returns false. Assert published-story listing and absent MySQL settings.
- [ ] Run `npx tsx --test tests/mysql-save-api.test.ts`; confirm red.
- [ ] Implement save store and switch API/routers/admin utility to async MySQL operations.
- [ ] Run focused tests, relevant API tests, and build; confirm green. Commit Task 5 files.

### Task 6: Admin seed, remote smoke, and SQLite retirement

**Files:** Create `scripts/seed-superadmin.ts`, `scripts/mysql-smoke.ts`, `tests/mysql-remote-smoke.test.ts`; modify `package.json`, `README.md`, `docs/architecture.md`, old SQLite tests/imports; remove replaced SQLite stores only after tests pass.

**Interfaces:** Seed reads the single `superadmin` credential row from a consistent SQLite backup through one-off system `sqlite3`, inserts it only if MySQL account/project/save/gallery tables are empty, and copies no sessions. Smoke requires `MYSQL_REMOTE_SMOKE=1`, creates UUID-tagged rows, and deletes exact fixture IDs only.

- [ ] Write `remote smoke cleanup is scoped`: assert nonempty seed target rejects, fixture cleanup deletes only its UUID-tagged rows, and simulated interruption reports remaining IDs without `DROP`, `TRUNCATE`, or unscoped `DELETE`.
- [ ] Run `npx tsx --test tests/mysql-remote-smoke.test.ts`; confirm red.
- [ ] Take a consistent SQLite backup, implement seed/smoke, retire `better-sqlite3` code/dependency, convert old DB tests, and update docs without secrets.
- [ ] Run `npm test`, `npm run build`, and opt-in remote smoke; verify no fixture rows remain and only `superadmin` exists. Commit Task 6 files only.

## Cutover stop condition

If the target is not the expected empty schema before Task 1 migration, or has unexpected user/story/save rows before Task 6 seeding, stop and report. Never drop, truncate, or blanket-delete remote data. Leave original SQLite data untouched.
