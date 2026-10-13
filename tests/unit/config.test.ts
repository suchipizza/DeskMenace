import { describe, expect, it } from 'vitest';
import { applyPreset, ConfigError, defaults, mergeConfig, validateRule, validateScene } from '../../src/boot/config';

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

  it('accepts quality auto, standard or high', () => {
    expect(defaults().quality).toBe('auto');
    expect(mergeConfig(defaults(), { quality: 'standard' }, 'init').config.quality).toBe('standard');
    expect(mergeConfig(defaults(), { quality: 'high' }, 'init').config.quality).toBe('high');
    const bad = mergeConfig(defaults(), { quality: 'ultra' }, 'init');
    expect(bad.config.quality).toBe('auto');
    expect(bad.warnings.join()).toMatch(/"quality"/);
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
    expect(validateRule({ on: 'load' })).toMatch(/needs "say", "do" or "scene"/);
    expect(validateRule({ on: 'load', do: 'phone' })).toMatch(/not a supported/);
    expect(validateRule({ on: 'event', say: 'x' })).toMatch(/event name/);
    expect(validateRule({ on: 'teleport', say: 'x' })).toMatch(/unknown trigger/);
    expect(validateRule({ on: 'load', say: 'x', chance: 2 })).toMatch(/chance/);
  });

  it('validates scene rules, escalation groups and the new triggers', () => {
    expect(validateRule({ on: 'click', scene: 'stare' })).toEqual({ on: 'click', scene: ['stare'] });
    expect(validateRule({ on: 'scrolling', scene: ['a', 'b'], group: 'annoyed', cooldown: 4 })).toEqual({ on: 'scrolling', scene: ['a', 'b'], group: 'annoyed', cooldown: 4 });
    expect(validateRule({ on: 'near', distance: 120, do: 'judge' })).toEqual({ on: 'near', distance: 120, do: 'judge' });
    expect(validateRule({ on: 'click', scene: [] })).toMatch(/scene must be/);
    expect(validateRule({ on: 'click', scene: 'a b' })).toMatch(/scene must be/);
    expect(validateRule({ on: 'click', say: 'x', group: '' })).toMatch(/group/);
    expect(validateRule({ on: 'near', say: 'x', distance: -1 })).toMatch(/distance/);
  });

  it('validates scenes step by step', () => {
    expect(validateScene([{ walkTo: '#title', at: 'center' }, { play: 'judge' }, { say: '#404' }, { wait: 2 }, { walkTo: 'floor' }])).toHaveLength(5);
    expect(validateScene([])).toMatch(/1 to 20 steps/);
    expect(validateScene([{ say: 'x', wait: 1 }])).toMatch(/exactly one/);
    expect(validateScene([{ walkTo: '###' }])).toMatch(/CSS selector/);
    expect(validateScene([{ walkTo: 'h1', at: 'middle' }])).toMatch(/at must be/);
    expect(validateScene([{ play: 'Judge!' }])).toMatch(/clip role/);
    expect(validateScene([{ wait: 600 }])).toMatch(/0 to 60/);
    const { config, warnings } = mergeConfig(defaults(), JSON.parse('{"scenes":{"ok":[{"say":"hi"}],"bad":[{}],"__proto__":[{"say":"x"}]},"surfaces":"h1, .card"}'), 'init');
    expect(Object.keys(config.scenes)).toEqual(['ok']);
    expect(warnings.join()).toMatch(/scene "__proto__" has an invalid name/);
    expect(config.scenes.ok).toEqual([{ say: 'hi' }]);
    expect(warnings.join()).toMatch(/scene "bad"/);
    expect(config.surfaces).toBe('h1, .card');
    expect(mergeConfig(defaults(), { surfaces: '###' }, 'init').warnings.join()).toMatch(/surfaces/);
    expect(mergeConfig(defaults(), { preset: '404' }, 'init').config.preset).toBe('404');
    expect(mergeConfig(defaults(), { preset: '../x' }, 'init').warnings.join()).toMatch(/preset/);
  });

  it('layers a preset under the options the page set itself', () => {
    const page = mergeConfig(defaults(), { preset: '404', lines: { hello: ['page hello'] }, limits: { maxLinesPerMinute: 5 }, ambient: false }, 'inline config').config;
    const preset = {
      lines: { hello: ['preset hello'], '404': ['preset 404'] },
      triggers: [{ on: 'click', scene: ['stare'] }],
      scenes: { stare: [{ play: 'judge' }] },
      surfaces: 'h1',
      limits: { minGapSeconds: 5, maxLinesPerMinute: 3 },
      ambient: true,
      character: 'https://evil.example/x.json',
      zIndex: 1,
    };
    const { config, warnings } = applyPreset(page, preset, 'preset "404"');
    expect(config.lines).toEqual({ hello: ['page hello'], '404': ['preset 404'] });
    expect(config.triggers).toEqual([{ on: 'click', scene: ['stare'] }]);
    expect(config.scenes.stare).toEqual([{ play: 'judge' }]);
    expect(config.surfaces).toBe('h1');
    expect(config.limits).toEqual({ minGapSeconds: 5, maxLinesPerMinute: 5 });
    expect(config.ambient).toBe(false);
    expect(config.character).toBeNull();
    expect(config.zIndex).toBe(defaults().zIndex);
    expect(warnings.join()).toMatch(/"character" can't be set by a preset/);
    // The page's own triggers win over the preset's.
    const own = mergeConfig(page, { triggers: [{ on: 'load', say: 'mine' }] }, 'init').config;
    expect(applyPreset(own, preset, 'p').config.triggers).toEqual([{ on: 'load', say: 'mine' }]);
    expect(() => applyPreset(page, [], 'p')).toThrow(ConfigError);
  });

  it('keeps valid trigger rules and drops invalid ones', () => {
    const { config, warnings } = mergeConfig(defaults(), { triggers: [{ on: 'load', say: 'hi' }, { on: 'hover', say: 'x' }] }, 'init');
    expect(config.triggers).toEqual([{ on: 'load', say: 'hi' }]);
    expect(warnings).toHaveLength(1);
  });
});
