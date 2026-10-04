import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import type { ChatAdapter } from '../gameplay/chat-service.js';
import { createCreatorRouter } from '../auth/auth-router.js';
import { createProjectRouter } from './projects/project-router.js';
import { createReviewRouter } from './review/review-router.js';
import { createImportRouter } from './import/import-router.js';
import { createPlaytestRouter } from '../playtest/router.js';
import { defaultCoverDirectory } from './assets/cover-path.js';
import { createMysqlCoverAssets, type MysqlCoverAssets } from '../../infrastructure/mysql/mysql-cover-assets.js';
import { createMysqlCreatorImportStore, type MysqlCreatorImportStore } from '../../infrastructure/mysql/mysql-creator-import.js';
import type { MysqlCreatorStore } from '../../infrastructure/mysql/mysql-auth-store.js';
import type { MysqlProjectStore } from '../../infrastructure/mysql/mysql-project-store.js';
import type { MysqlReviewStore } from '../../infrastructure/mysql/mysql-review-store.js';
import type { MysqlPlaytestStore } from '../../infrastructure/mysql/mysql-playtest-store.js';
import type { MysqlAiAuditStore } from '../../infrastructure/mysql/mysql-ai-audit-store.js';

export interface CreatorModuleOptions {
  creatorStore?: MysqlCreatorStore;
  projectStore?: MysqlProjectStore;
  reviewStore?: MysqlReviewStore;
  coversDir?: string;
  mysqlPool?: Pool;
  importStore?: MysqlCreatorImportStore;
  auditStore?: MysqlAiAuditStore;
  playtestStore?: MysqlPlaytestStore;
}

export function mountCreatorModule(app: Express, options: CreatorModuleOptions, adapter: ChatAdapter): MysqlCoverAssets | null {
  if (options.creatorStore && options.projectStore && options.reviewStore && !options.mysqlPool)
    throw new Error('创作项目需要 MySQL 连接池');
  const covers = options.creatorStore && options.projectStore && options.mysqlPool
    ? createMysqlCoverAssets(options.mysqlPool, options.coversDir ?? defaultCoverDirectory(), options.projectStore)
    : null;
  if (options.creatorStore) app.use('/api/creator', createCreatorRouter(options.creatorStore));
  if (options.creatorStore && options.projectStore && options.reviewStore)
    app.use('/api/creator', createProjectRouter(options.creatorStore, options.projectStore, options.reviewStore, covers!));
  if (options.creatorStore && options.mysqlPool)
    app.use('/api/creator', createImportRouter(options.creatorStore,
      options.importStore ?? createMysqlCreatorImportStore(options.mysqlPool), undefined, options.auditStore));
  if (options.creatorStore && options.projectStore && options.playtestStore)
    app.use('/api/creator', createPlaytestRouter(options.creatorStore,
      options.projectStore, options.playtestStore, adapter));
  if (options.creatorStore && options.reviewStore)
    app.use('/api/creator/reviews', createReviewRouter(options.creatorStore, options.reviewStore));
  return covers;
}
