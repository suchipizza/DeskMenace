# Changelog

## 0.1.0 — unreleased

First version.

- Classic (`gary.js`, `gary.core.js`) and ES module (`gary.mjs`) bundles from one engine, about 20 KB gzipped each.
- Sprite-atlas frame player: time-based, paints only when a frame changes, nothing in background tabs, bounded decoded memory.
- Behaviours: enter, walk, idle, judge, say, drag, react-clicks, leave.
- Speech bubbles, weighted line pools, `{variables}`, rate limits.
- Triggers: load, idle, hover, click, visible, scroll, exit, gary-click, time, event.
- Accessible menu (mute, remove, credit), persistent removal, reduced-motion support.
- Character manifest `schemaVersion: 1` with JSON Schemas; Mugsy, a CC0 sample character.
- Sharper artwork on high-density screens: clips may offer several atlas sizes; the `quality` option picks automatically or forces the smallest or sharpest.
