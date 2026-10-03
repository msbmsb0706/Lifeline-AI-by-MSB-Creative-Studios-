/**
 * LifeLine AI — shared emergency translation implementation (server-side).
 *
 * The dedicated POST /api/translate-emergency endpoint is the follow-up path
 * for both automatic and manual online translations. The /api/analyze-emergency
 * route intentionally returns triage before any translation is attempted.
 *
 * PR #16 remains the authoritative translation-safety contract:
 *   - The translation SOURCE is the user's original transmission only
 *     (raw_transcript -> original_message -> translation.original_message ->
 *     legacy transcript). Generated dispatch text, responder instructions,
 *     action steps, required units, AI summaries and structured directives are
 *     NEVER accepted as a translation source.
 *   - The translation RESULT must pass `validateTranslatedMessage()` from
 *     src/lib/translationSafety.ts (the PR #16 helper). No competing
 *     validator is defined here.
 *
 * Failure policy (this is the fix for the online/offline substitution audit):
 *   - ONLINE failures (HTTP error, timeout, malformed response, missing
 *     translated_message, wrong shape, wrong target language, wrong original
 *     association, truncation, safety-validation failure) are reported as an
 *     explicit translation error. They are NEVER converted into a successful
 *     offline translation.
 *   - OFFLINE / RESILIENCE mode (explicitly requested) keeps using the bundled
 *     deterministic translation engine, which is a genuinely different mode —
 *     not a substitute for a failed online call.
 */
import {
  getLanguageByCodeOrName,
  resolveDetectedSourceLanguage,
  standardizeCategory,
  translateEmergencyOffline,
  SUPPORTED_LANGUAGES
} from '../src/lib/languages.ts';
import {
  looksLikeGeneratedDispatch,
  selectTranslationSource,
  validateTranslatedMessage
} from '../src/lib/translationSafety.ts';
import type {
  SeverityLevel,
  StandardEmergencyCategory,
  TranslatedSOS,
  TranslationErrorInfo
} from '../src/types.ts';

/** Online translation request timeout (milliseconds). */
export const TRANSLATION_TIMEOUT_MS = 20000;
/**
 * Enough headroom for the translation + the separate structured fields.
 *
 * Raised 2400 -> 4096 (translation follow-up): long free-form transmissions
 * plus the structured translated fields could hit the cap and come back with
 * `finish_reason === 'length'`, which is reported as TRANSLATION_TRUNCATED
 * instead of a translation. The higher budget covers those long inputs.
 */
export const TRANSLATION_MAX_TOKENS = 4096;
export const TRANSLATION_TEMPERATURE = 0.1;

export const OFFLINE_TRANSLATION_MODEL = 'LifeLine AI Deterministic Multilingual Translation Engine';

export type TranslationErrorCode =
  | 'TRANSLATION_INVALID_INPUT'
  | 'TRANSLATION_INVALID_SOURCE'
  | 'TRANSLATION_NOT_CONFIGURED'
  | 'TRANSLATION_UPSTREAM_HTTP'
  | 'TRANSLATION_TIMEOUT'
  | 'TRANSLATION_INVALID_RESPONSE'
  | 'TRANSLATION_TRUNCATED'
  | 'TRANSLATION_EMPTY_RESPONSE'
  | 'TRANSLATION_INVALID_JSON'
  | 'TRANSLATION_MISSING_MESSAGE'
  | 'TRANSLATION_TARGET_LANGUAGE_MISMATCH'
  | 'TRANSLATION_ORIGINAL_MESSAGE_MISMATCH'
  | 'TRANSLATION_VALIDATION_FAILED'
  | 'TRANSLATION_REQUEST_FAILED';

/** Typed, non-silent translation failure. Never an offline substitution. */
export class TranslationError extends Error {
  constructor(
    public code: TranslationErrorCode,
    message: string,
    public status = 502,
    public upstreamStatus?: number
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export interface TranslationConfig {
  apiKey: string;
  baseUri: string;
  model: string;
  timeoutMs?: number;
}

export interface EmergencyTranslationInput {
  /** Submitted text (already trimmed by the caller when it comes from a route). */
  text?: unknown;
  targetLanguage?: unknown;
  sourceLanguage?: unknown;
  /** Structured triage context — locked fields + separate responder content. */
  currentSOS?: Record<string, any> | null;
  /** True only when the caller is genuinely in OFFLINE / RESILIENCE mode. */
  offlineModeForce?: boolean;
  location?: unknown;
}

/**
 * Resolved outcome for an explicit translation request.
 *
 * `kind` is a string discriminant (the project builds without
 * strictNullChecks, where boolean-literal discrimination is unreliable).
 */
export type TranslationOutcome =
  | { kind: 'ok'; status: 200; data: TranslatedSOS }
  | {
      kind: 'error';
      status: number;
      code: TranslationErrorCode;
      error: string;
      upstream_status?: number;
    };

export type InitialAnalysisTranslation =
  | { status: 'ok'; translation: TranslatedSOS }
  | { status: 'error'; error: TranslationErrorInfo };

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

export function toTranslationError(err: unknown): TranslationError {
  if (err instanceof TranslationError) return err;
  const anyErr = err as { name?: string; message?: string } | null;
  if (anyErr?.name === 'AbortError' || /aborted|timeout/i.test(String(anyErr?.message || ''))) {
    return new TranslationError(
      'TRANSLATION_TIMEOUT',
      'The online translation service did not respond in time. The original transmission is preserved.',
      504
    );
  }
  return new TranslationError(
    'TRANSLATION_REQUEST_FAILED',
    `Online translation failed: ${anyErr?.message || 'unknown error'}. The original transmission is preserved.`,
    502
  );
}

export function toTranslationErrorInfo(err: unknown): TranslationErrorInfo {
  const e = toTranslationError(err);
  return {
    code: e.code,
    error: e.message,
    ...(typeof e.upstreamStatus === 'number' ? { upstream_status: e.upstreamStatus } : {})
  };
}

// ---------------------------------------------------------------------------
// Source selection (PR #16 selector, never generated dispatch content)
// ---------------------------------------------------------------------------

/**
 * Resolves the ONLY acceptable translation source: the user's original
 * transmission. Returns null when no legitimate source exists.
 */
export function resolveTranslationSource(input: {
  text?: unknown;
  currentSOS?: Record<string, any> | null;
}): string | null {
  const provided = typeof input.text === 'string' ? input.text.trim() : '';
  if (provided) {
    // PR #16 guard: generated dispatch/triage boilerplate is never a source.
    return looksLikeGeneratedDispatch(provided) ? null : provided;
  }
  return selectTranslationSource(input.currentSOS ?? null);
}

function lockTriage(
  currentSOS: Record<string, any> | null | undefined,
  sourceText: string
): { category: StandardEmergencyCategory; severity: SeverityLevel; type: string } {
  const category: StandardEmergencyCategory =
    currentSOS?.emergency_category || standardizeCategory(currentSOS?.emergency_type || sourceText);
  const severity = (
    typeof currentSOS?.severity === 'number' && currentSOS.severity >= 1 && currentSOS.severity <= 5
      ? currentSOS.severity
      : 3
  ) as SeverityLevel;
  const type: string = currentSOS?.emergency_type || `${category} Emergency`;
  return { category, severity, type };
}

// ---------------------------------------------------------------------------
// OFFLINE / RESILIENCE mode (explicitly requested — never a silent fallback)
// ---------------------------------------------------------------------------

export function buildOfflineTranslation(input: {
  sourceText: string;
  targetLanguage: string;
  sourceLanguage?: unknown;
  currentSOS?: Record<string, any> | null;
  location?: unknown;
}): TranslatedSOS {
  const targetLangObj = getLanguageByCodeOrName(input.targetLanguage);
  // Audit FAIL-1: recognised labels win; unknown labels fall back to script
  // detection of the text — never a silent English relabel.
  const detectedSource = resolveDetectedSourceLanguage(input.sourceLanguage, input.sourceText);
  const locked = lockTriage(input.currentSOS, input.sourceText);

  const translated = translateEmergencyOffline(
    input.sourceText,
    targetLangObj.code,
    locked.category,
    locked.severity,
    locked.type,
    detectedSource.code,
    typeof input.location === 'string' ? input.location : undefined
  );

  return {
    ...translated,
    source: 'offline_fallback',
    model_used: OFFLINE_TRANSLATION_MODEL
  };
}

// ---------------------------------------------------------------------------
// Transport-level response validation
// ---------------------------------------------------------------------------

/** Minimum normalized-text similarity for "this is the same transmission". */
export const ORIGINAL_MESSAGE_SIMILARITY_THRESHOLD = 0.5;

function normalizeForComparison(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s​-‏﻿]+/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, '')
    .trim();
}

function bigrams(value: string): Set<string> {
  const grams = new Set<string>();
  const compact = value.replace(/\s+/g, '');
  for (let i = 0; i < compact.length - 1; i += 1) grams.add(compact.slice(i, i + 2));
  return grams;
}

export function diceCoefficient(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) shared += 1;
  return (2 * shared) / (gramsA.size + gramsB.size);
}

/**
 * True when `candidate` is recognisably the same transmission as `original`
 * (allowing punctuation/whitespace/normalisation differences), i.e. the
 * provider echoed the user's own words back as `original_message`.
 */
export function isSameTransmission(candidate: string, original: string): boolean {
  const a = normalizeForComparison(candidate);
  const b = normalizeForComparison(original);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return diceCoefficient(a, b) >= ORIGINAL_MESSAGE_SIMILARITY_THRESHOLD;
}

function isKnownLanguageIdentifier(value: string): boolean {
  const clean = value.trim().toLowerCase();
  if (!clean) return false;
  return SUPPORTED_LANGUAGES.some(
    (l) =>
      l.code.toLowerCase() === clean || l.name.toLowerCase() === clean || l.nativeName.toLowerCase() === clean
  );
}

/**
 * Validates the provider's parsed payload. Throws a typed TranslationError on
 * the first failed check — the caller reports it as an explicit error state.
 */
export function validateOnlineTranslationPayload(input: {
  parsed: any;
  requestedTargetLanguageCode: string;
  sourceText: string;
}): { translatedMessage: string } {
  const { parsed, requestedTargetLanguageCode, sourceText } = input;

  // 1. Completion / result existence and shape.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TranslationError(
      'TRANSLATION_INVALID_RESPONSE',
      'The online translation service returned an unexpected response shape. The original transmission is preserved.'
    );
  }

  // 2. translated_message existence and type.
  if (typeof parsed.translated_message !== 'string' || !parsed.translated_message.trim()) {
    throw new TranslationError(
      'TRANSLATION_MISSING_MESSAGE',
      'The online translation service returned no usable translated_message. The original transmission is preserved.'
    );
  }

  // 3. PR #16 safety validation (authoritative — no competing validator).
  const safety = validateTranslatedMessage(parsed.translated_message);
  if (!safety.ok) {
    throw new TranslationError(
      'TRANSLATION_VALIDATION_FAILED',
      `Translation unavailable — the translation engine returned content that failed safety validation (${
        safety.reason || 'rejected'
      }). The original transmission is preserved.`
    );
  }

  // 4. Target-language consistency, when represented in the payload.
  const requested = requestedTargetLanguageCode.trim().toLowerCase();
  const targetCandidates: unknown[] = [parsed.target_language, parsed.target_language_name];
  for (const candidate of targetCandidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const clean = candidate.trim();
    const cleanLower = clean.toLowerCase();
    const base = cleanLower.split(/[-_]/)[0];
    if (cleanLower === requested || base === requested) continue;
    // Only reject when the value is recognisably ANOTHER language, so an
    // unrecognised provider string can never cause a false rejection.
    if (isKnownLanguageIdentifier(clean) && getLanguageByCodeOrName(clean).code.toLowerCase() !== requested) {
      throw new TranslationError(
        'TRANSLATION_TARGET_LANGUAGE_MISMATCH',
        `Translation unavailable — the translation service returned a different target language ("${clean}"). The original transmission is preserved.`
      );
    }
  }

  // 5. Original-message association, when represented in the payload.
  if (typeof parsed.original_message === 'string' && parsed.original_message.trim()) {
    const returnedOriginal = parsed.original_message.trim();
    if (looksLikeGeneratedDispatch(returnedOriginal) || !isSameTransmission(returnedOriginal, sourceText)) {
      throw new TranslationError(
        'TRANSLATION_ORIGINAL_MESSAGE_MISMATCH',
        'Translation unavailable — the translation service did not associate its result with the original transmission. The original transmission is preserved.'
      );
    }
  }

  return { translatedMessage: parsed.translated_message.trim() };
}

// ---------------------------------------------------------------------------
// ONLINE translation (Nebius Token Factory / Nemotron)
// ---------------------------------------------------------------------------

export async function translateEmergencyOnline(
  input: {
    sourceText: string;
    targetLanguage: string;
    sourceLanguage?: unknown;
    currentSOS?: Record<string, any> | null;
    location?: unknown;
  },
  config: TranslationConfig
): Promise<TranslatedSOS> {
  const { sourceText } = input;
  const targetLangObj = getLanguageByCodeOrName(input.targetLanguage);
  const detectedSource = resolveDetectedSourceLanguage(input.sourceLanguage, sourceText);
  const locked = lockTriage(input.currentSOS, sourceText);
  const structured = input.currentSOS?.visual_card || {};

  // Native-writing-system requirement, per target language: Indian regional
  // languages name their native script explicitly; Latin-script languages get
  // the standard writing-system requirement instead.
  const scriptInstruction = targetLangObj.script
    ? `the correct native ${targetLangObj.script} script — the writing system in which ${targetLangObj.name} is normally written — never romanized or transliterated into Latin letters`
    : targetLangObj.nativeName.toLowerCase() === targetLangObj.name.toLowerCase()
      ? `the standard writing system of ${targetLangObj.name} — never transliterated into a different script`
      : `the standard writing system of ${targetLangObj.name} (${targetLangObj.nativeName}) — never transliterated into a different script`;

  const systemPrompt = `You are LifeLine AI's specialized emergency multilingual translation engine developed by MSB Creative Studios.

TASK: Translate the user's ORIGINAL TRANSMISSION (provided in the user message) into the target language: ${targetLangObj.name} (${targetLangObj.nativeName}).

TRANSLATION QUALITY:
1. Natural and professional: use native ${targetLangObj.name} grammar, word order and idiom. When a natural phrasing preserves the exact meaning, prefer the grammatically natural rendering over a mechanical word-for-word translation.
2. Semantically faithful: convey every meaning, fact and detail of the original transmission — and only those.
3. Emergency-appropriate: keep the tone and plainness of the original, the way a native ${targetLangObj.name} speaker would communicate an emergency to first responders.
4. Concise when the original is concise: a short transmission (e.g. "Help", "Fire", "I am trapped", "I can't breathe", "My child is unconscious") MUST come back just as short — the minimal natural translation, never expanded into a longer explanation or report.
5. Correct writing system: write the translation in ${scriptInstruction}.

FIDELITY & PRESERVATION (keep these exactly as transmitted):
- Names and proper nouns: keep personal names, place names and organization names the same (transliteration into the target script only when that language normally writes them that way).
- Numbers and measurements: keep every number, measurement, dosage and unit exactly as given.
- Ages: keep every age exactly as given.
- Quantities: keep every count or quantity exact.
- Addresses and locations: keep street names, landmarks, PIN codes and place names complete and accurate.
- Medication names: keep medicine/medication names exactly as given.
- Times and dates: keep times, durations and dates unchanged.
- Phone numbers and identifiers: reproduce every digit and character of phone numbers and IDs exactly.
- Urgency: preserve the urgency already present in the original — never increase or reduce it.
- Emergency and medical terminology: use the standard terms that first responders in ${targetLangObj.name} expect for the user's words.

HARD LIMITS — "translated_message" MUST ONLY be the translation of the user's original transmission. It must NEVER:
- add, invent or imply any information that is not in the original transmission;
- summarize, reformat or reinterpret the original;
- become a dispatch report (no added headlines, priorities, emergency categories, severity levels or required units);
- add medical advice or a diagnosis;
- add first-aid instructions;
- add responder instructions or directives.
If the original transmission is one short word or sentence, "translated_message" is exactly that word or sentence translated — nothing more.

LOCKED TRIAGE VALUES:
The emergency type ("${locked.type}"), the standardized emergency category ("${locked.category}") and the severity level (${locked.severity}) are locked life-critical triage parameters. Never change them, never translate them into different meanings, and never fold them into "translated_message".

SEPARATE STRUCTURED FIELDS:
The structured responder/dispatch fields (translated_headline, translated_action_steps, translated_instructions_for_responders, translated_first_aid_actions, translated_needs) are translated SEPARATELY, only from the structured content provided for them. Their text must never appear in "translated_message", and the user's transmission must not be rewritten into them.

OUTPUT — STRICT JSON:
Output exactly one valid JSON object — pure JSON, no markdown fences, no extra text — matching this schema:
{
  "detected_source_language": {
    "code": "${detectedSource.code}",
    "name": "${detectedSource.name}"
  },
  "target_language": "${targetLangObj.code}",
  "target_language_name": "${targetLangObj.name}",
  "original_message": string (the exact original transmission, unchanged),
  "translated_message": string (the natural, faithful translation of the original transmission ONLY),
  "translated_headline": string (the provided headline in ${targetLangObj.name}),
  "translated_action_steps": string[] (the provided action steps in ${targetLangObj.name}),
  "translated_instructions_for_responders": string (the provided on-arrival directive in ${targetLangObj.name}),
  "translated_first_aid_actions": string[] (the provided first aid actions in ${targetLangObj.name}),
  "translated_needs": string[] (the provided required units in ${targetLangObj.name})
}
Translate only the provided structured content — never invent additional medical advice, responder instructions or required equipment.
Do NOT include markdown fences. Output pure JSON only.`;

  // ONLY the user's original transmission is the translation source. The
  // generated dispatch/responder fields travel separately for their own keys.
  // The transmission is embedded as a JSON string so quotes/newlines in the
  // user's text can never break the prompt structure.
  const userPrompt = `Translate the user's ORIGINAL TRANSMISSION into ${targetLangObj.name} (${targetLangObj.nativeName}) and put that one faithful, natural translation in the "translated_message" JSON field. The original transmission is the ONLY text that may go into "translated_message": do not paraphrase, summarize, expand, or regenerate it as a dispatch report.

ORIGINAL TRANSMISSION (the only text to translate):
${JSON.stringify(sourceText)}

SEPARATELY, translate ONLY the provided structured responder/dispatch fields below into ${targetLangObj.name}, each for its own JSON key — never into "translated_message":
ORIGINAL HEADLINE: "${structured.headline || locked.type}"
RESPONDER INSTRUCTION: "${structured.instructions_for_responders || 'Assess scene safety and vitals.'}"
ACTION STEPS: ${JSON.stringify(structured.action_steps || [])}
FIRST AID: ${JSON.stringify(structured.first_aid_actions || [])}
REQUIRED UNITS: ${JSON.stringify(input.currentSOS?.needs || [])}
Source Language: ${detectedSource.name}`;

  const timeoutMs = typeof config.timeoutMs === 'number' && config.timeoutMs > 0 ? config.timeoutMs : TRANSLATION_TIMEOUT_MS;

  const response = await fetch(`${config.baseUri}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: config.apiKey.startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: TRANSLATION_TEMPERATURE,
      response_format: { type: 'json_object' },
      max_tokens: TRANSLATION_MAX_TOKENS
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  // 1. HTTP status — a non-2xx upstream is NEVER a successful translation.
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      detail = '';
    }
    throw new TranslationError(
      'TRANSLATION_UPSTREAM_HTTP',
      `Translation provider returned HTTP ${response.status}${detail ? ` (${detail})` : ''}. The original transmission is preserved.`,
      502,
      response.status
    );
  }

  // 2. Response shape / completion existence.
  const raw = await response.json().catch(() => null);
  const choice = (raw as any)?.choices?.[0];
  if (!raw || !Array.isArray((raw as any).choices) || !choice || typeof choice !== 'object') {
    throw new TranslationError(
      'TRANSLATION_INVALID_RESPONSE',
      'The online translation service returned an unexpected response shape. The original transmission is preserved.'
    );
  }

  // 3. Truncation / unfinished completion.
  if (choice.finish_reason === 'length') {
    throw new TranslationError(
      'TRANSLATION_TRUNCATED',
      'The online translation service returned an incomplete (truncated) response. The original transmission is preserved.'
    );
  }

  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new TranslationError(
      'TRANSLATION_EMPTY_RESPONSE',
      'The online translation service returned no text. The original transmission is preserved.'
    );
  }

  // 4. Malformed JSON payload.
  let parsed: any;
  try {
    parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  } catch {
    throw new TranslationError(
      'TRANSLATION_INVALID_JSON',
      'The online translation service returned malformed JSON. The original transmission is preserved.'
    );
  }

  // 5. translated_message / target language / original association / PR #16 safety.
  const { translatedMessage } = validateOnlineTranslationPayload({
    parsed,
    requestedTargetLanguageCode: targetLangObj.code,
    sourceText
  });

  const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  const asStringArray = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined;

  return {
    detected_source_language: detectedSource,
    target_language: targetLangObj.code,
    target_language_name: targetLangObj.name,
    // The original the user actually sent — never a model-generated echo.
    original_message: sourceText,
    translated_message: translatedMessage,
    translated_headline: asString(parsed.translated_headline),
    translated_action_steps: asStringArray(parsed.translated_action_steps),
    translated_instructions_for_responders: asString(parsed.translated_instructions_for_responders),
    translated_first_aid_actions: asStringArray(parsed.translated_first_aid_actions),
    translated_needs: asStringArray(parsed.translated_needs),
    // STRICT PRESERVATION of emergency type, category and severity.
    category: locked.category,
    severity: locked.severity,
    emergency_type: locked.type,
    timestamp: new Date().toISOString(),
    model_used: config.model,
    source: 'nebius_nemotron'
  };
}

// ---------------------------------------------------------------------------
// Route-level resolvers
// ---------------------------------------------------------------------------

/**
 * Resolves an explicit translation request (/api/translate-emergency).
 *
 * OFFLINE mode (explicitly requested) → bundled deterministic translation.
 * ONLINE mode → online translation, and every online failure is returned as an
 * explicit error outcome (never a substituted offline success).
 */
export async function resolveEmergencyTranslation(
  input: EmergencyTranslationInput,
  config: TranslationConfig
): Promise<TranslationOutcome> {
  try {
    const requestedTarget = typeof input.targetLanguage === 'string' ? input.targetLanguage.trim() : '';
    if (!requestedTarget) {
      throw new TranslationError(
        'TRANSLATION_INVALID_INPUT',
        'Target language is required for translation.',
        400
      );
    }

    // Generated dispatch/triage boilerplate submitted as the source is an
    // explicit invalid-source error, never a silent "no content" outcome.
    const providedSource = typeof input.text === 'string' ? input.text.trim() : '';
    if (providedSource && looksLikeGeneratedDispatch(providedSource)) {
      throw new TranslationError(
        'TRANSLATION_INVALID_SOURCE',
        'Translation unavailable — the provided text failed safety validation. The original transmission is preserved.',
        400
      );
    }

    const sourceText = resolveTranslationSource({ text: input.text, currentSOS: input.currentSOS });
    if (!sourceText) {
      throw new TranslationError(
        'TRANSLATION_INVALID_INPUT',
        'No message content provided to translate.',
        400
      );
    }
    if (looksLikeGeneratedDispatch(sourceText)) {
      throw new TranslationError(
        'TRANSLATION_INVALID_SOURCE',
        'Translation unavailable — the provided text failed safety validation. The original transmission is preserved.',
        400
      );
    }

    if (input.offlineModeForce === true) {
      return {
        kind: 'ok',
        status: 200,
        data: buildOfflineTranslation({
          sourceText,
          targetLanguage: requestedTarget,
          sourceLanguage: input.sourceLanguage,
          currentSOS: input.currentSOS,
          location: input.location
        })
      };
    }

    if (!config.apiKey) {
      throw new TranslationError(
        'TRANSLATION_NOT_CONFIGURED',
        'Online translation is not configured (NEBIUS_API_KEY missing). Switch to Offline Mode for the bundled deterministic translation. The original transmission is preserved.',
        503
      );
    }

    const data = await translateEmergencyOnline(
      {
        sourceText,
        targetLanguage: requestedTarget,
        sourceLanguage: input.sourceLanguage,
        currentSOS: input.currentSOS,
        location: input.location
      },
      config
    );

    return { kind: 'ok', status: 200, data };
  } catch (err) {
    const e = toTranslationError(err);
    return {
      kind: 'error',
      status: e.status,
      code: e.code,
      error: e.message,
      ...(typeof e.upstreamStatus === 'number' ? { upstream_status: e.upstreamStatus } : {})
    };
  }
}

/**
 * Legacy adapter retained for callers that need to resolve translation as a
 * standalone outcome. The /api/analyze-emergency route does not call this helper:
 * it returns the Nemotron result immediately, and the browser uses
 * /api/translate-emergency for any follow-up translation.
 */
export async function translateForOnlineAnalysis(
  input: {
    sourceText: string;
    targetLanguage: string;
    sourceLanguage?: unknown;
    currentSOS?: Record<string, any> | null;
    location?: unknown;
  },
  config: TranslationConfig
): Promise<InitialAnalysisTranslation> {
  try {
    const sourceText = typeof input.sourceText === 'string' ? input.sourceText.trim() : '';
    if (!sourceText) {
      throw new TranslationError(
        'TRANSLATION_INVALID_INPUT',
        'No original transmission available to translate.',
        400
      );
    }
    if (looksLikeGeneratedDispatch(sourceText)) {
      throw new TranslationError(
        'TRANSLATION_INVALID_SOURCE',
        'Translation unavailable — the provided text failed safety validation. The original transmission is preserved.',
        400
      );
    }
    if (!config.apiKey) {
      throw new TranslationError(
        'TRANSLATION_NOT_CONFIGURED',
        'Online translation is not configured (NEBIUS_API_KEY missing). The original transmission is preserved.',
        503
      );
    }

    const translation = await translateEmergencyOnline(input, config);
    return { status: 'ok', translation };
  } catch (err) {
    return { status: 'error', error: toTranslationErrorInfo(err) };
  }
}
