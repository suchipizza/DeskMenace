// Styles live inside the shadow root, so they never touch the host page and host styles
// cannot reach in (except CSS custom properties, which are used on purpose as theme tokens).

export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.char {
  position: fixed; left: 0; bottom: env(safe-area-inset-bottom, 0px); width: 0; height: 0;
  transform: translate3d(0, 0, 0); will-change: transform;
  pointer-events: none;
}
.char[data-hidden] { visibility: hidden; }
.char.dragging { cursor: grabbing; }
canvas {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  pointer-events: none; image-rendering: auto;
}
canvas.mirrored { transform: scaleX(-1); }
.handle {
  position: absolute; width: 28px; height: 28px; padding: 0; margin: 0;
  border-radius: 14px; border: 1px solid var(--gary-border, rgba(0,0,0,.18));
  background: var(--gary-surface, #fff); color: var(--gary-text, #1d1d1f);
  font: 700 16px/1 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: 1px;
  box-shadow: 0 1px 4px rgba(0,0,0,.18); cursor: pointer;
  opacity: 0; pointer-events: none; transition: opacity .15s ease;
}
.char.hover .handle, .handle:focus-visible, .handle[aria-expanded="true"] { opacity: 1; pointer-events: auto; }
.handle:focus-visible { outline: 3px solid var(--gary-focus, #2563eb); outline-offset: 2px; }
.bubble {
  position: absolute; max-width: min(260px, calc(100vw - 24px)); width: max-content;
  padding: 10px 13px; border-radius: 14px;
  background: var(--gary-surface, #fff); color: var(--gary-text, #1d1d1f);
  border: 1px solid var(--gary-border, rgba(0,0,0,.16));
  box-shadow: 0 4px 16px rgba(0,0,0,.16);
  font: 500 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow-wrap: anywhere; white-space: pre-line; text-align: left;
  pointer-events: none; opacity: 0; transform: translateY(4px);
  transition: opacity .18s ease, transform .18s ease;
}
.bubble.show { opacity: 1; transform: none; }
.bubble::after {
  content: ""; position: absolute; bottom: -7px; left: var(--tail, 50%);
  width: 12px; height: 12px; margin-left: -6px; transform: rotate(45deg);
  background: inherit; border-right: inherit; border-bottom: inherit;
}
.menu {
  position: fixed; min-width: 168px; padding: 6px; margin: 0; list-style: none;
  background: var(--gary-surface, #fff); color: var(--gary-text, #1d1d1f);
  border: 1px solid var(--gary-border, rgba(0,0,0,.16)); border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,.22); pointer-events: auto;
  font: 500 14px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.menu[hidden] { display: none; }
.menu [role="menuitem"] {
  display: block; width: 100%; min-height: 40px; padding: 10px 12px; margin: 0;
  border: 0; border-radius: 8px; background: transparent; color: inherit;
  font: inherit; text-align: left; text-decoration: none; cursor: pointer;
}
.menu [role="menuitem"]:hover, .menu [role="menuitem"]:focus { background: var(--gary-hover, rgba(0,0,0,.07)); outline: none; }
.menu [role="menuitem"]:focus-visible { outline: 2px solid var(--gary-focus, #2563eb); outline-offset: -2px; }
.menu .credit { font-size: 12px; opacity: .8; }
@media (prefers-color-scheme: dark) {
  .bubble, .menu, .handle {
    background: var(--gary-surface, #232326); color: var(--gary-text, #f2f2f4);
    border-color: var(--gary-border, rgba(255,255,255,.18));
  }
  .menu [role="menuitem"]:hover, .menu [role="menuitem"]:focus { background: var(--gary-hover, rgba(255,255,255,.1)); }
}
@media (prefers-reduced-motion: reduce) {
  .bubble, .handle { transition: none; }
}
@media (forced-colors: active) {
  .bubble, .menu, .handle { border: 1px solid CanvasText; }
}
`;
