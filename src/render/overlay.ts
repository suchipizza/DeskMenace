// The fixed overlay: one Shadow DOM root holding the character canvas, the speech bubble,
// the options button and the menu. It reserves no layout space (fixed, 0x0 host), never moves
// host elements, and is click-through everywhere except the controls themselves. Character
// hits are decided by the input module using the current frame's alpha.
//
// The character stands either on the floor (the bottom of the viewport) or on a "surface": the
// top edge of a page element. On a surface its position follows the element as the page
// scrolls; the engine decides when the element no longer fits and the character must get down.

import type { Character, Clip } from '../characters/manifest';
import { STYLES } from '../ui/styles';

export type MoveResult = 'arrived' | 'interrupted';

const REPLACED = /^(IMG|PICTURE|VIDEO|CANVAS|SVG|IFRAME|INPUT|SELECT|TEXTAREA|BUTTON|HR)$/i;

type Rect = { left: number; right: number; top: number };
let cache: Map<Element, Rect> | null = null;

/** Runs `fn` with surface measurements cached, so one frame measures each element once. */
export function measure<T>(fn: () => T): T {
  if (cache) return fn();
  cache = new Map();
  try {
    return fn();
  } finally {
    cache = null;
  }
}

/** False for an element that left the document or has no box (display: none). */
export function usable(el: Element): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/**
 * The part of an element the character can stand on, in viewport px. A plain text element
 * (a heading, a paragraph) is only as wide as its text, not its full-width box; images and
 * elements with a background or border use their box.
 */
export function surfaceRect(el: Element): Rect {
  const hit = cache?.get(el);
  if (hit) return hit;
  const out = measureSurface(el);
  cache?.set(el, out);
  return out;
}

function measureSurface(el: Element): Rect {
  const r = el.getBoundingClientRect();
  if (REPLACED.test(el.tagName)) return r;
  const cs = getComputedStyle(el);
  const painted = (cs.backgroundColor !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(cs.backgroundColor)) || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0;
  if (painted) return r;
  // Geometry only: the extent of the element's content, never the text itself.
  const range = document.createRange();
  range.selectNodeContents(el);
  const t = range.getBoundingClientRect();
  if (!t.width) return r;
  return { left: Math.max(r.left, t.left), right: Math.min(r.right, t.right), top: Math.max(r.top, t.top) };
}

export class Overlay {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly wrap: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly handle: HTMLButtonElement;

  /** Display scale: CSS px per frame px. */
  scale = 1;
  /** Horizontal position of the feet, in viewport CSS px. */
  feetX = 0;
  /** Height of the feet above the ground line, in CSS px (dragging). */
  lift = 0;
  /** Page element the character stands on, or null for the floor. */
  surface: Element | null = null;
  /** Bottom inset of the floor (safe area), in CSS px. */
  private floorInset = 0;
  private hop: Animation | null = null;
  private clip: Clip;
  private mirrored = false;
  private moveDone: ((r: MoveResult) => void) | null = null;
  private moveTimer = 0;
  private onTransitionEnd = (e: TransitionEvent) => {
    if (e.target === this.wrap && e.propertyName === 'transform') this.endMove('arrived');
  };

  constructor(private readonly character: Character, opts: { zIndex: number; label: string }) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-garyjs', character.id);
    // Inline styles on the host survive most resets; the host itself takes no space.
    this.host.style.cssText = `position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;z-index:${opts.zIndex}!important;pointer-events:none!important;display:block!important;`;
    this.root = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    this.wrap = document.createElement('div');
    this.wrap.className = 'char';
    this.wrap.setAttribute('data-hidden', '');
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 0; // no default 300x150 box before the first paint
    this.canvas.setAttribute('aria-hidden', 'true');
    this.handle = document.createElement('button');
    this.handle.type = 'button';
    this.handle.className = 'handle';
    this.handle.textContent = '⋯';
    this.handle.setAttribute('aria-haspopup', 'menu');
    this.handle.setAttribute('aria-expanded', 'false');
    this.handle.setAttribute('aria-label', opts.label);
    this.handle.title = opts.label;
    this.wrap.append(this.canvas, this.handle);
    this.root.append(style, this.wrap);
    this.wrap.addEventListener('transitionend', this.onTransitionEnd);

    this.clip = character.clips.get(character.roles.get('idle')!)!;
    document.documentElement.appendChild(this.host);
  }

  get viewportW(): number {
    return document.documentElement.clientWidth || window.innerWidth;
  }

  get viewportH(): number {
    return window.innerHeight;
  }

  /** Recomputes the display scale for the current viewport. */
  layout(heightOverride: number | null): void {
    const idle = this.character.clips.get(this.character.roles.get('idle')!)!;
    const want = heightOverride ?? this.character.height;
    const vw = this.viewportW;
    const vh = this.viewportH;
    // Never taller than ~40% of the viewport, and smaller on narrow screens.
    let h = Math.min(want, Math.round(vh * 0.4));
    if (vw < 600) h = Math.min(h, Math.round(want * 0.62));
    h = Math.max(Math.min(this.character.minHeight, want), h);
    this.scale = h / idle.h;
    this.floorInset = parseFloat(getComputedStyle(this.wrap).bottom) || 0;
    this.applyClip(this.clip, this.mirrored);
    this.clampX();
  }

  /** Width of the current clip box in CSS px. */
  get boxW(): number {
    return this.clip.w * this.scale;
  }

  get boxH(): number {
    return this.clip.h * this.scale;
  }

  get currentClip(): Clip {
    return this.clip;
  }

  /** Called by the player before the first frame of a clip is painted. */
  applyClip(clip: Clip, mirrored: boolean): void {
    this.clip = clip;
    this.mirrored = mirrored;
    const w = clip.w * this.scale;
    const h = clip.h * this.scale;
    const cs = this.canvas.style;
    cs.width = `${w}px`;
    cs.height = `${h}px`;
    cs.top = `${-h}px`;
    this.canvas.classList.toggle('mirrored', mirrored);
    // Handle sits at the top-right corner of the clip's hit rectangle.
    const [hx, hy, hw] = this.hitRect(clip);
    this.handle.style.left = `${Math.min(w - 28, (hx + hw) * this.scale - 8)}px`;
    this.handle.style.top = `${-h + Math.max(0, hy * this.scale)}px`;
    if (!this.moveDone) this.place();
  }

  /** Hit rectangle of a clip in frame px, mirrored if needed. */
  hitRect(clip = this.clip): [number, number, number, number] {
    const [x, y, w, h] = clip.hit;
    return this.mirrored && clip === this.clip ? [clip.w - x - w, y, w, h] : [x, y, w, h];
  }

  /** Feet anchor x within the current box, in CSS px. */
  private anchorX(clip = this.clip): number {
    const fx = this.mirrored && clip === this.clip ? 1 - clip.feet[0] : clip.feet[0];
    return fx * clip.w * this.scale;
  }

  private leftFor(feetX: number): number {
    return feetX - this.anchorX();
  }

  /** Feet y anchor offset: frames whose feet are not at the bottom edge are shifted down. */
  private dropFor(): number {
    return (1 - this.clip.feet[1]) * this.clip.h * this.scale;
  }

  /** Viewport y of the line the feet stand on. */
  groundY(surface = this.surface): number {
    const floor = this.viewportH - this.floorInset;
    // An element that vanished (removed, display: none) counts as the floor.
    return surface && usable(surface) ? surfaceRect(surface).top : floor;
  }

  private transformFor(feetX: number, surface: Element | null, lift: number): string {
    const x = this.leftFor(feetX);
    const y = this.dropFor() - lift + this.groundY(surface) - this.groundY(null);
    return `translate3d(${Math.round(x * 10) / 10}px, ${Math.round(y * 10) / 10}px, 0)`;
  }

  place(): void {
    this.wrap.style.transform = this.transformFor(this.feetX, this.surface, this.lift);
  }

  show(): void {
    this.wrap.removeAttribute('data-hidden');
  }

  hide(): void {
    this.wrap.setAttribute('data-hidden', '');
  }

  /**
   * Legal range for the feet so the character's box stays fully on screen and, on a surface,
   * the feet stay on the element.
   */
  range(surface = this.surface): [number, number] {
    const ax = this.anchorX();
    let lo = ax + 4;
    let hi = this.viewportW - (this.boxW - ax) - 4;
    if (surface) {
      const r = surfaceRect(surface);
      lo = Math.max(lo, r.left + 6);
      hi = Math.min(hi, r.right - 6);
    }
    return [lo, hi];
  }

  clampX(): void {
    const [lo, hi] = this.range();
    this.feetX = hi < lo ? (this.surface ? (lo + hi) / 2 : this.viewportW / 2) : Math.min(hi, Math.max(lo, this.feetX));
    if (!this.moving) this.place();
  }

  /** Off-screen feet position for entering/leaving on a side. */
  offscreenX(side: 'left' | 'right'): number {
    const ax = this.anchorX();
    return side === 'left' ? -(this.boxW - ax) - 8 : this.viewportW + ax + 8;
  }

  /**
   * Moves the feet horizontally to `x` at `speed` CSS px/s using a compositor transition
   * (no per-frame JavaScript). Resolves when it arrives or is interrupted.
   */
  moveTo(x: number, speed: number): Promise<MoveResult> {
    this.stopMove();
    const dist = Math.abs(x - this.feetX);
    if (dist < 1) {
      this.feetX = x;
      this.place();
      return Promise.resolve('arrived');
    }
    const ms = Math.round((dist / Math.max(1, speed)) * 1000);
    this.feetX = x;
    // Force the start position to be committed before changing the transform.
    void this.wrap.getBoundingClientRect();
    this.wrap.style.transition = `transform ${ms}ms linear`;
    this.place();
    return new Promise<MoveResult>((resolve) => {
      this.moveDone = resolve;
      // transitionend may not fire (hidden tab, display changes): a timer backs it up.
      this.moveTimer = window.setTimeout(() => this.endMove('arrived'), ms + 120);
    });
  }

  /**
   * Moves the character from where it is now onto `surface` (null = floor) at feet `x`, along an
   * arc that rises `rise` CSS px above the higher end (0 = a plain fall). Compositor-driven.
   */
  jump(surface: Element | null, x: number, ms: number, rise: number): Promise<MoveResult> {
    this.stopMove();
    const from = this.transformFor(this.feetX, this.surface, this.lift);
    const fromY = this.groundY() - this.lift;
    const x0 = this.feetX;
    this.surface = surface;
    this.feetX = x;
    this.lift = 0;
    const to = this.transformFor(x, surface, 0);
    this.place();
    if (typeof this.wrap.animate !== 'function' || ms <= 0) return Promise.resolve('arrived');
    const top = Math.min(fromY, this.groundY()) - rise;
    const midX = this.leftFor((x + x0) / 2);
    const mid = `translate3d(${Math.round(midX)}px, ${Math.round(this.dropFor() + top - this.groundY(null))}px, 0)`;
    const frames: Keyframe[] = rise > 0
      ? [{ transform: from, easing: 'cubic-bezier(.2,.6,.4,1)' }, { transform: mid, easing: 'cubic-bezier(.6,0,.8,.4)' }, { transform: to }]
      : [{ transform: from, easing: 'cubic-bezier(.55,0,1,.45)' }, { transform: to }];
    const anim = (this.hop = this.wrap.animate(frames, { duration: ms }));
    return new Promise<MoveResult>((resolve) => {
      let settled = false;
      const done = (r: MoveResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (this.hop === anim) this.hop = null;
        resolve(r);
      };
      // finish may not fire in a hidden tab: a timer backs it up.
      const timer = window.setTimeout(() => done('arrived'), ms + 120);
      anim.onfinish = () => done('arrived');
      anim.oncancel = () => done('interrupted');
    });
  }

  /** True when the character is moving (walking or jumping). */
  get moving(): boolean {
    return !!this.moveDone || !!this.hop;
  }

  /** Freezes a running move at its current on-screen position. A jump is completed instead. */
  stopMove(): void {
    if (this.hop) {
      const h = this.hop;
      this.hop = null;
      h.cancel();
    }
    if (!this.moveDone) return;
    const m = getComputedStyle(this.wrap).transform;
    const left = parseMatrixX(m);
    if (left !== null) this.feetX = left + this.anchorX();
    this.endMove('interrupted');
  }

  private endMove(r: MoveResult): void {
    const done = this.moveDone;
    if (!done) return;
    this.moveDone = null;
    window.clearTimeout(this.moveTimer);
    this.wrap.style.transition = '';
    this.place();
    done(r);
  }

  /** Character box in viewport coordinates (CSS px). */
  box(): { left: number; top: number; width: number; height: number } {
    const r = this.canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /** Converts a viewport point into frame pixels of the current clip. */
  toFrame(clientX: number, clientY: number): [number, number] | null {
    const b = this.box();
    if (!b.width || !b.height) return null;
    return [((clientX - b.left) / b.width) * this.clip.w, ((clientY - b.top) / b.height) * this.clip.h];
  }

  dispose(): void {
    this.stopMove();
    this.wrap.removeEventListener('transitionend', this.onTransitionEnd);
    this.host.remove();
  }
}

function parseMatrixX(m: string): number | null {
  if (!m || m === 'none') return 0;
  const v = m.match(/matrix(3d)?\(([^)]+)\)/);
  if (!v) return null;
  const parts = v[2].split(',').map(Number);
  const x = v[1] ? parts[12] : parts[4];
  return Number.isFinite(x) ? x : null;
}
