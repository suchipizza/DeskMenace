// Character menu: Mute / Remove / credit link. Opened from the options button, a right-click or
// long-press on the character, or Enter / ContextMenu / Shift+F10 on the focused button.
// Arrow keys move, Escape closes and returns focus. Links open only on an explicit click.

import type { CreditLink } from '../types';
import type { Overlay } from '../render/overlay';

export interface MenuActions {
  isMuted(): boolean;
  toggleMute(): void;
  remove(): void;
}

export class Menu {
  readonly el: HTMLDivElement;
  private open = false;
  private returnFocus = false;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly overlay: Overlay, private readonly name: string, private readonly credit: CreditLink | null, private readonly actions: MenuActions) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.setAttribute('role', 'menu');
    this.el.setAttribute('aria-label', `${name} options`);
    this.el.hidden = true;
    overlay.root.append(this.el);

    const h = overlay.handle;
    const onHandleClick = () => (this.open ? this.close(true) : this.show(true));
    const onHandleKey = (e: KeyboardEvent) => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey) || e.key === 'ArrowDown') {
        e.preventDefault();
        this.show(true);
      }
    };
    h.addEventListener('click', onHandleClick);
    h.addEventListener('keydown', onHandleKey);
    this.el.addEventListener('keydown', this.onKey);
    this.offs.push(() => h.removeEventListener('click', onHandleClick), () => h.removeEventListener('keydown', onHandleKey), () => this.el.removeEventListener('keydown', this.onKey));
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens the menu next to the character. `fromKeyboard` focuses the first item. */
  show(fromKeyboard = false, at?: { x: number; y: number }): void {
    this.build();
    this.el.hidden = false;
    this.open = true;
    this.returnFocus = fromKeyboard;
    this.overlay.handle.setAttribute('aria-expanded', 'true');
    this.place(at);
    const first = this.items()[0];
    if (fromKeyboard) first?.focus();
    else first?.focus({ preventScroll: true });
    window.addEventListener('pointerdown', this.onOutside, true);
    window.addEventListener('blur', this.onBlur);
  }

  close(restoreFocus = this.returnFocus): void {
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    this.overlay.handle.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', this.onOutside, true);
    window.removeEventListener('blur', this.onBlur);
    if (restoreFocus && this.overlay.host.isConnected) this.overlay.handle.focus();
    else if (this.overlay.root.activeElement) (this.overlay.root.activeElement as HTMLElement).blur();
  }

  private build(): void {
    this.el.textContent = '';
    const muted = this.actions.isMuted();
    this.el.append(
      this.item(muted ? 'Unmute' : 'Mute', () => this.actions.toggleMute()),
      this.item(`Remove ${this.name}`, () => this.actions.remove(), false),
    );
    if (this.credit) {
      const a = document.createElement('a');
      a.setAttribute('role', 'menuitem');
      a.className = 'credit';
      a.href = this.credit.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = this.credit.label;
      a.tabIndex = -1;
      a.addEventListener('click', () => this.close(false));
      this.el.append(a);
    }
  }

  private item(label: string, run: () => void, restoreFocus = true): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    b.textContent = label;
    b.addEventListener('click', () => {
      this.close(restoreFocus && this.returnFocus);
      run();
    });
    return b;
  }

  private items(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }

  private place(at?: { x: number; y: number }): void {
    const vw = this.overlay.viewportW;
    const vh = this.overlay.viewportH;
    const mw = this.el.offsetWidth;
    const mh = this.el.offsetHeight;
    let x: number;
    let y: number;
    if (at) {
      x = at.x;
      y = at.y - mh;
    } else {
      const r = this.overlay.handle.getBoundingClientRect();
      x = r.right - mw;
      y = r.top - mh - 6;
      if (y < 8) y = r.bottom + 6;
    }
    this.el.style.left = `${Math.round(Math.min(Math.max(8, x), vw - mw - 8))}px`;
    this.el.style.top = `${Math.round(Math.min(Math.max(8, y), vh - mh - 8))}px`;
  }

  private onKey = (e: KeyboardEvent) => {
    const items = this.items();
    const i = items.indexOf(this.overlay.root.activeElement as HTMLElement);
    const go = (n: number) => items[(n + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        go(i + 1);
        break;
      case 'ArrowUp':
        go(i - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(items.length - 1);
        break;
      case 'Escape':
        this.close(true);
        break;
      case 'Tab':
        this.close(true);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  private onOutside = (e: Event) => {
    if (!e.composedPath().includes(this.el) && !e.composedPath().includes(this.overlay.handle)) this.close(false);
  };

  private onBlur = () => this.close(false);

  dispose(): void {
    this.close(false);
    for (const off of this.offs.splice(0)) off();
    this.el.remove();
  }
}
