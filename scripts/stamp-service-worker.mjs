/* Stamp each production service worker with its matching HTML + asset revision.
 * Vite copies public/sw.js to dist unchanged. This step makes each release's
 * cache distinct, so upgrading cannot mix a new page with an old JS bundle.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html');
const worker = readFileSync('dist/sw.js', 'utf8');
const token = '__LIFELINE_CACHE_ID__';
if (!worker.includes(token)) throw new Error('Offline worker cache-version placeholder not found');
if (!html.includes('/assets/') || !html.includes('.js')) throw new Error('Built app assets not found in index.html');
const manifest = readFileSync('dist/manifest.webmanifest');
const digest = createHash('sha256').update(html).update(worker).update(manifest).digest('hex').slice(0, 16);
writeFileSync('dist/sw.js', worker.replaceAll(token, digest));
console.log(`Offline app cache revision: ${digest}`);
