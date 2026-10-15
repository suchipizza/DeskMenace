// Scans every file git would publish (tracked + staged) for material that must never be public:
// local machine paths, credentials and planning notes. Gary's artwork must ship with its licence.
// Run before any push or release:  npm run audit:private
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

// Patterns are assembled at runtime so this file does not match itself.
const j = (...p) => p.join('');
const RULES = [
  ['local home path', new RegExp(j('/', 'Users/'), 'i')],
  ['local home path', new RegExp(j('[A-Z]:\\\\', 'Users\\\\'), 'i')],
  ['private key', new RegExp(j('-----BEGIN ', '(RSA |EC |OPENSSH )?PRIVATE KEY'))],
  ['npm token', new RegExp(j('npm', '_[A-Za-z0-9]{36}'))],
  ['GitHub token', new RegExp(j('gh', '[pousr]_[A-Za-z0-9]{36}'))],
  ['generic secret assignment', /\b(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"\s]{12,}/i],
  ['private repository name', new RegExp(j('DeskMenace', 'Private'), 'i')],
  ['work-item id', new RegExp(j('\\bW', '-0[0-9]\\b'))],
  ['gate id', new RegExp(j('\\bG[1-7]', '\\b(?! ?(?:Pro|Max))'))],
];
const FORBIDDEN_PATHS = [/\.env(\..*)?$/, /\.(mov|mp4|webm|wav|mp3|psd|aep)$/i];
const TEXT = /\.(ts|mjs|js|json|md|html|css|yml|yaml|txt|py|cjs)$|^(LICENSE|\.gitignore)/;

const problems = [];
for (const f of files) {
  // Website demo videos are the only media files allowed besides images.
  if (FORBIDDEN_PATHS.some((re) => re.test(f)) && !/^site\/media\/[a-z0-9-]+\.mp4$/.test(f)) problems.push(`${f}: path must not be published`);
  if (f === 'package-lock.json' || !TEXT.test(f.split('/').pop())) continue;
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) problems.push(`${f}:${i + 1}: ${name}`);
  });
}
if (files.some((f) => f.startsWith('characters/gary/')) && !files.includes('characters/gary/LICENSE.md')) problems.push('characters/gary/: LICENSE.md missing');
if (problems.length) {
  console.error(`no-private-assets: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`no-private-assets: ${files.length} files clean`);
