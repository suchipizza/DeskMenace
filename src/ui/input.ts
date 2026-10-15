// Pointer input. The overlay itself is `pointer-events: none`; these capture-phase listeners
// claim a pointer only when it lands on an opaque pixel of the current frame (alpha >= 64).
// Everywhere else, including transparent parts of the frame, the page receives events untouched.

import type { Overlay } from '../render/overlay';
import type { ClipPlayer } from '../render/clip-player';

export interface InputTarget {
  interactive(): boolean;
  canDrag(): boolean;
  dragStart(clientX: number, clientY: number): void;
  dragMove(clientX: number, clientY: number): void;
  dragEnd(): void;
  dragCancel(): void;
  click(): void;
  openMenu(x: number, y: number, fromKeyboard: boolean): void;
  menuOpen(): boolean;
}

const ALPHA_MIN = 64;
const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 550;

interface Gesture {
  id: number;
  type: string;
  x0: number;
  y0: number;
  dragging: boolean;
  longPress: number;
  menuOpened: boolean;
}

export class Input {
  private g: Gesture | null = null;
  private suppressClickUntil = 0;
  private hoverRaf = 0;
  private hovering = false;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly overlay: Overlay, private readonly player: ClipPlayer, private readonly target: InputTarget) {
    const on = (t: EventTarget, type: string, fn: EventListener, opts: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.offs.push(() => t.removeEventListener(type, fn, opts));
    };
    on(window, 'pointerdown', this.onDown as EventListener, { capture: true, passive: false });
    on(window, 'pointermove', this.onMove as EventListener, { capture: true, passive: true });
    on(window, 'pointerup', this.onUp as EventListener, { capture: true, passive: false });
    on(window, 'pointercancel', this.onCancel as EventListener, { capture: true, passive: true });
    on(window, 'click', this.onClick as EventListener, { capture: true, passive: false });
    on(window, 'contextmenu', this.onContext as EventListener, { capture: true, passive: false });
    // Stops the page from scrolling when a touch starts on the character (pointer events can't).
    on(window, 'touchstart', this.onTouchStart as EventListener, { capture: true, passive: false });
    on(window, 'blur', this.onCancel as EventListener, { passive: true });
    on(document, 'visibilitychange', (() => document.visibilityState === 'hidden' && this.onCancel()) as EventListener, { passive: true });
    on(overlay.host, 'lostpointercapture', this.onCancel as EventListener, { passive: true });
  }

  /** True when a viewport point is on an opaque pixel of the character. */
  hit(x: number, y: number): boolean {
    if (!this.target.interactive()) return false;
    const p = this.overlay.toFrame(x, y);
    if (!p) return false;
    const [fx, fy] = p;
    const [hx, hy, hw, hh] = this.overlay.hitRect();
    if (fx < hx || fy < hy || fx > hx + hw || fy > hy + hh) return false;
    return this.player.alphaAt(fx, fy) >= ALPHA_MIN;
  }

  get dragging(): boolean {
    return !!this.g?.dragging;
  }

  private claim(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private onDown = (e: PointerEvent) => {
    if (this.g) return;
    if (e.composedPath().includes(this.overlay.host)) return; // our own controls handle themselves
    if (e.button !== 0 || !e.isPrimary) return;
    if (!this.hit(e.clientX, e.clientY)) return;
    this.claim(e);
    this.g = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, dragging: false, longPress: 0, menuOpened: false };
    try {
      this.overlay.host.setPointerCapture(e.pointerId);
    } catch {
      /* window listeners still see the pointer while it stays in the window */
    }
    if (e.pointerType !== 'mouse') {
      const g = this.g;
      g.longPress = window.setTimeout(() => {
        if (this.g !== g || g.dragging) return;
        g.menuOpened = true;
        this.target.openMenu(g.x0, g.y0, false);
      }, LONG_PRESS_MS);
    }
  };

  private onMove = (e: PointerEvent) => {
    const g = this.g;
    if (g && e.pointerId === g.id) {
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_THRESHOLD || g.menuOpened) return;
        window.clearTimeout(g.longPress);
        if (!this.target.canDrag()) return;
        g.dragging = true;
        this.overlay.wrap.classList.add('dragging');
        window.addEventListener('keydown', this.onKey, true);
        // Grab at the press point, so the character doesn't jump by the drag threshold.
        this.target.dragStart(g.x0, g.y0);
      }
      this.target.dragMove(e.clientX, e.clientY);
      return;
    }
    if (e.pointerType !== 'mouse' || this.hoverRaf) return;
    const { clientX, clientY } = e;
    const path = e.composedPath();
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const over = path.includes(this.overlay.handle) || this.hit(clientX, clientY);
      if (over !== this.hovering) {
        this.hovering = over;
        this.overlay.wrap.classList.toggle('hover', over);
      }
    });
  };

  private onUp = (e: PointerEvent) => {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    this.claim(e);
    this.end();
    this.suppressClickUntil = performance.now() + 500;
    if (g.dragging) this.target.dragEnd();
    else if (!g.menuOpened) this.target.click();
  };

  private onClick = (e: MouseEvent) => {
    // The click that follows a press on the character must not reach the element underneath.
    if (performance.now() < this.suppressClickUntil) {
      this.suppressClickUntil = 0;
      this.claim(e);
    }
  };

  private onContext = (e: MouseEvent) => {
    if (e.composedPath().includes(this.overlay.host)) return;
    if (!this.hit(e.clientX, e.clientY)) return;
    this.claim(e);
    if (this.g?.menuOpened) return;
    this.target.openMenu(e.clientX, e.clientY, false);
  };

  private onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (e.touches.length === 1 && t && this.hit(t.clientX, t.clientY)) e.preventDefault();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.g?.dragging) {
      this.claim(e);
      this.onCancel();
    }
  };

  private onCancel = () => {
    const g = this.g;
    if (!g) return;
    this.end();
    if (g.dragging) this.target.dragCancel();
  };

  private end(): void {
    const g = this.g;
    if (!g) return;
    this.g = null;
    window.clearTimeout(g.longPress);
    window.removeEventListener('keydown', this.onKey, true);
    this.overlay.wrap.classList.remove('dragging');
    try {
      if (this.overlay.host.hasPointerCapture(g.id)) this.overlay.host.releasePointerCapture(g.id);
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    this.onCancel();
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    for (const off of this.offs.splice(0)) off();
  }
}
