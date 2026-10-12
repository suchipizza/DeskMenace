import { expect, test } from '@playwright/test';
import { boot, canvasBox, CROSS_SAMPLE, debug, firstError, MINIMAL, pageUrl, probePoints, QUIET, SAMPLE, waitState } from './helpers';

test.describe('loading and isolation', () => {
  test('custom character from another origin enters and idles; no other character is requested', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(pageUrl({ char: CROSS_SAMPLE, cfg: QUIET }));
    await waitState(page, 'idle');
    const d = await debug(page);
    expect(d.character).toBe('mugsy');
    expect(d.player.resident).toContain('idle');
    expect(requests.filter((u) => /characters\/gary|gary\.json/i.test(u))).toEqual([]);
    // Only same-origin page files and the configured asset origin.
    const origins = new Set(requests.map((u) => new URL(u).origin));
    expect([...origins].sort()).toEqual(['http://127.0.0.1:8710', 'http://127.0.0.1:8711']);
  });

  test('no character art is requested before first contentful paint', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Paint Timing entries are Chromium-reliable');
    const art: number[] = [];
    page.on('request', (r) => {
      if (/\.webp$|character\.json$/.test(r.url())) art.push(Date.now());
    });
    await page.goto(pageUrl({ char: SAMPLE, cfg: QUIET }));
    await waitState(page, 'idle');
    const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1);
    const nav = await page.evaluate(() => performance.timeOrigin);
    expect(fcp).toBeGreaterThan(0);
    for (const t of art) expect(t - nav).toBeGreaterThan(fcp);
  });

  test('zero layout shift from the character', async ({ page }) => {
    await boot(page);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__cls ?? 0)).toBe(0);
  });

  test('a minimal character (idle + one mirrored walk) runs; missing roles fail softly', async ({ page }) => {
    await boot(page, { char: MINIMAL });
    expect(await page.evaluate(() => (window as any).Gary.do('judge'))).toBe(false);
    expect(await page.evaluate(() => (window as any).Gary.do('walk'))).toBe(true);
    expect(await page.evaluate(() => (window as any).Gary.say('#core'))).toBe(true);
  });

  test('broken manifests fail gracefully with an error event', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pageUrl({ char: '/does-not-exist.json', cfg: QUIET }));
    expect(await firstError(page)).toMatch(/HTTP 404/);
    await waitState(page, 'failed').catch(() => {});
    expect(await page.locator('[data-garyjs]').count()).toBe(0);
    expect(errors).toEqual([]);
    await page.click('#link');
    expect(await page.evaluate(() => (window as any).__log)).toEqual(['link']);
  });

  test('an asset host without CORS fails gracefully', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pageUrl({ char: 'http://127.0.0.1:8712/characters/sample/character.json', cfg: QUIET }));
    await firstError(page);
    // WebKit reports its own CORS diagnostic through the page-error channel; it is not thrown by gary.js.
    expect(errors.filter((m) => !/access control checks/.test(m))).toEqual([]);
  });

  test('strict CSP blocking the asset origin fails gracefully', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'";
    await page.goto(pageUrl({ char: CROSS_SAMPLE, cfg: QUIET, csp }));
    await firstError(page);
    expect(errors).toEqual([]);
  });

  test('works under a CSP that allows the asset origin in connect-src', async ({ page }) => {
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:8711";
    await page.goto(pageUrl({ char: CROSS_SAMPLE, cfg: QUIET, csp }));
    await waitState(page, 'idle');
  });

  test('zero-config classic script without a default character installed fails quietly', async ({ page }) => {
    test.skip(!!process.env.GARY_ASSET_DIR, 'default character is installed locally');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pageUrl({ bundle: 'classic', cfg: QUIET }));
    expect(await firstError(page)).toMatch(/characters\/gary\/character\.json/);
    expect(errors).toEqual([]);
  });
});

test.describe('page safety', () => {
  test('transparent pixels click through; opaque pixels do not', async ({ page }) => {
    await boot(page);
    const { opaque, clear } = await probePoints(page);
    expect(opaque).not.toBeNull();
    expect(clear).not.toBeNull();
    await page.mouse.click(clear!.x, clear!.y);
    expect(await page.evaluate(() => (window as any).__log)).toEqual(['under']);
    await page.mouse.click(opaque!.x, opaque!.y);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as any).__log)).toEqual(['under']);
  });

  test('the page keeps focus and links work around the character', async ({ page }) => {
    await boot(page);
    await page.click('#field');
    await page.keyboard.type('hello');
    expect(await page.inputValue('#field')).toBe('hello');
    await page.click('#link');
    expect(page.url()).toMatch(/#clicked$/);
  });

  test('init twice keeps one overlay; destroy removes it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).Gary.init({ ambient: false, triggers: [] }));
    await page.evaluate(() => (window as any).Gary.init({ ambient: false, triggers: [], vars: { owner: 'X' } }));
    expect(await page.locator('[data-garyjs]').count()).toBe(1);
    await page.evaluate(() => (window as any).Gary.destroy());
    expect(await page.locator('[data-garyjs]').count()).toBe(0);
    expect(await debug(page)).toBeNull();
    // Re-initialising after destroy works.
    await page.evaluate(() => (window as any).Gary.init({ character: '/characters/sample/character.json', ambient: false, triggers: [] }));
    await waitState(page, 'idle');
    expect(await page.locator('[data-garyjs]').count()).toBe(1);
  });

  test('lines are rendered as text, never HTML', async ({ page }) => {
    await boot(page);
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    expect(await page.evaluate((t) => (window as any).Gary.say(t).then(() => 0) && 1, evil)).toBe(1);
    await page.waitForTimeout(150);
    const html = await page.evaluate(() => document.querySelector('[data-garyjs]')!.shadowRoot!.querySelector('.bubble')!.innerHTML);
    expect(html).not.toContain('<img');
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  });
});

test.describe('API and behaviours', () => {
  test('unsupported and excluded behaviours return false', async ({ page }) => {
    await boot(page);
    for (const b of ['phone', 'card', 'steal-cursor', 'dance', 'enter', 'drag']) {
      expect(await page.evaluate((x) => (window as any).Gary.do(x), b)).toBe(false);
    }
  });

  test('say emits "spoke" with the interpolated line', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, vars: { owner: 'Sam' } } });
    const line = await page.evaluate(
      () => new Promise<string>((r) => {
        (window as any).Gary.on('spoke', r);
        (window as any).Gary.say('Hi {owner}');
      }),
    );
    expect(line).toBe('Hi Sam');
  });

  test('judge plays a one-shot and returns to idle', async ({ page }) => {
    await boot(page);
    const states: string[] = [];
    await page.exposeFunction('__state', (s: string) => states.push(s));
    await page.evaluate(() => (window as any).Gary.on('state', (s: string) => (window as any).__state(s)));
    expect(await page.evaluate(() => (window as any).Gary.do('judge'))).toBe(true);
    await waitState(page, 'idle');
    expect(states).toEqual(['judging', 'idle']);
  });

  test('walk moves the character and keeps the feet on the ground', async ({ page }) => {
    await boot(page);
    const before = await canvasBox(page);
    expect(await page.evaluate(() => (window as any).Gary.do('walk'))).toBe(true);
    const after = await canvasBox(page);
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(40);
    expect(Math.round(after.y + after.h)).toBe(Math.round(before.y + before.h));
  });

  test('three quick clicks trigger react-clicks', async ({ page }) => {
    await boot(page);
    const { opaque } = await probePoints(page);
    const spoke = page.evaluate(() => new Promise<string>((r) => (window as any).Gary.on('spoke', r)));
    for (let i = 0; i < 3; i++) await page.mouse.click(opaque!.x, opaque!.y);
    expect(await spoke).toBeTruthy();
  });

  test('gary-click and event triggers fire', async ({ page }) => {
    await boot(page, { cfg: { ambient: false, behaviours: ['enter', 'say', 'walk', 'idle'], triggers: [{ on: 'gary-click', count: 1, say: 'clicked!' }, { on: 'event', event: 'deploy', say: 'deployed!' }], limits: { minGapSeconds: 0, maxLinesPerMinute: 30 } } });
    const lines: string[] = [];
    await page.exposeFunction('__spoke', (s: string) => lines.push(s));
    await page.evaluate(() => (window as any).Gary.on('spoke', (s: string) => (window as any).__spoke(s)));
    const { opaque } = await probePoints(page);
    await page.mouse.click(opaque!.x, opaque!.y);
    await expect.poll(() => lines).toContain('clicked!');
    await page.evaluate(() => (window as any).Gary.emit('deploy'));
    await expect.poll(() => lines).toContain('deployed!');
  });

  test('hover and click triggers with selectors', async ({ page }) => {
    await boot(page, { cfg: { ambient: false, triggers: [{ on: 'click', selector: '#link', say: 'link clicked' }], limits: { minGapSeconds: 0, maxLinesPerMinute: 30 } } });
    const spoke = page.evaluate(() => new Promise<string>((r) => (window as any).Gary.on('spoke', r)));
    await page.click('#link');
    expect(await spoke).toBe('link clicked');
  });
});

test.describe('rest mode', () => {
  test('the idle animation pauses while the visitor is inactive and resumes on input', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, restAfter: 1 } });
    await expect.poll(async () => (await debug(page)).resting, { timeout: 5000 }).toBe(true);
    const d = await debug(page);
    expect(d.player.scheduled).toBe(false);
    expect(d.frame.paused).toBe(true);
    await page.mouse.move(10, 10);
    await page.mouse.move(40, 40);
    await expect.poll(async () => (await debug(page)).resting).toBe(false);
    expect((await debug(page)).player.scheduled).toBe(true);
  });

  test('restAfter: 0 never rests', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, restAfter: 0 } });
    await page.waitForTimeout(1500);
    expect((await debug(page)).resting).toBe(false);
  });
});

test.describe('dragging', () => {
  test('drag picks the character up, release drops it back to the ground', async ({ page }) => {
    await boot(page);
    const ground = await canvasBox(page);
    const { opaque } = await probePoints(page);
    await page.mouse.move(opaque!.x, opaque!.y);
    await page.mouse.down();
    await page.mouse.move(opaque!.x - 60, opaque!.y - 120, { steps: 6 });
    await waitState(page, 'dragging');
    await expect.poll(async () => (await debug(page)).frame.clip).toBe('held');
    const lifted = await canvasBox(page);
    expect(lifted.y).toBeLessThan(ground.y - 80);
    await page.mouse.up();
    await expect.poll(async () => (await debug(page)).state).toMatch(/falling|idle/);
    await waitState(page, 'idle');
    const landed = await canvasBox(page);
    expect(Math.round(landed.y + landed.h)).toBe(Math.round(ground.y + ground.h));
    expect(await page.evaluate(() => (window as any).__log)).toEqual([]);
  });

  test('Escape cancels a drag', async ({ page }) => {
    await boot(page);
    const { opaque } = await probePoints(page);
    await page.mouse.move(opaque!.x, opaque!.y);
    await page.mouse.down();
    await page.mouse.move(opaque!.x - 30, opaque!.y - 80, { steps: 4 });
    await waitState(page, 'dragging');
    await page.keyboard.press('Escape');
    await waitState(page, 'idle');
    expect((await debug(page)).lift).toBe(0);
    await page.mouse.up();
  });

  test('nine drag/drop cycles leave no extra timers or clips', async ({ page }) => {
    await boot(page);
    for (let i = 0; i < 9; i++) {
      const { opaque } = await probePoints(page);
      await page.mouse.move(opaque!.x, opaque!.y);
      await page.mouse.down();
      await page.mouse.move(opaque!.x - 20, opaque!.y - 60, { steps: 3 });
      await page.mouse.up();
      await waitState(page, 'idle');
    }
    const d = await debug(page);
    expect(d.player.resident.length).toBeLessThanOrEqual(3);
    expect(d.player.pending).toBe(0);
  });
});

test.describe('menu, removal and preferences', () => {
  test('right-click opens the menu; Remove persists across reloads; reset restores', async ({ page }) => {
    await boot(page);
    const { opaque } = await probePoints(page);
    await page.mouse.click(opaque!.x, opaque!.y, { button: 'right' });
    const menu = page.locator('[data-garyjs] >> [role="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Mute', 'Remove Mugsy', 'Powered by gary.js']);
    const dismissed = page.evaluate(() => new Promise((r) => (window as any).Gary.on('dismissed', r)));
    await menu.getByRole('menuitem', { name: 'Remove Mugsy' }).click();
    await dismissed;
    await expect.poll(() => page.locator('[data-garyjs]').count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('gary.js:dismissed'))).toBe('1');

    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.reload();
    await page.evaluate(() => (window as any).Gary.ready);
    expect(await page.locator('[data-garyjs]').count()).toBe(0);
    expect(requests.filter((u) => /character\.json$|\.webp$/.test(new URL(u).pathname))).toEqual([]);
    // A page calling init() again must not resurrect the character.
    await page.evaluate(() => (window as any).Gary.init({ character: '/characters/sample/character.json' }));
    expect(await page.locator('[data-garyjs]').count()).toBe(0);

    await page.evaluate(() => (window as any).Gary.reset());
    await waitState(page, 'idle');
  });

  test('keyboard: Tab to the options button, open, navigate, Escape returns focus', async ({ page, browserName }) => {
    await boot(page);
    // The options button is the last focusable element on the page, after #under.
    await page.locator('#under').focus();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    const focused = () => page.evaluate(() => {
      const h = document.querySelector('[data-garyjs]')!;
      const a = h.shadowRoot!.activeElement as HTMLElement | null;
      return document.activeElement === h ? a?.getAttribute('role') ?? a?.className ?? null : null;
    });
    await expect.poll(focused).toBe('handle');
    await page.keyboard.press('Enter');
    await expect.poll(focused).toBe('menuitem');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => (document.querySelector('[data-garyjs]')!.shadowRoot!.activeElement as HTMLElement).textContent)).toBe('Remove Mugsy');
    await page.keyboard.press('Escape');
    await expect.poll(focused).toBe('handle');
    await page.keyboard.press('Shift+F10');
    await expect.poll(focused).toBe('menuitem');
    await page.keyboard.press('Enter'); // Mute
    expect(await page.evaluate(() => sessionStorage.getItem('gary.js:muted'))).toBe('1');
    expect(await page.evaluate(() => (window as any).Gary.say('quiet please'))).toBe(false);
  });

  test('mute and unmute through the API', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).Gary.mute());
    expect(await page.evaluate(() => (window as any).Gary.say('x'))).toBe(false);
    await page.evaluate(() => (window as any).Gary.unmute());
    expect(await page.evaluate(() => (window as any).Gary.say('y'))).toBe(true);
  });

  test('blocked localStorage does not break removal', async ({ page }) => {
    await page.addInitScript(() => {
      const err = () => { throw new DOMException('blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { get: err });
      Object.defineProperty(window, 'sessionStorage', { get: err });
    });
    await boot(page);
    await page.evaluate(() => (window as any).Gary.dismiss());
    await expect.poll(() => page.locator('[data-garyjs]').count()).toBe(0);
  });

  test('custom credit link and credit: false', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, menu: { credit: { label: 'Made by Sam', url: 'https://example.com/' } } } });
    const openMenu = async () => {
      const { opaque } = await probePoints(page);
      await page.mouse.click(opaque!.x, opaque!.y, { button: 'right' });
    };
    await openMenu();
    const links = page.locator('[data-garyjs] >> [role="menu"] a');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(links).toHaveAttribute('target', '_blank');
    await expect(links).toHaveText('Made by Sam');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).Gary.init({ ambient: false, triggers: [], menu: { credit: false } }));
    await openMenu();
    await expect(page.locator('[data-garyjs] >> [role="menu"]')).toBeVisible();
    await expect(links).toHaveCount(0);
  });
});

test.describe('accessibility', () => {
  test('reduced motion: no entrance walk, a still poster, no animation scheduled', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await boot(page);
    const d = await debug(page);
    expect(d.reduced).toBe(true);
    expect(d.frame).toMatchObject({ clip: 'idle', frame: 0, paused: true });
    expect(d.player.scheduled).toBe(false);
    expect(await page.evaluate(() => (window as any).Gary.do('walk'))).toBe(false);
    expect(await page.evaluate(() => (window as any).Gary.say('still talking'))).toBe(true);
    await ctx.close();
  });

  test('canvas is hidden from assistive tech; bubbles are not announced by default', async ({ page }) => {
    await boot(page);
    const a = await page.evaluate(() => {
      const r = document.querySelector('[data-garyjs]')!.shadowRoot!;
      return { canvas: r.querySelector('canvas')!.getAttribute('aria-hidden'), bubble: r.querySelector('.bubble')!.getAttribute('aria-hidden'), handle: r.querySelector('.handle')!.getAttribute('aria-label') };
    });
    expect(a).toEqual({ canvas: 'true', bubble: 'true', handle: 'Mugsy options' });
  });

  test('announce: true makes bubbles a polite live region', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, announce: true } });
    const role = await page.evaluate(() => document.querySelector('[data-garyjs]')!.shadowRoot!.querySelector('.bubble')!.getAttribute('aria-live'));
    expect(role).toBe('polite');
  });
});

test.describe('touch @touch', () => {
  test('touch drag and long-press menu', async ({ page }) => {
    await boot(page);
    const { opaque } = await probePoints(page);
    const cdp = await page.context().newCDPSession(page).catch(() => null);
    test.skip(!cdp, 'touch synthesis needs CDP (Chromium)');
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp!.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', opaque!.x, opaque!.y);
    for (let i = 1; i <= 6; i++) await touch('touchMove', opaque!.x - i * 10, opaque!.y - i * 20);
    await waitState(page, 'dragging');
    await touch('touchEnd', 0, 0);
    await waitState(page, 'idle');
    const p2 = await probePoints(page);
    await touch('touchStart', p2.opaque!.x, p2.opaque!.y);
    await page.waitForTimeout(800);
    await touch('touchEnd', 0, 0);
    await expect(page.locator('[data-garyjs] >> [role="menu"]')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__log)).toEqual([]);
  });
});
