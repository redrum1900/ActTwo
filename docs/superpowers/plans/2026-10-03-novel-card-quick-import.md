# 小说／角色卡快捷导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已新建的故事中导入小说或角色卡，生成完整配置，完成结构校验和 AI 矛盾审查，经作者确认后原子写入当前故事草稿并返回原项目 ID。

**Architecture:** 服务端提取上传文本，独立的 `AI_MAIN_*` 模型先一次生成完整 `GameScript`，结构错误最多修复两轮，再独立生成叙事矛盾报告。MySQL 持久化导入任务与结果，确认时按起始修订快照原子替换配置；前端只负责上传、查看进度与预览、确认覆盖。

**Tech Stack:** TypeScript、Express、React、MySQL、`@game/script` 校验器、OpenAI 兼容 Chat Completions API、`word-extractor`（纯 Node 提取 `.doc`／`.docx`）。

**Spec:** `docs/superpowers/specs/2026-10-03-novel-card-quick-import-design.md`

## Global Constraints

- 接受粘贴文本及 `.txt`、`.md`、`.doc`、`.docx`、`.json`；不接受 PDF。不设上传前字节数硬门槛，服务端流式暂存；长文本按模型容量分段处理，不静默截断；不运行文档宏或嵌入对象。
- 导入只修改当前故事草稿；`projectId`、已发布快照和旧存档不变。任何失败、取消或并发冲突都不得部分写入。
- 一次生成完整 JSON；仅结构错误可最多修复两轮。叙事审查另一次调用，疑点由创作者判断，不自动改写。
- `AI_MAIN_API_KEY`、`AI_MAIN_BASE_URL`、`AI_MAIN_MODEL` 仅服务端读取；缺失时不借用玩家对话模型。素材及密钥不进入普通日志。
- 用户确认后才应用；生成时的配置修订号用于应用时冲突检查。

## Review Focus

- UTF-8 BOM、空白和伪造扩展名：`tests/creator-import-extract.test.ts` 证明能归一化文本或明确拒绝，不把乱码发给模型。
- DOC/DOCX 中嵌入对象和无正文：同一测试证明只提取正文、空正文被拒绝。
- 模型输出包着 Markdown 代码块、截断 JSON 或未知引用：`tests/creator-import-generate.test.ts` 证明解析／修复有界且最终不写无效结果。
- 两个窗口同时修改一段、导入结果移除旧 NPC：`tests/mysql-creator-import.test.ts` 证明冲突不覆盖，成功时旧 NPC 分段确实移除。
- 审查模型失败或浏览器刷新：`tests/creator-import-api.test.ts` 与 UI 测试证明生成结果仍可取回，并显示「审查未完成」而非假称无矛盾。

---

### Task 1: 转换规则 Skill 与文本提取

**Files:**
- Create: `.agents/skills/novel-card-to-game-config/SKILL.md`
- Create: `.agents/skills/novel-card-to-game-config/references/conversion-rules.md`
- Create: `apps/api/src/creator/import-extract.ts`
- Modify: `apps/api/package.json`, `package-lock.json`
- Test: `tests/creator-import-extract.test.ts`

**Interfaces:**
- Produces: `extractImportText(fileName: string, temporaryPath: string): Promise<string>`；上传流写入临时文件后提取正文，抛出带可显示中文说明的输入错误。
- Produces: 服务端可读取的 `conversion-rules.md`，作为模型转换指令的单一来源；Skill 引导离线转化遵循相同规则。

- [ ] **Step 1: 写失败测试**：TXT/MD/JSON 与 BOM、空文件、错误签名、DOC/DOCX 样例分别断言正文或明确错误；较大文件不因预设字节数被拒绝。
- [ ] **Step 2: 运行** `npx tsx --test tests/creator-import-extract.test.ts`，确认因接口缺失失败。
- [ ] **Step 3: 最小实现** `extractImportText`；安装 `word-extractor` 与类型，从临时文件提取 Word 正文并在任务终态清理；编写规则 Skill 和参考文件。
- [ ] **Step 4: 运行目标测试与 Skill 校验** `npx tsx --test tests/creator-import-extract.test.ts`、`python3 /Users/hal/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/novel-card-to-game-config`。
- [ ] **Step 5: 提交**本任务文件，保留用户已有的其他未提交改动。

### Task 2: 独立模型调用、完整生成与有界修复

**Files:**
- Create: `apps/api/src/creator/import-ai.ts`
- Create: `apps/api/src/creator/import-generate.ts`
- Modify: `.env.example`, `apps/api/src/index.ts`
- Test: `tests/creator-import-generate.test.ts`

**Interfaces:**
- Produces: `createMainAiClient(env): MainAiClient`，`complete(system: string, user: string): Promise<string>`；配置不完整时返回可识别的配置错误。
- Produces: `generateImportDraft(projectId: string, sourceText: string, ai: MainAiClient): Promise<{ parts: ScriptParts; inferences: string[]; issues: ScriptIssue[] }>`。
- Consumes: Task 1 的规则文件；使用 `scriptPartsFromScript`、`inspectScriptParts`，强制项目 ID，限制模型调用／修复轮数。

- [ ] **Step 1: 写失败测试**：完整输出得到全部分段；第一次错误可修复；两轮仍错误终止；代码围栏／截断输出拒绝；未知引用不能通过；长输入先摘要且不静默丢尾；模型密钥不出现在错误或日志。
- [ ] **Step 2: 运行** `npx tsx --test tests/creator-import-generate.test.ts`，确认期望失败。
- [ ] **Step 3: 实现**独立 OpenAI 兼容调用及完整生成服务；所有修复均再跑真实校验器，修复不得靠删空关键配置；长输入摘要保留分段出处。
- [ ] **Step 4: 运行**目标测试，确认全部通过。
- [ ] **Step 5: 提交**本任务文件。

### Task 3: 独立叙事矛盾审查

**Files:**
- Create: `apps/api/src/creator/import-review.ts`
- Test: `tests/creator-import-review.test.ts`

**Interfaces:**
- Produces: `reviewImport(sourceText: string, parts: ScriptParts, ai: MainAiClient): Promise<{ status: 'complete' | 'unavailable'; findings: ImportFinding[] }>`；`ImportFinding` 含 `path`、`sourceEvidence`、`concern`、`suggestion`、`uncertainty`。
- Consumes: Task 2 的 `MainAiClient`；不修改 `parts`。

- [ ] **Step 1: 写失败测试**：有依据的疑点可定位；无依据断言须标待确认；审查 API 出错返回 unavailable，生成配置保持原样。
- [ ] **Step 2: 运行** `npx tsx --test tests/creator-import-review.test.ts`，确认失败。
- [ ] **Step 3: 实现**独立审查调用和输出结构校验；不将审查结论作为静态合法性证明。
- [ ] **Step 4: 运行**目标测试。
- [ ] **Step 5: 提交**本任务文件。

### Task 4: MySQL 导入任务与原子草稿替换

**Files:**
- Create: `apps/api/src/db/mysql-creator-import.ts`
- Modify: `apps/api/src/db/migrations.ts`, `apps/api/src/db/mysql-project-store.ts`
- Test: `tests/mysql-creator-import.test.ts`

**Interfaces:**
- Produces: `MysqlCreatorImportStore` 的 `create`、`getOwned`、`updateProgress`、`finish`、`cancel`、`apply` 方法；任务按 owner+project 隔离，含状态、进度、起始修订映射、临时素材与生成结果。
- `apply(ownerId, projectId, jobId)` 返回 `{ projectId, project }`；在一个事务中重新校验结果和修订、替换全部配置分段、清理临时素材；冲突为 409。

- [ ] **Step 1: 写失败测试**：新故事 ID 原样返回、空白模板分段被替换、旧 NPC 分段删除；修订冲突／非所有者／取消任务不改任何分段；事务失败可回滚；发布快照不被触及。
- [ ] **Step 2: 运行** `npx tsx --test tests/mysql-creator-import.test.ts`，确认失败。
- [ ] **Step 3: 实现**迁移表与存储方法；暂存素材在完成后删除，任务定期过期；服务重启后待处理任务可恢复或明确失败，不留永远 running。
- [ ] **Step 4: 运行**目标测试，包括对迁移的现有测试。
- [ ] **Step 5: 提交**本任务文件。

### Task 5: 鉴权 API 与后台导入执行

**Files:**
- Create: `apps/api/src/creator/import-router.ts`
- Create: `apps/api/src/creator/import-worker.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/index.ts`
- Test: `tests/creator-import-api.test.ts`

**Interfaces:**
- `POST /api/creator/projects/:id/import-jobs`：二进制正文 + 原始文件名头；粘贴文本同样上传 UTF-8；返回 `202 { projectId, jobId }`。
- `GET /api/creator/projects/:id/import-jobs/:jobId`：返回进度、结构报告、推断清单、矛盾审查与可预览分段，不返回密钥或原素材。
- `POST /api/creator/projects/:id/import-jobs/:jobId/apply`：确认应用，返回 `{ projectId, project }`；`DELETE` 取消未应用任务。

- [ ] **Step 1: 写失败测试**：鉴权、文件格式与流式上传、同项目单任务并发、生成成功、结构失败、审查降级、刷新后查询、取消及确认写入；应用 API 回传原故事 ID。
- [ ] **Step 2: 运行** `npx tsx --test tests/creator-import-api.test.ts`，确认失败。
- [ ] **Step 3: 实现**路由和受控后台任务；后台任务与 HTTP 生命周期解耦，状态写 MySQL；提供超时、取消与安全重试，不输出素材到日志。
- [ ] **Step 4: 运行**目标 API 测试与已有创作中心 API 测试。
- [ ] **Step 5: 提交**本任务文件。

### Task 6: 创作中心导入交互

**Files:**
- Create: `apps/web/src/creator/ImportStoryModal.tsx`
- Modify: `apps/web/src/creator/CreatorApp.tsx`, `apps/web/src/creator/client.ts`, `apps/web/src/creator/creator.css`
- Test: `tests/creator-import-ui.test.ts`

**Interfaces:**
- 顶栏「智能导入」；弹窗选择五种文件或粘贴文本，展示上传／生成／校验／审查／预览状态、推断和疑点，确认时调用 Task 5 API；保留当前 `projectId`。

- [ ] **Step 1: 写失败测试**：新建故事后导入回传同 ID；有未保存修改须先处理；取消与失败不改编辑内容；生成报告可见；确认后侧栏与表单刷新，保存状态正确。
- [ ] **Step 2: 运行** `npx tsx --test tests/creator-import-ui.test.ts`，确认失败。
- [ ] **Step 3: 实现**导入弹窗、API 客户端和样式；轮询可恢复任务，清楚区分静态校验通过与 AI 审查结果。
- [ ] **Step 4: 运行**目标测试，执行 `npm test` 与 `npm run build`；在窄屏和桌面检查弹窗与顶栏布局。
- [ ] **Step 5: 提交**本任务文件，并记录需要作者实测的真实模型输出边界。
