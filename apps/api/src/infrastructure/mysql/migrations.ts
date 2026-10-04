import type { Pool, RowDataPacket } from 'mysql2/promise';

const publishedVersionsTable = `CREATE TABLE IF NOT EXISTS published_script_versions (
  project_id VARCHAR(128) NOT NULL, release_sequence BIGINT NOT NULL,
  version VARCHAR(64) NOT NULL, content_hash VARCHAR(128) NOT NULL,
  script_json LONGTEXT NOT NULL, review_id VARCHAR(64), published_at VARCHAR(35) NOT NULL,
  PRIMARY KEY (project_id, release_sequence), UNIQUE KEY published_version_label (project_id, version),
  FOREIGN KEY (project_id) REFERENCES creator_projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const creatorImportJobsTable = `CREATE TABLE IF NOT EXISTS creator_import_jobs (
  id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, owner_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL, progress VARCHAR(64) NOT NULL,
  source_path TEXT, revisions_json LONGTEXT NOT NULL, parts_json LONGTEXT,
  report_json LONGTEXT, error_text TEXT, created_at VARCHAR(35) NOT NULL, updated_at VARCHAR(35) NOT NULL,
  active_project_id VARCHAR(128) GENERATED ALWAYS AS
    (CASE WHEN status IN ('running','ready') THEN project_id ELSE NULL END) STORED,
  UNIQUE KEY creator_import_one_active (active_project_id),
  active_owner_id VARCHAR(64) GENERATED ALWAYS AS
    (CASE WHEN status IN ('running','ready') THEN owner_id ELSE NULL END) STORED,
  UNIQUE KEY creator_import_one_owner_active (active_owner_id),
  INDEX creator_import_project (project_id, owner_id, updated_at),
  FOREIGN KEY (project_id) REFERENCES creator_projects(id),
  FOREIGN KEY (owner_id) REFERENCES creator_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const aiAuditTables = [
  `CREATE TABLE IF NOT EXISTS ai_call_records (
    id VARCHAR(64) PRIMARY KEY, account_id VARCHAR(64), source VARCHAR(16) NOT NULL,
    story_id VARCHAR(128), playtest_id VARCHAR(64), release_version VARCHAR(64), operation_id VARCHAR(128) NOT NULL,
    purpose VARCHAR(64) NOT NULL, model VARCHAR(128) NOT NULL, provider_index INT NOT NULL,
    started_at VARCHAR(35) NOT NULL, duration_ms INT NOT NULL, http_status INT, outcome VARCHAR(32) NOT NULL,
    input_tokens BIGINT, output_tokens BIGINT, cache_write_tokens BIGINT, cache_read_tokens BIGINT,
    INDEX ai_call_account_time (account_id, started_at, id), INDEX ai_call_time (started_at, id),
    INDEX ai_call_story_time (story_id, started_at), INDEX ai_call_playtest (playtest_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ai_call_monthly (
    month CHAR(7) NOT NULL, account_key VARCHAR(64) NOT NULL, source VARCHAR(16) NOT NULL,
    story_key VARCHAR(128) NOT NULL, model VARCHAR(128) NOT NULL, purpose VARCHAR(64) NOT NULL,
    calls BIGINT NOT NULL DEFAULT 0, success_calls BIGINT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT NOT NULL DEFAULT 0, cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    input_known BIGINT NOT NULL DEFAULT 0, output_known BIGINT NOT NULL DEFAULT 0,
    cache_write_known BIGINT NOT NULL DEFAULT 0, cache_read_known BIGINT NOT NULL DEFAULT 0,
    cache_hit_calls BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (month, account_key, source, story_key, model, purpose),
    INDEX ai_monthly_account (account_key, month)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const creatorPlaytestsTable = `CREATE TABLE IF NOT EXISTS creator_playtests (
  id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, owner_id VARCHAR(64) NOT NULL,
  sequence BIGINT NOT NULL AUTO_INCREMENT, UNIQUE KEY creator_playtest_sequence (sequence),
  script_json LONGTEXT NOT NULL, script_hash VARCHAR(128) NOT NULL,
  auto_state_json LONGTEXT, auto_revision INT NOT NULL DEFAULT 0,
  created_at VARCHAR(35) NOT NULL, played_at VARCHAR(35),
  INDEX creator_playtests_owner (owner_id, project_id, sequence),
  FOREIGN KEY (project_id) REFERENCES creator_projects(id),
  FOREIGN KEY (owner_id) REFERENCES creator_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function migratePlaytests(pool: Pool) {
  await pool.query(creatorPlaytestsTable);
  await pool.execute('UPDATE schema_migrations SET version=6 WHERE version=5');
}

async function migrateAudit(pool: Pool) {
  for (const sql of aiAuditTables) await pool.query(sql);
  await pool.execute('UPDATE schema_migrations SET version=5 WHERE version=4');
}

const tables = [
  `CREATE TABLE creator_accounts (
    id VARCHAR(64) PRIMARY KEY, username VARCHAR(32) NOT NULL UNIQUE,
    password_salt VARCHAR(64) NOT NULL, password_hash VARCHAR(128) NOT NULL,
    created_at VARCHAR(35) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'author',
    CHECK (role IN ('author','admin'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE creator_sessions (
    token_hash CHAR(64) PRIMARY KEY, account_id VARCHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL, INDEX creator_sessions_account (account_id),
    FOREIGN KEY (account_id) REFERENCES creator_accounts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE creator_projects (
    id VARCHAR(128) PRIMARY KEY, owner_id VARCHAR(64) NOT NULL, title VARCHAR(100) NOT NULL,
    created_at VARCHAR(35) NOT NULL, updated_at VARCHAR(35) NOT NULL,
    published_at VARCHAR(35), deleted_at VARCHAR(35),
    INDEX creator_projects_owner (owner_id, deleted_at),
    FOREIGN KEY (owner_id) REFERENCES creator_accounts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE creator_sections (
    project_id VARCHAR(128) NOT NULL, path VARCHAR(255) NOT NULL, content LONGTEXT NOT NULL,
    revision INT NOT NULL DEFAULT 1, updated_at VARCHAR(35) NOT NULL,
    PRIMARY KEY (project_id, path), FOREIGN KEY (project_id) REFERENCES creator_projects(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE published_scripts (
    project_id VARCHAR(128) PRIMARY KEY, script_json LONGTEXT NOT NULL,
    version VARCHAR(64) NOT NULL, content_hash VARCHAR(128) NOT NULL,
    published_at VARCHAR(35) NOT NULL,
    FOREIGN KEY (project_id) REFERENCES creator_projects(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  publishedVersionsTable,
  creatorImportJobsTable,
  ...aiAuditTables,
  creatorPlaytestsTable,
  `CREATE TABLE creator_review_submissions (
    id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, author_id VARCHAR(64) NOT NULL,
    script_json LONGTEXT NOT NULL, content_hash VARCHAR(128) NOT NULL, version VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL, submitted_at VARCHAR(35) NOT NULL,
    reviewed_at VARCHAR(35), reviewer_id VARCHAR(64), rejection_reason TEXT,
    pending_project_id VARCHAR(128) GENERATED ALWAYS AS (CASE WHEN status='pending' THEN project_id ELSE NULL END) STORED,
    UNIQUE KEY creator_one_pending_review (pending_project_id),
    INDEX creator_review_project_time (project_id, submitted_at),
    CHECK (status IN ('pending','approved','rejected')),
    FOREIGN KEY (project_id) REFERENCES creator_projects(id),
    FOREIGN KEY (author_id) REFERENCES creator_accounts(id),
    FOREIGN KEY (reviewer_id) REFERENCES creator_accounts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE creator_cover_assets (
    id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, mime VARCHAR(80) NOT NULL,
    extension VARCHAR(8) NOT NULL, created_at VARCHAR(35) NOT NULL,
    FOREIGN KEY (project_id) REFERENCES creator_projects(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE creator_item_image_assets (
    id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, mime VARCHAR(80) NOT NULL,
    extension VARCHAR(8) NOT NULL, created_at VARCHAR(35) NOT NULL,
    FOREIGN KEY (project_id) REFERENCES creator_projects(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE save_slots (
    owner_id VARCHAR(128) NOT NULL, game_id VARCHAR(128) NOT NULL,
    slot TINYINT NOT NULL, label VARCHAR(255) NOT NULL, state_json LONGTEXT NOT NULL,
    revision INT NOT NULL DEFAULT 1, updated_at VARCHAR(35) NOT NULL,
    PRIMARY KEY (owner_id, game_id, slot), CHECK (slot BETWEEN 0 AND 5)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE gallery (
    owner_id VARCHAR(128) NOT NULL, game_id VARCHAR(128) NOT NULL,
    kind VARCHAR(16) NOT NULL, entry_id VARCHAR(128) NOT NULL, unlocked_at VARCHAR(35) NOT NULL,
    PRIMARY KEY (owner_id, game_id, kind, entry_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE schema_migrations (
    version INT PRIMARY KEY, applied_at VARCHAR(35) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function migrateMysql(pool: Pool): Promise<void> {
  const [databaseRows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  if (!databaseRows[0]?.name) throw new Error('MySQL 未选择数据库');
  const [countRows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE()');
  const count = Number(countRows[0]?.total ?? 0);
  if (count) {
    const [ledgerRows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='schema_migrations'");
    if (!Number(ledgerRows[0]?.total)) throw new Error('目标数据库不为空且缺少迁移版本表，停止以保护现有数据');
    const [versions] = await pool.query<RowDataPacket[]>('SELECT version FROM schema_migrations');
    if (versions.length === 1 && Number(versions[0].version) === 6) return;
    if (versions.length === 1 && Number(versions[0].version) === 5) { await migratePlaytests(pool); return; }
    if (versions.length === 1 && Number(versions[0].version) === 4) { await migrateAudit(pool); await migratePlaytests(pool); return; }
    if (versions.length === 1 && Number(versions[0].version) === 3) {
      await pool.query(`ALTER TABLE creator_import_jobs
        ADD COLUMN active_owner_id VARCHAR(64) GENERATED ALWAYS AS
          (CASE WHEN status IN ('running','ready') THEN owner_id ELSE NULL END) STORED,
        ADD UNIQUE KEY creator_import_one_owner_active (active_owner_id)`);
      await pool.execute('UPDATE schema_migrations SET version=4 WHERE version=3');
      await migrateAudit(pool);
      await migratePlaytests(pool);
      return;
    }
    if (versions.length === 1 && Number(versions[0].version) === 2) {
      await pool.query(creatorImportJobsTable);
      await pool.execute('UPDATE schema_migrations SET version=4 WHERE version=2');
      await migrateAudit(pool);
      await migratePlaytests(pool);
      return;
    }
    if (versions.length === 1 && Number(versions[0].version) === 1) {
      await pool.query(publishedVersionsTable);
      await pool.execute(`INSERT INTO published_script_versions
        (project_id,release_sequence,version,content_hash,script_json,review_id,published_at)
        SELECT project_id,1,version,content_hash,script_json,NULL,published_at FROM published_scripts WHERE TRUE
        ON DUPLICATE KEY UPDATE review_id=review_id`);
      const [missing] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS missing FROM published_scripts p
        LEFT JOIN published_script_versions v ON v.project_id=p.project_id AND v.release_sequence=1
        WHERE v.project_id IS NULL OR BINARY v.version<>BINARY p.version
          OR BINARY v.content_hash<>BINARY p.content_hash OR BINARY v.script_json<>BINARY p.script_json`);
      if (Number(missing[0]?.missing ?? 0)) throw new Error('历史发布快照迁移校验失败');
      await pool.execute('UPDATE schema_migrations SET version=2 WHERE version=1');
      await pool.query(creatorImportJobsTable);
      await pool.execute('UPDATE schema_migrations SET version=4 WHERE version=2');
      await migrateAudit(pool);
      await migratePlaytests(pool);
      return;
    }
    throw new Error('MySQL 迁移版本不兼容');
  }
  for (const sql of tables) await pool.query(sql);
  await pool.execute('INSERT INTO schema_migrations (version,applied_at) VALUES (?,?)', [6, new Date().toISOString()]);
}
