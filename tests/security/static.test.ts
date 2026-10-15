// Static checks on the engine source: no dynamic code, no HTML sinks, no network calls other
// than fetching the configured character, no storage of visitor activity.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const src = files('src').map((f) => ({ f, text: readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '') }));

describe('engine source', () => {
  it.each([
    ['eval', /\beval\s*\(/],
    ['new Function', /new\s+Function\s*\(/],
    ['innerHTML/outerHTML', /\.(inner|outer)HTML\b/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\.write/],
    ['sendBeacon', /sendBeacon/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /WebSocket/],
    ['cookies', /document\.cookie/],
    ['clipboard', /clipboard/i],
    ['form values', /\.value\b/],
    ['page text', /\.(innerText|textContent)\b(?!\s*=[^=])/],
    ['navigation', /location\.(href\s*=|assign|replace)|window\.open\(/],
  ])('has no %s', (_name, re) => {
    const hits = src.filter(({ text }) => re.test(text)).map(({ f }) => f);
    if (_name === 'page text') {
      // textContent is only ever *assigned* (writing our own text) or read from our own inline config tag.
      expect(hits.filter((f) => !/autostart\.ts$/.test(f))).toEqual([]);
    } else expect(hits).toEqual([]);
  });

  it('only calls fetch in the player, the engine and the config loader', () => {
    const hits = src.filter(({ text }) => /\bfetch\s*\(/.test(text)).map(({ f }) => f.replace(/\\/g, '/'));
    expect(hits.sort()).toEqual(['src/boot/autostart.ts', 'src/render/clip-player.ts', 'src/runtime/engine.ts']);
  });

  it('never fetches with credentials', () => {
    for (const { text } of src) for (const m of text.matchAll(/\bfetch\((?!u, i\)|url: string)[^;]*\)/g)) expect(m[0]).toMatch(/credentials: 'omit'/);
  });

  it('contains no default character reference outside the classic zero-config entry', () => {
    const hits = src.filter(({ text }) => /characters\/gary/.test(text)).map(({ f }) => f.replace(/\\/g, '/'));
    expect(hits).toEqual(['src/classic.ts']);
  });
});
