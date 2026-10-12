# Character format

A character is a folder with a manifest (`character.json`) and one image per animation clip. The engine has no special knowledge of any character: Gary, the sample mug and your character are loaded the same way. The JSON Schema is [`schema/character.schema.json`](../schema/character.schema.json); [Mugsy](../characters/sample/) is a complete working example.

```
my-character/
  character.json
  atlas/idle.webp
  atlas/walk.webp
  …
```

## Clips are sprite atlases

Each clip is one image containing all its frames in a grid, left to right and top to bottom. All frames of a clip have the same size. WebP with alpha is recommended (PNG works too). Frame durations are listed individually, so clips can have uneven timing.

```json
"walk": {
  "role": "walk.right",
  "loop": true,
  "load": "initial",
  "mirror": true,
  "size": [150, 200],
  "anchor": { "feet": [0.5, 1.0] },
  "hit": [30, 20, 90, 180],
  "frameMs": [105, 105, 105, 105, 105, 105, 105, 105],
  "sources": [{ "type": "atlas", "url": "atlas/walk.webp", "grid": { "columns": 8, "rows": 1, "frames": 8 } }]
}
```

| Field | Required | Meaning |
|---|---|---|
| `role` | — | What the engine uses the clip for (see below). Clips without a known role are ignored by behaviours |
| `loop` | — | `true` for loops (idle, walk, held), `false` for one-shots (default) |
| `load` | — | `initial` clips load right after the page; `lazy` clips (default) load on first use |
| `mirror` | — | The clip may be flipped horizontally to stand in for the opposite walk direction. Only when your art is symmetric |
| `size` | ✓ | Frame size in image pixels `[width, height]` |
| `anchor.feet` | — | Where the feet touch the ground, normalised `[x, y]` within the frame (default `[0.5, 1]`) |
| `hit` | — | Coarse clickable rectangle in frame pixels `[x, y, w, h]`. x/y may be negative. Inside it, a pixel is "the character" if its alpha is at least 64 |
| `frameMs` | ✓ | Duration of each frame in milliseconds; its length must equal `grid.frames` |
| `durationMs` | — | Optional check: must equal the sum of `frameMs` |
| `sources` | ✓ | `[{ "type": "atlas", "url", "grid": { "columns", "rows", "frames" } }]`. URLs resolve against the manifest's own URL |

## Roles

| Role | Used by | Needed? |
|---|---|---|
| `idle` | standing still, the reduced-motion poster | **required** |
| `walk.left`, `walk.right` | entering, walking, leaving | recommended. One direction plus `"mirror": true` is enough |
| `judge` | `judge`, judgemental lines, `react-clicks` | optional |
| `judge.pointer` | `judge` (a look at the visitor's pointer) | optional |
| `idle.variant` | an occasional break from standing (`do('idle')`) | optional |
| `held` | looping while the visitor drags the character | optional (the idle frame is held instead) |
| `drop` | played once after the visitor lets go | optional |

Without walk clips, the character appears in place and never walks. Missing optional clips just switch off what needs them; `Gary.do()` resolves `false` for those.

## Character settings

```json
{
  "schemaVersion": 1,
  "id": "mugsy",
  "name": "Mugsy",
  "licence": { "name": "CC0-1.0", "url": "https://creativecommons.org/publicdomain/zero/1.0/" },
  "assetRevision": "1",
  "display": { "height": 170, "minHeight": 110, "walkSpeed": 70 },
  "poster": { "clip": "idle", "frame": 0 },
  "bubble": { "anchor": [0.5, 0.12] },
  "menu": { "credit": { "label": "Mugsy by Sam", "url": "https://example.com" } },
  "lines": { "core": ["Is it decaf? Be honest."] },
  "clips": { … }
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Always `1` |
| `id`, `name` | Identifier and display name (used in the menu: "Remove Mugsy") |
| `licence` | Licence of *your* artwork and lines. gary.js's MIT licence does not cover it |
| `assetRevision` | Your own version string for the artwork, independent of the engine version |
| `display.height` | Rendered height of the idle frame in CSS px (default 200). Scaled down on short or narrow screens, never below `minHeight` |
| `display.walkSpeed` | CSS px per second at `display.height`. Match it to the stride in your walk cycle so feet don't slide |
| `poster` | Still frame for reduced motion (default: frame 0 of the idle clip) |
| `bubble.anchor` | Point just above the head, normalised in the idle frame. The speech bubble's tail points here |
| `menu.credit` | Link shown in the character menu, or `null` for none. Defaults to "Powered by gary.js" |
| `lines` | Default line pools (see [configuration](configuration.md#lines)) |

## Making the art

- Draw or render each animation as frames on a transparent background, all the same size, with the feet on the same row.
- Pack them into a grid (any tool that makes sprite sheets works; Mugsy's [build script](../scripts/sample-character/build.py) shows one way with Pillow).
- Keep it light: the engine decodes each atlas into memory (`width × height × 4` bytes) and keeps at most three clips, within about 30 MB, at a time. 8–12 frames per second is plenty for this kind of character.
- Export the images at roughly 1–1.2× the displayed size for crisp results on high-DPI screens.

## Hosting

Serve the folder from any static host. If it is on a different origin from the page, send `Access-Control-Allow-Origin` (for example `*`) for the manifest and images. The page's CSP needs that origin in `connect-src`.
