// Speech bubble. Text only (textContent), placed above the character's head anchor, kept inside
// the viewport, and never over a focused form field.

import type { Overlay } from '../render/overlay';

export class Bubble {
  readonly el: HTMLDivElement;
  private timer = 0;
  private fade = 0;
  private done: (() => void) | null = null;

  constructor(private readonly overlay: Overlay, private readonly anchor: [number, number], announce: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'bubble';
    this.el.hidden = true;
    if (announce) {
      this.el.setAttribute('role', 'status');
      this.el.setAttribute('aria-live', 'polite');
    } else this.el.setAttribute('aria-hidden', 'true');
    overlay.wrap.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /**
   * Shows a line. Resolves true when it has been shown and hidden again, false when it could
   * not be shown (it would cover a focused field) or was replaced.
   */
  show(text: string, durationMs = readingTime(text)): Promise<boolean> {
    this.hide();
    this.el.textContent = text;
    this.el.hidden = false;
    this.position();
    if (overlapsFocusedField(this.el.getBoundingClientRect())) {
      this.hide();
      return Promise.resolve(false);
    }
    void this.el.offsetWidth;
    this.el.classList.add('show');
    return new Promise<boolean>((resolve) => {
      this.done = () => resolve(true);
      this.timer = window.setTimeout(() => this.hide(), durationMs);
    });
  }

  /** Re-applies placement (after a resize or a move). */
  position(): void {
    if (this.el.hidden) return;
    const o = this.overlay;
    const idle = o.currentClip;
    const h = idle.h * o.scale;
    const ax = this.anchor[0] * idle.w * o.scale;
    const ay = this.anchor[1];
    const s = this.el.style;
    s.left = '0px';
    s.bottom = `${Math.round(h * (1 - ay) + 12)}px`;
    const bw = this.el.offsetWidth;
    const wrapLeft = o.box().left;
    const vw = o.viewportW;
    const want = wrapLeft + ax - bw / 2;
    const left = Math.min(Math.max(8, want), Math.max(8, vw - bw - 8));
    s.left = `${Math.round(left - wrapLeft)}px`;
    const tail = Math.min(Math.max(16, wrapLeft + ax - left), bw - 16);
    s.setProperty('--tail', `${Math.round(tail)}px`);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fade);
    this.el.classList.remove('show');
    this.el.hidden = true;
    this.el.textContent = '';
    const d = this.done;
    this.done = null;
    d?.();
  }

  dispose(): void {
    this.hide();
    this.el.remove();
  }
}

export function readingTime(text: string): number {
  return Math.min(9000, 2200 + text.length * 55);
}

function overlapsFocusedField(r: DOMRect): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return false;
  const editable = a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio'].includes((a as HTMLInputElement).type));
  if (!editable) return false;
  const f = a.getBoundingClientRect();
  return !(r.right < f.left || r.left > f.right || r.bottom < f.top || r.top > f.bottom);
}

export function focusedFieldRect(): DOMRect | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return null;
  const editable = a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.tagName === 'INPUT';
  return editable ? a.getBoundingClientRect() : null;
}
