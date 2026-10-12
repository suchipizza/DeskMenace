// The fixed overlay: one Shadow DOM root holding the character canvas, the speech bubble,
// the options button and the menu. It reserves no layout space (fixed, 0x0 host), never moves
// host elements, and is click-through everywhere except the controls themselves. Character
// hits are decided by the input module using the current frame's alpha.

import type { Character, Clip } from '../characters/manifest';
import { STYLES } from '../ui/styles';

export type MoveResult = 'arrived' | 'interrupted';

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

  place(): void {
    const x = this.leftFor(this.feetX);
    this.wrap.style.transform = `translate3d(${Math.round(x * 10) / 10}px, ${Math.round((this.dropFor() - this.lift) * 10) / 10}px, 0)`;
  }

  show(): void {
    this.wrap.removeAttribute('data-hidden');
  }

  hide(): void {
    this.wrap.setAttribute('data-hidden', '');
  }

  /** Legal range for the feet so the character's box stays fully on screen. */
  range(): [number, number] {
    const ax = this.anchorX();
    return [ax + 4, this.viewportW - (this.boxW - ax) - 4];
  }

  clampX(): void {
    const [lo, hi] = this.range();
    this.feetX = hi < lo ? this.viewportW / 2 : Math.min(hi, Math.max(lo, this.feetX));
    if (!this.moveDone) this.place();
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

  /** Freezes a running move at its current on-screen position. */
  stopMove(): void {
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
