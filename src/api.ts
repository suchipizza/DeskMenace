// Public API facade. One facade drives at most one character instance at a time; calling
// init() again updates that instance instead of creating a second overlay.

import type { GaryAPI, GaryConfig, ResolvedConfig } from './types';
import { ConfigError, defaults, mergeConfig } from './boot/config';
import { Engine, PRIORITY } from './runtime/engine';
import { prefs } from './ui/storage';
import { Emitter } from './util/events';

declare const __VERSION__: string;
export const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

export interface CreateOptions {
  /** Manifest URL used when the configuration names no character. */
  defaultCharacter?: string | null;
  /** Config layers applied before init() arguments (inline JSON, data-config). */
  base?: ResolvedConfig;
  /** init() waits for this before reading `base`. */
  baseReady?: Promise<void>;
}

export function createGary(options: CreateOptions = {}): GaryAPI & { _debug(): unknown } {
  const events = new Emitter();
  let engine: Engine | null = null;
  let config: ResolvedConfig | null = null;
  let lastInit: GaryConfig | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  let pending: Promise<void> | null = null;

  const reportError = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn(`[gary.js] ${err.message}`);
    events.emit('error', err);
  };

  events.on('_remove', () => api.dismiss());
  events.on('entered', () => events.emit('ready'));

  function resolveConfig(cfg?: GaryConfig): ResolvedConfig {
    const { config: c, warnings } = mergeConfig(options.base ?? defaults(), cfg, 'Gary.init()');
    for (const w of warnings) console.warn(`[gary.js] ${w}`);
    if (!c.character && options.defaultCharacter) c.character = options.defaultCharacter;
    return c;
  }

  async function doInit(cfg?: GaryConfig): Promise<void> {
    lastInit = cfg;
    let next: ResolvedConfig;
    try {
      next = resolveConfig(cfg);
    } catch (e) {
      reportError(e instanceof ConfigError ? e : new ConfigError(String(e)));
      resolveReady();
      return;
    }
    if (!next.enabled || prefs.isDismissed()) {
      engine?.destroy();
      engine = null;
      config = next;
      resolveReady();
      return;
    }
    if (engine && engine.alive && config && config.character === next.character && config.height === next.height && config.zIndex === next.zIndex) {
      config = next;
      engine.applyContent(next);
      resolveReady();
      return;
    }
    engine?.destroy();
    config = next;
    const e = (engine = new Engine(next, events));
    const off = events.on('state', (s) => {
      if (s === 'failed' || s === 'dismissed' || s === 'destroyed') off();
    });
    await e.start();
    resolveReady();
  }

  const api: GaryAPI & { _debug(): unknown } = {
    ready,
    version: VERSION,

    init(cfg?: GaryConfig): Promise<void> {
      // Serialise init calls so two quick calls never race into two overlays.
      const run = (pending ?? Promise.resolve())
        .then(() => options.baseReady)
        .then(() => doInit(cfg))
        .catch(reportError);
      pending = run;
      return run.then(() => {
        if (pending === run) pending = null;
      });
    },

    say(textOrTag: string): Promise<boolean> {
      if (typeof textOrTag !== 'string' || !engine) return Promise.resolve(false);
      return engine.say(textOrTag, PRIORITY.api).catch(() => false);
    },

    do(behavior: string): Promise<boolean> {
      if (typeof behavior !== 'string' || !engine) return Promise.resolve(false);
      return engine.do(behavior, PRIORITY.api).catch(() => false);
    },

    mute(): void {
      prefs.setMuted(true);
      engine?.mute();
    },

    unmute(): void {
      prefs.setMuted(false);
      engine?.unmute();
    },

    dismiss(): void {
      const was = prefs.isDismissed();
      prefs.setDismissed(true);
      if (engine) engine.dismiss();
      if (!was) events.emit('dismissed');
    },

    reset(): void {
      prefs.setDismissed(false);
      prefs.setMuted(false);
      if (!engine || !engine.alive) {
        engine = null;
        void api.init(lastInit);
      }
    },

    emit(name: string, detail?: unknown): void {
      if (typeof name !== 'string' || name.startsWith('_')) return;
      void detail;
      engine?.emit(name);
    },

    on(name: string, handler: (detail?: unknown) => void): () => void {
      if (typeof name !== 'string' || name.startsWith('_')) return () => {};
      return events.on(name, handler);
    },

    destroy(): void {
      engine?.destroy();
      engine = null;
    },

    _debug(): unknown {
      return engine ? { ...engine.snapshot(), character: engine.character?.id ?? null } : null;
    },
  };
  return api;
}
