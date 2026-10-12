// One character instance on one page: loads the manifest, owns the overlay, player, UI and
// triggers, and runs the behaviour state machine.
//
// Behaviours run one at a time as "activities" with a priority:
//   dismiss (5) > drag (4) > drop (3) > API call (2) > page trigger (1) > ambient (0)
// A request with a lower priority than the running activity is refused (returns false); an
// equal or higher one interrupts it. Interrupted activities stop at their next await point,
// and every clip promise they were waiting on settles.

import type { BehaviorId, CreditLink, ResolvedConfig, TriggerRule } from '../types';
import { BEHAVIORS } from '../types';
import { parseCharacter, type Character } from '../characters/manifest';
import { ClipLoadError, ClipPlayer, type PlayResult } from '../render/clip-player';
import { Overlay } from '../render/overlay';
import { Bubble, focusedFieldRect } from '../ui/bubble';
import { Menu } from '../ui/menu';
import { Input } from '../ui/input';
import { prefs } from '../ui/storage';
import { interpolate, LineBook, SpeechLimiter } from '../content/lines';
import { Triggers } from '../triggers/triggers';
import type { Emitter } from '../util/events';
import { afterFirstPaint } from '../boot/start';

export type State =
  | 'loading'
  | 'entering'
  | 'idle'
  | 'walking'
  | 'judging'
  | 'speaking'
  | 'dragging'
  | 'falling'
  | 'leaving'
  | 'dismissed'
  | 'destroyed'
  | 'failed';

export const PRIORITY = { ambient: 0, dom: 1, api: 2, drop: 3, drag: 4, dismiss: 5 } as const;
type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

interface Token {
  cancelled: boolean;
}

interface Activity {
  prio: Priority;
  token: Token;
}

export const DEFAULT_CREDIT: CreditLink = { label: 'Powered by gary.js', url: 'https://github.com/suchipizza/DeskMenace' };

const UNSUPPORTED = new Set(['phone', 'card', 'steal-cursor']);
const CLICK_SEQUENCE_MS = 1500;
const REACT_CLICKS_AT = 3;

export class Engine {
  state: State = 'loading';
  character: Character | null = null;
  private overlay: Overlay | null = null;
  private player: ClipPlayer | null = null;
  private bubble: Bubble | null = null;
  private menu: Menu | null = null;
  private input: Input | null = null;
  private triggers: Triggers | null = null;
  private book: LineBook = new LineBook([]);
  private readonly limiter: SpeechLimiter;
  private activity: Activity | null = null;
  private ambientTimer = 0;
  private lastVariant = 0;
  private clicks: number[] = [];
  private grab = { dx: 0, dy: 0 };
  private reduced = false;
  private readonly offs: (() => void)[] = [];
  private readonly abort = new AbortController();

  constructor(private config: ResolvedConfig, private readonly events: Emitter) {
    this.limiter = new SpeechLimiter(config.limits);
  }

  private setState(s: State): void {
    if (this.state === s) return;
    this.state = s;
    this.events.emit('state', s);
  }

  get alive(): boolean {
    return this.state !== 'destroyed' && this.state !== 'dismissed' && this.state !== 'failed';
  }

  enabled(b: BehaviorId): boolean {
    return this.config.behaviours.includes(b);
  }

  // ------------------------------------------------------------------ lifecycle

  /** Loads and shows the character. Never rejects; failures emit `error`. */
  async start(): Promise<void> {
    try {
      await afterFirstPaint(this.abort.signal);
      if (!this.alive) return;
      const url = this.config.character;
      if (!url) throw new Error('No character manifest configured. Set "character" to a manifest URL.');
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: this.abort.signal });
      if (!res.ok) throw new Error(`Could not load character manifest (HTTP ${res.status}) from ${url}`);
      const json = await res.json().catch(() => {
        throw new Error(`Character manifest at ${url} is not valid JSON`);
      });
      const ch = parseCharacter(json, res.url || url);
      if (!this.alive) return;
      this.character = ch;
      for (const w of ch.warnings) console.warn(`[gary.js] ${w}`);
      this.mount(ch);
      await this.player!.load(ch.roles.get('idle')!);
      if (!this.alive) return;
      // The first walk is needed right away; other initial clips load in the background.
      const enterDir = this.config.position.side === 'right' ? ch.walk.left : ch.walk.right;
      if (enterDir && !this.reduced && this.enabled('enter')) await this.player!.load(enterDir.clip).catch(() => {});
      for (const c of ch.clips.values()) if (c.load === 'initial') this.player!.prefetch(c.id);
      if (!this.alive) return;
      await this.enter();
    } catch (e) {
      if (!this.alive || this.abort.signal.aborted) return;
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn(`[gary.js] ${err.message}`);
    this.events.emit('error', err);
    this.teardown();
    this.setState('failed');
  }

  private mount(ch: Character): void {
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const overlay = (this.overlay = new Overlay(ch, { zIndex: this.config.zIndex, label: `${ch.name} options` }));
    overlay.layout(this.config.height);
    this.player = new ClipPlayer(overlay.canvas, ch.clips, {
      pinned: [ch.roles.get('idle')!],
      onClipChange: (clip, mirrored) => overlay.applyClip(clip, mirrored),
    });
    this.bubble = new Bubble(overlay, ch.bubbleAnchor, this.config.announce);
    this.menu = new Menu(overlay, ch.name, this.creditFor(ch), {
      isMuted: () => prefs.isMuted(),
      toggleMute: () => (prefs.isMuted() ? this.unmute() : this.mute()),
      remove: () => this.events.emit('_remove'),
    });
    this.input = new Input(overlay, this.player, {
      interactive: () => this.alive && this.state !== 'leaving' && this.state !== 'loading',
      canDrag: () => this.enabled('drag') && !this.reduced,
      dragStart: (x, y) => this.dragStart(x, y),
      dragMove: (x, y) => this.dragMove(x, y),
      dragEnd: () => void this.dragEnd(false),
      dragCancel: () => void this.dragEnd(true),
      click: () => this.characterClicked(),
      openMenu: (x, y, kb) => this.menu?.show(kb, { x, y }),
      menuOpen: () => !!this.menu?.isOpen,
    });
    this.applyContent();

    const on = (t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.offs.push(() => t.removeEventListener(type, fn, opts));
    };
    let resizeRaf = 0;
    on(window, 'resize', () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        this.onResize();
      });
    }, { passive: true });
    this.offs.push(() => cancelAnimationFrame(resizeRaf));
    on(document, 'visibilitychange', () => this.onVisibility(), { passive: true });
    on(document, 'focusin', (e) => this.onFocusIn(e as FocusEvent), { passive: true });
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      this.reduced = mq.matches;
      if (this.reduced && this.alive) void this.run(PRIORITY.api, 'idle', async () => {});
    };
    mq.addEventListener?.('change', onMotion);
    this.offs.push(() => mq.removeEventListener?.('change', onMotion));
  }

  private creditFor(ch: Character): CreditLink | null {
    const c = this.config.menu.credit;
    if (c === false) return null;
    if (c) return c;
    if (ch.credit === null) return null;
    return ch.credit ?? DEFAULT_CREDIT;
  }

  /** Rebuilds lines, limits and triggers from the current config (used by a repeated init). */
  applyContent(config?: ResolvedConfig): void {
    if (config) this.config = config;
    const ch = this.character;
    if (!ch) return;
    this.book = new LineBook([ch.lines, new Map(Object.entries(this.config.lines))]);
    this.limiter.setLimits(this.config.limits);
    this.menu?.setCredit(this.creditFor(ch));
    this.triggers?.stop();
    this.triggers = new Triggers(this.config.triggers, (rule, target) => this.onRule(rule, target), ch.id);
    if (this.state !== 'loading' && this.state !== 'entering') this.triggers.start();
    this.scheduleAmbient();
  }

  /** Removes everything this instance added to the page. Visitor preferences are kept. */
  destroy(): void {
    if (this.state === 'destroyed') return;
    this.teardown();
    this.setState('destroyed');
  }

  private teardown(): void {
    this.abort.abort();
    if (this.activity) this.activity.token.cancelled = true;
    this.activity = null;
    window.clearTimeout(this.ambientTimer);
    this.triggers?.stop();
    this.input?.dispose();
    this.menu?.dispose();
    this.bubble?.dispose();
    this.player?.dispose();
    this.overlay?.dispose();
    for (const off of this.offs.splice(0)) off();
    this.triggers = null;
    this.input = null;
    this.menu = null;
    this.bubble = null;
    this.player = null;
    this.overlay = null;
  }

  // ------------------------------------------------------------------ activities

  /**
   * Runs `fn` as the current activity if `prio` allows it. When it finishes without being
   * interrupted, the character returns to idle. Resolves to whether the activity ran.
   */
  private async run(prio: Priority, state: State, fn: (t: Token) => Promise<void | boolean>): Promise<boolean> {
    if (!this.alive || !this.overlay) return false;
    if (this.activity && this.activity.prio > prio) return false;
    if (this.activity) this.activity.token.cancelled = true;
    this.overlay.stopMove();
    window.clearTimeout(this.ambientTimer);
    const token: Token = { cancelled: false };
    const act: Activity = { prio, token };
    this.activity = act;
    this.setState(state);
    let ok: boolean | void = true;
    try {
      ok = await fn(token);
    } catch (e) {
      ok = false;
      if (!(e instanceof ClipLoadError) || this.alive) this.events.emit('error', e);
    }
    if (this.activity === act) {
      this.activity = null;
      if (this.alive) this.idle();
    }
    return ok !== false && !token.cancelled;
  }

  /** Plays a clip by role. Resolves 'stopped' when the role is missing or fails to load. */
  private async playRole(role: string, opts: { loop?: boolean } = {}): Promise<PlayResult> {
    const id = this.character?.roles.get(role);
    if (!id || !this.player) return 'stopped';
    try {
      return await this.player.play(id, opts);
    } catch (e) {
      console.warn(`[gary.js] ${(e as Error).message}`);
      return 'stopped';
    }
  }

  private has(role: string): boolean {
    return !!this.character?.roles.has(role);
  }

  /** Base state: idle loop (or still poster with reduced motion), ambient scheduler armed. */
  private idle(): void {
    if (!this.player || !this.character) return;
    this.setState('idle');
    if (document.visibilityState === 'hidden') {
      this.scheduleAmbient();
      return;
    }
    if (this.reduced) void this.player.showFrame(this.character.poster.clip, this.character.poster.frame);
    else void this.playRole('idle', { loop: true });
    this.scheduleAmbient();
  }

  private async enter(): Promise<void> {
    const ov = this.overlay!;
    const side = this.config.position.side;
    const [lo, hi] = ov.range();
    const inset = Math.min(48, Math.max(0, (hi - lo) / 4));
    const target = side === 'right' ? hi - inset : lo + inset;
    const dir = side === 'right' ? 'left' : 'right';
    const walk = this.character!.walk[dir];
    this.setState('entering');
    if (this.reduced || !this.enabled('enter') || !walk) {
      ov.feetX = target;
      ov.place();
      if (this.reduced) await this.player!.showFrame(this.character!.poster.clip, this.character!.poster.frame);
      else void this.playRole('idle', { loop: true });
      ov.show();
      this.entered();
      return;
    }
    await this.run(PRIORITY.api, 'entering', async (t) => {
      ov.feetX = ov.offscreenX(side);
      ov.place();
      const playing = this.player!.play(walk.clip, { loop: true, mirrored: walk.mirrored });
      ov.show();
      void playing;
      if (t.cancelled) return;
      await ov.moveTo(target, this.speed());
    });
    ov.show();
    this.entered();
  }

  private entered(): void {
    if (!this.alive) return;
    if (this.state === 'entering') this.idle();
    this.triggers?.start();
    this.events.emit('entered');
  }

  private speed(): number {
    const ch = this.character!;
    return ch.walkSpeed * ((this.overlay!.scale * ch.clips.get(ch.roles.get('idle')!)!.h) / ch.height);
  }

  /** Walks to a random spot (or `x`). */
  private walk(prio: Priority, x?: number): Promise<boolean> {
    const ch = this.character;
    const ov = this.overlay;
    if (!ch || !ov || this.reduced || (!ch.walk.left && !ch.walk.right)) return Promise.resolve(false);
    const [lo, hi] = ov.range();
    if (hi - lo < 40) return Promise.resolve(false);
    let target = x;
    if (target === undefined) {
      const span = Math.min(hi - lo, Math.max(120, ov.viewportW * 0.45));
      const dist = 80 + Math.random() * Math.max(0, span - 80);
      const canLeft = !!ch.walk.left && ov.feetX - dist >= lo;
      const canRight = !!ch.walk.right && ov.feetX + dist <= hi;
      if (!canLeft && !canRight) target = ch.walk.left ? lo : hi;
      else target = canLeft && (!canRight || Math.random() < 0.5) ? ov.feetX - dist : ov.feetX + dist;
    }
    target = Math.min(hi, Math.max(lo, target));
    const dir = target < ov.feetX ? 'left' : 'right';
    const walk = ch.walk[dir];
    if (!walk || Math.abs(target - ov.feetX) < 4) return Promise.resolve(false);
    return this.run(prio, 'walking', async (t) => {
      void this.player!.play(walk.clip, { loop: true, mirrored: walk.mirrored }).catch(() => {});
      if (t.cancelled) return;
      await ov.moveTo(target!, this.speed());
    });
  }

  private judge(prio: Priority, pointer = Math.random() < 0.4): Promise<boolean> {
    const role = pointer && this.has('judge.pointer') ? 'judge.pointer' : this.has('judge') ? 'judge' : this.has('judge.pointer') ? 'judge.pointer' : null;
    if (!role) return Promise.resolve(false);
    return this.run(prio, 'judging', async () => {
      await this.playRole(role, { loop: false });
    });
  }

  private idleVariant(prio: Priority): Promise<boolean> {
    if (!this.has('idle.variant') || this.reduced) return Promise.resolve(false);
    this.lastVariant = Date.now();
    return this.run(prio, 'idle', async () => {
      await this.playRole('idle.variant', { loop: false });
    });
  }

  /** Shows a line. `capped` lines respect mute and the global speech limits. */
  async speak(text: string, prio: Priority, capped: boolean, pose: 'stand' | 'judge' = 'stand'): Promise<boolean> {
    if (!this.alive || !this.bubble || !this.overlay || prefs.isMuted() || !this.enabled('say')) return false;
    if (document.visibilityState === 'hidden') return false;
    if (capped && !this.limiter.canSpeak()) return false;
    const line = interpolate(text, { site: location.hostname, ...this.config.vars });
    if (!line) return false;
    const bubble = this.bubble;
    const showLine = async () => {
      const shown = bubble.show(line);
      if (!bubble.visible) return false;
      this.limiter.record();
      this.events.emit('spoke', line);
      await shown;
      return true;
    };
    // While being dragged or falling, talk without changing the animation.
    if (this.activity && this.activity.prio >= PRIORITY.drop) return showLine();
    let shownAny = false;
    const ran = await this.run(prio, 'speaking', async (t) => {
      this.overlay!.stopMove();
      if (pose === 'judge' && this.has('judge') && !this.reduced) void this.playRole('judge', { loop: false });
      else if (this.player?.getCurrentFrame().clip !== this.character!.roles.get('idle') && !this.reduced) void this.playRole('idle', { loop: true });
      if (t.cancelled) return false;
      shownAny = await showLine();
      return shownAny;
    });
    return ran || shownAny;
  }

  private async leave(): Promise<void> {
    const ov = this.overlay;
    if (!ov || !this.character) return this.finishLeave();
    this.bubble?.hide();
    this.menu?.close(false);
    const side: 'left' | 'right' = ov.feetX > ov.viewportW / 2 ? 'right' : 'left';
    const walk = this.character.walk[side];
    if (this.reduced || !walk || !this.enabled('leave') || document.visibilityState === 'hidden') return this.finishLeave();
    this.triggers?.stop();
    await this.run(PRIORITY.dismiss, 'leaving', async (t) => {
      const goodbye = this.book.pick('leave');
      if (goodbye && !prefs.isMuted() && this.enabled('say')) void this.bubble?.show(interpolate(goodbye, { site: location.hostname, ...this.config.vars }), 1800);
      void this.player!.play(walk.clip, { loop: true, mirrored: walk.mirrored }).catch(() => {});
      if (t.cancelled) return;
      await ov.moveTo(ov.offscreenX(side), this.speed() * 1.3);
    });
    this.finishLeave();
  }

  private finishLeave(): void {
    this.teardown();
    this.setState('dismissed');
  }

  // ------------------------------------------------------------------ public commands

  /** Visitor or API removal. The preference is stored before any animation runs. */
  dismiss(): void {
    prefs.setDismissed(true);
    if (this.state === 'loading') {
      this.finishLeave();
      return;
    }
    if (!this.alive || this.state === 'leaving') return;
    void this.leave();
  }

  mute(): void {
    prefs.setMuted(true);
    this.bubble?.hide();
  }

  unmute(): void {
    prefs.setMuted(false);
  }

  /** Runs a behaviour by id. Resolves false for unknown, disabled or unavailable behaviours. */
  async do(id: string, prio: Priority = PRIORITY.api): Promise<boolean> {
    if (UNSUPPORTED.has(id) || !(BEHAVIORS as readonly string[]).includes(id)) return false;
    const b = id as BehaviorId;
    if (!this.enabled(b) || !this.alive || !this.character || this.state === 'loading' || this.state === 'entering') return false;
    if (document.visibilityState === 'hidden') return false;
    switch (b) {
      case 'walk':
        return this.walk(prio);
      case 'idle':
        if (this.has('idle.variant') && !this.reduced) return this.idleVariant(prio);
        return this.run(prio, 'idle', async () => {});
      case 'judge':
        return this.judge(prio);
      case 'say': {
        const line = this.book.pickAny(this.config.packs);
        return line ? this.speak(line, prio, prio < PRIORITY.api) : false;
      }
      case 'react-clicks':
        return this.reactToClicks(prio);
      case 'leave':
        this.dismiss();
        return true;
      case 'enter':
      case 'drag':
        return false; // driven by the page load and by the visitor's pointer
    }
  }

  /** `say` from the API or a trigger: literal text or `#pool`. */
  say(textOrTag: string, prio: Priority = PRIORITY.api): Promise<boolean> {
    const text = this.book.resolve(textOrTag);
    if (!text || this.state === 'loading' || this.state === 'entering') return Promise.resolve(false);
    return this.speak(text, prio, prio < PRIORITY.api);
  }

  emit(name: string): void {
    this.triggers?.emit(name);
  }

  // ------------------------------------------------------------------ triggers & ambient

  private onRule(rule: TriggerRule, target: Element | null): boolean {
    if (!this.alive || this.state === 'leaving') return false;
    if (rule.say) {
      const text = this.book.resolve(rule.say);
      if (!text) return false;
      if (!this.limiter.canSpeak() || prefs.isMuted()) return false;
      const pose = rule.do === 'judge' || (target && Math.random() < 0.35) ? 'judge' : 'stand';
      void this.speak(text, PRIORITY.dom, true, pose);
      return true;
    }
    if (rule.do) {
      if (this.activity && this.activity.prio > PRIORITY.dom) return false;
      void this.do(rule.do, PRIORITY.dom);
      return true;
    }
    return false;
  }

  private scheduleAmbient(): void {
    window.clearTimeout(this.ambientTimer);
    if (!this.alive || !this.config.ambient || this.state !== 'idle' || this.activity) return;
    if (document.visibilityState === 'hidden') return;
    const delay = 5000 + Math.random() * 9000;
    this.ambientTimer = window.setTimeout(() => this.ambient(), delay);
  }

  private ambient(): void {
    if (this.activity || this.state !== 'idle') return;
    const r = Math.random();
    const variantDue = Date.now() - this.lastVariant > 45_000;
    if (r < 0.42 && this.enabled('walk')) void this.walk(PRIORITY.ambient);
    else if (r < 0.54 && this.enabled('judge')) void this.judge(PRIORITY.ambient);
    else if (r < 0.62 && variantDue && this.enabled('idle')) void this.idleVariant(PRIORITY.ambient);
    else if (r < 0.75 && this.enabled('say') && this.limiter.canSpeak()) {
      const line = this.book.pickAny(this.config.packs);
      if (line) void this.speak(line, PRIORITY.ambient, true);
    }
    if (!this.activity) this.scheduleAmbient();
  }

  // ------------------------------------------------------------------ pointer

  private characterClicked(): void {
    const now = Date.now();
    this.clicks = this.clicks.filter((t) => now - t < CLICK_SEQUENCE_MS);
    this.clicks.push(now);
    const n = this.clicks.length;
    this.triggers?.garyClicked(n);
    if (n === REACT_CLICKS_AT && this.enabled('react-clicks')) {
      this.clicks = [];
      void this.reactToClicks(PRIORITY.api);
    }
  }

  private async reactToClicks(prio: Priority): Promise<boolean> {
    const line = this.book.pickAny(['clicked', 'core']);
    if (line && !prefs.isMuted() && this.enabled('say')) return this.speak(line, prio, false, 'judge');
    return this.judge(prio, false);
  }

  private groundY(): number {
    return this.overlay!.viewportH;
  }

  private dragStart(x: number, y: number): void {
    const ov = this.overlay!;
    ov.stopMove();
    this.grab = { dx: x - ov.feetX, dy: this.groundY() - ov.lift - y };
    void this.run(PRIORITY.drag, 'dragging', async () => {
      if (this.has('held')) await this.playRole('held', { loop: true });
      else this.player?.pause();
      await new Promise<void>(() => {}); // held until dragEnd() replaces this activity
    });
  }

  private dragMove(x: number, y: number): void {
    const ov = this.overlay;
    if (!ov || this.state !== 'dragging') return;
    const [lo, hi] = ov.range();
    ov.feetX = Math.min(hi, Math.max(lo, x - this.grab.dx));
    ov.lift = Math.min(Math.max(0, this.groundY() - y - this.grab.dy), Math.max(0, ov.viewportH - ov.boxH));
    ov.place();
    if (this.bubble?.visible) this.bubble.position();
  }

  private async dragEnd(cancelled: boolean): Promise<void> {
    const ov = this.overlay;
    if (!ov || this.state !== 'dragging') return;
    const height = ov.lift;
    // The drag activity outranks the drop; release it explicitly.
    if (this.activity?.prio === PRIORITY.drag) {
      this.activity.token.cancelled = true;
      this.activity = null;
    }
    await this.run(PRIORITY.drop, 'falling', async (t) => {
      if (cancelled || height < 4) {
        ov.lift = 0;
        ov.place();
        if (cancelled) return;
      } else {
        const ms = Math.round(Math.min(600, 120 + Math.sqrt(height) * 22));
        void ov.wrap.getBoundingClientRect();
        ov.wrap.style.transition = `transform ${ms}ms cubic-bezier(.55,0,1,.45)`;
        ov.lift = 0;
        ov.place();
        await new Promise((r) => setTimeout(r, ms));
        ov.wrap.style.transition = '';
      }
      if (t.cancelled) return;
      if (this.has('drop')) await this.playRole('drop', { loop: false });
    });
  }

  // ------------------------------------------------------------------ page events

  private onVisibility(): void {
    if (!this.alive) return;
    if (document.visibilityState === 'hidden') {
      window.clearTimeout(this.ambientTimer);
      this.bubble?.hide();
      if (this.state === 'leaving') return this.finishLeave();
      if (this.activity && this.activity.prio < PRIORITY.dismiss && this.state !== 'entering') {
        this.activity.token.cancelled = true;
        this.activity = null;
        this.overlay?.stopMove();
        this.overlay!.lift = 0;
        this.overlay?.place();
        this.idle();
      }
    } else if (this.state === 'idle') {
      this.idle();
    }
  }

  private onResize(): void {
    const ov = this.overlay;
    if (!ov || !this.alive) return;
    if (this.state === 'walking' && this.activity) {
      this.activity.token.cancelled = true;
      this.activity = null;
      ov.stopMove();
      this.idle();
    }
    ov.layout(this.config.height);
    this.bubble?.position();
  }

  private onFocusIn(e: FocusEvent): void {
    const ov = this.overlay;
    if (!ov || !this.alive || this.state === 'dragging' || this.state === 'leaving' || this.state === 'entering') return;
    if (e.composedPath().includes(ov.host)) return;
    const f = focusedFieldRect();
    if (!f) return;
    const b = ov.box();
    const overlaps = !(b.left + b.width < f.left || b.left > f.right || b.top + b.height < f.top || b.top > f.bottom);
    if (!overlaps) return;
    this.bubble?.hide();
    // Step aside: move to whichever side of the field has more room.
    const [lo, hi] = ov.range();
    const target = f.left - lo > hi - f.right ? Math.max(lo, f.left - b.width) : Math.min(hi, f.right + b.width);
    if (this.reduced) {
      ov.feetX = target;
      ov.clampX();
      return;
    }
    void this.walk(PRIORITY.dom, target).then((ok) => {
      if (!ok && this.overlay) {
        this.overlay.feetX = target;
        this.overlay.clampX();
      }
    });
  }

  /** Debug/testing snapshot. Contains no visitor data. */
  snapshot(): Record<string, unknown> {
    return {
      state: this.state,
      activity: this.activity?.prio ?? null,
      frame: this.player?.getCurrentFrame() ?? null,
      player: this.player?.stats() ?? null,
      feetX: this.overlay?.feetX ?? null,
      lift: this.overlay?.lift ?? null,
      scale: this.overlay?.scale ?? null,
      reduced: this.reduced,
    };
  }

  /** Hit test helper for tests and the host-compatibility example. */
  hitTest(x: number, y: number): boolean {
    return !!this.input?.hit(x, y);
  }
}
