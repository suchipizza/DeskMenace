# Changelog

## 0.2.0 — 2026-10-18

Added

- `addTriggers`: rules added after the default triggers, or the preset's, instead of replacing the whole list.
- Getting started: matching your colours with the `--gary-*` CSS properties, and notes for Astro, Next.js and Vite.
- The docs link to each character's preset files.

Changed

- A scene's lines (including the entrance) are always shown and no longer count towards `limits.maxLinesPerMinute`. The next automatic line still waits `limits.minGapSeconds` after them. Before, a talkative entrance could use up the whole budget, and a line in a scene started by a trigger could be skipped.
- The `personal` preset no longer contains the two rules written for the demo profile (`data-gary-stealth`, `data-gary-visionary`); the example page adds them with `addTriggers`.

Fixed

- A `visible` rule whose element comes into view while the character is busy (in a scene, or just after a line) is retried while the element stays in view, instead of being missed until it scrolls in again.
- `package-lock.json` matches `package.json` again (the licence field), so `npm install` no longer edits it on a fresh clone. CI now checks this.

## 0.1.0 — 2026-10-17

First version.

- Classic (`gary.js`, `gary.core.js`) and ES module (`gary.mjs`) bundles from one engine, about 26 KB gzipped each.
- Sprite-atlas frame player: time-based, paints only when a frame changes, nothing in background tabs, bounded decoded memory.
- Behaviours: enter, walk, idle, judge, say, drag, react-clicks, leave.
- Speech bubbles, weighted line pools, pools said in order (`inOrder`), `{variables}`, rate limits.
- Triggers: load, idle, hover, click (on an element or anywhere), visible, scroll, scrolling, near, drag, exit, gary-click, time, event.
- Scenes: named step lists (`enter`, `walkTo` an element or a point, `play`, `say`, `wait`, `exit`) played as the `entrance`, by triggers or `Gary.do(name)`, with escalation across repeated triggers, remarks `during` a scene, and an `interrupted` line after which a dragged scene carries on.
- `dropTo: "here"` lands the character where it is dropped; `position.y` and `position.x` set the entrance height and the band for ambient walks.
- The character can stand on page elements (`surfaces`, `data-gary-surface`), follows them as the page scrolls and falls off when they leave; `pace` sets how busy ambient behaviour is.
- Presets: characters can ship ready-made packages for kinds of pages (`data-preset="404"`); Gary and Mugsy each offer `404`, `personal`, `website` and `staging`.
- Four example pages: a 404, a personal site, a coffee blog with Mugsy, and an AI product page.
- Accessible menu (mute, remove, credit), persistent removal, reduced-motion support.
- Gary, the default character, loaded by `gary.js`, under the Gary Asset Licence.
- Character manifest `schemaVersion: 1` with JSON Schemas; Mugsy, a CC0 sample character.
- Sharper artwork on high-density screens: clips may offer several atlas sizes; the `quality` option picks automatically or forces the smallest or sharpest.
