/* LifeLine AI offline app shell — build stamps __LIFELINE_CACHE_ID__ into dist/sw.js.
 * Only public app code/graphics are cached. NO SOS text, recordings, /api/*
 * responses, POSTs, or partner dispatch requests are cached or sent by this worker.
 * After the first successful installation, cached HTML + its exact JS/CSS bundles
 * can start the app without a network. Storage and OS background execution remain
 * browser-controlled; this is not a background SOS transmitter.
 */
const CACHE_PREFIX = 'lifeline-shell-';
const CACHE_NAME = CACHE_PREFIX + '__LIFELINE_CACHE_ID__';
const SHELL = '/index.html';
const NAVIGATION_TIMEOUT_MS = 4000;
const OPTIONAL_ASSETS = [
  '/manifest.webmanifest', '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png',
  '/logo.png',
  '/assets/branding/lifeline-ai-pwa-icon-192.png',
  '/assets/branding/lifeline-ai-pwa-icon-512.png'
];

function shellAssetUrls(html) {
  // Vite writes local, versioned JS/CSS urls in the HTML. Require at least one
  // JS entry; never mark the page cached if a required bundle is missing.
  return [...new Set(Array.from(
    html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+\.(?:js|css))"/g),
    (m) => m[1]
  ))];
}

async function fetchCompleteShell() {
  const page = await fetch(SHELL, { cache: 'no-store' });
  if (!page.ok) throw new Error('App shell unavailable');
  const html = await page.clone().text();
  const assets = shellAssetUrls(html);
  if (!assets.some((url) => url.endsWith('.js'))) throw new Error('Missing app JavaScript');
  // Download ALL required bundles before storing HTML. A failed update leaves
  // the previous HTML + bundles intact (and a failed install keeps the old SW).
  const responses = await Promise.all(assets.map(async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Required app asset unavailable: ${url}`);
    return [url, res];
  }));
  const cache = await caches.open(CACHE_NAME);
  for (const [url, res] of responses) await cache.put(url, res);
  await cache.put(SHELL, page.clone()); // Commit only after the assets are saved.
  return page;
}

async function precache() {
  await fetchCompleteShell(); // Required: fail installation rather than install a broken shell.
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(OPTIONAL_ASSETS.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) await cache.put(url, res);
    } catch {
      // Missing logo must never prevent the app from opening offline.
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const previous = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
    // Keep the most recent previous release for tabs still running its JS.
    for (const stale of previous.slice(0, -1)) await caches.delete(stale);
    await self.clients.claim();
  })());
});

async function cachedShell() {
  const keys = await caches.keys();
  const candidates = [CACHE_NAME, ...keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).reverse()];
  for (const key of candidates) {
    const cache = await caches.open(key);
    const page = await cache.match(SHELL);
    if (!page) continue;
    const assets = shellAssetUrls(await page.clone().text());
    if (assets.some((url) => url.endsWith('.js')) &&
        (await Promise.all(assets.map((url) => cache.match(url)))).every(Boolean)) {
      return page;
    }
  }
  return null;
}

async function navigationResponse() {
  const saved = await cachedShell();
  if (saved) return saved; // No network required after a complete first install.
  try {
    const page = await Promise.race([
      fetchCompleteShell(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), NAVIGATION_TIMEOUT_MS))
    ]);
    return page;
  } catch {
    // A failed/slow fetch may have populated a complete shell during the race.
    const recovered = await cachedShell();
    if (recovered) return recovered;
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>LifeLine AI unavailable</title><body style="background:#0a0e17;color:white;font-family:sans-serif;padding:24px">' +
      '<h1>Offline app not ready</h1><p>Open LifeLine AI once while online to save it on this device.</p>' +
      '<p>In immediate danger, call your local emergency number directly. No SOS was sent by this page.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function assetResponse(request) {
  const current = await caches.open(CACHE_NAME);
  const saved = await current.match(request);
  if (saved) return saved;
  // An existing tab may still need a bundle from the previous app version.
  for (const key of (await caches.keys()).filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).reverse()) {
    const previous = await (await caches.open(key)).match(request);
    if (previous) return previous;
  }
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await current.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    return new Response('', { status: 504 });
  }
}

// The page can ask whether the COMPLETE app shell is present; an active worker
// alone is not proof (storage may have been cleared by the OS).
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'LIFELINE_OFFLINE_READY' || !event.ports?.[0]) return;
  event.waitUntil(cachedShell()
    .then((page) => event.ports[0].postMessage(Boolean(page)))
    .catch(() => event.ports[0].postMessage(false)));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse());
  } else if (url.pathname.startsWith('/assets/') || /\.(?:js|css|png|svg|ico|webp|jpe?g|webmanifest)$/.test(url.pathname)) {
    event.respondWith(assetResponse(request));
  }
});
