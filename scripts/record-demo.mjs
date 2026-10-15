// Records docs/media/gary-demo.gif: Gary walks onto the "website" example, comments on it, gets
// dragged and dropped, and complains. Needs Playwright's Chromium and ffmpeg.
//   npm run build && node scripts/record-demo.mjs
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.mjs';

const OUT = 'docs/media/gary-demo.gif';
const W = 1200, H = 750;

const server = await startServer({ port: 8720 });
const videoDir = mkdtempSync(join(tmpdir(), 'gary-demo-'));
const browser = await chromium.launch();
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

const bubbleText = () => page.evaluate(() => document.querySelector('[data-garyjs]')?.shadowRoot?.querySelector('.bubble')?.textContent ?? '');
const waitBubble = (re, timeout = 30_000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-garyjs]')?.shadowRoot?.querySelector('.bubble')?.textContent ?? ''), re.source, { timeout, polling: 100 });
const pause = (ms) => page.waitForTimeout(ms);

const start = Date.now();
await page.goto('http://127.0.0.1:8720/examples/website/');
await page.mouse.move(W * 0.82, H * 0.3);
await waitBubble(/leveraged AI/);
const lineAt = Date.now();
await pause(2600);

// Pick him up by the body, carry him up and to the right, let go.
const box = await page.evaluate(() => {
  const r = document.querySelector('[data-garyjs]').shadowRoot.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const from = { x: box.x + box.w * 0.5, y: box.y + box.h * 0.5 };
for (let i = 0; i <= 20; i++) await page.mouse.move(W * 0.82 + (from.x - W * 0.82) * i / 20, H * 0.3 + (from.y - H * 0.3) * i / 20), await pause(25);
await pause(300);
await page.mouse.down();
const to = { x: from.x + 260, y: from.y - 160 };
for (let i = 1; i <= 30; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 30, from.y + (to.y - from.y) * i / 30), await pause(40);
await pause(700);
await page.mouse.up();
await page.mouse.move(to.x + 120, to.y - 60, { steps: 10 });
await waitBubble(/\S/, 10_000).catch(() => {});
console.log('after drop:', await bubbleText());
await pause(3500);
const end = Date.now();

await context.close();
await browser.close();
server.close();

// Trim the page load, keep a moment before the first line.
const video = join(videoDir, readdirSync(videoDir).find((f) => f.endsWith('.webm')));
const ss = Math.max(0, (lineAt - start) / 1000 - 4.5);
const t = (end - start) / 1000 - ss;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', ss.toFixed(2), '-t', t.toFixed(2), '-i', video,
  '-vf', 'fps=15,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  OUT]);
rmSync(videoDir, { recursive: true, force: true });
console.log(`wrote ${OUT} (${t.toFixed(1)} s)`);
