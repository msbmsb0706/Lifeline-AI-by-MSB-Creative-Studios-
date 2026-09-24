#!/usr/bin/env tsx
/**
 * Bare test runner for LifeLine AI regression tests.
 *
 * Usage: node --import tsx tests/run.ts   (or: npx tsx tests/run.ts)
 *
 * Each *.test.ts file imports its own dependencies and uses top-level await
 * where needed; the runner imports them sequentially and reports a global
 * pass/fail summary. Exit code 0 on success, 1 on any failure.
 */
import { summarize } from './helpers.ts';

process.stdout.write('LifeLine AI regression tests\n');

// Ordered imports — each module runs its assertions on load.
await import('./languages.test.ts');
await import('./language-detection-regression.test.ts');
await import('./translation.test.ts');
await import('./offline-fire-denial.test.ts');
await import('./offline-qa-500.test.ts');
await import('./sos-lifecycle.test.ts');
await import('./app-call-sites.test.ts');
await import('./pr16-corrective.test.ts');
await import('./pr16-country-selection.test.ts');
await import('./online-translation.test.ts');
await import('./online-translation-routes.test.ts');

const failures = summarize();
process.exit(failures > 0 ? 1 : 0);
