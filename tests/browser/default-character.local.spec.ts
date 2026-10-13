// Checks for the default character's artwork. Runs only when a local copy is provided:
//   GARY_ASSET_DIR=/path/to/gary npx playwright test default-character
// The artwork is not part of this repository, so CI skips these tests.
import { expect, test } from '@playwright/test';
import { canvasBox, debug, pageUrl, probePoints, QUIET, waitState } from './helpers';

test.skip(!process.env.GARY_ASSET_DIR, 'GARY_ASSET_DIR not set');
test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

const EXPECTED_ROLES: Record<string, string> = {
  stand: 'idle',
  walk_right: 'walk.right',
  stare: 'judge',
  look_cursor: 'judge.pointer',
  phone_check: 'idle.variant',
  dragged: 'held',
  fall: 'drop',
};

test('zero-config: one script tag, default character enters and idles at 320 px', async ({ page }) => {
  const bytes: Record<string, number> = {};
  page.on('response', async (r) => {
    if (r.url().endsWith('.webp')) bytes[new URL(r.url()).pathname.split('/').pop()!] = (await r.body()).length;
  });
  await page.goto(pageUrl({ bundle: 'classic' }));
  await waitState(page, 'idle', 20_000);
  const d = await debug(page);
  expect(d.character).toBe('gary');
  const box = await canvasBox(page);
  expect(Math.round(box.h)).toBe(320);
  // Only the initial clips were fetched up front.
  await page.waitForTimeout(500);
  expect(Object.keys(bytes).sort()).toEqual(['stand.webp', 'walk_right.webp']);
});

test.describe('on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2 });
  test('loads the HD atlases and draws them 1:1', async ({ page }) => {
    const files: string[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('.webp')) files.push(new URL(r.url()).pathname.split('/').pop()!);
    });
    await page.goto(pageUrl({ bundle: 'classic' }));
    await waitState(page, 'idle', 20_000);
    await page.waitForTimeout(500);
    expect(files.sort()).toEqual(['stand@hd.webp', 'walk_right@hd.webp']);
    const backing = await page.evaluate(() => {
      const c = (document.querySelector('[data-garyjs]') as any)?.shadowRoot?.querySelector('canvas') as HTMLCanvasElement;
      return [c.width, c.height, c.getBoundingClientRect().height];
    });
    expect(backing).toEqual([389, 640, 320]);
  });

  test('quality "standard" keeps the small atlases', async ({ page }) => {
    const files: string[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('.webp')) files.push(new URL(r.url()).pathname.split('/').pop()!);
    });
    await page.goto(pageUrl({ bundle: 'classic', cfg: { schemaVersion: 1, quality: 'standard' } }));
    await waitState(page, 'idle', 20_000);
    await page.waitForTimeout(500);
    expect(files.sort()).toEqual(['stand.webp', 'walk_right.webp']);
  });
});

test('manifest contains the approved clips; the left walk mirrors the right walk', async ({ request }) => {
  const m = await (await request.get('/characters/gary/character.json')).json();
  const roles = Object.fromEntries(Object.entries(m.clips).map(([k, v]: [string, any]) => [k, v.role]));
  expect(roles).toEqual(EXPECTED_ROLES);
  for (const [k, c] of Object.entries<any>(m.clips)) expect(c.mirror ?? false).toBe(k === 'walk_right');
  for (const c of Object.values<any>(m.clips)) expect(c.sources.map((s: any) => s.size?.[1] ?? c.size[1])).toEqual([360, 640]);
  expect(m.display.height).toBe(320);
});

test('all behaviours run on the default character', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(pageUrl({ bundle: 'classic', cfg: QUIET }));
  await waitState(page, 'idle', 20_000);
  const G = (fn: string) => page.evaluate((f) => (window as any).Gary.do(f), fn);
  // Record every clip shown, sampled inside the page.
  await page.evaluate(() => {
    const w = window as any;
    w.__clips = new Set();
    w.__rec = setInterval(() => {
      const c = w.Gary._debug()?.frame?.clip;
      if (c) w.__clips.add(c);
    }, 20);
  });
  const seen = () => page.evaluate(() => [...(window as any).__clips] as string[]);
  // judge picks the stare or the pointer inspection at random
  for (let i = 0; i < 12 && !((await seen()).includes('stare') && (await seen()).includes('look_cursor')); i++) expect(await G('judge')).toBe(true);
  expect(await G('idle')).toBe(true); // phone glance variant
  expect(await G('walk')).toBe(true);
  expect(await G('walk')).toBe(true);
  // drag + drop
  const { opaque } = await probePoints(page);
  await page.mouse.move(opaque!.x, opaque!.y);
  await page.mouse.down();
  await page.mouse.move(opaque!.x - 40, opaque!.y - 140, { steps: 6 });
  await waitState(page, 'dragging');
  await page.waitForTimeout(400);
  await page.mouse.up();
  await waitState(page, 'idle', 10_000);
  await page.waitForTimeout(200);
  const clips = await seen();
  for (const c of ['stand', 'stare', 'look_cursor', 'phone_check', 'dragged', 'fall']) expect(clips).toContain(c);
  expect(clips).toContain('walk_right');
  const d = await debug(page);
  const density = Math.max(1, ...Object.values<number>(d.player.density));
  expect(d.player.rgbaBytes).toBeLessThanOrEqual(30 * 1024 * 1024 * density * density);
  expect(d.frame.mirrored).toBe(false);
});

test('the 404 example: in from the left, onto the 404, the line, a remark if clicked, off to the right', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    (window as any).__spoke = [];
    const iv = setInterval(() => {
      const G = (window as any).Gary;
      if (G?.on) {
        clearInterval(iv);
        G.on('spoke', (l: string) => (window as any).__spoke.push(l));
      }
    }, 20);
  });
  await page.goto('/examples/404/');
  await page.waitForFunction(() => (window as any).Gary?._debug?.()?.state === 'walking', null, { timeout: 20_000 });
  const b = await canvasBox(page);
  expect(b.x).toBeLessThan(200);
  // A click while he walks in: a remark, and the walk goes on.
  await page.mouse.click(1200, 60);
  await page.waitForFunction(() => (window as any).__spoke.length === 1, null, { timeout: 10_000 });
  const preset = await (await page.request.get('/characters/gary/presets/404.json')).json();
  expect(preset.lines['keep-going']).toContain((await page.evaluate(() => (window as any).__spoke))[0]);
  await page.waitForFunction(() => (window as any).__spoke.includes('They should have leveraged AI.'), null, { timeout: 40_000 });
  expect((await debug(page)).surface).toBe('h1');
  await waitState(page, 'away', 40_000);
  expect((await canvasBox(page)).x).toBeGreaterThan(1280);
});

test('the personal example: the inspection script in order', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    (window as any).__spoke = [];
    const iv = setInterval(() => {
      const G = (window as any).Gary;
      if (G?.on) {
        clearInterval(iv);
        G.on('spoke', (l: string) => (window as any).__spoke.push(l));
      }
    }, 20);
  });
  await page.goto('/examples/personal/');
  await page.waitForFunction(() => (window as any).__spoke.length >= 3, null, { timeout: 60_000 });
  const spoke: string[] = await page.evaluate(() => (window as any).__spoke);
  const preset = await (await page.request.get('/characters/gary/presets/personal.json')).json();
  expect(preset.lines.bio).toContain(spoke[0]);
  expect(spoke[1]).toBe('They should have leveraged AI on this.');
  expect(spoke[2]).toMatch(/^Check out my profile/);
  const d = await debug(page);
  expect(d.feetX / 1280).toBeGreaterThan(0.15);
});
