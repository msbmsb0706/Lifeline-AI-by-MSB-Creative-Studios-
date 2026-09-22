#!/usr/bin/env node
/**
 * Asset / path validation for LifeLine AI by MSB Creative Studios.
 *
 * Verifies that:
 *  1. Every absolute asset path referenced from index.html, the web manifest,
 *     src/** and README.md resolves to a real file inside public/ (and, when a
 *     production build exists, inside dist/).
 *  2. The PWA manifest icon entries declare sizes that match the actual PNG
 *     dimensions of the referenced files.
 *  3. The supplied LifeLine AI brand kit exists exactly once, under
 *     public/assets/branding/ (no stale duplicates elsewhere in public/).
 *  4. Required favicon/apple-touch icons referenced by index.html still exist.
 *
 * Exits non-zero if any check fails. Usage: node scripts/validate-assets.mjs [--require-dist]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireDist = process.argv.includes('--require-dist');

let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.error(`  FAIL  ${msg}`);
};

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ---------- tiny PNG header parser (width/height from IHDR) ---------- */
function pngSize(absPath) {
  const buf = readFileSync(absPath);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ---------- 1. collect referenced asset paths ---------- */
const refs = new Map(); // path -> [sources]
const addRef = (path, source) => {
  if (!refs.has(path)) refs.set(path, []);
  refs.get(path).push(source);
};

// index.html: href/src/content absolute asset URLs
for (const m of read('index.html').matchAll(/(?:href|src|content)="(\/[^"]+\.(?:png|jpe?g|svg|ico|webmanifest|webp))"/g)) {
  addRef(m[1], 'index.html');
}

// manifest icons
const manifest = JSON.parse(read('public/manifest.webmanifest'));
for (const icon of manifest.icons ?? []) addRef(icon.src, 'manifest.webmanifest');
for (const key of ['start_url', 'id']) {
  // not image refs; just ensure they are root-scoped
  if (manifest[key] !== '/') bad(`manifest ${key} should be "/" (got ${manifest[key]})`);
}

// src/** absolute image paths in TSX/TS
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(tsx?|mts|cts)$/.test(e.name) ? [p] : [];
  });
for (const file of walk(join(ROOT, 'src'))) {
  const rel = file.slice(ROOT.length + 1);
  const text = readFileSync(file, 'utf8');
  // Covers plain src/href attributes AND srcSet descriptor lists (URL followed by quote or space).
  for (const m of text.matchAll(/["'`\s,](\/[^\s"'`]+?\.(?:png|jpe?g|svg|ico|webp))(?=["'`\s])/g)) {
    addRef(m[1], rel);
  }
}

// README.md repo-relative markdown image paths
for (const m of read('README.md').matchAll(/\]\((public\/[^)\s]+\.(?:png|jpe?g|svg|webp))\)/g)) {
  if (!existsSync(join(ROOT, m[1]))) bad(`README references missing file ${m[1]}`);
  else ok(`README image exists: ${m[1]}`);
}

/* ---------- 2. every referenced absolute path exists in public/ (and dist/) ---------- */
console.log('\n[1] Referenced asset paths resolve to files:');
for (const [ref, sources] of [...refs.entries()].sort()) {
  const pub = join(ROOT, 'public', ref.replace(/^\//, ''));
  if (!existsSync(pub) || !statSync(pub).isFile()) {
    bad(`${ref} (used by ${[...new Set(sources)].join(', ')}) missing in public/`);
    continue;
  }
  ok(`${ref} <- ${[...new Set(sources)].join(', ')}`);
  if (requireDist) {
    const dist = join(ROOT, 'dist', ref.replace(/^\//, ''));
    if (!existsSync(dist)) bad(`${ref} missing from production build dist/ (run npm run build first)`);
  }
}

/* ---------- 3. manifest icon declared sizes match real PNG dimensions ---------- */
console.log('\n[2] Manifest icon sizes match actual PNG dimensions:');
for (const icon of manifest.icons ?? []) {
  const abs = join(ROOT, 'public', icon.src.replace(/^\//, ''));
  const size = existsSync(abs) ? pngSize(abs) : null;
  const [dw, dh] = String(icon.sizes).split('x').map(Number);
  if (!size) bad(`manifest icon ${icon.src} unreadable`);
  else if (size.w !== dw || size.h !== dh)
    bad(`manifest icon ${icon.src} declares ${icon.sizes} but PNG is ${size.w}x${size.h}`);
  else ok(`${icon.src} ${icon.sizes} purpose=${icon.purpose}`);
}

/* ---------- 4. brand kit present exactly once, under branding/ ---------- */
console.log('\n[3] Supplied brand kit layout:');
const BRAND_FILES = [
  ['lifeline-ai-brand.png', 1536, 1536],
  ['lifeline-ai-brand-1200.png', 1200, 1200],
  ['lifeline-ai-icon-512.png', 512, 512],
  ['lifeline-ai-pwa-icon-192.png', 192, 192],
  ['lifeline-ai-pwa-icon-512.png', 512, 512],
  ['lifeline-ai-feature-graphic-1024x500.png', 1024, 500],
];
for (const [name, w, h] of BRAND_FILES) {
  const abs = join(ROOT, 'public/assets/branding', name);
  const size = existsSync(abs) ? pngSize(abs) : null;
  if (!size) bad(`branding/${name} missing`);
  else if (size.w !== w || size.h !== h) bad(`branding/${name} is ${size.w}x${size.h}, expected ${w}x${h}`);
  else ok(`branding/${name} ${w}x${h}`);
}
// promo artwork: present, square, large, and never referenced as a favicon
const promo = join(ROOT, 'public/assets/branding/lifeline-ai-promo.png');
const promoSize = existsSync(promo) ? pngSize(promo) : null;
if (!promoSize) bad('branding/lifeline-ai-promo.png missing');
else if (promoSize.w !== promoSize.h || promoSize.w < 1024)
  bad(`branding/lifeline-ai-promo.png unexpected size ${promoSize.w}x${promoSize.h}`);
else ok(`branding/lifeline-ai-promo.png ${promoSize.w}x${promoSize.h} (promotional only)`);

// no lifeline-ai-* files may exist outside public/assets/branding (no duplicates)
const stray = [];
const scanPublic = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) scanPublic(p);
    else if (e.name.startsWith('lifeline-ai-') && !p.includes(join('public', 'assets', 'branding'))) stray.push(p);
  }
};
scanPublic(join(ROOT, 'public'));
if (stray.length) bad(`duplicate branding files outside branding/: ${stray.join(', ')}`);
else ok('no lifeline-ai-* duplicates outside public/assets/branding/');

/* ---------- 5. preserved favicon set still present ---------- */
console.log('\n[4] Preserved favicon / touch icon set:');
for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
  if (existsSync(join(ROOT, 'public', f))) ok(`public/${f} preserved`);
  else bad(`public/${f} missing`);
}

console.log(failures ? `\n${failures} validation failure(s).` : '\nAll asset/path validations passed.');
process.exit(failures ? 1 : 0);
