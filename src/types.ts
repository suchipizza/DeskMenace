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
  /**
   * Cell size of this atlas in image pixels, when it differs from the clip `size`: a sharper
   * version of the same frames for high-density screens (1-4x the clip size, same proportions).
   */
  size?: [number, number];
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
  /** Ready-made configurations: preset name -> JSON file URL (relative to the manifest). */
  presets?: Record<string, string>;
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
  | 'event'
  | 'scrolling'
  | 'near'
  | 'drag';

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
  /** Distance in CSS px between the pointer and the character for `near` (default 80). */
  distance?: number;
  /** Line text, or `#pool` to pick from a line pool. */
  say?: string;
  do?: BehaviorId;
  /**
   * Scene to play. With several names, each firing plays the next one and the last repeats
   * (escalation).
   */
  scene?: string[];
  /** Rules with the same group share one escalation step. */
  group?: string;
  /**
   * Only while this scene plays: the line (`say`) is shown without stopping the scene. Without
   * `during`, rules wait until no scene is playing.
   */
  during?: string;
  /** 0..1 probability that the rule fires when triggered. */
  chance?: number;
  /** Seconds before the rule may fire again. */
  cooldown?: number;
  once?: boolean;
  maxPerSession?: number;
}

/** A point on the screen: fractions of the viewport width (x) and height (y, the body's middle). */
export interface ScreenPoint {
  x?: number;
  y?: number;
}

/** One step of a scene. Each step has exactly one action. */
export interface SceneStep {
  /**
   * Walks to: a CSS selector (stands on the element), "floor", or a point on the screen
   * ({ x, y } fractions; an omitted coordinate stays as it is).
   */
  walkTo?: string | ScreenPoint;
  /** Where on the element to stop (default "center"). */
  at?: 'center' | 'left' | 'right' | 'random';
  /** Appears just outside this edge of the screen, at height `y` or on the element `on`. */
  enter?: 'left' | 'right';
  /** With `enter`: the body's middle as a fraction of the viewport height (default 0.5). */
  y?: number;
  /** With `enter`: a CSS selector; walks in at the level of the first element that has room. */
  on?: string;
  /** Walks off this edge of the screen and stays away until a scene brings it back. */
  exit?: 'left' | 'right';
  /** Line text or `#pool`. */
  say?: string;
  /** Clip role to play once, e.g. "judge", "judge.pointer", "idle.variant". */
  play?: string;
  /** Seconds to stand still. */
  wait?: number;
}

/** A scene with options. */
export interface SceneDef {
  steps: SceneStep[];
  /**
   * Line (`#pool`) said when a drag interrupts the scene; the scene then carries on from the
   * step it was in.
   */
  interrupted?: string;
}

export interface GaryConfig {
  schemaVersion?: 1;
  /** Set to false to keep the character off the page. */
  enabled?: boolean;
  /** Character manifest URL. */
  character?: string;
  /** Name of a ready-made set of lines, scenes and triggers offered by the character. */
  preset?: string;
  behaviours?: BehaviorId[];
  /** Line pools used for ambient chatter. */
  packs?: string[];
  /** Pools whose lines are said in order, one per use; the last line then repeats. */
  inOrder?: string[];
  /** Extra or replacement line pools, merged by pool name. */
  lines?: Record<string, LineEntry[]>;
  vars?: Record<string, string>;
  triggers?: TriggerRule[];
  /** Named sequences of steps that triggers and `Gary.do()` can play. */
  scenes?: Record<string, SceneStep[] | SceneDef>;
  /** Scene played instead of the usual entrance; it should start with an `enter` step. */
  entrance?: string;
  /** After a drag: "floor" (falls to the bottom of the screen) or "here" (lands where dropped). */
  dropTo?: 'floor' | 'here';
  /** CSS selector of page elements the character may wander onto and stand on. */
  surfaces?: string;
  limits?: { minGapSeconds?: number; maxLinesPerMinute?: number };
  position?: {
    side?: 'left' | 'right';
    /** Height of the usual entrance: the body's middle as a fraction of the viewport height. */
    y?: number;
    /** Ambient walks stay between these fractions of the viewport width. */
    x?: [number, number];
  };
  /** Override the character's display height in CSS pixels. */
  height?: number;
  /** Let screen readers announce speech bubbles (off by default). */
  announce?: boolean;
  /** Ambient behaviour: random walks, glances and chatter. */
  ambient?: boolean;
  /** How often ambient behaviour happens: "calm", "normal" or "busy" (wanders a lot). */
  pace?: 'calm' | 'normal' | 'busy';
  /** Seconds without visitor input after which the idle animation pauses to save CPU (0 = never). */
  restAfter?: number;
  /**
   * Artwork sharpness when the character provides several image sizes: "auto" picks the size
   * that matches the screen (sharper on high-density displays), "standard" always loads the
   * smallest images, "high" always the sharpest.
   */
  quality?: 'auto' | 'standard' | 'high';
  menu?: { credit?: CreditLink | false };
  zIndex?: number;
}

export interface ResolvedConfig {
  enabled: boolean;
  character: string | null;
  preset: string | null;
  behaviours: BehaviorId[];
  packs: string[];
  inOrder: string[];
  lines: Record<string, LineEntry[]>;
  vars: Record<string, string>;
  triggers: TriggerRule[];
  scenes: Record<string, SceneDef>;
  entrance: string | null;
  dropTo: 'floor' | 'here';
  surfaces: string | null;
  limits: { minGapSeconds: number; maxLinesPerMinute: number };
  position: { side: 'left' | 'right'; y: number | null; x: [number, number] };
  height: number | null;
  announce: boolean;
  ambient: boolean;
  pace: 'calm' | 'normal' | 'busy';
  restAfter: number;
  quality: 'auto' | 'standard' | 'high';
  menu: { credit: CreditLink | false | null };
  zIndex: number;
  /** Options set by the page (top-level keys and `limits.*`), which a preset never overrides. */
  explicit: string[];
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
