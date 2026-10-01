export const sectionLabels: Record<string, { name: string; help: string }> = {
  'manifest.json': { name: '故事设定', help: '标题、简介、世界背景、初始地点和时间段。故事 ID 发布后请保持不变。' },
  'player-form.json': { name: '开局资料', help: '玩家开始游戏前填写的问题。每项有 id、label、type 和默认值。' },
  'items.json': { name: '道具', help: '定义道具名称与描述；获得和移除由规则结算。' },
  'locations.json': { name: '地点', help: '地点及玩家进入条件；NPC 当前所在地由角色快照记录。' },
  'endings.json': { name: '结局', help: '结局的 ID、名称和触发条件。' },
  'achievements.json': { name: '成就', help: '玩家可解锁的成就。' },
  'stats.json': { name: '属性定义', help: '跨角色的基础属性配置。' },
  'player/indicators.json': { name: '玩家指标', help: '玩家自身状态；visible 控制是否给玩家看。' },
  'player/rules.json': { name: '玩家规则', help: '根据玩家行为触发指标、道具和其他角色的变化。' },
};
export const npcSectionLabels: Record<string, { name: string; help: string }> = {
  'base.json': { name: '基本信息', help: '角色名称、描述、初始地点与初始道具。' },
  'indicators.json': { name: '状态指标', help: '角色的文本、数值、布尔或列表状态，包含初始值和可见性。' },
  'personas.json': { name: '性格行为', help: '通用人格和条件人格，命中条件后覆盖或组合角色的行为与语气。' },
  'rules.json': { name: '互动规则', help: '语义触发与规则效果；后端负责严格结算。' },
  'lore.json': { name: '世界书', help: '按条件提供角色知道的背景材料。' },
};
export const labelOf = (path: string) => path.startsWith('npcs/')
  ? npcSectionLabels[path.split('/').at(-1)!] ?? { name: path, help: '' }
  : sectionLabels[path] ?? { name: path, help: '' };
export const fieldLabels: Record<string, string> = {
  id: '唯一 ID', name: '名称', title: '标题', subtitle: '副标题', description: '简介 / 描述', version: '版本',
  world: '世界背景', startLocation: '开局地点 ID', periods: '时间段', cover: '封面',
  initialLocationId: '初始所在地 ID', initialItems: '初始道具', itemVisibility: '道具可见条件',
  label: '玩家看到的标题', type: '类型', default: '默认值', required: '必填', editable: '允许编辑', public: '公开',
  interactionMode: '互动方式', spots: '调查点', visibleWhen: '可见条件', enterWhen: '进入条件',
  initial: '初始值', playerVisible: '玩家可见', visible: '可见', min: '最小值', max: '最大值',
  content: '性格 / 内容', when: '生效条件', intent: '玩家意图', trigger: '触发类型', effects: '结算效果',
  priority: '优先级', once: '仅触发一次', positiveExamples: '正例', negativeExamples: '反例',
};
export function starterEntry(path: string, index: number): Record<string, unknown> {
  const id = `entry-${index + 1}`;
  if (path === 'items.json') return { id, name: '新道具', description: '' };
  if (path === 'locations.json') return { id, name: '新地点', description: '', interactionMode: 'in-person', spots: [] };
  if (path === 'player-form.json') return { id, label: '新问题', type: 'input', default: '', required: false, editable: true, public: true };
  if (path.endsWith('/personas.json')) return { id, name: '新性格', content: '' };
  if (path.endsWith('/rules.json')) return { id, intent: '', trigger: 'semantic', effects: [] };
  if (path.endsWith('/indicators.json')) return { id, name: '新指标', type: 'boolean', initial: false, playerVisible: false };
  return { id, name: '新条目', description: '' };
}
export function groupedSections(paths: string[]) {
  const root = paths.filter(path => !path.includes('/'));
  const player = paths.filter(path => path.startsWith('player/'));
  const npcIds = [...new Set(paths.flatMap(path => /^npcs\/([^/]+)\//.exec(path)?.[1] ?? []))];
  return { root, player, npcIds };
}
