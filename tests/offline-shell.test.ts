/**
 * Simulated service-worker / Cache Storage integration tests. Real-device
 * background and battery behaviour remains untestable in Node (see QA report).
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { assert, assertEqual, section } from './helpers.ts';

section('Offline app shell — airplane mode, update safety, no emergency-data caching');

type Listener = (event: any) => void;
type Store = Map<string, Map<string, Response>>;

function createWorker(sharedStore: Store = new Map(), revision = 'release-1') {
  const keyOf = (req: Request | { url: string } | string) =>
    new URL(typeof req === 'string' ? req : req.url, 'https://app.test').pathname;
  const caches = {
    async open(name: string) {
      if (!sharedStore.has(name)) sharedStore.set(name, new Map());
      const bucket = sharedStore.get(name)!;
      return {
        async put(req: Request | string, res: Response) { bucket.set(keyOf(req), res.clone()); },
        async match(req: Request | string) { const r = bucket.get(keyOf(req)); return r?.clone(); }
      };
    },
    async keys() { return [...sharedStore.keys()]; },
    async delete(name: string) { return sharedStore.delete(name); }
  };

  const network = {
    mode: 'online' as 'online' | 'offline' | 'hang',
    assetRevision: 'a', failAsset: '' as string, calls: [] as string[]
  };
  const html = () =>
    '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-' + network.assetRevision + '.css"></head>' +
    '<body><div id="root"></div><script type="module" src="/assets/index-' + network.assetRevision + '.js"></script></body></html>';
  const fakeFetch = async (input: Request | string) => {
    const path = keyOf(input);
    network.calls.push(path);
    if (network.mode === 'offline') throw new TypeError('Failed to fetch');
    if (network.mode === 'hang') return new Promise<Response>(() => undefined);
    if (path === '/index.html') return new Response(html(), { status: 200, headers: { 'Content-Type': 'text/html' } });
    if (path === network.failAsset) return new Response('asset missing', { status: 404 });
    if (path.startsWith('/assets/') || /\.(?:png|svg|ico|webmanifest)$/.test(path)) {
      const response = new Response(`asset:${path}`, { status: 200 });
      Object.defineProperty(response, 'type', { value: 'basic' });
      return response;
    }
    return new Response('not found', { status: 404 });
  };

  const listeners: Record<string, Listener[]> = {};
  const self: any = {
    location: new URL('https://app.test/sw.js'),
    addEventListener: (type: string, fn: Listener) => { (listeners[type] ||= []).push(fn); },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined }
  };
  const context = vm.createContext({
    self, caches, fetch: fakeFetch, Response, Request, URL, Promise, setTimeout, clearTimeout, Array, Set, console
  });
  const script = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    .replaceAll('__LIFELINE_CACHE_ID__', revision);
  vm.runInContext(script, context);

  const dispatchLifecycle = async (type: string) => {
    let pending: Promise<unknown> = Promise.resolve();
    for (const fn of listeners[type] || []) fn({ waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  const dispatchFetch = async (url: string, init: { method?: string; mode?: string } = {}) => {
    const request = {
      url: new URL(url, 'https://app.test').href,
      method: init.method || 'GET', mode: init.mode || 'cors'
    };
    let responded: Promise<Response> | null = null;
    for (const fn of listeners.fetch || []) fn({ request, respondWith: (p: Promise<Response>) => { responded = p; } });
    return responded ? await responded : null;
  };
  const dispatchReady = async () => {
    let pending: Promise<unknown> = Promise.resolve();
    let response: boolean | undefined;
    for (const fn of listeners.message || []) fn({
      data: { type: 'LIFELINE_OFFLINE_READY' },
      ports: [{ postMessage: (value: boolean) => { response = value; } }],
      waitUntil: (p: Promise<unknown>) => { pending = p; }
    });
    await pending;
    return response;
  };
  return { network, store: sharedStore, dispatchLifecycle, dispatchFetch, dispatchReady };
}

const store: Store = new Map();
const sw = createWorker(store);
await sw.dispatchLifecycle('install');
await sw.dispatchLifecycle('activate');
const bucket = store.get('lifeline-shell-release-1');
assert(bucket?.has('/index.html'), 'install saves the complete app page');
assert(bucket?.has('/assets/index-a.js') && bucket?.has('/assets/index-a.css'), 'install saves matching JS and CSS before the page');
assert(bucket?.has('/manifest.webmanifest'), 'install caches the manifest (optional app metadata)');
assertEqual(await sw.dispatchReady(), true, 'readiness is TRUE only after complete HTML + JS/CSS install');

sw.network.mode = 'offline';
const before = sw.network.calls.length;
let allOpen = true;
for (let i = 0; i < 500; i++) {
  const page = await sw.dispatchFetch('/', { mode: 'navigate' });
  const js = await sw.dispatchFetch('/assets/index-a.js');
  const css = await sw.dispatchFetch('/assets/index-a.css');
  if (page?.status !== 200 || !(await page.text()).includes('<div id="root">') ||
      (await js?.text()) !== 'asset:/assets/index-a.js' ||
      (await css?.text()) !== 'asset:/assets/index-a.css') allOpen = false;
}
assert(allOpen, 'airplane mode: 500 launches open the real app + JS/CSS from cache');
assertEqual(sw.network.calls.length, before, 'airplane mode: 500 launches make ZERO network calls');
assertEqual((await sw.dispatchFetch('/deep/link', { mode: 'navigate' }))?.status, 200, 'cached app opens via deep link');
assertEqual(await sw.dispatchFetch('/api/analyze-emergency', { method: 'POST' }), null, 'POST /api/analyze-emergency is NEVER intercepted');
assertEqual(await sw.dispatchFetch('/api/emergency-partner/dispatch', { method: 'POST' }), null, 'partner dispatch is NEVER intercepted or sent by worker');
assertEqual(await sw.dispatchFetch('/api/status'), null, 'GET /api/* is NEVER intercepted or cached');
assert(![...bucket!.keys()].some((k) => k.startsWith('/api/')), 'cached app contains no emergency API data');

// Storage-pressure eviction: never claim offline readiness when required CSS is missing.
const cachedCss = bucket!.get('/assets/index-a.css')!;
bucket!.delete('/assets/index-a.css');
assertEqual(await sw.dispatchReady(), false, 'readiness becomes FALSE if the browser evicts a required file');
assertEqual((await sw.dispatchFetch('/', { mode: 'navigate' }))?.status, 503, 'incomplete cached shell is not presented as a working app');
bucket!.set('/assets/index-a.css', cachedCss);
assertEqual(await sw.dispatchReady(), true, 'restored complete shell is ready again');

// An update with a missing JS bundle must NOT replace the last-known-good shell.
const broken = createWorker(store, 'release-2');
broken.network.assetRevision = 'b';
broken.network.failAsset = '/assets/index-b.js';
let installRejected = false;
try { await broken.dispatchLifecycle('install'); } catch { installRejected = true; }
assert(installRejected, 'new release with missing JS fails installation');
assertEqual(store.has('lifeline-shell-release-2'), false, 'incomplete release never publishes a new cache');
assert((await (await sw.dispatchFetch('/', { mode: 'navigate' }))!.text()).includes('index-a.js'), 'old release remains usable after failed update');

// Recover when the server is healthy: only then switch to the new release.
broken.network.failAsset = '';
await broken.dispatchLifecycle('install');
await broken.dispatchLifecycle('activate');
broken.network.mode = 'offline';
assert((await (await broken.dispatchFetch('/', { mode: 'navigate' }))!.text()).includes('index-b.js'), 'successful update uses the matching new app');
assertEqual((await broken.dispatchFetch('/assets/index-b.js'))?.status, 200, 'new JS available offline');
assertEqual((await broken.dispatchFetch('/assets/index-a.js'))?.status, 200, 'old tab can still read previous JS');

// On a first-ever offline visit, the browser cannot even register this worker;
// if a worker was already running but lacked an app shell, it shows an honest
// error page rather than claiming to have sent an SOS.
const fresh = createWorker();
fresh.network.mode = 'offline';
let firstInstallFailed = false;
try { await fresh.dispatchLifecycle('install'); } catch { firstInstallFailed = true; }
assert(firstInstallFailed, 'first install needs an online visit (cannot install offline)');
const noShell = await fresh.dispatchFetch('/', { mode: 'navigate' });
assertEqual(noShell?.status, 503, 'no saved app + offline: explicit error, not a fake SOS');
assert((await noShell!.text()).includes('call your local emergency number'), 'error page directs user to local emergency number');

// Same test when the network hangs on first visit: bounded to 4 seconds.
const stalled = createWorker();
stalled.network.mode = 'hang';
const start = Date.now();
const timedOut = await stalled.dispatchFetch('/', { mode: 'navigate' });
assertEqual(timedOut?.status, 503, 'first visit with hanging network: no fake app');
assert(Date.now() - start < 5500, 'first visit with hanging network: error returned within 4 s timeout');

const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
assertEqual(manifest.display, 'standalone', 'manifest: installed app opens standalone');
for (const icon of manifest.icons) {
  assert(fs.existsSync(new URL(`../public${icon.src}`, import.meta.url)), `manifest icon exists: ${icon.src}`);
}
assert(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').includes('rel="manifest"'), 'index.html links the manifest');
assert(fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8').includes('registerOfflineShell()'), 'main.tsx registers the shell');
assert(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8').includes('scripts/stamp-service-worker.mjs'), 'build stamps a new SW revision per release');
