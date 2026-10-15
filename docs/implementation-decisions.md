# Implementation decisions

Short records of engineering choices, so contributors know why things are the way they are.

### Sprite atlases on a canvas, not animated images

Each clip is one still image holding all frames, decoded once with `createImageBitmap()` and drawn frame by frame onto a single `<canvas>`. Compared with animated GIF/WebP in an `<img>`, this gives exact control: pause on the current frame and resume from it, restart at frame 0, time-accurate one-shots, a promise that settles when a clip ends or is interrupted, and a way to read the alpha of the frame under the pointer. Still-image atlases are also smaller than the same frames as an animated WebP. Transparent video was rejected because alpha video needs different codecs per browser and gives no frame-exact control.

### A sleeping scheduler, not a requestAnimationFrame loop

Characters animate at 8–12 fps. A bare `requestAnimationFrame` loop would wake the page 60–120 times a second for nothing, so the player sleeps on a timer until shortly before the next frame boundary and then paints in a single animation frame. It paints only when the frame index changes. Playback is time-based, so a slow frame never stretches a clip. While the document is hidden nothing is scheduled or painted, and on return the clock resumes without catching up.

Measured idle cost in headless Chromium 145 (60 s, Apple M-series laptop, process CPU as a percentage of one core): blank page 0.03 % renderer; Mugsy (150 × 200 frames, ~6 fps) 1.3 % renderer + 1.6 % GPU; a 219 × 360, 12 fps character 2.6 % renderer + 2.7 % GPU. In a bounded comparison with the same character, CSS `background-position` stepping cost more (3.8 % renderer) and an `OffscreenCanvas` worker cost less on the renderer (1.5 %) with the same GPU cost. The worker approach is not used yet because it complicates alpha hit testing and older Safari support; it remains an option.

### Rest mode

Even a sleeping scheduler costs a few percent of a core while it animates. When the visitor hasn't used the mouse, keyboard, touch or scroll for 30 seconds (`restAfter`), the character holds its current frame and stops ambient behaviour; the first input resumes it from the same frame. Nobody is looking at an idle character on a page left open in the background, so this saves CPU and battery without a visible difference. It was preferred over moving rendering to an `OffscreenCanvas` worker, which saves about one point while the character is watched but needs a second copy of every decoded frame for pixel-accurate click-through.

### Sharper atlases only where they show

A character may offer the same frames at several resolutions. The player loads one per clip: the smallest whose density covers display size × `devicePixelRatio`, falling back to less sharp ones if a request fails. The canvas backing store takes the atlas cell size, so a 2× atlas is drawn 1:1 on a 2× screen instead of being stretched. Hit testing maps frame coordinates into the chosen atlas. Measured in headless Chromium 145 on a 2× screen with a 219 × 360 character displayed 320 px tall: the 360 px atlases cost 2.7 % renderer + 2.75 % GPU and 20.5 MB decoded (idle + walk); 640 px atlases 3.3 % + 2.7 % and 64.6 MB. Because of the memory, the decoded budget scales with density², and `auto` stays on the smallest atlases when `navigator.deviceMemory` reports under 4 GB.

### Standing on page elements

The overlay stays a fixed, zero-size layer. "Standing on" an element only means the character's feet line is the element's top edge (the text's own extent for plain text elements) instead of the viewport bottom, read with `getBoundingClientRect()` when it moves and on scroll (one read per animation frame, only while it stands on something). Walking onto an element at another height, or to a point in the middle of the screen, is the same compositor transition as walking along the floor, just diagonal; the only non-walking movement is a fall (a Web Animation), when an element leaves the screen or after a drag. The page's layout is never touched. The character only uses an element with room for its whole height and a speech bubble above it; otherwise it walks to the spot below it, which keeps it fully visible on short screens and phones. Following the element is done in JavaScript: on scroll (one measurement per animation frame), on layout changes (a `ResizeObserver` on the document and the element) and once a second while it stands on something, for moves that neither scroll nor resize anything. Expect up to a frame of lag while scrolling, a little more during momentum scrolling on iOS, and up to a second for CSS-only moves. An element that disappears drops the character to the floor.

### Presets belong to the character

Ready-made packages for kinds of pages (404, personal site, any site, staging) are JSON files listed in the character manifest, not code in the engine. Their lines are the character's writing and stay under its licence, any character can offer its own, and the engine only grows by the generic parts: scenes, surfaces, escalation and two triggers (about 4 KB gzipped). A preset is a configuration layer under the page's own options, so a site can change one line pool without copying the rest.

### Bounded decoded memory

Decoded atlases are RGBA bitmaps (`width × height × 4` bytes). The player keeps at most three clips and at most 30 MB resident (times density² when sharper atlases are loaded), always keeping the idle clip and the clip on screen, and calls `ImageBitmap.close()` on eviction and disposal. Concurrent loads of a clip share one request; stale loads are discarded with a generation counter and aborted on disposal.

### Click-through by pixel alpha

The overlay is `pointer-events: none`. Capture-phase listeners on `window` claim a press only if it lands inside the clip's hit rectangle **and** the current frame's alpha at that point is at least 64. Transparent pixels never block the page. This requires character images to be CORS-clean (same origin, or `Access-Control-Allow-Origin`); without CORS the manifest fetch fails anyway.

### Compositor-driven walking

Horizontal movement is a CSS `transform` transition on the character's wrapper, not JavaScript per frame. Interrupting a walk reads the current transform and freezes there.

### Start after the host page

Nothing is fetched until first contentful paint, the `load` event, an animation frame and an idle period have passed (with a 5 s fallback when Paint Timing is unavailable). The canvas starts at 0 × 0 and is sized before its first paint, and the overlay is a fixed, zero-size host, so the character causes no layout shift.

### Behaviour priorities

Behaviours run one at a time with a priority: removal > dragging > falling > API calls > page triggers > ambient. Lower-priority requests are refused rather than queued, so nothing piles up. Removal is written to storage before the exit animation starts, so navigating away mid-animation can't bring the character back.

### Manifests are validated, never trusted

Every manifest and configuration field is checked. URLs are resolved against the manifest's own URL and must be http(s). Pool and clip names can't be `__proto__` and friends, and pools are stored in `Map`s. Invalid configuration fields are ignored with a warning; an invalid manifest or an unsupported `schemaVersion` stops that character with an `error` event and leaves the page untouched.

### One engine, three bundles

`gary.js`, `gary.core.js` and `gary.mjs` are built by esbuild from the same source. Only the classic `gary.js` entry knows the default character's location, which it resolves relative to its own script URL. The core and module builds contain no default character and never request one.

### Display size is the frame height

`display.height` is the rendered height of the idle clip's frame box in CSS pixels, not the height of the drawn body inside it. On viewports shorter than 2.5× that height, or narrower than 600 px, the character is scaled down, never below `display.minHeight`.
