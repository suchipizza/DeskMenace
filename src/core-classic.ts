// gary.core.js — classic script, engine only. Starts automatically only when the page names a
// character (data-character, inline JSON or data-config). It contains no default character.

import { boot } from './boot/autostart';

declare global {
  interface Window {
    Gary?: import('./types').GaryAPI;
  }
}

if (typeof window !== 'undefined' && !window.Gary) window.Gary = boot(() => null);
