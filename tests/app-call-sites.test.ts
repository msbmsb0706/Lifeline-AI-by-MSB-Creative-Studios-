/**
 * Audit follow-up regression tests — App-level CALL-SITE contracts.
 *
 * The library-only translation tests (translation.test.ts) prove that
 * translateEmergencyOffline honors its inputs; they cannot detect the App
 * passing the WRONG input (the generated dispatch message instead of the
 * user's original transmission). These tests pin the actual call-sites in
 * src/App.tsx and src/components/EmergencyVoiceButton.tsx, and exercise the
 * end-to-end translation data flow with the real modules:
 *
 *   USER ORIGINAL TRANSMISSION → translated_message → target language
 *   (NEVER: generated dispatch message → translated_message)
 */
import { readFileSync } from 'node:fs';
import { installBrowserStub } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import { classifyEmergencyOffline } from '../src/lib/offlineClassifier.ts';
import { translateEmergencyOffline } from '../src/lib/languages.ts';
import { selectTranslationSource, looksLikeGeneratedDispatch } from '../src/lib/translationSafety.ts';

installBrowserStub({ online: true });

function readRepoSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Extract a component-level `const NAME = ...` function body from TSX source. */
function extractFunction(source: string, name: string, endMarker: string): string {
  const start = source.indexOf(`const ${name} =`);
  assert(start !== -1, `${name} exists in source`);
  const end = source.indexOf(endMarker, start);
  assert(end !== -1, `${name} end marker found`);
  return source.slice(start, end);
}

// Dispatch-report markers that must NEVER leak into translated_message
// (matches the "BUG 2" contract in translation.test.ts).
const DISPATCH_MARKERS = [/DISPATCH ALERT/i, /Priority \d\/5/i, /Required Assets/i, /Action: Dispatch/i];

function isDispatchText(text: string): boolean {
  return DISPATCH_MARKERS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// FIX 1 — App.handleTranslateSOS translates the USER'S ORIGINAL TRANSMISSION
// (PR #16 contract: raw_transcript -> original_message -> legacy transcript;
// NEVER the generated dispatch message; deterministic output validation).
// ---------------------------------------------------------------------------
section("FIX 1 — handleTranslateSOS call-site contract (source = user's original transmission)");

const appSource = readRepoSource('../src/App.tsx');
const translateFn = extractFunction(appSource, 'handleTranslateSOS', '\n  return (');

assert(
  translateFn.includes('selectTranslationSource'),
  "handleTranslateSOS derives its translation source via selectTranslationSource (raw_transcript -> original_message -> legacy transcript)"
);
assert(
  !translateFn.includes('currentResult.raw_transcript || currentResult.message'),
  'the legacy generated-dispatch-message fallback is gone — message is never a translation source'
);
assert(
  !translateFn.includes('text: currentResult.message'),
  'the online /api/translate-emergency request never sends the generated dispatch message as text'
);
assert(
  translateFn.includes('currentSOS: currentResult'),
  'currentSOS context is still forwarded (locked triage fields + server fallback preserved)'
);
assert(
  translateFn.includes('validateTranslatedMessage') || translateFn.includes('acceptTranslation'),
  'incoming translated_message is deterministically validated before display'
);
assert(
  translateFn.includes('TRANSLATION_VALIDATION_FAILED'),
  'validation failures take an explicit terminal error path (never a silent substitution)'
);
assert(
  translateFn.includes('Translation unavailable'),
  'an explicit translation-unavailable error state is shown when validation fails'
);

// ---------------------------------------------------------------------------
// FIX 1 — end-to-end translation data flow with the REAL modules,
// constructing the result exactly like App's offline analysis path does.
// ---------------------------------------------------------------------------
section("FIX 1 — translation data flow (real modules, App result construction)");

const userText = 'there is a fire';
const offlineClassified = classifyEmergencyOffline(userText, undefined, 'English', undefined);
const currentResult: any = {
  ...offlineClassified,
  source: 'offline_fallback',
  model_used: 'LifeLine Local Deterministic Triage Rules',
  timestamp: new Date().toISOString(),
  raw_transcript: userText // App's offline path stores the user's text here
};

assert(/DISPATCH ALERT/i.test(currentResult.message), 'fixture: result.message is the generated dispatch report');
assertEqual(currentResult.raw_transcript, userText, "fixture: raw_transcript is the user's original transmission");

// The fixed call-site source selection (PR #16 priority):
const sourceTranscript = selectTranslationSource({
  raw_transcript: currentResult.raw_transcript,
  transcript: currentResult.transcript,
  translation: currentResult.translation
    ? { original_message: currentResult.translation.original_message }
    : null
});
assert(sourceTranscript !== null, 'selector resolves a source for a normal result');

// Offline translation branch (exactly what handleTranslateSOS now calls):
const localTrans = translateEmergencyOffline(
  sourceTranscript!,
  'ta',
  currentResult.emergency_category || 'MEDICAL',
  currentResult.severity,
  currentResult.emergency_type,
  currentResult.detected_language?.code,
  undefined
);

assert(!isDispatchText(localTrans.translated_message), 'translated_message is NOT the generated dispatch report');
assert(
  localTrans.translated_message.includes(userText),
  "translated_message preserves the user's original words (faithful-or-fallback contract)"
);
assertEqual(localTrans.original_message, userText, "original_message is the user's original transmission");
assert(
  /DISPATCH ALERT/i.test(currentResult.message),
  'the generated responder/dispatch message remains separate and unchanged (result.message)'
);
assert(
  typeof localTrans.translated_headline === 'string' && localTrans.translated_headline.length > 0,
  'structured translated responder fields remain populated and separate (headline)'
);
assertEqual(localTrans.category, currentResult.emergency_category, 'category locked (translation never alters triage)');
assertEqual(localTrans.severity, currentResult.severity, 'severity locked (translation never alters triage)');

// With the correct source, a covered language pair translates the user's own words:
const esTrans = translateEmergencyOffline('call an ambulance', 'es', 'MEDICAL', 5, 'Medical', 'en');
assertEqual(esTrans.translated_message, 'llame a una ambulancia', "en→es translates the user's sentence itself");

// Legacy result with ONLY a generated dispatch message: no legitimate original
// transmission exists, so the selector yields null (explicit unavailable state).
const legacyDispatchOnly: any = {
  message: 'DISPATCH ALERT: Priority 4/5 - [MEDICAL] Medical. Required Assets: Ambulance. Action: Dispatch now.',
  severity: 3,
  emergency_category: 'MEDICAL',
  emergency_type: 'Medical'
};
assertEqual(
  selectTranslationSource(legacyDispatchOnly),
  null,
  'dispatch-only legacy results yield no translation source (explicit unavailable state, never dispatch-as-source)'
);

// Legacy result with a genuine original transcript still translates via it.
const legacyTranscript: any = {
  transcript: 'chest pain, help now',
  message: 'DISPATCH ALERT: Priority 4/5 - [MEDICAL] Medical. Required Assets: Ambulance. Action: Dispatch now.',
  severity: 3,
  emergency_category: 'MEDICAL',
  emergency_type: 'Medical'
};
const legacySource = selectTranslationSource(legacyTranscript);
assertEqual(legacySource, 'chest pain, help now', 'legacy transcript used when no newer original field exists');
const legacyTrans = translateEmergencyOffline(legacySource!, 'ta', 'MEDICAL', 3, 'Medical', 'en');
assertEqual(legacyTrans.original_message, 'chest pain, help now', 'legacy transcript preserved as original_message');
assert(
  !looksLikeGeneratedDispatch(legacyTrans.translated_message),
  'legacy translation output is not dispatch text'
);

// ---------------------------------------------------------------------------
// FIX 2 — MAX_RECORDING_MS safety timer is registered before returning
// ---------------------------------------------------------------------------
section("FIX 2 — MAX_RECORDING_MS timer is registered BEFORE return 'started'");

const voiceBtnSource = readRepoSource('../src/components/EmergencyVoiceButton.tsx');
const startFn = extractFunction(voiceBtnSource, 'startServerRecording', '\n  const stopServerRecording =');
const timerIdx = startFn.indexOf('maxDurationTimerRef.current = window.setTimeout');
const returnIdx = startFn.indexOf("return 'started'");
assert(timerIdx !== -1, 'MAX_RECORDING_MS timer registration exists in startServerRecording');
assert(returnIdx !== -1, "startServerRecording returns 'started'");
assert(
  timerIdx < returnIdx,
  "the 60-second safety-cap timer is registered BEFORE return 'started' (reachable and actually armed)"
);
assert(startFn.includes('MAX_RECORDING_MS'), 'the safety cap uses the MAX_RECORDING_MS constant');
assertEqual(
  countOccurrences(startFn, "return 'started'"),
  1,
  "exactly one 'started' return in startServerRecording"
);

const tsconfigSource = readRepoSource('../tsconfig.json');
assert(
  tsconfigSource.includes('"allowUnreachableCode": false'),
  'tsconfig enables unreachable-code detection so this defect class fails lint in the future'
);

// ---------------------------------------------------------------------------
// FIX 3 — browser voice notice follows the selected app language
// ---------------------------------------------------------------------------
section('FIX 3 — browser voice notice wording');

assert(
  !appSource.includes('browser voice (English)'),
  'stale "(English)" browser-voice wording removed (browser voice follows the heard language)'
);
assert(
  appSource.includes('speaks answers in any supported language'),
  'notice says the microphone speaks answers in any supported language'
);
assert(
  appSource.includes('buildSpokenEmergencyBrief'),
  'voice emergencies are spoken aloud, not left as typed text only'
);
assert(
  voiceBtnSource.includes('shouldSwitchRecognitionLanguage'),
  'microphone retargets the recognizer live when another language is heard'
);
assert(
  voiceBtnSource.includes('REALTIME_BROWSER_SPEECH'),
  'real-time browser speech is preferred over batch record-then-type'
);

// ---------------------------------------------------------------------------
// FIX 4 — delivery status card resets for a new emergency result
// ---------------------------------------------------------------------------
section('FIX 4 — delivery status card resets for a new emergency result');

const sosViewSource = readRepoSource('../src/components/SOSCardView.tsx');
assert(
  sosViewSource.includes('setDispatchedSosId(null)'),
  'dispatchedSosId is reset when a different emergency result is displayed'
);
assert(
  sosViewSource.includes('[result.timestamp]'),
  'the reset is keyed on the emergency result identity (timestamp) — a new emergency cannot show the previous emergency\'s delivery card'
);
