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
await import('./speech.test.ts');
await import('./language-detection-regression.test.ts');
await import('./translation.test.ts');
await import('./offline-fire-denial.test.ts');
await import('./offline-qa-500.test.ts');
await import('./offline-shell.test.ts');
await import('./online-triage-fallback.test.ts');
await import('./sos-lifecycle.test.ts');
await import('./offline-resilience.test.ts');
await import('./app-call-sites.test.ts');
await import('./pr16-corrective.test.ts');
await import('./pr16-country-selection.test.ts');
await import('./online-translation.test.ts');
await import('./online-translation-routes.test.ts');
await import('./partner-tracking.test.ts');
await import('./speech-capture-android.test.ts');
await import('./voice-android-lifecycle.test.ts');
await import('./offline-sos-android-flow.test.ts');
await import('./mobile-dictation-input.test.ts');
await import('./ui-visibility.test.ts');
await import('./automatic-sos-recovery.test.ts');
await import('./pr28-user-defects.test.ts');
await import('./emergency-numbers-sheet.test.ts');
// Previous browser tests install window/document stubs. Embedded PostgreSQL
// must initialize in a genuine Node environment, not a partial browser stub.
delete (globalThis as any).window;
delete (globalThis as any).document;
await import('./durable-dispatch-ledger.test.ts');
await import('./automatic-sos-dispatch-route.test.ts');

const failures = summarize();
process.exit(failures > 0 ? 1 : 0);
