import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { manifest, clip } from '../fixtures/manifests';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const character = ajv.compile(read('schema/character.schema.json'));
const config = ajv.compile(read('schema/config.schema.json'));

describe('published JSON schemas', () => {
  it('accept the sample character', () => {
    expect(character(read('characters/sample/character.json')), JSON.stringify(character.errors)).toBe(true);
  });

  it('accept fixture manifests and reject broken ones', () => {
    expect(character(manifest())).toBe(true);
    expect(character(manifest({ schemaVersion: 2 }))).toBe(false);
    expect(character(manifest({}, { idle: clip({ size: [0, 10] }) }))).toBe(false);
    expect(character(manifest({ extra: true }))).toBe(false);
    expect(character(JSON.parse('{"schemaVersion":1,"id":"__proto__","name":"x","licence":"x","assetRevision":"1","clips":{"a":{}}}'))).toBe(false);
  });

  it('accept every example configuration', () => {
    const inline = (f: string) => JSON.parse(readFileSync(f, 'utf8').match(/<script type="application\/json" data-gary-config>([\s\S]*?)<\/script>/)![1]);
    for (const cfg of [inline('examples/portfolio/index.html'), inline('examples/404/index.html'), read('examples/staging/gary.staging.json')]) {
      expect(config(cfg), JSON.stringify(config.errors)).toBe(true);
    }
  });

  it('reject excluded behaviours and malformed triggers', () => {
    expect(config({ behaviours: ['phone'] })).toBe(false);
    expect(config({ triggers: [{ on: 'hover', say: 'x' }] })).toBe(false);
    expect(config({ triggers: [{ on: 'load' }] })).toBe(false);
    expect(config({ triggers: [{ on: 'gary-click', count: 3, do: 'react-clicks' }] })).toBe(true);
  });
});
