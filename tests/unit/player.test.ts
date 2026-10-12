import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipLoadError, ClipPlayer, type PlayerEnv } from '../../src/render/clip-player';
import { parseCharacter } from '../../src/characters/manifest';
import { BASE, clip, manifest } from '../fixtures/manifests';

/** Deterministic clock with timers and 60 Hz animation frames. */
class FakeClock {
  now = 0;
  private seq = 0;
  private q: { at: number; id: number; fn: (t: number) => void }[] = [];
  hidden = false;
  private vis = new Set<() => void>();
  wakeups = 0;

  add(at: number, fn: (t: number) => void): number {
    const id = ++this.seq;
    this.q.push({ at, id, fn });
    return id;
  }
  cancel(id: number) {
    this.q = this.q.filter((e) => e.id !== id);
  }
  pendingCount() {
    return this.q.length;
  }
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const e = this.q[0];
      if (!e || e.at > end) break;
      this.q.shift();
      this.now = e.at;
      this.wakeups++;
      e.fn(this.now);
      await Promise.resolve();
    }
    this.now = end;
    await flush();
  }
  setHidden(h: boolean) {
    this.hidden = h;
    for (const f of this.vis) f();
  }
  env(over: Partial<PlayerEnv> = {}): PlayerEnv {
    return {
      fetch: async () => ({ ok: true, status: 200, blob: async () => new Blob(['x']) }) as unknown as Response,
      decode: async () => fakeBitmap(400, 400),
      now: () => this.now,
      setTimeout: (fn, ms) => this.add(this.now + ms, () => fn()),
      clearTimeout: (id) => this.cancel(id),
      // next vsync on a 60 Hz grid
      raf: (fn) => this.add(Math.floor(this.now / 16.667 + 1) * 16.667, fn),
      cancelRaf: (id) => this.cancel(id),
      isHidden: () => this.hidden,
      onVisibility: (fn) => {
        this.vis.add(fn);
        return () => this.vis.delete(fn);
      },
      ...over,
    };
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

function setup(clips?: Record<string, unknown>, envOver: Partial<PlayerEnv> = {}, opts: { maxResident?: number; maxResidentBytes?: number } = {}) {
  const clock = new FakeClock();
  const ch = parseCharacter(
    manifest({}, clips ?? {
      idle: clip(),
      once: clip({ role: 'judge', loop: false, frameMs: [100, 200, 300, 400] }),
      a: clip({ role: 'a' }),
      b: clip({ role: 'b' }),
      c: clip({ role: 'c' }),
    }),
    BASE,
  );
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 0;
  const changes: string[] = [];
  const player = new ClipPlayer(canvas, ch.clips, { env: clock.env(envOver), pinned: ['idle'], onClipChange: (c) => changes.push(c.id), ...opts });
  return { clock, player, canvas, changes, ch };
}

describe('ClipPlayer', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('advances frames by manifest timing and loops', async () => {
    const { clock, player } = setup();
    void player.play('idle');
    await flush();
    expect(player.getCurrentFrame()).toMatchObject({ clip: 'idle', frame: 0 });
    await clock.advance(105);
    expect(player.getCurrentFrame().frame).toBe(1);
    await clock.advance(300);
    expect(player.getCurrentFrame().frame).toBe(0); // looped (400 ms clip)
  });

  it('sizes the canvas to the frame before the first paint', async () => {
    const { player, canvas, changes } = setup();
    expect(canvas.width).toBe(0);
    void player.play('idle');
    await flush();
    expect([canvas.width, canvas.height]).toEqual([100, 200]);
    expect(changes).toEqual(['idle']);
  });

  it('wakes only near frame boundaries (no 60 Hz loop)', async () => {
    const { clock, player } = setup();
    void player.play('idle');
    await flush();
    clock.wakeups = 0;
    await clock.advance(4000); // 40 frames of 100 ms
    // one timer + one rAF per frame
    expect(clock.wakeups).toBeLessThanOrEqual(82);
    expect(clock.wakeups).toBeGreaterThanOrEqual(78);
  });

  it('resolves a one-shot with "ended" and holds the last frame', async () => {
    const { clock, player } = setup();
    const p = player.play('once');
    await flush();
    await clock.advance(1050);
    await expect(p).resolves.toBe('ended');
    expect(player.getCurrentFrame()).toMatchObject({ clip: 'once', frame: 3 });
    expect(player.stats().scheduled).toBe(false);
  });

  it('keeps one-shot duration time-based', async () => {
    const { clock, player } = setup();
    let ended = false;
    void player.play('once').then(() => (ended = true));
    await flush();
    await clock.advance(990);
    expect(ended).toBe(false);
    await clock.advance(20); // next vsync after 1000 ms
    expect(ended).toBe(true);
  });

  it('pause holds the current frame and resume continues from it', async () => {
    const { clock, player } = setup();
    void player.play('once');
    await flush();
    await clock.advance(350); // frame 2 spans 300..600 ms
    expect(player.getCurrentFrame().frame).toBe(2);
    await clock.advance(10);
    player.pause();
    const f = player.getCurrentFrame().frame;
    await clock.advance(5000);
    expect(player.getCurrentFrame()).toMatchObject({ frame: f, paused: true });
    expect(player.stats().scheduled).toBe(false);
    player.resume();
    await clock.advance(320); // the clock resumes from the paused position
    expect(player.getCurrentFrame().frame).toBe(f + 1);
  });

  it('settles interrupted and stopped plays', async () => {
    const { clock, player } = setup();
    const a = player.play('idle');
    await flush();
    const b = player.play('once');
    await expect(a).resolves.toBe('interrupted');
    player.stop();
    await expect(b).resolves.toBe('stopped');
    await clock.advance(1000);
    expect(clock.pendingCount()).toBe(0);
  });

  it('survives 20 rapid transitions with one scheduler', async () => {
    const { clock, player } = setup();
    const results: Promise<string>[] = [];
    for (let i = 0; i < 20; i++) results.push(player.play(i % 2 ? 'once' : 'idle'));
    await flush();
    const settled = await Promise.all(results.slice(0, 19));
    expect(settled.every((r) => r === 'interrupted')).toBe(true);
    expect(clock.pendingCount()).toBeLessThanOrEqual(1);
    expect(player.getCurrentFrame().clip).toBe('once');
  });

  it('a stale load cannot replace a newer clip', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { player } = setup(undefined, {
      fetch: async (url) => {
        if (String(url).includes('slow')) await gate;
        return { ok: true, status: 200, blob: async () => new Blob(['x']) } as unknown as Response;
      },
    });
    // give clip "a" a different URL so it is slow
    (player as unknown as { clips: Map<string, { atlas: { url: string } }> }).clips.get('a')!.atlas.url = 'https://x/slow.webp';
    const slow = player.play('a');
    const fast = player.play('idle');
    await flush();
    release();
    await expect(slow).resolves.toBe('interrupted');
    expect(player.getCurrentFrame().clip).toBe('idle');
    player.stop();
    await expect(fast).resolves.toBe('stopped');
  });

  it('does not paint or schedule while hidden, and does not catch up afterwards', async () => {
    const { clock, player } = setup();
    clock.setHidden(true);
    void player.play('idle');
    await flush();
    expect(player.getCurrentFrame().frame).toBe(-1); // nothing painted yet
    await clock.advance(5000);
    expect(clock.wakeups).toBe(0);
    clock.setHidden(false);
    expect(player.getCurrentFrame().frame).toBe(0);
    await clock.advance(105);
    expect(player.getCurrentFrame().frame).toBe(1);
  });

  it('suspends mid-clip when hidden and resumes without a jump', async () => {
    const { clock, player } = setup();
    void player.play('once');
    await flush();
    await clock.advance(350);
    clock.setHidden(true);
    const f = player.getCurrentFrame().frame;
    await clock.advance(10_000);
    expect(player.getCurrentFrame().frame).toBe(f);
    clock.setHidden(false);
    await clock.advance(20);
    expect(player.getCurrentFrame().frame).toBe(f);
  });

  it('bounds resident clips (pinned idle stays) and closes evicted bitmaps', async () => {
    const bitmaps: ReturnType<typeof fakeBitmap>[] = [];
    const { player } = setup(undefined, { decode: async () => { const b = fakeBitmap(200, 400); bitmaps.push(b); return b; } }, { maxResident: 3 });
    for (const id of ['idle', 'a', 'b', 'c', 'once']) {
      void player.play(id);
      await flush();
    }
    const s = player.stats();
    expect(s.resident.length).toBeLessThanOrEqual(3);
    expect(s.resident).toContain('idle');
    expect(s.resident).toContain('once');
    expect(bitmaps.filter((b) => b.close.mock.calls.length > 0).length).toBe(2);
  });

  it('respects the decoded-memory budget', async () => {
    const { player } = setup(undefined, { decode: async () => fakeBitmap(1000, 1000) }, { maxResident: 5, maxResidentBytes: 9_000_000 });
    for (const id of ['idle', 'a', 'b', 'c']) {
      void player.play(id);
      await flush();
    }
    expect(player.stats().rgbaBytes).toBeLessThanOrEqual(9_000_000);
    expect(player.stats().resident).toEqual(expect.arrayContaining(['idle', 'c']));
  });

  it('rejects atlases smaller than their grid', async () => {
    const { player } = setup(undefined, { decode: async () => fakeBitmap(100, 100) });
    await expect(player.play('idle')).rejects.toBeInstanceOf(ClipLoadError);
  });

  it('reports HTTP and network failures as ClipLoadError', async () => {
    const http = setup(undefined, { fetch: async () => ({ ok: false, status: 404 }) as Response });
    await expect(http.player.play('idle')).rejects.toThrow(/HTTP 404/);
    const net = setup(undefined, { fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(net.player.load('idle')).rejects.toThrow(/network error/);
    const unknown = setup();
    await expect(unknown.player.play('nope')).rejects.toThrow(/unknown clip/);
  });

  it('dispose during loading closes the late bitmap and settles callers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const bmp = fakeBitmap(400, 400);
    const { player } = setup(undefined, { decode: async () => { await gate; return bmp; } });
    const p = player.play('idle');
    await flush();
    player.dispose();
    release();
    await expect(p).rejects.toBeInstanceOf(ClipLoadError);
    expect(bmp.close).toHaveBeenCalled();
    expect(player.stats().resident).toEqual([]);
  });

  it('dispose during playback stops everything', async () => {
    const { clock, player, canvas } = setup();
    const p = player.play('idle');
    await flush();
    await clock.advance(250);
    player.dispose();
    await expect(p).resolves.toBe('stopped');
    expect(clock.pendingCount()).toBe(0);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    await expect(player.play('idle')).rejects.toBeInstanceOf(ClipLoadError);
  });

  it('runs 9 drag/drop cycles (held loop -> one-shot -> idle) cleanly', async () => {
    const { clock, player } = setup();
    for (let i = 0; i < 9; i++) {
      const held = player.play('a', { loop: true });
      await flush();
      await clock.advance(300);
      const drop = player.play('once');
      await flush();
      await expect(held).resolves.toBe('interrupted');
      await clock.advance(1100);
      await expect(drop).resolves.toBe('ended');
      void player.play('idle');
      await clock.advance(200);
    }
    expect(clock.pendingCount()).toBeLessThanOrEqual(1);
    expect(player.stats().resident.length).toBeLessThanOrEqual(3);
  });

  it('showFrame draws one still frame and schedules nothing', async () => {
    const { clock, player } = setup();
    await player.showFrame('idle', 2);
    expect(player.getCurrentFrame()).toMatchObject({ clip: 'idle', frame: 2, paused: true });
    await clock.advance(2000);
    expect(clock.wakeups).toBe(0);
  });

  it('mirrors hit-test coordinates for mirrored clips', async () => {
    const { player } = setup();
    void player.play('idle', { mirrored: true });
    await flush();
    expect(player.getCurrentFrame().mirrored).toBe(true);
    expect(player.alphaAt(-5, 10)).toBe(0); // outside the frame
  });
});
