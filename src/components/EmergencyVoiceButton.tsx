import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playPing } from '../lib/audio.ts';

interface EmergencyVoiceButtonProps {
  onTranscriptChange: (transcript: string, isFinal: boolean) => void;
  onSubmitEmergency?: (text?: string) => void;
  isAnalyzing: boolean;
  offlineMode?: boolean;
  soundEnabled: boolean;
  highContrast: boolean;
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

export const EmergencyVoiceButton: React.FC<EmergencyVoiceButtonProps> = ({
  onTranscriptChange,
  onSubmitEmergency,
  isAnalyzing,
  offlineMode = false,
  soundEnabled,
  highContrast
}) => {
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [localSpeechSupported, setLocalSpeechSupported] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const latestTranscriptRef = useRef<string>('');

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
      recognition.lang = 'en-US';

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
  }, [soundEnabled, onTranscriptChange, onSubmitEmergency]);

  const toggleRecording = () => {
    if (offlineMode && !localSpeechSupported) {
      setMicError('Offline voice recognition is not available on this device.');
      return;
    }
    if (isAnalyzing) return;

    if (!speechSupported) {
      setMicError('Speech recognition is not supported in this browser. Please type your emergency description.');
      return;
    }

    setMicError(null);

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
    } else {
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
    }
  };

  return (
    <div id="emergency-voice-section" className="flex flex-col items-center justify-center my-4 sm:my-6">
      {/* Large tactile push button container */}
      <div className="relative flex items-center justify-center">
        {/* Animated Soundwave Pulse Rings when Listening */}
        <AnimatePresence>
          {isListening && (
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
          disabled={isAnalyzing}
          aria-label={isListening ? 'Stop recording voice' : 'Start emergency voice input'}
          className={`relative z-10 w-32 h-32 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center text-white shadow-2xl transition-all select-none ${
            isListening
              ? 'bg-red-600 shadow-red-600/60 ring-4 ring-white ring-offset-4 ring-offset-black'
              : highContrast
              ? 'bg-red-600 border-4 border-white shadow-white/20'
              : 'bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 shadow-red-900/50 ring-2 ring-red-400/40'
          } ${isAnalyzing ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {isAnalyzing ? (
            <Loader2 className="w-10 h-10 animate-spin mb-1 text-white" />
          ) : isListening ? (
            <Mic className="w-12 h-12 mb-1 animate-pulse text-white drop-shadow-md" />
          ) : (
            <Mic className="w-11 h-11 mb-1 text-white drop-shadow-md" />
          )}

          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white drop-shadow">
            {offlineMode && !localSpeechSupported ? 'Voice unavailable' : isAnalyzing ? 'Analyzing emergency...' : isListening ? 'Listening' : 'Tap to Speak'}
          </span>
          <span className="text-[10px] text-white/80 font-medium">
            {offlineMode && !localSpeechSupported ? 'Type emergency text below' : isAnalyzing ? 'Nebius Nemotron' : isListening ? 'Tap when finished' : 'Emergency Voice'}
          </span>
        </motion.button>
      </div>

      {/* Status indicator line */}
      <div className="mt-3 text-center">
        {isListening ? (
          <div className="flex items-center gap-2 text-xs text-red-400 font-semibold animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            Transcribing speech live... Describe location, symptoms, or danger
          </div>
        ) : (
          <div className="text-xs text-neutral-400">
            {offlineMode && !localSpeechSupported ? 'Offline voice recognition is not available on this device.' : speechSupported ? 'Tap the button to speak your emergency aloud' : 'Type your emergency details in the box below'}
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
