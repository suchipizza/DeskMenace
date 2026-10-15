// Assembles the website in _site/: the landing page (site/), the examples, the bundles and the
// characters they load. Published to GitHub Pages by .github/workflows/pages.yml.
//   npm run build && npm run site
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const OUT = '_site';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/dist`, { recursive: true });
for (const f of ['gary.js', 'gary.core.js', 'gary.mjs']) cpSync(`dist/${f}`, `${OUT}/dist/${f}`);
cpSync('site', OUT, { recursive: true });
cpSync('examples', `${OUT}/examples`, { recursive: true });
cpSync('characters', `${OUT}/characters`, { recursive: true });
console.log(`site: ${OUT}/`);
