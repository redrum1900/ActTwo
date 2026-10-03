export type Owner = 'player' | `npc:${string}` | `location:${string}`;
export { compareConditionValue, pruneLegacyCondition, validCalendarDate } from './condition-value.js';

export interface ValueComparison {
  eq?: number | string | boolean;
  ne?: number | string | boolean;
  gt?: number | string;
  gte?: number | string;
  lt?: number | string;
  lte?: number | string;
  has?: string;
  lacks?: string;
  contains?: string;
  notContains?: string;
  length?: { eq?: number; gt?: number; gte?: number; lt?: number; lte?: number };
}

export type Condition =
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }
  | { not: Condition }
  | { hasItem: { owner: Owner; item: string } }
  | { stat: { npc?: string; scope?: 'player' | 'world'; id: string; gte?: number; lte?: number; eq?: number } }
  | { indicator: { npcId?: string; id: string } & ValueComparison }
  | { playerIndicator: { id: string } & ValueComparison }
  | { storyIndicator: { id: string } & ValueComparison }
  | { playerField: { id: string } & ValueComparison }
  | { npcLocation: { npcId: string; locationId: string } }
  | { flag: string }
  | { storyEvent: string }
  | { location: string }
  | { period: string }
  | { discoveredNpc: string }
  | { tag: string }
  | { npcTag: { npc: string; tag: string } }
  | { unlockedLocation: string }
  | { completedEvent: string };

export type Effect =
  | { type: 'giveItem'; to: Owner; item: string }
  | { type: 'removeItem'; from: Owner; item: string }
  | { type: 'transferItem'; from: Owner; to: Owner; item: string }
  | { type: 'changeStat'; scope: 'npc' | 'player' | 'world'; npc?: string; id: string; by: number }
  | { type: 'changeIndicator'; target?: 'story' | 'player' | `npc:${string}`; npcId?: string; id: string; by: number }
  | { type: 'setIndicator'; target?: 'story' | 'player' | `npc:${string}`; npcId?: string; id: string; value: IndicatorValue }
  | { type: 'setIndicatorVisibility'; target?: 'story' | 'player' | `npc:${string}`; npcId?: string; id: string; visible: boolean }
  | { type: 'addIndicatorTag' | 'removeIndicatorTag'; target?: 'story' | 'player' | `npc:${string}`; npcId?: string; id: string; tag: string }
  | { type: 'moveNpc'; target?: `npc:${string}`; locationId: string }
  | { type: 'setFlag'; flag: string }
  | { type: 'recordStoryEvent'; eventId: string }
  | { type: 'removeStoryEvent'; eventId: string }
  | { type: 'discoverNpc'; npc: string }
  | { type: 'revealNpcItem'; npc: string; item: string }
  | { type: 'advanceTime' }
  | { type: 'addTag'; tag: string }
  | { type: 'removeTag'; tag: string }
  | { type: 'addNpcTag' | 'removeNpcTag'; npc: string; tag: string }
  | { type: 'discoverItem'; item: string }
  | { type: 'revealPlayerItem'; npc: string; item: string }
  | { type: 'unlockLocation'; location: string }
  | { type: 'recordGallery'; kind: 'ending' | 'achievement'; id: string };

export interface FieldDefinition {
  id: string;
  label: string;
  type: 'input' | 'textarea' | 'date' | 'radio' | 'checkbox' | 'select';
  default?: string | string[];
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  editable?: boolean;
  public?: boolean;
}

export interface StatDefinition {
  id: string;
  name?: string;
  owner: 'npc' | 'player' | 'world';
  initial: number;
  min: number;
  max: number;
  visible?: boolean;
}

export type IndicatorDefinition = (
  | { id: string; name: string; type: 'number'; initial: number; min: number; max: number; playerVisible: boolean }
  | { id: string; name: string; type: 'enum'; initial: string; options: readonly string[]; playerVisible: boolean }
  | { id: string; name: string; type: 'boolean'; initial: boolean; playerVisible: boolean; writeOnceTrue?: boolean }
  | { id: string; name: string; type: 'tags'; initial: readonly string[]; playerVisible: boolean }
  | { id: string; name: string; type: 'text'; initial: string; playerVisible: boolean }
  | { id: string; name: string; type: 'date'; initial: string; playerVisible: boolean }
) & { description?: string; systemRole?: 'onceRules' };

export type IndicatorValue = number | string | boolean | string[];
export interface NpcIndicatorState { value: IndicatorValue; playerVisible: boolean }

export interface SpotDefinition {
  id: string;
  name: string;
  description: string;
  successText?: string;
  failureText?: string;
  visibleWhen?: Condition | null;
  condition?: Condition | null;
  effects: readonly Effect[];
  once?: boolean;
}

export interface LocationDefinition {
  id: string;
  name: string;
  description: string;
  interactionMode?: 'online' | 'in-person';
  visibleWhen?: Condition | null;
  enterWhen?: Condition | null;
  spots: readonly SpotDefinition[];
  items?: readonly {
    item: string;
    discoverWhen?: Condition | null;
    takeWhen?: Condition | null;
    blockedHint?: string;
  }[];
}

export interface PersonaDefinition { id: string; name: string; when?: Condition | null; content: string }

export interface NpcDefinition {
  id: string;
  name: string;
  description: string;
  initialLocationId: string;
  indicators?: readonly IndicatorDefinition[];
  personas: readonly PersonaDefinition[];
  periods?: readonly string[];
  visibleWhen?: Condition | null;
  initialItems: readonly string[];
  itemVisibility?: Record<string, Condition | null>;
  profile?: readonly { label: string; value: string; visibleWhen?: Condition | null }[];
  portrait?: string;
  accent?: string;
  rules?: readonly Omit<EventDefinition, 'npc'>[];
  lore?: readonly { id: string; name?: string; type?: 'always' | 'triggered'; keywords: readonly string[]; content: string; when?: Condition | null }[];
}

export interface EventDefinition {
  id: string;
  npc: string;
  intent: string;
  intentDescription?: string;
  hint?: string;
  keywords?: readonly string[];
  priority?: number;
  once?: boolean;
  editorGroup?: string;
  trigger: 'semantic' | 'automatic' | 'action';
  positiveExamples?: readonly string[];
  negativeExamples?: readonly string[];
  candidateWhen?: Condition | null;
  when?: Condition | null;
  exclusiveGroup?: string;
  condition?: Condition | null;
  effects: readonly Effect[];
  narration?: string;
  replyCue?: { applied?: string; blocked?: string };
}

export interface PlayerRuleDefinition extends Omit<EventDefinition, 'npc' | 'trigger'> {
  trigger: 'automatic' | 'action';
  actions?: readonly ('move' | 'wait' | 'explore' | 'search' | 'take' | 'chat')[];
}

export interface ItemDefinition {
  id: string;
  name: string;
  image?: string;
  description?: string;
  detail?: string;
  variants?: readonly { when: Condition; description?: string; detail?: string }[];
}

export interface GalleryDefinition {
  id: string;
  name: string;
  description: string;
  hidden?: boolean;
  condition: Condition;
}

export interface StoryEventDefinition {
  id: string;
  label: string;
  detail: string;
}

export interface GameScript {
  id: string;
  version: string;
  contentHash?: string;
  title: string;
  subtitle?: string;
  description?: string;
  world?: string;
  cover?: string;
  theme?: { accent?: string };
  guide?: {
    intro: string;
    steps: readonly {
      id: string;
      title: string;
      text: string;
      completeWhen: Condition;
      target: { locationId: string; spotId?: string; npcId?: string; periods?: readonly string[]; message?: string };
    }[];
  };
  startLocation: string;
  periods: readonly string[];
  playerFields: readonly FieldDefinition[];
  playerIndicators?: readonly IndicatorDefinition[];
  storyIndicators?: readonly IndicatorDefinition[];
  playerRules?: readonly PlayerRuleDefinition[];
  stats: readonly StatDefinition[];
  items: readonly ItemDefinition[];
  locations: readonly LocationDefinition[];
  npcs: readonly NpcDefinition[];
  events: readonly EventDefinition[];
  storyEvents: readonly StoryEventDefinition[];
  endings: readonly GalleryDefinition[];
  achievements: readonly GalleryDefinition[];
}

export interface ChatMessage {
  id: string;
  role: 'player' | 'npc' | 'system';
  text: string;
  at: string;
  turnId?: string;
}

export interface ActivityDetail {
  kind: 'event' | 'stat' | 'tag' | 'npc_move' | 'npc_discovered' | 'item_discovered' | 'item_gained' | 'item_removed' | 'location_unlocked' | 'gallery';
  text: string;
  entityId?: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  day: number;
  period: string;
  locationId: string;
  kind: 'chat' | 'move' | 'wait' | 'search' | 'take' | 'explore';
  summary: string;
  npcId?: string;
  chatMessageId?: string;
  details: ActivityDetail[];
}

export interface ItemRuntime {
  owner: Owner | null;
  discovered: boolean;
}

export interface MemorySegment {
  throughMessageId: string;
  summary: string;
  document?: MemoryDocument;
}

export interface MemoryFact { text: string; sourceMessageIds: string[] }
export interface MemoryDocument {
  version: number;
  facts: MemoryFact[];
  relationship: MemoryFact[];
  commitments: MemoryFact[];
  boundaries: MemoryFact[];
  openTopics: MemoryFact[];
}

export interface RuleDiagnostic {
  turnId: string;
  at: string;
  npcId: string;
  proposedIds: string[];
  acceptedIds: string[];
  rejected: { id: string; reason: 'not_candidate' | 'gate_blocked' | 'exclusive_group' | 'effect_rejected' }[];
  automaticIds: string[];
}

export interface GameState {
  scriptId: string;
  scriptVersion: string;
  scriptHash?: string;
  player: Record<string, string | string[]>;
  locationId: string;
  day: number;
  periodIndex: number;
  /** Derived compatibility projections; itemStates is authoritative. */
  playerItems: Record<string, number>;
  npcItems: Record<string, Record<string, number>>;
  itemStates: Record<string, ItemRuntime>;
  playerStats: Record<string, number>;
  worldStats: Record<string, number>;
  npcStats: Record<string, Record<string, number>>;
  npcIndicators?: Record<string, Record<string, NpcIndicatorState>>;
  playerIndicators?: Record<string, NpcIndicatorState>;
  storyIndicators?: Record<string, NpcIndicatorState>;
  npcLocations?: Record<string, string>;
  flags: string[];
  storyEventFlags: StoryEventDefinition[];
  tags?: string[];
  npcTags: Record<string, string[]>;
  knownPlayerItems: Record<string, string[]>;
  unlockedLocations: string[];
  discoveredNpcs: string[];
  knownNpcItems: Record<string, string[]>;
  completedEvents: string[];
  exploredSpots: string[];
  chats: Record<string, ChatMessage[]>;
  activityLog: ActivityEntry[];
  memories: Record<string, string>;
  memorySegments: Record<string, MemorySegment[]>;
  memoryCompression?: Record<string, { retryAfterTurn: number; lastError?: string }>;
  ruleDiagnostics?: RuleDiagnostic[];
  awardedGallery: { kind: 'ending' | 'achievement'; id: string }[];
  turns: number;
}
