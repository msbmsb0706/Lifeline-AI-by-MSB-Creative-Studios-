#!/usr/bin/env node
/**
 * LifeLine AI — CommonJS production server startup fix.
 *
 * Removes ONLY the CommonJS-incompatible ESM helpers from server.ts:
 *   1. import { fileURLToPath } from 'url';
 *   2. const __filename = fileURLToPath(import.meta.url);
 *      const __dirname = path.dirname(__filename);
 *
 * Keeps `const PORT = Number(process.env.PORT || 3000);` untouched.
 * Changes nothing else. Atomic: validates in memory, writes only if all gates pass.
 *
 * Usage: node apply-fix.mjs [path/to/server.ts]
 * Exit:  0 = patched (or already patched)   1 = bad input   2 = needs human review
 */
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2] || 'server.ts';

// Exact strings only — no regex on code text, so no collateral edits.
const IMPORT_LINE = "import { fileURLToPath } from 'url';";
const FN_LINE = 'const __filename = fileURLToPath(import.meta.url);';
const DIR_LINE = 'const __dirname = path.dirname(__filename);';
const PORT_LINE = 'const PORT = Number(process.env.PORT || 3000);';

let src;
try {
  src = readFileSync(target, 'utf8');
} catch (err) {
  console.error(`FAIL  cannot read ${target}: ${err.message}`);
  process.exit(1);
}

const eol = src.includes('\r\n') ? '\r\n' : '\n';
let lines = src.split(/\r?\n/);
const before = lines.length;
const removals = [];

const dropExact = (needle, label) => {
  const i = lines.findIndex((l) => l.trim() === needle);
  if (i !== -1) {
    removals.push(`line ${i + 1}: ${label}`);
    lines.splice(i, 1);
  }
};

// ---- build the candidate result in memory (nothing written yet) ----
dropExact(IMPORT_LINE, IMPORT_LINE);
dropExact(FN_LINE, FN_LINE);
dropExact(DIR_LINE, DIR_LINE);

if (removals.length > 0) {
  // Collapse blank-line runs left behind by the removals.
  lines = lines.filter((l, i, a) => !(l.trim() === '' && a[i - 1]?.trim() === ''));
}
const candidate = lines.join(eol);

// ---- GATE 1: the line we must keep ----
if (!candidate.split(/\r?\n/).some((l) => l.trim() === PORT_LINE)) {
  console.error(`FAIL  required line missing: ${PORT_LINE}`);
  console.error('      Not writing. Nothing changed.');
  process.exit(1);
}

// ---- GATE 2: no lingering ESM helper references ----
if (candidate.includes(IMPORT_LINE) || candidate.includes('fileURLToPath')) {
  console.error('FAIL  fileURLToPath / import.meta.url references still present. Not writing.');
  process.exit(1);
}

// ---- GATE 3: the task asserts these helpers are UNUSED. Verify, and stop if not.
const leftover = [];
candidate.split(/\r?\n/).forEach((l, i) => {
  if (/\b__dirname\b/.test(l) || /\b__filename\b/.test(l)) {
    leftover.push(`      line ${i + 1}: ${l.trim()}`);
  }
});
if (leftover.length > 0) {
  console.error('');
  console.error('STOP  __dirname/__filename are still referenced after removal:');
  leftover.forEach((l) => console.error(l));
  console.error('      Deleting their definitions would break this use site.');
  console.error('      Under esbuild CJS bundling these resolve to the bundle directory,');
  console.error('      not the source directory, so this is a behavior change too.');
  console.error('      Not writing. Nothing changed. Needs human decision.');
  process.exit(2);
}

// ---- all gates passed: apply ----
if (removals.length === 0) {
  console.log('NO-OP  already patched (or strings absent) — nothing to remove.');
} else {
  writeFileSync(target, candidate);
  console.log(`PATCHED  ${target}`);
  removals.forEach((r) => console.log(`  - removed ${r}`));
  console.log(`  lines: ${before} -> ${candidate.split(/\r?\n/).length}`);
}

console.log(`OK  kept: ${PORT_LINE}`);
console.log('OK  no fileURLToPath / import.meta.url references remain.');
console.log('OK  no leftover __dirname / __filename references.');

// Advisory only — report, never modify. Removing `path` is out of scope.
if (!/path\.(join|resolve|dirname|basename|extname)/.test(candidate)) {
  console.log('NOTE  `path` may now be unused in this file (left untouched by design).');
}
