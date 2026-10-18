// Line pools, weighted picking without immediate repeats, safe interpolation and rate limits.
// Lines are plain text. They are only ever inserted with textContent.

import type { LineEntry } from '../types';

interface Entry {
  text: string;
  weight: number;
}

export class LineBook {
  private readonly pools = new Map<string, Entry[]>();
  private readonly lastPick = new Map<string, string>();
  private readonly next = new Map<string, number>();
  private readonly ordered: Set<string>;

  /** `ordered`: pools said in the order written, one line per pick; the last line then repeats. */
  constructor(sources: Map<string, LineEntry[]>[], private readonly random: () => number = Math.random, ordered: string[] = []) {
    this.ordered = new Set(ordered);
    // Later sources replace whole pools of the same name.
    for (const src of sources) for (const [name, list] of src) this.pools.set(name, list.map(toEntry).filter((e) => e.weight > 0));
  }

  has(pool: string): boolean {
    return (this.pools.get(pool)?.length ?? 0) > 0;
  }

  poolNames(): string[] {
    return [...this.pools.keys()];
  }

  /**
   * Picks a weighted line from a pool, avoiding the previous pick when there is any other
   * choice. A pool with a single line always returns that line. An ordered pool returns its
   * next line instead.
   */
  pick(pool: string): string | null {
    const all = this.pools.get(pool);
    if (!all || all.length === 0) return null;
    if (this.ordered.has(pool)) {
      const i = this.next.get(pool) ?? 0;
      this.next.set(pool, i + 1);
      return all[Math.min(i, all.length - 1)].text;
    }
    const prev = this.lastPick.get(pool);
    const choices = all.length > 1 ? all.filter((e) => e.text !== prev) : all;
    const pickFrom = choices.length ? choices : all;
    const total = pickFrom.reduce((s, e) => s + e.weight, 0);
    let r = this.random() * total;
    let chosen = pickFrom[pickFrom.length - 1];
    for (const e of pickFrom) {
      r -= e.weight;
      if (r < 0) {
        chosen = e;
        break;
      }
    }
    this.lastPick.set(pool, chosen.text);
    return chosen.text;
  }

  /** Picks from the first pool that has lines. */
  pickAny(pools: string[]): string | null {
    for (const p of pools) {
      const t = this.pick(p);
      if (t) return t;
    }
    return null;
  }

  /** Resolves `#pool` references or returns the literal text. */
  resolve(textOrTag: string): string | null {
    const s = String(textOrTag ?? '');
    if (/^#[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s)) return this.pick(s.slice(1));
    return s.trim() ? s : null;
  }
}

function toEntry(e: LineEntry): Entry {
  return typeof e === 'string' ? { text: e, weight: 1 } : { text: e.text, weight: e.weight ?? 1 };
}

/** Replaces `{name}` with a variable value. Unknown variables are removed. Output is plain text. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text
    .replace(/\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g, (_, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
    .slice(0, 500);
}

/**
 * Global speech caps for automatic lines: a minimum gap and a per-minute maximum. Every line
 * shown restarts the gap; only automatic lines count towards the per-minute maximum.
 */
export class SpeechLimiter {
  private times: number[] = [];
  private last: number | undefined;

  constructor(private limits: { minGapSeconds: number; maxLinesPerMinute: number }, private readonly now: () => number = () => Date.now()) {}

  setLimits(l: { minGapSeconds: number; maxLinesPerMinute: number }): void {
    this.limits = l;
  }

  canSpeak(): boolean {
    const t = this.now();
    this.times = this.times.filter((x) => t - x < 60_000);
    if (this.last !== undefined && t - this.last < this.limits.minGapSeconds * 1000) return false;
    return this.times.length < this.limits.maxLinesPerMinute;
  }

  /** A line was shown; `counted`: an automatic line, which uses up the per-minute budget. */
  record(counted = true): void {
    this.last = this.now();
    if (counted) this.times.push(this.last);
  }
}
