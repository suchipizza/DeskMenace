// Configuration: defaults, deterministic merging and validation.
//
// Precedence (later wins): library defaults -> inline JSON -> data-config JSON -> Gary.init(config).
// Arrays replace the previous value. Objects (lines, vars, limits, position, menu) merge by key.
// Invalid fields are reported as warnings and ignored, so one typo never takes a page down.

import type { BehaviorId, GaryConfig, LineEntry, ResolvedConfig, SceneDef, SceneStep, TriggerKind, TriggerRule } from '../types';
import { BEHAVIORS } from '../types';
import { parseCredit, parseLines } from '../characters/manifest';
import { pageBase, safeHttpUrl } from '../util/url';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const TRIGGERS: readonly TriggerKind[] = ['load', 'idle', 'hover', 'click', 'visible', 'scroll', 'exit', 'gary-click', 'time', 'event', 'scrolling', 'near', 'drag'];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MAX_SCENES = 50;
const MAX_STEPS = 20;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export const DEFAULT_TRIGGERS: TriggerRule[] = [
  { on: 'load', after: 1.5, say: '#hello', once: true },
  { on: 'idle', after: 40, say: '#idle', cooldown: 90 },
  { on: 'exit', say: '#exit', maxPerSession: 1 },
];

export function defaults(): ResolvedConfig {
  return {
    enabled: true,
    character: null,
    preset: null,
    behaviours: [...BEHAVIORS],
    packs: ['core'],
    inOrder: [],
    lines: {},
    vars: {},
    triggers: DEFAULT_TRIGGERS.map((t) => ({ ...t })),
    scenes: {},
    entrance: null,
    dropTo: 'floor',
    surfaces: null,
    limits: { minGapSeconds: 20, maxLinesPerMinute: 2 },
    position: { side: 'right', y: null, x: [0, 1] },
    height: null,
    announce: false,
    ambient: true,
    pace: 'normal',
    restAfter: 30,
    quality: 'auto',
    menu: { credit: null },
    zIndex: 2147483000,
    explicit: [],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Merges one partial config layer into a resolved config. Returns warnings for ignored fields. */
export function mergeConfig(base: ResolvedConfig, layer: unknown, source: string): { config: ResolvedConfig; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (field: string, msg: string) => warnings.push(`${source}: "${field}" ${msg}; ignored`);
  const out: ResolvedConfig = {
    ...base,
    lines: { ...base.lines },
    vars: { ...base.vars },
    limits: { ...base.limits },
    position: { ...base.position },
    menu: { ...base.menu },
    scenes: { ...base.scenes },
    explicit: [...base.explicit],
  };
  const mark = (k: string) => {
    if (!out.explicit.includes(k)) out.explicit.push(k);
  };
  if (layer === undefined || layer === null) return { config: out, warnings };
  if (!isObj(layer)) throw new ConfigError(`${source}: configuration must be a JSON object`);
  const c = layer as GaryConfig & Record<string, unknown>;
  if (c.schemaVersion !== undefined && c.schemaVersion !== 1) throw new ConfigError(`${source}: unsupported schemaVersion ${JSON.stringify(c.schemaVersion)} (expected 1)`);

  for (const key of Object.keys(c)) {
    const v = c[key];
    if (key === 'limits' && isObj(v)) for (const k of Object.keys(v)) mark(`limits.${k}`);
    else mark(key === 'behaviors' ? 'behaviours' : key);
    switch (key) {
      case 'schemaVersion':
        break;
      case 'enabled':
      case 'announce':
      case 'ambient':
        if (typeof v === 'boolean') out[key] = v;
        else warn(key, 'must be true or false');
        break;
      case 'character': {
        const url = safeHttpUrl(v, pageBase());
        if (url) out.character = url;
        else warn(key, 'must be a manifest URL');
        break;
      }
      case 'behaviours':
      case 'behaviors': {
        if (!Array.isArray(v)) { warn(key, 'must be an array'); break; }
        const list: BehaviorId[] = [];
        for (const b of v) {
          if ((BEHAVIORS as readonly unknown[]).includes(b)) list.push(b as BehaviorId);
          else warnings.push(`${source}: behaviour ${JSON.stringify(b)} is not supported; ignored`);
        }
        out.behaviours = list;
        break;
      }
      case 'preset':
        if (v === null || (typeof v === 'string' && NAME_RE.test(v))) out.preset = v as string | null;
        else warn(key, 'must be a preset name');
        break;
      case 'scenes': {
        if (!isObj(v)) { warn(key, 'must be an object of scenes'); break; }
        const names = Object.keys(v);
        for (const name of names.slice(0, MAX_SCENES)) {
          const res = NAME_RE.test(name) && !RESERVED.has(name) ? validateScene(v[name]) : 'has an invalid name';
          if (typeof res === 'string') warnings.push(`${source}: scene "${name}" ${res}; ignored`);
          else out.scenes[name] = res;
        }
        if (names.length > MAX_SCENES) warnings.push(`${source}: only the first ${MAX_SCENES} scenes are used`);
        break;
      }
      case 'entrance':
        if (v === null || (typeof v === 'string' && NAME_RE.test(v))) out.entrance = v as string | null;
        else warn(key, 'must be a scene name');
        break;
      case 'dropTo':
        if (v === 'floor' || v === 'here') out.dropTo = v;
        else warn(key, 'must be "floor" or "here"');
        break;
      case 'surfaces':
        if (v === null || (typeof v === 'string' && v.trim() && v.length <= 500 && isValidSelector(v))) out.surfaces = v as string | null;
        else warn(key, 'must be a CSS selector');
        break;
      case 'packs':
        if (Array.isArray(v) && v.every((p) => typeof p === 'string' && NAME_RE.test(p))) out.packs = [...v];
        else warn(key, 'must be an array of pool names');
        break;
      case 'inOrder':
        if (Array.isArray(v) && v.every((p) => typeof p === 'string' && NAME_RE.test(p))) out.inOrder = [...v];
        else warn(key, 'must be an array of pool names');
        break;
      case 'lines': {
        const lw: string[] = [];
        const pools = parseLines(v, 'lines', (p, m) => lw.push(`${source}: "${p}" ${m}; ignored`));
        warnings.push(...lw);
        for (const [name, list] of pools) out.lines[name] = list as LineEntry[];
        break;
      }
      case 'vars':
        if (!isObj(v)) { warn(key, 'must be an object'); break; }
        for (const k of Object.keys(v)) {
          if (RESERVED.has(k) || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) warnings.push(`${source}: variable "${k}" has an invalid name; ignored`);
          else if (typeof v[k] === 'string' || isNum(v[k])) out.vars[k] = String(v[k]).slice(0, 100);
          else warnings.push(`${source}: variable "${k}" must be a string; ignored`);
        }
        break;
      case 'triggers': {
        if (!Array.isArray(v)) { warn(key, 'must be an array'); break; }
        out.triggers = v.flatMap((r, i) => {
          const res = validateRule(r);
          if (typeof res === 'string') {
            warnings.push(`${source}: triggers[${i}] ${res}; ignored`);
            return [];
          }
          return [res];
        });
        break;
      }
      case 'limits':
        if (!isObj(v)) { warn(key, 'must be an object'); break; }
        if (v.minGapSeconds !== undefined) {
          if (isNum(v.minGapSeconds) && v.minGapSeconds >= 0 && v.minGapSeconds <= 3600) out.limits.minGapSeconds = v.minGapSeconds;
          else warn('limits.minGapSeconds', 'must be 0-3600');
        }
        if (v.maxLinesPerMinute !== undefined) {
          if (isNum(v.maxLinesPerMinute) && v.maxLinesPerMinute >= 0 && v.maxLinesPerMinute <= 30) out.limits.maxLinesPerMinute = v.maxLinesPerMinute;
          else warn('limits.maxLinesPerMinute', 'must be 0-30');
        }
        break;
      case 'position':
        if (!isObj(v)) { warn(key, 'must be an object'); break; }
        if (v.side !== undefined) {
          if (v.side === 'left' || v.side === 'right') out.position.side = v.side;
          else warn('position.side', 'must be "left" or "right"');
        }
        if (v.y !== undefined) {
          if (v.y === null || (isNum(v.y) && v.y >= 0 && v.y <= 1)) out.position.y = v.y as number | null;
          else warn('position.y', 'must be a fraction of the screen height (0-1)');
        }
        if (v.x !== undefined) {
          if (Array.isArray(v.x) && v.x.length === 2 && v.x.every((n) => isNum(n) && n >= 0 && n <= 1) && v.x[0] < v.x[1]) out.position.x = [v.x[0], v.x[1]];
          else warn('position.x', 'must be [from, to] fractions of the screen width (0-1)');
        }
        break;
      case 'height':
        if (v === null || (isNum(v) && v >= 40 && v <= 1000)) out.height = v as number | null;
        else warn(key, 'must be a number of CSS pixels (40-1000)');
        break;
      case 'menu':
        if (!isObj(v)) { warn(key, 'must be an object'); break; }
        if (v.credit === false) out.menu.credit = false;
        else if (v.credit !== undefined) {
          const cr = parseCredit(v.credit, pageBase());
          if (cr) out.menu.credit = cr;
          else warn('menu.credit', 'must be { label, url } with an http(s) URL, or false');
        }
        break;
      case 'restAfter':
        if (isNum(v) && v >= 0 && v <= 86400) out.restAfter = v;
        else warn(key, 'must be a number of seconds (0 disables resting)');
        break;
      case 'pace':
        if (v === 'calm' || v === 'normal' || v === 'busy') out.pace = v;
        else warn(key, 'must be "calm", "normal" or "busy"');
        break;
      case 'quality':
        if (v === 'auto' || v === 'standard' || v === 'high') out.quality = v;
        else warn(key, 'must be "auto", "standard" or "high"');
        break;
      case 'zIndex':
        if (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2147483647) out.zIndex = v as number;
        else warn(key, 'must be a whole number');
        break;
      default:
        warnings.push(`${source}: unknown option "${key}"; ignored`);
    }
  }
  return { config: out, warnings };
}

/** Validates one trigger rule. Returns the clean rule or a reason string. */
export function validateRule(r: unknown): TriggerRule | string {
  if (!isObj(r)) return 'must be an object';
  const on = r.on as TriggerKind;
  if (!TRIGGERS.includes(on)) return `has unknown trigger ${JSON.stringify(r.on)}`;
  const rule: TriggerRule = { on };
  if (r.say !== undefined) {
    if (typeof r.say !== 'string' || !r.say.trim() || r.say.length > 500) return 'say must be a line or #pool';
    rule.say = r.say;
  }
  if (r.do !== undefined) {
    if (!(BEHAVIORS as readonly unknown[]).includes(r.do)) return `do ${JSON.stringify(r.do)} is not a supported behaviour`;
    rule.do = r.do as BehaviorId;
  }
  if (r.scene !== undefined) {
    const list = typeof r.scene === 'string' ? [r.scene] : r.scene;
    if (!Array.isArray(list) || !list.length || list.length > 20 || !list.every((n) => typeof n === 'string' && NAME_RE.test(n))) return 'scene must be a scene name or a list of them';
    rule.scene = [...list];
  }
  if (!rule.say && !rule.do && !rule.scene) return 'needs "say", "do" or "scene"';
  if (r.group !== undefined) {
    if (typeof r.group !== 'string' || !NAME_RE.test(r.group)) return 'group must be a name';
    rule.group = r.group;
  }
  if (r.during !== undefined) {
    if (typeof r.during !== 'string' || !NAME_RE.test(r.during)) return 'during must be a scene name';
    if (!rule.say || rule.do || rule.scene) return '"during" rules can only "say"';
    rule.during = r.during;
  }
  if (r.selector !== undefined) {
    if (typeof r.selector !== 'string' || !r.selector.trim() || r.selector.length > 500 || !isValidSelector(r.selector)) return 'has an invalid selector';
    rule.selector = r.selector;
  }
  if ((on === 'hover' || on === 'visible') && !rule.selector) return `"${on}" needs a selector`;
  if (r.event !== undefined) {
    if (typeof r.event !== 'string' || !r.event || r.event.length > 100) return 'event must be a name';
    rule.event = r.event;
  }
  if (on === 'event' && !rule.event) return '"event" needs an event name';
  const nums: [keyof TriggerRule, number, number][] = [
    ['after', 0, 86400],
    ['every', 1, 86400],
    ['threshold', 0, 1],
    ['count', 1, 100],
    ['distance', 0, 2000],
    ['chance', 0, 1],
    ['cooldown', 0, 86400],
    ['maxPerSession', 0, 10000],
  ];
  for (const [k, lo, hi] of nums) {
    const v = r[k];
    if (v === undefined) continue;
    if (!isNum(v) || v < lo || v > hi) return `${k} must be a number from ${lo} to ${hi}`;
    (rule as unknown as Record<string, number>)[k] = v;
  }
  if (r.once !== undefined) {
    if (typeof r.once !== 'boolean') return 'once must be true or false';
    rule.once = r.once;
  }
  return rule;
}

/** Validates one scene: a list of steps, or { steps, interrupted }. */
export function validateScene(v: unknown): SceneDef | string {
  if (isObj(v)) {
    for (const k of Object.keys(v)) if (k !== 'steps' && k !== 'interrupted') return `has an unknown field "${k}"`;
    const steps = validateSteps(v.steps);
    if (typeof steps === 'string') return steps;
    const def: SceneDef = { steps };
    if (v.interrupted !== undefined) {
      if (typeof v.interrupted !== 'string' || !v.interrupted.trim() || v.interrupted.length > 500) return 'interrupted must be a line or #pool';
      def.interrupted = v.interrupted;
    }
    return def;
  }
  const steps = validateSteps(v);
  return typeof steps === 'string' ? steps : { steps };
}

const frac = (n: unknown) => isNum(n) && n >= 0 && n <= 1;

function validateSteps(v: unknown): SceneStep[] | string {
  if (!Array.isArray(v) || !v.length || v.length > MAX_STEPS) return `must be a list of 1 to ${MAX_STEPS} steps`;
  const steps: SceneStep[] = [];
  for (const [i, s] of v.entries()) {
    if (!isObj(s)) return `step ${i + 1} must be an object`;
    const actions = ['walkTo', 'say', 'play', 'wait', 'enter', 'exit'].filter((k) => s[k] !== undefined);
    if (actions.length !== 1) return `step ${i + 1} needs exactly one of walkTo, say, play, wait, enter or exit`;
    const step: SceneStep = {};
    if (s.enter !== undefined || s.exit !== undefined) {
      const side = s.enter ?? s.exit;
      if (side !== 'left' && side !== 'right') return `step ${i + 1}: ${s.enter !== undefined ? 'enter' : 'exit'} must be "left" or "right"`;
      if (s.exit !== undefined) step.exit = side;
      else {
        step.enter = side;
        if (s.y !== undefined) {
          if (!frac(s.y)) return `step ${i + 1}: y must be a fraction of the screen height (0-1)`;
          step.y = s.y as number;
        }
        if (s.on !== undefined) {
          if (typeof s.on !== 'string' || !s.on.trim() || s.on.length > 500 || !isValidSelector(s.on)) return `step ${i + 1}: on must be a CSS selector`;
          step.on = s.on;
        }
      }
    } else if (isObj(s.walkTo)) {
      const p = s.walkTo;
      if (Object.keys(p).some((k) => k !== 'x' && k !== 'y') || (p.x === undefined && p.y === undefined) || (p.x !== undefined && !frac(p.x)) || (p.y !== undefined && !frac(p.y))) return `step ${i + 1}: walkTo { x, y } takes fractions of the screen (0-1)`;
      step.walkTo = { ...(p.x !== undefined ? { x: p.x as number } : {}), ...(p.y !== undefined ? { y: p.y as number } : {}) };
    } else if (s.walkTo !== undefined) {
      if (typeof s.walkTo !== 'string' || !s.walkTo.trim() || s.walkTo.length > 500 || (s.walkTo !== 'floor' && !isValidSelector(s.walkTo))) return `step ${i + 1}: walkTo must be a CSS selector, "floor" or { x, y }`;
      step.walkTo = s.walkTo;
      if (s.at !== undefined) {
        if (!['center', 'left', 'right', 'random'].includes(s.at as string)) return `step ${i + 1}: at must be "center", "left", "right" or "random"`;
        step.at = s.at as SceneStep['at'];
      }
    } else if (s.say !== undefined) {
      if (typeof s.say !== 'string' || !s.say.trim() || s.say.length > 500) return `step ${i + 1}: say must be a line or #pool`;
      step.say = s.say;
    } else if (s.play !== undefined) {
      if (typeof s.play !== 'string' || !/^[a-z][a-z0-9.-]{0,40}$/.test(s.play)) return `step ${i + 1}: play must be a clip role`;
      step.play = s.play;
    } else {
      if (!isNum(s.wait) || s.wait < 0 || s.wait > 60) return `step ${i + 1}: wait must be 0 to 60 seconds`;
      step.wait = s.wait;
    }
    steps.push(step);
  }
  return steps;
}

/** Keys a preset may set. Where the page sets the same option, the page wins. */
const PRESET_KEYS = new Set(['behaviours', 'behaviors', 'packs', 'inOrder', 'lines', 'vars', 'triggers', 'scenes', 'entrance', 'dropTo', 'surfaces', 'limits', 'ambient', 'pace', 'restAfter', 'position']);

/**
 * Layers a character preset under the page's own configuration: options the page set itself
 * (see `explicit`) keep the page's value; line pools, variables and scenes merge by name with
 * the page's entries winning.
 */
export function applyPreset(config: ResolvedConfig, preset: unknown, source: string): { config: ResolvedConfig; warnings: string[] } {
  if (!isObj(preset)) throw new ConfigError(`${source}: must be a JSON object`);
  const layer: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const k of Object.keys(preset)) {
    if (k === 'schemaVersion') layer[k] = preset[k];
    else if (PRESET_KEYS.has(k)) layer[k] = preset[k];
    else warnings.push(`${source}: "${k}" can't be set by a preset; ignored`);
  }
  const r = mergeConfig(defaults(), layer, source);
  const p = r.config;
  const ex = new Set(config.explicit);
  const out: ResolvedConfig = { ...config };
  for (const k of ['behaviours', 'packs', 'inOrder', 'triggers', 'entrance', 'dropTo', 'surfaces', 'ambient', 'pace', 'restAfter', 'position'] as const) {
    if (!ex.has(k)) (out as unknown as Record<string, unknown>)[k] = p[k];
  }
  out.lines = { ...p.lines, ...config.lines };
  out.vars = { ...p.vars, ...config.vars };
  out.scenes = { ...p.scenes, ...config.scenes };
  out.limits = {
    minGapSeconds: ex.has('limits.minGapSeconds') ? config.limits.minGapSeconds : p.limits.minGapSeconds,
    maxLinesPerMinute: ex.has('limits.maxLinesPerMinute') ? config.limits.maxLinesPerMinute : p.limits.maxLinesPerMinute,
  };
  return { config: out, warnings: [...warnings, ...r.warnings] };
}

function isValidSelector(s: string): boolean {
  if (typeof document === 'undefined') return true;
  try {
    document.createDocumentFragment().querySelector(s);
    return true;
  } catch {
    return false;
  }
}

/** Parses a JSON string config; errors become a ConfigError with the source name. */
export function parseJsonConfig(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${source}: invalid JSON (${(e as Error).message})`);
  }
}
