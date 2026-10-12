import { describe, expect, it } from 'vitest';
import { ConfigError, defaults, mergeConfig, validateRule } from '../../src/boot/config';

describe('configuration', () => {
  it('has the documented defaults', () => {
    const d = defaults();
    expect(d.limits).toEqual({ minGapSeconds: 20, maxLinesPerMinute: 2 });
    expect(d.behaviours).toEqual(['enter', 'walk', 'idle', 'judge', 'say', 'drag', 'react-clicks', 'leave']);
    expect(d.announce).toBe(false);
    expect(d.character).toBeNull();
  });

  it('applies layers in order: later wins, arrays replace, objects merge by key', () => {
    let c = defaults();
    c = mergeConfig(c, { packs: ['core', 'boast'], vars: { owner: 'Sam' }, limits: { minGapSeconds: 5 } }, 'inline').config;
    c = mergeConfig(c, { packs: ['roast'], vars: { team: 'Ops' }, limits: { maxLinesPerMinute: 4 } }, 'data-config').config;
    c = mergeConfig(c, { vars: { owner: 'Alex' } }, 'init').config;
    expect(c.packs).toEqual(['roast']);
    expect(c.vars).toEqual({ owner: 'Alex', team: 'Ops' });
    expect(c.limits).toEqual({ minGapSeconds: 5, maxLinesPerMinute: 4 });
  });

  it('does not mutate the previous layer', () => {
    const a = defaults();
    mergeConfig(a, { vars: { x: '1' }, limits: { minGapSeconds: 1 } }, 'init');
    expect(a.vars).toEqual({});
    expect(a.limits.minGapSeconds).toBe(20);
  });

  it('ignores invalid fields with a warning and keeps the rest', () => {
    const { config, warnings } = mergeConfig(defaults(), { height: 'big', announce: 'yes', ambient: false, nope: 1 }, 'init');
    expect(config.ambient).toBe(false);
    expect(config.height).toBeNull();
    expect(warnings.join('\n')).toMatch(/"height"/);
    expect(warnings.join('\n')).toMatch(/"announce"/);
    expect(warnings.join('\n')).toMatch(/unknown option "nope"/);
  });

  it('drops unsupported behaviours', () => {
    const { config, warnings } = mergeConfig(defaults(), { behaviours: ['walk', 'phone', 'card', 'steal-cursor', 'say'] }, 'init');
    expect(config.behaviours).toEqual(['walk', 'say']);
    expect(warnings).toHaveLength(3);
  });

  it('accepts the US spelling "behaviors"', () => {
    expect(mergeConfig(defaults(), { behaviors: ['say'] }, 'init').config.behaviours).toEqual(['say']);
  });

  it('refuses an unknown schemaVersion and non-object configs', () => {
    expect(() => mergeConfig(defaults(), { schemaVersion: 2 }, 'init')).toThrow(ConfigError);
    expect(() => mergeConfig(defaults(), [1], 'init')).toThrow(ConfigError);
  });

  it('only accepts http(s) URLs for characters and credits', () => {
    const r = mergeConfig(defaults(), { character: 'javascript:alert(1)', menu: { credit: { label: 'x', url: 'javascript:alert(1)' } } }, 'init');
    expect(r.config.character).toBeNull();
    expect(r.config.menu.credit).toBeNull();
    expect(mergeConfig(defaults(), { menu: { credit: false } }, 'init').config.menu.credit).toBe(false);
    expect(mergeConfig(defaults(), { character: '/c/character.json' }, 'init').config.character).toMatch(/^http.*\/c\/character\.json$/);
  });

  it('rejects dangerous variable names', () => {
    const json = JSON.parse('{"vars":{"__proto__":"x","ok":"y"}}');
    const { config, warnings } = mergeConfig(defaults(), json, 'init');
    expect(config.vars).toEqual({ ok: 'y' });
    expect(Object.getPrototypeOf(config.vars)).toBe(Object.prototype);
    expect(warnings.join()).toMatch(/__proto__/);
  });

  it('validates trigger rules', () => {
    expect(validateRule({ on: 'hover', selector: '#a', say: '#boast', cooldown: 30 })).toEqual({ on: 'hover', selector: '#a', say: '#boast', cooldown: 30 });
    expect(validateRule({ on: 'hover', say: 'x' })).toMatch(/needs a selector/);
    expect(validateRule({ on: 'click', selector: '###', say: 'x' })).toMatch(/invalid selector/);
    expect(validateRule({ on: 'load' })).toMatch(/needs "say" or "do"/);
    expect(validateRule({ on: 'load', do: 'phone' })).toMatch(/not a supported/);
    expect(validateRule({ on: 'event', say: 'x' })).toMatch(/event name/);
    expect(validateRule({ on: 'teleport', say: 'x' })).toMatch(/unknown trigger/);
    expect(validateRule({ on: 'load', say: 'x', chance: 2 })).toMatch(/chance/);
  });

  it('keeps valid trigger rules and drops invalid ones', () => {
    const { config, warnings } = mergeConfig(defaults(), { triggers: [{ on: 'load', say: 'hi' }, { on: 'hover', say: 'x' }] }, 'init');
    expect(config.triggers).toEqual([{ on: 'load', say: 'hi' }]);
    expect(warnings).toHaveLength(1);
  });
});
