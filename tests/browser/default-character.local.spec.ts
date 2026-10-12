// Checks for the default character's artwork. Runs only when a local copy is provided:
//   GARY_ASSET_DIR=/path/to/gary npx playwright test default-character
// The artwork is not part of this repository, so CI skips these tests.
import { expect, test } from '@playwright/test';
import { canvasBox, debug, pageUrl, probePoints, QUIET, waitState } from './helpers';

test.skip(!process.env.GARY_ASSET_DIR, 'GARY_ASSET_DIR not set');
test.use({ viewport: { width: 1280, height: 900 } });

const EXPECTED_ROLES: Record<string, string> = {
  stand: 'idle',
  walk_left: 'walk.left',
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
  expect(Object.keys(bytes).sort()).toEqual(['stand.webp', 'walk_left.webp', 'walk_right.webp']);
});

test('manifest contains exactly the eight approved clips and roles', async ({ request }) => {
  const m = await (await request.get('/characters/gary/character.json')).json();
  const roles = Object.fromEntries(Object.entries(m.clips).map(([k, v]: [string, any]) => [k, v.role]));
  expect(roles).toEqual(EXPECTED_ROLES);
  for (const c of Object.values<any>(m.clips)) expect(c.mirror ?? false).toBe(false);
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
  expect(clips.some((c) => c === 'walk_left' || c === 'walk_right')).toBe(true);
  const d = await debug(page);
  expect(d.player.rgbaBytes).toBeLessThanOrEqual(30 * 1024 * 1024);
  expect(d.frame.mirrored).toBe(false);
});
