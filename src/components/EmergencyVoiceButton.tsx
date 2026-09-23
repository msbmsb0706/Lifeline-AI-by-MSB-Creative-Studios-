import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playPing } from '../lib/audio.ts';
import { getSpeechRecognitionLocale } from '../lib/languages.ts';

interface EmergencyVoiceButtonProps {
  onTranscriptChange: (transcript: string, isFinal: boolean) => void;
  onSubmitEmergency?: (text?: string) => void;
  isAnalyzing: boolean;
  offlineMode?: boolean;
  soundEnabled: boolean;
  highContrast: boolean;
  /**
   * Currently selected application language code (e.g. 'en', 'ta', 'hi').
   * Mapped to a BCP-47 Web Speech API recognizer locale so the browser voice
   * path recognizes speech in the selected language instead of forcing
   * English. Only affects the browser SpeechRecognition path — the server-side
   * MediaRecorder / NVIDIA ASR path is unchanged.
   */
  selectedLanguage?: string;
  /**
   * Multilingual fast voice path. Resolved at activation time (explicit user
   * action) so offline mode stays network-silent. Returns 'server' when the
   * server-side multilingual ASR is configured, otherwise 'browser' to use the
   * existing Web Speech API path unchanged.
   */
  onResolveVoiceMode?: () => Promise<'server' | 'browser'>;
  /** Called with base64 audio after a server-ASR recording stops. */
  onVoiceRecordingStopped?: (audioBase64: string, mimeType: string, durationMs: number) => void;
  /** Server ASR pipeline phase for UI feedback ('transcribing'/'translating'). */
  voicePhase?: 'idle' | 'listening' | 'transcribing' | 'translating';
  /** One-line explanation of why the multilingual path is (un)available. */
  voiceModeNotice?: string | null;
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

  const recognitionRef = useRef<any>(null);
  const latestTranscriptRef = useRef<string>('');

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
      // The experimental flag is the only honest browser signal that recognition is local.
      setLocalSpeechSupported((recognition as any).processLocally === true);
      // Selected-language recognizer locale. Browser SpeechRecognition uses a
      // BCP-47 tag (e.g. 'ta-IN'), not a bare language code. Whether the locale
      // is recognised locally/offline depends on the user's browser and OS.
      recognition.lang = getSpeechRecognitionLocale(selectedLanguage);

      recognition.onstart = () => {
        setIsListening(true);
        setMicError(null);
        latestTranscriptRef.current = '';
        if (soundEnabled) playPing('start');
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += text + ' ';
          } else {
            interim += text;
          }
        }

        const combined = (final + interim).trim();
        if (combined) {
          latestTranscriptRef.current = combined;
          onTranscriptChange(combined, Boolean(final));
        }
      };

      recognition.onerror = (err: any) => {
        console.warn('Speech recognition warning/error:', err.error);
        if (err.error === 'not-allowed') {
          setMicError('Microphone permission blocked. Please allow mic access.');
        } else if (err.error === 'no-speech') {
          // Normal timeout if user was silent
        } else {
          setMicError(`Voice input error: ${err.error || 'Check microphone'}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        if (soundEnabled) playPing('stop');
        // If transcript was spoken and finished, trigger emergency analysis automatically
        if (latestTranscriptRef.current.trim() && onSubmitEmergency) {
          onSubmitEmergency(latestTranscriptRef.current.trim());
        }
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.warn('Failed to initialize SpeechRecognition:', e);
      setSpeechSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [soundEnabled, selectedLanguage, onTranscriptChange, onSubmitEmergency]);

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

  const toggleRecording = async () => {
    if (isAnalyzing || isBusyAsr) return;

    // Active capture → stop it (both paths)
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      if (latestTranscriptRef.current.trim() && onSubmitEmergency) {
        onSubmitEmergency(latestTranscriptRef.current.trim());
      }
      return;
    }
    if (isServerRecording) {
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
      // Resolve the capture mode at explicit activation time.
      // Offline mode always resolves to 'browser' and never touches the network.
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
          // Permission was explicitly denied — keep the specific error and do
          // not re-prompt through the browser voice path. Lock is released in
          // the finally block below.
          return;
        }
        // 'failed' → fall through to the browser voice path
      }

      if (offlineMode && !localSpeechSupported) {
        setMicError('Offline voice recognition is not available on this device.');
        return;
      }

      if (!speechSupported) {
        setMicError('Speech recognition is not supported in this browser. Please type your emergency description.');
        return;
      }

      try {
        latestTranscriptRef.current = '';
        recognitionRef.current?.start();
      } catch (err: any) {
        console.warn('Mic start failed:', err);
        // If already active or error, reset
        try {
          recognitionRef.current?.abort();
          recognitionRef.current?.start();
        } catch {
          setMicError('Could not start microphone. You can type distress details directly.');
        }
      }
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
    ? 'English aid translation via Nemotron'
    : 'Multilingual speech recognition';

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
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleRecording}
          disabled={isAnalyzing || isBusyAsr}
          aria-label={isVoiceActive ? 'Stop recording voice' : 'Start emergency voice input'}
          className={`relative z-10 w-32 h-32 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center text-white shadow-2xl transition-all select-none ${
            isVoiceActive
              ? 'bg-red-600 shadow-red-600/60 ring-4 ring-white ring-offset-4 ring-offset-black'
              : highContrast
              ? 'bg-red-600 border-4 border-white shadow-white/20'
              : 'bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 shadow-red-900/50 ring-2 ring-red-400/40'
          } ${isAnalyzing || isBusyAsr ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {isAnalyzing ? (
            <Loader2 className="w-10 h-10 animate-spin mb-1 text-white" />
          ) : isBusyAsr ? (
            <Loader2 className="w-10 h-10 animate-spin mb-1 text-white" />
          ) : isVoiceActive ? (
            <Mic className="w-12 h-12 mb-1 animate-pulse text-white drop-shadow-md" />
          ) : (
            <Mic className="w-11 h-11 mb-1 text-white drop-shadow-md" />
          )}

          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white drop-shadow">
            {offlineMode && !localSpeechSupported
              ? 'Voice unavailable'
              : isAnalyzing
              ? 'Analyzing emergency...'
              : isBusyAsr
              ? busyLabel
              : isVoiceActive
              ? 'Listening'
              : 'Tap to Speak'}
          </span>
          <span className="text-[10px] text-white/80 font-medium">
            {offlineMode && !localSpeechSupported
              ? 'Type emergency text below'
              : isAnalyzing
              ? 'Nebius Nemotron'
              : isBusyAsr
              ? busySubLabel
              : isVoiceActive
              ? activeModeRef.current === 'server'
                ? 'Tap when finished • auto language detect'
                : 'Tap when finished'
              : 'Emergency Voice'}
          </span>
        </motion.button>
      </div>

      {/* Status indicator line */}
      <div className="mt-3 text-center">
        {isBusyAsr ? (
          <div className="flex items-center gap-2 text-xs text-amber-300 font-semibold animate-pulse justify-center">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            {voicePhase === 'translating'
              ? 'Translating your speech to English (original transcript preserved)...'
              : 'Transcribing your speech — detecting language automatically...'}
          </div>
        ) : isVoiceActive ? (
          <div className="flex items-center gap-2 text-xs text-red-400 font-semibold animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Transcribing speech live... Describe location, symptoms, or danger
          </div>
        ) : (
          <div className="text-xs text-neutral-400">
            {offlineMode && !localSpeechSupported
              ? 'Offline voice recognition is not available on this device.'
              : voiceModeNotice
              ? voiceModeNotice
              : speechSupported
              ? 'Tap the button to speak your emergency aloud'
              : 'Type your emergency details in the box below'}
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
