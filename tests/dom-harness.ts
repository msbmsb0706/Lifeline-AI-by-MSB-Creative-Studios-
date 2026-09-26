/**
 * jsdom harness that renders the REAL React components against a fake
 * Chrome/Android SpeechRecognition, so the microphone lifecycle can be
 * reproduced and asserted in Node (no device, no paid ASR service).
 *
 * The fake recognizer models the behaviours that matter on Android Chrome:
 *  - `start()` throws InvalidStateError while a session is already running
 *  - `stop()` / `abort()` end the session and fire `onend` asynchronously
 *  - Chrome ends recognition BY ITSELF at its speech end-point (`autoEnd`)
 *  - results can arrive interim-only, with a final flag, or cumulatively
 *    re-emitted (Android duplicates)
 */
import { JSDOM } from 'jsdom';

export interface FakeResult {
  transcript: string;
  isFinal: boolean;
}

function makeResultList(results: FakeResult[]): any {
  const list: any = [];
  for (const r of results) {
    const entry: any = [{ transcript: r.transcript, confidence: 0.9 }];
    entry.isFinal = r.isFinal;
    list.push(entry);
  }
  return list;
}

export class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];
  /**
   * Global ordering log across mic events and recognition starts, so tests can
   * assert e.g. "the probe stream was stopped BEFORE recognition.start()".
   * Entries: 'mic-permission-granted', 'mic-track-stopped', 'recognition-start'.
   */
  static orderLog: string[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;

  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onnomatch: (() => void) | null = null;

  started = false;
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;
  /** lang values passed to start(), in order — proves language selection. */
  startLangs: string[] = [];
  /** Every onresult payload this instance received (audit trail). */
  resultEvents: FakeResult[][] = [];
  errors: string[] = [];
  ends = 0;

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  start(): void {
    if (this.started) {
      const err = new Error('recognition has already started');
      err.name = 'InvalidStateError';
      throw err;
    }
    this.started = true;
    this.startCalls += 1;
    this.startLangs.push(this.lang);
    FakeSpeechRecognition.orderLog.push('recognition-start');
    // Chrome fires onstart in a later task, never synchronously.
    setTimeout(() => {
      if (this.started) this.onstart?.();
    }, 0);
  }

  stop(): void {
    this.stopCalls += 1;
    if (!this.started) return;
    this.started = false;
    setTimeout(() => {
      this.ends += 1;
      this.onend?.();
    }, 0);
  }

  abort(): void {
    this.abortCalls += 1;
    if (!this.started) return;
    this.started = false;
    setTimeout(() => {
      this.ends += 1;
      this.onend?.();
    }, 0);
  }

  // ---- Android simulation helpers -----------------------------------------

  /** Deliver a results event exactly as the browser would. */
  emit(results: FakeResult[], resultIndex = 0): void {
    if (!this.started) return;
    const list = makeResultList(results);
    this.resultEvents.push(results.map((r) => ({ ...r })));
    this.onresult?.({ resultIndex, results: list });
  }

  /** Chrome reached its speech end-point and ended recognition by itself. */
  autoEnd(): void {
    if (!this.started) return;
    this.started = false;
    this.ends += 1;
    this.onend?.();
  }

  /** Fire a recognition error (no-speech, network, aborted, ...). */
  fireError(code: string): void {
    this.errors.push(code);
    this.onerror?.({ error: code });
  }
}

export interface MicProbe {
  /** Every getUserMedia constraint set the page requested. */
  getUserMediaCalls: any[];
  /** Number of microphone tracks stopped by the page. */
  trackStops: number;
  /** Number of MediaRecorder sessions the page started (server ASR path). */
  recorderStarts: number;
  /** Number of browser alert() dialogs the page tried to show. */
  alerts: number;
  /** Change the probe rejection between taps (null = grant). */
  setProbeError: (errorName: string | null) => void;
}

export interface Harness {
  dom: JSDOM;
  window: any;
  document: any;
  root: HTMLElement;
  recognition: () => FakeSpeechRecognition;
  /** Microphone permission probe instrumentation (present whenever the page can use it). */
  mic: MicProbe;
  unmount: () => void;
  cleanup: () => void;
}

let installed = 0;

/**
 * Installs a fresh jsdom + fake SpeechRecognition on globalThis and returns a
 * mount point. Call `cleanup()` in a finally block.
 *
 * `micPermission` ('granted' | 'denied' | 'prompt') installs a
 * navigator.permissions + navigator.mediaDevices probe environment so the
 * microphone-permission-probe path can be exercised. Omit it to keep the
 * bare environment (no permissions API, no mediaDevices) that earlier
 * sections of the suite depend on.
 */
export function installDomHarness(options?: {
  url?: string;
  micPermission?: 'granted' | 'denied' | 'prompt';
  micProbeErrorName?: string | null;
  navigatorLanguages?: string[];
  /** Install a fake MediaRecorder so the server-transcription path is testable. */
  withMediaRecorder?: boolean;
}): Harness {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: options?.url || 'https://lifeline.test/',
    pretendToBeVisual: true
  });

  const win: any = dom.window;
  const doc: any = win.document;

  FakeSpeechRecognition.orderLog = [];
  let micNextErrorName: string | null = options?.micProbeErrorName ?? null;
  const mic: MicProbe = {
    getUserMediaCalls: [],
    trackStops: 0,
    recorderStarts: 0,
    alerts: 0,
    setProbeError: (name: string | null) => { micNextErrorName = name; }
  };

  // The emergency UI must never pop a browser alert dialog ("visible in
  // public"): record any attempt so tests can assert it never happens.
  const alertSpy = (..._args: any[]) => { mic.alerts += 1; };
  win.alert = alertSpy;

  if (options?.navigatorLanguages) {
    Object.defineProperty(win.navigator, 'languages', {
      value: [...options.navigatorLanguages],
      configurable: true
    });
  }

  if (options?.micPermission !== undefined) {
    win.navigator.permissions = {
      query: (descriptor: any) => Promise.resolve({
        name: descriptor?.name,
        state: options.micPermission,
        addEventListener: () => {},
        removeEventListener: () => {}
      })
    };
    win.navigator.mediaDevices = {
      getUserMedia: (constraints: any) => {
        mic.getUserMediaCalls.push(constraints);
        if (micNextErrorName) {
          const err = new Error(micNextErrorName);
          err.name = micNextErrorName;
          return Promise.reject(err);
        }
        const track = {
          kind: 'audio',
          label: 'fake-microphone',
          readyState: 'live',
          stop: () => {
            mic.trackStops += 1;
            FakeSpeechRecognition.orderLog.push('mic-track-stopped');
          }
        };
        FakeSpeechRecognition.orderLog.push('mic-permission-granted');
        return Promise.resolve({
          getTracks: () => [track],
          getAudioTracks: () => [track],
          active: true,
          addEventListener: () => {},
          removeEventListener: () => {}
        });
      }
    };
  }

  if (options?.withMediaRecorder) {
    class FakeMediaRecorder {
      static isTypeSupported = (m: string) => m.startsWith('audio/webm');
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: any) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public stream: any, public options?: any) {}
      start() {
        this.state = 'recording';
        mic.recorderStarts += 1;
        setTimeout(() => this.ondataavailable?.({ data: new win.Blob(['audio'], { type: 'audio/webm' }), size: 5 }), 0);
      }
      stop() {
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    win.MediaRecorder = FakeMediaRecorder;
    (globalThis as any).MediaRecorder = FakeMediaRecorder;
  }

  // Minimal browser APIs the components touch.
  win.matchMedia = win.matchMedia || (() => ({
    matches: false,
    media: '',
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  }));
  win.IntersectionObserver = win.IntersectionObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  win.ResizeObserver = win.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  win.scrollTo = win.scrollTo || (() => {});
  // React's legacy change-event polyfill (activated when react-dom was loaded
  // before any DOM existed and so believes it is in old IE) calls
  // element.attachEvent/detachEvent when a text input receives focus. jsdom
  // elements do not have those IE APIs; no-op them so focusing inputs in
  // tests never crashes (the polyfill is otherwise inert in jsdom).
  if (typeof (win.HTMLElement.prototype as any).attachEvent !== 'function') {
    (win.HTMLElement.prototype as any).attachEvent = () => {};
    (win.HTMLElement.prototype as any).detachEvent = () => {};
  }
  if (!win.speechSynthesis) {
    win.speechSynthesis = {
      speak: () => {},
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }
  win.SpeechSynthesisUtterance = win.SpeechSynthesisUtterance || class {
    constructor(public text: string) {}
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    lang = '';
    voice: any = null;
    rate = 1;
    pitch = 1;
    volume = 1;
  };

  FakeSpeechRecognition.instances = [];
  win.SpeechRecognition = FakeSpeechRecognition;
  win.webkitSpeechRecognition = FakeSpeechRecognition;

  // Expose the jsdom globals the React runtime and the app expect.
  const globals: Record<string, any> = {
    window: win,
    document: doc,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    Element: win.Element,
    Node: win.Node,
    NodeList: win.NodeList,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    MessageChannel: win.MessageChannel,
    FileReader: win.FileReader,
    Blob: win.Blob,
    FormData: win.FormData,
    localStorage: win.localStorage,
    location: win.location,
    DOMParser: win.DOMParser,
    SVGElement: win.SVGElement,
    DocumentFragment: win.DocumentFragment,
    alert: alertSpy
  };
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) continue;
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }
  installed += 1;

  const root = doc.getElementById('root') as HTMLElement;

  return {
    dom,
    window: win,
    document: doc,
    root,
    recognition: () => FakeSpeechRecognition.instances[FakeSpeechRecognition.instances.length - 1],
    mic,
    unmount: () => {
      /* assigned by mountReact() */
    },
    cleanup: () => {
      try { win.close(); } catch { /* already closed */ }
      installed -= 1;
      if (installed <= 0) {
        try { delete (globalThis as any).MediaRecorder; } catch { /* non-configurable */ }
        for (const key of Object.keys(globals)) {
          try { delete (globalThis as any)[key]; } catch { /* non-configurable */ }
        }
        FakeSpeechRecognition.instances = [];
      }
    }
  };
}

/**
 * React decides ONCE, at module init, whether the browser natively supports
 * the 'input' event: it probes `document.createElement('input').oninput` on
 * the GLOBAL document. jsdom only compiles inline handler strings into
 * functions when the window is created with `runScripts: 'dangerously'`;
 * without that probe, React falls back to an IE-era change polyfill that no
 * test can drive (onChange would never fire from a dispatched input event).
 *
 * Call this once, BEFORE the first `await import('react-dom/client')`, so
 * the module-init probe runs against a script-enabled jsdom document. Real
 * test environments (installDomHarness) install their own window/document
 * afterwards; this environment only needs to survive the probe.
 */
export function installReactInputProbeEnvironment(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://lifeline.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  // React's module init also reads the GLOBAL navigator (userAgent feature
  // detection) — give it the jsdom one so it sees a consistent browser.
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
}

/** Wait `ms` milliseconds (real timers — the component uses real timers). */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until `predicate` is true or the timeout expires. */
export async function waitFor(predicate: () => boolean, timeoutMs = 4000, stepMs = 15): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(stepMs);
  }
  return predicate();
}
