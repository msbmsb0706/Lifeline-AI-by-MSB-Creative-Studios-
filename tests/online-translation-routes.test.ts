/**
 * Online translation / error-handling — REAL route regression tests.
 *
 * Boots the actual Express application (server.ts) against an isolated
 * in-process upstream fixture and exercises both translation call sites over
 * real HTTP:
 *   - POST /api/analyze-emergency   (initial online analysis + target language)
 *   - POST /api/translate-emergency (explicit "Translate SOS" action)
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
  | 'translation_http_500'
  | 'translation_bad_json'
  | 'translation_missing_message'
  | 'translation_dispatch'
  | 'translation_wrong_target'
  | 'translation_truncated'
  | 'translation_missing_original';

let mode: FixtureMode = 'ok';
let analysisRequests = 0;
let translationRequests = 0;
/** Last translation request body received by the fixture (parsed). */
let lastTranslationBody: any = null;

const upstream: Server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body: any = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = {};
    }
    const systemPrompt: string = body?.messages?.[0]?.content || '';
    const isTranslation = systemPrompt.includes('multilingual translation engine');

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

    respond({
      target_language: requestedCode,
      target_language_name: requestedCode === 'ta' ? 'Tamil' : 'English',
      original_message: lastOriginalFromPrompt(body),
      translated_message: expectedTranslation,
      translated_headline: 'தீ விபத்து',
      translated_action_steps: ['வெளியேறு'],
      translated_instructions_for_responders: 'காட்சியை மதிப்பிடு',
      translated_first_aid_actions: ['தண்ணீர் ஊற்று'],
      translated_needs: ['தீயணைப்பு வாகனம்']
    });
  });
});

/** The ORIGINAL TRANSMISSION the server asked the provider to translate. */
function lastOriginalFromPrompt(body: any): string {
  const userPrompt: string = body?.messages?.[1]?.content || '';
  const match = /ORIGINAL TRANSMISSION \(translate word-for-word\): "([\s\S]*?)"/.exec(userPrompt);
  return match?.[1] || '';
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
    NEBIUS_MODEL: 'fixture/online-model'
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
// A. Successful online analysis + target language → ONLINE translation
// ---------------------------------------------------------------------------
if (ready) {
  mode = 'ok';
  translationRequests = 0;
  analysisRequests = 0;

  const analyze = await postJson(`${base}/api/analyze-emergency`, {
    text: EN_TEXT,
    targetLanguage: 'ta',
    offlineModeForce: false,
    language: 'English'
  });

  assertEqual(analyze.status, 200, 'POST /api/analyze-emergency succeeds');
  assertEqual(analyze.json?.success, true, 'analysis response is successful');
  assertEqual(analysisRequests, 1, 'analysis used the online upstream');
  assertEqual(translationRequests, 1, 'initial analysis used the ONLINE translation path (one upstream translation call)');

  const data = analyze.json?.data || {};
  assertEqual(data.raw_transcript, EN_TEXT, 'the original transmission is preserved exactly (raw_transcript)');
  assertEqual(data.translation?.source, 'nebius_nemotron', 'initial translation is the ONLINE translation');
  assertEqual(data.translation?.translated_message, TA_TEXT, 'translated_message is the online translation');
  assertEqual(data.translation?.original_message, EN_TEXT, 'translation original_message is the user transmission');
  assertEqual(data.translation_status, 'ok', 'translation_status is ok');
  assert(data.message && data.message !== TA_TEXT, 'the generated dispatch message remains separate from the translation');
  assertEqual(
    lastOriginalFromPrompt(lastTranslationBody),
    EN_TEXT,
    'the upstream translation request received ONLY the original transmission as its source'
  );
  assert(
    !lastOriginalFromPrompt(lastTranslationBody).includes('DISPATCH ALERT'),
    'the generated dispatch report was never sent as the translation source'
  );
}

// Tamil original → English online translation (initial analysis).
if (ready) {
  mode = 'ok';
  translationRequests = 0;
  const analyzeTa = await postJson(`${base}/api/analyze-emergency`, {
    text: TA_TEXT,
    targetLanguage: 'en',
    offlineModeForce: false,
    language: 'Tamil'
  });
  assertEqual(analyzeTa.status, 200, 'Tamil analysis succeeds');
  assertEqual(translationRequests, 1, 'Tamil→English initial analysis used the ONLINE translation path');
  assertEqual(analyzeTa.json?.data?.translation?.target_language, 'en', 'Tamil→English target language is English');
  assertEqual(
    analyzeTa.json?.data?.translation?.translated_message,
    EN_TEXT,
    'Tamil→English translated_message is the online English translation'
  );
  assertEqual(analyzeTa.json?.data?.raw_transcript, TA_TEXT, 'Tamil original transmission preserved exactly');
}

// Same source/target language → no translation request at all.
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
  assertEqual(translationRequests, 0, 'no translation request when the target language equals the source language');
  assertEqual(sameLang.json?.data?.translation, undefined, 'no translation payload for an unnecessary translation');
}

// ---------------------------------------------------------------------------
// B/C. Initial-analysis translation failure preserves the successful analysis
// ---------------------------------------------------------------------------
if (ready) {
  mode = 'translation_http_500';
  const failed = await postJson(`${base}/api/analyze-emergency`, {
    text: EN_TEXT,
    targetLanguage: 'ta',
    offlineModeForce: false,
    language: 'English'
  });

  assertEqual(failed.status, 200, 'a translation failure does NOT fail the successful online analysis');
  assertEqual(failed.json?.success, true, 'analysis stays successful');
  assertEqual(failed.json?.data?.translation_status, 'error', 'translation_status is an explicit error');
  assertEqual(failed.json?.data?.translation_error?.code, 'TRANSLATION_UPSTREAM_HTTP', 'error code identifies the upstream failure');
  assertEqual(failed.json?.data?.translation_error?.upstream_status, 500, 'upstream status is surfaced');
  assertEqual(failed.json?.data?.translation, undefined, 'no translation is fabricated after an online failure');
  assertEqual(failed.json?.data?.source, 'nebius_nemotron', 'the analysis itself remains the online result');
  assertEqual(failed.json?.data?.raw_transcript, EN_TEXT, 'the original transmission is preserved');
  assert(
    String(failed.json?.data?.translation_error?.error || '').includes('original transmission is preserved'),
    'the error state states that the original transmission is preserved'
  );
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

