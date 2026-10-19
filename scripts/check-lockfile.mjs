// Fails when package-lock.json no longer matches package.json (a field was changed without
// regenerating the lockfile, so `npm install` on a fresh clone would rewrite it).
// Fix: npm install --package-lock-only

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const root = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages?.[''] ?? {};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fields = ['name', 'version', 'license', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'engines', 'bin'];
const stale = fields.filter((f) => !same(pkg[f], root[f]));

if (stale.length) {
  console.error(`lockfile: package-lock.json is out of date (${stale.join(', ')}). Run: npm install --package-lock-only`);
  process.exit(1);
}
console.log('lockfile: ok');
