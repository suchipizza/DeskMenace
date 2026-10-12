# Mugsy, the sample character

A small, public-domain character used by the examples and tests, and a template for your own.

| Clip | Role | Frames | Notes |
|---|---|---|---|
| `idle` | `idle` | 10 | Loops; also the reduced-motion poster |
| `walk` | `walk.right` | 8 | `"mirror": true`, so it also walks left |
| `judge` | `judge` | 12 | One-shot |
| `held` | `held` | 8 | Loops while dragged |
| `drop` | `drop` | 8 | One-shot after release |

Mugsy has no `judge.pointer` or `idle.variant` clip; the engine skips those parts of its behaviours.

Rebuild the artwork with `npm run sample:build` (Python 3 + Pillow). Licence: [CC0-1.0](LICENSE.md).
