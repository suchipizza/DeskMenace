# Getting started

## 1. Add the script

```html
<script defer src="https://cdn.jsdelivr.net/npm/gary.js@0.2.0/dist/gary.js"></script>
```

Put it in `<head>` or at the end of `<body>`. `defer` (or `async`, or injecting the tag later) all work. Gary waits until your page has painted and finished loading before he fetches any artwork, so he never slows down your first paint.

Always pin a version (`@0.2.0`) in production so an update can't change your site unannounced.

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

## 4. Optional: match your colours

Speech bubbles and the menu are light or dark following the visitor's system setting (`prefers-color-scheme`). If your site has its own colours, or its own dark-mode switch, set these CSS custom properties:

| Property | Used for |
|---|---|
| `--gary-surface` | Bubble and menu background |
| `--gary-text` | Bubble and menu text |
| `--gary-border` | Bubble and menu border |
| `--gary-hover` | Menu item under the pointer |
| `--gary-focus` | Keyboard focus ring |

Set them on `:root` (the `<html>` element), not on `body`: Gary is attached to `<html>`, so values set on `body` don't reach him.

```css
:root {
  --gary-surface: #fffdf8;
  --gary-text: #1a1d24;
  --gary-border: rgba(0, 0, 0, 0.16);
}
/* Your dark-mode switch, if you have one */
:root[data-theme="dark"] {
  --gary-surface: #20232b;
  --gary-text: #f2f2f4;
  --gary-border: rgba(255, 255, 255, 0.18);
  --gary-hover: rgba(255, 255, 255, 0.1);
}
```

## 5. Self-hosting

Copy `dist/gary.js` and the `characters/gary/` folder to your server with the same layout:

```
your-site/
  vendor/gary/dist/gary.js
  vendor/gary/characters/gary/character.json
  vendor/gary/characters/gary/atlas/*.webp
```

`gary.js` finds the default character relative to its own URL (`../characters/gary/` when the script sits in a `dist/` folder, otherwise `./characters/gary/`), so it works from a CDN, from `node_modules` or from your own server regardless of the page's URL.

## 6. Content Security Policy

gary.js uses no `eval` and no inline styles on your page (its styles live in a Shadow DOM). If you use a CSP:

- `script-src` must allow the script's origin.
- `connect-src` must allow the character's origin (the manifest and images are fetched with `fetch`).

If the character is served from another origin, that server must send `Access-Control-Allow-Origin`. CORS is also what lets the engine check the pixel under the pointer, so clicks pass through transparent areas. If anything is blocked, gary.js reports an `error` event, logs one console warning, and leaves your page alone.

## Frameworks

The script tag works wherever you can put a tag in the page. Tested with Astro 7, Next.js 16 and Vite 8:

- **Astro:** keep `defer` on the tag, or add `is:inline`. Astro bundles a `<script>` whose only attribute is `src`, and Gary then can't find his character. The `data-gary-config` JSON tag is left alone.

  ```astro
  <script defer src="https://cdn.jsdelivr.net/npm/gary.js@0.2.0/dist/gary.js" data-preset="personal"></script>
  ```

- **Next.js (App Router):** use `next/script` in `app/layout.tsx`. `data-preset` and the other attributes are passed through. Give the inline configuration as JSON:

  ```tsx
  import Script from "next/script";

  const garyConfig = { schemaVersion: 1, lines: { hello: ["Welcome. I'll be supervising."] } };

  export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en">
        <body>
          {children}
          <script type="application/json" data-gary-config dangerouslySetInnerHTML={{ __html: JSON.stringify(garyConfig) }} />
          <Script src="https://cdn.jsdelivr.net/npm/gary.js@0.2.0/dist/gary.js" strategy="afterInteractive" data-preset="website" />
        </body>
      </html>
    );
  }
  ```

- **Vite:** the tags work unchanged in `index.html`. To use the npm package instead, import the ES module and name the character, since artwork is never bundled:

  ```js
  import Gary from 'gary.js';

  Gary.init({
    character: 'https://cdn.jsdelivr.net/npm/gary.js@0.2.0/characters/gary/character.json',
    preset: 'website',
  });
  ```

## Troubleshooting

- **Nothing appears:** open the console for a `[gary.js]` warning. Common causes: the manifest URL is wrong, CORS headers are missing, or a visitor (you) removed him earlier. Run `Gary.reset()` in the console.
- **He's too big or small:** set `"height"` (CSS pixels) in the configuration.
- **He covers something important:** use `"position": { "side": "left" }`, or limit his walking with `"behaviours"`.
