// Small manifest builders for tests. Not real artwork: the atlas URLs are never fetched in unit tests.
export function clip(over: Record<string, unknown> = {}) {
  return {
    role: 'idle',
    loop: true,
    load: 'initial',
    size: [100, 200],
    anchor: { feet: [0.5, 1] },
    hit: [10, 10, 80, 190],
    frameMs: [100, 100, 100, 100],
    sources: [{ type: 'atlas', url: 'atlas/idle.webp', grid: { columns: 2, rows: 2, frames: 4 } }],
    ...over,
  };
}

export function manifest(over: Record<string, unknown> = {}, clips?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    id: 'tester',
    name: 'Tester',
    licence: 'CC0-1.0',
    assetRevision: '1',
    clips: clips ?? {
      idle: clip(),
      walk: clip({ role: 'walk.right', mirror: true, load: 'initial', sources: [{ type: 'atlas', url: 'atlas/walk.webp', grid: { columns: 4, rows: 1, frames: 4 } }] }),
    },
    ...over,
  };
}

export const BASE = 'https://cdn.example.net/chars/tester/character.json';
