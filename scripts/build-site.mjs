// Assembles the website in _site/: the landing page (site/), the examples, the bundles and the
// characters they load. Published to GitHub Pages by .github/workflows/pages.yml.
//   npm run build && npm run site
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUT = '_site';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/dist`, { recursive: true });
for (const f of ['gary.js', 'gary.core.js', 'gary.mjs']) cpSync(`dist/${f}`, `${OUT}/dist/${f}`);
cpSync('site', OUT, { recursive: true });
cpSync('examples', `${OUT}/examples`, { recursive: true });
cpSync('characters', `${OUT}/characters`, { recursive: true });
// Version the stylesheet link by its content, so browsers don't pair a new page with a cached
// stylesheet (Pages lets them keep it for 10 minutes).
const css = createHash('sha256').update(readFileSync('site/site.css')).digest('hex').slice(0, 8);
const page = `${OUT}/index.html`;
writeFileSync(page, readFileSync(page, 'utf8').replace('href="site.css"', `href="site.css?v=${css}"`));
console.log(`site: ${OUT}/`);
