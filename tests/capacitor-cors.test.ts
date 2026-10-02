/**
 * Controlled CORS for the Capacitor WebView — regression tests.
 *
 * server/capacitorCors.ts grants cross-origin access to /api/* ONLY for the
 * Android WebView's local origin (https://localhost, plus the iOS Capacitor
 * scheme defensively). Everything else — including same-origin web traffic —
 * must pass through with byte-identical behavior and no CORS grant.
 */
import { readFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { section, assert, assertEqual } from './helpers.ts';
import {
  DEFAULT_CAPACITOR_ALLOWED_ORIGINS,
  capacitorCors,
  getCapacitorAllowedOrigins,
  isAllowedCapacitorOrigin,
  parseAllowedOrigins
} from '../server/capacitorCors.ts';

interface StubResult {
  headers: Record<string, string>;
  statusCode: number;
  ended: boolean;
  nextCalled: boolean;
}

function run(
  middleware: ReturnType<typeof capacitorCors>,
  req: { method: string; origin?: string }
): StubResult {
  const result: StubResult = { headers: {}, statusCode: 200, ended: false, nextCalled: false };
  const res: Partial<Response> = {
    setHeader(name: string, value: string) {
      result.headers[name.toLowerCase()] = value;
      return res as Response;
    },
    status(code: number) {
      result.statusCode = code;
      return res as Response;
    },
    end() {
      result.ended = true;
      return res as Response;
    }
  };
  const next: NextFunction = () => {
    result.nextCalled = true;
  };
  middleware({ method: req.method, headers: req.origin === undefined ? {} : { origin: req.origin } } as Request, res as Response, next);
  return result;
}

const ACAO = 'access-control-allow-origin';

// ---------------------------------------------------------------------------
// A. Origin allow-list parsing (configuration handling)
// ---------------------------------------------------------------------------
section('CORS allow-list parsing');

assert(
  DEFAULT_CAPACITOR_ALLOWED_ORIGINS.includes('https://localhost'),
  'the Capacitor Android WebView origin (https://localhost) is allowed by default'
);
assert(
  DEFAULT_CAPACITOR_ALLOWED_ORIGINS.includes('capacitor://localhost'),
  'the Capacitor iOS-scheme origin is allowed by default'
);
assertEqual(parseAllowedOrigins(undefined).length, 2, 'unset env uses the two defaults');
assertEqual(
  parseAllowedOrigins(' https://localhost , capacitor://localhost/ ').join(','),
  'https://localhost,capacitor://localhost',
  'env parsing trims spaces and trailing slashes'
);
assertEqual(
  parseAllowedOrigins('https://localhost,*,https://evil.example').join(','),
  'https://localhost,https://evil.example',
  "a '*' entry is stripped — arbitrary origins can never be granted"
);
assertEqual(
  parseAllowedOrigins('https://localhost,https://localhost').length,
  1,
  'duplicate origins are de-duplicated'
);
assertEqual(
  parseAllowedOrigins('*').length,
  0,
  'a wildcard-only env yields an EMPTY allow-list, not open access'
);
assertEqual(
  getCapacitorAllowedOrigins({ CAPACITOR_ALLOWED_ORIGINS: 'https://preview.example.com' }).join(','),
  'https://preview.example.com',
  'CAPACITOR_ALLOWED_ORIGINS overrides the defaults entirely'
);
assert(isAllowedCapacitorOrigin('https://localhost/', ['https://localhost']), 'a trailing slash on the request origin is normalized');
assert(!isAllowedCapacitorOrigin('https://localhost.evil.example', ['https://localhost']), 'prefix spoofing is rejected (exact byte match)');
assert(!isAllowedCapacitorOrigin(null, ['https://localhost']), 'null origin is rejected');
assert(!isAllowedCapacitorOrigin('null', ['https://localhost']), "the sandbox 'null' origin is rejected");

// ---------------------------------------------------------------------------
// B. Middleware behavior with defaults
// ---------------------------------------------------------------------------
section('capacitorCors middleware — defaults');

const middleware = capacitorCors(['https://localhost', 'capacitor://localhost']);

// 1. Allow-listed WebView origin — actual request.
let result = run(middleware, { method: 'POST', origin: 'https://localhost' });
assert(result.nextCalled, 'allow-listed origin passes through to the route');
assert(!result.ended, 'allow-listed origin does not short-circuit real requests');
assertEqual(result.headers[ACAO], 'https://localhost', 'grant echoes the exact WebView origin (never a wildcard)');
assertEqual(result.headers.vary, 'Origin', 'Vary: Origin is emitted for origin-keyed responses');

// 2. Allow-listed WebView origin — preflight.
result = run(middleware, { method: 'OPTIONS', origin: 'https://localhost' });
assert(!result.nextCalled, 'preflight is answered without reaching routes');
assert(result.ended, 'preflight response is ended');
assertEqual(result.statusCode, 204, 'preflight answers 204');
assertEqual(result.headers[ACAO], 'https://localhost', 'preflight grants the WebView origin');
assertEqual(result.headers['access-control-allow-methods'], 'GET, POST, OPTIONS', 'preflight allows the API methods');
assert(
  /Content-Type/.test(result.headers['access-control-allow-headers'] || '') &&
    /Authorization/.test(result.headers['access-control-allow-headers'] || ''),
  'preflight allows JSON content type and the partner case-flow Bearer token'
);
assert(/^\d+$/.test(result.headers['access-control-max-age'] || ''), 'preflight carries a numeric max age');

// 3. iOS-scheme origin allowed by default.
result = run(middleware, { method: 'POST', origin: 'capacitor://localhost' });
assertEqual(result.headers[ACAO], 'capacitor://localhost', 'capacitor:// scheme origin is granted');

// 4. Arbitrary website origin — never granted.
result = run(middleware, { method: 'POST', origin: 'https://evil.example.com' });
assert(result.nextCalled, 'rejected origins still reach the app logic (the BROWSER enforces the CORS block)');
assertEqual(result.headers[ACAO], undefined, 'no Access-Control-Allow-Origin for arbitrary origins');

result = run(middleware, { method: 'OPTIONS', origin: 'https://evil.example.com' });
assertEqual(result.statusCode, 204, 'hostile preflight is answered quietly');
assert(!result.nextCalled, 'hostile preflight never reaches routes');
assertEqual(result.headers[ACAO], undefined, 'hostile preflight receives no grant');

// 5. Same-origin web behavior is unchanged:
//    - plain GET/POST without an Origin header (curl, same-origin GETs)
result = run(middleware, { method: 'GET' });
assert(result.nextCalled, 'requests without an Origin header pass through');
assertEqual(Object.keys(result.headers).length, 0, 'requests without an Origin header get zero CORS headers');

//    - browser same-origin form posts DO send Origin; the site origin is not
//      in the Capacitor allow-list, so nothing is granted (and none is needed).
result = run(middleware, { method: 'POST', origin: 'https://lifeline-ai-by-msb-creative-studios.onrender.com' });
assert(result.nextCalled, 'the website own-origin traffic still flows exactly as before');
assertEqual(result.headers[ACAO], undefined, 'the website itself is not granted CORS (it never needed it)');

// 6. Custom env-driven allow-list.
const custom = capacitorCors(parseAllowedOrigins('https://app.preview.example,https://localhost'));
result = run(custom, { method: 'GET', origin: 'https://app.preview.example' });
assertEqual(result.headers[ACAO], 'https://app.preview.example', 'explicitly configured origins are granted');
result = run(custom, { method: 'OPTIONS', origin: 'capacitor://localhost' });
assertEqual(result.headers[ACAO], undefined, 'defaults can be fully replaced by configuration');

// ---------------------------------------------------------------------------
// C. Wiring pin — the middleware guards /api in the real server
// ---------------------------------------------------------------------------
section('Server wiring');

const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
assert(serverSource.includes("import { capacitorCors } from './server/capacitorCors.ts';"), 'server.ts imports the controlled CORS middleware');
assert(serverSource.includes("app.use('/api', capacitorCors());"), 'server.ts mounts capacitorCors() on /api before the API routes');
assert(
  serverSource.indexOf("app.use('/api', capacitorCors());") < serverSource.indexOf("app.get('/api/status'"),
  'the CORS middleware is registered before the first API route'
);
assert(!/Access-Control-Allow-Origin['"]?,\s*'\*'/.test(serverSource), 'the server never grants a wildcard origin');
