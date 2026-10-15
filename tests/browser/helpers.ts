import type { Page } from '@playwright/test';

export const SAMPLE = '/characters/sample/character.json';
export const CROSS_SAMPLE = 'http://127.0.0.1:8711/characters/sample/character.json';
export const MINIMAL = '/tests/browser/fixtures/minimal/character.json';
export const QUIET = { ambient: false, triggers: [] };

export function surfacesUrl(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) p.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  return `/tests/browser/fixtures/surfaces.html?${p}`;
}

export function pageUrl(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) p.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  return `/tests/browser/fixtures/page.html?${p}`;
}

export async function waitState(page: Page, state: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction((s) => (window as any).Gary?._debug?.()?.state === s, state, { timeout });
}

/** Opens the test page with the sample character and waits until it is idle on screen. */
export async function boot(page: Page, q: Record<string, unknown> = {}): Promise<void> {
  await page.goto(pageUrl({ char: SAMPLE, cfg: QUIET, ...q }));
  await waitState(page, 'idle');
}

export function debug(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).Gary._debug());
}

export function canvasBox(page: Page) {
  return page.evaluate(() => {
    const h = document.querySelector('[data-garyjs]');
    const r = h!.shadowRoot!.querySelector('canvas')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

/** Finds an opaque point on the character and a transparent point inside its frame box. */
export function probePoints(page: Page) {
  return page.evaluate(() => {
    const G = (window as any).Gary;
    const h = document.querySelector('[data-garyjs]');
    const r = h!.shadowRoot!.querySelector('canvas')!.getBoundingClientRect();
    let opaque: { x: number; y: number } | null = null;
    let clear: { x: number; y: number } | null = null;
    // Prefer the body's centre for the opaque point.
    for (const [fx, fy] of [[0.5, 0.55], [0.5, 0.5], [0.45, 0.6], [0.55, 0.45]]) {
      const x = r.x + r.width * fx;
      const y = r.y + r.height * fy;
      if (G._hit(x, y)) { opaque = { x, y }; break; }
    }
    for (const [fx, fy] of [[0.03, 0.03], [0.97, 0.03], [0.03, 0.5], [0.97, 0.97], [0.03, 0.97]]) {
      const x = r.x + r.width * fx;
      const y = r.y + r.height * fy;
      if (x > 0 && y > 0 && x < innerWidth && y < innerHeight && !G._hit(x, y)) { clear = { x, y }; break; }
    }
    return { opaque, clear };
  });
}

/** Waits for the first error reported through Gary.on('error') and returns its message. */
export async function firstError(page: Page): Promise<string> {
  await page.waitForFunction(() => (window as any).__errors?.length > 0, null, { timeout: 15_000 });
  return page.evaluate(() => (window as any).__errors[0]);
}
