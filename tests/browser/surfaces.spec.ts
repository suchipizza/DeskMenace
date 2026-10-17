import { expect, test, type Page } from '@playwright/test';
import { canvasBox, debug, SAMPLE, surfacesUrl, waitState } from './helpers';

// Standing on page elements, scenes, presets and the visitor-reaction triggers, with Mugsy
// (170 px tall) on a 1280 x 720 viewport. #target (top 400) fits; #high (top 60) does not.

const QUIET = { ambient: false, triggers: [] };

async function boot(page: Page, q: Record<string, unknown>): Promise<void> {
  await page.goto(surfacesUrl({ char: SAMPLE, ...q }));
  await waitState(page, 'idle');
}

function rect(page: Page, sel: string) {
  return page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top };
  }, sel);
}

/** Waits until the character stands still on `surface` (null = floor). */
async function settledOn(page: Page, surface: string | null, timeout = 15_000): Promise<void> {
  await page.waitForFunction((s) => {
    const d = (window as any).Gary._debug();
    return d && d.surface === s && d.state === 'idle' && d.activity === null;
  }, surface, { timeout });
}

const feetY = async (page: Page) => {
  const b = await canvasBox(page);
  return b.y + b.h;
};

test.describe('standing on page elements', () => {
  test('a scene walks to an element, gets onto it, judges and speaks', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#target' }, { play: 'judge' }, { say: 'Up here.' }] } } });
    expect(await page.evaluate(() => (window as any).Gary.do('go'))).toBe(true);
    const d = await debug(page);
    expect(d.surface).toBe('#target');
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['Up here.']);
    const t = await rect(page, '#target');
    // Mugsy's feet are at the bottom of the frame box.
    expect(Math.abs((await feetY(page)) - t.top)).toBeLessThan(3);
    expect(d.feetX).toBeGreaterThanOrEqual(t.left);
    expect(d.feetX).toBeLessThanOrEqual(t.right);
    // Hit testing still works up there.
    const b = await canvasBox(page);
    expect(await page.evaluate(([x, y]) => (window as any).Gary._hit(x, y), [b.x + b.w * 0.5, b.y + b.h * 0.55])).toBe(true);
  });

  test('an element without room above is reached from the floor below it', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#high' }] } } });
    await page.evaluate(() => (window as any).Gary.do('go'));
    const d = await debug(page);
    expect(d.surface).toBeNull();
    const h = await rect(page, '#high');
    expect(Math.abs(d.feetX - (h.left + h.right) / 2)).toBeLessThan(6);
    expect(Math.abs((await feetY(page)) - 720)).toBeLessThan(3);
  });

  test('follows its element while the page scrolls and falls off when it leaves', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#target' }] } } });
    await page.evaluate(() => (window as any).Gary.do('go'));
    await page.evaluate(() => window.scrollBy(0, 100));
    await page.waitForTimeout(150);
    expect((await debug(page)).surface).toBe('#target');
    expect(Math.abs((await feetY(page)) - (await rect(page, '#target')).top)).toBeLessThan(3);
    // #target now at 300: one more 200 px leaves no room above the head, so it falls.
    await page.evaluate(() => window.scrollBy(0, 200));
    await settledOn(page, null);
    expect(Math.abs((await feetY(page)) - 720)).toBeLessThan(3);
  });

  test('walks (never flies) from one element to another and back to the floor', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#target', at: 'left' }, { walkTo: '#other' }, { walkTo: 'floor' }] } } });
    const states: string[] = [];
    await page.exposeFunction('__state', (s: string) => states.push(s));
    await page.evaluate(() => (window as any).Gary.on('state', (s: string) => (window as any).__state(s)));
    expect(await page.evaluate(() => (window as any).Gary.do('go'))).toBe(true);
    expect((await debug(page)).surface).toBeNull();
    expect(states).toContain('walking');
    expect(states).not.toContain('falling');
    expect(Math.abs((await feetY(page)) - 720)).toBeLessThan(3);
  });

  test('dropped above an element after a drag, it lands on the element', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, surfaces: '#target' } });
    const t = await rect(page, '#target');
    const b = await canvasBox(page);
    const start = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.55 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Carry it above the middle of #target, feet ~60 px above the element.
    const dx = (t.left + t.right) / 2 - (b.x + b.w / 2);
    const dy = t.top - 60 - (b.y + b.h);
    for (let i = 1; i <= 8; i++) await page.mouse.move(start.x + (dx * i) / 8, start.y + (dy * i) / 8);
    await page.mouse.up();
    await settledOn(page, '#target');
    expect(Math.abs((await feetY(page)) - t.top)).toBeLessThan(3);
  });

  test('falls back to the floor when its element is removed or hidden', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#target' }], other: [{ walkTo: '#other' }] } } });
    await page.evaluate(() => (window as any).Gary.do('go'));
    await page.evaluate(() => document.getElementById('target')!.remove());
    await settledOn(page, null);
    expect(Math.abs((await feetY(page)) - 720)).toBeLessThan(3);
    await page.evaluate(() => (window as any).Gary.do('other'));
    expect((await debug(page)).surface).toBe('#other');
    await page.evaluate(() => (document.getElementById('other')!.style.display = 'none'));
    await settledOn(page, null);
    expect(Math.abs((await feetY(page)) - 720)).toBeLessThan(3);
  });

  test('moves with its element when the layout shifts without scrolling', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#target' }] } } });
    await page.evaluate(() => (window as any).Gary.do('go'));
    await page.evaluate(() => (document.getElementById('target')!.style.top = '460px'));
    // Caught by the once-a-second re-check (nothing scrolled or resized).
    await expect.poll(async () => Math.abs((await feetY(page)) - 460), { timeout: 2500 }).toBeLessThan(3);
  });

  test('does not hop onto an element that scrolled away during the walk over', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, position: { side: 'left' }, scenes: { go: [{ walkTo: '#other' }] } } });
    const done = page.evaluate(() => (window as any).Gary.do('go'));
    await page.waitForFunction(() => (window as any).Gary._debug().state === 'walking');
    await page.evaluate(() => window.scrollBy(0, 400));
    await done;
    await settledOn(page, null);
    expect(Math.abs((await feetY(page)) - 720)).toBeLessThan(3);
  });

  test('a cancelled drag puts it back on the element it was picked up from', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#target' }] } } });
    await page.evaluate(() => (window as any).Gary.do('go'));
    const before = (await debug(page)).feetX;
    const b = await canvasBox(page);
    const start = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.55 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 60, { steps: 5 });
    await waitState(page, 'dragging');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settledOn(page, '#target');
    expect(Math.abs((await debug(page)).feetX - before)).toBeLessThan(2);
  });

  test('ambient wandering uses the configured surfaces', async ({ page }) => {
    // Random timing: allow several ambient turns.
    test.setTimeout(75_000);
    await boot(page, { cfg: { triggers: [], surfaces: '#target, #other', pace: 'busy', restAfter: 0 } });
    await page.waitForFunction(() => ['#target', '#other'].includes((window as any).Gary._debug()?.surface), null, { timeout: 60_000 });
  });

  test('reduced motion: scenes skip walking but still speak', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, { cfg: { ...QUIET, scenes: { go: [{ walkTo: '#target' }, { say: 'Still here.' }] } } });
    await page.evaluate(() => (window as any).Gary.do('go'));
    expect((await debug(page)).surface).toBeNull();
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['Still here.']);
  });
});

test.describe('visitor reactions', () => {
  const lines = { a: ['first'], b: ['second'] };
  const scenes = { stare: [{ play: 'judge' }, { say: '#a' }], annoyed: [{ say: '#b' }] };

  test('clicks anywhere and scroll attempts escalate through one shared group', async ({ page }) => {
    await boot(page, {
      cfg: {
        ...QUIET,
        lines,
        scenes,
        limits: { minGapSeconds: 0, maxLinesPerMinute: 30 },
        triggers: [
          { on: 'click', scene: ['stare', 'annoyed'], group: 'v' },
          { on: 'scrolling', scene: ['stare', 'annoyed'], group: 'v' },
        ],
      },
    });
    await page.mouse.click(40, 40);
    await page.waitForFunction(() => (window as any).__spoke.length === 1);
    await waitState(page, 'idle');
    await page.waitForFunction(() => (window as any).Gary._debug().scene === null);
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => (window as any).__spoke.length === 2);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['first', 'second']);
  });

  test('an element seen while a scene plays gets its line once the scene ends', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, lines, scenes: { long: [{ wait: 2 }] }, limits: { minGapSeconds: 0, maxLinesPerMinute: 30 }, triggers: [] } });
    await page.evaluate(() => {
      void (window as any).Gary.do('long');
    });
    await page.waitForFunction(() => (window as any).Gary._debug().scene === 'long');
    // #target is already on screen: the rule is refused while the scene plays, then retried.
    await page.evaluate(() => (window as any).Gary.init({ triggers: [{ on: 'visible', selector: '#target', say: '#a', once: true }] }));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual([]);
    await page.waitForFunction(() => (window as any).__spoke.length === 1, null, { timeout: 6_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['first']);
  });

  test('a scene started by the page does not cut into a running scene', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, lines, scenes: { long: [{ wait: 2 }, { say: '#a' }], other: [{ say: '#b' }] }, limits: { minGapSeconds: 0, maxLinesPerMinute: 30 }, triggers: [{ on: 'click', scene: 'other' }] } });
    await page.evaluate(() => {
      void (window as any).Gary.do('long');
    });
    await page.waitForFunction(() => (window as any).Gary._debug().scene === 'long');
    await page.mouse.click(40, 40);
    await page.waitForFunction(() => (window as any).__spoke.length === 1);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['first']);
  });

  test('scenes started by triggers share the speech limits', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, lines, scenes: { talk: [{ say: '#a' }] }, limits: { minGapSeconds: 0, maxLinesPerMinute: 1 }, triggers: [{ on: 'click', scene: 'talk' }] } });
    await page.mouse.click(40, 40);
    await page.waitForFunction(() => (window as any).__spoke.length === 1);
    await page.waitForFunction(() => (window as any).Gary._debug().scene === null, null, { timeout: 15_000 });
    await page.mouse.click(40, 40);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['first']);
    // The API isn't limited.
    await page.evaluate(() => (window as any).Gary.do('talk'));
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['first', 'first']);
  });

  test('"scrolling" ignores scrolls the visitor did not cause', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, limits: { minGapSeconds: 0, maxLinesPerMinute: 30 }, triggers: [{ on: 'scrolling', say: 'Scrolled.' }] } });
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual([]);
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => (window as any).__spoke.length === 1);
  });

  test('the pointer coming near fires "near" once per approach', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, limits: { minGapSeconds: 0, maxLinesPerMinute: 30 }, triggers: [{ on: 'near', distance: 40, say: 'Personal space.' }] } });
    const b = await canvasBox(page);
    await page.mouse.move(20, 20);
    await page.mouse.move(b.x - 20, b.y + b.h / 2, { steps: 5 });
    await page.waitForFunction(() => (window as any).__spoke.length === 1);
    await page.mouse.move(b.x - 10, b.y + b.h / 2);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['Personal space.']);
  });
});

test.describe('scripted walks', () => {
  const lines = { hi: ['Hi.'], sorry: ['Hey, I was walking there.'], aside: ['Busy.'] };
  const limits = { minGapSeconds: 0, maxLinesPerMinute: 30 };

  test('an entrance scene walks in from the left at mid-height and across', async ({ page }) => {
    await page.goto(surfacesUrl({ char: SAMPLE, cfg: { triggers: [], ambient: false, lines, limits, entrance: 'in', scenes: { in: [{ enter: 'left', y: 0.5 }, { walkTo: { x: 0.5 } }, { say: '#hi' }, { walkTo: { x: 0.3, y: 0.7 } }] } } }));
    await page.waitForFunction(() => (window as any).Gary?._debug?.()?.state === 'walking', null, { timeout: 15_000 });
    const b0 = await canvasBox(page);
    expect(b0.x).toBeLessThan(150);
    expect(Math.abs(b0.y + b0.h / 2 - 360)).toBeLessThan(4); // the body's middle at 50 %
    await page.waitForFunction(() => (window as any).__spoke.length === 1, null, { timeout: 20_000 });
    const b1 = await canvasBox(page);
    expect(Math.abs(b1.x + b1.w / 2 - 640)).toBeLessThan(8);
    await page.waitForFunction(() => (window as any).Gary._debug().scene === null, null, { timeout: 20_000 });
    const b2 = await canvasBox(page);
    expect(Math.abs(b2.y + b2.h / 2 - 504)).toBeLessThan(4); // 70 %
    expect(Math.abs(b2.x + b2.w / 2 - 384)).toBeLessThan(8); // 30 %
  });

  test('an exit step walks off and stays away: not clickable, triggers ignored', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, lines, limits, scenes: { out: [{ exit: 'right' }] }, triggers: [{ on: 'click', say: '#hi' }] } });
    await page.evaluate(() => (window as any).Gary.do('out'));
    expect((await debug(page)).state).toBe('away');
    expect((await canvasBox(page)).x).toBeGreaterThan(1280);
    await page.mouse.click(40, 40);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual([]);
    expect(await page.evaluate(() => (window as any).Gary.do('walk'))).toBe(false);
  });

  test('"during" rules comment without stopping the scene', async ({ page }) => {
    await boot(page, { cfg: { ...QUIET, lines, limits, scenes: { stroll: [{ walkTo: { x: 0.2 } }, { say: '#hi' }] }, triggers: [{ on: 'click', during: 'stroll', say: '#aside' }, { on: 'click', say: '#sorry' }] } });
    await page.evaluate(() => {
      void (window as any).Gary.do('stroll');
    });
    await page.waitForFunction(() => (window as any).Gary._debug().state === 'walking');
    await page.mouse.click(40, 40);
    await page.waitForFunction(() => (window as any).__spoke.length === 1);
    expect((await debug(page)).scene).toBe('stroll');
    await page.waitForFunction(() => (window as any).__spoke.length === 2, null, { timeout: 30_000 });
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['Busy.', 'Hi.']);
  });

  test('dropTo "here": dropped where it is let go; a cut scene says its line and carries on', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page, { cfg: { ...QUIET, lines, limits, dropTo: 'here', scenes: { stroll: { steps: [{ walkTo: { x: 0.15 } }, { say: '#hi' }], interrupted: '#sorry' } } } });
    await page.evaluate(() => {
      void (window as any).Gary.do('stroll');
    });
    await page.waitForFunction(() => (window as any).Gary._debug().state === 'walking');
    await page.waitForTimeout(400);
    const b = await canvasBox(page);
    const start = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.55 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y - 250, { steps: 8 });
    await waitState(page, 'dragging');
    await page.mouse.up();
    // Lands about 250 px up, not on the floor.
    await page.waitForFunction(() => (window as any).__spoke.length === 1, null, { timeout: 15_000 });
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['Hey, I was walking there.']);
    expect(Math.abs((await feetY(page)) - (720 - 250))).toBeLessThan(12);
    await page.waitForFunction(() => (window as any).__spoke.length === 2, null, { timeout: 40_000 });
    expect((await page.evaluate(() => (window as any).__spoke))[1]).toBe('Hi.');
    expect(Math.abs((await feetY(page)) - (720 - 250))).toBeLessThan(12);
  });

  test('a scene dragged while it speaks does not repeat that line after the drop', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page, { cfg: { ...QUIET, lines, limits, dropTo: 'here', scenes: { chat: { steps: [{ say: '#hi' }, { wait: 0.5 }, { walkTo: { x: 0.6 } }] } } } });
    void page.evaluate(() => (window as any).Gary.do('chat'));
    await page.waitForFunction(() => (window as any).__spoke.length === 1, null, { timeout: 15_000 });
    const b = await canvasBox(page);
    const start = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.55 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y - 150, { steps: 8 });
    await waitState(page, 'dragging');
    await page.mouse.up();
    await waitState(page, 'walking', 15_000);
    await waitState(page, 'idle', 15_000);
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['Hi.']);
  });

  test('a "drag" rule speaks on pick-up; an ordered pool goes on in order, then repeats its last line', async ({ page }) => {
    test.setTimeout(60_000);
    const cfg = { ...QUIET, lines: { kg: ['one', 'two', 'three'] }, inOrder: ['kg'], limits: { minGapSeconds: 30, maxLinesPerMinute: 1 }, dropTo: 'here', scenes: { stroll: { steps: [{ walkTo: { x: 0.15 } }], interrupted: '#kg' } }, triggers: [{ on: 'drag', say: 'Very mature.' }] };
    await boot(page, { cfg });
    await page.evaluate(() => {
      void (window as any).Gary.do('stroll');
    });
    await page.waitForFunction(() => (window as any).Gary._debug().state === 'walking');
    await page.waitForTimeout(300);
    const b = await canvasBox(page);
    const start = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.55 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y - 200, { steps: 8 });
    await waitState(page, 'dragging');
    // Shown while held, despite the speech limits.
    await page.waitForFunction(() => (window as any).__spoke.length === 1);
    expect((await debug(page)).state).toBe('dragging');
    await page.mouse.up();
    await page.waitForFunction(() => (window as any).__spoke.length === 2, null, { timeout: 15_000 });
    for (let i = 3; i <= 5; i++) {
      await page.evaluate(() => {
        void (window as any).Gary.say('#kg');
      });
      await page.waitForFunction((n) => (window as any).__spoke.length === n, i);
    }
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['Very mature.', 'one', 'two', 'three', 'three']);
  });

  test('ambient walks stay inside position.x', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page, { cfg: { triggers: [], pace: 'busy', restAfter: 0, position: { side: 'left', x: [0.4, 0.6] } } });
    let walks = 0;
    for (let i = 0; i < 80 && walks < 3; i++) {
      await page.waitForTimeout(500);
      const d = await debug(page);
      if (d.state === 'walking') walks++;
      if (d.state === 'idle' && walks) {
        expect(d.feetX).toBeGreaterThanOrEqual(0.4 * 1280 - 1);
        expect(d.feetX).toBeLessThanOrEqual(0.6 * 1280 + 1);
      }
    }
    expect(walks).toBeGreaterThan(0);
  });
});

test.describe('character presets', () => {
  test('data-preset loads the character\'s 404 preset: in from the left, onto the 404, a line, off to the right', async ({ page }) => {
    test.setTimeout(60_000);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(surfacesUrl({ char: SAMPLE, preset: '404' }));
    await page.waitForFunction(() => (window as any).Gary?._debug?.()?.state === 'walking', null, { timeout: 15_000 });
    // Walks in from the left edge, level with the 404 (no flying).
    expect((await canvasBox(page)).x).toBeLessThan(200);
    expect(Math.abs((await feetY(page)) - (await rect(page, '#target')).top)).toBeLessThan(3);
    await page.waitForFunction(() => (window as any).__spoke.length >= 1, null, { timeout: 30_000 });
    expect((await debug(page)).surface).toBe('#target');
    await waitState(page, 'away', 30_000);
    expect((await canvasBox(page)).x).toBeGreaterThan(1280);
    expect(requests.some((u) => u.endsWith('/characters/sample/presets/404.json'))).toBe(true);
    const sample = JSON.parse(await (await page.request.get('/characters/sample/presets/404.json')).text());
    expect(sample.lines['404']).toContain((await page.evaluate(() => (window as any).__spoke))[0]);
  });

  test('switching presets with quick re-inits ends with the last one only', async ({ page }) => {
    await boot(page, { preset: '404', cfg: QUIET });
    const has = (n: string) => page.evaluate((name) => (window as any).Gary.do(name), n);
    await page.evaluate(() => {
      const G = (window as any).Gary;
      void G.init({ preset: 'website', ambient: false, triggers: [] });
      return G.init({ preset: 'staging', ambient: false, triggers: [] });
    });
    await page.waitForTimeout(500);
    expect(await has('scrolled')).toBe(false);
    expect(await has('arrive')).toBe(false);
    expect(await has('inspect')).toBe(true);
  });

  test('page options win over the preset; an unknown preset is ignored with a warning', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
    await boot(page, { preset: 'nope', cfg: QUIET });
    expect(warnings.join()).toMatch(/has no preset "nope"/);
    test.setTimeout(60_000);
    await boot(page, { preset: '404', cfg: { triggers: [], entrance: null, lines: { '404': ['mine'] } } });
    await page.evaluate(() => (window as any).Gary.do('arrive'));
    expect(await page.evaluate(() => (window as any).__spoke)).toEqual(['mine']);
  });
});
