# Assets and licensing

gary.js has two kinds of content with different licences. They live in different folders so it is always clear which is which.

| What | Where | Licence |
|---|---|---|
| Engine, bundles, TypeScript types | `src/`, `dist/` | [MIT](../LICENSE) |
| JSON Schemas, examples, tests, tooling | `schema/`, `examples/`, `tests/`, `scripts/` | [MIT](../LICENSE) |
| Mugsy, the sample character | `characters/sample/` | [CC0 1.0](../characters/sample/LICENSE.md) |
| Gary's artwork, lines and identity | `characters/gary/` | [Gary Asset Licence](../characters/gary/LICENSE.md). **Not MIT** |
| Your character | wherever you host it | Your choice, declared in your manifest's `licence` field |

## In practice

- You can use, modify and redistribute the engine under MIT, including commercially, with or without Gary.
- You can show Gary on any website, personal or commercial, through gary.js: from the npm package, a CDN, or a copy on your own server. You can change his lines and settings, compress or convert his images, and share screenshots, videos and ads of your site with him on it.
- You can't modify his artwork, use him outside gary.js (apps, videos starring him, stickers, merchandise), redistribute his files on their own, train AI on him or make look-alikes. The full terms are in [`characters/gary/LICENSE.md`](../characters/gary/LICENSE.md); for anything beyond them, ask.
- The structure of Gary's `character.json` and preset files is MIT: copy them as a template for your own character, with your own art and lines.
- `gary.core.js` and the ES module contain no reference to Gary and never download him. A site that uses only its own character uses only MIT code plus its own art.
- Mugsy is public domain: copy him, edit him, use him as the starting point for your own character.

## Contributions

Contributions to the engine, schemas, docs and examples are accepted under MIT (see [CONTRIBUTING.md](../CONTRIBUTING.md)). Changes to Gary's artwork are not accepted through pull requests. New characters are welcome as separate folders under a clear open licence (CC0, CC BY or MIT), with art you made yourself or have the right to share.
