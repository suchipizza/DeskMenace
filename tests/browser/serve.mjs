// Two local origins for the browser suite: the page origin and a separate asset origin.
import { startServer } from '../../scripts/server.mjs';
const garyDir = process.env.GARY_ASSET_DIR || null;
await startServer({ port: 8710, garyDir });
await startServer({ port: 8711, garyDir });
await startServer({ port: 8712, cors: false });
console.log('test servers ready on 8710 (page), 8711 (assets, CORS), 8712 (no CORS)');
