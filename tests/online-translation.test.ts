/**
 * Online translation / error-handling regression tests.
 *
 * Exercises the REAL shared server translation implementation
 * (server/translation.ts) with only the upstream `fetch` stubbed, so the
 * transport validation, failure mapping and offline/online separation are
 * covered end to end — not by inspecting source strings.
 *
 * PR #16 safety validation (src/lib/translationSafety.ts) stays authoritative:
 * these tests assert it is the validator being applied, and never re-implement
 * or weaken it.
 */
import { installBrowserStub } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import {
  buildOfflineTranslation,
  diceCoefficient,
  isSameTransmission,
  resolveEmergencyTranslation,
  resolveTranslationSource,
  toTranslationErrorInfo,
  translateForOnlineAnalysis,
  validateOnlineTranslationPayload,
  OFFLINE_TRANSLATION_MODEL,
  TranslationError
} from '../server/translation.ts';
import {
  looksLikeGeneratedDispatch,
  selectTranslationSource,
  validateTranslatedMessage
} from '../src/lib/translationSafety.ts';

installBrowserStub({ online: true });
const nativeFetch = (globalThis as any).fetch;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ONLINE_MODEL = 'test/online-model';
const CONFIG = { apiKey: 'test-key', baseUri: 'https://upstream.test/v1', model: ONLINE_MODEL };
const NO_KEY_CONFIG = { apiKey: '', baseUri: 'https://upstream.test/v1', model: ONLINE_MODEL };

const EN_TEXT = 'Please help me, there is a fire.';
const TA_TEXT = 'தயவுசெய்து எனக்கு உதவுங்கள், தீ விபத்து ஏற்பட்டுள்ளது.';
const GENERATED_DISPATCH =
  'DISPATCH ALERT: Priority 5/5 - [FIRE] Structure Fire. Required Assets: Fire service. Action: Dispatch nearest units immediately.';

const CURRENT_SOS: Record<string, any> = {
  raw_transcript: EN_TEXT,
  transcript: EN_TEXT,
  // The generated dispatch report — NEVER a translation source.
  message: GENERATED_DISPATCH,
  emergency_category: 'FIRE',
  emergency_type: 'Fire',
  severity: 5,
  needs: ['Fire Engine', 'Ambulance'],
  visual_card: {
    headline: 'FIRE — Structure Fire',
    badge_color: 'RED',
    action_steps: ['Evacuate immediately', 'Call the fire service'],
    priority_symbol: 'FLAME',
    instructions_for_responders: 'Emergency Category: FIRE (Priority 5/5). Immediate direct on-scene access required.',
    first_aid_actions: ['Cool the burn with clean water']
  }
};

interface FetchCall {
  url: string;
  init: any;
}

const calls: FetchCall[] = [];

type UpstreamHandler = (url: string, init: any) => Promise<any>;

function stubFetch(handler: UpstreamHandler): void {
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return handler(url, init);
  };
}

const okResponse = (payload: any, finishReason = 'stop') => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content: JSON.stringify(payload) } }]
  }),
  text: async () => JSON.stringify(payload)
});

function httpError(status: number, body = 'upstream failure') {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

function validPayload(overrides: Record<string, any> = {}) {
  return {
    target_language: 'ta',
    target_language_name: 'Tamil',
    original_message: EN_TEXT,
    translated_message: TA_TEXT,
    translated_headline: 'தீ விபத்து',
    translated_action_steps: ['வெளியேறு'],
    translated_instructions_for_responders: 'காட்சியை மதிப்பிடு',
    translated_first_aid_actions: ['தண்ணீர் ஊற்று'],
    translated_needs: ['தீயணைப்பு வாகனம்'],
    ...overrides
  };
}

/** Last upstream request body (parsed) — used to inspect what is sent. */
function lastRequestBody(): any {
  return JSON.parse(calls[calls.length - 1].init.body);
}

function resetCalls(): void {
  calls.length = 0;
}

function isOutcomeError(outcome: any): boolean {
  return outcome.kind === 'error';
}

// ---------------------------------------------------------------------------
// A. Successful ONLINE analysis + target language → ONLINE translation path
// ---------------------------------------------------------------------------
section('A — successful online analysis uses the ONLINE translation path');

{
  resetCalls();
  stubFetch(async () => okResponse(validPayload()));

  const result = await translateForOnlineAnalysis(
    {
      sourceText: EN_TEXT,
      targetLanguage: 'ta',
      sourceLanguage: 'en',
      currentSOS: {
        emergency_category: 'FIRE',
        emergency_type: 'Fire',
        severity: 5,
        needs: CURRENT_SOS.needs,
        visual_card: CURRENT_SOS.visual_card
      }
    },
    CONFIG
  );

  assertEqual(result.status, 'ok', 'online analysis translation succeeds');
  assertEqual(calls.length, 1, 'exactly one upstream translation request was made');
  assert(
    String(calls[0].url).endsWith('/chat/completions'),
    'the shared online translator called the chat-completions upstream'
  );

  if (result.status === 'ok') {
    const t = result.translation;
    assertEqual(t.source, 'nebius_nemotron', 'translation came from the ONLINE engine');
    assertEqual(t.model_used, ONLINE_MODEL, 'online model recorded as the translation engine');
    assert(t.model_used !== OFFLINE_TRANSLATION_MODEL, 'the offline engine was NOT used for a successful online analysis');
    assertEqual(t.translated_message, TA_TEXT, 'translated_message is the online translation');
    assertEqual(t.original_message, EN_TEXT, 'original_message is the user transmission');
    assertEqual(t.target_language, 'ta', 'target language is the requested one');
    assertEqual(t.category, 'FIRE', 'category locked by translation');
    assertEqual(t.severity, 5, 'severity locked by translation');
    assertEqual(t.emergency_type, 'Fire', 'emergency type locked by translation');
  }

  const body = lastRequestBody();
  const userPrompt: string = body.messages[1].content;
  assert(
    userPrompt.includes(`ORIGINAL TRANSMISSION (translate word-for-word): "${EN_TEXT}"`),
    'the user original transmission is the translation source in the request'
  );
  assert(
    !userPrompt.includes(GENERATED_DISPATCH),
    'the generated dispatch report is never sent as the translation source'
  );
  assert(
    userPrompt.indexOf('ORIGINAL TRANSMISSION (translate word-for-word)') < userPrompt.indexOf('RESPONDER INSTRUCTION:'),
    'structured responder fields are sent separately, after the original transmission (never as the source)'
  );

  // The offline engine is unreachable here (no fetch would be needed anyway):
  // prove no substitution happened even when the offline engine could answer.
  const offlineCapable = buildOfflineTranslation({
    sourceText: EN_TEXT,
    targetLanguage: 'ta',
    sourceLanguage: 'en',
    currentSOS: CURRENT_SOS
  });
  assert(
    offlineCapable.source === 'offline_fallback' && offlineCapable.translated_message.length > 0,
    'fixture: the offline engine could have produced output, yet the online result is used'
  );
}

// ---------------------------------------------------------------------------
// B. OFFLINE mode keeps using the deterministic offline translation
// ---------------------------------------------------------------------------
section('B — offline mode keeps the deterministic offline translation');

{
  resetCalls();
  stubFetch(async () => okResponse(validPayload()));

  const outcome = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: 'ta', sourceLanguage: 'en', currentSOS: CURRENT_SOS, offlineModeForce: true },
    CONFIG
  );

  assertEqual(outcome.kind, 'ok', 'offline mode returns a successful offline translation');
  if (outcome.kind === 'ok') {
    assertEqual(outcome.data.source, 'offline_fallback', 'offline mode result is labelled offline');
    assertEqual(outcome.data.model_used, OFFLINE_TRANSLATION_MODEL, 'offline engine recorded');
    assertEqual(outcome.data.original_message, EN_TEXT, 'offline translation preserves the original transmission');
    assertEqual(outcome.data.category, 'FIRE', 'offline translation locks the category');
    assertEqual(outcome.data.severity, 5, 'offline translation locks the severity');
  }
  assertEqual(calls.length, 0, 'offline mode makes NO upstream call');

  // Offline mode also works when no online key is configured.
  const noKey = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS, offlineModeForce: true },
    NO_KEY_CONFIG
  );
  assertEqual(noKey.kind, 'ok', 'offline mode works without an API key');
  assertEqual(calls.length, 0, 'offline mode without a key still makes no upstream call');
}

// ---------------------------------------------------------------------------
// C. Online HTTP failure → explicit error, no offline substitution
// ---------------------------------------------------------------------------
section('C — online HTTP failure is an explicit error (no offline substitution)');

{
  resetCalls();
  stubFetch(async () => httpError(500, 'boom'));

  const outcome = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: 'ta', sourceLanguage: 'en', currentSOS: CURRENT_SOS },
    CONFIG
  );

  assert(isOutcomeError(outcome), 'upstream HTTP 500 is an error outcome');
  if (outcome.kind === 'error') {
    assertEqual(outcome.code, 'TRANSLATION_UPSTREAM_HTTP', 'error code identifies the upstream HTTP failure');
    assertEqual(outcome.status, 502, 'error status is a real error status (not 200)');
    assertEqual(outcome.upstream_status, 500, 'upstream status is surfaced');
    assert(!('data' in outcome), 'no translation data is returned for a failed online translation');
    assert(!outcome.error.includes(OFFLINE_TRANSLATION_MODEL), 'the failure is not disguised as an offline translation');
  }

  // Initial-analysis integration: analysis stays successful, translation errors.
  const analysis = await translateForOnlineAnalysis(
    { sourceText: EN_TEXT, targetLanguage: 'ta', sourceLanguage: 'en', currentSOS: CURRENT_SOS },
    CONFIG
  );
  assertEqual(analysis.status, 'error', 'initial-analysis translation reports an explicit error');
  if (analysis.status === 'error') {
    assertEqual(analysis.error.code, 'TRANSLATION_UPSTREAM_HTTP', 'initial-analysis error code');
    assert(!('translation' in analysis), 'no translation object is produced for a failed online translation');
  }
}

// ---------------------------------------------------------------------------
// D. Online timeout → explicit error, no offline substitution
// ---------------------------------------------------------------------------
section('D — online timeout is an explicit error (no offline substitution)');

{
  // D1: the provider aborts (AbortError).
  resetCalls();
  stubFetch(async () => {
    const err: any = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  });
  const aborted = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS },
    CONFIG
  );
  assert(aborted.kind === 'error', 'aborted online translation is an error outcome');
  if (aborted.kind === 'error') {
    assertEqual(aborted.code, 'TRANSLATION_TIMEOUT', 'aborted request maps to TRANSLATION_TIMEOUT');
    assertEqual(aborted.status, 504, 'timeout maps to a gateway-timeout status');
  }

  // D2: the real timeout fires (AbortSignal.timeout wired into the request).
  // Node's AbortSignal.timeout() uses an unref'd timer, so a keep-alive handle
  // is required or the test process would run out of work before it fires.
  resetCalls();
  stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err: any = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }) as Promise<any>
  );
  const keepAlive = setInterval(() => {}, 10);
  const timedOut = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS },
    { ...CONFIG, timeoutMs: 40 }
  );
  clearInterval(keepAlive);
  assert(timedOut.kind === 'error', 'a hanging upstream produces an error outcome');
  if (timedOut.kind === 'error') {
    assertEqual(timedOut.code, 'TRANSLATION_TIMEOUT', 'a hanging upstream maps to TRANSLATION_TIMEOUT');
    assert(!('data' in timedOut), 'no translation data after a timeout');
  }
}

// ---------------------------------------------------------------------------
// E. Malformed responses → explicit errors
// ---------------------------------------------------------------------------
section('E — malformed upstream responses are explicit errors');

{
  resetCalls();
  stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'not json at all' } }] }),
    text: async () => 'not json at all'
  }));
  const invalidJson = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(invalidJson.kind === 'error' && invalidJson.code === 'TRANSLATION_INVALID_JSON', 'non-JSON completion → TRANSLATION_INVALID_JSON');

  resetCalls();
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }), text: async () => '' }));
  const noChoice = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(noChoice.kind === 'error' && noChoice.code === 'TRANSLATION_INVALID_RESPONSE', 'missing completion → TRANSLATION_INVALID_RESPONSE');

  resetCalls();
  stubFetch(async () => {
    throw new Error('invalid json body');
  });
  const badEnvelope = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(
    badEnvelope.kind === 'error' && badEnvelope.code === 'TRANSLATION_REQUEST_FAILED',
    'network/transport failure → explicit error (never a substituted success)'
  );

  resetCalls();
  stubFetch(async () => okResponse(validPayload(), 'length'));
  const truncated = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(truncated.kind === 'error' && truncated.code === 'TRANSLATION_TRUNCATED', 'truncated completion → TRANSLATION_TRUNCATED');

  resetCalls();
  stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '   ' } }] }),
    text: async () => '   '
  }));
  const empty = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(empty.kind === 'error' && empty.code === 'TRANSLATION_EMPTY_RESPONSE', 'empty completion → TRANSLATION_EMPTY_RESPONSE');
}

// ---------------------------------------------------------------------------
// F. Missing / wrong-type translated_message → explicit error
// ---------------------------------------------------------------------------
section('F — missing or wrong-type translated_message is an explicit error');

for (const [label, payload] of [
  ['absent translated_message', { translated_message: undefined }],
  ['non-string translated_message', { translated_message: 42 }],
  ['blank translated_message', { translated_message: '   ' }],
  ['null translated_message', { translated_message: null }]
] as [string, Record<string, any>][]) {
  resetCalls();
  stubFetch(async () => okResponse(validPayload(payload)));
  const outcome = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(
    outcome.kind === 'error' && outcome.code === 'TRANSLATION_MISSING_MESSAGE',
    `${label} → TRANSLATION_MISSING_MESSAGE`
  );
  if (outcome.kind === 'error') assert(!('data' in outcome), `${label} → no translation data returned`);
}

// ---------------------------------------------------------------------------
// G. Wrong target language → rejected
// ---------------------------------------------------------------------------
section('G — wrong target language in the payload is rejected');

{
  resetCalls();
  stubFetch(async () => okResponse(validPayload({ target_language: 'es', target_language_name: 'Spanish' })));
  const wrong = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(
    wrong.kind === 'error' && wrong.code === 'TRANSLATION_TARGET_LANGUAGE_MISMATCH',
    'payload declaring another target language → TRANSLATION_TARGET_LANGUAGE_MISMATCH'
  );

  resetCalls();
  stubFetch(async () => okResponse(validPayload({ target_language_name: 'Spanish' })));
  const wrongName = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(
    wrongName.kind === 'error' && wrongName.code === 'TRANSLATION_TARGET_LANGUAGE_MISMATCH',
    'payload declaring another target language NAME → rejected'
  );

  // A correct target language (including a region tag) is accepted.
  resetCalls();
  stubFetch(async () => okResponse(validPayload({ target_language: 'ta-IN' })));
  const regionTag = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assertEqual(regionTag.kind, 'ok', 'a region-qualified target language (ta-IN) is accepted');

  // Wrong original-message association is rejected.
  resetCalls();
  stubFetch(async () => okResponse(validPayload({ original_message: 'There is a flood, send a boat now' })));
  const wrongOriginal = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(
    wrongOriginal.kind === 'error' && wrongOriginal.code === 'TRANSLATION_ORIGINAL_MESSAGE_MISMATCH',
    'payload associated with a different original transmission → rejected'
  );

  // A dispatch report returned as "original_message" is never accepted either.
  resetCalls();
  stubFetch(async () => okResponse(validPayload({ original_message: GENERATED_DISPATCH })));
  const dispatchOriginal = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(
    dispatchOriginal.kind === 'error' && dispatchOriginal.code === 'TRANSLATION_ORIGINAL_MESSAGE_MISMATCH',
    'generated dispatch text returned as original_message → rejected'
  );
}

// ---------------------------------------------------------------------------
// H. Generated dispatch translation rejected by the PR #16 safety helper
// ---------------------------------------------------------------------------
section('H — generated dispatch translation is rejected (PR #16 helper)');

{
  const dispatchTranslation =
    'Emergency Category: RESCUE (Priority 3/5). Immediate direct on-scene access required.';

  assertEqual(
    looksLikeGeneratedDispatch(dispatchTranslation),
    true,
    'PR #16 looksLikeGeneratedDispatch rejects the generated dispatch sentence'
  );
  assertEqual(
    validateTranslatedMessage(dispatchTranslation).ok,
    false,
    'PR #16 validateTranslatedMessage rejects the generated dispatch sentence'
  );

  resetCalls();
  stubFetch(async () => okResponse(validPayload({ translated_message: dispatchTranslation })));
  const outcome = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS }, CONFIG);
  assert(
    outcome.kind === 'error' && outcome.code === 'TRANSLATION_VALIDATION_FAILED',
    'a dispatch-style translated_message → TRANSLATION_VALIDATION_FAILED'
  );
  if (outcome.kind === 'error') assert(!('data' in outcome), 'no translation data when safety validation fails');

  // Same rejection through the shared payload validator directly.
  let thrown: any = null;
  try {
    validateOnlineTranslationPayload({
      parsed: { translated_message: dispatchTranslation },
      requestedTargetLanguageCode: 'ta',
      sourceText: EN_TEXT
    });
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof TranslationError, 'payload validator throws a typed TranslationError');
  assertEqual(thrown?.code, 'TRANSLATION_VALIDATION_FAILED', 'payload validator uses the PR #16 safety result');

  // Initial analysis must reject it too (and keep no translation).
  const analysis = await translateForOnlineAnalysis(
    { sourceText: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS },
    CONFIG
  );
  assertEqual(analysis.status, 'error', 'initial-analysis translation rejects dispatch-style output');
  if (analysis.status === 'error') assertEqual(analysis.error.code, 'TRANSLATION_VALIDATION_FAILED', 'initial-analysis error code');
}

// ---------------------------------------------------------------------------
// I. Legitimate translations are accepted (en→ta, ta→en)
// ---------------------------------------------------------------------------
section('I — legitimate translations are accepted (en→ta, ta→en)');

{
  resetCalls();
  stubFetch(async () => okResponse(validPayload()));
  const enToTa = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', sourceLanguage: 'en', currentSOS: CURRENT_SOS }, CONFIG);
  assertEqual(enToTa.kind, 'ok', 'en→ta legitimate translation accepted');
  if (enToTa.kind === 'ok') {
    assertEqual(enToTa.data.translated_message, TA_TEXT, 'en→ta translated_message preserved');
    assertEqual(validateTranslatedMessage(enToTa.data.translated_message).ok, true, 'en→ta output passes PR #16 validation');
  }

  resetCalls();
  stubFetch(async () =>
    okResponse({
      target_language: 'en',
      target_language_name: 'English',
      original_message: TA_TEXT,
      translated_message: EN_TEXT
    })
  );
  const taToEn = await resolveEmergencyTranslation(
    {
      text: TA_TEXT,
      targetLanguage: 'en',
      sourceLanguage: 'ta',
      currentSOS: { ...CURRENT_SOS, raw_transcript: TA_TEXT, transcript: TA_TEXT }
    },
    CONFIG
  );
  assertEqual(taToEn.kind, 'ok', 'ta→en legitimate translation accepted');
  if (taToEn.kind === 'ok') {
    assertEqual(taToEn.data.translated_message, EN_TEXT, 'ta→en translated_message preserved');
    assertEqual(taToEn.data.original_message, TA_TEXT, 'ta→en original_message is the user transmission');
    assertEqual(validateTranslatedMessage(taToEn.data.translated_message).ok, true, 'ta→en output passes PR #16 validation');
  }

  // A single incidental word must never cause a false rejection.
  assertEqual(looksLikeGeneratedDispatch('Please help me, there is a fire.'), false, 'legitimate sentence is not dispatch text');
  assertEqual(validateTranslatedMessage('I need first aid for my cut').ok, true, 'a single "first aid" mention is accepted');
}

// ---------------------------------------------------------------------------
// J. The original transmission is preserved exactly
// ---------------------------------------------------------------------------
section('J — the original transmission is preserved exactly');

{
  assertEqual(
    resolveTranslationSource({ text: EN_TEXT, currentSOS: CURRENT_SOS }),
    EN_TEXT,
    'a submitted original transmission is used verbatim'
  );
  assertEqual(
    resolveTranslationSource({ currentSOS: CURRENT_SOS }),
    EN_TEXT,
    'raw_transcript is used when no text is submitted'
  );
  assertEqual(
    resolveTranslationSource({ currentSOS: { message: GENERATED_DISPATCH, severity: 3 } }),
    null,
    'a dispatch-only record yields NO translation source'
  );
  assertEqual(
    resolveTranslationSource({ text: GENERATED_DISPATCH, currentSOS: CURRENT_SOS }),
    null,
    'a dispatch report submitted as the text is never a translation source'
  );
  assertEqual(
    selectTranslationSource({ raw_transcript: EN_TEXT, message: GENERATED_DISPATCH }),
    EN_TEXT,
    'PR #16 selector keeps raw_transcript ahead of the generated message'
  );

  // Dispatch text as an online source is rejected before any upstream call.
  resetCalls();
  const dispatchSource = await resolveEmergencyTranslation(
    { text: GENERATED_DISPATCH, targetLanguage: 'ta', currentSOS: CURRENT_SOS },
    CONFIG
  );
  assert(
    dispatchSource.kind === 'error' && dispatchSource.code === 'TRANSLATION_INVALID_SOURCE',
    'dispatch-like source text → TRANSLATION_INVALID_SOURCE (400)'
  );
  if (dispatchSource.kind === 'error') assertEqual(dispatchSource.status, 400, 'invalid source is a client error status');
  assertEqual(calls.length, 0, 'no upstream call is made for an invalid source');

  const analysisDispatchSource = await translateForOnlineAnalysis(
    { sourceText: GENERATED_DISPATCH, targetLanguage: 'ta', currentSOS: CURRENT_SOS },
    CONFIG
  );
  assertEqual(analysisDispatchSource.status, 'error', 'initial analysis never translates dispatch text');

  // Original-message association helper.
  assertEqual(isSameTransmission(EN_TEXT, EN_TEXT), true, 'identical text is the same transmission');
  assertEqual(isSameTransmission(`"${EN_TEXT}"`, EN_TEXT), true, 'quoted/cosmetic differences are the same transmission');
  assertEqual(isSameTransmission('There is a flood, send a boat now', EN_TEXT), false, 'unrelated text is not the same transmission');
  assert(diceCoefficient(EN_TEXT, EN_TEXT) === 1, 'dice coefficient of identical text is 1');

  // Every failure path preserves the original: no translated_message is produced.
  resetCalls();
  stubFetch(async () => httpError(429, 'rate limited'));
  const info = toTranslationErrorInfo(new Error('upstream down'));
  assertEqual(typeof info.code, 'string', 'failures carry a machine-readable code');
  assert(String(info.error).includes('original transmission is preserved'), 'failure messages state that the original is preserved');

  const notConfigured = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: 'ta', currentSOS: CURRENT_SOS },
    NO_KEY_CONFIG
  );
  assert(
    notConfigured.kind === 'error' && notConfigured.code === 'TRANSLATION_NOT_CONFIGURED',
    'online translation without a configured key is an explicit error (503)'
  );
  if (notConfigured.kind === 'error') {
    assertEqual(notConfigured.status, 503, 'TRANSLATION_NOT_CONFIGURED is a 503, never a 200 offline success');
    assert(!('data' in notConfigured), 'no offline translation is returned when online is not configured');
  }
}

// ---------------------------------------------------------------------------
// K. Client card renders the explicit translation-unavailable state
//    (real component render — no source-string inspection)
// ---------------------------------------------------------------------------
section('K — SOS card renders the explicit translation-unavailable state');

{
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SOSCardView } = await import('../src/components/SOSCardView.tsx');

  const baseResult: any = {
    language: 'English',
    transcript: EN_TEXT,
    raw_transcript: EN_TEXT,
    emergency_type: 'FIRE',
    emergency_category: 'FIRE',
    severity: 5,
    needs: ['Fire Engine'],
    message: GENERATED_DISPATCH,
    visual_card: {
      headline: 'FIRE — Structure Fire',
      badge_color: 'RED',
      action_steps: ['Evacuate'],
      priority_symbol: 'FLAME',
      instructions_for_responders: 'Assess scene safety and vitals.',
      first_aid_actions: ['Cool the burn']
    },
    source: 'nebius_nemotron',
    model_used: ONLINE_MODEL,
    timestamp: new Date().toISOString()
  };

  const render = (result: any) =>
    renderToStaticMarkup(
      React.createElement(SOSCardView as any, {
        result,
        highContrast: false,
        soundEnabled: false,
        onTranslateSOS: async () => {},
        isTranslating: false
      })
    );

  const errorHtml = render({
    ...baseResult,
    translation_status: 'error',
    translation_error: {
      code: 'TRANSLATION_UPSTREAM_HTTP',
      error: 'Translation provider returned HTTP 500. The original transmission is preserved.'
    }
  });
  assert(
    errorHtml.includes('translation-unavailable-state'),
    'the SOS card renders an explicit translation-unavailable state element'
  );
  assert(
    errorHtml.includes('original transmission preserved'),
    'the translation-unavailable state states that the original transmission is preserved'
  );
  assert(
    errorHtml.includes('Translation provider returned HTTP 500'),
    'the translation-unavailable state shows the underlying error'
  );

  const okHtml = render({ ...baseResult, translation_status: 'ok' });
  assert(
    !okHtml.includes('translation-unavailable-state'),
    'no translation-unavailable state is rendered when translation succeeded'
  );

  const noneHtml = render({ ...baseResult });
  assert(
    !noneHtml.includes('translation-unavailable-state'),
    'no translation-unavailable state is rendered when no translation was requested'
  );
}

// Restore the real fetch so later test files can talk to real servers.
(globalThis as any).fetch = nativeFetch;
