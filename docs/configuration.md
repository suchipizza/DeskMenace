# Configuration

Configuration can come from four places. Later sources win:

1. Library defaults
2. Inline JSON: `<script type="application/json" data-gary-config>…</script>`
3. A JSON file named by `data-config="/gary.json"` on the script tag
4. `Gary.init(config)`

A **preset** offered by the character (`data-preset="404"` on the script tag, or `"preset": "404"`) sits between 1 and 2: it supplies lines, scenes and triggers for a kind of page, and anything the page sets itself wins. See [Presets](#presets).

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
| `preset` | — | Name of a ready-made package offered by the character, e.g. `"404"`. Also `data-preset` on the script tag. See [Presets](#presets) |
| `behaviours` | all eight | Which behaviours may run (`behaviors` also works) |
| `packs` | `["core"]` | Line pools used for ambient chatter and `Gary.do('say')` |
| `lines` | — | Your own line pools. A pool here replaces the character's pool of the same name |
| `vars` | `{ "site": location.hostname }` | Values for `{name}` placeholders in lines |
| `triggers` | see below | Page triggers. Replaces the defaults |
| `scenes` | — | Named step lists that triggers and `Gary.do(name)` can play. See [Scenes](#scenes) |
| `surfaces` | — | CSS selector of page elements the character may wander onto and stand on, e.g. `"h1, h2, img"`. Elements with a `data-gary-surface` attribute always qualify. See [Standing on page elements](#standing-on-page-elements) |
| `limits.minGapSeconds` | `20` | Minimum time between automatic lines |
| `limits.maxLinesPerMinute` | `2` | Cap on automatic lines per minute |
| `position.side` | `"right"` | Side he enters from and starts on |
| `height` | character default | Rendered height in CSS px. He scales down on small screens |
| `ambient` | `true` | Random walks, stares, glances and chatter while idle |
| `pace` | `"normal"` | How often ambient behaviour happens: `"calm"`, `"normal"` or `"busy"` (wanders a lot) |
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
| `click` | an element matching `selector` is clicked; without `selector`, a click anywhere on the page (not on the character) | `selector` (optional) |
| `visible` | an element matching `selector` scrolls into view | `selector`, `threshold` (0–1) |
| `scroll` | the page is scrolled past `threshold` (0–1) of its height | `threshold` (default 0.5) |
| `exit` | the mouse leaves through the top of the window | — |
| `gary-click` | the character is clicked `count` times in quick succession | `count` |
| `time` | `after` seconds, then every `every` seconds | `after`, `every` |
| `event` | you call `Gary.emit(name)` | `event` |
| `scrolling` | the visitor starts scrolling: wheel, touch, scroll keys or any scroller moving. Fires once per gesture (a gesture ends after 0.6 s of quiet), also on pages too short to scroll | — |
| `near` | the mouse comes within `distance` CSS px of the character. Fires once per approach | `distance` (default 80) |

Every rule needs `say` (a line or `#pool`), `do` (a behaviour id) or `scene` (a scene name, or a list of them), and may use `chance` (0–1), `cooldown` (seconds), `once` and `maxPerSession`. Hover and click listeners are delegated to the document, so elements added later still work. `visible` observes at most 100 elements present at start. A malformed selector is ignored with a warning.

Default triggers:

```json
[
  { "on": "load", "after": 1.5, "say": "#hello", "once": true },
  { "on": "idle", "after": 40, "say": "#idle", "cooldown": 90 },
  { "on": "exit", "say": "#exit", "maxPerSession": 1 }
]
```

Clicking the character three times runs `react-clicks` whenever that behaviour is enabled; you don't need a trigger for it.

**Escalation.** With a list, `"scene": ["stare", "annoyed"]` plays `stare` the first time the rule fires, `annoyed` the second time, and `annoyed` again after that. Rules with the same `group` share one step, so a click and then a scroll count as the second annoyance. A scene started by a trigger never cuts into another scene that is already playing; it's simply skipped (and the step doesn't advance).

## Scenes

A scene is a short script: a list of steps, each with exactly one action.

```json
"scenes": {
  "arrive": [{ "walkTo": "[data-gary-404], h1", "at": "center" }, { "play": "judge" }, { "say": "#404" }],
  "annoyed": [{ "play": "judge" }, { "wait": 1 }, { "say": "#404-again" }]
}
```

| Step | Does |
|---|---|
| `walkTo` | Walks to an element and stands on it (see below), or `"floor"` to get back down. With a selector list, the first match that has room wins. `at`: `"center"` (default), `"left"`, `"right"` or `"random"` |
| `play` | Plays a clip by role once: `judge`, `judge.pointer`, `idle.variant`, … Skipped if the character has no such clip |
| `say` | Shows a line or `#pool` and waits until the bubble is gone. Respects mute; not counted against `limits` (use the rule's `cooldown`) |
| `wait` | Stands still for that many seconds (0–60) |

Play a scene from a trigger (`"scene": "arrive"`) or from code (`Gary.do('arrive')`). Scenes run at trigger priority: dragging or removing the character interrupts them. With reduced motion, `walkTo` steps are skipped and the rest still runs.

## Standing on page elements

The character can stand on the top edge of page elements: headings, images, cards. From the floor it walks below the spot and is lifted up in its "held" pose; getting down is a fall. While it stands on an element it moves with it as the page scrolls; if the element leaves the screen, or there is no longer room above it for the character's head, it falls back to the floor.

- A plain text element (a heading, a paragraph) counts only as wide as its text. An image, or an element with a background or border, counts with its whole box.
- An element qualifies when there is room above it for the whole character plus a speech bubble, and it isn't right at the bottom of the screen. Otherwise `walkTo` walks to the spot below it on the floor instead.
- Ambient wandering uses `surfaces` and elements marked `data-gary-surface`. Dropping the character above one of these (after a drag) lands it there.
- Nothing about the page changes: the character is still drawn in its own overlay, and clicks still pass through its transparent pixels.

## Presets

A preset is a ready-made package for a kind of page, shipped with the character: lines, scenes, triggers and a few options. Add one attribute:

```html
<script defer src="https://cdn.jsdelivr.net/npm/gary.js@0.1.0/dist/gary.js" data-preset="404"></script>
```

| Preset | For | What happens |
|---|---|---|
| `404` | error pages | Walks onto the element marked `data-gary-404` (or the first `h1`), stares, comments. Each click or scroll attempt makes him stare, then say something new |
| `personal` | personal sites, portfolios | Wanders busily over headings and pictures. When the visitor scrolls he stops, stares and comments. Reacts to `#projects` / `[data-gary-projects]` coming into view and to email links |
| `website` | any site | Wanders over headings and images, glances at the mouse when it comes close, comments on scrolling and now and then on clicks |
| `staging` | test servers | Inspects `[data-gary-staging]` (or the first `h1`), reminds everyone this isn't production |

Gary and Mugsy both offer these four. Anything you set yourself wins over the preset: your `triggers` replace the preset's, your `lines`, `vars` and `scenes` replace pools and scenes of the same name, and options such as `pace` or `limits.minGapSeconds` override the preset's value. To change one line pool of the `404` preset:

```html
<script type="application/json" data-gary-config>
{ "lines": { "404": ["This page has been reassigned to another team."] } }
</script>
<script defer src="…/gary.js" data-preset="404"></script>
```

Presets can set `lines`, `vars`, `packs`, `behaviours`, `triggers`, `scenes`, `surfaces`, `limits`, `ambient`, `pace`, `restAfter` and `position`. Character authors: see [presets in the character format](character-format.md#presets).
