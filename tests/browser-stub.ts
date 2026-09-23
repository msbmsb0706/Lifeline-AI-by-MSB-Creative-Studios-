/**
 * Minimal browser-global stubs for exercising the queue library in Node.
 *
 * `emergencyPartnerQueue.ts` only uses `navigator.onLine`, `localStorage`, and
 * `fetch` from the browser environment. These stubs provide an in-memory
 * localStorage and a settable navigator so the real queue module can be tested
 * against its actual persisted lifecycle behaviour without a browser.
 */

export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    }
  };
}

export interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

export function mockResponse(status: number, body: any): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
  };
}

/**
 * Installs (or resets) the browser globals. Returns the globalThis for
 * convenience. `fetch` is cleared by default so network usage in a test is an
 * explicit opt-in.
 */
export function installBrowserStub(options?: {
  online?: boolean;
  fetch?: (url: string, init?: any) => Promise<MockResponse>;
}): typeof globalThis {
  // Node 21+ ships a read-only global `navigator` (getter-only), so define our
  // stub via Object.defineProperty to override it cleanly.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: options?.online ?? true }
  });
  (globalThis as any).localStorage = createMemoryStorage();
  if (options?.fetch) {
    (globalThis as any).fetch = options.fetch;
  } else {
    delete (globalThis as any).fetch;
  }
  return globalThis as typeof globalThis;
}
