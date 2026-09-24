/**
 * Register the production service worker, which saves the COMPLETE app shell
 * after one successful online visit. Install can fail (e.g. network loss while
 * downloading a JS bundle); the last known good version remains usable.
 * Browsers may still evict caches/storage or suspend locked-screen web pages.
 */
export function registerOfflineShell(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  // Vite replaces import.meta.env in production; no worker on the HMR dev server.
  if (!(import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD) return;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;

  const install = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('Offline shell registration failed:', error);
    });
    // Best effort only. A browser can deny persistence or evict saved files;
    // this does NOT guarantee survival after battery exhaustion / OS cleanup.
    try { navigator.storage?.persist?.().catch(() => undefined); }
    catch { /* storage persistence unsupported */ }
  };
  if (document.readyState === 'complete') install();
  else window.addEventListener('load', install, { once: true });
}

/**
 * Ask the active worker whether HTML AND all of its required JS/CSS are cached.
 * "Active worker" by itself is not proof of offline readiness. The result is
 * only a best-effort status now; the OS may clear storage later.
 */
export function checkOfflineShellReady(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) || !navigator.serviceWorker.controller ||
      typeof MessageChannel === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let finished = false;
    const finish = (ready: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(ready);
    };
    const timer = window.setTimeout(() => finish(false), 1500);
    channel.port1.onmessage = (event) => finish(event.data === true);
    try {
      navigator.serviceWorker.controller!.postMessage({ type: 'LIFELINE_OFFLINE_READY' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}
