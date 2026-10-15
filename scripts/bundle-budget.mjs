// Fails when an engine bundle exceeds its gzip budget. Character art is not part of these files.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_GZIP = 30 * 1024;
let failed = false;
for (const f of ['dist/gary.js', 'dist/gary.core.js', 'dist/gary.mjs']) {
  const raw = readFileSync(f);
  const gz = gzipSync(raw, { level: 9 }).length;
  const ok = gz <= BUDGET_GZIP;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(18)} ${(raw.length / 1024).toFixed(1).padStart(6)} KB raw  ${(gz / 1024).toFixed(1).padStart(5)} KB gzip  (budget ${BUDGET_GZIP / 1024} KB)`);
}
process.exit(failed ? 1 : 0);
