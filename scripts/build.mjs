// Builds the three browser artifacts from one engine source:
//   dist/gary.js       classic script, zero-config default character
//   dist/gary.core.js  classic script, engine only
//   dist/gary.mjs      ES module, engine only
// plus TypeScript declarations. No source maps are emitted into dist/.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const banner = `/*! gary.js v${pkg.version} | MIT License | https://github.com/suchipizza/DeskMenace */`;
const common = {
  bundle: true,
  minify: true,
  target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning',
};

rmSync('dist', { recursive: true, force: true });
await Promise.all([
  build({ ...common, entryPoints: ['src/classic.ts'], outfile: 'dist/gary.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/core-classic.ts'], outfile: 'dist/gary.core.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/gary.mjs', format: 'esm' }),
]);
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
console.log(`built gary.js v${pkg.version}`);
