// Public types shared by the engine, the character format and the configuration.

/** Clip roles the engine knows how to use. Characters may also define clips with other roles. */
export type Role =
  | 'idle'
  | 'idle.variant'
  | 'walk.left'
  | 'walk.right'
  | 'judge'
  | 'judge.pointer'
  | 'held'
  | 'drop';

export const KNOWN_ROLES: readonly Role[] = [
  'idle',
  'idle.variant',
  'walk.left',
  'walk.right',
  'judge',
  'judge.pointer',
  'held',
  'drop',
];

/** The eight behaviours supported in v1. */
export type BehaviorId =
  | 'enter'
  | 'walk'
  | 'idle'
  | 'judge'
  | 'say'
  | 'drag'
  | 'react-clicks'
  | 'leave';

export const BEHAVIORS: readonly BehaviorId[] = [
  'enter',
  'walk',
  'idle',
  'judge',
  'say',
  'drag',
  'react-clicks',
  'leave',
];

// ---------------------------------------------------------------- character manifest

export interface AtlasSource {
  type: 'atlas';
  /** Image URL, resolved relative to the manifest URL. */
  url: string;
  mime?: string;
  bytes?: number;
  grid: { columns: number; rows: number; frames: number };
}

export type ClipSource = AtlasSource;

export interface ClipManifest {
  role?: string;
  loop?: boolean;
  load?: 'initial' | 'lazy';
  /** Frame size in image pixels: [width, height]. */
  size: [number, number];
  anchor?: { feet?: [number, number] };
  /** Coarse hit rectangle in frame pixels [x, y, w, h]; pixel alpha decides the final hit. */
  hit?: [number, number, number, number];
  frameMs: number[];
  durationMs?: number;
  /** The clip may be mirrored horizontally to stand in for the opposite direction. */
  mirror?: boolean;
  sources: ClipSource[];
}

export interface CreditLink {
  label: string;
  url: string;
}

export type LineEntry = string | { text: string; weight?: number };

export interface CharacterManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  licence: string | { name: string; url?: string };
  assetRevision: string;
  display?: {
    /** Rendered height of the idle clip's frame box, in CSS pixels. */
    height?: number;
    /** Smallest height used on small screens. */
    minHeight?: number;
    /** Walking speed in CSS pixels per second at `height`. */
    walkSpeed?: number;
  };
  poster?: { clip: string; frame?: number };
  bubble?: { anchor?: [number, number] };
  menu?: { credit?: CreditLink | null };
  lines?: Record<string, LineEntry[]>;
  clips: Record<string, ClipManifest>;
}

// ---------------------------------------------------------------- configuration

export type TriggerKind =
  | 'load'
  | 'idle'
  | 'hover'
  | 'click'
  | 'visible'
  | 'scroll'
  | 'exit'
  | 'gary-click'
  | 'time'
  | 'event';

export interface TriggerRule {
  on: TriggerKind;
  selector?: string;
  /** Seconds (load, idle, time). */
  after?: number;
  /** Seconds between repeats for `time`. */
  every?: number;
  /** 0..1 — scroll depth for `scroll`, intersection ratio for `visible`. */
  threshold?: number;
  /** Event name for `event`. */
  event?: string;
  /** Number of clicks for `gary-click`. */
  count?: number;
  /** Line text, or `#pool` to pick from a line pool. */
  say?: string;
  do?: BehaviorId;
  /** 0..1 probability that the rule fires when triggered. */
  chance?: number;
  /** Seconds before the rule may fire again. */
  cooldown?: number;
  once?: boolean;
  maxPerSession?: number;
}

export interface GaryConfig {
  schemaVersion?: 1;
  /** Set to false to keep the character off the page. */
  enabled?: boolean;
  /** Character manifest URL. */
  character?: string;
  behaviours?: BehaviorId[];
  /** Line pools used for ambient chatter. */
  packs?: string[];
  /** Extra or replacement line pools, merged by pool name. */
  lines?: Record<string, LineEntry[]>;
  vars?: Record<string, string>;
  triggers?: TriggerRule[];
  limits?: { minGapSeconds?: number; maxLinesPerMinute?: number };
  position?: { side?: 'left' | 'right' };
  /** Override the character's display height in CSS pixels. */
  height?: number;
  /** Let screen readers announce speech bubbles (off by default). */
  announce?: boolean;
  /** Ambient behaviour: random walks, glances and chatter. */
  ambient?: boolean;
  /** Seconds without visitor input after which the idle animation pauses to save CPU (0 = never). */
  restAfter?: number;
  menu?: { credit?: CreditLink | false };
  zIndex?: number;
}

export interface ResolvedConfig {
  enabled: boolean;
  character: string | null;
  behaviours: BehaviorId[];
  packs: string[];
  lines: Record<string, LineEntry[]>;
  vars: Record<string, string>;
  triggers: TriggerRule[];
  limits: { minGapSeconds: number; maxLinesPerMinute: number };
  position: { side: 'left' | 'right' };
  height: number | null;
  announce: boolean;
  ambient: boolean;
  restAfter: number;
  menu: { credit: CreditLink | false | null };
  zIndex: number;
}

// ---------------------------------------------------------------- API

export type GaryEvent = 'ready' | 'entered' | 'spoke' | 'dismissed' | 'error' | 'state';

export interface GaryAPI {
  /** Resolves once the character is on the page, or once it is known it won't be. Never rejects. */
  readonly ready: Promise<void>;
  init(config?: GaryConfig): Promise<void>;
  say(textOrTag: string): Promise<boolean>;
  do(behavior: string): Promise<boolean>;
  mute(): void;
  unmute(): void;
  dismiss(): void;
  reset(): void;
  emit(name: string, detail?: unknown): void;
  on(name: GaryEvent | string, handler: (detail?: unknown) => void): () => void;
  destroy(): void;
  readonly version: string;
}
