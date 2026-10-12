# Contributing to gary.js

Thanks for helping make websites slightly more passive-aggressive.

## Setup

```sh
npm install
npx playwright install chromium firefox webkit   # once, for browser tests
npm run build
npm run serve          # examples at http://127.0.0.1:8700/examples/
```

## Checks

| Command | What it runs |
|---|---|
| `npm run typecheck` | TypeScript, strict |
| `npm test` | Unit, schema, security and packaging tests (Vitest + happy-dom) |
| `npm run test:browser` | Real-browser tests in Chromium, Firefox and WebKit (Playwright) |
| `npm run budget` | Each bundle must stay under 30 KB gzipped |
| `npm run audit:private` | No local paths, secrets or unpublishable files in the tree |
| `npm run audit:pack` | The npm package contains only allowlisted files |
| `npm run ci` | Everything above except browser tests |

The test suite uses Mugsy, the sample character, and never needs any other artwork.

## Guidelines

- **Keep the engine character-agnostic.** No character names, file names or special cases in `src/`. If a behaviour needs art, it asks for a clip *role* and degrades gracefully when the role is missing.
- **Be a good guest on other people's pages.** No layout shift, no blocked clicks, no work in background tabs, no network requests beyond the character's files, no reading page content. New features need a test that proves it.
- **Text only.** Lines are always inserted with `textContent`.
- **Accessibility is not optional.** Anything visitors can do with a mouse must work with a keyboard and on touch, and reduced motion must stay still.
- **Small and dependency-free.** No runtime dependencies. Watch the budget.
- Keep pull requests focused and describe what you tested (browsers, devices).

## Characters

New characters are welcome as a folder with `character.json`, atlases and a `LICENSE.md` under an open licence (CC0, CC BY or MIT). Only submit art you created or have the right to share under that licence. Changes to Gary's artwork or lines are not accepted through pull requests.

## Licence

By contributing code, docs or examples you agree that your contribution is licensed under the [MIT licence](LICENSE).
