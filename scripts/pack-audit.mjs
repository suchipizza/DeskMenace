// Builds the npm tarball listing (npm pack --dry-run) and checks it against an allowlist, then
// scans the packed text files for forbidden content. Nothing is published.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
const [info] = JSON.parse(out);
const files = info.files.map((f) => f.path).sort();

const ALLOW = [
  /^LICENSE$/,
  /^README\.md$/,
  /^package\.json$/,
  /^dist\/gary(\.core)?\.js$/,
  /^dist\/gary\.mjs$/,
  /^dist\/.*\.d\.ts$/,
  /^schema\/(character|config)\.schema\.json$/,
  /^characters\/sample\/(character\.json|LICENSE\.md|README\.md|atlas\/[a-z]+\.webp|presets\/[a-z0-9-]+\.json)$/,
];
const problems = [];
for (const f of files) if (!ALLOW.some((re) => re.test(f))) problems.push(`not on the package allowlist: ${f}`);
for (const need of ['dist/gary.js', 'dist/gary.core.js', 'dist/gary.mjs', 'dist/index.d.ts', 'LICENSE', 'README.md']) {
  if (!files.includes(need)) problems.push(`missing from package: ${need}`);
}
const j = (...p) => p.join('');
const FORBID = [new RegExp(j('/', 'Users/')), /sourceMappingURL/, new RegExp(j('DeskMenace', 'Private'), 'i'), new RegExp(j('\\bW', '-0[0-9]\\b'))];
for (const f of files) {
  if (!/\.(js|mjs|ts|json|md)$/.test(f) && f !== 'LICENSE') continue;
  const text = readFileSync(f, 'utf8');
  for (const re of FORBID) if (re.test(text)) problems.push(`${f}: matches ${re}`);
}
// The core bundles must not know about any default character.
for (const f of ['dist/gary.core.js', 'dist/gary.mjs']) if (/characters\/gary/.test(readFileSync(f, 'utf8'))) problems.push(`${f}: references the default character`);

const core = gzipSync(readFileSync('dist/gary.core.js')).length;
console.log(`package ${info.name}@${info.version}: ${files.length} files, ${(info.size / 1024).toFixed(1)} KB packed, ${(info.unpackedSize / 1024).toFixed(1)} KB unpacked; core ${(core / 1024).toFixed(1)} KB gzip`);
if (problems.length) {
  console.error(`pack-audit: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('pack-audit: ok');
