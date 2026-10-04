# 当前系统边界

## 目标和依赖

同一套 React 页面、Express API 和规则引擎运行不同的剧本快照。玩家目录只读取 MySQL 中已审核发布的故事；创作草稿经审核后才生成正式版本。

```text
React 页面 ──HTTP──> app.ts（HTTP 组装）
                         ├──> catalog：公开故事目录与详情
                         ├──> gameplay：正式游玩、存档与版本化会话
                         ├──> creator：草稿、审核、导入与试玩
                         └──> usage：AI 调用用量
模块共享依赖：纯规则引擎、AI 适配器、MySQL 存储与发布快照
```

`packages/contracts` 提供共同类型。引擎只读取剧本和存档，返回新状态，不依赖数据库或模型服务。`apps/api/src/index.ts` 组装生产依赖；`app.ts` 保留 `createApp` 入口并挂载模块路由。`modules/gameplay/` 集中正式游戏路由、版本化存档会话、对话、记忆与开局表单解析，`modules/catalog/router.ts` 只处理公开读取。`modules/auth/` 负责账号会话，`modules/creator/` 组装创作路由并按 `projects/`、`review/`、`import/`、`assets/` 分开实现，`modules/playtest/` 处理草稿试玩路由、快照视图与行动结算，`modules/usage/` 处理 AI 用量查询；`infrastructure/mysql/` 承载连接、迁移和数据库适配器，`infrastructure/ai/` 承载模型适配、流解析和调用审计。`script-repository.ts` 保留纯脚本测试仓库及 MySQL 已发布剧本读取接口；正式存档只由 `infrastructure/mysql/` 持久化，测试通过受保护的独立 MySQL 测试库验证。前端在 `app/` 管理玩家路由与账号，`catalog/`、`story-detail/`、`gameplay/`、`usage/` 各自承载页面，`shared/` 仅放跨页面封面展示；`main.tsx` 保留入口。前端 `creator/` 内按 `app/`、`editor/`、`session/`、`model/`、`workflows/`、`api/` 归类；`CreatorApp` 负责页面编排，`useProjectEditor` 独占草稿、修订号、媒体与离开保护状态，登录及故事列表有独立视图。

## 静态剧本与动态存档

创作者配置项保存在 MySQL 项目章节中；审核通过后冻结为发布快照。`locations.json` 是地点的唯一配置入口：地点名称、描述、`interactionMode`、`visibleWhen`、`enterWhen`、调查点和物品都在这里。没有独立的 `placements.json`。`visibleWhen` 首次满足后把地点 ID 加入存档的 `unlockedLocations`；`enterWhen` 每次进入前重新检查。前端用后端返回的 `enterable` 展示禁用状态，API 同样复核。

NPC 的 `base.initialLocationId` 仅用于创建新游戏。当前位置以存档中的 `npcLocations[npcId]` 为准，`moveNpc` 规则效果可以改变它；地点是否对玩家解锁不限制 NPC 移动。NPC 只有在玩家当前地点才出现在可对话列表。地点的互动方式用于展示“线上／当面”，不代替 NPC 位置。

NPC 的 `indicators.json` 定义数值、布尔、枚举、标签和文本指标；`personas.json` 的通用段及当前命中段形成当下人格；`rules.json` 定义语义或自动规则及确定性效果。可选的 `player/indicators.json` 和 `player/rules.json` 用同一套机制表示玩家运行时状态。规则效果可明确指定目标玩家或 NPC；找不到运行时目标时跳过该效果，导入校验会报告静态引用错误。没有内置的顺序阶段或阶段切换。

存档保存玩家表单与指标、NPC 指标与位置、地点解锁、物品唯一归属和标签、聊天历史与摘要、事件完成记录、游戏日志等运行状态，并绑定剧本 ID、版本和内容哈希。审核通过时由系统分配版本并保留不可变发布快照；旧档按绑定的快照继续游玩，新游戏总使用最新版本，不做旧档迁移。结局和成就另存于 MySQL 的 `gallery` 表，读取旧手动档不会撤销已获得图鉴。

## AI 对话边界

模型模式、记忆压缩和早期费用试验的细节另见 [AI 运行与实验记录](ai-runtime-notes.md)。

玩家发言立即进入界面。AI 接收当前玩家状态、背包、当前 NPC 的派生人格和状态、相关聊天上下文，以及此轮可能触发的语义规则摘要；它返回角色回复和建议的规则 ID。后端重新检查规则条件，原子应用指标、道具和位置等效果，必要时要求 AI 修订回复。模型不能直接写存档或执行任意回调。最终回复和游戏日志随自动档一次提交；AI 失败不提交本轮结果，同一 `turnId` 的重试避免重复结算。

## 存档与后续扩展

MySQL 的 `save_slots` 以 `owner_id + game_id + slot` 为主键：`slot=0` 是自动档，`1..5` 是手动档。读手动档覆盖当前自动档。玩家必须登录，正式存档、试玩存档和 AI 用量均按账号隔离；在线玩家 AI 分身尚未实现。
