/**
 * Multilingual speech output for LifeLine AI.
 *
 * The microphone path must answer by speaking, not by leaving the person to
 * read a typed box. Browser speechSynthesis is the on-device speaker — no
 * audio is uploaded, and no emergency number is invented here. A phone number
 * is spoken only when the caller passes one that was already configured.
 */
import {
  EMERGENCY_TRANSLATION_DICTIONARY,
  detectLanguage,
  getSpeechRecognitionLocale,
  matchLanguageIdentifier,
  standardizeCategory
} from './languages.ts';
import type { StandardEmergencyCategory } from '../types.ts';

const LEAD_IN: Record<string, string> = {
  en: 'Emergency help.',
  es: 'Ayuda de emergencia.',
  fr: "Aide d'urgence.",
  ta: 'அவசர உதவி.',
  hi: 'आपातकालीन मदद.',
  te: 'అత్యవసర సహాయం.',
  kn: 'ತುರ್ತು ಸಹಾಯ.',
  ml: 'അടിയന്തര സഹായം.',
  bn: 'জরুরি সাহায্য.',
  mr: 'आणीबाणी मदत.'
};

const CALL_PHRASE: Record<string, (number: string) => string> = {
  en: (n) => `Call ${n}.`,
  es: (n) => `Llame al ${n}.`,
  fr: (n) => `Appelez le ${n}.`,
  ta: (n) => `${n} எண்ணை அழையுங்கள்.`,
  hi: (n) => `${n} पर कॉल करें.`,
  te: (n) => `${n} కు కాల్ చేయండి.`,
  kn: (n) => `${n} ಗೆ ಕರೆ ಮಾಡಿ.`,
  ml: (n) => `${n} എന്ന നമ്പറിൽ വിളിക്കുക.`,
  bn: (n) => `${n} নম্বরে কল করুন.`,
  mr: (n) => `${n} वर कॉल करा.`
};

/** Drop the English gloss in parentheses so speech stays in one language. */
export function spokenPhrase(text: string): string {
  return text.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

export function resolveSpeechLocale(identifier?: string): string {
  if (!identifier || !identifier.trim()) return getSpeechRecognitionLocale('en');
  const matched = matchLanguageIdentifier(identifier);
  return getSpeechRecognitionLocale(matched?.code || identifier);
}

/**
 * Where to start the recognizer when the person has not locked a language.
 * An explicit non-English app language wins. Otherwise a device language that
 * we support is a better any-language hint than forcing English.
 */
export function pickStartLanguage(selectedLanguage?: string, navigatorLanguages: readonly string[] = []): string {
  const selected = (selectedLanguage || '').toLowerCase().trim();
  if (selected && selected !== 'en' && selected !== 'auto' && EMERGENCY_TRANSLATION_DICTIONARY[selected]) {
    return selected;
  }
  for (const tag of navigatorLanguages) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (base && base !== 'en' && EMERGENCY_TRANSLATION_DICTIONARY[base]) return base;
  }
  if (selected && EMERGENCY_TRANSLATION_DICTIONARY[selected]) return selected;
  return 'en';
}

/**
 * Live retarget: if the words already heard are clearly another supported
 * language, the recognizer should switch immediately. English is never a
 * switch target — a weak Latin guess must not yank the mic back to English.
 * A locked language (the person tapped a chip) is never overridden.
 */
export function shouldSwitchRecognitionLanguage(
  currentCode: string,
  transcript: string,
  lockedCode?: string | null
): string | null {
  if (lockedCode) return null;
  if (!transcript || !transcript.trim()) return null;
  const detected = detectLanguage(transcript);
  if (!detected || detected.code === 'en' || detected.code === currentCode) return null;
  if ((detected.confidence ?? 0) >= 0.88 && EMERGENCY_TRANSLATION_DICTIONARY[detected.code]) {
    return detected.code;
  }
  return null;
}

export interface SpokenBriefInput {
  languageCode?: string;
  category?: string;
  severity?: number;
  /** Already-configured public emergency number. Never invented by this function. */
  emergencyNumber?: string | null;
}

/**
 * Short spoken briefing in the speaker's language, from the bundled phrasebook.
 * Two action steps only — long enough to be useful, short enough to hear now.
 */
export function buildSpokenEmergencyBrief(input: SpokenBriefInput): string {
  const requested = (input.languageCode || '').toLowerCase().trim();
  const matched = matchLanguageIdentifier(requested);
  const code = matched && EMERGENCY_TRANSLATION_DICTIONARY[matched.code] ? matched.code : 'en';
  const dict = EMERGENCY_TRANSLATION_DICTIONARY[code] || EMERGENCY_TRANSLATION_DICTIONARY.en;
  const category = standardizeCategory(input.category || 'OTHER') as StandardEmergencyCategory;
  const directive = dict.sampleDirectives[category] || dict.sampleDirectives.OTHER;
  const label = spokenPhrase(dict.categoryLabels[category] || category);
  const priority = spokenPhrase(dict.priorityLabel || 'Priority');
  const severity = Math.min(5, Math.max(1, Math.round(Number(input.severity) || 3)));
  const steps = (directive.actionSteps || [])
    .slice(0, 2)
    .map(spokenPhrase)
    .filter(Boolean)
    .map((step) => (step.endsWith('.') ? step : `${step}.`));
  const number = (input.emergencyNumber || '').trim();
  const call =
    number && /^\d[\d\s-]*$/.test(number) ? (CALL_PHRASE[code] || CALL_PHRASE.en)(number) : '';
  return [LEAD_IN[code] || LEAD_IN.en, `${label}.`, `${priority} ${severity}.`, ...steps, call]
    .filter(Boolean)
    .join(' ');
}

export interface SpeakOptions {
  languageCode?: string;
  interrupt?: boolean;
  rate?: number;
  onEnd?: () => void;
}

export interface SpeakResult {
  started: boolean;
  /** true = a matching voice is installed, false = none, null = voices not loaded yet. */
  voiceMatched: boolean | null;
  locale: string;
}

let speechGeneration = 0;

export function speechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function stopSpeaking(): void {
  speechGeneration += 1;
  if (!speechSynthesisAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

/** Call from the microphone tap so later spoken answers are allowed. */
export function primeSpeechEngine(): void {
  if (!speechSynthesisAvailable()) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.resume();
    const unlock = new SpeechSynthesisUtterance('\u200b');
    unlock.volume = 0;
    unlock.rate = 2;
    window.speechSynthesis.speak(unlock);
  } catch {
    // A browser that blocks speech still shows the on-screen answer.
  }
}

function languagePrefix(locale: string): string {
  return locale.toLowerCase().split('-')[0];
}

export function pickSpeechVoice(locale: string): SpeechSynthesisVoice | null {
  if (!speechSynthesisAvailable()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const wanted = locale.toLowerCase();
  const prefix = languagePrefix(locale);
  const exact = voices.filter((voice) => voice.lang.toLowerCase() === wanted);
  const sameLanguage = voices.filter((voice) => languagePrefix(voice.lang) === prefix);
  const pool = exact.length ? exact : sameLanguage;
  if (!pool.length) return null;
  return (
    pool.find((voice) => voice.localService) ||
    pool.find((voice) => /google|premium|enhanced|natural/i.test(voice.name)) ||
    pool[0]
  );
}

export function matchingVoiceStatus(languageCode?: string): boolean | null {
  if (!speechSynthesisAvailable()) return false;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return Boolean(pickSpeechVoice(resolveSpeechLocale(languageCode)));
}

function chunkForSpeech(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?।])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > 180 && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/**
 * Speak `text` in the requested language. Cancels any previous answer.
 * A short delay after cancel() avoids the Chrome bug that drops the next utterance.
 */
export function speakText(text: string, options: SpeakOptions = {}): SpeakResult {
  const locale = resolveSpeechLocale(options.languageCode);
  if (!speechSynthesisAvailable() || !text || !text.trim()) {
    return { started: false, voiceMatched: false, locale };
  }

  speechGeneration += 1;
  const myGeneration = speechGeneration;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }

  const voiceNow = pickSpeechVoice(locale);
  const voicesLoaded = window.speechSynthesis.getVoices().length > 0;
  const chunks = chunkForSpeech(text);
  if (!chunks.length) return { started: false, voiceMatched: voicesLoaded ? Boolean(voiceNow) : null, locale };

  window.setTimeout(() => {
    if (myGeneration !== speechGeneration) return;
    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }
    const voice = pickSpeechVoice(locale) || voiceNow;
    let finished = false;
    const finish = () => {
      if (finished || myGeneration !== speechGeneration) return;
      finished = true;
      options.onEnd?.();
    };
    const speakChunk = (index: number) => {
      if (myGeneration !== speechGeneration) return;
      if (index >= chunks.length) {
        finish();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = voice?.lang || locale;
      utterance.rate = options.rate ?? 0.95;
      utterance.pitch = 1;
      if (voice) utterance.voice = voice;
      utterance.onend = () => speakChunk(index + 1);
      utterance.onerror = () => finish();
      window.speechSynthesis.speak(utterance);
    };
    speakChunk(0);
  }, 40);

  return {
    started: true,
    voiceMatched: voicesLoaded ? Boolean(voiceNow) : null,
    locale
  };
}
