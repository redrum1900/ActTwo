import type { Pool } from 'mysql2/promise';
import { createMysqlCreatorStore } from '../../apps/api/src/infrastructure/mysql/mysql-auth-store.js';
import { createMysqlProjectStore } from '../../apps/api/src/infrastructure/mysql/mysql-project-store.js';
import { createMysqlReviewStore } from '../../apps/api/src/infrastructure/mysql/mysql-review-store.js';
import { withTestMysql } from './mysql-test-db.js';

export interface CreatorMysqlFixture {
  pool: Pool;
  accounts: ReturnType<typeof createMysqlCreatorStore>;
  projects: ReturnType<typeof createMysqlProjectStore>;
  reviews: ReturnType<typeof createMysqlReviewStore>;
}

export function withCreatorMysql<T>(work: (fixture: CreatorMysqlFixture) => Promise<T>): Promise<T> {
  return withTestMysql(async pool => {
    const accounts = createMysqlCreatorStore(pool);
    const projects = createMysqlProjectStore(pool);
    const reviews = createMysqlReviewStore(pool, projects);
    return work({ pool, accounts, projects, reviews });
  });
}
