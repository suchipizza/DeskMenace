// Explicit-frame atlas player.
//
// Each clip is one sprite atlas image, fetched and decoded once with createImageBitmap() and
// drawn frame by frame onto a single canvas. A clip may offer sharper atlases of the same frames;
// the player loads the smallest one that is sharp enough for the screen (falling back to less
// sharp ones if it fails) and sizes the canvas to its cells. Playback is time based (per-frame durations from
// the manifest). The scheduler sleeps on a timer until shortly before the next frame boundary
// and then paints in one requestAnimationFrame, so an idle character costs a few wake-ups per
// second instead of a 60-120 Hz loop. Nothing runs or paints while the document is hidden.

import type { AtlasTier, Clip } from '../characters/manifest';

export type PlayResult = 'ended' | 'interrupted' | 'stopped';

export interface PlayOptions {
  loop?: boolean;
  mirrored?: boolean;
}

export interface FrameState {
  clip: string | null;
  frame: number;
  mirrored: boolean;
  paused: boolean;
}

export class ClipLoadError extends Error {
  constructor(readonly clip: string, message: string) {
    super(`Clip "${clip}": ${message}`);
    this.name = 'ClipLoadError';
  }
}

/** Browser services, injectable for tests. */
export interface PlayerEnv {
  fetch(url: string, init: RequestInit): Promise<Response>;
  decode(blob: Blob): Promise<ImageBitmap>;
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  raf(fn: (t: number) => void): number;
  cancelRaf(id: number): void;
  isHidden(): boolean;
  onVisibility(fn: () => void): () => void;
}

export function browserEnv(): PlayerEnv {
  return {
    fetch: (u, i) => fetch(u, i),
    decode: (b) => createImageBitmap(b, { premultiplyAlpha: 'premultiply' }),
    now: () => performance.now(),
    setTimeout: (f, ms) => window.setTimeout(f, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    raf: (f) => requestAnimationFrame(f),
    cancelRaf: (id) => cancelAnimationFrame(id),
    isHidden: () => document.visibilityState === 'hidden',
    onVisibility(fn) {
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    },
  };
}

interface Resident {
  clip: Clip;
  tier: AtlasTier;
  bmp: ImageBitmap;
}

export interface ClipPlayerOptions {
  /** Called before a clip's first frame is painted, so the host can size and flip the canvas. */
  onClipChange?(clip: Clip, mirrored: boolean): void;
  /** Clip ids that are never evicted (normally the idle clip). */
  pinned?: string[];
  /** Maximum number of decoded clips kept in memory. */
  maxResident?: number;
  /**
   * Decoded-memory budget (RGBA bytes) for resident clips at 1x; it grows with the square of the
   * density of the sharpest resident atlas. Pinned and current clips always stay.
   */
  maxResidentBytes?: number;
  /**
   * Image pixels needed per clip pixel on this screen (display scale x devicePixelRatio). The
   * smallest atlas at least this sharp is loaded, else the sharpest one. Default 1.
   */
  density?(): number;
  env?: PlayerEnv;
}

/** Wake this long before a frame boundary, then paint on the next animation frame. */
const VSYNC_LEAD_MS = 12;
/** A stalled main thread may not fast-forward more than this in one step. */
const MAX_STEP_MS = 1000;

export class ClipPlayer {
  private readonly env: PlayerEnv;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly resident = new Map<string, Resident>();
  private readonly pending = new Map<string, { promise: Promise<Resident>; abort: AbortController }>();
  private readonly pinned: Set<string>;
  private readonly maxResident: number;
  private readonly maxBytes: number;
  private readonly offVisibility: () => void;
  private probe: CanvasRenderingContext2D | null = null;

  private gen = 0;
  private current: Resident | null = null;
  private mirrored = false;
  private loop = false;
  private paused = false;
  private frame = -1;
  private elapsed = 0;
  private last = 0;
  private needsPaint = false;
  private timer = 0;
  private raf = 0;
  private settle: ((r: PlayResult) => void) | null = null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly clips: Map<string, Clip>, private readonly opts: ClipPlayerOptions = {}) {
    this.env = opts.env ?? browserEnv();
    this.ctx = canvas.getContext('2d');
    this.pinned = new Set(opts.pinned ?? []);
    this.maxResident = Math.max(1, opts.maxResident ?? 3);
    this.maxBytes = opts.maxResidentBytes ?? 30 * 1024 * 1024;
    this.offVisibility = this.env.onVisibility(() => (this.env.isHidden() ? this.suspend() : this.wake()));
  }

  /** Fetches and decodes a clip. Concurrent calls share one request. */
  load(id: string): Promise<void> {
    return this.acquire(id).then(() => undefined);
  }

  /** Loads a clip in the background; failures are ignored here and reported when played. */
  prefetch(id: string): void {
    if (this.clips.has(id)) this.acquire(id).catch(() => {});
  }

  has(id: string): boolean {
    return this.resident.has(id);
  }

  private acquire(id: string): Promise<Resident> {
    if (this.disposed) return Promise.reject(new ClipLoadError(id, 'player disposed'));
    const hit = this.resident.get(id);
    if (hit) {
      this.resident.delete(id);
      this.resident.set(id, hit); // most recently used
      return Promise.resolve(hit);
    }
    const inflight = this.pending.get(id);
    if (inflight) return inflight.promise;
    const clip = this.clips.get(id);
    if (!clip) return Promise.reject(new ClipLoadError(id, 'unknown clip'));

    const abort = new AbortController();
    const promise = (async () => {
      // Preferred atlas first, then any less sharp ones as fallbacks.
      const tiers = this.tierOrder(clip);
      let failure: ClipLoadError | null = null;
      for (const tier of tiers) {
        try {
          const bmp = await this.fetchTier(id, tier, abort.signal);
          const r = { clip, tier, bmp };
          this.resident.set(id, r);
          this.evict(r);
          return r;
        } catch (e) {
          failure = e as ClipLoadError;
          if (this.disposed || abort.signal.aborted) break;
        }
      }
      throw failure ?? new ClipLoadError(id, 'no atlas');
    })();
    this.pending.set(id, { promise, abort });
    const done = () => this.pending.delete(id);
    promise.then(done, done);
    return promise;
  }

  /** The atlas this screen needs first, then less sharp fallbacks. */
  private tierOrder(clip: Clip): AtlasTier[] {
    const need = Math.max(1, this.opts.density?.() ?? 1);
    const t = clip.tiers;
    let k = t.findIndex((x) => x.density >= need - 0.05);
    if (k < 0) k = t.length - 1;
    return t.slice(0, k + 1).reverse();
  }

  private async fetchTier(id: string, tier: AtlasTier, signal: AbortSignal): Promise<ImageBitmap> {
    let res: Response;
    try {
      res = await this.env.fetch(tier.url, { mode: 'cors', credentials: 'omit', signal });
    } catch (e) {
      throw new ClipLoadError(id, signal.aborted ? 'load cancelled' : `network error (${(e as Error).message || e})`);
    }
    if (!res.ok) throw new ClipLoadError(id, `HTTP ${res.status}`);
    const bmp = await this.env.decode(await res.blob()).catch((e) => {
      throw new ClipLoadError(id, `could not decode image (${(e as Error).message || e})`);
    });
    if (this.disposed || signal.aborted) {
      bmp.close();
      throw new ClipLoadError(id, 'load cancelled');
    }
    const { columns, rows, w, h } = tier;
    if (bmp.width < columns * w || bmp.height < rows * h) {
      bmp.close();
      throw new ClipLoadError(id, `atlas is ${bmp.width}x${bmp.height}, smaller than its ${columns}x${rows} grid of ${w}x${h} frames`);
    }
    return bmp;
  }

  /** Evicts least recently used clips until both the count and the byte budget are met. */
  private evict(keep?: Resident): void {
    const bytes = () => {
      let n = 0;
      for (const r of this.resident.values()) n += r.bmp.width * r.bmp.height * 4;
      return n;
    };
    let d = 1;
    for (const r of this.resident.values()) d = Math.max(d, r.tier.density);
    const budget = this.maxBytes * d * d;
    for (const [id, r] of this.resident) {
      if (this.resident.size <= this.maxResident && bytes() <= budget) break;
      if (r === this.current || r === keep || this.pinned.has(id)) continue;
      r.bmp.close();
      this.resident.delete(id);
    }
  }

  /**
   * Plays a clip from frame 0. Resolves `ended` when a one-shot clip finishes (holding its last
   * frame), `interrupted` when another play() replaces it, `stopped` on stop()/dispose().
   * Rejects with ClipLoadError when the clip cannot be loaded.
   */
  async play(id: string, opts: PlayOptions = {}): Promise<PlayResult> {
    const g = ++this.gen;
    const r = await this.acquire(id);
    if (g !== this.gen || this.disposed) return this.disposed ? 'stopped' : 'interrupted';

    this.finish('interrupted');
    this.cancel();
    this.current = r;
    this.evict();
    this.mirrored = !!opts.mirrored;
    this.loop = opts.loop ?? r.clip.loop;
    this.paused = false;
    this.elapsed = 0;
    this.last = this.env.now();
    this.frame = -1;
    this.resize(r);
    const result = new Promise<PlayResult>((resolve) => (this.settle = resolve));
    if (this.env.isHidden()) this.needsPaint = true;
    else this.draw(this.last);
    this.schedule();
    return result;
  }

  /** Draws one still frame and schedules nothing (reduced motion, static fallback). */
  async showFrame(id: string, frame = 0, mirrored = false): Promise<void> {
    const g = ++this.gen;
    const r = await this.acquire(id);
    if (g !== this.gen || this.disposed) return;
    this.finish('interrupted');
    this.cancel();
    this.current = r;
    this.mirrored = mirrored;
    this.loop = false;
    this.paused = true;
    this.resize(r);
    const i = Math.min(Math.max(0, frame), r.clip.atlas.frames - 1);
    if (this.env.isHidden()) {
      this.frame = i;
      this.needsPaint = true;
    } else this.paint(r, i);
  }

  pause(): void {
    if (!this.current || this.paused) return;
    this.paused = true;
    this.cancel();
  }

  resume(): void {
    if (!this.current || !this.paused || this.settle === null) return; // nothing to resume after a one-shot ended
    this.paused = false;
    this.last = this.env.now();
    this.schedule();
  }

  /** Stops playback, clears the canvas and settles the pending play() with `stopped`. */
  stop(): void {
    this.gen++;
    this.cancel();
    this.current = null;
    this.paused = false;
    this.frame = -1;
    this.needsPaint = false;
    this.finish('stopped');
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  getCurrentFrame(): FrameState {
    return { clip: this.current?.clip.id ?? null, frame: this.frame, mirrored: this.mirrored, paused: this.paused };
  }

  /** Alpha (0-255) of the displayed frame at a point given in frame pixels. */
  alphaAt(fx: number, fy: number): number {
    const r = this.current;
    if (!r || this.frame < 0 || this.disposed) return 0;
    const { w, h } = r.clip;
    if (this.mirrored) fx = w - fx;
    if (fx < 0 || fy < 0 || fx >= w || fy >= h) return 0;
    const t = r.tier;
    if (!this.probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      this.probe = c.getContext('2d', { willReadFrequently: true });
    }
    const p = this.probe;
    if (!p) return 255;
    const sx = (this.frame % t.columns) * t.w + Math.min(t.w - 1, Math.floor((fx * t.w) / w));
    const sy = Math.floor(this.frame / t.columns) * t.h + Math.min(t.h - 1, Math.floor((fy * t.h) / h));
    try {
      p.clearRect(0, 0, 1, 1);
      p.drawImage(r.bmp, sx, sy, 1, 1, 0, 0, 1, 1);
      return p.getImageData(0, 0, 1, 1).data[3];
    } catch {
      return 255; // tainted or unavailable: fall back to the coarse rectangle
    }
  }

  stats(): { resident: string[]; pending: number; scheduled: boolean; rgbaBytes: number; density: Record<string, number> } {
    let rgba = 0;
    const density: Record<string, number> = {};
    for (const [id, r] of this.resident) {
      rgba += r.bmp.width * r.bmp.height * 4;
      density[id] = r.tier.density;
    }
    return { resident: [...this.resident.keys()], pending: this.pending.size, scheduled: !!(this.timer || this.raf), rgbaBytes: rgba, density };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    for (const p of this.pending.values()) p.abort.abort();
    for (const r of this.resident.values()) r.bmp.close();
    this.resident.clear();
    this.offVisibility();
    this.canvas.width = this.canvas.height = 0;
  }

  // ------------------------------------------------------------------ internals

  private finish(result: PlayResult): void {
    const s = this.settle;
    this.settle = null;
    s?.(result);
  }

  private resize(r: Resident): void {
    const { w, h } = r.tier;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.opts.onClipChange?.(r.clip, this.mirrored);
  }

  private schedule(): void {
    if (this.timer || this.raf || this.paused || !this.current || this.disposed || this.env.isHidden()) return;
    const { ends } = this.current.clip;
    const total = ends[ends.length - 1];
    const t = this.loop ? this.elapsed % total : this.elapsed;
    let next = total;
    for (const e of ends) if (e > t) { next = e; break; }
    const wait = next - t - VSYNC_LEAD_MS;
    const go = () => {
      this.timer = 0;
      this.raf = this.env.raf((now) => {
        this.raf = 0;
        if (this.paused || !this.current) return;
        this.draw(now);
        this.schedule();
      });
    };
    if (wait > 0) this.timer = this.env.setTimeout(go, wait);
    else go();
  }

  private draw(now: number): void {
    const r = this.current;
    if (!r) return;
    this.elapsed += Math.max(0, Math.min(now - this.last, MAX_STEP_MS));
    this.last = now;
    const { ends } = r.clip;
    const total = ends[ends.length - 1];
    let t = this.elapsed;
    if (t >= total) {
      if (this.loop) {
        t %= total;
        this.elapsed = t;
      } else {
        this.paint(r, ends.length - 1);
        this.current = r; // keep holding the last frame for hit tests
        this.paused = true;
        this.finish('ended');
        return;
      }
    }
    let i = 0;
    while (ends[i] <= t) i++;
    if (i !== this.frame || this.needsPaint) this.paint(r, i);
  }

  private paint(r: Resident, i: number): void {
    this.needsPaint = false;
    this.frame = i;
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h, columns: cols } = r.tier;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.bmp, (i % cols) * w, Math.floor(i / cols) * h, w, h, 0, 0, w, h);
  }

  private cancel(): void {
    if (this.timer) this.env.clearTimeout(this.timer);
    if (this.raf) this.env.cancelRaf(this.raf);
    this.timer = this.raf = 0;
  }

  private suspend(): void {
    this.cancel();
  }

  private wake(): void {
    if (!this.current) return;
    // No catch-up: the clock continues from where it was when the page was hidden.
    this.last = this.env.now();
    if (this.needsPaint) {
      if (this.paused) this.paint(this.current, Math.max(0, this.frame));
      else this.draw(this.last);
    }
    this.schedule();
  }
}
