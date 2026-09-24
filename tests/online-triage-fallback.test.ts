/** Resilience of the actual network decision used by App.handleAnalyzeEmergency.
 * Mocked fetch only: no API or emergency partner receives any SOS. */
import { readFileSync } from 'node:fs';
import { classifyEmergencyOffline } from '../src/lib/offlineClassifier.ts';
import { attemptOnlineTriage, type OnlineTriageFetcher } from '../src/lib/onlineTriage.ts';
import { section, assert, assertEqual } from './helpers.ts';

const text = 'அப்பா மூச்சு விடவில்லை';
const payload = { text, location: null, coordinates: null, language: 'Tamil', targetLanguage: 'ta' };
const identity = (r: ReturnType<typeof classifyEmergencyOffline>) => `${r.emergency_type}/${r.severity}/${r.emergency_category}`;

section('Online triage fallback — airplane mode + 500 repeated typed SOS, zero fetch');
let calls = 0;
const forbidFetch: OnlineTriageFetcher = async () => { calls++; throw Error('must never reach fetch while offline'); };
let correctlyClassified = true;
for (let i = 0; i < 500; i++) {
  const attempted = await attemptOnlineTriage(payload, { isOnline: false, fetcher: forbidFetch });
  if (!('reason' in attempted) || !attempted.reason.includes('offline')) correctlyClassified = false;
  if (identity(classifyEmergencyOffline(text)) !== 'Medical - Cardiac Emergency/5/MEDICAL') correctlyClassified = false;
}
assert(correctlyClassified, '500 airplane-mode attempts yield the critical on-device Tamil SOS');
assertEqual(calls, 0, '500 airplane-mode attempts made ZERO network calls');

section('Online triage fallback — any failed online AI attempt returns a reason for local classification');
let failed500 = true;
const noSignal: OnlineTriageFetcher = async (url) => { calls++; assertEqual(url, '/api/analyze-emergency', 'only the analysis endpoint is called'); throw new TypeError('signal lost'); };
// Use a counter-only fetch for the bulk test (to avoid 500 verbose assertions).
const droppedConnection: OnlineTriageFetcher = async (url) => { calls++; if (url !== '/api/analyze-emergency') throw Error('wrong endpoint'); throw new TypeError('signal lost'); };
for (let i = 0; i < 500; i++) {
  const outcome = await attemptOnlineTriage(payload, { isOnline: true, fetcher: droppedConnection });
  if (!('reason' in outcome) || !outcome.reason.includes('Network error')) failed500 = false;
  if (classifyEmergencyOffline(text).severity !== 5) failed500 = false;
}
assert(failed500, '500 broken-network attempts can fall back to MEDICAL 5 without cloud success');
assertEqual(calls, 500, '500 failure attempts called only the mock analysis endpoint (never partners)');
const failedSingle = await attemptOnlineTriage(payload, { isOnline: true, fetcher: noSignal });
assert('reason' in failedSingle, 'online network failure is explicitly reported, not a fabricated response');

const response = (status: number, body: any): OnlineTriageFetcher => async () => ({
  status, ok: status >= 200 && status < 300, json: async () => body
});
for (const [label, fetcher] of [
  ['no API key', response(401, { success: false, error: 'AI is not configured' })],
  ['server unavailable', response(503, { success: false, error: 'Service unavailable' })],
  ['invalid success payload', response(200, { success: true, data: { severity: 5 } })],
  ['invalid JSON', async () => ({ status: 200, ok: true, json: async () => { throw SyntaxError('invalid json'); } })]
] as Array<[string, OnlineTriageFetcher]>) {
  const attempted = await attemptOnlineTriage(payload, { isOnline: true, fetcher });
  assert('reason' in attempted, `${label} → labelled local fallback, never fake online success`);
}

let aborted = false;
const start = Date.now();
const hanging: OnlineTriageFetcher = async (_url, init) => new Promise((_resolve, reject) => {
  init.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
});
const timeout = await attemptOnlineTriage(payload, { isOnline: true, fetcher: hanging, timeoutMs: 15 });
assert('reason' in timeout && timeout.reason.includes('15 ms'), 'slow network causes time-bounded, clearly labelled fallback');
assert(aborted, 'timeout aborts the in-flight online request');
assert(Date.now() - start < 500, 'timeout does not block local triage indefinitely');
const ignoringAbort: OnlineTriageFetcher = async () => new Promise(() => undefined);
const hungBody = await attemptOnlineTriage(payload, { isOnline: true, fetcher: ignoringAbort, timeoutMs: 15 });
assert('reason' in hungBody && hungBody.reason.includes('15 ms'), 'even broken fetch shims ignoring AbortSignal cannot hang SOS');

section('Online triage fallback — valid online reply remains online, original typed text preserved');
const onlineData: any = { ...classifyEmergencyOffline(text),
  source: 'nebius_nemotron', model_used: 'MOCK Nemotron', timestamp: new Date().toISOString() };
let sentPayload: any;
const online = await attemptOnlineTriage(payload, { isOnline: true, fetcher: async (url, init) => {
  assertEqual(url, '/api/analyze-emergency', 'online success still uses the existing analysis API');
  sentPayload = JSON.parse(String(init.body));
  return { ok: true, status: 200, json: async () => ({ success: true, data: onlineData }) };
} });
assertEqual(online.ok, true, 'valid online reply is NOT replaced by offline triage');
assertEqual(sentPayload.text, text, 'online attempt preserves original Tamil input verbatim');
assertEqual(sentPayload.offlineModeForce, false, 'online request marks online mode explicitly');
assert(!('reason' in online), 'successful online result has no offline failure reason');

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const handler = app.slice(app.indexOf('const handleAnalyzeEmergency ='), app.indexOf('// Dedicated "Translate SOS" Handler'));
assert(handler.indexOf('if (offlineForce)') < handler.indexOf('attemptOnlineTriage('), 'user-selected OFFLINE mode never enters online attempt');
assert(handler.includes("if ('reason' in attempt)") && handler.includes('completeOnDevice(attempt.reason)'),
  'App uses the tested online failure result to visibly classify on-device');
assert(handler.includes("source: 'offline_fallback'") && handler.includes('NOT sent to a responder'),
  'App labels its local fallback and never claims the SOS was delivered');
assert(app.includes("offlineForce || currentResult.source === 'offline_fallback'"),
  'automatically offline-classified SOS uses the bundled offline phrasebook without another API call');
assert(app.includes('latency_ms: Math.max(0, Date.now() - startedAt)'),
  'local fallback reports measured latency, not a fabricated 1 ms');
