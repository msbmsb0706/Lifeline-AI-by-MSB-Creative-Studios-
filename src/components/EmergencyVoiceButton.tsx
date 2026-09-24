import React, { useEffect, useRef, useState } from 'react';
import { Mic, AlertCircle, Loader2, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playPing } from '../lib/audio.ts';
import { getSpeechRecognitionLocale, SUPPORTED_LANGUAGES } from '../lib/languages.ts';
import {
  pickStartLanguage,
  primeSpeechEngine,
  shouldSwitchRecognitionLanguage,
  stopSpeaking
} from '../lib/speech.ts';
import { mergeFinalChunk, speechErrorMessage } from '../lib/speechCapture.ts';
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
  /** True while the spoken emergency answer is playing. Tap stops it. */
  isSpeakingAnswer?: boolean;
  /** Parent clears its speaking flag when the person stops playback. */
  onCancelSpeech?: () => void;
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
  voiceModeNotice,
  isSpeakingAnswer = false,
  onCancelSpeech
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
  const restartCountRef = useRef(0);
  const silenceTimerRef = useRef<number | null>(null);
  const browserCapTimerRef = useRef<number | null>(null);
  // A tap that arrived while Chrome was still closing the previous session.
  const pendingStartRef = useRef(false);
  const startBrowserSessionRef = useRef<(() => void) | null>(null);

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
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (browserCapTimerRef.current !== null) {
      window.clearTimeout(browserCapTimerRef.current);
      browserCapTimerRef.current = null;
    }
  };

  const submitOnce = () => {
    if (submittedRef.current) return;
    const text = (liveTextRef.current || committedRef.current).trim();
    if (!text || !onSubmitEmergencyRef.current) return;
    submittedRef.current = true;
    onSubmitEmergencyRef.current(text);
  };

  const finishBrowserSession = () => {
    clearBrowserTimers();
    userStopRef.current = true;
    sessionActiveRef.current = false;
    if (liveTextRef.current.trim()) committedRef.current = liveTextRef.current.trim();
    try {
      if (recognitionRef.current) recognitionRef.current.stop();
    } catch {
      setIsListening(false);
      if (soundEnabledRef.current) playPing('stop');
      submitOnce();
    }
    // Some browsers never fire onend after stop(). Don't leave the answer unsaid.
    window.setTimeout(() => {
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
        setIsListening(true);
        setMicError(null);
        restartCountRef.current = 0;
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalChunk += text + ' ';
          else interim += text;
        }
        if (finalChunk.trim()) {
          committedRef.current = mergeFinalChunk(committedRef.current, finalChunk);
        }
        const live = `${committedRef.current} ${interim}`.trim();
        liveTextRef.current = live;
        if (live) {
          setLiveCaption(live);
          onTranscriptChangeRef.current(live, Boolean(finalChunk.trim()));
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
        console.warn('Speech recognition warning/error:', err.error);
        if (err.error === 'not-allowed' || err.error === 'service-not-allowed') {
          sessionActiveRef.current = false;
          userStopRef.current = true;
          setMicError('Microphone permission blocked. Please allow mic access, or type below.');
          setIsListening(false);
        } else {
          // no-speech / aborted are normal (silence, our own restart/stop).
          const message = speechErrorMessage(err.error);
          if (message) setMicError(message);
          if (err.error === 'audio-capture' || err.error === 'language-not-supported') {
            sessionActiveRef.current = false;
            userStopRef.current = true;
          }
        }
      };

      recognition.onend = () => {
        // Chrome/Android may end at its speech end-point with only interim
        // text. Promote it so a restart or submit never loses what was heard.
        if (liveTextRef.current.trim()) committedRef.current = liveTextRef.current.trim();
        if (pendingStartRef.current) {
          // A new tap arrived while the old session was closing: start clean now.
          pendingStartRef.current = false;
          setIsListening(false);
          window.setTimeout(() => startBrowserSessionRef.current?.(), 0);
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
          try {
            recognition.lang = getSpeechRecognitionLocale(activeLangRef.current);
            recognition.start();
          } catch {
            // The next tap can start a fresh session.
          }
          return;
        }
        if (restartCountRef.current >= 6) {
          userStopRef.current = true;
          sessionActiveRef.current = false;
          setIsListening(false);
          setMicError('Listening paused. Tap the microphone to speak again.');
          submitOnce();
          return;
        }
        restartCountRef.current += 1;
        window.setTimeout(() => {
          if (!sessionActiveRef.current || userStopRef.current) return;
          try {
            recognition.lang = getSpeechRecognitionLocale(activeLangRef.current);
            recognition.start();
          } catch {
            // ignore
          }
        }, 150);
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.warn('Failed to initialize SpeechRecognition:', e);
      setSpeechSupported(false);
    }

    return () => {
      sessionActiveRef.current = false;
      userStopRef.current = true;
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

  const startBrowserSession = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setMicError('Speech recognition is not supported in this browser. Please type your emergency description.');
      return;
    }
    stopSpeaking();
    onCancelSpeech?.();
    userStopRef.current = false;
    submittedRef.current = false;
    sessionActiveRef.current = true;
    restartForLangRef.current = false;
    autoSwitchedRef.current = false;
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
    // Unlock spoken answers in this tap, then listen. Do not speak while the mic is open.
    if (soundEnabledRef.current) primeSpeechEngine();
    recognition.lang = getSpeechRecognitionLocale(startCode);
    if (soundEnabledRef.current) playPing('start');
    try {
      recognition.start();
    } catch (err: any) {
      if (err?.name === 'InvalidStateError') {
        // Previous session still closing — restart from its onend.
        pendingStartRef.current = true;
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        return;
      }
      console.warn('Mic start failed:', err);
      sessionActiveRef.current = false;
      setMicError('Could not start microphone. You can type distress details directly.');
      return;
    }
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
    if (isSpeakingAnswer) {
      stopSpeaking();
      onCancelSpeech?.();
      return;
    }
    if (isAnalyzing || isBusyAsr) return;

    // Active capture → stop it and speak the answer (parent handles speech).
    if (isListening || sessionActiveRef.current) {
      finishBrowserSession();
      return;
    }
    if (isServerRecording || isServerRecordingRef.current) {
      stopServerRecording();
      return;
    }

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
      // active server recording (browser voice, permission denial, failures).
      if (!isServerRecordingRef.current) {
        voiceStartLockRef.current = false;
      }
    }
  };

  const busyLabel = voicePhase === 'translating' ? 'Translating…' : 'Transcribing…';
  const busySubLabel = voicePhase === 'translating'
    ? 'Then the answer is spoken'
    : 'Then the answer is spoken';
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
            isSpeakingAnswer
              ? 'Stop speaking the answer'
              : isVoiceActive
              ? 'Stop listening and hear the spoken answer'
              : 'Speak your emergency in any language. The answer is spoken aloud.'
          }
          className={`relative z-10 w-32 h-32 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center text-white shadow-2xl transition-all select-none ${
            isVoiceActive
              ? 'bg-red-600 shadow-red-600/60 ring-4 ring-white ring-offset-4 ring-offset-black'
              : isSpeakingAnswer
              ? 'bg-amber-500 text-black shadow-amber-500/40 ring-4 ring-white ring-offset-4 ring-offset-black'
              : highContrast
              ? 'bg-red-600 border-4 border-white shadow-white/20'
              : 'bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 shadow-red-900/50 ring-2 ring-red-400/40'
          } ${isAnalyzing || isBusyAsr ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {isAnalyzing || isBusyAsr ? (
            <Loader2 className="w-10 h-10 animate-spin mb-1 text-white" />
          ) : isSpeakingAnswer ? (
            <Volume2 className="w-12 h-12 mb-1 animate-pulse text-black drop-shadow-md" />
          ) : isVoiceActive ? (
            <Mic className="w-12 h-12 mb-1 animate-pulse text-white drop-shadow-md" />
          ) : (
            <Mic className="w-11 h-11 mb-1 text-white drop-shadow-md" />
          )}

          <span className={`text-xs sm:text-sm font-black uppercase tracking-wider drop-shadow ${isSpeakingAnswer ? 'text-black' : 'text-white'}`}>
            {offlineMode && !localSpeechSupported
              ? 'Voice unavailable'
              : isAnalyzing
              ? 'Analyzing...'
              : isBusyAsr
              ? busyLabel
              : isSpeakingAnswer
              ? 'Speaking'
              : isVoiceActive
              ? 'Listening'
              : 'Tap to Speak'}
          </span>
          <span className={`text-[10px] font-medium text-center px-2 ${isSpeakingAnswer ? 'text-black/80' : 'text-white/80'}`}>
            {offlineMode && !localSpeechSupported
              ? 'Type below if needed'
              : isSpeakingAnswer
              ? 'Tap to stop'
              : isVoiceActive
              ? 'Any language • pause to hear'
              : isBusyAsr
              ? busySubLabel
              : 'Any language • spoken answer'}
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
            {isVoiceActive ? 'Hearing live' : isSpeakingAnswer ? 'Speaking answer' : 'Speak, don’t type'}
          </span>
          <span className="text-[10px] font-mono text-emerald-300">
            {lockedLang ? `Locked ${languageName(lockedLang)}` : `Auto • ${languageName(heardLanguage)}`}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words">
          {liveCaption || 'Tap the microphone and speak in any supported language. The answer is spoken aloud. Type below only if you cannot speak.'}
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
              ? 'Translating, then speaking the answer...'
              : 'Hearing your speech, then speaking the answer...'}
          </div>
        ) : isSpeakingAnswer ? (
          <div className="flex items-center gap-2 text-xs text-amber-300 font-semibold justify-center">
            <Volume2 className="w-3.5 h-3.5" />
            Speaking the emergency answer aloud
          </div>
        ) : isVoiceActive ? (
          <div className="flex items-center gap-2 text-xs text-red-400 font-semibold animate-pulse justify-center">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Listening live in {languageName(heardLanguage)}. Pause and the answer is spoken.
          </div>
        ) : (
          <div className="text-xs text-neutral-400">
            {offlineMode && !localSpeechSupported
              ? 'Offline voice recognition is not available on this device. Type below if you need to.'
              : SHOW_TECH_DETAILS && voiceModeNotice
              ? voiceModeNotice
              : speechSupported
              ? 'Tap to speak in any language. You do not have to type. The answer is spoken back.'
              : 'This browser cannot listen. Type your emergency below, then use Speak on the answer.'}
          </div>
        )}

        {micError && (
          <div className="mt-2 text-xs text-amber-400 bg-amber-950/60 border border-amber-800 px-3 py-1.5 rounded-lg flex items-center justify-center gap-1.5 max-w-sm mx-auto">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{micError}</span>
          </div>
        )}
      </div>
    </div>
  );
};
