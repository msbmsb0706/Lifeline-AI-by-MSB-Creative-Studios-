/**
 * Browser Web Speech API capture lifecycle (no paid ASR service required).
 *
 * Handles Chrome/Android behaviour where recognition ends on its own when the
 * speech end-point is reached:
 *  - interim and final results are emitted immediately
 *  - captured text is kept when Chrome ends the session (a trailing interim
 *    result is promoted to final instead of being dropped)
 *  - onerror / onend are handled once per session; stale events from an old
 *    recognizer are ignored
 *  - every tap creates a FRESH recognizer, so restarting never hits
 *    InvalidStateError from a session that is still shutting down
 *  - the selected language locale is applied on every start
 */

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: ((ev?: any) => void) | null;
  onresult: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onend: ((ev?: any) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechCaptureCallbacks {
  onListeningChange: (listening: boolean) => void;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string | null) => void;
  /** Fired once per session with the full captured text (may be ''). */
  onSessionEnd?: (finalText: string) => void;
}

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

export class SpeechCaptureController {
  private recognition: RecognitionLike | null = null;
  private sessionId = 0;
  private finalText = '';
  private interimText = '';
  private listening = false;

  constructor(
    private readonly factory: () => RecognitionLike,
    private readonly cb: SpeechCaptureCallbacks
  ) {}

  get isListening(): boolean {
    return this.listening;
  }

  get transcript(): string {
    return [this.finalText, this.interimText].filter(Boolean).join(' ').trim();
  }

  start(lang: string): boolean {
    this.detach(true);
    const id = ++this.sessionId;
    this.finalText = '';
    this.interimText = '';
    this.cb.onError(null);

    let rec: RecognitionLike;
    try {
      rec = this.factory();
    } catch {
      this.cb.onError('Speech recognition is not supported in this browser. Please type your emergency description.');
      return false;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    const live = () => id === this.sessionId && this.recognition === rec;

    rec.onstart = () => {
      if (!live()) return;
      this.setListening(true);
    };
    rec.onresult = (event: any) => {
      if (!live()) return;
      const { finalText, interimText } = buildTranscript(event?.results);
      this.finalText = finalText;
      this.interimText = interimText;
      const text = this.transcript;
      if (text) this.cb.onTranscript(text, !interimText);
    };
    rec.onerror = (event: any) => {
      if (!live()) return;
      const msg = speechErrorMessage(event?.error);
      if (msg) this.cb.onError(msg);
      // onend always follows onerror; some engines skip it, so finish here too.
      this.finish(rec);
    };
    rec.onend = () => {
      if (!live()) return;
      this.finish(rec);
    };

    this.recognition = rec;
    try {
      rec.start();
      this.setListening(true); // optimistic: button reflects the tap immediately
      return true;
    } catch {
      this.recognition = null;
      this.setListening(false);
      this.cb.onError('Could not start microphone. You can type distress details directly.');
      return false;
    }
  }

  /** User tapped stop — text is delivered via onend (or immediately if it never comes). */
  stop(): void {
    const rec = this.recognition;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      this.finish(rec);
    }
  }

  dispose(): void {
    this.detach(true);
    this.setListening(false);
  }

  private finish(rec: RecognitionLike): void {
    if (this.recognition !== rec) return;
    this.recognition = null;
    // Don't lose a trailing interim result when Chrome ends the session.
    const text = this.transcript;
    this.finalText = text;
    this.interimText = '';
    if (text) this.cb.onTranscript(text, true);
    this.setListening(false);
    this.cb.onSessionEnd?.(text);
  }

  private detach(abort: boolean): void {
    const rec = this.recognition;
    this.recognition = null;
    if (!rec) return;
    rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
    if (abort) {
      try {
        rec.abort();
      } catch {
        // ignore
      }
    }
  }

  private setListening(value: boolean): void {
    if (this.listening === value) return;
    this.listening = value;
    this.cb.onListeningChange(value);
  }
}
