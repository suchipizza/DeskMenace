// npm run serve — serves the repository on http://127.0.0.1:8700 (examples, built bundles).
// A second server on :8701 plays the role of a separate asset host / CDN for cross-origin demos.
// Optional: GARY_ASSET_DIR=/path/to/gary npm run serve   to try another copy of Gary's artwork.
import { startServer } from './server.mjs';

const garyDir = process.env.GARY_ASSET_DIR || null;
await startServer({ port: 8700, garyDir });
await startServer({ port: 8701, garyDir });
console.log('gary.js examples:  http://127.0.0.1:8700/examples/');
console.log('asset origin:      http://127.0.0.1:8701/');
