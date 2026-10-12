// Page triggers. Everything is local to the page: listeners are delegated to the document,
// observers are bounded, nothing reads form values or page text, and nothing leaves the page.

import type { TriggerRule } from '../types';
import { prefs } from '../ui/storage';

export type RuleHandler = (rule: TriggerRule, target: Element | null) => boolean;

const MAX_OBSERVED = 100;
const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;

/** Eligibility bookkeeping: chance, cooldown, once and maxPerSession. */
export class RuleGate {
  private readonly lastFired = new Map<number, number>();

  constructor(private readonly ns: string, private readonly now: () => number = () => Date.now(), private readonly random: () => number = Math.random) {}

  private key(i: number): string {
    return `${this.ns}:${i}`;
  }

  eligible(rule: TriggerRule, i: number): boolean {
    const n = prefs.getCount(this.key(i));
    if (rule.once && n > 0) return false;
    if (rule.maxPerSession !== undefined && n >= rule.maxPerSession) return false;
    const last = this.lastFired.get(i);
    if (rule.cooldown && last !== undefined && this.now() - last < rule.cooldown * 1000) return false;
    if (rule.chance !== undefined && this.random() >= rule.chance) return false;
    return true;
  }

  record(i: number): void {
    this.lastFired.set(i, this.now());
    prefs.setCount(this.key(i), prefs.getCount(this.key(i)) + 1);
  }
}

export class Triggers {
  private readonly cleanups: (() => void)[] = [];
  private readonly timers = new Set<number>();
  private trackingActivity = false;
  private readonly gate: RuleGate;
  private lastActivity = Date.now();

  constructor(private readonly rules: TriggerRule[], private readonly handler: RuleHandler, ns: string) {
    this.gate = new RuleGate(ns);
  }

  start(): void {
    this.rules.forEach((rule, i) => {
      try {
        this.install(rule, i);
      } catch {
        /* a broken rule never breaks the page */
      }
    });
  }

  private fire(i: number, target: Element | null = null): void {
    const rule = this.rules[i];
    if (document.visibilityState === 'hidden') return;
    if (!this.gate.eligible(rule, i)) return;
    if (this.handler(rule, target)) this.gate.record(i);
  }

  private listen(target: EventTarget, type: string, fn: EventListener, opts: AddEventListenerOptions = { passive: true }): void {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  private timeout(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private trackActivity(): void {
    if (this.trackingActivity) return;
    this.trackingActivity = true;
    const mark = () => (this.lastActivity = Date.now());
    for (const t of ACTIVITY) this.listen(window, t, mark, { passive: true, capture: true });
  }

  private install(rule: TriggerRule, i: number): void {
    const sel = rule.selector;
    switch (rule.on) {
      case 'load':
        this.timeout(() => this.fire(i), (rule.after ?? 0) * 1000);
        break;
      case 'time': {
        const every = rule.every;
        const tick = () => {
          this.fire(i);
          if (every) this.timeout(tick, every * 1000);
        };
        this.timeout(tick, (rule.after ?? 0) * 1000);
        break;
      }
      case 'idle': {
        const after = (rule.after ?? 30) * 1000;
        let firedFor = -1;
        this.trackActivity();
        const check = () => {
          const quiet = Date.now() - this.lastActivity;
          if (quiet >= after && firedFor !== this.lastActivity) {
            firedFor = this.lastActivity;
            this.fire(i);
          }
          this.timeout(check, Math.max(1000, after - quiet));
        };
        this.timeout(check, after);
        break;
      }
      case 'hover':
        this.listen(document, 'pointerover', (e) => {
          const pe = e as PointerEvent;
          if (pe.pointerType && pe.pointerType !== 'mouse') return;
          const el = closest(pe.target, sel!);
          if (!el) return;
          const from = pe.relatedTarget;
          if (from instanceof Node && el.contains(from)) return; // moving inside the same element
          this.fire(i, el);
        });
        break;
      case 'click':
        this.listen(document, 'click', (e) => {
          const el = closest(e.target, sel!);
          if (el) this.fire(i, el);
        });
        break;
      case 'visible': {
        if (typeof IntersectionObserver === 'undefined') break;
        const threshold = rule.threshold ?? 0.5;
        const io = new IntersectionObserver(
          (entries) => {
            for (const en of entries) if (en.isIntersecting && en.intersectionRatio >= threshold - 0.001) this.fire(i, en.target);
          },
          { threshold },
        );
        document.querySelectorAll(sel!).forEach((el, n) => n < MAX_OBSERVED && io.observe(el));
        this.cleanups.push(() => io.disconnect());
        break;
      }
      case 'scroll': {
        const threshold = rule.threshold ?? 0.5;
        let raf = 0;
        let below = true;
        const check = () => {
          raf = 0;
          const se = document.scrollingElement ?? document.documentElement;
          const max = se.scrollHeight - window.innerHeight;
          const depth = max <= 0 ? 1 : window.scrollY / max;
          if (depth >= threshold && below) {
            below = false;
            this.fire(i);
          } else if (depth < threshold) below = true;
        };
        this.listen(window, 'scroll', () => {
          if (!raf) raf = requestAnimationFrame(check);
        });
        this.cleanups.push(() => raf && cancelAnimationFrame(raf));
        break;
      }
      case 'exit':
        this.listen(document, 'mouseout', (e) => {
          const me = e as MouseEvent;
          if (!me.relatedTarget && me.clientY <= 0) this.fire(i);
        });
        break;
      case 'gary-click':
      case 'event':
        break; // driven by garyClicked() and emit()
    }
  }

  /** Called by the engine when the character is clicked; `sequence` counts rapid clicks. */
  garyClicked(sequence: number): void {
    this.rules.forEach((r, i) => {
      if (r.on === 'gary-click' && (r.count ?? 1) === sequence) this.fire(i);
    });
  }

  emit(name: string): void {
    this.rules.forEach((r, i) => {
      if (r.on === 'event' && r.event === name) this.fire(i);
    });
  }

  stop(): void {
    for (const c of this.cleanups.splice(0)) c();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.trackingActivity = false;
  }
}

function closest(t: EventTarget | null, selector: string): Element | null {
  if (!(t instanceof Element)) return null;
  try {
    return t.closest(selector);
  } catch {
    return null;
  }
}
