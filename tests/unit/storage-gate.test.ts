import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../../src/ui/storage';
import { RuleGate } from '../../src/triggers/triggers';

describe('visitor preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    prefs._resetMemory();
  });

  it('persists removal in localStorage and mute in sessionStorage', () => {
    prefs.setDismissed(true);
    prefs.setMuted(true);
    expect(localStorage.getItem('gary.js:dismissed')).toBe('1');
    expect(sessionStorage.getItem('gary.js:muted')).toBe('1');
    prefs.setDismissed(false);
    expect(prefs.isDismissed()).toBe(false);
  });

  it('still remembers removal for this page when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => prefs.setDismissed(true)).not.toThrow();
    expect(prefs.isDismissed()).toBe(true);
  });
});

describe('trigger rule gate', () => {
  beforeEach(() => {
    sessionStorage.clear();
    prefs._resetMemory();
  });

  it('applies once, maxPerSession, cooldown and chance', () => {
    let now = 0;
    let rnd = 0.9;
    const g = new RuleGate('t', () => now, () => rnd);
    expect(g.eligible({ on: 'load', say: 'x', once: true }, 0)).toBe(true);
    g.record(0);
    expect(g.eligible({ on: 'load', say: 'x', once: true }, 0)).toBe(false);

    const cd = { on: 'click' as const, selector: 'a', say: 'x', cooldown: 10 };
    g.record(1);
    now = 5000;
    expect(g.eligible(cd, 1)).toBe(false);
    now = 10_001;
    expect(g.eligible(cd, 1)).toBe(true);

    const max = { on: 'click' as const, selector: 'a', say: 'x', maxPerSession: 2 };
    g.record(2);
    g.record(2);
    expect(g.eligible(max, 2)).toBe(false);

    expect(g.eligible({ on: 'load', say: 'x', chance: 0.5 }, 3)).toBe(false);
    rnd = 0.1;
    expect(g.eligible({ on: 'load', say: 'x', chance: 0.5 }, 3)).toBe(true);
  });
});
