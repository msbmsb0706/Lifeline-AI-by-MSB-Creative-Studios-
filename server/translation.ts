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

/** Overall online translation safety timeout across both phases (milliseconds). */
export const TRANSLATION_TIMEOUT_MS = 20000;
/** PR #34 compatibility ceiling; phase-specific requests intentionally use less. */
export const TRANSLATION_MAX_TOKENS = 4096;
/** Compact primary output: one user-message translation plus its small metadata object. */
export const TRANSLATION_PRIMARY_MAX_TOKENS = 1000;
/** Separate optional structured fields; sufficient for the existing responder schema. */
export const TRANSLATION_STRUCTURED_MAX_TOKENS = 2400;
/** Bound the primary request and reserve time inside the overall timeout for structured work. */
export const TRANSLATION_PRIMARY_TIMEOUT_MS = 12000;
/** Structured translations are optional and may not consume the whole translation deadline. */
export const TRANSLATION_STRUCTURED_TIMEOUT_MS = 8000;
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

type StructuredSourceFieldName = 'headline' | 'action_steps' | 'instructions_for_responders' | 'first_aid_actions' | 'needs';
type StructuredSourceFields = Partial<Record<StructuredSourceFieldName, string | string[]>>;
type StructuredTranslationFields = Pick<
  TranslatedSOS,
  | 'translated_headline'
  | 'translated_action_steps'
  | 'translated_instructions_for_responders'
  | 'translated_first_aid_actions'
  | 'translated_needs'
>;

const STRUCTURED_FIELD_DEFINITIONS: {
  sourceKey: StructuredSourceFieldName;
  translatedKey: keyof StructuredTranslationFields;
  kind: 'string' | 'string[]';
  description: string;
}[] = [
  { sourceKey: 'headline', translatedKey: 'translated_headline', kind: 'string', description: 'the headline' },
  { sourceKey: 'action_steps', translatedKey: 'translated_action_steps', kind: 'string[]', description: 'the action steps' },
  {
    sourceKey: 'instructions_for_responders',
    translatedKey: 'translated_instructions_for_responders',
    kind: 'string',
    description: 'the responder instructions'
  },
  {
    sourceKey: 'first_aid_actions',
    translatedKey: 'translated_first_aid_actions',
    kind: 'string[]',
    description: 'the first-aid actions'
  },
  { sourceKey: 'needs', translatedKey: 'translated_needs', kind: 'string[]', description: 'the required units' }
];

function nativeScriptInstruction(targetLanguage: ReturnType<typeof getLanguageByCodeOrName>): string {
  if (targetLanguage.script) {
    return `Use the correct native ${targetLanguage.script} script, not romanization or Latin-letter transliteration.`;
  }
  return `Use the standard writing system of ${targetLanguage.name} (${targetLanguage.nativeName}); do not transliterate it into another script.`;
}

function buildStructuredSourceFields(currentSOS?: Record<string, any> | null): StructuredSourceFields {
  const visualCard = currentSOS?.visual_card;
  const card = visualCard && typeof visualCard === 'object' && !Array.isArray(visualCard)
    ? visualCard as Record<string, unknown>
    : {};
  const fields: StructuredSourceFields = {};

  const headline = typeof card.headline === 'string' ? card.headline.trim() : '';
  if (headline) fields.headline = card.headline as string;

  const responderInstructions =
    typeof card.instructions_for_responders === 'string' ? card.instructions_for_responders.trim() : '';
  if (responderInstructions) fields.instructions_for_responders = card.instructions_for_responders as string;

  for (const key of ['action_steps', 'first_aid_actions'] as const) {
    const value = card[key];
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim())) {
      fields[key] = value as string[];
    }
  }

  const needs = currentSOS?.needs;
  if (Array.isArray(needs) && needs.length > 0 && needs.every((item) => typeof item === 'string' && item.trim())) {
    fields.needs = needs as string[];
  }

  return fields;
}

function validateStructuredTranslationPayload(
  parsed: any,
  sourceFields: StructuredSourceFields
): StructuredTranslationFields {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TranslationError(
      'TRANSLATION_INVALID_RESPONSE',
      'The online service returned an unexpected structured responder translation. The original transmission is preserved.'
    );
  }

  const translated: Partial<StructuredTranslationFields> = {};
  for (const definition of STRUCTURED_FIELD_DEFINITIONS) {
    if (!(definition.sourceKey in sourceFields)) continue;
    const value = parsed[definition.translatedKey];
    const sourceValue = sourceFields[definition.sourceKey];
    const valid = definition.kind === 'string'
      ? typeof value === 'string' && Boolean(value.trim())
      : Array.isArray(value) &&
        Array.isArray(sourceValue) &&
        value.length === sourceValue.length &&
        value.every((item: unknown) => typeof item === 'string' && Boolean(item.trim()));

    if (!valid) {
      throw new TranslationError(
        'TRANSLATION_INVALID_RESPONSE',
        `The online service returned an incomplete or invalid translation for ${definition.description}. The original transmission is preserved.`
      );
    }
    (translated as Record<string, unknown>)[definition.translatedKey] =
      typeof value === 'string' ? value.trim() : (value as string[]).map((item) => item.trim());
  }

  return translated as StructuredTranslationFields;
}

function toStructuredTranslationError(err: unknown): TranslationErrorInfo {
  const error = toTranslationError(err);
  const detail = error.message
    .replace(/\s*The original transmission(?: and primary translated_message)? is preserved\.?$/i, '')
    .trim()
    .replace(/[.]+$/, '');
  return {
    code: error.code,
    error: `Structured responder translation unavailable: ${detail || 'the structured response was incomplete'}. The original transmission and primary translated_message are preserved.`,
    ...(typeof error.upstreamStatus === 'number' ? { upstream_status: error.upstreamStatus } : {})
  };
}

async function requestTranslationJson(input: {
  config: TranslationConfig;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
  phase: 'primary' | 'structured';
}): Promise<any> {
  const { config, systemPrompt, userPrompt, maxTokens, timeoutMs, phase } = input;
  const structured = phase === 'structured';
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
      max_tokens: maxTokens
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      detail = '';
    }
    throw new TranslationError(
      'TRANSLATION_UPSTREAM_HTTP',
      `${structured ? 'Structured translation provider' : 'Translation provider'} returned HTTP ${response.status}${detail ? ` (${detail})` : ''}. The original transmission is preserved.`,
      502,
      response.status
    );
  }

  const raw = await response.json().catch(() => null);
  const choice = (raw as any)?.choices?.[0];
  if (!raw || !Array.isArray((raw as any).choices) || !choice || typeof choice !== 'object') {
    throw new TranslationError(
      'TRANSLATION_INVALID_RESPONSE',
      `${structured ? 'The online service returned an unexpected structured translation response' : 'The online translation service returned an unexpected response shape'}. The original transmission is preserved.`
    );
  }

  if (choice.finish_reason === 'length') {
    throw new TranslationError(
      'TRANSLATION_TRUNCATED',
      structured
        ? 'The online structured responder translation service returned an incomplete (truncated) response. The original transmission is preserved.'
        : 'The online translation service returned an incomplete (truncated) response. The original transmission is preserved.'
    );
  }

  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new TranslationError(
      'TRANSLATION_EMPTY_RESPONSE',
      `${structured ? 'The online service returned no structured responder translation' : 'The online translation service returned no text'}. The original transmission is preserved.`
    );
  }

  try {
    return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  } catch {
    throw new TranslationError(
      'TRANSLATION_INVALID_JSON',
      `${structured ? 'The online service returned malformed structured responder JSON' : 'The online translation service returned malformed JSON'}. The original transmission is preserved.`
    );
  }
}

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
  const startedAt = Date.now();
  const overallTimeoutMs = typeof config.timeoutMs === 'number' && config.timeoutMs > 0
    ? config.timeoutMs
    : TRANSLATION_TIMEOUT_MS;
  const deadline = startedAt + overallTimeoutMs;
  const sourceText = input.sourceText;
  const targetLangObj = getLanguageByCodeOrName(input.targetLanguage);
  const detectedSource = resolveDetectedSourceLanguage(input.sourceLanguage, sourceText);
  const locked = lockTriage(input.currentSOS, sourceText);
  const scriptInstruction = nativeScriptInstruction(targetLangObj);

  // PHASE 1 is deliberately limited to the user's original transmission and
  // the language metadata needed to translate it faithfully. No dispatch or
  // responder fields are included in either prompt or the output schema.
  const primarySystemPrompt = `You are LifeLine AI's emergency-message translation engine.

Translate only the user's original transmission from ${detectedSource.name} (${detectedSource.code}) into the target language: ${targetLangObj.name} (${targetLangObj.nativeName}).

QUALITY AND FIDELITY:
- Use natural ${targetLangObj.name} grammar, word order and idiom while preserving the exact meaning.
- Preserve every fact and detail in the original, and add no unsupported facts.
- Preserve names and proper nouns (transliterate only when the target language normally writes them in its native script).
- Preserve numbers and measurements (including every dosage and unit) exactly as given.
- Preserve ages and quantities exactly.
- Preserve addresses and locations: keep full street addresses, landmarks and postal codes; keep medication names exactly as given.
- Preserve times and dates (including durations); reproduce every digit and character in phone numbers and identifiers exactly.
- Preserve the urgency and tone; use standard emergency and medical terminology expected by target-language first responders.
- Keep every short transmission concise. "Help", "Fire", "I am trapped", "I can't breathe", and "My child is unconscious" must not be expanded into explanations or reports.
- ${scriptInstruction}

SAFETY LIMITS:
- The translated message must be only a faithful translation of the user's original transmission.
- Never summarize, reformat, reinterpret, or turn it into a dispatch report.
- Never add medical advice, a diagnosis, first-aid instructions, or responder instructions.
- Do not invent, imply, or omit emergency details.

OUTPUT — STRICT JSON:
Return exactly one JSON object and no other text, with only these fields:
{
  "detected_source_language": { "code": "${detectedSource.code}", "name": "${detectedSource.name}" },
  "target_language": "${targetLangObj.code}",
  "target_language_name": "${targetLangObj.name}",
  "original_message": "the exact original transmission, unchanged",
  "translated_message": "the natural, faithful translation of that original transmission only"
}`;

  const primaryUserPrompt = `Translate ONLY the user's original transmission from ${detectedSource.name} (${detectedSource.code}) into ${targetLangObj.name} (${targetLangObj.nativeName}). Return the strict JSON object described in the system instructions.

ORIGINAL TRANSMISSION (the only text to translate):
${JSON.stringify(sourceText)}`;

  const primaryTimeoutMs = Math.max(1, Math.min(overallTimeoutMs, TRANSLATION_PRIMARY_TIMEOUT_MS));
  const primaryParsed = await requestTranslationJson({
    config,
    systemPrompt: primarySystemPrompt,
    userPrompt: primaryUserPrompt,
    maxTokens: TRANSLATION_PRIMARY_MAX_TOKENS,
    timeoutMs: primaryTimeoutMs,
    phase: 'primary'
  });

  // `validateTranslatedMessage()` remains the authoritative validator. The
  // transport checks also retain target-language and original-association
  // validation; original_message in the returned object is always sourceText,
  // never a model-generated echo.
  const { translatedMessage } = validateOnlineTranslationPayload({
    parsed: primaryParsed,
    requestedTargetLanguageCode: targetLangObj.code,
    sourceText
  });

  const primaryResult: TranslatedSOS = {
    detected_source_language: detectedSource,
    target_language: targetLangObj.code,
    target_language_name: targetLangObj.name,
    original_message: sourceText,
    translated_message: translatedMessage,
    category: locked.category,
    severity: locked.severity,
    emergency_type: locked.type,
    timestamp: new Date().toISOString(),
    model_used: config.model,
    source: 'nebius_nemotron',
    translation_status: 'ok',
    structured_translation_status: 'none'
  };

  // PHASE 2 is optional and receives only the structured responder fields.
  // It has its own small token budget; errors here are explicitly recorded but
  // can never escape and invalidate the already-validated primary translation.
  //
  // The online triage may already have AUTHORED those responder fields in the
  // requested language (the language selected in the voice / type panel is
  // passed to /api/analyze-emergency and reported as `visual_card_language`).
  // Re-translating them into the language they were written in would waste the
  // request and could report a misleading "responder details are not
  // translated" notice, so the structured phase is skipped in that case.
  const authoredCardLanguage = typeof input.currentSOS?.visual_card_language === 'string'
    ? getLanguageByCodeOrName(input.currentSOS.visual_card_language).code
    : '';
  if (authoredCardLanguage && authoredCardLanguage === targetLangObj.code) return primaryResult;

  const structuredSource = buildStructuredSourceFields(input.currentSOS);
  const structuredDefinitions = STRUCTURED_FIELD_DEFINITIONS.filter((field) => field.sourceKey in structuredSource);
  if (structuredDefinitions.length === 0) return primaryResult;

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    const timeoutError = new TranslationError(
      'TRANSLATION_TIMEOUT',
      'The overall translation time budget expired before structured responder translation could finish.',
      504
    );
    return {
      ...primaryResult,
      translation_status: 'partial',
      structured_translation_status: 'error',
      structured_translation_error: toStructuredTranslationError(timeoutError)
    };
  }

  const structuredSystemPrompt = `You are LifeLine AI's structured emergency-responder translation engine.

Translate ONLY the supplied structured responder/dispatch fields into the target language: ${targetLangObj.name} (${targetLangObj.nativeName}). ${scriptInstruction}

QUALITY AND SAFETY:
- Use natural target-language grammar and preserve the meaning and urgency of each supplied field.
- Preserve names and proper nouns, numbers and measurements, ages, quantities, addresses and locations, medication names, times, dates, phone numbers and identifiers.
- Translate each field only from its corresponding input field; preserve array order and item count.
- Do not add, invent, summarize, or omit details. Never add medical advice, first-aid actions, equipment, responder instructions, or other facts not present in the corresponding input.
- Do not create any fields that were not supplied.

OUTPUT — STRICT JSON:
Return one JSON object containing only the translated keys for the supplied fields. Use these types:
${structuredDefinitions.map((field) => `- "${field.translatedKey}": ${field.kind}`).join('\n')}
No markdown, explanations, or other text.`;

  const structuredUserPrompt = `Translate each supplied structured responder field into ${targetLangObj.name} (${targetLangObj.nativeName}), preserving its field and array-item association. These are the only fields to translate; do not translate or generate any user transmission.

STRUCTURED RESPONDER FIELDS:
${JSON.stringify(structuredSource)}`;
  const structuredTimeoutMs = Math.max(1, Math.min(remainingMs, TRANSLATION_STRUCTURED_TIMEOUT_MS));

  try {
    const structuredParsed = await requestTranslationJson({
      config,
      systemPrompt: structuredSystemPrompt,
      userPrompt: structuredUserPrompt,
      maxTokens: TRANSLATION_STRUCTURED_MAX_TOKENS,
      timeoutMs: structuredTimeoutMs,
      phase: 'structured'
    });
    const translatedFields = validateStructuredTranslationPayload(structuredParsed, structuredSource);
    return {
      ...primaryResult,
      ...translatedFields,
      translation_status: 'ok',
      structured_translation_status: 'ok'
    };
  } catch (err) {
    return {
      ...primaryResult,
      translation_status: 'partial',
      structured_translation_status: 'error',
      structured_translation_error: toStructuredTranslationError(err)
    };
  }
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
