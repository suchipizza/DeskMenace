// gary.js — classic script with zero-config default: if the page names no character, Gary is
// loaded from the characters/gary/ folder next to this script (so it works from a CDN, npm or a
// self-hosted copy without depending on the page's URL).

import { boot } from './boot/autostart';

declare global {
  interface Window {
    Gary?: import('./types').GaryAPI;
  }
}

const DEFAULT_MANIFEST = 'characters/gary/character.json';

function defaultCharacter(script: HTMLScriptElement | null): string | null {
  const src = script?.src;
  if (!src) return null;
  try {
    // dist/gary.js -> ../characters/gary/ (package layout); a flat copy also works.
    const base = new URL(src);
    const dir = base.pathname.endsWith('/dist/gary.js') || base.pathname.endsWith('/dist/gary.min.js') ? '../' : './';
    return new URL(dir + DEFAULT_MANIFEST, base).href;
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined' && !window.Gary) window.Gary = boot(defaultCharacter);
