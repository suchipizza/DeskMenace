// Minimal static file server for examples and browser tests (127.0.0.1 only).
//   cors:     send Access-Control-Allow-Origin: *
//   garyDir:  serve another copy of Gary's artwork at /characters/gary/ (e.g. a new export to try)
//   headers:  extra response headers for HTML pages (e.g. a Content-Security-Policy)
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const p = normalize(join(root, decodeURIComponent(urlPath)));
  return p === root || p.startsWith(root + sep) ? p : null;
}

export function startServer({ root = process.cwd(), port = 8700, cors = true, garyDir = null, headers = {}, log = false } = {}) {
  const base = resolve(root);
  const gary = garyDir ? resolve(garyDir) : null;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = null;
    if (gary && url.pathname.startsWith('/characters/gary/')) file = safeJoin(gary, url.pathname.slice('/characters/gary/'.length));
    else file = safeJoin(base, url.pathname);
    try {
      if (file && statSync(file).isDirectory()) file = join(file, 'index.html');
      const st = file && statSync(file);
      if (!st || !st.isFile()) throw new Error('not found');
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      const h = { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' };
      if (cors) h['Access-Control-Allow-Origin'] = '*';
      if (type.startsWith('text/html')) Object.assign(h, headers);
      // Per-request CSP for tests: ?csp=<policy>
      const csp = url.searchParams.get('csp');
      if (csp && type.startsWith('text/html')) h['Content-Security-Policy'] = csp;
      res.writeHead(200, h);
      createReadStream(file).pipe(res);
      if (log) console.log(200, url.pathname);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) });
      res.end('not found');
      if (log) console.log(404, url.pathname);
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}
