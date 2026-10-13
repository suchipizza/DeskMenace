// Configuration: defaults, deterministic merging and validation.
//
// Precedence (later wins): library defaults -> inline JSON -> data-config JSON -> Gary.init(config).
// Arrays replace the previous value. Objects (lines, vars, limits, position, menu) merge by key.
// Invalid fields are reported as warnings and ignored, so one typo never takes a page down.

import type { BehaviorId, GaryConfig, LineEntry, ResolvedConfig, TriggerKind, TriggerRule } from '../types';
import { BEHAVIORS } from '../types';
import { parseCredit, parseLines } from '../characters/manifest';
import { pageBase, safeHttpUrl } from '../util/url';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const TRIGGERS: readonly TriggerKind[] = ['load', 'idle', 'hover', 'click', 'visible', 'scroll', 'exit', 'gary-click', 'time', 'event'];
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
    behaviours: [...BEHAVIORS],
    packs: ['core'],
    lines: {},
    vars: {},
    triggers: DEFAULT_TRIGGERS.map((t) => ({ ...t })),
    limits: { minGapSeconds: 20, maxLinesPerMinute: 2 },
    position: { side: 'right' },
    height: null,
    announce: false,
    ambient: true,
    restAfter: 30,
    quality: 'auto',
    menu: { credit: null },
    zIndex: 2147483000,
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
  };
  if (layer === undefined || layer === null) return { config: out, warnings };
  if (!isObj(layer)) throw new ConfigError(`${source}: configuration must be a JSON object`);
  const c = layer as GaryConfig & Record<string, unknown>;
  if (c.schemaVersion !== undefined && c.schemaVersion !== 1) throw new ConfigError(`${source}: unsupported schemaVersion ${JSON.stringify(c.schemaVersion)} (expected 1)`);

  for (const key of Object.keys(c)) {
    const v = c[key];
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
      case 'packs':
        if (Array.isArray(v) && v.every((p) => typeof p === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(p))) out.packs = [...v];
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
        if (isObj(v) && (v.side === 'left' || v.side === 'right')) out.position.side = v.side;
        else if (isObj(v) && v.side === undefined) break;
        else warn(key, 'side must be "left" or "right"');
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
  if (!rule.say && !rule.do) return 'needs "say" or "do"';
  if (r.selector !== undefined) {
    if (typeof r.selector !== 'string' || !r.selector.trim() || r.selector.length > 500 || !isValidSelector(r.selector)) return 'has an invalid selector';
    rule.selector = r.selector;
  }
  if ((on === 'hover' || on === 'click' || on === 'visible') && !rule.selector) return `"${on}" needs a selector`;
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
