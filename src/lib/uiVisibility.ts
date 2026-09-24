/**
 * Public-UI visibility. Technical/provider/debug lines (model names, engine
 * labels, readiness diagnostics) are hidden from end users by default.
 * Set VITE_SHOW_TECH_DETAILS=true at build time to show them for debugging.
 */
export const SHOW_TECH_DETAILS: boolean =
  ((import.meta as any).env?.VITE_SHOW_TECH_DETAILS ?? '') === 'true';

const OFFLINE_FALLBACK_RE = /^\[[A-Z-]+ faithful translation not available offline[^\]]*\]\s*/;

/** User-friendly rendering of the offline "no faithful translation" marker. */
export function friendlyTranslationText(text: string): string {
  if (!OFFLINE_FALLBACK_RE.test(text)) return text;
  const original = text.replace(OFFLINE_FALLBACK_RE, '').trim();
  return original
    ? `Translation not available offline. Please show the original message: "${original}"`
    : 'Translation not available offline. Please show the original message.';
}
