import React, { useEffect, useRef, useState } from 'react';
import { Mic, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playPing } from '../lib/audio.ts';
import { getSpeechRecognitionLocale, SUPPORTED_LANGUAGES } from '../lib/languages.ts';
import {
  pickStartLanguage,
  shouldSwitchRecognitionLanguage
} from '../lib/speech.ts';
import { mergeFinalChunk, buildTranscript, speechErrorMessage } from '../lib/speechCapture.ts';
import { SHOW_TECH_DETAILS } from '../lib/uiVisibility.ts';

interface EmergencyVoiceButtonProps {
  onTranscriptChange: (transcript: string, isFinal: boolean) => void;
  onSubmitEmergency?: (text?: string) => void;
  isAnalyzing: boolean;
  offlineMode?: boolean;
  soundEnabled: boolean;
  highContrast: boolean;
  /**
   * App language hint (e.g. 'en', 'ta'). Auto mode still retargets live when
   * another supported language is heard, so speech is not forced into English.
   */
  selectedLanguage?: string;
  /**
   * Multilingual fast voice path. Resolved at activation time (explicit user
   * action) so offline mode stays network-silent. Used only when the browser
   * cannot do real-time speech. Real-time speaking prefers the Web Speech API.
   */
  onResolveVoiceMode?: () => Promise<'server' | 'browser'>;
  /** Called with base64 audio after a server-ASR recording stops. */
  onVoiceRecordingStopped?: (audioBase64: string, mimeType: string, durationMs: number) => void;
  /** Server ASR pipeline phase for UI feedback ('transcribing'/'translating'). */
  voicePhase?: 'idle' | 'listening' | 'transcribing' | 'translating';
  /** One-line explanation of why the multilingual path is (un)available. */
  voiceModeNotice?: string | null;
  /**
   * NOTE: there is deliberately no "speaking answer" state here anymore — the
   * emergency answer is shown on screen and is never spoken back automatically.
   */
}

// Browser SpeechRecognition polyfill interface
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      [subIndex: number]: {
        transcript: string;
      };
      isFinal: boolean;
    };
  };
}

const MAX_RECORDING_MS = 60_000; // safety cap — capture is always user-activated
const SILENCE_COMMIT_MS = 1_600;
/**
 * A live session that has produced NO result at all after this long is not
 * "listening" from the user's point of view. Chrome/Android very often ends
 * such a session silently (its speech service unreachable, a muted mic, a
 * blocked speech endpoint), so the UI must say so instead of pulsing forever.
 */
export const NO_SPEECH_WATCHDOG_MS = 8_000;
/**
 * Recognition errors that mean the BROWSER'S speech engine itself cannot be
 * used right now (not a permission problem, not user silence). On Android
 * Chrome 'network' is by far the most common: webkitSpeechRecognition depends
 * on Google's cloud speech service, which is unreachable offline and on some
 * mobile networks. For these the app offers its own transcription recorder.
 */
export const ENGINE_UNAVAILABLE_CODES = ['network', 'audio-capture', 'language-not-supported', 'service-not-allowed'];
/**
 * Chrome/Android ends a continuous recognition session on its own speech
 * end-point. Restarting is correct, but a browser that keeps ending the
 * session without hearing anything (no-speech loop, offline, muted mic) must
 * NOT be restarted forever: the microphone would stay open indefinitely and
 * drain the battery while the UI claims "Listening".
 */
const MAX_AUTO_RESTARTS = 3;
const AUTO_RESTART_DELAY_MS = 150;
/**
 * Errors after which Chrome will not continue this session anyway. Auto-restart
 * is pointless (and a silent infinite loop on Android), so the session is
 * finished with whatever was already heard.
 */
const FATAL_RECOGNITION_ERRORS = ['network', 'audio-capture', 'language-not-supported'];

function pickSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  // Android/Chrome record audio/webm (Opus) — accepted by NVIDIA NIM whisper.
  // iOS Safari falls back to audio/mp4 (AAC), which the NVIDIA-hosted
  // whisper-large-v3 endpoint may reject (documented limitation; no large
  // transcoding dependency is added for this).
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read recorded audio'));
    reader.readAsDataURL(blob);
  });
}

function languageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((language) => language.code === code)?.nativeName || code.toUpperCase();
}

export const EmergencyVoiceButton: React.FC<EmergencyVoiceButtonProps> = ({
  onTranscriptChange,
  onSubmitEmergency,
  isAnalyzing,
  offlineMode = false,
  soundEnabled,
  highContrast,
  selectedLanguage = 'en',
  onResolveVoiceMode,
  onVoiceRecordingStopped,
  voicePhase = 'idle',
  voiceModeNotice
}) => {
  const [isListening, setIsListening] = useState(false);
  const [isServerRecording, setIsServerRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [localSpeechSupported, setLocalSpeechSupported] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [liveCaption, setLiveCaption] = useState('');
  const [heardLanguage, setHeardLanguage] = useState(selectedLanguage || 'en');
  const [lockedLang, setLockedLang] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onSubmitEmergencyRef = useRef(onSubmitEmergency);
  const soundEnabledRef = useRef(soundEnabled);
  const selectedLanguageRef = useRef(selectedLanguage);
  onTranscriptChangeRef.current = onTranscriptChange;
  onSubmitEmergencyRef.current = onSubmitEmergency;
  soundEnabledRef.current = soundEnabled;
  selectedLanguageRef.current = selectedLanguage;
  /** Ref mirrors so the once-created recognizer can call the latest callbacks. */
  const onResolveVoiceModeRef = useRef(onResolveVoiceMode);
  const onVoiceRecordingStoppedRef = useRef(onVoiceRecordingStopped);
  onResolveVoiceModeRef.current = onResolveVoiceMode;
  onVoiceRecordingStoppedRef.current = onVoiceRecordingStopped;

  // Server ASR (MediaRecorder) capture refs — audio is held transiently in memory only
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);
  const maxDurationTimerRef = useRef<number | null>(null);
  const activeModeRef = useRef<'server' | 'browser' | null>(null);
  // Synchronous start-lock: acquired BEFORE any await in the start path so a
  // rapid second tap can never spawn a second getUserMedia()/MediaRecorder.
  // While a server recording is active the lock stays held by the recording
  // itself and is released only when it ends (stop / error / cleanup).
  const voiceStartLockRef = useRef(false);
  // Ref mirror of isServerRecording so the async start path can trust capture
  // state synchronously without waiting for a React re-render.
  const isServerRecordingRef = useRef(false);

  const sessionActiveRef = useRef(false);
  const userStopRef = useRef(false);
  const submittedRef = useRef(false);
  const committedRef = useRef('');
  const liveTextRef = useRef('');
  const activeLangRef = useRef(selectedLanguage || 'en');
  const lockedLangRef = useRef<string | null>(null);
  const restartForLangRef = useRef(false);
  const autoSwitchedRef = useRef(false);
  /**
   * Consecutive times Chrome ended the session BY ITSELF without any speech
   * being heard. Reset whenever real speech arrives or the user starts a new
   * session — deliberately NOT reset in onstart, otherwise the cap below can
   * never be reached and the restart loop runs forever.
   */
  const restartCountRef = useRef(0);
  /** true once this session has produced ANY result (interim or final). */
  const heardAnyResultRef = useRef(false);
  const noSpeechTimerRef = useRef<number | null>(null);
  /**
   * Browser-engine health for the CURRENT session. 'none' = nothing reported;
   * 'unreachable' states mean the browser's speech engine cannot be used right
   * now (network / audio-capture / language-not-supported). Drives the explicit
   * in-app fallback offer to LifeLine's own transcription recorder.
   */
  const [engineFallback, setEngineFallback] = useState<'none' | 'checking' | 'offered' | 'unavailable'>('none');
  const engineFallbackRef = useRef<'none' | 'checking' | 'offered' | 'unavailable'>('none');
  const syncEngineFallback = (next: 'none' | 'checking' | 'offered' | 'unavailable') => {
    engineFallbackRef.current = next;
    setEngineFallback(next);
  };
  const silenceTimerRef = useRef<number | null>(null);
  const browserCapTimerRef = useRef<number | null>(null);
  const submitFallbackTimerRef = useRef<number | null>(null);
  const pendingStartTimerRef = useRef<number | null>(null);
  /**
   * The recognizer's REAL state, mirrored from onstart/onend. A tap decides
   * from this instead of from React state, which lags by a render: after
   * Chrome ends a session the button can still say "Listening" for a moment,
   * and that stale label must never swallow the next tap.
   */
  const runningRef = useRef(false);
  // A tap that arrived while Chrome was still closing the previous session.
  const pendingStartRef = useRef(false);
  const startBrowserSessionRef = useRef<(() => void | Promise<void>) | null>(null);

  const isBusyAsr = voicePhase === 'transcribing' || voicePhase === 'translating';
  const isVoiceActive = isListening || isServerRecording;

  const stopServerRecordingTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const clearMaxDurationTimer = () => {
    if (maxDurationTimerRef.current !== null) {
      window.clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  };

  const clearBrowserTimers = () => {
    if (noSpeechTimerRef.current !== null) {
      window.clearTimeout(noSpeechTimerRef.current);
      noSpeechTimerRef.current = null;
    }
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (browserCapTimerRef.current !== null) {
      window.clearTimeout(browserCapTimerRef.current);
      browserCapTimerRef.current = null;
    }
    if (submitFallbackTimerRef.current !== null) {
      window.clearTimeout(submitFallbackTimerRef.current);
      submitFallbackTimerRef.current = null;
    }
    if (pendingStartTimerRef.current !== null) {
      window.clearTimeout(pendingStartTimerRef.current);
      pendingStartTimerRef.current = null;
    }
  };

  const clearPendingStartTimer = () => {
    if (pendingStartTimerRef.current !== null) {
      window.clearTimeout(pendingStartTimerRef.current);
      pendingStartTimerRef.current = null;
    }
  };

  /**
   * Start the recognizer, tolerating Chrome's "the previous session is still
   * closing" InvalidStateError with a short retry instead of dropping the
   * session silently.
   */
  const startRecognizer = (langCode: string, delayMs: number, attemptsLeft = 3): void => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    window.setTimeout(() => {
      if (!sessionActiveRef.current || userStopRef.current || runningRef.current) return;
      try {
        recognition.lang = getSpeechRecognitionLocale(langCode);
        recognition.start();
        return;
      } catch (err: any) {
        if (err?.name !== 'InvalidStateError') {
          console.warn('Mic restart failed:', err);
        }
      }
      if (attemptsLeft <= 1) {
        // Chrome will not release the microphone in this tab. End the session
        // honestly instead of leaving a dead "Listening" state that no tap can
        // clear.
        userStopRef.current = true;
        sessionActiveRef.current = false;
        runningRef.current = false;
        setIsListening(false);
        setMicError('Could not restart the microphone. Tap the microphone to speak again.');
        submitOnce();
        return;
      }
      startRecognizer(langCode, 250, attemptsLeft - 1);
    }, delayMs);
  };

  /** Run a start that was queued while Chrome was still closing a session. */
  const runQueuedStart = () => {
    if (!pendingStartRef.current) return;
    pendingStartRef.current = false;
    clearPendingStartTimer();
    setIsListening(false);
    window.setTimeout(() => startBrowserSessionRef.current?.(), 0);
  };

  const submitOnce = () => {
    if (submittedRef.current) return;
    const text = (liveTextRef.current || committedRef.current).trim();
    if (!text || !onSubmitEmergencyRef.current) return;
    submittedRef.current = true;
    onSubmitEmergencyRef.current(text);
  };

  /**
   * True from mount until unmount. Every timer/promise in this component can
   * outlive it (Chrome fires onend asynchronously; the fallback check awaits the
   * network), so late callbacks must not update state after teardown.
   */
  const disposedRef = useRef(false);
  useEffect(() => {
    disposedRef.current = false;
    return () => { disposedRef.current = true; };
  }, []);

  /** Cancel the "nothing heard yet" watchdog (real results arrived / session over). */
  const clearNoSpeechWatchdog = () => {
    if (noSpeechTimerRef.current !== null) {
      window.clearTimeout(noSpeechTimerRef.current);
      noSpeechTimerRef.current = null;
    }
  };

  /**
   * The browser's own speech engine cannot be used right now. Never leave the
   * person staring at a pulsing "Listening" that will produce nothing:
   *  - state exactly what failed, in plain words;
   *  - check (cached, no repeated network call) whether this server can
   *    transcribe a recording itself, and if so offer that recorder — it does
   *    NOT depend on Google's speech service, which is the part that failed.
   */
  const reportEngineUnavailable = (code: string) => {
    if (disposedRef.current) return;
    if (engineFallbackRef.current !== 'none') return;
    syncEngineFallback('checking');
    const reason = code === 'network'
      ? "Chrome's live voice service is unreachable — voice recognition needs a network connection to the browser's speech servers, which are blocked or unavailable on this connection."
      : code === 'audio-capture'
      ? 'The microphone could not be opened — it may be in use by another app, or the device released it too slowly.'
      : code === 'language-not-supported'
      ? 'This browser cannot listen in the selected language.'
      : 'This browser cannot use its speech service right now.';
    setMicError(`${reason} Tap again to retry, type below, or record with LifeLine transcription.`);
    if (!onVoiceRecordingStoppedRef.current || !onResolveVoiceModeRef.current) {
      syncEngineFallback('unavailable');
      return;
    }
    void (async () => {
      let mode: 'server' | 'browser' = 'browser';
      try {
        mode = await onResolveVoiceModeRef.current!();
      } catch {
        mode = 'browser';
      }
      if (disposedRef.current || engineFallbackRef.current !== 'checking') return;
      syncEngineFallback(mode === 'server' ? 'offered' : 'unavailable');
    })();
  };

  /** Arm the watchdog that catches a session which never produces a result. */
  const armNoSpeechWatchdog = () => {
    clearNoSpeechWatchdog();
    noSpeechTimerRef.current = window.setTimeout(() => {
      noSpeechTimerRef.current = null;
      if (disposedRef.current) return;
      if (!sessionActiveRef.current || heardAnyResultRef.current || userStopRef.current) return;
      reportEngineUnavailable('network');
    }, NO_SPEECH_WATCHDOG_MS);
  };

  const finishBrowserSession = () => {
    clearBrowserTimers();
    userStopRef.current = true;
    sessionActiveRef.current = false;
    if (liveTextRef.current.trim()) committedRef.current = liveTextRef.current.trim();
    // Reflect the stopped state immediately; onend can arrive a render later.
    setIsListening(false);
    // We asked the recognizer to stop, so it no longer counts as "running" for
    // tap decisions: a tap in the same instant starts a fresh session (queued
    // until Chrome reports the end) instead of being swallowed.
    runningRef.current = false;
    try {
      if (recognitionRef.current) recognitionRef.current.stop();
    } catch {
      if (soundEnabledRef.current) playPing('stop');
      submitOnce();
      return;
    }
    // Some browsers never fire onend after stop(). Don't leave the answer unsaid.
    submitFallbackTimerRef.current = window.setTimeout(() => {
      submitFallbackTimerRef.current = null;
      if (!submittedRef.current && userStopRef.current) {
        setIsListening(false);
        submitOnce();
      }
    }, 500);
  };

  useEffect(() => {
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      setLocalSpeechSupported((recognition as any).processLocally === true);
      recognition.lang = getSpeechRecognitionLocale(
        pickStartLanguage(selectedLanguageRef.current, navigator.languages ? Array.from(navigator.languages) : [])
      );

      recognition.onstart = () => {
        // Real microphone open. The auto-restart counter is intentionally NOT
        // reset here: it must count Chrome's own end-pointing across restarts.
        runningRef.current = true;
        setIsListening(true);
        setMicError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // Read EVERY result, not only from resultIndex: Chrome/Android can
        // report a stale resultIndex and silently drop an unheard final.
        const { finalText, interimText } = buildTranscript(event.results);
        if (finalText.trim() || interimText.trim()) {
          // Real speech heard — the session is healthy, so the auto-restart
          // budget starts over and the "nothing heard" watchdog is disarmed.
          restartCountRef.current = 0;
          heardAnyResultRef.current = true;
          clearNoSpeechWatchdog();
          // Real speech proves the engine works: drop any fallback offer.
          syncEngineFallback('none');
        }
        if (finalText.trim()) {
          committedRef.current = mergeFinalChunk(committedRef.current, finalText);
        }
        const live = `${committedRef.current} ${interimText}`.trim();
        liveTextRef.current = live;
        if (live) {
          setLiveCaption(live);
          onTranscriptChangeRef.current(live, Boolean(finalText.trim()));
          if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            if (sessionActiveRef.current) finishBrowserSession();
          }, SILENCE_COMMIT_MS);
        }

        if (!autoSwitchedRef.current && live) {
          const next = shouldSwitchRecognitionLanguage(activeLangRef.current, live, lockedLangRef.current);
          if (next && sessionActiveRef.current) {
            autoSwitchedRef.current = true;
            activeLangRef.current = next;
            setHeardLanguage(next);
            restartForLangRef.current = true;
            try {
              recognition.stop();
            } catch {
              restartForLangRef.current = false;
            }
          }
        }
      };

      recognition.onerror = (err: any) => {
        const code = err?.error;
        if (code === 'no-speech' || code === 'aborted') {
          // no-speech / aborted are normal (silence, our own restart/stop).
          console.warn('Speech recognition warning/error:', code);
        } else {
          console.error('Speech recognition error:', code);
        }
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          sessionActiveRef.current = false;
          userStopRef.current = true;
          setMicError('Microphone permission denied. Please allow mic access in browser settings, or type below.');
          setIsListening(false);
        } else {
          const message = speechErrorMessage(code);
          if (message) setMicError(message);
          if (FATAL_RECOGNITION_ERRORS.includes(code)) {
            // Chrome ends this session by itself after one of these errors, and
            // restarting would only repeat it (an endless, silent loop on
            // Android). Finish the session with whatever was already heard.
            sessionActiveRef.current = false;
            userStopRef.current = true;
            setIsListening(false);
            clearNoSpeechWatchdog();
          }
          // The browser's speech ENGINE is unusable (not the user, not a
          // permission choice): say so explicitly and offer our own recorder.
          if (ENGINE_UNAVAILABLE_CODES.includes(code) && !heardAnyResultRef.current) {
            reportEngineUnavailable(code);
          }
        }
      };
      // Note: every recognition error is surfaced IN-APP (micError banner).
      // This emergency UI never shows a browser alert dialog — errors must not
      // pop up "in public" over someone else's shoulder or a shared screen.

      recognition.onend = () => {
        // A late onend after this component unmounted must not update state.
        if (disposedRef.current) return;
        // Chrome/Android may end at its speech end-point with only interim
        // text. Promote it so a restart or submit never loses what was heard.
        if (liveTextRef.current.trim()) committedRef.current = liveTextRef.current.trim();
        runningRef.current = false;
        clearNoSpeechWatchdog();
        if (pendingStartRef.current) {
          // A new tap arrived while the old session was closing: start clean now.
          runQueuedStart();
          return;
        }
        if (userStopRef.current || !sessionActiveRef.current) {
          restartForLangRef.current = false;
          clearBrowserTimers();
          setIsListening(false);
          if (soundEnabledRef.current) playPing('stop');
          submitOnce();
          return;
        }
        if (restartForLangRef.current) {
          restartForLangRef.current = false;
          startRecognizer(activeLangRef.current, 0);
          return;
        }
        if (restartCountRef.current >= MAX_AUTO_RESTARTS) {
          // Chrome keeps ending the session without hearing anything (its own
          // end-pointing, a muted microphone, or an offline device). Stop
          // instead of restarting forever, keep what was heard, and let the
          // person tap again.
          userStopRef.current = true;
          sessionActiveRef.current = false;
          setIsListening(false);
          setMicError('Listening paused — the browser stopped hearing. Tap the microphone to speak again.');
          submitOnce();
          return;
        }
        restartCountRef.current += 1;
        startRecognizer(activeLangRef.current, AUTO_RESTART_DELAY_MS);
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.warn('Failed to initialize SpeechRecognition:', e);
      setSpeechSupported(false);
    }

    return () => {
      sessionActiveRef.current = false;
      userStopRef.current = true;
      runningRef.current = false;
      pendingStartRef.current = false;
      clearBrowserTimers();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
    // Recognizer is created once. Language and callbacks are read from refs so
    // a live language switch cannot tear the microphone down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup transient MediaRecorder capture on unmount — never leave the mic open
  useEffect(() => {
    return () => {
      // Unmount: release the start lock and ALWAYS stop every microphone track,
      // even if a start was still in flight.
      voiceStartLockRef.current = false;
      isServerRecordingRef.current = false;
      clearNoSpeechWatchdog();
      clearMaxDurationTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      stopServerRecordingTracks();
      recordedChunksRef.current = [];
    };
  }, []);

  // 'started'  → recorder active (owns the start lock until stop/error/cleanup)
  // 'denied'   → microphone permission denied (message shown; no fallback — the
  //              browser voice path would fail on the same permission anyway)
  // 'failed'   → capture unavailable (MediaRecorder missing, hardware error);
  //              caller may fall through to the browser voice path
  const startServerRecording = async (): Promise<'started' | 'denied' | 'failed'> => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicError('Audio recording is not supported in this browser. Using browser voice or type the emergency below.');
      return 'failed';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickSupportedAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }
      );

      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Recording session ended: release the start lock and the ref mirror
        // FIRST, before any early return, so a new capture can begin immediately.
        voiceStartLockRef.current = false;
        isServerRecordingRef.current = false;
        const durationMs = Date.now() - recordingStartRef.current;
        clearMaxDurationTimer();
        stopServerRecordingTracks();
        setIsServerRecording(false);
        if (soundEnabled) playPing('stop');

        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        recordedChunksRef.current = [];

        if (!onVoiceRecordingStopped) return;

        if (durationMs < 500 || blob.size === 0) {
          setMicError('No speech captured. Tap the microphone and speak again.');
          return;
        }

        blobToBase64(blob)
          .then((base64) => onVoiceRecordingStopped(base64, blob.type, durationMs))
          .catch(() => setMicError('Could not process the recording. Tap to try again or type the emergency.'));
      };

      recorder.onerror = () => {
        voiceStartLockRef.current = false;
        isServerRecordingRef.current = false;
        clearMaxDurationTimer();
        stopServerRecordingTracks();
        setIsServerRecording(false);
        setMicError('Recording failed. Tap to try again or type the emergency below.');
      };

      mediaRecorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      recorder.start();
      isServerRecordingRef.current = true;
      setIsServerRecording(true);
      setMicError(null);
      if (soundEnabled) playPing('start');

      // Hard safety cap: never record in the background beyond MAX_RECORDING_MS.
      // Registered BEFORE the success return so the cap is actually armed —
      // this was previously unreachable dead code after the early return.
      maxDurationTimerRef.current = window.setTimeout(() => {
        try {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        } catch {
          // ignore
        }
      }, MAX_RECORDING_MS);

      return 'started';
    } catch (err: any) {
      console.warn('Server voice capture failed to start:', err);
      isServerRecordingRef.current = false;
      stopServerRecordingTracks();
      if (err?.name === 'NotAllowedError') {
        setMicError('Microphone permission blocked. Please allow mic access, or type the emergency below.');
        return 'denied';
      }
      setMicError('Could not start the microphone. You can use browser voice or type the emergency below.');
      return 'failed';
    }
  };

  const stopServerRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
  };

  /**
   * WHY THERE IS NO getUserMedia() PROBE ON THIS PATH (Android Chrome fix).
   *
   * An earlier version opened the microphone with getUserMedia() first "to
   * attach the permission prompt to the tap", stopped the track, and only then
   * called recognition.start(). On Chrome for Android that reliably broke live
   * voice, for two independent reasons:
   *
   *  1. Device contention — the probe grabs the microphone. Even after
   *     track.stop() the Android audio stack needs time to release it, so the
   *     recognizer that immediately follows fails with 'audio-capture'
   *     ("the mic is in use by another app") and the session ends having heard
   *     nothing. The user sees a pulsing "Listening" and then silence.
   *  2. Lost user gesture — because the probe was awaited, recognition.start()
   *     ran OUTSIDE the tap's user-activation window, and Chrome/Android can
   *     refuse microphone access with 'not-allowed' in that state. The app then
   *     reported "permission denied", which was not true: the user never saw a
   *     prompt.
   *
   * The Web Speech API opens the microphone itself and shows Chrome's own
   * permission prompt; the outcome arrives through onerror, which is mapped to
   * an in-app message below. No probe is needed — and none is safe here.
   * getUserMedia() is still used on the server-recorder path, where a real
   * MediaStream is genuinely required.
   */

  /**
   * Start the browser recognizer. SYNCHRONOUS — no await, no probe, no fetch.
   *
   * It must stay synchronous because it is called directly from the tap
   * handler: `recognition.start()` has to run inside the user-activation window
   * or Chrome/Android can refuse the microphone (see the note above).
   */
  const startBrowserSession = (): void => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setMicError('Speech recognition is not supported in this browser. Please type your emergency description.');
      voiceStartLockRef.current = false;
      return;
    }
    // Chrome/Android refuses microphone access on an insecure origin, and the
    // Web Speech API fails there too. Say exactly that instead of a misleading
    // "permission denied" — this is a very common way to test a local build.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setMicError(
        'The microphone needs a secure (https://) connection. This page is not secure, so voice is unavailable here — type your emergency below.'
      );
      sessionActiveRef.current = false;
      userStopRef.current = true;
      setIsListening(false);
      voiceStartLockRef.current = false;
      return;
    }
    userStopRef.current = false;
    submittedRef.current = false;
    sessionActiveRef.current = true;
    restartForLangRef.current = false;
    autoSwitchedRef.current = false;
    heardAnyResultRef.current = false;
    syncEngineFallback('none');
    // A user-initiated session always gets a full restart budget.
    restartCountRef.current = 0;
    committedRef.current = '';
    liveTextRef.current = '';
    setLiveCaption('');
    const startCode =
      lockedLangRef.current ||
      pickStartLanguage(selectedLanguageRef.current, navigator.languages ? Array.from(navigator.languages) : []);
    activeLangRef.current = startCode;
    setHeardLanguage(startCode);
    activeModeRef.current = 'browser';

    recognition.lang = getSpeechRecognitionLocale(startCode);
    if (soundEnabledRef.current) playPing('start');
    try {
      recognition.start();
    } catch (err: any) {
      if (err?.name === 'InvalidStateError') {
        // Previous session still closing — restart cleanly from its onend.
        pendingStartRef.current = true;
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        // A browser that never reports the end of the session it is closing
        // must not swallow this tap: guarantee the queued start still runs.
        clearPendingStartTimer();
        pendingStartTimerRef.current = window.setTimeout(() => runQueuedStart(), 500);
        return;
      }
      console.warn('Mic start failed:', err);
      sessionActiveRef.current = false;
      setMicError('Could not start microphone. You can type distress details directly.');
      return;
    }
    armNoSpeechWatchdog();
    if (browserCapTimerRef.current !== null) window.clearTimeout(browserCapTimerRef.current);
    browserCapTimerRef.current = window.setTimeout(() => {
      if (sessionActiveRef.current) finishBrowserSession();
    }, MAX_RECORDING_MS);
  };

  startBrowserSessionRef.current = startBrowserSession;

  const lockLanguage = (code: string | null) => {
    lockedLangRef.current = code;
    setLockedLang(code);
    if (!code) return;
    activeLangRef.current = code;
    setHeardLanguage(code);
    if (sessionActiveRef.current && recognitionRef.current) {
      restartForLangRef.current = true;
      try {
        recognitionRef.current.stop();
      } catch {
        restartForLangRef.current = false;
      }
    }
  };

  const toggleRecording = async () => {
    if (isAnalyzing || isBusyAsr) return;

    // Active capture → stop it (the answer is read on screen, never auto-spoken).
    // The recognizer's REAL state decides, not React state: Chrome can end a
    // session a render before React notices, and a stale "Listening" label must
    // never swallow the next tap.
    if (runningRef.current) {
      finishBrowserSession();
      return;
    }
    if (isServerRecording || isServerRecordingRef.current) {
      stopServerRecording();
      return;
    }
    // The recognizer is not open. Any session Chrome already ended (its speech
    // end-point, an error, or a stop we issued) is replaced by this tap instead
    // of being ignored — the person can always start speaking again.
    if (sessionActiveRef.current) {
      // Close the previous session. Anything it already heard is handed to the
      // parent first: an emergency description must not be lost just because
      // the person chose to speak again.
      if (liveTextRef.current.trim()) committedRef.current = liveTextRef.current.trim();
      userStopRef.current = true;
      sessionActiveRef.current = false;
      clearBrowserTimers();
      submitOnce();
    }
    pendingStartRef.current = false;
    clearPendingStartTimer();

    // SYNCHRONOUS start-lock: acquired before any await below. A rapid second
    // tap while startup (probe / getUserMedia) is still in flight is ignored,
    // so only ONE MediaRecorder and ONE microphone stream can ever exist.
    if (voiceStartLockRef.current) {
      return;
    }
    voiceStartLockRef.current = true;
    setMicError(null);

    try {
      // REALTIME_BROWSER_SPEECH: speak-back needs live recognition. The batch
      // server recorder is only the fallback when this browser cannot listen live.
      const browserReady = Boolean(recognitionRef.current) && speechSupported && !(offlineMode && !localSpeechSupported);
      if (browserReady) {
        // SYNCHRONOUS: recognition.start() must run inside the tap's
        // user-activation window (see the Android Chrome note above). The
        // start-lock is released by the finally block below.
        startBrowserSession();
        return;
      }

      let mode: 'server' | 'browser' = 'browser';
      if (onResolveVoiceMode) {
        try {
          mode = await onResolveVoiceMode();
        } catch {
          mode = 'browser';
        }
      }
      activeModeRef.current = mode;

      if (mode === 'server' && onVoiceRecordingStopped) {
        const started = await startServerRecording();
        if (started === 'started') {
          // The active recording now OWNS the start lock; it is released in
          // recorder.onstop / onerror / unmount cleanup — never left held.
          return;
        }
        if (started === 'denied') {
          return;
        }
      }

      if (offlineMode && !localSpeechSupported) {
        setMicError('Offline voice recognition is not available on this device. Type below — you can still press speak on the answer.');
        return;
      }

      setMicError('Speech recognition is not supported in this browser. Please type your emergency description.');
    } finally {
      // Release the lock for every start path that did not end up owning an
      // active server recording (browser voice starts synchronously and needs
      // no lock; only a live MediaRecorder owns it until it stops).
      if (!isServerRecordingRef.current) {
        voiceStartLockRef.current = false;
      }
    }
  };

  const busyLabel = voicePhase === 'translating' ? 'Translating…' : 'Transcribing…';
  const busySubLabel = 'Then the answer is on screen';
  const captionLang = getSpeechRecognitionLocale(heardLanguage);

  return (
    <div id="emergency-voice-section" className="flex flex-col items-center justify-center my-4 sm:my-6">
      {/* Large tactile push button container */}
      <div className="relative flex items-center justify-center">
        {/* Animated Soundwave Pulse Rings when Listening */}
        <AnimatePresence>
          {isVoiceActive && (
            <>
              <motion.div
                initial={{ scale: 0.9, opacity: 0.8 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ repeat: Infinity, duration: 1.6, ease: 'easeOut' }}
                className="absolute w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-red-500/30 pointer-events-none"
              />
              <motion.div
                initial={{ scale: 0.9, opacity: 0.9 }}
                animate={{ scale: 1.3, opacity: 0 }}
                transition={{ repeat: Infinity, duration: 1.6, delay: 0.4, ease: 'easeOut' }}
                className="absolute w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-red-600/40 pointer-events-none"
              />
            </>
          )}
        </AnimatePresence>

        {/* Primary Button */}
        <motion.button
          id="emergency-voice-record-btn"
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleRecording}
          disabled={isAnalyzing || isBusyAsr}
          aria-label={
            isVoiceActive
              ? 'Stop listening'
              : 'Speak your emergency in any language. The answer appears on screen.'
          }
          className={`relative z-10 w-32 h-32 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center text-white shadow-2xl transition-all select-none ${
            isVoiceActive
              ? 'bg-red-600 shadow-red-600/60 ring-4 ring-white ring-offset-4 ring-offset-black'
              : highContrast
              ? 'bg-red-600 border-4 border-white shadow-white/20'
              : 'bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 shadow-red-900/50 ring-2 ring-red-400/40'
          } ${isAnalyzing || isBusyAsr ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {isAnalyzing || isBusyAsr ? (
            <Loader2 className="w-10 h-10 animate-spin mb-1 text-white" />
          ) : isVoiceActive ? (
            <Mic className="w-12 h-12 mb-1 animate-pulse text-white drop-shadow-md" />
          ) : (
            <Mic className="w-11 h-11 mb-1 text-white drop-shadow-md" />
          )}

          <span className="text-xs sm:text-sm font-black uppercase tracking-wider drop-shadow text-white">
            {offlineMode && !localSpeechSupported
              ? 'Voice unavailable'
              : isAnalyzing
              ? 'Analyzing...'
              : isBusyAsr
              ? busyLabel
              : isVoiceActive
              ? 'Listening'
              : 'Tap to Speak'}
          </span>
          <span className="text-[10px] font-medium text-center px-2 text-white/80">
            {offlineMode && !localSpeechSupported
              ? 'Type below if needed'
              : isVoiceActive
              ? 'Any language • pause to review'
              : isBusyAsr
              ? busySubLabel
              : 'Any language • answer on screen'}
          </span>
        </motion.button>
      </div>

      <div
        id="live-voice-caption"
        aria-live="polite"
        dir="auto"
        lang={captionLang}
        className={`mt-4 w-full max-w-xl min-h-[3.25rem] rounded-xl border px-3 py-2 text-sm leading-relaxed ${
          liveCaption
            ? 'border-red-800/80 bg-red-950/40 text-white'
            : 'border-neutral-800 bg-neutral-950/70 text-neutral-400'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">
            {isVoiceActive ? 'Hearing live' : 'Speak, don’t type'}
          </span>
          <span className="text-[10px] font-mono text-emerald-300">
            {lockedLang ? `Locked ${languageName(lockedLang)}` : `Auto • ${languageName(heardLanguage)}`}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words">
          {liveCaption || 'Tap the microphone and speak in any supported language. The answer appears on screen. Type below only if you cannot speak.'}
        </p>
      </div>

      <div
        id="voice-language-chips"
        role="group"
        aria-label="Microphone language. Auto detects any supported language."
        className="mt-2 flex gap-1.5 overflow-x-auto max-w-full px-1 pb-1"
      >
        <button
          type="button"
          onClick={() => lockLanguage(null)}
          className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
            lockedLang === null
              ? 'bg-red-600 border-red-400 text-white'
              : 'bg-neutral-900 border-neutral-700 text-neutral-300'
          }`}
        >
          Any language
        </button>
        {SUPPORTED_LANGUAGES.map((language) => (
          <button
            key={language.code}
            type="button"
            onClick={() => lockLanguage(language.code)}
            lang={getSpeechRecognitionLocale(language.code)}
            className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
              lockedLang === language.code
                ? 'bg-red-600 border-red-400 text-white'
                : 'bg-neutral-900 border-neutral-700 text-neutral-300'
            }`}
          >
            {language.nativeName}
          </button>
        ))}
      </div>

      {/* Status indicator line */}
      <div className="mt-2 text-center">
        {isBusyAsr ? (
          <div className="flex items-center gap-2 text-xs text-amber-300 font-semibold animate-pulse justify-center">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            {voicePhase === 'translating'
              ? 'Translating, then the answer appears on screen...'
              : 'Hearing your speech, then the answer appears on screen...'}
          </div>
        ) : isVoiceActive ? (
          <div className="flex items-center gap-2 text-xs text-red-400 font-semibold animate-pulse justify-center">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Listening live in {languageName(heardLanguage)}. Pause and the answer appears on screen.
          </div>
        ) : (
          <div className="text-xs text-neutral-400">
            {offlineMode && !localSpeechSupported
              ? 'Offline voice recognition is not available on this device. Type below if you need to.'
              : SHOW_TECH_DETAILS && voiceModeNotice
              ? voiceModeNotice
              : speechSupported
              ? 'Tap to speak in any language. You do not have to type. The answer appears on screen.'
              : 'This browser cannot listen. Type your emergency below, then use Speak on the answer.'}
          </div>
        )}

        {micError && (
          <div
            id="voice-mic-error"
            className="mt-2 text-xs text-amber-400 bg-amber-950/60 border border-amber-800 px-3 py-1.5 rounded-lg flex items-center justify-center gap-1.5 max-w-sm mx-auto"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{micError}</span>
          </div>
        )}

        {/* The browser's own speech engine failed. Never a dead end: offer this
            server's own transcription recorder, which does not depend on the
            browser's cloud speech service. */}
        {engineFallback === 'checking' && (
          <div className="mt-2 text-xs text-neutral-400 flex items-center justify-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Checking LifeLine's own voice transcription…</span>
          </div>
        )}
        {engineFallback === 'offered' && (
          <div className="mt-2 max-w-sm mx-auto p-2.5 rounded-lg bg-neutral-900 border border-emerald-800 text-xs">
            <p className="text-emerald-200 font-bold">
              LifeLine's own transcription is available on this server. It records here and
              transcribes on the server — no browser speech service needed.
            </p>
            <button
              id="voice-engine-fallback-btn"
              type="button"
              onClick={() => {
                syncEngineFallback('none');
                setMicError(null);
                void (async () => {
                  if (!voiceStartLockRef.current) voiceStartLockRef.current = true;
                  await startServerRecording();
                })();
              }}
              className="mt-2 w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black flex items-center justify-center gap-1.5 transition-colors"
            >
              <Mic className="w-4 h-4" />
              <span>RECORD WITH LIFELINE VOICE</span>
            </button>
          </div>
        )}
        {engineFallback === 'unavailable' && (
          <div className="mt-2 max-w-sm mx-auto text-[11px] text-neutral-400">
            Server transcription is not configured, so type the emergency below — that always works, online or offline.
          </div>
        )}
      </div>
    </div>
  );
};
