# Getting started

## 1. Add the script

```html
<script defer src="https://cdn.jsdelivr.net/npm/gary.js@0.1.0/dist/gary.js"></script>
```

Put it in `<head>` or at the end of `<body>`. `defer` (or `async`, or injecting the tag later) all work. Gary waits until your page has painted and finished loading before he fetches any artwork, so he never slows down your first paint.

Always pin a version (`@0.1.0`) in production so an update can't change your site unannounced.

## 2. Pick a bundle

| File | Use it when |
|---|---|
| `dist/gary.js` | Classic script, starts Gary with no configuration |
| `dist/gary.core.js` | Classic script, engine only. Starts when the page names a character (`data-character`) |
| `dist/gary.mjs` | ES module (`import Gary from 'gary.js'`). Never starts on its own; call `init()` |

All three are the same engine (about 26 KB gzipped). Character artwork is never bundled into the JavaScript; it is fetched from the character's folder.

## 3. Optional: configure

The script tag accepts:

| Attribute | Meaning |
|---|---|
| `data-character="…/character.json"` | Use this character instead of the default |
| `data-config="/gary.json"` | Load configuration from a JSON file |
| `data-autostart="false"` | Don't start until you call `Gary.init()` |

Or add inline JSON: `<script type="application/json" data-gary-config>{ … }</script>`. See [configuration.md](configuration.md).

## 4. Self-hosting

Copy `dist/gary.js` and the `characters/gary/` folder to your server with the same layout:

```
your-site/
  vendor/gary/dist/gary.js
  vendor/gary/characters/gary/character.json
  vendor/gary/characters/gary/atlas/*.webp
```

`gary.js` finds the default character relative to its own URL (`../characters/gary/` when the script sits in a `dist/` folder, otherwise `./characters/gary/`), so it works from a CDN, from `node_modules` or from your own server regardless of the page's URL.

## 5. Content Security Policy

gary.js uses no `eval` and no inline styles on your page (its styles live in a Shadow DOM). If you use a CSP:

- `script-src` must allow the script's origin.
- `connect-src` must allow the character's origin (the manifest and images are fetched with `fetch`).

If the character is served from another origin, that server must send `Access-Control-Allow-Origin`. CORS is also what lets the engine check the pixel under the pointer, so clicks pass through transparent areas. If anything is blocked, gary.js reports an `error` event, logs one console warning, and leaves your page alone.

## Troubleshooting

- **Nothing appears:** open the console for a `[gary.js]` warning. Common causes: the manifest URL is wrong, CORS headers are missing, or a visitor (you) removed him earlier. Run `Gary.reset()` in the console.
- **He's too big or small:** set `"height"` (CSS pixels) in the configuration.
- **He covers something important:** use `"position": { "side": "left" }`, or limit his walking with `"behaviours"`.
