/**
 * Centralized API base URL resolution — regression tests (Capacitor routing fix).
 *
 * The packaged Android APK runs the frontend from the WebView's own local
 * origin, so relative `/api/*` requests never reached the Render backend
 * (translation, triage and partner flows failed on Android while working on
 * the web). The fix routes every frontend backend request through
 * src/lib/apiBase.ts:
 *
 *   - Web / dev / tests: unchanged relative `/api/*` same-origin URLs.
 *   - Packaged Capacitor app: absolute URLs against the production backend
 *     (https://lifeline-ai-by-msb-creative-studios.onrender.com).
 *
 * These tests pin the resolution matrix, the runtime detection, and the
 * actual call sites in the source tree so a future refactor cannot silently
 * reintroduce a bare relative fetch that breaks the Android app.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { section, assert, assertEqual } from './helpers.ts';
import {
  CAPACITOR_PRODUCTION_API_BASE_URL,
  apiUrl,
  buildApiUrl,
  isCapacitorNativeApp,
  normalizeApiBaseUrl,
  resolveApiBaseUrl
} from '../src/lib/apiBase.ts';

const PROD_BASE = 'https://lifeline-ai-by-msb-creative-studios.onrender.com';

function readRepoSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function listSourceFiles(dir: string): string[] {
  const root = new URL(`../${dir}/`, import.meta.url).pathname;
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// A. Resolution matrix (pure function — environment injected)
// ---------------------------------------------------------------------------
section('API base URL resolution matrix');

assertEqual(
  CAPACITOR_PRODUCTION_API_BASE_URL,
  PROD_BASE,
  'the packaged native app targets the exact production Render backend'
);

assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: false }),
  '',
  'web: base resolves empty — requests stay on relative same-origin /api/*'
);
assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: false, overrideBaseUrl: 'https://staging.example.com' }),
  '',
  'web: an override must NEVER force absolute URLs on the website'
);
assertEqual(
  buildApiUrl(resolveApiBaseUrl({ isNativeCapacitor: false }), '/api/translate-emergency'),
  '/api/translate-emergency',
  'web API URL keeps the exact relative path production uses today'
);

assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: true }),
  PROD_BASE,
  'Capacitor default: the production Render backend'
);
assertEqual(
  buildApiUrl(resolveApiBaseUrl({ isNativeCapacitor: true }), '/api/translate-emergency'),
  `${PROD_BASE}/api/translate-emergency`,
  'Capacitor API URL is the absolute backend URL'
);
assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: true, overrideBaseUrl: 'https://staging.example.com' }),
  'https://staging.example.com',
  'Capacitor: a valid https build-time override is honored'
);
assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: true, overrideBaseUrl: 'https://staging.example.com/' }),
  'https://staging.example.com',
  'override trailing slashes are normalized away (never //api/...)'
);
assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: true, overrideBaseUrl: 'http://10.0.2.2:3000/' }),
  'http://10.0.2.2:3000',
  'http override is allowed for emulator/local debugging builds'
);
assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: true, overrideBaseUrl: 'ftp://junk' }),
  PROD_BASE,
  'a non-http(s) override falls back to production'
);
assertEqual(
  resolveApiBaseUrl({ isNativeCapacitor: true, overrideBaseUrl: '   ' }),
  PROD_BASE,
  'a blank override falls back to production'
);

assertEqual(normalizeApiBaseUrl(' https://a.example.com/// '), 'https://a.example.com', 'normalizeApiBaseUrl trims and strips trailing slashes');
assertEqual(buildApiUrl('', '/api/status'), '/api/status', 'empty base keeps the relative path unchanged');
assertEqual(buildApiUrl(`${PROD_BASE}/`, 'api/status'), `${PROD_BASE}/api/status`, 'join tolerates missing/extra slashes');
assertEqual(buildApiUrl(PROD_BASE, '/api/emergency-partner/config?country=GLOBAL'), `${PROD_BASE}/api/emergency-partner/config?country=GLOBAL`, 'query strings survive the join');

// ---------------------------------------------------------------------------
// B. Runtime apiUrl() in THIS test environment must stay relative — this is
// what keeps every existing fetch-URL assertion (App, recovery, partner
// flows) byte-identical to the pre-fix behavior.
// ---------------------------------------------------------------------------
section('apiUrl() in a non-native environment stays relative');

assertEqual(apiUrl('/api/status'), '/api/status', 'apiUrl /api/status relative');
assertEqual(apiUrl('/api/analyze-emergency'), '/api/analyze-emergency', 'apiUrl /api/analyze-emergency relative');
assertEqual(apiUrl('/api/translate-emergency'), '/api/translate-emergency', 'apiUrl /api/translate-emergency relative');
assertEqual(apiUrl('/api/translate-to-english'), '/api/translate-to-english', 'apiUrl /api/translate-to-english relative');
assertEqual(apiUrl('/api/transcribe-speech'), '/api/transcribe-speech', 'apiUrl /api/transcribe-speech relative');
assertEqual(apiUrl('/api/emergency-partner/dispatch'), '/api/emergency-partner/dispatch', 'apiUrl /api/emergency-partner/dispatch relative');
assertEqual(apiUrl('/api/emergency-partner/config?country=GLOBAL'), '/api/emergency-partner/config?country=GLOBAL', 'apiUrl partner config relative');
assertEqual(apiUrl('/api/privacy-contact'), '/api/privacy-contact', 'apiUrl /api/privacy-contact relative');

// ---------------------------------------------------------------------------
// C. Native-shell detection (bridge-injected window.Capacitor markers)
// ---------------------------------------------------------------------------
section('Capacitor native-shell detection');

const savedWindow = (globalThis as any).window;
try {
  delete (globalThis as any).window;
  assertEqual(isCapacitorNativeApp(), false, 'no window (Node/SSR/tests) is never native');

  (globalThis as any).window = {};
  assertEqual(isCapacitorNativeApp(), false, 'a plain browser window is never native');
  assertEqual(apiUrl('/api/translate-emergency'), '/api/translate-emergency', 'plain browser keeps relative URLs');

  // Capacitor >= 2 bridge contract inside the Android WebView.
  (globalThis as any).window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', platform: 'android' } };
  assertEqual(isCapacitorNativeApp(), true, 'bridge isNativePlatform() === true detects the Android WebView');
  assertEqual(
    apiUrl('/api/translate-emergency'),
    `${PROD_BASE}/api/translate-emergency`,
    'inside the detected WebView, translation resolves to the production backend'
  );
  assertEqual(
    apiUrl('/api/status'),
    `${PROD_BASE}/api/status`,
    'inside the detected WebView, the status probe resolves to the production backend'
  );

  // Web plugins also inject the bridge with isNativePlatform() === false —
  // that explicit non-native answer must be respected (no presence-guessing).
  (globalThis as any).window = { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web', platform: 'web' } };
  assertEqual(isCapacitorNativeApp(), false, 'bridge reporting web platform is respected as non-native');
  assertEqual(apiUrl('/api/status'), '/api/status', 'web bridge keeps relative URLs');

  // Older bridges without isNativePlatform().
  (globalThis as any).window = { Capacitor: { getPlatform: () => 'android', platform: 'android' } };
  assertEqual(isCapacitorNativeApp(), true, 'getPlatform() fallback detects native');
  (globalThis as any).window = { Capacitor: { platform: 'ios' } };
  assertEqual(isCapacitorNativeApp(), true, 'platform token fallback detects native (iOS shell)');
  (globalThis as any).window = { Capacitor: { platform: 'web' } };
  assertEqual(isCapacitorNativeApp(), false, 'platform token web is non-native');

  // A hostile/throwing stub can never flip the app into native mode.
  (globalThis as any).window = {
    Capacitor: {
      isNativePlatform: () => { throw new Error('broken'); },
      getPlatform: () => { throw new Error('broken'); },
      platform: undefined
    }
  };
  assertEqual(isCapacitorNativeApp(), false, 'throwing bridge stubs never misdetect as native');
  assertEqual(apiUrl('/api/status'), '/api/status', 'throwing bridge stubs keep relative URLs');
} finally {
  if (savedWindow === undefined) delete (globalThis as any).window;
  else (globalThis as any).window = savedWindow;
}

// ---------------------------------------------------------------------------
// D. Source pins — every frontend backend request goes through apiUrl()
// ---------------------------------------------------------------------------
section('Call-site pins — all frontend /api/* requests use the centralized helper');

// No raw relative API fetch may survive anywhere in the frontend source.
const sourceOffenders: string[] = [];
for (const file of listSourceFiles('src')) {
  const text = readFileSync(file, 'utf8');
  if (/fetch\(\s*['"`]\/api\//.test(text)) sourceOffenders.push(file);
}
assertEqual(sourceOffenders.length, 0, `no bare fetch('/api/...') remains in src/ (${sourceOffenders.join(', ') || 'none'})`);

const appSource = readRepoSource('../src/App.tsx');
assert(appSource.includes("import { apiUrl } from './lib/apiBase.ts';"), 'App.tsx imports the centralized helper');
for (const route of ['/api/status', '/api/transcribe-speech', '/api/translate-to-english', '/api/translate-emergency']) {
  assert(appSource.includes(`apiUrl('${route}')`), `App.tsx routes ${route} through apiUrl()`);
}
assert(!appSource.includes("fetch('/api/"), 'App.tsx has no relative-API fetch left');

const privacySource = readRepoSource('../src/components/PrivacyContactFormModal.tsx');
assert(privacySource.includes("apiUrl('/api/privacy-contact')"), 'Privacy contact form posts through apiUrl()');

const recoverySource = readRepoSource('../src/lib/automaticSOSRecovery.ts');
assert(recoverySource.includes("apiUrl('/api/status')"), 'automatic SOS recovery probes /api/status through apiUrl()');
assert(
  recoverySource.includes("apiUrl('/api/emergency-partner/config?country=GLOBAL')"),
  'automatic SOS recovery checks partner config through apiUrl()'
);

const queueSource = readRepoSource('../src/lib/emergencyPartnerQueue.ts');
assert(
  queueSource.includes("apiUrl('/api/emergency-partner/dispatch')"),
  'partner dispatch endpoint is fixed AND centralized through apiUrl()'
);
assert(
  queueSource.includes('Never trust a URL'),
  'the durable-ledger dispatch route still never trusts persisted provider metadata'
);

const triageSource = readRepoSource('../src/lib/onlineTriage.ts');
assert(triageSource.includes("apiUrl('/api/analyze-emergency')"), 'online triage posts through apiUrl()');

const caseSource = readRepoSource('../src/lib/partnerCaseTracking.ts');
assert(caseSource.includes("apiUrl('/api/emergency-partner')"), 'partner case-flow base is routed through apiUrl()');

const partnerConfigSource = readRepoSource('../src/lib/partnerConfig.ts');
assert(
  partnerConfigSource.includes('apiUrl(`/api/emergency-partner/config?country='),
  'partner config lookup is routed through apiUrl()'
);

// The translation request is separate and user-initiated: the Android fix only
// moved it to the right origin, and it must keep going through the helper with
// the applied mode stated explicitly (an online failure never silently turns
// into an offline translation).
assert(
  appSource.includes("apiUrl('/api/translate-emergency')") && appSource.includes('offlineModeForce: offlineForce'),
  'the separate translate request still uses apiUrl() and states the applied mode'
);

// The fix must NOT load the remote site into the WebView: no server.url.
const capacitorConfigSource = readRepoSource('../capacitor.config.ts');
assert(!/server\s*:/.test(capacitorConfigSource), 'capacitor.config.ts has no server block — the APK keeps its local bundle');
assert(!/url\s*:/.test(capacitorConfigSource), 'capacitor.config.ts sets no remote url — remote content is never loaded into the WebView');

// No secret may ever live in the frontend helper or its callers.
const helperSource = readRepoSource('../src/lib/apiBase.ts');
assert(
  !/api[_-]?key\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9_.-]+|-----BEGIN|nvapi-|sk-[a-z0-9]/i.test(helperSource),
  'apiBase.ts contains no credentials — only the public backend origin'
);
