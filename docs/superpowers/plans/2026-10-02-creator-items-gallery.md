# Creator Items and Gallery Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把道具、结局、成就改成清晰的 tab 表单，并让作者可视化编辑递归条件、上传道具图片。

**Architecture:** 三个数组配置继续是唯一数据源；表单组件只变更已知字段并保留其他字段，JSON 模式与手动保存仍共用同一草稿。条件树直接读写既有 `Condition` 递归结构；道具图片复用并泛化当前项目封面资源的鉴权与发布边界。

**Tech Stack:** TypeScript、React 19、Ant Design `Select`/`Upload`/`Tag`、Express 5、better-sqlite3、Node test/tsx、Vite。

**Spec:** `docs/superpowers/specs/2026-10-02-story-events-and-creator-forms-design.md`

**Dependency:** 先完成 `docs/superpowers/plans/2026-10-02-story-event-flags.md` 的剧情事件合同、数据源和规则绑定。

## Global Constraints

- 三页均为一项一个 tab；新增 ID 自动生成且稳定，旧 ID 原样保留，表单不提供“添加字段”。
- `description`、道具 `detail` 用 textarea；标签只增删，不提供改名或排序；JSON 模式与隐藏字段不能丢数据。
- 条件根组和任意子组均可独立选 AND/OR，任意节点可用 NOT；所有引用选择使用 Ant Design `Select`。
- 道具条件的道具名来自道具列表，持有者来自玩家/NPC/地点；无自由文本 ID。
- 图片仅接受不超过 5 MB 的 PNG/JPEG/WebP；草稿私有、发布引用才公开；选择文件不自动保存。

## Review Focus

- 新增或删除数组中间项后，选中的 tab 仍指向正确 ID，不把编辑写到旁边项（Task 1）。
- 将叶节点改成 OR 子组、对整个子组取反，再切换 JSON/表单，结构和未知字段都不丢失（Task 2）。
- 切换条件类型时旧比较值或旧 ID 不混进新类型；空组、缺失引用有就近错误（Task 2）。
- 图片已上传但配置保存发生修订冲突：资源不能公开，作者可重试，孤儿最终清理（Task 3、4）。
- 同名道具、无道具或道具被删除时：选择器按 ID 区分并明确提示无效引用，不暗中选另一项（Task 1、2）。

---

### Task 1: 道具、结局、成就的 tab 表单

**Files:**
- Create: `apps/web/src/creator/TabbedEntriesEditor.tsx`
- Create: `apps/web/src/creator/ItemsEditor.tsx`
- Create: `apps/web/src/creator/GalleryEditor.tsx`
- Modify: `apps/web/src/creator/SectionEditor.tsx`
- Modify: `apps/web/src/creator/section-forms.ts`
- Modify: `apps/web/src/creator/sections.ts`
- Modify: `apps/web/src/creator/creator.css`
- Test: `tests/creator-section-forms.test.ts`
- Test: `tests/creator-editor.test.ts`

**Interfaces:**
- Produces: `TabbedEntriesEditor` 按稳定 ID 管理数组选中/增删；`ItemsEditor`、`GalleryEditor` 接受 `content` 与 `onChange`，只 patch 当前条目的已知字段。新 ID 为 `crypto.randomUUID()`；故事事件数据由第一份计划提供。

- [ ] **Step 1: 写失败测试。** tab 新增/切换/删中间项后 ID 稳定；描述和详情包含换行仍原样保存；`initialTags` 仅增删且去重；画廊 `hidden` 可切换；未知 `variants/hiddenTags` 保留；新画廊条目未选条件前不能提交审核；JSON 往返不丢。
- [ ] **Step 2: 跑 `npx tsx --test tests/creator-section-forms.test.ts tests/creator-editor.test.ts`，确认新增测试失败。**
- [ ] **Step 3: 实现共享 tab 外壳与三种专用表单。** 标签在窄屏可横向滚动；删除必须确认；正式数据没有 ID 时阻止表单覆盖并提示 JSON 修正。
- [ ] **Step 4: 跑上述测试、`npm run build`，并核对桌面和窄屏布局。**
- [ ] **Step 5: 仅提交本任务的表单、样式与测试文件。**

### Task 2: 共用递归条件树

**Files:**
- Create: `apps/web/src/creator/condition-tree.ts`
- Create: `apps/web/src/creator/ConditionEditor.tsx`
- Modify: `apps/web/src/creator/GalleryEditor.tsx`
- Modify: `apps/web/src/creator/StoryEventRuleControls.tsx`
- Modify: `apps/web/src/creator/CreatorApp.tsx`
- Modify: `apps/web/src/creator/creator.css`
- Test: `tests/creator-condition-tree.test.ts`
- Test: `tests/creator-editor.test.ts`
- Test: `tests/creator-workflow.test.ts`

**Interfaces:**
- Consumes: `Condition` from contracts、已保存的地点/道具/NPC/玩家指标/剧情事件定义。
- Produces: `ConditionPath = readonly (number | 'not')[]`（数字进入 `all/any` 子项，`'not'` 进入取反子项）；`ConditionAction = {type:'replace';value:Condition} | {type:'insert';index:number;value:Condition} | {type:'remove';index:number} | {type:'move';from:number;to:number}`；`patchCondition(root: Condition, path: ConditionPath, action: ConditionAction): Condition`（不可变更新）；`ConditionEditor({ value, sources, onChange })`。

- [ ] **Step 1: 写失败测试。** `all`/`any` 根切换，添加/删除/上移/下移任意深度节点，对叶/组施加与解除 NOT；道具类型输出 `hasItem.owner/item`，剧情事件输出 UUID；现有 `Condition` 的其余叶类型均可往返，数值/布尔/标签指标只开放合法比较符；空组与悬空引用不被表单保存。
- [ ] **Step 2: 跑 `npx tsx --test tests/creator-condition-tree.test.ts tests/creator-editor.test.ts tests/creator-workflow.test.ts`，确认新增测试失败。**
- [ ] **Step 3: 使用第一份计划已安装的 Ant Design 实现纯函数条件树与紧凑 UI。** 使用 `Select` 选类型、目标、比较和值，节点动作有清楚可访问的名称；嵌套多层仍可折叠；未知旧条件不能被静默改写，可转到 JSON 模式。
- [ ] **Step 4: 跑上述测试和 `npm run build`，在浏览器检查树操作、键盘焦点和窄屏。**
- [ ] **Step 5: 仅提交本任务的条件编辑器、调用方与测试。**

### Task 3: 项目图片资源与道具运行时展示

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/script/src/index.ts`
- Modify: `apps/api/src/creator/cover-assets.ts`（拆分/泛化为项目图片资源时保留旧封面接口）
- Modify: `apps/api/src/creator/project-router.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/creator/client.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/creator-cover.test.ts`
- Test: `tests/creator-api.test.ts`
- Test: `tests/creator-cover-path.test.ts`
- Test: `tests/api.test.ts`

**Interfaces:**
- Produces: `ItemDefinition.image?: string`；作者鉴权上传/私有预览/丢弃 API 与已发布道具图片公开 GET；现有 `/api/covers/:id` 封面行为保持不变。
- Produces: 玩家道具视图有图片时返回可显示的受控资源 URL，无图则维持旧视图。

- [ ] **Step 1: 写失败测试。** 合法图片属当前项目且未发布前仅作者可读；非法 MIME/伪造魔数/超 5 MB/跨项目引用被拒；只有已审核剧本所引用的道具图片公开；删除/替换与未保存上传产生的孤儿可清理；封面老接口回归通过。
- [ ] **Step 2: 跑 `npx tsx --test tests/creator-cover.test.ts tests/creator-api.test.ts tests/creator-cover-path.test.ts tests/api.test.ts`，确认新增测试失败。**
- [ ] **Step 3: 扩展项目图片存储与受控路由，给道具合同和视图加入可选 `image`。** 资源关联从 `items.json`/已发布剧本判定，拒绝任意外链或其他项目 ID；不得把草稿 URL 直接暴露到玩家端。
- [ ] **Step 4: 跑上述测试、`npm test` 和 `npm run build`，确认封面与道具图片均通过。**
- [ ] **Step 5: 仅提交本任务的资源服务、合同、游戏展示与测试。**

### Task 4: 道具上传控件与保存事务

**Files:**
- Modify: `apps/web/src/creator/ItemsEditor.tsx`
- Modify: `apps/web/src/creator/SectionEditor.tsx`
- Modify: `apps/web/src/creator/CreatorApp.tsx`
- Modify: `apps/web/src/creator/client.ts`
- Modify: `apps/web/src/creator/creator.css`
- Create: `apps/web/src/creator/item-image-save.ts`
- Test: `tests/creator-item-image-ui.test.ts`
- Test: `tests/creator-workflow.test.ts`

**Interfaces:**
- Consumes: Task 3 的项目图片 API 与 `ItemDefinition.image`；Task 1 的 item tab。
- Produces: 选择文件只改变内存草稿，保存时上传对应 item 的文件、patch `items.json` 后按修订号保存；失败时回收未引用上传并保留作者可重试的输入。

- [ ] **Step 1: 写失败测试。** 选择图片只预览、不请求保存；点击保存成功才改变配置；保存冲突/上传失败保留草稿与错误；切换道具 tab 不把图片关联到别的 ID；移除图片与重置按当前配置项语义工作。
- [ ] **Step 2: 跑 `npx tsx --test tests/creator-item-image-ui.test.ts tests/creator-workflow.test.ts`，确认新增测试失败。**
- [ ] **Step 3: 实现 Ant Design Upload 或可访问的同等外壳、每个道具 ID 的待上传文件管理和保存/回收逻辑。** 复用封面格式/大小限制，但不让封面状态与道具状态互相覆盖。
- [ ] **Step 4: 跑上述测试、`npm test`、`npm run build`，并手工检查作者上传→保存→提交审核→管理员批准→玩家查看图片。**
- [ ] **Step 5: 仅提交本任务的上传 UI、保存流程与测试。**
