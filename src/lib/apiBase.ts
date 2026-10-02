/**
 * Centralized API base URL resolution — the single place the frontend decides
 * WHERE backend requests go.
 *
 * Two deployment shapes share this frontend build:
 *
 * 1. Web (production website, dev server, tests): the Express backend serves
 *    the app itself, so every request keeps its SAME-ORIGIN relative
 *    `/api/*` path. This never changes.
 *
 * 2. Packaged Capacitor Android app: the bundle runs from the WebView's own
 *    local origin (`https://localhost`), so a relative `/api/*` request would
 *    hit the WebView itself and never reach the backend. In that native
 *    shell every `/api/*` request is prefixed with the production backend
 *    origin below; the backend answers with a strictly allow-listed CORS
 *    grant for the Capacitor WebView origin (server/capacitorCors.ts).
 *
 * Guarantees:
 * - No `server.url` is used: the native app loads its LOCAL bundle, only the
 *   API calls point at the remote backend (Capacitor's supported pattern).
 * - No keys or secrets exist in this module or anywhere in frontend code.
 * - Offline / Resilience mode is unaffected: those code paths never call
 *   this resolver — they make no network requests at all.
 */

/**
 * Production backend origin for the packaged native app. This is a public
 * service URL, not a credential; it is safe to ship inside the APK.
 */
export const CAPACITOR_PRODUCTION_API_BASE_URL =
  'https://lifeline-ai-by-msb-creative-studios.onrender.com';

/**
 * Optional build-time override for staged/native builds (e.g. pointing a test
 * APK at a staging backend): set `VITE_API_BASE_URL` when running
 * `vite build`. It is honored ONLY inside the packaged native app — the web
 * build always keeps relative `/api/*` URLs regardless of this variable.
 */
function readBuildTimeApiBaseOverride(): string | null {
  try {
    const env = (import.meta as any).env;
    return typeof env?.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : null;
  } catch {
    return null;
  }
}

/**
 * True ONLY when running inside a packaged Capacitor native shell.
 *
 * Detection relies on the Capacitor native bridge, which injects
 * `window.Capacitor` (with `isNativePlatform()` / `getPlatform()` and a
 * `platform` token) BEFORE any app JavaScript runs. A plain browser never has
 * it, so websites — including localhost dev servers at https://localhost —
 * never misdetect. Every access is guarded: a partial or throwing stub can
 * never flip the result to native or break request resolution.
 */
export function isCapacitorNativeApp(): boolean {
  try {
    if (typeof window === 'undefined' || !window) return false;
    const cap: any = (window as any).Capacitor;
    if (!cap || (typeof cap !== 'object' && typeof cap !== 'function')) return false;
    if (typeof cap.isNativePlatform === 'function' && cap !== null) {
      try {
        if (cap.isNativePlatform() === true) return true;
      } catch {
        // Fall through to the other markers.
      }
    }
    if (typeof cap.getPlatform === 'function') {
      try {
        const platform = cap.getPlatform();
        if (typeof platform === 'string' && platform) return platform !== 'web';
      } catch {
        // Fall through to the platform token.
      }
    }
    if (typeof cap.platform === 'string' && cap.platform) return cap.platform !== 'web';
    // The bridge already reported non-native via isNativePlatform() above —
    // respect that answer instead of guessing from the object's presence.
    if (typeof cap.isNativePlatform === 'function') return false;
    // A bridge-injected window.Capacitor object with no web marker at all is
    // treated as native (defensive fallback for very old bridges).
    return true;
  } catch {
    return false;
  }
}

/** Trim whitespace and any trailing slashes so joins never produce `//`. */
export function normalizeApiBaseUrl(value: string | null | undefined): string {
  return (typeof value === 'string' ? value : '').trim().replace(/\/+$/, '');
}

export interface ResolveApiBaseOptions {
  /** Environment detection override — tests inject this instead of a WebView. */
  isNativeCapacitor?: boolean;
  /**
   * Explicit base URL override (native only). `undefined` reads the
   * build-time `VITE_API_BASE_URL`; `null`/'' disables it. Only absolute
   * http(s) origins are accepted; anything else falls back to production.
   */
  overrideBaseUrl?: string | null;
}

/**
 * Resolve the API origin prefix for the current runtime:
 * - Web / non-native: `''` — callers keep relative same-origin `/api/*` URLs.
 * - Packaged Capacitor app: the valid override, else the production backend.
 */
export function resolveApiBaseUrl(options: ResolveApiBaseOptions = {}): string {
  const isNative = options.isNativeCapacitor ?? isCapacitorNativeApp();
  if (!isNative) return '';
  const overrideSource =
    options.overrideBaseUrl === undefined ? readBuildTimeApiBaseOverride() : options.overrideBaseUrl;
  const override = normalizeApiBaseUrl(overrideSource);
  if (override && /^https?:\/\//i.test(override)) return override;
  return CAPACITOR_PRODUCTION_API_BASE_URL;
}

/** Join an origin prefix and an API path without producing `//` segments. */
export function buildApiUrl(baseUrl: string, apiPath: string): string {
  const base = normalizeApiBaseUrl(baseUrl);
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${path}`;
}

/**
 * Resolve a backend path such as `/api/translate-emergency` for the current
 * runtime. EVERY frontend → backend request must go through this helper:
 *
 *   fetch(apiUrl('/api/translate-emergency'), ...)
 *
 * On the web this returns the path unchanged; inside the Capacitor Android
 * app it returns the absolute production backend URL. Online-ONLY behaviors
 * (e.g. onlineOnly translation) are unchanged — a failed network request
 * still fails explicitly; this helper only decides which origin is asked.
 */
export function apiUrl(apiPath: string): string {
  return buildApiUrl(resolveApiBaseUrl(), apiPath);
}
