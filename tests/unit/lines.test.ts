import { describe, expect, it } from 'vitest';
import { interpolate, LineBook, SpeechLimiter } from '../../src/content/lines';

const pools = (o: Record<string, (string | { text: string; weight?: number })[]>) => new Map(Object.entries(o));

describe('line pools', () => {
  it('never repeats the previous line when there is a choice', () => {
    const book = new LineBook([pools({ core: ['a', 'b', 'c'] })]);
    let prev = '';
    for (let i = 0; i < 300; i++) {
      const t = book.pick('core')!;
      expect(t).not.toBe(prev);
      prev = t;
    }
  });

  it('returns the only line of a single-line pool every time', () => {
    const book = new LineBook([pools({ solo: ['only me'] })]);
    for (let i = 0; i < 5; i++) expect(book.pick('solo')).toBe('only me');
  });

  it('respects weights', () => {
    const book = new LineBook([pools({ w: [{ text: 'rare', weight: 1 }, { text: 'common', weight: 9 }, { text: 'other', weight: 1 }, { text: 'x', weight: 0 }] })]);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const t = book.pick('w')!;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    expect(counts.x).toBeUndefined();
    // "no immediate repeat" caps "common" at half the picks; it still clearly dominates.
    expect(counts.common).toBeGreaterThan(counts.rare * 1.5);
  });

  it('resolves #pool tags and literals; missing pools give null', () => {
    const book = new LineBook([pools({ core: ['x'] })]);
    expect(book.resolve('#core')).toBe('x');
    expect(book.resolve('#nope')).toBeNull();
    expect(book.resolve('hello')).toBe('hello');
    expect(book.resolve('   ')).toBeNull();
    expect(book.pickAny(['nope', 'core'])).toBe('x');
  });

  it('later sources replace whole pools', () => {
    const book = new LineBook([pools({ core: ['a', 'b'] }), pools({ core: ['c'] })]);
    expect(book.pick('core')).toBe('c');
  });
});

describe('interpolation', () => {
  it('replaces known variables and removes unknown ones', () => {
    expect(interpolate('Hi {owner}, welcome to {site}.', { owner: 'Sam', site: 'x.dev' })).toBe('Hi Sam, welcome to x.dev.');
    expect(interpolate('Built by {owner}.', {})).toBe('Built by.');
  });

  it('leaves markup as literal text (it is only ever inserted with textContent)', () => {
    const out = interpolate('{v}', { v: '<img src=x onerror=alert(1)>' });
    expect(out).toBe('<img src=x onerror=alert(1)>');
  });

  it('does not read inherited properties', () => {
    expect(interpolate('{constructor}{toString}', {})).toBe('');
  });
});

describe('speech limiter', () => {
  it('enforces the minimum gap and the per-minute cap', () => {
    let now = 0;
    const l = new SpeechLimiter({ minGapSeconds: 10, maxLinesPerMinute: 2 }, () => now);
    expect(l.canSpeak()).toBe(true);
    l.record();
    now = 5_000;
    expect(l.canSpeak()).toBe(false);
    now = 11_000;
    expect(l.canSpeak()).toBe(true);
    l.record();
    now = 30_000;
    expect(l.canSpeak()).toBe(false); // 2 lines in the last minute
    now = 61_000;
    expect(l.canSpeak()).toBe(true);
  });
});
