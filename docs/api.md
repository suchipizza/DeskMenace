# JavaScript API

The classic bundles create `window.Gary`. The ES module exports the same functions, plus a default export:

```js
import Gary, { init, say, createGary } from 'gary.js';
```

One page instance shows at most one character. Calling `init()` again updates it instead of creating a second one.

| Member | Returns | Description |
|---|---|---|
| `ready` | `Promise<void>` | Resolves once the character has entered, or once it is clear it won't (disabled, removed by the visitor, failed). Never rejects |
| `init(config?)` | `Promise<void>` | Starts or reconfigures. Calls are serialised. A visitor's earlier removal is respected: `init()` won't bring the character back. Never rejects; problems arrive as `error` events |
| `say(textOrTag)` | `Promise<boolean>` | Shows a line, or a random line from `#pool`. Resolves `true` after the bubble has been shown, `false` if muted, removed, hidden tab, reduced to nothing, or busy with something more important (being removed) |
| `do(behaviour)` | `Promise<boolean>` | Runs `walk`, `idle`, `judge`, `say`, `react-clicks` or `leave`, or a [scene](configuration.md#scenes) by name. Resolves when it has finished. `false` for unknown, disabled or unavailable behaviours (for example `judge` on a character without a stare clip). `enter` and `drag` are driven by page load and the visitor |
| `mute()` / `unmute()` | — | Hides speech for this browser session. The character keeps moving |
| `dismiss()` | — | Same as the visitor choosing *Remove*: stored immediately, then the character walks off |
| `reset()` | — | Clears removal and mute and starts again. For demos, settings pages and your own "bring him back" button; never called automatically |
| `emit(name, detail?)` | — | Fires your `{ "on": "event", "event": name }` triggers. Stays in the page |
| `on(name, handler)` | `() => void` | Subscribes to an event; returns an unsubscribe function |
| `destroy()` | — | Removes the overlay, listeners, timers and decoded images. Keeps the visitor's preferences. `init()` can start again later |
| `version` | `string` | Engine version |

## Events

| Event | Detail | When |
|---|---|---|
| `ready` | — | The character has entered |
| `entered` | — | Same moment as `ready`, every time a character enters |
| `spoke` | the line (string) | A speech bubble was shown |
| `dismissed` | — | The visitor (or `dismiss()`) removed the character |
| `error` | `Error` | The manifest or an image failed to load, or the configuration was rejected |
| `state` | state name | Behaviour state changed: `loading`, `entering`, `idle`, `walking`, `judging`, `speaking`, `dragging`, `falling`, `leaving`, `dismissed`, `destroyed`, `failed` |

Handlers that throw don't affect the engine; the error is re-thrown asynchronously so it still shows in the console.

## Priorities

Behaviours interrupt each other by priority: removal > being dragged > falling > your API calls > page triggers > ambient behaviour. A request that is outranked resolves `false` instead of queueing. Every interrupted animation settles; nothing is left pending after `destroy()`.

## Multiple instances

`createGary()` returns an independent API object (used internally by the bundles). v1 is designed for one character per page; two instances would each add an overlay, which works but is not a supported scene.
