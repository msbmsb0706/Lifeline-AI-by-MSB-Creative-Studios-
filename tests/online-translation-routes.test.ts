/**
 * Online translation / error-handling — REAL route regression tests.
 *
 * Boots the actual Express application (server.ts) against an isolated
 * in-process upstream fixture and exercises the decoupled triage/follow-up
 * translation routes over real HTTP:
 *   - POST /api/analyze-emergency   (triage returns without translation)
 *   - POST /api/translate-emergency (automatic follow-up and manual action)
 *
 * The fixture replaces the Nebius Token Factory upstream only. No credentials
 * are used or read: NEBIUS_API_KEY is injected as a dummy value for the child
 * process, and `.env` / deployment configuration are untouched. Because these
 * are deterministic fixtures, they prove transport/error handling — NOT live
 * linguistic quality.
 */
import { createServer, request as httpRequest, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { section, assert, assertEqual } from './helpers.ts';

/**
 * Locate the locally installed tsx runner (package "exports" do not expose it
 * for module resolution, so the installed file path is used directly).
 */
function resolveTsxRunner(): { command: string; args: string[] } {
  const cli = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (existsSync(cli)) return { command: process.execPath, args: [cli, 'server.ts'] };
  const bin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  if (existsSync(bin)) return { command: bin, args: ['server.ts'] };
  return { command: process.execPath, args: ['server.ts'] };
}

const TSX = resolveTsxRunner();

const EN_TEXT = 'Please help me, there is a fire.';
const TA_TEXT = 'தயவுசெய்து எனக்கு உதவுங்கள், தீ விபத்து ஏற்பட்டுள்ளது.';
const GENERATED_DISPATCH =
  'DISPATCH ALERT: Priority 5/5 - [FIRE] Structure Fire. Required Assets: Fire service. Action: Dispatch nearest units immediately.';

type FixtureMode =
  | 'ok'
  | 'translation_slow'
  | 'translation_http_500'
  | 'translation_bad_json'
  | 'translation_missing_message'
  | 'translation_dispatch'
  | 'translation_wrong_target'
  | 'translation_truncated'
  | 'translation_structured_truncated'
  | 'translation_missing_original';

let mode: FixtureMode = 'ok';
let analysisRequests = 0;
let translationRequests = 0;
/** Last translation request body received by the fixture (parsed). */
let lastTranslationBody: any = null;
let lastPrimaryTranslationBody: any = null;
let slowTranslationGate: Promise<void> = Promise.resolve();
let releaseSlowTranslation: (() => void) | null = null;

const upstream: Server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', async () => {
    let body: any = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = {};
    }
    const systemPrompt: string = body?.messages?.[0]?.content || '';
    const isTranslation = systemPrompt.toLowerCase().includes('translation engine');

    if (!isTranslation) {
      analysisRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  language: 'English',
                  transcript: body?.messages?.[1]?.content?.slice(0, 200) || '',
                  emergency_type: 'FIRE',
                  severity: 5,
                  needs: ['Fire Engine', 'Ambulance'],
                  message: GENERATED_DISPATCH,
                  visual_card: 'FIRE EMERGENCY (PRIORITY 5/5)'
                })
              }
            }
          ]
        })
      );
      return;
    }

    translationRequests += 1;
    lastTranslationBody = body;
    if (systemPrompt.includes('emergency-message translation engine')) lastPrimaryTranslationBody = body;

    const respond = (payload: any, finishReason = 'stop') => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              finish_reason: finishReason,
              message: { role: 'assistant', content: typeof payload === 'string' ? payload : JSON.stringify(payload) }
            }
          ]
        })
      );
    };

    if (mode === 'translation_slow') await slowTranslationGate;
    if (mode === 'translation_http_500') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'fixture upstream failure' }));
      return;
    }
    if (mode === 'translation_bad_json') {
      respond('{ this is not valid json');
      return;
    }
    if (mode === 'translation_truncated') {
      respond({ target_language: 'ta', translated_message: TA_TEXT }, 'length');
      return;
    }
    if (mode === 'translation_structured_truncated' && systemPrompt.includes('structured emergency-responder')) {
      respond({ translated_headline: 'தீ விபத்து' }, 'length');
      return;
    }

    // Target language follows what the client actually requested.
    const targetMatch = /target language: ([A-Za-z ]+?) \(/.exec(systemPrompt);
    const targetName = (targetMatch?.[1] || '').trim().toLowerCase();
    const requestedCode = targetName === 'tamil' ? 'ta' : targetName === 'english' ? 'en' : 'ta';
    const expectedTranslation = requestedCode === 'ta' ? TA_TEXT : EN_TEXT;

    if (mode === 'translation_missing_message') {
      respond({ target_language: requestedCode, original_message: EN_TEXT });
      return;
    }
    if (mode === 'translation_dispatch') {
      respond({
        target_language: requestedCode,
        original_message: EN_TEXT,
        translated_message: 'Emergency Category: RESCUE (Priority 3/5). Immediate direct on-scene access required.'
      });
      return;
    }
    if (mode === 'translation_wrong_target') {
      respond({
        target_language: 'es',
        target_language_name: 'Spanish',
        original_message: EN_TEXT,
        translated_message: expectedTranslation
      });
      return;
    }
    if (mode === 'translation_missing_original') {
      respond({
        target_language: requestedCode,
        original_message: 'There is a flood, send a boat now',
        translated_message: expectedTranslation
      });
      return;
    }

    if (systemPrompt.includes('structured emergency-responder')) {
      const structured = structuredFieldsFromPrompt(body);
      respond({
        ...(typeof structured.headline === 'string' ? { translated_headline: 'தீ விபத்து' } : {}),
        ...(Array.isArray(structured.action_steps)
          ? { translated_action_steps: structured.action_steps.map(() => 'வெளியேறு') }
          : {}),
        ...(typeof structured.instructions_for_responders === 'string'
          ? { translated_instructions_for_responders: 'காட்சியை மதிப்பிடு' }
          : {}),
        ...(Array.isArray(structured.first_aid_actions)
          ? { translated_first_aid_actions: structured.first_aid_actions.map(() => 'தண்ணீர் ஊற்று') }
          : {}),
        ...(Array.isArray(structured.needs)
          ? { translated_needs: structured.needs.map(() => 'தீயணைப்பு வாகனம்') }
          : {})
      });
      return;
    }

    respond({
      detected_source_language: { code: requestedCode === 'ta' ? 'en' : 'ta', name: requestedCode === 'ta' ? 'English' : 'Tamil' },
      target_language: requestedCode,
      target_language_name: requestedCode === 'ta' ? 'Tamil' : 'English',
      original_message: lastOriginalFromPrompt(body),
      translated_message: expectedTranslation
    });
  });
});

/** The ORIGINAL TRANSMISSION the server asked the provider to translate. */
function lastOriginalFromPrompt(body: any): string {
  const userPrompt: string = body?.messages?.[1]?.content || '';
  // The transmission is embedded as a single-line JSON string.
  const match = /ORIGINAL TRANSMISSION \(the only text to translate\):\n(".*")/.exec(userPrompt);
  if (!match) return '';
  try {
    return JSON.parse(match[1]);
  } catch {
    return '';
  }
}


function structuredFieldsFromPrompt(body: any): Record<string, any> {
  const userPrompt: string = body?.messages?.[1]?.content || '';
  const marker = 'STRUCTURED RESPONDER FIELDS:\n';
  const markerIndex = userPrompt.indexOf(marker);
  if (markerIndex < 0) return {};
  try {
    return JSON.parse(userPrompt.slice(markerIndex + marker.length));
  } catch {
    return {};
  }
}

interface HttpResponse {
  status: number;
  json: any;
  text: string;
}

/**
 * Real HTTP client over node:http. The global `fetch` is deliberately avoided:
 * other test files install browser stubs for it, and these route tests must
 * talk to a real socket.
 */
function httpCall(method: 'GET' | 'POST', url: string, body?: any): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json: any = {};
          try {
            json = JSON.parse(data);
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode || 0, json, text: data });
        });
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('failed to bind fixture server'));
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postJson(url: string, payload: any): Promise<HttpResponse> {
  return httpCall('POST', url, payload);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
section('Online translation routes — real Express app + isolated upstream fixture');

const upstreamPort = await listen(upstream);
const appPort = await freePort();

const child: ChildProcess = spawn(TSX.command, TSX.args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(appPort),
    NODE_ENV: 'production',
    NEBIUS_BASE_URI: `http://127.0.0.1:${upstreamPort}/v1`,
    NEBIUS_API_KEY: 'fixture-key-not-a-real-credential',
    NEBIUS_MODEL: 'fixture/online-model',
    AUTHORIZED_PARTNER_API_URL: '',
    AUTHORIZED_PARTNER_API_KEY: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
child.stdout?.on('data', (d) => {
  serverLog += String(d);
});
child.stderr?.on('data', (d) => {
  serverLog += String(d);
});

const base = `http://127.0.0.1:${appPort}`;
let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  try {
    const res = await httpCall('GET', `${base}/api/status`);
    ready = res.status === 200;
  } catch {
    await sleep(500);
  }
}

assert(ready, 'the real application server started against the isolated upstream fixture');
assertEqual(analysisRequests, 0, 'no upstream call before any request');

// ---------------------------------------------------------------------------
// A. Online analysis returns immediately; translation is a separate request
// ---------------------------------------------------------------------------
let successfulOnlineTriage: any = null;

if (ready) {
  mode = 'translation_slow';
  translationRequests = 0;
  analysisRequests = 0;
  let release!: () => void;
  slowTranslationGate = new Promise<void>((resolve) => {
    release = resolve;
    releaseSlowTranslation = resolve;
  });

  let analysisSettled = false;
  const pendingAnalysis = postJson(`${base}/api/analyze-emergency`, {
    text: EN_TEXT,
    targetLanguage: 'ta',
    offlineModeForce: false,
    language: 'English'
  }).then((response) => {
    analysisSettled = true;
    return response;
  });

  const returnedBeforeTranslationRelease = await Promise.race([
    pendingAnalysis.then(() => true),
    sleep(1500).then(() => false)
  ]);
  assert(returnedBeforeTranslationRelease && analysisSettled,
    'online triage returns while a deliberately stalled translation provider is unreleased');
  assertEqual(translationRequests, 0, 'POST /api/analyze-emergency does not start an upstream translation');
  release();
  releaseSlowTranslation = null;
  const analyze = await pendingAnalysis;

  assertEqual(analyze.status, 200, 'POST /api/analyze-emergency succeeds');
  assertEqual(analyze.json?.success, true, 'analysis response is successful');
  assertEqual(analysisRequests, 1, 'analysis used the online Nemotron upstream');

  const data = analyze.json?.data || {};
  successfulOnlineTriage = data;
  assertEqual(data.source, 'nebius_nemotron', 'analysis returns the online Nemotron result');
  assertEqual(data.raw_transcript, EN_TEXT, 'the original transmission is preserved exactly (raw_transcript)');
  assertEqual(data.translation, undefined, 'triage response does not include a translation');
  assertEqual(data.translation_status, 'none', 'triage response marks translation_status none');
  assertEqual(data.translation_error, null, 'triage response has no translation error before follow-up');
  assert(data.message && data.message !== TA_TEXT, 'generated dispatch text stays separate from the user transmission');
}

// The client follows the successful result with a separate request to the
// existing translation endpoint, using the original transmission as source.
if (ready && successfulOnlineTriage) {
  mode = 'ok';
  translationRequests = 0;
  const followup = await postJson(`${base}/api/translate-emergency`, {
    text: successfulOnlineTriage.raw_transcript,
    targetLanguage: 'ta',
    sourceLanguage: successfulOnlineTriage.detected_language?.code || 'en',
    currentSOS: successfulOnlineTriage,
    offlineModeForce: false
  });
  assertEqual(followup.status, 200, 'automatic follow-up succeeds through POST /api/translate-emergency');
  assertEqual(followup.json?.success, true, 'follow-up translation response is successful');
  assertEqual(followup.json?.data?.source, 'nebius_nemotron', 'follow-up translation uses the online engine');
  assertEqual(followup.json?.data?.translated_message, TA_TEXT, 'follow-up translation returns the target-language text');
  assertEqual(followup.json?.data?.original_message, EN_TEXT, "follow-up preserves association to the user's original text");
  // The selected language was sent with the triage request, so the responder
  // card is ALREADY authored in that language (see triage-language-selection).
  // Re-translating the card into the language it was written in is therefore
  // skipped: one provider call, and no misleading "not translated" notice.
  assertEqual(successfulOnlineTriage.visual_card_language, 'ta', 'triage records the language its card was authored in');
  assertEqual(translationRequests, 1, 'the redundant structured re-translation is skipped for an already-authored card');
  assertEqual(followup.json?.data?.structured_translation_status, 'none', 'no structured phase is reported for an already-authored card');
  assertEqual(lastOriginalFromPrompt(lastTranslationBody), EN_TEXT, 'the single provider call is the primary user-message translation');
  assert(!lastOriginalFromPrompt(lastTranslationBody).includes('DISPATCH ALERT'), 'generated dispatch text is never sent as primary translation source');
}

// A target language that DIFFERS from the language the card was authored in
// still runs the two independently validated phases of PR #38.
if (ready && successfulOnlineTriage) {
  mode = 'ok';
  translationRequests = 0;
  const otherLanguage = await postJson(`${base}/api/translate-emergency`, {
    text: successfulOnlineTriage.raw_transcript,
    targetLanguage: 'en',
    sourceLanguage: successfulOnlineTriage.detected_language?.code || 'en',
    currentSOS: successfulOnlineTriage,
    offlineModeForce: false
  });
  assertEqual(otherLanguage.status, 200, 'follow-up into another language succeeds');
  assertEqual(otherLanguage.json?.data?.translated_message, EN_TEXT, 'the follow-up returns the requested language');
  assertEqual(translationRequests, 2, 'the follow-up endpoint makes separate primary and structured requests');
  assertEqual(lastOriginalFromPrompt(lastPrimaryTranslationBody), EN_TEXT, 'the primary provider receives the original transmission as source');
  assert(!lastOriginalFromPrompt(lastPrimaryTranslationBody).includes('DISPATCH ALERT'), 'generated dispatch text is never sent as primary translation source');
  assertEqual(lastOriginalFromPrompt(lastTranslationBody), '', 'the structured request contains no original transmission');
}

// Tamil original → English: triage remains independent; the follow-up route
// still accepts either supported direction.
if (ready) {
  mode = 'ok';
  translationRequests = 0;
  const analyzeTa = await postJson(`${base}/api/analyze-emergency`, {
    text: TA_TEXT,
    targetLanguage: 'en',
    offlineModeForce: false,
    language: 'Tamil'
  });
  assertEqual(analyzeTa.status, 200, 'Tamil analysis succeeds independently');
  assertEqual(analyzeTa.json?.data?.translation_status, 'none', 'Tamil triage also returns before translation');
  assertEqual(translationRequests, 0, 'Tamil triage made no translation request');
  const taFollowup = await postJson(`${base}/api/translate-emergency`, {
    text: analyzeTa.json?.data?.raw_transcript,
    targetLanguage: 'en',
    sourceLanguage: 'ta',
    currentSOS: analyzeTa.json?.data,
    offlineModeForce: false
  });
  assertEqual(taFollowup.status, 200, 'Tamil→English follow-up succeeds');
  assertEqual(taFollowup.json?.data?.translated_message, EN_TEXT, 'Tamil→English follow-up returns English');
  assertEqual(taFollowup.json?.data?.original_message, TA_TEXT, 'Tamil original is preserved');
}

// Same source/target language needs no automatic follow-up.
if (ready) {
  mode = 'ok';
  translationRequests = 0;
  const sameLang = await postJson(`${base}/api/analyze-emergency`, {
    text: EN_TEXT,
    targetLanguage: 'en',
    offlineModeForce: false,
    language: 'English'
  });
  assertEqual(sameLang.status, 200, 'same-language analysis succeeds');
  assertEqual(translationRequests, 0, 'same-language analysis does not call the translation provider');
  assertEqual(sameLang.json?.data?.translation_status, 'none', 'same-language triage leaves translation_status none');
}

// Translation failure is now independent: follow-up returns an explicit error
// while the already successful online triage record remains unchanged.
if (ready && successfulOnlineTriage) {
  mode = 'translation_http_500';
  translationRequests = 0;
  const failedFollowup = await postJson(`${base}/api/translate-emergency`, {
    text: successfulOnlineTriage.raw_transcript,
    targetLanguage: 'ta',
    sourceLanguage: successfulOnlineTriage.detected_language?.code || 'en',
    currentSOS: successfulOnlineTriage,
    offlineModeForce: false
  });
  assert(failedFollowup.status >= 400, 'a follow-up translation failure uses an error HTTP status');
  assertEqual(failedFollowup.json?.success, false, 'follow-up failure is explicit');
  assertEqual(failedFollowup.json?.code, 'TRANSLATION_UPSTREAM_HTTP', 'failure code identifies the upstream failure');
  assertEqual(failedFollowup.json?.data, undefined, 'no offline translation is substituted');
  assertEqual(successfulOnlineTriage.source, 'nebius_nemotron', 'the original Nemotron triage result remains online');
  assertEqual(successfulOnlineTriage.raw_transcript, EN_TEXT, 'the original transmission remains preserved');
  assertEqual(translationRequests, 1, 'failed follow-up made one online translation request');
}

// ---------------------------------------------------------------------------
// Explicit translation endpoint — success (both directions)
// ---------------------------------------------------------------------------
const CURRENT_SOS: Record<string, any> = {
  raw_transcript: EN_TEXT,
  transcript: EN_TEXT,
  message: GENERATED_DISPATCH,
  emergency_category: 'FIRE',
  emergency_type: 'Fire',
  severity: 5,
  needs: ['Fire Engine'],
  visual_card: { headline: 'FIRE — Structure Fire', action_steps: ['Evacuate'] }
};

if (ready) {
  mode = 'ok';
  translationRequests = 0;

  const enToTa = await postJson(`${base}/api/translate-emergency`, {
    text: EN_TEXT,
    targetLanguage: 'ta',
    sourceLanguage: 'en',
    currentSOS: CURRENT_SOS,
    offlineModeForce: false
  });

  assertEqual(enToTa.status, 200, 'POST /api/translate-emergency succeeds (en→ta)');
  assertEqual(enToTa.json?.success, true, 'en→ta translation response is successful');
  assertEqual(enToTa.json?.data?.source, 'nebius_nemotron', 'en→ta uses the online engine');
  assertEqual(enToTa.json?.data?.translated_message, TA_TEXT, 'en→ta translated_message is the online translation');
  assertEqual(enToTa.json?.data?.original_message, EN_TEXT, 'en→ta original_message is the user transmission');
  assertEqual(enToTa.json?.data?.category, 'FIRE', 'category locked by the online translation');
  assertEqual(enToTa.json?.data?.severity, 5, 'severity locked by the online translation');

  const taToEn = await postJson(`${base}/api/translate-emergency`, {
    text: TA_TEXT,
    targetLanguage: 'en',
    sourceLanguage: 'ta',
    currentSOS: { ...CURRENT_SOS, raw_transcript: TA_TEXT, transcript: TA_TEXT },
    offlineModeForce: false
  });
  assertEqual(taToEn.status, 200, 'POST /api/translate-emergency succeeds (ta→en)');
  assertEqual(taToEn.json?.data?.translated_message, EN_TEXT, 'ta→en translated_message is the online English translation');
  assertEqual(taToEn.json?.data?.original_message, TA_TEXT, 'ta→en original_message is the Tamil transmission');
}

// ---------------------------------------------------------------------------
// Structured truncation is a partial success, not a failed translation.
// ---------------------------------------------------------------------------
if (ready) {
  mode = 'translation_structured_truncated';
  translationRequests = 0;
  const partial = await postJson(`${base}/api/translate-emergency`, {
    text: EN_TEXT,
    targetLanguage: 'ta',
    sourceLanguage: 'en',
    currentSOS: CURRENT_SOS,
    offlineModeForce: false
  });
  assertEqual(partial.status, 200, 'structured finish_reason=length leaves the endpoint successful');
  assertEqual(partial.json?.success, true, 'primary translation remains an API success');
  assertEqual(partial.json?.data?.translated_message, TA_TEXT, 'primary translated_message survives structured truncation');
  assertEqual(partial.json?.data?.original_message, EN_TEXT, 'original_message stays preserved on partial success');
  assertEqual(partial.json?.data?.translation_status, 'partial', 'response marks primary success as partial overall');
  assertEqual(partial.json?.data?.structured_translation_status, 'error', 'structured fields are explicitly unavailable');
  assertEqual(partial.json?.data?.structured_translation_error?.code, 'TRANSLATION_TRUNCATED',
    'structured truncation code is available without failing the primary translation');
  assertEqual(partial.json?.data?.source, 'nebius_nemotron', 'partial result remains online, with no offline substitution');
  assertEqual(translationRequests, 2, 'primary succeeds before the separate structured request truncates');
}

// ---------------------------------------------------------------------------
// C–G. Explicit translation endpoint — every online failure is an error
// ---------------------------------------------------------------------------
const failureCases: { mode: FixtureMode; code: string; label: string }[] = [
  { mode: 'translation_http_500', code: 'TRANSLATION_UPSTREAM_HTTP', label: 'upstream HTTP 500' },
  { mode: 'translation_bad_json', code: 'TRANSLATION_INVALID_JSON', label: 'malformed JSON response' },
  { mode: 'translation_truncated', code: 'TRANSLATION_TRUNCATED', label: 'truncated completion' },
  { mode: 'translation_missing_message', code: 'TRANSLATION_MISSING_MESSAGE', label: 'missing translated_message' },
  { mode: 'translation_dispatch', code: 'TRANSLATION_VALIDATION_FAILED', label: 'generated dispatch translation' },
  { mode: 'translation_wrong_target', code: 'TRANSLATION_TARGET_LANGUAGE_MISMATCH', label: 'wrong target language' },
  { mode: 'translation_missing_original', code: 'TRANSLATION_ORIGINAL_MESSAGE_MISMATCH', label: 'wrong original association' }
];

if (ready) {
  for (const testCase of failureCases) {
    mode = testCase.mode;
    const res = await postJson(`${base}/api/translate-emergency`, {
      text: EN_TEXT,
      targetLanguage: 'ta',
      sourceLanguage: 'en',
      currentSOS: CURRENT_SOS,
      offlineModeForce: false
    });

    assert(res.status >= 400, `${testCase.label} → error HTTP status (not 200), got ${res.status}`);
    assertEqual(res.json?.success, false, `${testCase.label} → success is false`);
    assertEqual(res.json?.code, testCase.code, `${testCase.label} → ${testCase.code}`);
    assertEqual(res.json?.data, undefined, `${testCase.label} → no translation data (no offline substitution)`);
    assert(
      res.json?.data?.source !== 'offline_fallback',
      `${testCase.label} → the failure is never converted into an offline translation`
    );
  }
}

// ---------------------------------------------------------------------------
// B. OFFLINE mode stays deterministic and separate
// ---------------------------------------------------------------------------
if (ready) {
  mode = 'ok';
  translationRequests = 0;
  const offline = await postJson(`${base}/api/translate-emergency`, {
    text: EN_TEXT,
    targetLanguage: 'ta',
    sourceLanguage: 'en',
    currentSOS: CURRENT_SOS,
    offlineModeForce: true
  });

  assertEqual(offline.status, 200, 'offline mode translation succeeds');
  assertEqual(offline.json?.success, true, 'offline mode returns a successful offline translation');
  assertEqual(offline.json?.data?.source, 'offline_fallback', 'offline mode result is labelled offline');
  assertEqual(offline.json?.data?.original_message, EN_TEXT, 'offline mode preserves the original transmission');
  assertEqual(translationRequests, 0, 'offline mode makes NO upstream call');
}

// ---------------------------------------------------------------------------
// H/J. Dispatch text is never accepted as a translation source
// ---------------------------------------------------------------------------
if (ready) {
  mode = 'ok';
  translationRequests = 0;
  const dispatchSource = await postJson(`${base}/api/translate-emergency`, {
    text: GENERATED_DISPATCH,
    targetLanguage: 'ta',
    currentSOS: CURRENT_SOS,
    offlineModeForce: false
  });
  assertEqual(dispatchSource.status, 400, 'generated dispatch text as source → HTTP 400');
  assertEqual(dispatchSource.json?.code, 'TRANSLATION_INVALID_SOURCE', 'generated dispatch source → TRANSLATION_INVALID_SOURCE');
  assertEqual(translationRequests, 0, 'no upstream translation call for an invalid source');
}

// ---------------------------------------------------------------------------
// Manual-only policy — real HTTP partner dispatch must fail closed.
// Only the fixed synthetic directory fixture may reach the demo endpoint.
// No real responder or external partner is configured in this child process.
// ---------------------------------------------------------------------------
section('Manual-only partner API boundary — real Express routes');
if (ready) {
  const endpoint = `${base}/api/emergency-partner/dispatch`;
  const fixture = {
    sosId: 'QA-NON-EMERGENCY', emergencyType: 'QA PLACEHOLDER',
    message: 'QA fixture only — not a real emergency', providerType: 'TEST',
    partnerId: 'test-partner-demo', userConsentConfirmed: true
  };
  const realTest = await postJson(endpoint, fixture);
  assertEqual(realTest.status, 403, 'real message cannot be sent to TEST/DEMO endpoint');
  assertEqual(realTest.json?.success, false, 'demo rejection is explicit');
  const local = await postJson(endpoint, { ...fixture, providerType: 'LOCAL_ONLY' });
  assertEqual(local.status, 403, 'LOCAL_ONLY records cannot use any API dispatch route');
  const leakedGps = await postJson(endpoint, { ...fixture, demoOnly: true,
    emergencyType: 'MEDICAL EMERGENCY (DEMO)',
    message: 'TEST / DEMO SOS transmission — Simulated distress alert for system validation.',
    gps: { latitude: 13.0827, longitude: 80.2707 }
  });
  assertEqual(leakedGps.status, 403, 'demo endpoint rejects user GPS even with the demo text');
  const leakedMedia = await postJson(endpoint, { ...fixture, demoOnly: true,
    emergencyType: 'MEDICAL EMERGENCY (DEMO)',
    message: 'TEST / DEMO SOS transmission — Simulated distress alert for system validation.',
    photos: [{ name: 'real-person.png', dataUrl: 'data:image/png;base64,PRIVATE' }]
  });
  assertEqual(leakedMedia.status, 403, 'demo endpoint rejects user photo/bytes even with the demo text');
  const fakeConsent = await postJson(endpoint, { ...fixture, userConsentConfirmed: 'true' });
  assertEqual(fakeConsent.status, 403, 'consent must be a strict boolean true, not a truthy string');
  const noAuth = await postJson(endpoint, { ...fixture, providerType: 'AUTHORIZED_API' });
  assertEqual(noAuth.status, 400, 'authorized API is disabled without configured server credentials');
  const demo = await postJson(endpoint, {
    ...fixture, demoOnly: true, emergencyType: 'MEDICAL EMERGENCY (DEMO)',
    message: 'TEST / DEMO SOS transmission — Simulated distress alert for system validation.'
  });
  assertEqual(demo.status, 200, 'fixed synthetic example reaches only the local demo endpoint');
  assertEqual(demo.json?.data?.providerType, 'TEST', 'synthetic response is labeled TEST, never real partner');
  assertEqual(demo.json?.data?.deliveryConfirmed, undefined, 'demo has no real delivery confirmation');
  assertEqual(demo.json?.data?.responderAcknowledged, undefined, 'demo has no responder acknowledgment');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
child.kill('SIGTERM');
await Promise.race([
  new Promise<void>((resolve) => child.once('exit', () => resolve())),
  sleep(5000).then(() => {
    child.kill('SIGKILL');
  })
]);
await new Promise<void>((resolve) => upstream.close(() => resolve()));

assert(true, 'isolated upstream fixture and application server were shut down');
if (!ready) {
  process.stdout.write(`  ! application server did not start; server log:\n${serverLog.slice(-2000)}\n`);
}

