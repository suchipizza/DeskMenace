// Visitor preferences. Removal is stored per origin in localStorage; mute lasts for the session.
// Storage can be unavailable (private mode, blocked site data): every access is guarded and an
// in-memory value is used instead, so a removal still holds for the current page.

const PREFIX = 'gary.js:';
const memory = new Map<string, string>();

function get(store: 'local' | 'session', key: string): string | null {
  try {
    const s = store === 'local' ? window.localStorage : window.sessionStorage;
    const v = s.getItem(PREFIX + key);
    if (v !== null) return v;
  } catch {
    /* storage unavailable */
  }
  return memory.get(`${store}:${key}`) ?? null;
}

function set(store: 'local' | 'session', key: string, value: string | null): void {
  if (value === null) memory.delete(`${store}:${key}`);
  else memory.set(`${store}:${key}`, value);
  try {
    const s = store === 'local' ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(PREFIX + key);
    else s.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable */
  }
}

export const prefs = {
  isDismissed: () => get('local', 'dismissed') === '1',
  setDismissed: (v: boolean) => set('local', 'dismissed', v ? '1' : null),
  isMuted: () => get('session', 'muted') === '1',
  setMuted: (v: boolean) => set('session', 'muted', v ? '1' : null),
  /** Small per-session counters for `maxPerSession` and `once` trigger rules. */
  getCount: (key: string) => Number(get('session', `n:${key}`)) || 0,
  setCount: (key: string, n: number) => set('session', `n:${key}`, String(n)),
  /** Test helper: forgets the in-memory fallback. */
  _resetMemory: () => memory.clear(),
};
