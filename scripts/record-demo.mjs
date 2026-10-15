// Records the demos from the example pages: docs/media/<name>.gif for the README, a small
// site/media/<name>.mp4 + .jpg poster for the website, and a full-quality MP4 in .local/demo/ for
// editing. Needs Playwright's Chromium and ffmpeg.
//   npm run build && node scripts/record-demo.mjs [gary-404|gary-website|gary-personal|mugsy ...]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.mjs';

// A smallish window keeps the character and its speech bubble readable once scaled down.
const W = 960, H = 640;
const BASE = 'http://127.0.0.1:8720/examples';

/** Helpers handed to each scenario. */
function helpers(page) {
  const pointer = { x: W * 0.85, y: H * 0.25 };
  const h = {
    pause: (ms) => page.waitForTimeout(ms),
    /** Waits until the speech bubble shows text matching `re`. */
    line: (re, timeout = 40_000) => page.waitForFunction(
      (src) => new RegExp(src).test(document.querySelector('[data-garyjs]')?.shadowRoot?.querySelector('.bubble')?.textContent ?? ''),
      re.source, { timeout, polling: 100 }),
    state: (s, timeout = 40_000) => page.waitForFunction((s) => window.Gary?._debug?.()?.state === s, s, { timeout, polling: 100 }),
    box: () => page.evaluate(() => {
      const r = document.querySelector('[data-garyjs]').shadowRoot.querySelector('canvas').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
    /** Moves the pointer smoothly, like a person would. */
    async move(x, y, ms = 600) {
      const n = Math.max(2, Math.round(ms / 25)), from = { ...pointer };
      for (let i = 1; i <= n; i++) {
        const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
        await page.waitForTimeout(25);
      }
      Object.assign(pointer, { x, y });
    },
    async click(x, y) {
      await h.move(x, y);
      await h.pause(250);
      await page.mouse.click(x, y);
    },
    /** Picks the character up by the body and drops it `dx`, `dy` away. */
    async drag(dx, dy) {
      const b = await h.box();
      const from = { x: b.x + b.w * 0.5, y: b.y + b.h * 0.5 };
      await h.move(from.x, from.y, 700);
      await h.pause(300);
      await page.mouse.down();
      await h.move(from.x + dx, from.y + dy, 1200);
      await h.pause(700);
      await page.mouse.up();
      await h.move(from.x + dx + 140, from.y + dy - 80, 500);
    },
    /** Scrolls with the wheel, in small steps, until the page bottom (or `px`). */
    async scroll(px = Infinity, step = 60) {
      for (let done = 0; done < px; done += step) {
        const atEnd = await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2);
        if (atEnd) break;
        await page.mouse.wheel(0, step);
        await page.waitForTimeout(45);
      }
    },
  };
  return h;
}

const SCENARIOS = {
  // 404: walks onto the 404, says his line; the visitor clicks around and he keeps answering.
  async 'gary-404'(page, h) {
    await page.goto(`${BASE}/404/`);
    await h.line(/leveraged AI/);
    // The preset keeps 3 s between lines.
    await h.pause(3300);
    const b = await h.box();
    await h.click(Math.min(W - 120, b.x + b.w + 260), b.y + b.h * 0.9);
    await h.line(/Clicking/, 5_000).catch(() => {});
    await h.pause(2600);
    await h.click(Math.min(W - 80, b.x + b.w + 340), b.y + b.h * 0.6);
    await h.line(/^(?!Clicking)./, 5_000).catch(() => {});
    // Ends once he has walked off the page.
    await page.waitForFunction((w) => {
      const c = document.querySelector('[data-garyjs]')?.shadowRoot?.querySelector('canvas');
      return !c || c.getBoundingClientRect().left > w;
    }, W, { timeout: 30_000, polling: 100 }).catch(() => {});
    await h.pause(900);
  },

  // Any website: arrives and comments, gets dragged, walks back to the centre with a remark,
  // then the visitor scrolls to the bottom of the page.
  async 'gary-website'(page, h) {
    await page.goto(`${BASE}/website/`);
    await h.line(/leveraged AI/);
    await h.pause(2600);
    await h.drag(260, -160);
    await h.line(/./, 10_000).catch(() => {});
    await h.pause(2000);
    await h.state('idle');
    await h.pause(600);
    // The example's own preset, plus a short scripted walk for the recording.
    await page.evaluate(() => window.Gary.init({
      scenes: { centre: [{ walkTo: { x: 0.5 } }, { wait: 0.4 }, { say: 'Interesting. Who approved this?' }] },
      triggers: [{ on: 'scrolling', scene: 'scrolled', cooldown: 45 }],
      // The presets allow 4 lines a minute; a short recording packs in more.
      limits: { minGapSeconds: 1, maxLinesPerMinute: 12 },
    }));
    if (!(await page.evaluate(() => window.Gary.do('centre')))) throw new Error('website: centre scene did not run');
    await h.pause(2200);
    await h.move(W * 0.7, H * 0.55, 500);
    await h.scroll();
    await h.pause(4000);
  },

  // Personal website: the whole inspection walk, then a scroll down to the projects.
  async 'gary-personal'(page, h) {
    await page.goto(`${BASE}/personal/`);
    await h.line(/Check out my profile/, 90_000);
    await h.pause(3500);
    await page.evaluate(() => window.Gary.init({ limits: { minGapSeconds: 2, maxLinesPerMinute: 12 } }));
    await h.move(W * 0.7, H * 0.55, 500);
    await h.scroll(700);
    await h.pause(3500);
    await h.scroll(900);
    // Let the last line be read before the clip ends.
    await h.line(/./, 8_000).catch(() => {});
    await h.pause(6000);
  },

  // Bring your own character: Mugsy on the coffee blog.
  async mugsy(page, h) {
    await page.goto(`${BASE}/custom-character/`);
    await h.line(/./);
    await h.pause(4000);
    await h.drag(-180, -120);
    await h.pause(4000);
    await h.move(W * 0.7, H * 0.55, 500);
    await h.scroll(800);
    await h.pause(4000);
  },
};
const README_GIFS = new Set(['gary-404', 'gary-website', 'gary-personal']);
// Poster frame (seconds into the clip): a moment with the character and a speech bubble.
const POSTER_AT = { 'gary-404': 8.5, 'gary-website': 8, 'gary-personal': 9, mugsy: 6 };

/** Encodes one recording (or the full-quality MP4 `src`) into the published formats. */
export function encode(name, cut) {
  const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
  mkdirSync('site/media', { recursive: true });
  ff(...cut, '-an', '-vf', 'scale=960:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `site/media/${name}.mp4`);
  ff('-ss', String(POSTER_AT[name] ?? 5), '-i', `site/media/${name}.mp4`, '-frames:v', '1', '-q:v', '5', `site/media/${name}.jpg`);
  if (README_GIFS.has(name)) ff(...cut,
    '-vf', // Large enough to read the bubbles, small enough for a README (GitHub shows images up to 10 MB).
    'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    `docs/media/${name}.gif`);
}

if (process.argv[2] === '--encode') {
  // Re-encode from the full-quality recordings without recording again.
  for (const name of process.argv.slice(3)) encode(name, ['-i', `.local/demo/${name}.mp4`]);
  process.exit(0);
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
const server = await startServer({ port: 8720 });
// The custom-character example loads Mugsy from port 8701; reuse a running `npm run serve` if there is one.
const assets = await fetch('http://127.0.0.1:8701/characters/sample/character.json').then(() => null, () => startServer({ port: 8701 }));
const browser = await chromium.launch();
mkdirSync('.local/demo', { recursive: true });

for (const name of names) {
  const videoDir = mkdtempSync(join(tmpdir(), 'gary-demo-'));
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: videoDir, size: { width: W, height: H } } });
  const page = await context.newPage();
  // Headless recordings have no pointer, so draw one.
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      c.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)';
      c.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18"><path d="M2 1 L2 15 L6 11 L9 17 L11 16 L8 10 L14 10 Z" fill="#111" stroke="#fff" stroke-width="1.2"/></svg>';
      document.body.append(c);
      addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 1}px)`; }, true);
    });
  });
  const start = Date.now();
  let shown = 0;
  page.on('console', (m) => m.text().startsWith('SPOKE ') && console.log(`  ${name}: ${m.text().slice(6)}`));
  await page.addInitScript(() => {
    const t = setInterval(() => { if (window.Gary?.on) { clearInterval(t); window.Gary.on('spoke', (l) => console.log('SPOKE ' + l)); } }, 20);
  });
  const h = helpers(page);
  const entering = page.waitForFunction(() => { const s = window.Gary?._debug?.()?.state; return s && s !== 'loading'; }, null, { timeout: 30_000, polling: 50 }).then(() => { shown = Date.now(); });
  await SCENARIOS[name](page, h);
  await entering.catch(() => {});
  const end = Date.now();
  await context.close();

  // Start just before the character appears.
  const video = join(videoDir, readdirSync(videoDir).find((f) => f.endsWith('.webm')));
  const ss = Math.max(0, ((shown || start) - start) / 1000 - 0.8);
  const t = (end - start) / 1000 - ss;
  const cut = ['-ss', ss.toFixed(2), '-t', t.toFixed(2), '-i', video];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...cut, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', `.local/demo/${name}.mp4`]);
  encode(name, cut);
  rmSync(videoDir, { recursive: true, force: true });
  console.log(`${name}: ${t.toFixed(1)} s`);
}
await browser.close();
server.close();
assets?.close();
