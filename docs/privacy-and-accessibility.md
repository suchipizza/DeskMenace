# Privacy, security and accessibility

## What gary.js does not do

- No analytics, telemetry, beacons, cookies, fingerprinting or third-party scripts.
- No reading of form fields, page text, the clipboard or anything outside the page.
- No automatic navigation. The menu's credit link opens only when a visitor clicks it (`target="_blank"`, `rel="noopener noreferrer"`).
- No `eval`, no `new Function`, no HTML injection: every line is inserted with `textContent`.

## What it does

- Fetches the script and the **active character's** manifest and images (with `credentials: 'omit'`). Nothing else.
- Listens to pointer, keyboard, scroll and visibility events in the page to animate the character and run your triggers. These are handled in memory and immediately discarded.
- Stores two preferences on your origin: removal in `localStorage` (`gary.js:dismissed`) and mute in `sessionStorage` (`gary.js:muted`), plus small per-session counters for `once`/`maxPerSession` triggers. If storage is blocked, the preferences last for the current page only.

If you load a character from someone else's server, that server sees the requests for its files like any other image host. Choose sources you trust.

## Staying out of the way

- The overlay is a fixed, zero-size element at the end of the document with its own Shadow DOM: your CSS can't break it and its CSS can't touch your page. It reserves no space and causes no layout shift.
- Only opaque pixels of the current frame (and the small options button, when shown) receive the pointer. Everything else, including the transparent parts of the frame, clicks through to your page.
- A press on the character never reaches the element underneath: no accidental link clicks or form submissions, no focus change, no text selection. Pointer capture is used only while dragging.
- When a visitor focuses a text field the character overlaps, it steps aside; speech bubbles never cover a focused field.
- In a background tab nothing runs: no animation frames, no timers for animation, no queued speech.
- Global keyboard handling is limited to Escape while dragging. Menu keys are handled only inside the menu.

## Accessibility

- **Removal and mute are always reachable:** the options button (`⋯`) is in the tab order, appears on hover and focus, and opens with Enter, Space, Shift+F10 or the context-menu key. Right-click and touch long-press on the character open the same menu.
- **Menu:** `role="menu"`, arrow keys, Home/End, Escape and Tab close it and return focus to the button. Items are at least 40 px tall.
- **Reduced motion:** with `prefers-reduced-motion: reduce` the character appears in place as a still image, never walks, falls or animates, and dragging is disabled. Speech bubbles still work.
- **Screen readers:** the animation is `aria-hidden`; the button has a name ("Gary options"). Bubbles are not announced unless you set `"announce": true`, which makes them a polite live region.
- **Contrast and theming:** bubbles and the menu use readable light and dark defaults following `prefers-color-scheme`, and honour Windows high-contrast mode. To match your site's colours or its own dark-mode switch, set the `--gary-*` CSS custom properties: see [Getting started](getting-started.md#4-optional-match-your-colours).

## Reporting issues

See [SECURITY.md](../SECURITY.md).
