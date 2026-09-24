import type { EmergencyAnalysisResult } from '../types.ts';

/** Only the explicitly selected ONLINE AI path may call this function. */
export interface OnlineTriagePayload {
  text: string;
  location?: string | null;
  coordinates?: { latitude: number; longitude: number; accuracyMeters?: number } | null;
  language: string;
  targetLanguage: string;
  voiceCapture?: {
    asrProvider: string;
    asrModel: string;
    detectedLanguage: { code: string; name: string };
    originalTranscript: string;
    englishTranslation?: string;
  };
}

export type OnlineTriageAttempt =
  | { ok: true; data: EmergencyAnalysisResult }
  | { ok: false; reason: string };

type FetchResponse = Pick<Response, 'ok' | 'status' | 'json'>;
export type OnlineTriageFetcher = (url: string, init: RequestInit) => Promise<FetchResponse>;

/**
 * Fail fast on airplane mode, HTTP error, malformed reply, stalled body or
 * network error. The caller always classifies locally on any failure and
 * labels that result as on-device; a failed online request is NEVER reported
 * as a successful server analysis or an emergency-partner delivery.
 *
 * Promise.race is intentional: even a broken fetch shim that ignores
 * AbortSignal cannot indefinitely block the locally classified SOS.
 */
export async function attemptOnlineTriage(
  payload: OnlineTriagePayload,
  options: { isOnline?: boolean; timeoutMs?: number; fetcher?: OnlineTriageFetcher } = {}
): Promise<OnlineTriageAttempt> {
  const isOnline = options.isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine : true);
  if (!isOnline) return { ok: false, reason: 'Device is offline (airplane mode or no signal).' };
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 4000;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('Online AI timeout'));
      }, timeoutMs);
    });
    const request = (async (): Promise<OnlineTriageAttempt> => {
      const fetcher = options.fetcher || fetch;
      const response = await fetcher('/api/analyze-emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, offlineModeForce: false }),
        signal: controller.signal
      });
      const json: any = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        const message = typeof json?.error === 'string' && json.error.trim()
          ? json.error.trim().slice(0, 250)
          : response.status === 401
            ? 'Online AI authentication unavailable.'
            : `Online AI returned HTTP ${response.status}.`;
        return { ok: false, reason: message.endsWith('.') ? message : `${message}.` };
      }
      const data = json.data;
      if (!data || typeof data.emergency_type !== 'string' ||
          !Number.isInteger(data.severity) || data.severity < 1 || data.severity > 5 ||
          !data.visual_card || typeof data.visual_card.headline !== 'string') {
        return { ok: false, reason: 'Online AI returned an incomplete result.' };
      }
      return { ok: true, data: data as EmergencyAnalysisResult };
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      return { ok: false, reason: `Online AI did not respond within ${timeoutMs >= 1000 ? `${timeoutMs / 1000} seconds` : `${timeoutMs} ms`}.` };
    }
    return { ok: false, reason: 'Network error contacting the online AI.' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
