/**
 * Browser Web Speech API helpers (no paid ASR service required).
 *
 * Used by EmergencyVoiceButton to handle Chrome/Android behaviour where
 * recognition ends on its own at the speech end-point:
 *  - finals are merged without Android's cumulative duplicates
 *  - error codes map to user-facing messages (silence/abort stay quiet)
 */

export function speechErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null; // normal: silence timeout or our own stop/restart
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission blocked. Please allow mic access.';
    case 'audio-capture':
      return 'No microphone found. You can type distress details directly.';
    case 'network':
      return 'Voice recognition needs a network connection in this browser. You can type distress details directly.';
    case 'language-not-supported':
      return 'This language is not supported by browser voice recognition. Please type your emergency.';
    default:
      return `Voice input error: ${code || 'Check microphone'}`;
  }
}

/** Build transcript from ALL results (not only from resultIndex). */
export function buildTranscript(results: any): { finalText: string; interimText: string } {
  const finals: string[] = [];
  let interim = '';
  for (let i = 0; i < (results?.length ?? 0); i++) {
    const r = results[i];
    const text = String(r?.[0]?.transcript ?? '').trim();
    if (!text) continue;
    if (r.isFinal) {
      const prev = finals[finals.length - 1];
      // Android Chrome in continuous mode may re-emit cumulative finals
      // ("help", "help my father") — replace instead of duplicating.
      if (prev && (text === prev || text.startsWith(prev + ' '))) {
        finals[finals.length - 1] = text;
      } else {
        finals.push(text);
      }
    } else {
      interim = interim ? `${interim} ${text}` : text;
    }
  }
  return { finalText: finals.join(' '), interimText: interim };
}

/**
 * Append a newly finalized chunk to the committed transcript. Android Chrome
 * can re-emit cumulative finals ("help" then "help my father"); those replace
 * the tail instead of duplicating it.
 */
export function mergeFinalChunk(committed: string, chunk: string): string {
  const prev = committed.trim();
  const next = chunk.replace(/\s+/g, ' ').trim();
  if (!next) return prev;
  if (!prev) return next;
  if (prev === next || prev.endsWith(' ' + next)) return prev;
  if (next.startsWith(prev + ' ')) return next;
  // Replace a repeated tail segment: "fire" + "fire on floor two"
  const words = prev.split(' ');
  for (let i = 1; i < words.length; i++) {
    const tail = words.slice(i).join(' ');
    if (next === tail || next.startsWith(tail + ' ')) return `${words.slice(0, i).join(' ')} ${next}`;
  }
  return `${prev} ${next}`;
}
