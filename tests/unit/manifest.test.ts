import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCharacter, ManifestError } from '../../src/characters/manifest';
import { BASE, clip, manifest } from '../fixtures/manifests';

const errorsOf = (m: unknown) => {
  try {
    parseCharacter(m, BASE);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError);
    return (e as ManifestError).problems;
  }
};

describe('character manifest', () => {
  it('accepts the bundled sample character', () => {
    const json = JSON.parse(readFileSync('characters/sample/character.json', 'utf8'));
    const ch = parseCharacter(json, 'http://localhost/characters/sample/character.json');
    expect(ch.id).toBe('mugsy');
    expect(ch.roles.get('idle')).toBe('idle');
    expect(ch.walk.right).toEqual({ clip: 'walk', mirrored: false });
    expect(ch.walk.left).toEqual({ clip: 'walk', mirrored: true });
    expect(ch.roles.has('judge.pointer')).toBe(false);
    expect(ch.clips.get('idle')!.atlas.url).toBe('http://localhost/characters/sample/atlas/idle.webp');
  });

  it('resolves clip URLs against the manifest URL, not the page', () => {
    const ch = parseCharacter(manifest(), BASE);
    expect(ch.clips.get('idle')!.atlas.url).toBe('https://cdn.example.net/chars/tester/atlas/idle.webp');
  });

  it('computes frame end times and duration', () => {
    const ch = parseCharacter(manifest(), BASE);
    expect(ch.clips.get('idle')!.ends).toEqual([100, 200, 300, 400]);
    expect(ch.clips.get('idle')!.durationMs).toBe(400);
  });

  it('only mirrors clips that allow it', () => {
    const m = manifest({}, { idle: clip(), walk: clip({ role: 'walk.right' }) });
    const ch = parseCharacter(m, BASE);
    expect(ch.walk.left).toBeNull();
    expect(ch.walk.right).toEqual({ clip: 'walk', mirrored: false });
  });

  it('works with only an idle clip (static character) and warns', () => {
    const ch = parseCharacter(manifest({}, { idle: clip() }), BASE);
    expect(ch.walk.left).toBeNull();
    expect(ch.warnings.join()).toMatch(/no walk clip/);
  });

  it('requires an idle role', () => {
    expect(errorsOf(manifest({}, { a: clip({ role: 'walk.right' }) })).join()).toMatch(/role "idle" is required/);
  });

  it('rejects unknown schema versions', () => {
    expect(errorsOf(manifest({ schemaVersion: 2 })).join()).toMatch(/schemaVersion/);
    expect(errorsOf(manifest({ schemaVersion: 0 })).join()).toMatch(/schemaVersion/);
  });

  it('rejects frame timing that does not match the grid', () => {
    const bad = clip({ frameMs: [100, 100, 100] });
    expect(errorsOf(manifest({}, { idle: bad })).join()).toMatch(/grid.frames/);
  });

  it('rejects grids too small for the frame count', () => {
    const bad = clip({ sources: [{ type: 'atlas', url: 'a.webp', grid: { columns: 1, rows: 2, frames: 4 } }] });
    expect(errorsOf(manifest({}, { idle: bad })).join()).toMatch(/do not fit/);
  });

  it('rejects non-positive and non-numeric frame durations', () => {
    expect(errorsOf(manifest({}, { idle: clip({ frameMs: [100, 0, 100, 100] }) })).join()).toMatch(/frameMs/);
    expect(errorsOf(manifest({}, { idle: clip({ frameMs: [100, '1', 100, 100] }) })).join()).toMatch(/frameMs/);
  });

  it('rejects a durationMs that disagrees with frameMs', () => {
    expect(errorsOf(manifest({}, { idle: clip({ durationMs: 999 }) })).join()).toMatch(/durationMs/);
  });

  it('rejects feet anchors outside 0..1', () => {
    expect(errorsOf(manifest({}, { idle: clip({ anchor: { feet: [1.2, 1] } }) })).join()).toMatch(/feet/);
  });

  it('accepts negative hit rectangle origins (extremities outside the frame)', () => {
    const ch = parseCharacter(manifest({}, { idle: clip({ hit: [-8, 0, 227, 199] }) }), BASE);
    expect(ch.clips.get('idle')!.hit).toEqual([-8, 0, 227, 199]);
  });

  it('rejects javascript: and other non-http URLs', () => {
    const bad = clip({ sources: [{ type: 'atlas', url: 'javascript:alert(1)', grid: { columns: 2, rows: 2, frames: 4 } }] });
    expect(errorsOf(manifest({}, { idle: bad })).join()).toMatch(/url/);
    expect(errorsOf(manifest({ menu: { credit: { label: 'x', url: 'javascript:alert(1)' } } })).join()).toMatch(/menu.credit/);
    expect(errorsOf(manifest({ licence: { name: 'x', url: 'data:text/html,hi' } })).join()).toMatch(/licence.url/);
  });

  it('never lets ids or pool names touch Object.prototype', () => {
    const json = '{"schemaVersion":1,"id":"t","name":"T","licence":"x","assetRevision":"1","clips":{"__proto__":{}},"lines":{"__proto__":["x"]}}';
    const problems = errorsOf(JSON.parse(json));
    expect(problems.join()).toMatch(/invalid clip id/);
    expect(problems.join()).toMatch(/invalid pool name/);
    expect(({} as Record<string, unknown>).size).toBeUndefined();
  });

  it('keeps the first clip when two clips claim one role', () => {
    const ch = parseCharacter(manifest({}, { idle: clip(), idle2: clip() }), BASE);
    expect(ch.roles.get('idle')).toBe('idle');
    expect(ch.warnings.join()).toMatch(/first one wins/);
  });

  it('ignores unknown source types but needs one atlas', () => {
    const c = clip({ sources: [{ type: 'video', url: 'a.webm' }] });
    expect(errorsOf(manifest({}, { idle: c })).join()).toMatch(/no supported source/);
    const ok = clip({ sources: [{ type: 'video', url: 'a.webm' }, ...clip().sources] });
    expect(parseCharacter(manifest({}, { idle: ok }), BASE).clips.size).toBe(1);
  });

  it('validates display, poster, bubble and credit', () => {
    const ch = parseCharacter(manifest({ display: { height: 320, minHeight: 160, walkSpeed: 110 }, poster: { clip: 'idle', frame: 3 }, bubble: { anchor: [0.4, 0.1] }, menu: { credit: null } }), BASE);
    expect([ch.height, ch.minHeight, ch.walkSpeed]).toEqual([320, 160, 110]);
    expect(ch.poster).toEqual({ clip: 'idle', frame: 3 });
    expect(ch.bubbleAnchor).toEqual([0.4, 0.1]);
    expect(ch.credit).toBeNull();
    expect(errorsOf(manifest({ poster: { clip: 'idle', frame: 4 } })).join()).toMatch(/poster.frame/);
    expect(errorsOf(manifest({ display: { height: 5 } })).join()).toMatch(/display.height/);
  });

  it('validates line pools', () => {
    const ch = parseCharacter(manifest({ lines: { core: ['a', { text: 'b', weight: 2 }] } }), BASE);
    expect(ch.lines.get('core')).toEqual(['a', { text: 'b', weight: 2 }]);
    expect(errorsOf(manifest({ lines: { core: [''] } })).join()).toMatch(/lines.core\[0\]/);
    expect(errorsOf(manifest({ lines: { core: 'nope' } })).join()).toMatch(/lines.core/);
  });

  it('rejects non-objects outright', () => {
    expect(errorsOf(null).join()).toMatch(/JSON object/);
    expect(errorsOf([]).join()).toMatch(/JSON object/);
  });

  describe('sharper atlases', () => {
    const src = (url: string, size?: unknown) => ({ type: 'atlas', url, ...(size ? { size } : {}), grid: { columns: 2, rows: 2, frames: 4 } });
    const parse = (sources: unknown[]) => parseCharacter(manifest({}, { idle: clip({ sources }) }), BASE);

    it('orders atlases by density, lowest first', () => {
      const c = parse([src('hd.webp', [200, 400]), src('sd.webp')]).clips.get('idle')!;
      expect(c.tiers.map((t) => [t.url.split('/').pop(), t.w, t.h, t.density])).toEqual([
        ['sd.webp', 100, 200, 1],
        ['hd.webp', 200, 400, 2],
      ]);
      expect(c.atlas.url).toMatch(/sd\.webp$/);
    });

    it('allows a character with only a sharp atlas', () => {
      const c = parse([src('hd.webp', [178, 356])]).clips.get('idle')!;
      expect(c.tiers).toHaveLength(1);
      expect(c.atlas.density).toBe(1.78);
    });

    it('keeps the first of two atlases with the same size', () => {
      const c = parse([src('a.webp'), src('b.webp', [100, 200])]).clips.get('idle')!;
      expect(c.tiers.map((t) => t.url.split('/').pop())).toEqual(['a.webp']);
    });

    it('rejects sizes that are smaller, too large, distorted or malformed', () => {
      for (const size of [[50, 100], [500, 1000], [300, 400], [200.5, 400], [200], 'big']) {
        expect(() => parse([src('a.webp'), src('x.webp', size)]), JSON.stringify(size)).toThrow(/size/);
      }
    });

    it('checks the 16384 px limit on the sharp atlas', () => {
      const big = { type: 'atlas', url: 'x.webp', size: [400, 800], grid: { columns: 41, rows: 1, frames: 4 } };
      expect(() => parse([big])).toThrow(/16384/);
    });
  });
});
