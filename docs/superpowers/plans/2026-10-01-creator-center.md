# Web 创作中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让多个创作者分别建立、编辑、发布和下架可玩的故事，同时明确隔离前端、后端与共享包。

**Architecture:** 单仓库 npm workspaces；创作账号、草稿和发布版本持久化在 SQLite。前端创作工作台是独立模块，后端创作路由是独立模块。游玩端从剧本仓库同时读取内置样例和数据库已发布版本。

**Tech Stack:** TypeScript、React、Vite、Express、better-sqlite3、Node scrypt、Node test runner。

**Spec:** `docs/superpowers/specs/2026-10-01-creator-center-design.md`

## Global Constraints

- 创作者只能读写自己拥有的项目；不实现同一剧本多人共编。
- 游客存档身份与创作者账号分离，密钥和草稿不进入浏览器的游戏接口。
- 草稿按配置项修订号保存；发布只读取校验通过的统一剧本快照。
- 内置 `sword-and-screen` 仍由 `content/` 加载，可作为复制模板。
- 删除下架项目并保留现有玩家存档与历史发布记录。
- 前端继续沿用现有配色和字体；新界面不继续堆在游玩 `App.tsx` 中。

## Review Focus

- 同作者两个标签页编辑同一配置项：旧修订返回冲突且不得覆盖。
- 非作者按已知项目 ID 查询或写入：均不得泄露项目内容。
- 草稿 JSON 不完整：仍能保存，发布必须拒绝并定位错误。
- 发布后修改草稿：目录内容不变，直到再次发布。
- 删除已发布项目：目录不再出现，旧存档行仍保留。

---

### Task 1: 工程边界与入口

**Files:** root `package.json`、`package-lock.json`、各 `apps/*/package.json` 与 `packages/*/package.json`、`apps/web/src/main.tsx`、`apps/api/src/index.ts`、`README.md`。

**Interfaces:** npm workspaces 包名 `@game/web`、`@game/api`、`@game/contracts`、`@game/engine`、`@game/script`；根命令 `dev`、`test`、`build` 保持可用。

- [ ] 对照当前 `npm test` 和 `npm run build` 保留基线结果。
- [ ] 增加工作区清单与独立应用脚本，把跨应用相对路径改为共享包导入，保留静态资源路径。
- [ ] 运行全套测试与前后端构建，修复模块解析问题。

### Task 2: 创作者身份和授权

**Files:** 新增 `apps/api/src/creator/auth-store.ts`、`auth-router.ts`、`security.ts`；修改 `apps/api/src/index.ts` 与 API 组合入口；测试 `tests/creator-auth.test.ts`。

**Interfaces:** `createCreatorStore(dbPath)` 提供 `register/login/session/logout`；路由 `POST /api/creator/register|login|logout`、`GET /api/creator/me`；中间件向请求提供 `creatorId`。

- [ ] 先写注册、登录、错误密码、过期会话、跨账号访问与来源检查测试；确认失败。
- [ ] 实现 SQLite 账号／会话表、随机盐 scrypt、令牌哈希和 HttpOnly Cookie。
- [ ] 跑身份测试，再跑全套测试。

### Task 3: 草稿存储和剧本装配

**Files:** 新增 `apps/api/src/creator/project-store.ts`、`packages/script/src/parts.ts`；修改 `packages/script/src/index.ts`；测试 `tests/creator-project.test.ts`、`tests/script-parts.test.ts`。

**Interfaces:** `assembleScriptParts(parts: Record<string,string>): GameScript`；项目存储 `create/list/get/putSection/delete/validate/publish`，`putSection` 接受并比对 `expectedRevision`。

- [ ] 先写空白故事与示例复制、JSON 标签自动保存、并发修订冲突、NPC 增删、非法引用发布失败测试；确认失败。
- [ ] 实现项目及配置项表、最小空白模板、样例复制、统一剧本装配与诊断。
- [ ] 跑新增及现有剧本测试。

### Task 4: 发布剧本接入游玩目录

**Files:** 新增 `apps/api/src/script-repository.ts`；修改 `apps/api/src/app.ts`、`apps/api/src/index.ts`；测试 `tests/creator-publish.test.ts`。

**Interfaces:** `ScriptRepository` 暴露 `get(id)`、`list()`；内置内容与当前已发布项目合并，游戏接口依赖注入仓库。

- [ ] 写发布后目录可见、未发布不可见、再编辑不改变已发布内容、下架后存档保留测试；确认失败。
- [ ] 实现发布事务、版本与哈希快照、仓库查询、已有游戏接口注入。
- [ ] 跑 API、存档和全套测试。

### Task 5: 创作工作台界面

**Files:** 新增 `apps/web/src/creator/` 下的账号页、项目列表、编辑页、表单控件、状态管理和样式；修改 `apps/web/src/main.tsx`；测试关键纯状态逻辑。

**Interfaces:** `/creator` 进入创作中心；剧本和 NPC 标签对应草稿配置项；保存状态 `dirty/saving/saved/conflict/error`；校验与发布结果显示字段定位。

- [ ] 用现有配色和字体完成可查看 v0：登录、故事列表、分栏编辑布局和各标签空状态。
- [ ] 接入账号和项目 API，完成标签切换保存、数组操作、可读字段说明与高级 JSON 输入。
- [ ] 实现新增／复制／删除 NPC 与故事、校验、发布及目录跳转。
- [ ] 检查键盘可达性、窄屏布局、错误和冲突反馈，运行构建。

### Task 6: 端到端核验与交付

**Files:** `README.md`、创作配置说明与必要测试。

- [ ] 在浏览器以两个账号走完整流程：创作、刷新、编辑、发布、游玩、下架；验证非作者不可访问。
- [ ] 运行 `npm test`、`npm run build` 并检查错误输出。
- [ ] 更新启动、部署和数据备份说明；报告尚未覆盖的边界。
