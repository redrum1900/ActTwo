# Creator Publish Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作者提交不可变故事版本供管理员审核，只有审核通过才更新玩家目录，并提供 `superadmin` 审核账号。

**Architecture:** 在现有 SQLite 创作账号、草稿和已发布剧本上增加管理员角色与审核申请表。作者提交时校验并冻结完整 `GameScript`；管理员在事务中批准后写入 `published_scripts`，驳回不修改线上版本。创作中心依角色显示作者状态或管理员审核工作台。

**Tech Stack:** TypeScript、React、Express、better-sqlite3、Node scrypt、Node test runner。

**Spec:** `docs/superpowers/specs/2026-10-01-creator-publish-review-design.md`

## Global Constraints

- 公开注册始终产生 `author`，客户端不能指定 `admin`。
- 同一故事最多一份 `pending`；审核期间作者草稿可变，申请快照不可变。
- 待审/驳回的修改版不替换旧线上版本；新故事审核前不可见。
- 旧 `/api/creator/projects/:id/publish` 路由必须移除，不能绕过审核。
- 已存在的 `published_scripts` 保持上架；内置 `content/` 不受审核流程影响。
- 管理员用户名为 `superadmin`；密码只进入本机数据库的加盐哈希，不写入代码、计划、日志或响应。

## File Structure

- `apps/api/src/creator/auth-store.ts`：账号角色和管理员创建方法。
- `scripts/create-admin.ts`：一次性本机管理员创建命令，从终端安全读取密码。
- `apps/api/src/creator/project-store.ts`：作者草稿读取、校验与项目元数据；移除直接发布方法。
- `apps/api/src/creator/review-store.ts`：审核申请表、不可变快照、提交与审核事务。
- `apps/api/src/creator/project-router.ts`：作者提交接口及带审核状态的项目响应。
- `apps/api/src/creator/review-router.ts`：仅管理员可用的审核接口。
- `apps/api/src/app.ts`、`index.ts`：路由/存储组装，沿用现有游戏剧本仓库。
- `apps/web/src/creator/`：作者状态和独立管理员审核工作台；游戏游玩模块不动。
- `tests/creator-*.test.ts`：身份、存储、HTTP、目录和页面状态测试。

## Review Focus

- 客户端注册时提交 `role: "admin"`：服务器仍只创建作者（Task 1 测试）。
- 作者提交后继续改草稿：管理员审到的哈希和内容保持原样（Task 2 测试）。
- 两个审核动作并发或重复：仅一个成功，另一个 409，线上版本不被反复覆盖（Task 2 测试）。
- 已发布故事提交修改版后遭驳回：旧线上版本和现有存档行不变（Task 3 测试）。
- 删除待审故事后管理员批准：必须失败且目录不出现该故事（Task 2 测试）。

---

### Task 1: 管理员身份与本机创建

**Files:** `apps/api/src/creator/auth-store.ts`、`apps/api/src/creator/auth-router.ts`、`scripts/create-admin.ts`、`package.json`、`tests/creator-auth.test.ts`、新 `tests/creator-admin.test.ts`。

**Interfaces:** `CreatorAccount.role: 'author' | 'admin'`；`CreatorStore.createAdmin(username: string, password: string): CreatorAccount`；CLI `npm run admin:create -- superadmin` 从交互输入读取密码，已存在用户名时报错。

- [ ] 写失败测试：注册体带 `role: 'admin'` 仍返回作者；老账号迁移后是作者；`createAdmin` 登录返回管理员；重复创建失败，密码明文不在 DB。
- [ ] 运行 `npx tsx --test tests/creator-auth.test.ts tests/creator-admin.test.ts`，确认新增断言失败。
- [ ] 添加 `role` 列迁移与账号会话查询；实现 `createAdmin` 和无密码回显的 CLI，避免把口令放进命令行参数。
- [ ] 重跑上述测试和 `npm run build`，通过后提交。

### Task 2: 不可变审核快照与事务

**Files:** `apps/api/src/creator/project-store.ts`、新 `apps/api/src/creator/review-store.ts`、`tests/creator-project.test.ts`、新 `tests/creator-review.test.ts`。

**Interfaces:** `ProjectStore.validatedDraft(ownerId,id): GameScript`；`ReviewStore.submit(ownerId,projectId): ReviewSubmission`；`listPending()`、`get(submissionId)`、`approve(adminId,submissionId)`、`reject(adminId,submissionId,reason)`、`latestForProject(ownerId,projectId)`。

- [ ] 写失败测试：新申请不发布、修改草稿不变快照、重复待审 409、批准发布、驳回原因、删除后不可批准、重复审核 409、旧发布版本保持可见。
- [ ] 运行 `npx tsx --test tests/creator-project.test.ts tests/creator-review.test.ts`，确认失败。
- [ ] 建申请表与 pending 唯一索引；提交时调用 `validatedDraft`；批准在单事务内更新 `published_scripts` 与项目发布时间；移除项目存储的直发方法。
- [ ] 运行新增测试及 `npm run build`，通过后提交。

### Task 3: 受权审核 API 与玩家目录

**Files:** `apps/api/src/creator/project-router.ts`、新 `review-router.ts`、`apps/api/src/app.ts`、`index.ts`、`tests/creator-api.test.ts`、`tests/creator-publish.test.ts`、新 `tests/creator-review-api.test.ts`。

**Interfaces:** 作者 `POST /api/creator/projects/:id/submit`；管理员 `GET /api/creator/reviews`、`GET /api/creator/reviews/:id`、`POST /api/creator/reviews/:id/approve|reject`；项目响应增加最新审核状态、原因和提交时间。

- [ ] 写失败测试：未登录 401、作者审核 403、他人草稿 404、直发路由不可用、提交后目录仍隐藏、批准后可玩、修改版待审/驳回旧版可玩。
- [ ] 运行对应 API 测试并确认失败。
- [ ] 接入新路由及角色检查；让项目列表/详情返回审核摘要，保留游戏仓库只读已批准快照。
- [ ] 运行 API 测试、`npm test` 和构建，通过后提交。

### Task 4: 作者状态与管理员工作台

**Files:** `apps/web/src/creator/client.ts`、`CreatorApp.tsx`、新 `ReviewWorkspace.tsx`、`creator.css`、`tests/creator-editor.test.ts`。

**Interfaces:** 登录返回角色；作者提交后显示待审而非已上架；管理员访问 `/creator/review` 查看审核队列和快照详情，可批准或附原因驳回。

- [ ] 写失败测试：状态文案映射、管理员工作台只在 admin 角色渲染、驳回需原因。
- [ ] 运行前端纯逻辑/静态渲染测试，确认失败。
- [ ] 沿用现有视觉变量实现队列、详情、审核动作与错误态；作者端显示待审、驳回、旧版仍在线。
- [ ] 运行测试、构建和可用浏览器的交互检查；若浏览器不可用，明确记录未验收项；提交。

### Task 5: 迁移核验、账号交付与文档

**Files:** `README.md`、必要的迁移/启动测试。

- [ ] 用独立临时 SQLite 测试旧发布记录迁移后仍在目录，不触碰用户现有存档。
- [ ] 更新管理员创建、审核流程、部署备份说明；跑 `npm test`、`npm run build`、`git diff --check`。
- [ ] 在当前本机数据库中创建 `superadmin`，只用用户指定密码的加盐哈希；验证能登录且角色是 admin，不打印密码。
- [ ] 报告本机账号、访问地址、测试结果与尚未完成的人工界面验收；不提交任何口令。
- [ ] 提交文档与必要修正，确认工作树无遗漏。
