# Gary

The default gary.js character: a passive-aggressive coworker who walks onto your page and has opinions about it.

| Clip | Role | Notes |
|---|---|---|
| `stand` | `idle` | Loops; also the reduced-motion poster |
| `walk_right` | `walk.right` | `"mirror": true`, so he also walks left |
| `stare` | `judge` | One-shot |
| `look_cursor` | `judge.pointer` | One-shot, looks toward the pointer |
| `phone_check` | `idle.variant` | One-shot idle variant |
| `dragged` | `held` | Loops while dragged |
| `fall` | `drop` | One-shot after release |

Every clip comes in two sizes (`*.webp` and sharper `*@hd.webp` for high-density screens). Presets: `404`, `personal`, `website`, `staging` (see [configuration](../../docs/configuration.md)).

**Licence:** Gary's artwork, lines and identity are **not MIT**. They are under the [Gary Asset Licence](LICENSE.md): free to use on your websites through gary.js, but not to modify or reuse outside it. The structure of these JSON files is MIT, so you can copy them as a template for your own character.
