# Assets and licensing

gary.js has two kinds of content with different licences. They live in different folders so it is always clear which is which.

| What | Where | Licence |
|---|---|---|
| Engine, bundles, TypeScript types | `src/`, `dist/` | [MIT](../LICENSE) |
| JSON Schemas, examples, tests, tooling | `schema/`, `examples/`, `tests/`, `scripts/` | [MIT](../LICENSE) |
| Mugsy, the sample character | `characters/sample/` | [CC0 1.0](../characters/sample/LICENSE.md) |
| Gary's artwork, name and lines | `characters/gary/` | Gary's own licence, shipped as `characters/gary/LICENSE.md`. **Not MIT** |
| Your character | wherever you host it | Your choice, declared in your manifest's `licence` field |

## In practice

- You can use, modify and redistribute the engine under MIT, including commercially, with or without Gary.
- Using Gary on your website through the published package or CDN is what his artwork licence is for. Read `characters/gary/LICENSE.md` for what it allows beyond that (for example, modifying or redistributing his artwork).
- `gary.core.js` and the ES module contain no reference to Gary and never download him. A site that uses only its own character uses only MIT code plus its own art.
- Mugsy is public domain: copy him, edit him, use him as the starting point for your own character.

## Contributions

Contributions to the engine, schemas, docs and examples are accepted under MIT (see [CONTRIBUTING.md](../CONTRIBUTING.md)). Changes to Gary's artwork are not accepted through pull requests. New characters are welcome as separate folders under a clear open licence (CC0, CC BY or MIT), with art you made yourself or have the right to share.
