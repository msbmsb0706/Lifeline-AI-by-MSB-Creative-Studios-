/**
 * Controlled CORS for the packaged Capacitor app — and NOTHING else.
 *
 * The Capacitor Android WebView serves the app bundle from its own local
 * origin (`https://localhost` with the stock https scheme), so its API calls
 * to the Render backend are cross-origin and need a CORS grant. This
 * middleware grants exactly the configured WebView origin(s):
 *
 * - Requests with NO Origin header (curl, server-to-server, and ordinary
 *   same-origin web GETs) pass through completely untouched.
 * - Requests whose Origin is NOT allow-listed — including the website's own
 *   origin on same-origin form posts — also pass through with NO CORS grant,
 *   so normal same-origin web behavior is byte-identical to before.
 * - Preflight (OPTIONS) requests are answered directly: allow-listed origins
 *   get the grant, everyone else a bare 204 with no grant (a browser then
 *   blocks the real request itself).
 *
 * Wildcards are never honored: a `*` entry is stripped from the allow-list,
 * and `Access-Control-Allow-Origin` always echoes one exact origin, which
 * keeps the door closed to arbitrary websites.
 */
import type { NextFunction, Request, Response } from 'express';

/** Defaults cover the stock Capacitor WebView origins (Android https + iOS). */
export const DEFAULT_CAPACITOR_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'https://localhost',
  'capacitor://localhost'
]);

const ALLOW_METHODS = 'GET, POST, OPTIONS';
// `Content-Type` covers every JSON `/api/*` POST; `Authorization` covers the
// authorized-partner case-flow Bearer token. Nothing else is needed.
const ALLOW_HEADERS = 'Content-Type, Authorization';
const MAX_AGE_SECONDS = '600';

/**
 * Parse `CAPACITOR_ALLOWED_ORIGINS` (comma-separated). Trailing slashes and
 * duplicates are removed; `*` entries are dropped defensively so an env typo
 * can never open the API to arbitrary origins.
 */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  const source = raw && raw.trim() ? raw : DEFAULT_CAPACITOR_ALLOWED_ORIGINS.join(',');
  const origins = source
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0 && origin !== '*');
  return Array.from(new Set(origins));
}

export function getCapacitorAllowedOrigins(env: { CAPACITOR_ALLOWED_ORIGINS?: string } = process.env): string[] {
  return parseAllowedOrigins(env.CAPACITOR_ALLOWED_ORIGINS);
}

/** True when `origin` byte-matches an allow-listed origin (no pattern tricks). */
export function isAllowedCapacitorOrigin(origin: unknown, allowedOrigins: readonly string[]): origin is string {
  return (
    typeof origin === 'string' &&
    allowedOrigins.includes(origin.replace(/\/+$/, ''))
  );
}

/**
 * Express middleware, mounted at `/api`. `allowedOrigins` is snapshotted once
 * at app construction, matching every other config in server.ts.
 */
export function capacitorCors(allowedOrigins: readonly string[] = getCapacitorAllowedOrigins()) {
  const allowed: readonly string[] = allowedOrigins;
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (typeof origin !== 'string') {
      // Not a cross-origin browser request (same-origin web GET, curl, SSR):
      // no CORS headers whatsoever, behavior identical to no middleware.
      next();
      return;
    }
    res.setHeader('Vary', 'Origin');
    const granted = isAllowedCapacitorOrigin(origin, allowed);
    if (req.method === 'OPTIONS') {
      // Preflights exist only for cross-origin requests. Answer them here: the
      // grant for allow-listed WebView origins, a bare 204 for everyone else.
      res.status(204);
      if (granted) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
        res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
        res.setHeader('Access-Control-Max-Age', MAX_AGE_SECONDS);
      }
      res.end();
      return;
    }
    if (granted) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    next();
  };
}
