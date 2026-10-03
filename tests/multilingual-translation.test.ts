/**
 * Multilingual emergency translation — regression coverage for ALL 10
 * supported languages (English, Tamil, Hindi, Telugu, Kannada, Malayalam,
 * Bengali, Marathi, Spanish, French).
 *
 * These tests focus on translation INVARIANTS and request/prompt contracts,
 * NOT on one exact LLM wording:
 *   - the requested target language is passed correctly to the provider;
 *   - the native-script/writing-system requirement is represented in the prompt;
 *   - the ORIGINAL TRANSMISSION is the only translation source;
 *   - generated dispatch text can never become translated_message or a source;
 *   - numbers/proper nouns and other critical values are protected by the
 *     prompt contract;
 *   - structured responder fields remain separate from translated_message;
 *   - short emergency messages are covered by a conciseness contract;
 *   - the PR #16 safety validator, original-message association and
 *     target-language validation remain active for every language;
 *   - the 4096 token budget and strict JSON output remain unchanged.
 *
 * Only the upstream `fetch` is stubbed with deterministic per-language fixture
 * payloads — no live Nebius/Nemotron response is required.
 */
import { installBrowserStub } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import {
  resolveEmergencyTranslation,
  TRANSLATION_MAX_TOKENS,
  TRANSLATION_TEMPERATURE
} from '../server/translation.ts';
import { SUPPORTED_LANGUAGES } from '../src/lib/languages.ts';
import {
  looksLikeGeneratedDispatch,
  validateTranslatedMessage
} from '../src/lib/translationSafety.ts';

installBrowserStub({ online: true });
const nativeFetch = (globalThis as any).fetch;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONFIG = { apiKey: 'test-key', baseUri: 'https://upstream.test/v1', model: 'fixture/multilingual-model' };

const EN_TEXT = 'Please help me, there is a fire.';
const GENERATED_DISPATCH =
  'DISPATCH ALERT: Priority 5/5 - [FIRE] Structure Fire. Required Assets: Fire service. Action: Dispatch nearest units immediately.';
const DISPATCH_STYLE_TRANSLATION =
  'Emergency Category: RESCUE (Priority 3/5). Immediate direct on-scene access required.';
const UNRELATED_ORIGINAL = 'There is a flood, send a boat now';

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
    action_steps: ['Evacuate immediately'],
    priority_symbol: 'FLAME',
    instructions_for_responders: 'Emergency Category: FIRE (Priority 5/5). Immediate direct on-scene access required.',
    first_aid_actions: ['Cool the burn with clean water']
  }
};

/**
 * Deterministic fixture translations of EN_TEXT, one per supported language —
 * each a short, natural sentence in that language's native writing system.
 * These stand in for the model's output; the tests assert the pipeline and
 * prompt contracts around them, not real LLM wording.
 */
const SAMPLE_TRANSLATION: Record<string, string> = {
  en: 'Please help me, there is a fire.',
  es: 'Por favor, ayúdame, hay un incendio.',
  fr: "Aidez-moi, s'il vous plaît, il y a un incendie.",
  ta: 'தயவுசெய்து என்னை உதவுங்கள், இங்கு தீ விபத்து நடந்துள்ளது.',
  hi: 'कृपया मेरी मदद करें, यहाँ आग लग गई है।',
  te: 'దయచేసి నాకు సహాయం చేయండి, ఇక్కడ అగ్నిప్రమాదం జరిగింది.',
  kn: 'ದಯವಿಟ್ಟು ನನಗೆ ಸಹಾಯ ಮಾಡಿ, ಇಲ್ಲಿ ಬೆಂಕಿ ಹಚ್ಚಿವೆ.',
  ml: 'ദയവായി എനിക്ക് സഹായം ചെയ്യൂ, ഇവിടെ തീപിടിത്തം ആയിരിക്കുന്നു.',
  bn: 'দয়া করে আমাকে সাহায্য করুন, এখানে আগুন লাগছে।',
  mr: 'कृपया मला मदत करा, इथे आग लागली आहे.'
};

/** The five short emergency transmissions that must remain short. */
const SHORT_MESSAGES: { text: string; ta: string; hi: string }[] = [
  { text: 'Help', ta: 'உதவி', hi: 'मदद' },
  { text: 'Fire', ta: 'தீ விபத்து', hi: 'आग' },
  { text: 'I am trapped', ta: 'நான் சிக்கிவிட்டேன்', hi: 'मैं फंसा हूँ' },
  { text: "I can't breathe", ta: 'மூச்சு விட முடியவில்லை', hi: 'मुझे साँस नहीं आ रही है' },
  { text: 'My child is unconscious', ta: 'என் குழந்தை மயங்கிவிட்டது', hi: 'मेरा बच्चा बेहोश है' }
];

interface FetchCall {
  url: string;
  init: any;
}

const calls: FetchCall[] = [];

function stubPayload(payload: any, finishReason = 'stop'): void {
  calls.length = 0;
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content: JSON.stringify(payload) } }]
      }),
      text: async () => JSON.stringify(payload)
    };
  };
}

function lastRequestBody(): any {
  return JSON.parse(calls[calls.length - 1].init.body);
}

/** A well-formed fixture payload for the given target language. */
function fixturePayload(code: string, name: string, translatedMessage: string, overrides: Record<string, any> = {}) {
  return {
    detected_source_language: { code: 'en', name: 'English' },
    target_language: code,
    target_language_name: name,
    original_message: EN_TEXT,
    translated_message: translatedMessage,
    translated_headline: 'FIXTURE HEADLINE',
    translated_action_steps: ['FIXTURE STEP'],
    translated_instructions_for_responders: 'FIXTURE DIRECTIVE',
    translated_first_aid_actions: ['FIXTURE FIRST AID'],
    translated_needs: ['FIXTURE UNIT'],
    ...overrides
  };
}

/** A supported language identifier guaranteed to differ from `code`. */
function otherLanguageCode(code: string): string {
  const all = SUPPORTED_LANGUAGES.map((l) => l.code);
  return all[(all.indexOf(code) + 1) % all.length];
}

const lower = (text: string): string => text.toLowerCase();

// ---------------------------------------------------------------------------
// A. Request/prompt contract for ALL 10 supported languages
// ---------------------------------------------------------------------------

section('A — translation invariants for all 10 supported languages');

assertEqual(SUPPORTED_LANGUAGES.length, 10, 'the application supports exactly 10 languages');

for (const lang of SUPPORTED_LANGUAGES) {
  const sample = SAMPLE_TRANSLATION[lang.code];
  assert(typeof sample === 'string' && sample.length > 0, `[${lang.code}] fixture sample exists for ${lang.name}`);
  assert(
    !looksLikeGeneratedDispatch(sample),
    `[${lang.code}] fixture sample is legitimate user-style text (not dispatch boilerplate)`
  );

  stubPayload(fixturePayload(lang.code, lang.name, sample));

  const outcome = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: lang.code, sourceLanguage: 'en', currentSOS: CURRENT_SOS },
    CONFIG
  );

  assertEqual(outcome.kind, 'ok', `[${lang.code}] online translation succeeds for ${lang.name}`);
  assertEqual(calls.length, 1, `[${lang.code}] exactly one upstream request was made`);

  if (outcome.kind === 'error') continue;
  const data = outcome.data;

  // Target language passed correctly — request and result.
  const body = lastRequestBody();
  const systemPrompt: string = body.messages[0].content;
  const userPrompt: string = body.messages[1].content;
  assertEqual(body.model, CONFIG.model, `[${lang.code}] the configured model is used`);
  assert(systemPrompt.includes(`target language: ${lang.name} (${lang.nativeName})`),
    `[${lang.code}] the requested target language is named in the system prompt`);
  assert(userPrompt.includes(`into ${lang.name} (${lang.nativeName})`),
    `[${lang.code}] the requested target language is named in the user prompt`);
  assertEqual(data.target_language, lang.code, `[${lang.code}] result carries the requested target language code`);
  assertEqual(data.target_language_name, lang.name, `[${lang.code}] result carries the requested target language name`);

  // Native-script / writing-system requirement is represented in the prompt.
  assert(/\bscript\b|\bwriting system\b/i.test(systemPrompt),
    `[${lang.code}] the prompt states a native writing-system requirement`);
  if (lang.script) {
    assert(systemPrompt.includes(lang.script),
      `[${lang.code}] the prompt names the native ${lang.script} script`);
  } else {
    assert(systemPrompt.includes(lang.nativeName),
      `[${lang.code}] the prompt names the ${lang.name} writing system (${lang.nativeName})`);
  }

  // Quality contract: natural, faithful, emergency-appropriate, concise.
  assert(lower(systemPrompt).includes('natural'), `[${lang.code}] the prompt requires natural phrasing`);
  assert(lower(systemPrompt).includes('faithful'), `[${lang.code}] the prompt requires faithfulness`);
  assert(lower(systemPrompt).includes('short transmission') && lower(systemPrompt).includes('concise'),
    `[${lang.code}] the prompt requires short transmissions to stay short`);
  assert(lower(systemPrompt).includes('expand'),
    `[${lang.code}] the prompt forbids expanding short transmissions`);

  // Preservation contract: numbers / proper nouns and other critical values.
  for (const keyword of [
    'proper nouns',
    'numbers and measurements',
    'ages',
    'quantities',
    'addresses and locations',
    'medication names',
    'times and dates',
    'phone numbers'
  ]) {
    assert(lower(systemPrompt).includes(keyword), `[${lang.code}] the prompt protects ${keyword}`);
  }

  // Safety contract: no invented content; dispatch content is separate.
  for (const keyword of ['never', 'summarize', 'dispatch report', 'medical advice', 'first-aid instructions', 'responder instructions']) {
    assert(lower(systemPrompt).includes(keyword), `[${lang.code}] the prompt carries the prohibition "${keyword}"`);
  }

  // Locked triage values stay in the prompt.
  assert(systemPrompt.includes(CURRENT_SOS.emergency_type), `[${lang.code}] the locked emergency type is in the prompt`);
  assert(systemPrompt.includes(CURRENT_SOS.emergency_category), `[${lang.code}] the locked category is in the prompt`);
  assert(systemPrompt.includes(String(CURRENT_SOS.severity)), `[${lang.code}] the locked severity is in the prompt`);

  // Strict JSON output + unchanged budget + temperature.
  assert(systemPrompt.includes('STRICT JSON'), `[${lang.code}] the prompt requires strict JSON output`);
  assertEqual(body.max_tokens, 4096, `[${lang.code}] the request asks for the 4096 token budget`);
  assertEqual(body.max_tokens, TRANSLATION_MAX_TOKENS, `[${lang.code}] the request uses the exported budget constant`);
  assertEqual(body.temperature, TRANSLATION_TEMPERATURE, `[${lang.code}] the request keeps the low temperature`);
  assertEqual(body.response_format?.type, 'json_object', `[${lang.code}] JSON response format stays enforced`);

  // Original-message-only translation source in the user prompt.
  assert(userPrompt.includes(`ORIGINAL TRANSMISSION (the only text to translate):\n${JSON.stringify(EN_TEXT)}`),
    `[${lang.code}] the original transmission is the only translation source in the request`);
  assert(!userPrompt.includes(GENERATED_DISPATCH),
    `[${lang.code}] the generated dispatch report is never sent as the translation source`);
  assert(
    userPrompt.indexOf('ORIGINAL TRANSMISSION (the only text to translate)') < userPrompt.indexOf('RESPONDER INSTRUCTION:'),
    `[${lang.code}] structured responder fields are sent separately, after the original transmission`
  );
  for (const marker of ['ORIGINAL HEADLINE:', 'RESPONDER INSTRUCTION:', 'ACTION STEPS:', 'FIRST AID:', 'REQUIRED UNITS:']) {
    assert(userPrompt.includes(marker), `[${lang.code}] structured field ${marker} is sent for its own key`);
  }

  // Result: original preserved, translation intact, structured fields separate.
  assertEqual(data.original_message, EN_TEXT, `[${lang.code}] original_message is the user transmission`);
  assertEqual(data.translated_message, sample, `[${lang.code}] translated_message is returned intact`);
  assert(validateTranslatedMessage(data.translated_message).ok === true,
    `[${lang.code}] translated_message passes the PR #16 safety validator`);
  assertEqual(data.source, 'nebius_nemotron', `[${lang.code}] the result is labelled as the online engine`);
  assertEqual(data.model_used, CONFIG.model, `[${lang.code}] the online model is recorded`);
  assertEqual(data.category, 'FIRE', `[${lang.code}] the category stays locked`);
  assertEqual(data.severity, 5, `[${lang.code}] the severity stays locked`);
  assertEqual(data.emergency_type, 'Fire', `[${lang.code}] the emergency type stays locked`);
  assertEqual(data.translated_headline, 'FIXTURE HEADLINE', `[${lang.code}] the structured headline maps to its own key`);
  assertEqual((data.translated_needs || [])[0], 'FIXTURE UNIT', `[${lang.code}] the structured needs map to their own key`);
  assert(data.translated_message !== CURRENT_SOS.message,
    `[${lang.code}] translated_message is never the generated dispatch text`);
}

// ---------------------------------------------------------------------------
// B. Short emergency messages remain concise and faithful
// ---------------------------------------------------------------------------

section('B — short emergency messages stay short and faithful');

for (const shortMessage of SHORT_MESSAGES) {
  for (const [targetCode, targetName, fixtureKey] of [['ta', 'Tamil', 'ta'], ['hi', 'Hindi', 'hi']] as const) {
    const shortFixture: string = shortMessage[fixtureKey];
    const words = shortFixture.trim().split(/\s+/).length;
    assert(words <= 6, `[${targetCode}] fixture for "${shortMessage.text}" is itself short (${words} words)`);

    stubPayload(fixturePayload(targetCode, targetName, shortFixture, {
      original_message: shortMessage.text,
      translated_headline: undefined,
      translated_action_steps: undefined,
      translated_instructions_for_responders: undefined,
      translated_first_aid_actions: undefined,
      translated_needs: undefined
    }));

    const outcome = await resolveEmergencyTranslation(
      { text: shortMessage.text, targetLanguage: targetCode, sourceLanguage: 'en', currentSOS: null },
      CONFIG
    );

    assertEqual(outcome.kind, 'ok', `[${targetCode}] short message "${shortMessage.text}" translates successfully`);
    if (outcome.kind !== 'ok') continue;
    assertEqual(outcome.data.original_message, shortMessage.text,
      `[${targetCode}] short message original is preserved`);
    assertEqual(outcome.data.translated_message, shortFixture,
      `[${targetCode}] the short translation is returned intact — never expanded by the pipeline`);
    assert(
      outcome.data.translated_message.trim().split(/\s+/).length <= 6,
      `[${targetCode}] "${shortMessage.text}" → "${outcome.data.translated_message}" remains concise`
    );

    const systemPrompt: string = lastRequestBody().messages[0].content;
    assert(lower(systemPrompt).includes('short transmission'),
      `[${targetCode}] the prompt contract keeps short transmissions short`);
  }
}

// ---------------------------------------------------------------------------
// C. Safety validation remains active for all 10 languages
// ---------------------------------------------------------------------------

section('C — generated dispatch output is rejected for every language (PR #16)');

for (const lang of SUPPORTED_LANGUAGES) {
  stubPayload(fixturePayload(lang.code, lang.name, DISPATCH_STYLE_TRANSLATION));

  const outcome = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: lang.code, sourceLanguage: 'en', currentSOS: CURRENT_SOS },
    CONFIG
  );

  assertEqual(outcome.kind, 'error', `[${lang.code}] dispatch-style translated_message is an error outcome`);
  if (outcome.kind === 'error') {
    assertEqual(outcome.code, 'TRANSLATION_VALIDATION_FAILED',
      `[${lang.code}] dispatch boilerplate → TRANSLATION_VALIDATION_FAILED`);
    assert(!('data' in outcome), `[${lang.code}] no translation data is returned on safety failure`);
  }
}

// ---------------------------------------------------------------------------
// D. Original-message association remains active for all 10 languages
// ---------------------------------------------------------------------------

section('D — wrong original-message association is rejected for every language');

for (const lang of SUPPORTED_LANGUAGES) {
  stubPayload(fixturePayload(lang.code, lang.name, SAMPLE_TRANSLATION[lang.code], {
    original_message: UNRELATED_ORIGINAL
  }));

  const outcome = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: lang.code, sourceLanguage: 'en', currentSOS: CURRENT_SOS },
    CONFIG
  );

  assertEqual(outcome.kind, 'error', `[${lang.code}] mismatched original_message is an error outcome`);
  if (outcome.kind === 'error') {
    assertEqual(outcome.code, 'TRANSLATION_ORIGINAL_MESSAGE_MISMATCH',
      `[${lang.code}] unrelated original_message → TRANSLATION_ORIGINAL_MESSAGE_MISMATCH`);
    assert(!('data' in outcome), `[${lang.code}] no translation data on association mismatch`);
  }
}

// ---------------------------------------------------------------------------
// E. Target-language validation remains active for all 10 languages
// ---------------------------------------------------------------------------

section('E — wrong target language in the payload is rejected for every language');

for (const lang of SUPPORTED_LANGUAGES) {
  const other = otherLanguageCode(lang.code);
  const otherLang = SUPPORTED_LANGUAGES.find((l) => l.code === other)!;
  stubPayload(fixturePayload(lang.code, lang.name, SAMPLE_TRANSLATION[lang.code], {
    target_language: other,
    target_language_name: otherLang.name
  }));

  const outcome = await resolveEmergencyTranslation(
    { text: EN_TEXT, targetLanguage: lang.code, sourceLanguage: 'en', currentSOS: CURRENT_SOS },
    CONFIG
  );

  assertEqual(outcome.kind, 'error', `[${lang.code}] payload declaring ${other} is an error outcome`);
  if (outcome.kind === 'error') {
    assertEqual(outcome.code, 'TRANSLATION_TARGET_LANGUAGE_MISMATCH',
      `[${lang.code}] wrong target language → TRANSLATION_TARGET_LANGUAGE_MISMATCH`);
    assert(!('data' in outcome), `[${lang.code}] no translation data on target-language mismatch`);
  }
}

// ---------------------------------------------------------------------------
// F. The original transmission is the ONLY translation source
// ---------------------------------------------------------------------------

section('F — generated dispatch can never become the translation source');

{
  // 1. Dispatch text submitted as the source: explicit 400, NO upstream call.
  stubPayload(fixturePayload('ta', 'Tamil', SAMPLE_TRANSLATION.ta));
  const dispatchSource = await resolveEmergencyTranslation(
    { text: GENERATED_DISPATCH, targetLanguage: 'ta', currentSOS: CURRENT_SOS },
    CONFIG
  );
  assertEqual(dispatchSource.kind, 'error', 'dispatch-like source text is an error outcome');
  if (dispatchSource.kind === 'error') {
    assertEqual(dispatchSource.code, 'TRANSLATION_INVALID_SOURCE', 'dispatch source → TRANSLATION_INVALID_SOURCE');
    assertEqual(dispatchSource.status, 400, 'invalid source is a client error (400)');
  }
  assertEqual(calls.length, 0, 'no upstream call is made for a dispatch-like source');

  // 2. raw_transcript wins over the generated `message` (PR #16 priority).
  stubPayload(fixturePayload('ta', 'Tamil', SAMPLE_TRANSLATION.ta));
  const fromRaw = await resolveEmergencyTranslation(
    { targetLanguage: 'ta', sourceLanguage: 'en', currentSOS: { ...CURRENT_SOS } },
    CONFIG
  );
  assertEqual(fromRaw.kind, 'ok', 'a record with raw_transcript + generated message still translates');
  if (fromRaw.kind === 'ok') {
    assertEqual(fromRaw.data.original_message, EN_TEXT, 'raw_transcript is used, not the generated message');
    const userPrompt: string = lastRequestBody().messages[1].content;
    assert(userPrompt.includes(JSON.stringify(EN_TEXT)), 'the original transcript is the source in the request');
    assert(!userPrompt.includes(GENERATED_DISPATCH), 'the generated message is not sent as the source');
  }

  // 3. A dispatch-only record yields no source at all.
  stubPayload(fixturePayload('ta', 'Tamil', SAMPLE_TRANSLATION.ta));
  const dispatchOnly = await resolveEmergencyTranslation(
    { targetLanguage: 'ta', currentSOS: { message: GENERATED_DISPATCH, severity: 3 } },
    CONFIG
  );
  assertEqual(dispatchOnly.kind, 'error', 'a dispatch-only record has no translation source');
  if (dispatchOnly.kind === 'error') {
    assertEqual(dispatchOnly.code, 'TRANSLATION_INVALID_INPUT', 'dispatch-only record → TRANSLATION_INVALID_INPUT');
  }
  assertEqual(calls.length, 0, 'no upstream call is made for a dispatch-only record');

  // 4. The PR #16 validator still rejects dispatch boilerplate directly.
  assertEqual(looksLikeGeneratedDispatch(DISPATCH_STYLE_TRANSLATION), true,
    'looksLikeGeneratedDispatch detects the dispatch sentence');
  assertEqual(validateTranslatedMessage(DISPATCH_STYLE_TRANSLATION).ok, false,
    'validateTranslatedMessage rejects the dispatch sentence');
  assertEqual(looksLikeGeneratedDispatch('Please help me, there is a fire.'), false,
    'legitimate user text is never rejected');
}

// ---------------------------------------------------------------------------
// G. Budget and strict-JSON contract (PR #34 invariants)
// ---------------------------------------------------------------------------

section('G — the 4096 token budget and strict JSON contract are unchanged');

assertEqual(TRANSLATION_MAX_TOKENS, 4096, 'TRANSLATION_MAX_TOKENS is still 4096');

{
  stubPayload(fixturePayload('ta', 'Tamil', SAMPLE_TRANSLATION.ta));
  await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta', sourceLanguage: 'en', currentSOS: CURRENT_SOS }, CONFIG);
  const body = lastRequestBody();
  assertEqual(body.max_tokens, 4096, 'the upstream request asks for 4096 max_tokens');
  assertEqual(
    JSON.stringify(body.response_format),
    JSON.stringify({ type: 'json_object' }),
    'response_format JSON enforcement is intact'
  );
  assert(Array.isArray(body.messages) && body.messages.length === 2, 'the request sends system + user messages');
}

// Restore the real fetch so later test files can talk to real servers.
(globalThis as any).fetch = nativeFetch;
