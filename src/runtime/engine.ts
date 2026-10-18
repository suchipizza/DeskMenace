// One character instance on one page: loads the manifest, owns the overlay, player, UI and
// triggers, and runs the behaviour state machine.
//
// Behaviours run one at a time as "activities" with a priority:
//   dismiss (5) > drag (4) > drop (3) > API call (2) > page trigger (1) > ambient (0)
// A request with a lower priority than the running activity is refused (returns false); an
// equal or higher one interrupts it. Interrupted activities stop at their next await point,
// and every clip promise they were waiting on settles.
//
// The character stands on the floor or on a page element ("surface"). Scenes (named step lists
// from the configuration or a character preset) walk it to elements, play clips and show lines.

import type { BehaviorId, CreditLink, ResolvedConfig, SceneDef, SceneStep, ScreenPoint, TriggerRule } from '../types';
import { BEHAVIORS } from '../types';
import { parseCharacter, type Character } from '../characters/manifest';
import { ClipLoadError, ClipPlayer, type PlayResult } from '../render/clip-player';
import { measure, Overlay, surfaceRect, usable } from '../render/overlay';
import { Bubble, focusedFieldRect } from '../ui/bubble';
import { Menu } from '../ui/menu';
import { Input } from '../ui/input';
import { prefs } from '../ui/storage';
import { interpolate, LineBook, SpeechLimiter } from '../content/lines';
import { Triggers } from '../triggers/triggers';
import type { Emitter } from '../util/events';
import { afterFirstPaint } from '../boot/start';
import { applyPreset } from '../boot/config';

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
  | 'away'
  | 'dismissed'
  | 'destroyed'
  | 'failed';

export const PRIORITY = { ambient: 0, dom: 1, api: 2, drop: 3, drag: 4, dismiss: 5 } as const;
type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

interface Token {
  cancelled: boolean;
  /** Called once when the activity is cancelled (ends waits early). */
  wake?: () => void;
}

function cancel(t: Token): void {
  if (t.cancelled) return;
  t.cancelled = true;
  t.wake?.();
}

interface Activity {
  prio: Priority;
  token: Token;
}

export const DEFAULT_CREDIT: CreditLink = { label: 'Powered by gary.js', url: 'https://github.com/suchipizza/DeskMenace' };

const UNSUPPORTED = new Set(['phone', 'card', 'steal-cursor']);
const CLICK_SEQUENCE_MS = 1500;
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;
const REACT_CLICKS_AT = 3;
/** Free space a surface needs above the character's head for a speech bubble, in CSS px. */
const HEAD_ROOM = 40;
const MAX_SURFACES = 100;

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
  /** Rest mode: the idle animation freezes while the visitor is inactive, to save CPU. */
  private resting = false;
  private restTimer = 0;
  private lastInput = Date.now();
  private lastVariant = 0;
  private clicks: number[] = [];
  private grab = { dx: 0, dy: 0 };
  /** Where a drag started, to put the character back if the drag is cancelled. */
  private dragFrom: { surface: Element | null; line: number | null; feetX: number } = { surface: null, line: null, feetX: 0 };
  /** A scene cut by a drag, to carry on with after the drop. */
  private resume: { name: string; step: number; prio: Priority } | null = null;
  /** Off screen after an `exit` step (not removed: a scene can bring it back). */
  private away = false;
  private lastSurfaceTop = NaN;
  private surfaceObserver: ResizeObserver | null = null;
  private observed: Element | null = null;
  private surfaceRaf = 0;
  private surfaceTimer = 0;
  private reduced = false;
  /** Escalation step per rule group (or per rule). */
  private readonly stages = new Map<unknown, number>();
  /** The scene running as the current activity, if any. */
  private sceneRun: { name: string; token: Token; step: number; prio: Priority } | null = null;
  /** Fetched preset files by name (null = unavailable). */
  private readonly presetCache = new Map<string, unknown>();
  private contentGen = 0;
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
      if (this.config.preset) {
        const gen = this.contentGen;
        const json = await this.fetchPreset(ch, this.config.preset);
        if (!this.alive) return;
        // A re-init during the fetch has layered its own preset already.
        if (gen === this.contentGen && json !== null) this.layerPreset(this.config, json);
      }
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

  /** Fetches a preset file once per name. Resolves null when the character has none or it fails. */
  private async fetchPreset(ch: Character, name: string): Promise<unknown> {
    if (this.presetCache.has(name)) return this.presetCache.get(name);
    const url = ch.presets.get(name);
    let json: unknown = null;
    if (!url) console.warn(`[gary.js] ${ch.name} has no preset "${name}"; ignored`);
    else {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: this.abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
      } catch (e) {
        if (this.abort.signal.aborted) throw e;
        console.warn(`[gary.js] Could not load preset "${name}" (${(e as Error).message}); ignored`);
      }
    }
    this.presetCache.set(name, json);
    return json;
  }

  /** Makes `base` + the preset the current config. */
  private layerPreset(base: ResolvedConfig, json: unknown): void {
    try {
      const r = applyPreset(base, json, `preset "${base.preset}"`);
      for (const w of r.warnings) console.warn(`[gary.js] ${w}`);
      this.config = r.config;
    } catch (e) {
      console.warn(`[gary.js] ${(e as Error).message}`);
      this.config = base;
    }
    this.limiter.setLimits(this.config.limits);
  }

  /** Image pixels per clip pixel this screen can show, per the `quality` option. */
  private density(overlay: Overlay): number {
    const q = this.config.quality;
    if (q === 'standard') return 1;
    if (q === 'high') return Infinity;
    // Sharper atlases need ~3x the decoded memory: keep the small ones on low-memory devices.
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (mem !== undefined && mem < 4) return 1;
    return overlay.scale * (window.devicePixelRatio || 1);
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
      density: () => this.density(overlay),
    });
    this.bubble = new Bubble(overlay, ch.bubbleAnchor, this.config.announce);
    this.menu = new Menu(overlay, ch.name, this.creditFor(ch), {
      isMuted: () => prefs.isMuted(),
      toggleMute: () => (prefs.isMuted() ? this.unmute() : this.mute()),
      remove: () => this.events.emit('_remove'),
    });
    this.input = new Input(overlay, this.player, {
      interactive: () => this.alive && this.state !== 'leaving' && this.state !== 'loading' && !this.away,
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
    const onInput = () => {
      this.lastInput = Date.now();
      if (this.resting) this.wake();
    };
    for (const t of INPUT_EVENTS) on(window, t, onInput, { passive: true, capture: true });
    // Any scroller, and any layout change, can move the element the character stands on.
    on(document, 'scroll', () => this.queueSurfaceCheck(), { passive: true, capture: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.surfaceObserver = new ResizeObserver(() => this.queueSurfaceCheck());
      this.surfaceObserver.observe(document.documentElement);
    }
    this.offs.push(() => {
      cancelAnimationFrame(this.surfaceRaf);
      window.clearTimeout(this.surfaceTimer);
      this.surfaceObserver?.disconnect();
      this.surfaceObserver = null;
    });
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
    const ch = this.character;
    if (config) {
      this.config = config;
      const gen = ++this.contentGen;
      if (ch && config.preset) {
        if (this.presetCache.has(config.preset)) {
          const json = this.presetCache.get(config.preset);
          if (json !== null) this.layerPreset(config, json);
        } else
          void this.fetchPreset(ch, config.preset).then((json) => {
            if (gen !== this.contentGen || !this.alive) return;
            if (json !== null) this.layerPreset(config, json);
            this.applyContent();
          }, () => {});
      }
    }
    if (!ch) return;
    this.book = new LineBook([ch.lines, new Map(Object.entries(this.config.lines))], Math.random, this.config.inOrder);
    this.limiter.setLimits(this.config.limits);
    this.menu?.setCredit(this.creditFor(ch));
    this.stages.clear();
    this.triggers?.stop();
    this.triggers = new Triggers([...this.config.triggers, ...this.config.addTriggers], (rule, target) => this.onRule(rule, target), ch.id, () => (this.overlay && this.state !== 'loading' ? this.overlay.box() : null));
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
    window.clearTimeout(this.restTimer);
    this.resting = false;
    if (this.activity) cancel(this.activity.token);
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
    const cut = this.sceneRun;
    if (prio === PRIORITY.drag && cut && this.activity?.token === cut.token && !cut.token.cancelled) this.resume = { name: cut.name, step: cut.step, prio: cut.prio };
    else if (prio > PRIORITY.drop) this.resume = null;
    if (this.activity) cancel(this.activity.token);
    this.overlay.stopMove();
    window.clearTimeout(this.ambientTimer);
    window.clearTimeout(this.restTimer);
    this.resting = false;
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
      const r = this.resume;
      if (r && prio === PRIORITY.drop && this.alive) {
        this.resume = null;
        void this.scene(r.name, r.prio, r.step, true);
      } else if (this.alive) this.idle();
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
    if (this.away) {
      this.setState('away');
      this.player.pause();
      return;
    }
    this.setState('idle');
    if (document.visibilityState === 'hidden') {
      this.scheduleAmbient();
      return;
    }
    this.resting = false;
    if (this.reduced) void this.player.showFrame(this.character.poster.clip, this.character.poster.frame);
    else void this.playRole('idle', { loop: true });
    this.scheduleAmbient();
    this.armRest();
    this.queueSurfaceCheck();
  }

  private armRest(): void {
    window.clearTimeout(this.restTimer);
    const after = this.config.restAfter * 1000;
    if (!after || this.reduced || !this.alive) return;
    this.restTimer = window.setTimeout(() => this.checkRest(), Math.max(0, after - (Date.now() - this.lastInput)));
  }

  /** Freezes the idle animation once nobody has touched the page for `restAfter` seconds. */
  private checkRest(): void {
    if (this.state !== 'idle' || this.activity || !this.player) return; // idle() re-arms later
    if (Date.now() - this.lastInput < this.config.restAfter * 1000) return this.armRest();
    this.resting = true;
    window.clearTimeout(this.ambientTimer);
    this.player.pause();
  }

  private wake(): void {
    if (!this.resting) return;
    this.resting = false;
    this.player?.resume();
    this.scheduleAmbient();
    this.armRest();
  }

  private async enter(): Promise<void> {
    const ov = this.overlay!;
    const side = this.config.position.side;
    const entrance = this.config.entrance ? this.sceneDef(this.config.entrance) : null;
    if (entrance && entrance.steps[0].enter && this.enabled('enter')) {
      // The entrance scene brings the character in itself (its first step is `enter`).
      this.setState('idle');
      this.entered();
      void this.scene(this.config.entrance!, PRIORITY.api);
      return;
    }
    if (this.config.position.y !== null) ov.line = this.lineFor(this.config.position.y);
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
    // An entrance scene without its own `enter` step plays once the character is in.
    if (entrance) void this.scene(this.config.entrance!, PRIORITY.api);
  }

  /** Feet line that puts the body's middle at `y` (fraction of the viewport height), on screen. */
  private lineFor(y: number): number {
    const ov = this.overlay!;
    const h = this.standH();
    const feet = Math.min(ov.floorY, Math.max(h + HEAD_ROOM, y * ov.viewportH + h / 2));
    return ov.lineAt(feet);
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
    let [lo, hi] = ov.range();
    if (x === undefined && !ov.surface) {
      // Ambient walks stay inside position.x (fractions of the screen width).
      const [a, b] = this.config.position.x;
      lo = Math.max(lo, a * ov.viewportW);
      hi = Math.min(hi, b * ov.viewportW);
    }
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
    const walk = ch.walk[target < ov.feetX ? 'left' : 'right'];
    if (!walk || Math.abs(target - ov.feetX) < 4) return Promise.resolve(false);
    return this.run(prio, 'walking', (t) => this.stroll(target!, t));
  }

  /**
   * Walks to feet x (clamped to the ground's range). With `to`, it walks onto that ground: an
   * element or a line at another height, diagonally. Resolves false when interrupted.
   */
  private async stroll(x: number, t: Token, to?: { surface: Element | null; line: number | null }): Promise<boolean> {
    const ch = this.character!;
    const ov = this.overlay!;
    const [lo, hi] = ov.range(to ? to.surface : ov.surface);
    const target = hi < lo ? ov.feetX : Math.min(hi, Math.max(lo, x));
    const dy = to ? ov.groundY(to.surface, to.line) - (ov.groundY() - ov.lift) : 0;
    if (Math.abs(target - ov.feetX) < 4 && Math.abs(dy) < 4) {
      if (to && !t.cancelled) ov.jump(to.surface, ov.feetX, 0, 0, to.line);
      return !t.cancelled;
    }
    const dir = target < ov.feetX - 1 ? 'left' : 'right';
    const walk = ch.walk[dir] ?? ch.walk[dir === 'left' ? 'right' : 'left'];
    if (!walk) return !t.cancelled;
    this.setState('walking');
    void this.player!.play(walk.clip, { loop: true, mirrored: walk.mirrored }).catch(() => {});
    if (t.cancelled) return false;
    return (await ov.moveTo(target, this.speed(), to)) === 'arrived' && !t.cancelled;
  }

  /** Walks off one side of the screen and stays away. */
  private async exitTo(side: 'left' | 'right', t: Token): Promise<void> {
    const ch = this.character!;
    const ov = this.overlay!;
    if (ov.surface) {
      // Leave the element at its height; walking past its edges is fine off the page's grid.
      ov.line = ov.lineAt(ov.groundY());
      ov.surface = null;
    }
    const walk = ch.walk[side] ?? ch.walk[side === 'left' ? 'right' : 'left'];
    if (walk && !this.reduced) {
      this.setState('walking');
      void this.player!.play(walk.clip, { loop: true, mirrored: walk.mirrored }).catch(() => {});
      if ((await ov.moveTo(ov.offscreenX(side), this.speed())) !== 'arrived' || t.cancelled) return;
    }
    this.bubble?.hide();
    ov.hide();
    this.away = true;
    this.setState('away');
  }

  /** Puts the character just outside one side of the screen at the start of a scene. */
  private enterFrom(step: SceneStep): void {
    const ov = this.overlay!;
    ov.stopMove();
    let line = this.lineFor(step.y ?? 0.5);
    if (step.on) {
      const el = this.firstFitting(step.on);
      if (el && this.fits(el)) line = ov.lineAt(surfaceRect(el).top);
    }
    ov.surface = null;
    ov.line = line;
    ov.lift = 0;
    this.away = false;
    if (this.reduced) {
      ov.feetX = ov.viewportW * (step.enter === 'left' ? 0.25 : 0.75);
      ov.clampX();
      void this.player?.showFrame(this.character!.poster.clip, this.character!.poster.frame);
    } else ov.feetX = ov.offscreenX(step.enter!);
    ov.place();
    ov.show();
  }

  private firstFitting(selector: string): Element | null {
    let all: Element[] = [];
    try {
      all = [...document.querySelectorAll(selector)].slice(0, MAX_SURFACES);
    } catch {
      /* validated already */
    }
    return all.find((e) => this.fits(e)) ?? all[0] ?? null;
  }

  /** Walks to a point on the screen ({ x, y } fractions; a missing one stays as it is). */
  private walkToPoint(p: ScreenPoint, t: Token): Promise<boolean> {
    const ov = this.overlay!;
    const x = p.x !== undefined ? p.x * ov.viewportW : ov.feetX;
    if (p.y === undefined) return this.stroll(x, t);
    return this.stroll(x, t, { surface: null, line: this.lineFor(p.y) });
  }

  // ------------------------------------------------------------------ surfaces

  /** Height of the standing character in CSS px. */
  private standH(): number {
    const ch = this.character!;
    return ch.clips.get(ch.roles.get('idle')!)!.h * this.overlay!.scale;
  }

  /** Whether the character can stand on `el` right now (on screen, wide enough, room above). */
  private fits(el: Element): boolean {
    const ov = this.overlay;
    if (!ov || !el.isConnected || ov.host.contains(el)) return false;
    const box = el.getBoundingClientRect();
    if (box.width < 24 || box.height <= 0) return false;
    const r = surfaceRect(el);
    if (r.right - r.left < 24) return false;
    if (r.top < this.standH() + HEAD_ROOM || r.top > ov.floorY - this.standH() / 3) return false;
    const [lo, hi] = ov.range(el);
    return hi >= lo;
  }

  /** Page elements the character may wander onto: `surfaces` plus [data-gary-surface]. */
  private surfaceCandidates(): Element[] {
    const sel = [this.config.surfaces, '[data-gary-surface]'].filter(Boolean).join(',');
    try {
      return [...document.querySelectorAll(sel)].slice(0, MAX_SURFACES);
    } catch {
      return [];
    }
  }

  private pickX(el: Element | null, at: SceneStep['at'] = 'center'): number {
    const ov = this.overlay!;
    const [lo, hi] = ov.range(el);
    if (hi < lo) return (lo + hi) / 2;
    if (at === 'left') return lo + (hi - lo) * 0.1;
    if (at === 'right') return hi - (hi - lo) * 0.1;
    if (at === 'random') return lo + Math.random() * (hi - lo);
    return (lo + hi) / 2;
  }

  /**
   * Walks to `el` (null = the floor) and stops at `at`, diagonally if it is at another height.
   * If the element can't hold the character, it walks to the spot level with it instead.
   */
  private async goTo(el: Element | null, at: SceneStep['at'], t: Token): Promise<boolean> {
    const ov = this.overlay!;
    if (el && !this.fits(el)) {
      const r = surfaceRect(el);
      const w = r.right - r.left;
      const x = at === 'left' ? r.left + w * 0.1 : at === 'right' ? r.right - w * 0.1 : at === 'random' ? r.left + Math.random() * w : r.left + w / 2;
      return this.stroll(x, t);
    }
    const x = this.pickX(el, at);
    if (el === ov.surface && (el || ov.line === null)) return this.stroll(x, t);
    return this.stroll(x, t, { surface: el, line: null });
  }

  /** Lifts the character onto `el`, or drops it onto the floor (el = null). */
  private async hopTo(el: Element | null, x: number, t: Token): Promise<boolean> {
    const ov = this.overlay!;
    if (t.cancelled) return false;
    if (el) {
      // The page may have scrolled or changed during the walk over.
      if (!this.fits(el)) return false;
      const [lo, hi] = ov.range(el);
      x = Math.min(hi, Math.max(lo, x));
    }
    const fromY = ov.groundY() - ov.lift;
    const toY = ov.groundY(el);
    const up = toY < fromY - 2;
    const dist = Math.hypot(x - ov.feetX, toY - fromY);
    this.setState(up ? 'walking' : 'falling');
    if (this.has('held')) void this.playRole('held', { loop: true });
    const ms = up ? Math.round(Math.min(1000, 420 + dist * 0.8)) : Math.round(Math.min(650, 160 + Math.sqrt(dist) * 22));
    const r = await ov.jump(el, x, ms, up ? Math.max(24, Math.min(80, dist * 0.15)) : 0);
    if (t.cancelled || r !== 'arrived') return false;
    if (!up && dist > 60 && this.has('drop')) await this.playRole('drop', { loop: false });
    else void this.playRole('idle', { loop: true });
    return !t.cancelled;
  }

  private queueSurfaceCheck(): void {
    if (this.surfaceRaf || !this.overlay?.surface) return;
    this.surfaceRaf = requestAnimationFrame(() => {
      this.surfaceRaf = 0;
      measure(() => this.checkSurface());
    });
  }

  /**
   * Keeps the character on its element as the page scrolls or its layout changes; it falls off
   * when it can't stay, and drops to the floor when the element is gone.
   */
  private checkSurface(): void {
    const ov = this.overlay;
    window.clearTimeout(this.surfaceTimer);
    if (!ov?.surface || !this.alive || document.visibilityState === 'hidden') return;
    if (this.state === 'dragging' || this.state === 'leaving') return;
    // Moves that neither scroll nor resize anything (transforms, absolute positioning) are
    // caught by a slow re-check while the character stands on an element.
    this.surfaceTimer = window.setTimeout(() => this.queueSurfaceCheck(), 1000);
    const el = ov.surface;
    if (this.observed !== el && this.surfaceObserver) {
      if (this.observed) this.surfaceObserver.unobserve(this.observed);
      this.surfaceObserver.observe(el);
      this.observed = el;
    }
    if (this.fits(el)) {
      const top = surfaceRect(el).top;
      if (Math.abs(top - this.lastSurfaceTop) < 0.5) return;
      this.lastSurfaceTop = top;
      // A walk in progress finishes first; it settles onto the element's new position at the end.
      if (ov.moving) return;
      ov.place();
      this.bubble?.position();
      return;
    }
    const below = !usable(el) || surfaceRect(el).top >= ov.floorY - this.standH() / 3;
    if (below || this.reduced) {
      ov.stopMove();
      ov.surface = null;
      ov.clampX();
      ov.place();
      return;
    }
    void this.run(PRIORITY.drop, 'falling', async (t) => {
      const [lo, hi] = ov.range(null);
      await this.hopTo(null, Math.min(hi, Math.max(lo, ov.feetX)), t);
    });
  }

  /** Ambient wandering between page elements. */
  private roam(prio: Priority): Promise<boolean> {
    const ov = this.overlay!;
    if (this.reduced) return Promise.resolve(false);
    if (ov.surface && Math.random() < 0.35) return this.run(prio, 'walking', (t) => this.goTo(null, 'random', t));
    const options = this.surfaceCandidates().filter((el) => el !== ov.surface && this.fits(el));
    if (!options.length) return this.walk(prio);
    const el = options[Math.floor(Math.random() * options.length)];
    return this.run(prio, 'walking', (t) => this.goTo(el, 'random', t));
  }

  // ------------------------------------------------------------------ scenes

  private sceneDef(name: string): SceneDef | null {
    return Object.prototype.hasOwnProperty.call(this.config.scenes, name) ? this.config.scenes[name] : null;
  }

  /**
   * Plays a named scene from the configuration. `resumed`: carrying on after a drag from step
   * `from` (an `enter` step there is skipped), after the scene's `interrupted` line.
   */
  scene(name: string, prio: Priority, from = 0, resumed = false): Promise<boolean> {
    const def = this.sceneDef(name);
    if (!def || !this.alive || !this.character || this.state === 'loading' || this.state === 'entering') return Promise.resolve(false);
    if (document.visibilityState === 'hidden') return Promise.resolve(false);
    return this.run(prio, 'idle', async (t) => {
      const mine = (this.sceneRun = { name, token: t, step: from, prio });
      try {
        if (resumed && def.interrupted) {
          const text = this.book.resolve(def.interrupted);
          if (text) {
            this.standStill();
            await this.showLine(text, false);
          }
        }
        for (let i = from; i < def.steps.length; i++) {
          if (t.cancelled || !this.alive) return;
          const step = def.steps[i];
          if (resumed && step.enter) continue;
          // A line shows as soon as its step starts, so a drag during it carries on after it.
          mine.step = step.say !== undefined ? i + 1 : i;
          await this.sceneStep(step, t);
        }
      } finally {
        if (this.sceneRun === mine) this.sceneRun = null;
      }
    });
  }

  /** Name of the scene that is playing right now (not one that was interrupted). */
  private get scenePlaying(): string | null {
    const r = this.sceneRun;
    return r && !r.token.cancelled && this.activity?.token === r.token ? r.name : null;
  }

  private async sceneStep(step: SceneStep, t: Token): Promise<void> {
    if (step.enter !== undefined) {
      this.enterFrom(step);
    } else if (step.exit !== undefined) {
      await this.exitTo(step.exit, t);
    } else if (step.walkTo !== undefined) {
      if (this.away) return;
      if (this.reduced || !this.enabled('walk')) return;
      if (typeof step.walkTo === 'object') {
        await this.walkToPoint(step.walkTo, t);
        if (!t.cancelled) this.standStill();
        return;
      }
      let el: Element | null = null;
      if (step.walkTo !== 'floor') {
        // The first match that can hold the character, else the first match (walks level with it).
        el = this.firstFitting(step.walkTo);
        if (!el) return;
      }
      await this.goTo(el, step.at, t);
      if (!t.cancelled) this.standStill();
    } else if (step.say !== undefined) {
      if (this.away) return;
      const text = this.book.resolve(step.say);
      if (!text) return;
      this.standStill();
      // A scene's lines are part of the scene: never held back by the limits nor counted against
      // them (the rule's cooldown paces scenes started by triggers).
      await this.showLine(text, false);
    } else if (step.play !== undefined) {
      if (!this.has(step.play) || this.reduced || this.away) return;
      this.setState('judging');
      await this.playRole(step.play, { loop: false });
      if (!t.cancelled) this.standStill();
    } else if (step.wait !== undefined) {
      this.standStill();
      await new Promise<void>((r) => {
        const id = setTimeout(r, step.wait! * 1000);
        t.wake = () => {
          clearTimeout(id);
          r();
        };
      });
      t.wake = undefined;
    }
  }

  /** Idle loop inside an activity (without ending it). */
  private standStill(): void {
    if (this.away) return;
    this.setState('idle');
    if (this.reduced) void this.player?.showFrame(this.character!.poster.clip, this.character!.poster.frame);
    else if (this.player?.getCurrentFrame().clip !== this.character!.roles.get('idle')) void this.playRole('idle', { loop: true });
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
    if (!interpolate(text, this.vars())) return false;
    const showLine = () => this.showLine(text, capped);
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

  private vars(): Record<string, string> {
    return { site: location.hostname, ...this.config.vars };
  }

  /** Shows a line in the bubble without changing the activity. Resolves when it is hidden. */
  private async showLine(text: string, capped: boolean): Promise<boolean> {
    const bubble = this.bubble;
    if (!bubble || prefs.isMuted() || !this.enabled('say') || document.visibilityState === 'hidden') return false;
    if (capped && !this.limiter.canSpeak()) return false;
    const line = interpolate(text, this.vars());
    if (!line) return false;
    const shown = bubble.show(line);
    if (!bubble.visible) return false;
    this.limiter.record(capped);
    this.events.emit('spoke', line);
    await shown;
    return true;
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
      if (goodbye && !prefs.isMuted() && this.enabled('say')) void this.bubble?.show(interpolate(goodbye, this.vars()), 1800);
      if (ov.surface) {
        // Walks off at the height of the element it stood on.
        ov.line = ov.lineAt(ov.groundY());
        ov.surface = null;
      }
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
    if (!(BEHAVIORS as readonly string[]).includes(id) && this.sceneDef(id)) return this.scene(id, prio);
    if (this.away) return false; // only a scene (with an `enter` step) brings it back
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
    if (!this.alive || this.state === 'leaving' || this.away) return false;
    if (rule.during) {
      // A remark while the scene goes on, unless a line is already showing.
      if (this.scenePlaying !== rule.during || this.bubble?.visible || !rule.say) return false;
      // Checked before picking, so a line in an ordered pool is never skipped.
      if (prefs.isMuted() || !this.limiter.canSpeak()) return false;
      const text = this.book.resolve(rule.say);
      if (!text) return false;
      void this.showLine(text, true);
      return true;
    }
    if (rule.on === 'drag') {
      // Being picked up is the visitor's doing: answered right away, outside the speech limits.
      if (this.state !== 'dragging' || !rule.say || prefs.isMuted()) return false;
      const text = this.book.resolve(rule.say);
      if (!text) return false;
      void this.speak(text, PRIORITY.dom, false);
      return true;
    }
    // A page trigger never cuts into a running scene.
    if (this.scenePlaying) return false;
    if (rule.scene) {
      // Escalation only advances when the scene actually starts.
      if (this.state === 'loading' || this.state === 'entering') return false;
      if (this.activity && this.activity.prio > PRIORITY.dom) return false;
      const key = rule.group ?? rule;
      const stage = this.stages.get(key) ?? 0;
      const name = rule.scene[Math.min(stage, rule.scene.length - 1)];
      if (!Object.prototype.hasOwnProperty.call(this.config.scenes, name)) return false;
      this.stages.set(key, stage + 1);
      void this.scene(name, PRIORITY.dom);
      return true;
    }
    if (rule.say) {
      if (!this.limiter.canSpeak() || prefs.isMuted()) return false;
      const text = this.book.resolve(rule.say);
      if (!text) return false;
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
    if (!this.alive || !this.config.ambient || this.state !== 'idle' || this.activity || this.resting) return;
    if (document.visibilityState === 'hidden') return;
    const pace = this.config.pace === 'busy' ? 0.35 : this.config.pace === 'calm' ? 1.6 : 1;
    const delay = (5000 + Math.random() * 9000) * pace;
    this.ambientTimer = window.setTimeout(() => this.ambient(), delay);
  }

  private ambient(): void {
    if (this.activity || this.state !== 'idle') return;
    // Busy: more of the ambient turns are walks.
    const r = this.config.pace === 'busy' && Math.random() < 0.4 ? 0 : Math.random();
    const variantDue = Date.now() - this.lastVariant > 45_000;
    if (r < 0.42 && this.enabled('walk')) void (this.surfaceCandidates().length || this.overlay?.surface ? this.roam(PRIORITY.ambient) : this.walk(PRIORITY.ambient));
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
    return this.overlay!.floorY;
  }

  private dragStart(x: number, y: number): void {
    const ov = this.overlay!;
    ov.stopMove();
    this.dragFrom = { surface: ov.surface, line: ov.line, feetX: ov.feetX };
    if (ov.surface || ov.line !== null) {
      // Picked up from an element or a line: from now on the height counts from the floor.
      ov.lift += this.groundY() - ov.groundY();
      ov.surface = null;
      ov.line = null;
    }
    this.grab = { dx: x - ov.feetX, dy: this.groundY() - ov.lift - y };
    void this.run(PRIORITY.drag, 'dragging', async () => {
      this.triggers?.dragged();
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
      cancel(this.activity.token);
      this.activity = null;
    }
    // Released above an element it can stand on: land there instead of on the floor.
    const feetY = this.groundY() - height;
    const landing = cancelled || height < 4 ? null : this.surfaceCandidates()
      .filter((el) => {
        const r = surfaceRect(el);
        return r.left <= ov.feetX && ov.feetX <= r.right && r.top >= feetY - 2 && this.fits(el);
      })
      .sort((a, b) => surfaceRect(a).top - surfaceRect(b).top)[0];
    await this.run(PRIORITY.drop, 'falling', async (t) => {
      if (landing) {
        const [lo, hi] = ov.range(landing);
        await ov.jump(landing, Math.min(hi, Math.max(lo, ov.feetX)), Math.round(Math.min(600, 120 + Math.sqrt(Math.max(1, surfaceRect(landing).top - feetY)) * 22)), 0);
      } else if (cancelled || height < 4) {
        // A cancelled drag puts the character back where it was picked up.
        const from = this.dragFrom;
        if (cancelled) {
          if (from.surface && this.fits(from.surface)) ov.surface = from.surface;
          else if (from.line !== null) ov.line = from.line;
          if (ov.surface || ov.line !== null) {
            ov.feetX = from.feetX;
            ov.clampX();
          }
        }
        ov.lift = 0;
        ov.place();
        if (cancelled) return;
      } else if (this.config.dropTo === 'here') {
        // Lands where it was let go: the fall clip plays in place.
        ov.line = ov.lineAt(Math.max(this.standH(), feetY));
        ov.lift = 0;
        ov.place();
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
        cancel(this.activity.token);
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
      if (this.scenePlaying) ov.stopMove(); // the scene goes on with its next step
      else {
        cancel(this.activity.token);
        this.activity = null;
        ov.stopMove();
        this.idle();
      }
    }
    if (ov.surface && !this.fits(ov.surface)) {
      ov.stopMove();
      ov.surface = null;
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
      surface: this.overlay?.surface ? describe(this.overlay.surface) : null,
      scene: this.scenePlaying,
      scale: this.overlay?.scale ?? null,
      reduced: this.reduced,
      resting: this.resting,
    };
  }

  /** Hit test helper for tests and the host-compatibility example. */
  hitTest(x: number, y: number): boolean {
    return !!this.input?.hit(x, y);
  }
}

/** Short, data-free description of an element for the debug snapshot. */
function describe(el: Element): string {
  return el.id ? `#${el.id}` : el.tagName.toLowerCase();
}
