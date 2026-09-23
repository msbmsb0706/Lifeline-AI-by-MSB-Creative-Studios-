/**
 * LifeLine AI — Translation safety helpers (PR #16).
 *
 * Hard guarantees:
 * 1. `translated_message` must contain ONLY a faithful translation of the
 *    user's original transmission — never generated responder/dispatch text.
 * 2. Translation source priority:
 *      1. raw_transcript
 *      2. original_message (top-level, or the stored translation.original_message)
 *      3. transcript (the genuinely legacy original-transcript field)
 *    The generated dispatch message (`message`), responder instructions,
 *    action steps, required units, AI summaries and structured directives are
 *    NEVER accepted as a translation source.
 * 3. Deterministic (no AI) validation rejects obvious generated
 *    dispatch/triage boilerplate via strong marker *combinations*, so a single
 *    incidental word can never cause a false rejection of legitimate user text.
 *
 * Shared by the browser client (src/App.tsx, src/components/SOSCardView.tsx)
 * and the server (server.ts) so both sides enforce the identical contract.
 */

export interface TranslationSourceCandidate {
  raw_transcript?: unknown;
  original_message?: unknown;
  transcript?: unknown;
  /** Accepted on the input shape for convenience — NEVER used as a source. */
  message?: unknown;
  translation?: { original_message?: unknown } | null;
}

/**
 * Selects the authoritative translation source from a result object.
 *
 * Returns the trimmed source text, or `null` when no legitimate original
 * transmission exists (callers must then show an explicit
 * translation-unavailable/error state and preserve the original — never fall
 * back to the generated dispatch message).
 *
 * Candidates that themselves look like generated dispatch boilerplate are
 * skipped (corrupt/stale data must never be translated as if it were the
 * user's own words); when every candidate is missing or dispatch-like the
 * result is `null`.
 */
export function selectTranslationSource(input: TranslationSourceCandidate | null | undefined): string | null {
  if (!input || typeof input !== 'object') return null;

  const candidates: unknown[] = [
    input.raw_transcript,
    input.original_message,
    input.translation?.original_message,
    // Legacy original-transcript field (Nemotron `transcript` schema field).
    // Used ONLY when no newer original field exists. `message` (the generated
    // dispatch report) is deliberately absent from this list.
    input.transcript
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (looksLikeGeneratedDispatch(trimmed)) continue;
    return trimmed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deterministic generated-dispatch/triage boilerplate detector (no AI).
// ---------------------------------------------------------------------------

/** Distinct strong boilerplate marker groups (case-insensitive). */
const DISPATCH_MARKERS: RegExp[] = [
  /priority\s*\d\s*\/\s*5/i, // "Priority X/5"
  /required\s+(units|assets|assistance)/i, // "Required Units/Assets/Assistance"
  /(?:responder\s+(?:instruction|directive)s?)|(?:instructions?_for_responders)|(?:instructions?\s+for\s+responders)/i, // "Responder Instruction"
  /(?:action\s+required)|(?:action:\s*dispatch)/i, // "Action Required" / "Action: Dispatch"
  /first[\s-]*aid/i, // "First Aid"
  /emergency\s+category/i, // "Emergency Category"
  /triage/i // triage boilerplate
];

/** Report-header marker that alone proves generated dispatch content. */
const DISPATCH_HEADER_MARKER = /dispatch\s+alert/i;

/**
 * Returns true when `text` is obviously generated dispatch/triage boilerplate
 * rather than a user's own transmission.
 *
 * Rule: the DISPATCH ALERT report header alone is conclusive; otherwise at
 * least TWO distinct strong markers must be present. A single incidental word
 * (e.g. a user writing "I need first aid") is therefore never rejected.
 */
export function looksLikeGeneratedDispatch(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  if (DISPATCH_HEADER_MARKER.test(text)) return true;
  let hits = 0;
  for (const marker of DISPATCH_MARKERS) {
    if (marker.test(text)) {
      hits += 1;
      if (hits >= 2) return true;
    }
  }
  return false;
}

export interface TranslatedMessageValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validates a candidate `translated_message` value. Rejects empty values and
 * anything that looks like generated dispatch/triage boilerplate.
 */
export function validateTranslatedMessage(candidate: unknown): TranslatedMessageValidation {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return { ok: false, reason: 'empty translation' };
  }
  if (looksLikeGeneratedDispatch(candidate)) {
    return { ok: false, reason: 'generated dispatch/triage boilerplate rejected' };
  }
  return { ok: true };
}
