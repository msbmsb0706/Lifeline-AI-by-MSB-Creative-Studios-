/**
 * Tiny assertion helpers — zero dependencies, flat output.
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function assert(condition: unknown, message: string): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ✓ ${message}\n`);
  } else {
    failed += 1;
    failures.push(message);
    process.stdout.write(`  ✗ ${message}\n`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

export function section(title: string): void {
  process.stdout.write(`\n${title}\n`);
}

export function summarize(): number {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length > 0) {
    process.stdout.write('Failures:\n');
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
  }
  return failed;
}
