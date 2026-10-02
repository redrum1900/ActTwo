# Story Event Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作者定义的剧情事件通过规则成功结算写入剧本级存档，后续条件按稳定 UUID 判断。

**Architecture:** `manifest.json.storyEvents` 是唯一静态定义；`GameState.storyEventFlags` 是 append-only 的已发生对象数组。规则效果 `recordStoryEvent` 显式写入，条件 `storyEvent` 显式查询；内部 `completedEvents` 继续服务 `once`，不作为作者剧情条件。

**Tech Stack:** TypeScript、React 19、Express 5、better-sqlite3、Node test/tsx；现有创作中心样式与显式保存。

**Spec:** `docs/superpowers/specs/2026-10-02-story-events-and-creator-forms-design.md`

## Global Constraints

- 新剧情事件 ID 使用 `crypto.randomUUID()`，编辑名称或详情不能改变 ID；同一存档同一 ID 只记录一次。
- 定义对象为 `{id,label,detail}`，快照首次触发时复制整对象；`detail` 可为空字符串。
- 仅成功结算且持久化的规则记录事件；AI 提议、拒绝、空效果或失败请求均不写入。
- `label/detail` 不因记录事件自动进入玩家活动日志或 AI 提示词。
- 旧存档不迁移；`completedEvents` 保留内部防重语义。

## Review Focus

- 同一剧情事件由两条规则先后记录：快照只保留一份，第二条规则的其他有效效果仍可提交（Task 1）。
- 无效 UUID 引用：发布校验报告具体条件/效果，运行时不写半条记录（Task 2）。
- AI 提议规则但服务端拒绝或回复失败：自动存档没有剧情事件（Task 3）。
- 首次表白记录事件后，再次表白与人格条件读取同一 ID；旧 `completedEvents` 仍正确防止一次性规则重跑（Task 2、3）。
- 删除仍被引用的定义：作者页面明确告警，提交审核不能通过（Task 4）。

---

### Task 1: 合同与引擎结算

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `tests/engine.test.ts`
- Test: `tests/activity-log.test.ts`

**Interfaces:**
- Produces: `StoryEventDefinition { id: string; label: string; detail: string }`、`GameScript.storyEvents: StoryEventDefinition[]`、`GameState.storyEventFlags: StoryEventDefinition[]`、`Condition { storyEvent: string }`、`Effect { type: 'recordStoryEvent'; eventId: string }`。
- Produces: `evaluateCondition` 按 `storyEventFlags[].id` 检查；`applyEffects` 从 `script.storyEvents` 拷贝定义并按 ID 去重。

- [ ] **Step 1: 写失败测试。** 新游戏事件数组为空；记录后对象完整；第二次记录不重复；`{storyEvent:id}` 和 `{not:{storyEvent:id}}` 正反成立；非法 ID 使整个规则失败；已有 `once` 仍使用 `completedEvents`；事件本身不自动出现在活动日志。
- [ ] **Step 2: 跑 `npx tsx --test tests/engine.test.ts tests/activity-log.test.ts`，确认新增测试因接口/行为缺失失败。**
- [ ] **Step 3: 实现合同与引擎最小变更。** `createInitialState` 初始化新数组；`applyEffects` 按既有克隆/失败语义执行，不单独落库；保留内部 `completedEvents`。
- [ ] **Step 4: 重跑上述测试并执行 `npx tsc --noEmit`，确认通过。**
- [ ] **Step 5: 仅提交本任务的合同、引擎与测试文件。**

### Task 2: 剧本装配、发布校验与样本迁移

**Files:**
- Modify: `packages/script/src/index.ts`
- Modify: `packages/script/src/parts.ts`
- Modify: `content/sword-and-screen/manifest.json`
- Modify: `content/sword-and-screen/npcs/su-nian/rules.json`
- Modify: `content/sword-and-screen/npcs/su-nian/personas.json`
- Modify: `content/sword-and-screen/locations.json`
- Modify: `content/sword-and-screen/endings.json`
- Test: `tests/script.test.ts`
- Test: `tests/script-parts.test.ts`
- Test: `tests/su-nian-flow.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `storyEvents`、`storyEvent`、`recordStoryEvent`。
- Produces: `loadScript`、`blankScriptParts`、`scriptPartsFromScript`、`inspectScriptParts` 对 `manifest.storyEvents` 的一致处理；`validateScript` 验证唯一 ID、UUID 新建格式与条件/效果引用。

- [ ] **Step 1: 写失败测试。** 空白剧本含 `storyEvents: []`；模板复制/发布装配保留定义；重复 ID、空 label、非字符串 detail、未知条件 ID 与未知效果 ID 各有可定位错误；苏念的剑道/表白剧情改为显式事件并能加载。
- [ ] **Step 2: 跑 `npx tsx --test tests/script.test.ts tests/script-parts.test.ts tests/su-nian-flow.test.ts`，确认新增测试失败。**
- [ ] **Step 3: 实现加载/校验及内容迁移。** 以 `storyEvents` 避免与已有 `GameScript.events`（互动规则）冲突；把苏念原有 `setFlag/flag` 与作者用的 `completedEvent` 改为剧情事件引用；内部 `completedEvents` 不删除。保持已有道具/地点/图鉴 ID 不变。
- [ ] **Step 4: 跑上述测试及 `npx tsc --noEmit`，确认通过。**
- [ ] **Step 5: 仅提交本任务的装配器、样本和测试文件。**

### Task 3: 实际游玩、自动存档与同轮图鉴

**Files:**
- Modify: `packages/engine/src/activity-log.ts`（仅当新事件需要明确防止自动日志时）
- Modify: `apps/api/src/chat-service.ts`（仅当需要保证现有失败回滚边界时）
- Modify: `apps/api/src/app.ts`（仅当动作路径需接入统一结算时）
- Test: `tests/settled-chat.test.ts`
- Test: `tests/acceptance.test.ts`
- Test: `tests/save-store.test.ts`

**Interfaces:**
- Consumes: Task 1 的快照数组与判定；Task 2 的苏念剧情事件定义。
- Produces: 对话、自动规则与其他玩家动作统一经现有 `settleWorld`/存档流程记录事件，无独立“事件写库”旁路。

- [ ] **Step 1: 写失败集成测试。** AI 只提议未接受时不记录；规则接受但最终回复失败不写自动档；成功对话写一次，下一次对话读取该 ID；同轮结局条件可读取；手动存档/读档保留对象；修订冲突不提交事件。
- [ ] **Step 2: 跑 `npx tsx --test tests/settled-chat.test.ts tests/acceptance.test.ts tests/save-store.test.ts`，确认新增测试失败。**
- [ ] **Step 3: 只修复测试揭示的结算或持久化断点。** 不增加独立事件表；快照跟随既有 `state_json` 与内容指纹机制。
- [ ] **Step 4: 跑上述测试及 `npm test`，确认通过。**
- [ ] **Step 5: 仅提交本任务实际改动的运行代码与测试。**

### Task 4: 故事设定与规则的作者入口

**Files:**
- Modify: `apps/web/src/creator/ManifestEditor.tsx`
- Modify: `apps/web/src/creator/section-forms.ts`
- Modify: `apps/web/src/creator/sections.ts`
- Modify: `apps/web/src/creator/SectionEditor.tsx`
- Create: `apps/web/src/creator/StoryEventsEditor.tsx`
- Create: `apps/web/src/creator/StoryEventRuleControls.tsx`
- Modify: `apps/web/src/creator/creator.css`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Test: `tests/creator-section-forms.test.ts`
- Test: `tests/creator-editor.test.ts`
- Test: `tests/creator-workflow.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `manifest.storyEvents`；Task 1 的新条件/效果。
- Produces: `StoryEventsEditor` 对当前 manifest 草稿进行增删改，`StoryEventRuleControls` 对规则中的事件条件/效果按已保存定义 ID 选择；供第二份计划的条件树使用同一 `storyEvents` 选项来源。

- [ ] **Step 1: 写失败测试。** 新增事件生成不同 UUID，改 label/detail 不改变 ID；未保存事件不出现在其他配置页选项；删去被引用定义时出现提示且服务端提交校验失败；切换 tab、重置与 JSON 往返不丢事件。
- [ ] **Step 2: 跑 `npx tsx --test tests/creator-section-forms.test.ts tests/creator-editor.test.ts tests/creator-workflow.test.ts`，确认新增测试失败。**
- [ ] **Step 3: 安装并锁定 Ant Design，实现在故事设定中的紧凑事件列表与规则绑定控件。** 事件引用使用 Ant Design `Select`；保持页面底部手动保存；复杂规则中非事件字段原样保留，普通作者不需手输 UUID。
- [ ] **Step 4: 跑上述测试、`npm run build` 与桌面/窄屏浏览器检查，确认通过。**
- [ ] **Step 5: 仅提交本任务的创作页与测试。**
