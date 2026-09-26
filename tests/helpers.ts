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

/**
 * JSON.stringify crashes on DOM nodes (circular fiber references) and on
 * undefined-in-strings; only the values that FAIL need to be rendered, so
 * stringify lazily and fall back to a short descriptor.
 */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (value instanceof Error) return `Error: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return `[${(value as any).constructor?.name || t}] ${String(value).slice(0, 80)}`;
    } catch {
      return `[unprintable ${t}]`;
    }
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    assert(true, message);
    return;
  }
  assert(false, `${message} (expected ${describeValue(expected)}, got ${describeValue(actual)})`);
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
