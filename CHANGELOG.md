# Changelog

## 0.1.0 — unreleased

First version.

- Classic (`gary.js`, `gary.core.js`) and ES module (`gary.mjs`) bundles from one engine, about 24 KB gzipped each.
- Sprite-atlas frame player: time-based, paints only when a frame changes, nothing in background tabs, bounded decoded memory.
- Behaviours: enter, walk, idle, judge, say, drag, react-clicks, leave.
- Speech bubbles, weighted line pools, `{variables}`, rate limits.
- Triggers: load, idle, hover, click (on an element or anywhere), visible, scroll, scrolling, near, exit, gary-click, time, event.
- Scenes: named step lists (`walkTo`, `play`, `say`, `wait`) played by triggers or `Gary.do(name)`, with escalation across repeated triggers.
- The character can stand on page elements (`surfaces`, `data-gary-surface`), follows them as the page scrolls and falls off when they leave; `pace` sets how busy ambient behaviour is.
- Presets: characters can ship ready-made packages for kinds of pages (`data-preset="404"`); Mugsy offers `404`, `personal`, `website` and `staging`.
- Accessible menu (mute, remove, credit), persistent removal, reduced-motion support.
- Character manifest `schemaVersion: 1` with JSON Schemas; Mugsy, a CC0 sample character.
- Sharper artwork on high-density screens: clips may offer several atlas sizes; the `quality` option picks automatically or forces the smallest or sharpest.
