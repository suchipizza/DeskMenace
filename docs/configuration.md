# Configuration

Configuration can come from four places. Later sources win:

1. Library defaults
2. Inline JSON: `<script type="application/json" data-gary-config>…</script>`
3. A JSON file named by `data-config="/gary.json"` on the script tag
4. `Gary.init(config)`

**Merging:** arrays (`packs`, `behaviours`, `triggers`) replace the earlier value. Objects (`lines`, `vars`, `limits`, `position`, `menu`) merge by key. Invalid fields are ignored with a console warning, so one typo never breaks your page. An unknown `schemaVersion` is an error and the character doesn't start. A JSON Schema is published at [`schema/config.schema.json`](../schema/config.schema.json).

```json
{
  "schemaVersion": 1,
  "character": "https://example.com/characters/mugsy/character.json",
  "behaviours": ["enter", "walk", "idle", "judge", "say", "drag", "react-clicks", "leave"],
  "packs": ["core", "boast"],
  "vars": { "owner": "Sam" },
  "lines": { "boast": ["{owner} built this. I supervised."] },
  "triggers": [
    { "on": "hover", "selector": "#projects a", "say": "#boast", "cooldown": 30 },
    { "on": "idle", "after": 20, "say": "#core" },
    { "on": "gary-click", "count": 3, "do": "react-clicks", "cooldown": 45 }
  ],
  "limits": { "minGapSeconds": 20, "maxLinesPerMinute": 2 },
  "position": { "side": "right" },
  "height": 280,
  "ambient": true,
  "announce": false,
  "menu": { "credit": { "label": "Made by Sam", "url": "https://example.com" } }
}
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` keeps the character off the page |
| `character` | Gary (`gary.js` only) | Manifest URL. Relative URLs resolve against the page |
| `behaviours` | all eight | Which behaviours may run (`behaviors` also works) |
| `packs` | `["core"]` | Line pools used for ambient chatter and `Gary.do('say')` |
| `lines` | — | Your own line pools. A pool here replaces the character's pool of the same name |
| `vars` | `{ "site": location.hostname }` | Values for `{name}` placeholders in lines |
| `triggers` | see below | Page triggers. Replaces the defaults |
| `limits.minGapSeconds` | `20` | Minimum time between automatic lines |
| `limits.maxLinesPerMinute` | `2` | Cap on automatic lines per minute |
| `position.side` | `"right"` | Side he enters from and starts on |
| `height` | character default | Rendered height in CSS px. He scales down on small screens |
| `ambient` | `true` | Random walks, stares, glances and chatter while idle |
| `quality` | `"auto"` | Artwork sharpness when the character offers several image sizes. `"auto"` loads sharper images on high-density screens (except on devices reporting less than 4 GB of memory), `"standard"` always the smallest, `"high"` always the sharpest. Sharper images download more and use more memory |
| `restAfter` | `30` | Seconds without mouse, keyboard, touch or scroll input after which the character freezes on its current frame to save CPU and battery. Any input wakes it instantly. `0` keeps it animating |
| `announce` | `false` | Announce speech bubbles to screen readers (polite live region) |
| `menu.credit` | character's credit | `{ label, url }` for the menu's credit link, or `false` to hide it |
| `zIndex` | `2147483000` | Stacking order of the overlay |

Lines from `Gary.say()` bypass the rate limits (you asked for them). Lines from triggers and ambient chatter respect them, and nothing is ever queued: a line that can't be shown now is dropped, so visitors returning to a background tab don't get a backlog.

## Lines

A pool is an array of strings or `{ "text": "…", "weight": 2 }` objects. Picks are weighted, the previous line of a pool is never repeated immediately, and a pool with one line always works. `{owner}`-style placeholders are replaced from `vars`; unknown placeholders are removed. Lines are always shown as plain text. HTML is never interpreted.

Gary's pools: `hello`, `core`, `idle`, `boast`, `roast`, `404`, `staging`, `status`, `hover`, `clicked`, `exit`, `leave`. The engine uses `hello`, `idle` and `exit` in the default triggers, `clicked` for `react-clicks` and `leave` when a visitor removes the character. A pool that doesn't exist is silently skipped.

## Triggers

| `on` | Fires when | Fields |
|---|---|---|
| `load` | `after` seconds after the character arrived | `after` |
| `idle` | the visitor hasn't moved, typed or scrolled for `after` seconds | `after` (default 30) |
| `hover` | the mouse enters an element matching `selector` | `selector` |
| `click` | an element matching `selector` is clicked | `selector` |
| `visible` | an element matching `selector` scrolls into view | `selector`, `threshold` (0–1) |
| `scroll` | the page is scrolled past `threshold` (0–1) of its height | `threshold` (default 0.5) |
| `exit` | the mouse leaves through the top of the window | — |
| `gary-click` | the character is clicked `count` times in quick succession | `count` |
| `time` | `after` seconds, then every `every` seconds | `after`, `every` |
| `event` | you call `Gary.emit(name)` | `event` |

Every rule needs `say` (a line or `#pool`) and/or `do` (a behaviour id), and may use `chance` (0–1), `cooldown` (seconds), `once` and `maxPerSession`. Hover and click listeners are delegated to the document, so elements added later still work. `visible` observes at most 100 elements present at start. A malformed selector is ignored with a warning.

Default triggers:

```json
[
  { "on": "load", "after": 1.5, "say": "#hello", "once": true },
  { "on": "idle", "after": 40, "say": "#idle", "cooldown": 90 },
  { "on": "exit", "say": "#exit", "maxPerSession": 1 }
]
```

Clicking the character three times runs `react-clicks` whenever that behaviour is enabled; you don't need a trigger for it.
