import React, { useState, useMemo } from 'react';
import {
  MapPin,
  Send,
  Trash2,
  Sparkles,
  Navigation,
  CheckCircle2,
  Globe,
  Languages,
  ArrowRight,
  ShieldCheck,
  Activity,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { QuickPreset, SupportedLanguageInfo, VoiceCaptureMetadata } from '../types.ts';
import { SUPPORTED_LANGUAGES, detectLanguage } from '../lib/languages.ts';
import { LocationPrivacyModal } from './LocationPrivacyModal.tsx';

interface TranscriptAreaProps {
  transcript: string;
  onTranscriptChange: (text: string) => void;
  /**
   * Submits the current transcript for triage.
   *
   * The transcript is passed explicitly and must be a string. This prop carries
   * DATA, not an event: never bind it raw (`onClick={onSubmitEmergency}`), because
   * React would then invoke it with a SyntheticEvent instead of transcript text.
   */
  onSubmitEmergency: (transcriptText: string) => void;
  onTestNebiusConnection?: () => void;
  onOfflineTest?: (text: string) => void;
  isAnalyzing: boolean;
  offlineForce: boolean;
  highContrast: boolean;
  locationInfo: string | null;
  onLocationUpdate: (loc: string, coords?: { latitude: number; longitude: number; accuracyMeters?: number; timestamp?: number }) => void;
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  nebiusConnected?: boolean;
  /** Bilingual voice capture metadata (detected language + original transcript + English translation). */
  voiceCapture?: VoiceCaptureMetadata | null;
  onDismissVoiceCapture?: () => void;
  /** Non-fatal voice pipeline notice (e.g. translation unavailable). */
  voiceNotice?: string | null;
  /** True while server ASR transcription/translation is in progress. */
  isVoiceProcessing?: boolean;
}

const EMERGENCY_PRESETS: QuickPreset[] = [
  {
    id: 'test-emergency-nebius',
    title: 'Test Nebius Emergency',
    category: 'MEDICAL',
    text: 'This is a test emergency. A person needs medical assistance.',
    icon: '🧪',
    languageCode: 'en'
  },
  {
    id: 'cardiac-en',
    title: 'Severe Chest Pain',
    category: 'MEDICAL',
    text: 'Elderly male experiencing severe crushing chest pain radiating to left arm and shortness of breath. Conscious but pale and sweating heavily.',
    icon: '❤️',
    languageCode: 'en'
  },
  {
    id: 'fire-kitchen',
    title: 'Kitchen Fire & Smoke',
    category: 'FIRE',
    text: 'Stove grease fire spreading quickly to upper cabinets and ceiling. Heavy black toxic smoke filling the hallway. Two people evacuating.',
    icon: '🔥',
    languageCode: 'en'
  },
  {
    id: 'tamil-chest-pain',
    title: 'நெஞ்சு வலி (Tamil)',
    category: 'MEDICAL',
    text: 'முதியவருக்கு கடுமையான நெஞ்சு வலி, இடது கைக்கு வலி பரவுகிறது. மூச்சுத் திணறல் அதிகமாக உள்ளது. உடனடியாக ஆம்புலன்ஸ் தேவை காப்பாத்துங்க.',
    icon: '🚑',
    languageCode: 'ta'
  },
  {
    id: 'hindi-accident',
    title: 'सड़क दुर्घटना (Hindi)',
    category: 'RESCUE',
    text: 'राजमार्ग पर दो गाड़ियों की भीषण टक्कर हुई है। एक व्यक्ति गाड़ी के अंदर बुरी तरह फंसा हुआ है और सिर से खून बह रहा है। जल्दी मदद भेजो।',
    icon: '🚗',
    languageCode: 'hi'
  },
  {
    id: 'spanish-urgencia',
    title: 'Dificultad Respirar (ES)',
    category: 'MEDICAL',
    text: 'Mi abuela no puede respirar bien, tiene dolor intenso en el pecho y labios azulados. Por favor envíen una ambulancia de urgencia.',
    icon: '⚠️',
    languageCode: 'es'
  },
  {
    id: 'water-crisis',
    title: 'Water Shortage / Drought',
    category: 'WATER',
    text: 'Flood destroyed drinking water pipeline. Village has zero clean potable drinking water for 3 days. Severe dehydration and infant fever starting.',
    icon: '💧',
    languageCode: 'en'
  },
  {
    id: 'missing-child',
    title: 'Missing Child Search',
    category: 'MISSING_PERSON',
    text: '7-year-old child wearing yellow rain jacket missing in dense storm park since 1 hour ago. Urgent search and rescue tracking required.',
    icon: '🔍',
    languageCode: 'en'
  }
];

export const TranscriptArea: React.FC<TranscriptAreaProps> = ({
  transcript,
  onTranscriptChange,
  onSubmitEmergency,
  onTestNebiusConnection,
  onOfflineTest,
  isAnalyzing,
  offlineForce,
  highContrast,
  locationInfo,
  onLocationUpdate,
  selectedLanguage,
  onLanguageChange,
  nebiusConnected = false,
  voiceCapture = null,
  onDismissVoiceCapture,
  voiceNotice = null,
  isVoiceProcessing = false
}) => {
  const [isLocating, setIsLocating] = useState(false);
  const [locationSuccess, setLocationSuccess] = useState(false);
  const [locationPrivacyConfirmed, setLocationPrivacyConfirmed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('lifeline_location_privacy_confirmed') === 'true';
    } catch {
      return false;
    }
  });
  const [showLocationPrivacyModal, setShowLocationPrivacyModal] = useState(false);

  // Real-time automatic language detection
  const detectedLanguage = useMemo(() => {
    return detectLanguage(transcript);
  }, [transcript]);

  const executeGetLocation = () => {
    if (!navigator.geolocation) {
      onLocationUpdate('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = pos.coords.latitude.toFixed(5);
        const lng = pos.coords.longitude.toFixed(5);
        const acc = Math.round(pos.coords.accuracy);
        const locStr = `GPS ${lat}, ${lng} (±${acc}m accuracy)`;
        onLocationUpdate(locStr, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
          timestamp: pos.timestamp
        });
        setLocationSuccess(true);
      },
      (err) => {
        setIsLocating(false);
        console.warn('Geolocation error:', err.message);
        onLocationUpdate('Location access denied by user/browser');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleGetLocation = () => {
    // Privacy & Safety requirement: Display a concise privacy notice before the first location-sharing action
    if (!locationPrivacyConfirmed) {
      setShowLocationPrivacyModal(true);
      return;
    }
    executeGetLocation();
  };

  const handleConfirmLocationPrivacy = () => {
    setLocationPrivacyConfirmed(true);
    try {
      sessionStorage.setItem('lifeline_location_privacy_confirmed', 'true');
    } catch {
      // ignore
    }
    setShowLocationPrivacyModal(false);
    executeGetLocation();
  };

  const handlePresetClick = (preset: QuickPreset) => {
    onTranscriptChange(preset.text);
    // If clicking a preset, let user review or submit
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      if (transcript.trim() && !isAnalyzing) {
        // Explicit string argument — never hand the keyboard event to the triage handler.
        onSubmitEmergency(transcript);
      }
    }
  };

  return (
    <div
      id="transcript-section"
      className={`rounded-2xl border p-3.5 sm:p-5 transition-all ${
        highContrast
          ? 'bg-neutral-900 border-white text-white'
          : 'bg-neutral-900/70 border-neutral-800 text-neutral-100 shadow-xl'
      }`}
    >
      {/* Header bar of transcript box */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="emergency-transcript-input"
            className="text-xs sm:text-sm font-bold text-neutral-200 flex items-center gap-1.5"
          >
            <span>Emergency Distress Transcript & Details</span>
          </label>
          {transcript && (
            <span className="text-[10px] font-mono text-neutral-400">
              ({transcript.length} chars)
            </span>
          )}
        </div>

        {/* Real-time Detected Source Language Badge */}
        {transcript.trim() && (
          <div
            id="detected-language-badge"
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-700/80 text-[11px] text-emerald-300 font-medium"
            title="Auto-detected input source language"
          >
            <Globe className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>Detected:</span>
            <span className="font-bold text-white">
              {detectedLanguage.name} ({detectedLanguage.code.toUpperCase()})
            </span>
          </div>
        )}

        {/* Clear button */}
        {transcript && (
          <button
            id="clear-transcript-btn"
            onClick={() => onTranscriptChange('')}
            disabled={isAnalyzing}
            className="text-[11px] text-neutral-400 hover:text-red-400 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-neutral-800"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Main Textarea */}
      <div className="relative">
        <textarea
          id="emergency-transcript-input"
          value={transcript}
          onChange={(e) => onTranscriptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Speak into microphone or describe the emergency in any language (English, தமிழ், हिन्दी, తెలుగు, ಕನ್ನಡ, മലയാളം, বাংলা, मराठी, Español, Français)..."
          rows={4}
          disabled={isAnalyzing}
          className={`w-full text-sm sm:text-base p-3 sm:p-3.5 rounded-xl border transition-all resize-none outline-none leading-relaxed ${
            highContrast
              ? 'bg-black text-white border-2 border-white focus:border-red-500'
              : 'bg-neutral-950/90 text-neutral-100 border-neutral-700/80 focus:border-red-500 focus:ring-1 focus:ring-red-500'
          }`}
        />
      </div>

      {/* Bilingual voice capture panel — original transcript is authoritative */}
      {voiceCapture && (
        <div
          id="bilingual-transcript-panel"
          className="mt-3 rounded-xl border border-emerald-800/70 bg-emerald-950/30 p-3 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              id="voice-detected-language-label"
              className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-emerald-300"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                Detected language: <span className="text-white">{voiceCapture.detectedLanguage.name}</span>{' '}
                <span className="font-mono text-[10px] text-emerald-400">
                  ({voiceCapture.detectedLanguage.code.toUpperCase()})
                  {typeof voiceCapture.detectedLanguage.confidence === 'number'
                    ? ` • ${Math.round(voiceCapture.detectedLanguage.confidence * 100)}%`
                    : ''}
                </span>
              </span>
              <span
                className="text-[9px] font-mono text-emerald-300/90 px-1.5 py-0.5 rounded bg-emerald-900/60 border border-emerald-800"
                title="Speech recognition source"
              >
                {voiceCapture.asrProvider === 'browser' ? 'Browser voice' : voiceCapture.asrModel}
              </span>
            </div>
            {onDismissVoiceCapture && (
              <button
                id="dismiss-voice-capture-btn"
                onClick={onDismissVoiceCapture}
                className="text-[10px] text-neutral-400 hover:text-neutral-200 underline underline-offset-2 shrink-0"
                title="Dismiss bilingual transcript panel"
              >
                Dismiss
              </button>
            )}
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">
              Original ({voiceCapture.detectedLanguage.name})
            </div>
            <p
              id="voice-original-transcript"
              dir="auto"
              className="text-sm text-neutral-100 whitespace-pre-wrap break-words leading-relaxed"
            >
              {voiceCapture.originalTranscript}
            </p>
          </div>

          {voiceCapture.englishTranslation && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">
                English <span className="normal-case font-medium text-neutral-500">(machine translation — aid only)</span>
              </div>
              <p
                id="voice-english-translation"
                dir="auto"
                className="text-sm text-neutral-200 whitespace-pre-wrap break-words leading-relaxed"
              >
                {voiceCapture.englishTranslation}
              </p>
            </div>
          )}

          {voiceCapture.translationFailed && voiceCapture.detectedLanguage.code !== 'en' && (
            <div
              id="voice-translation-unavailable-note"
              className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-800/70 rounded-lg px-2.5 py-1.5"
            >
              English translation unavailable — the original-language transcript above is preserved and can still be
              triaged.
            </div>
          )}
        </div>
      )}

      {/* Voice pipeline notice (retry / fallback guidance) */}
      {voiceNotice && !voiceCapture?.translationFailed && (
        <div
          id="voice-pipeline-notice"
          className="mt-2.5 text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/70 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{voiceNotice}</span>
        </div>
      )}

      {/* Location tagger & Target Language Selection Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mt-2.5 pt-2 border-t border-neutral-800/80 text-xs">
        {/* GPS location button */}
        <div className="flex items-center gap-1.5">
          <button
            id="attach-gps-location-btn"
            onClick={handleGetLocation}
            disabled={isLocating || isAnalyzing}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              locationSuccess
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700 text-neutral-300'
            }`}
          >
            {isLocating ? (
              <>
                <Navigation className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>Locating GPS...</span>
              </>
            ) : locationSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>GPS Attached</span>
              </>
            ) : (
              <>
                <MapPin className="w-3.5 h-3.5 text-red-400" />
                <span>Attach GPS</span>
              </>
            )}
          </button>

          {!locationSuccess && (
            <button
              type="button"
              onClick={() => setShowLocationPrivacyModal(true)}
              className="text-[10px] text-neutral-400 hover:text-neutral-300 underline underline-offset-2 hidden xs:inline"
              title="Location privacy notice: location is never collected or shared without permission"
            >
              Privacy Notice
            </button>
          )}

          {locationInfo && (
            <span className="text-[11px] text-neutral-400 font-mono truncate max-w-[180px] sm:max-w-xs" title={locationInfo}>
              {locationInfo}
            </span>
          )}
        </div>

        {/* Target Translation Language Selector */}
        <div className="flex items-center gap-1.5 ml-auto">
          <Languages className="w-3.5 h-3.5 text-red-400" />
          <span className="text-[11px] font-bold text-neutral-300 hidden xs:inline">
            Target Language:
          </span>
          <select
            id="target-emergency-language-select"
            value={selectedLanguage}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={isAnalyzing}
            className="bg-neutral-800 text-neutral-100 font-medium text-xs rounded-lg px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-600 outline-none cursor-pointer focus:ring-1 focus:ring-red-500"
          >
            <optgroup label="International">
              {SUPPORTED_LANGUAGES.filter(l => !l.isIndianRegional).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.nativeName})
                </option>
              ))}
            </optgroup>
            <optgroup label="Indian Regional Languages">
              {SUPPORTED_LANGUAGES.filter(l => l.isIndianRegional).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName} ({l.name})
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* Local deterministic verification tests */}
      {offlineForce && onOfflineTest && (
        <div className="mt-3.5 pt-3 border-t border-amber-800/70">
          <div className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider mb-2">Offline Test — runs on this device</div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onOfflineTest('A person is unconscious and needs an ambulance immediately.')} disabled={isAnalyzing}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900 text-amber-200 border border-amber-700 font-semibold">
              Test: unconscious + ambulance
            </button>
            <button type="button" onClick={() => onOfflineTest('There is a fire inside the building and people are trapped.')} disabled={isAnalyzing}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900 text-amber-200 border border-amber-700 font-semibold">
              Test: fire + trapped
            </button>
          </div>
        </div>
      )}

      {/* Multilingual Quick Emergency Scenarios */}
      <div className="mt-3.5 pt-3 border-t border-neutral-800/80">
        <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-red-400" />
            <span>Multilingual Distress Scenarios (Tap to Test Auto-Detection)</span>
          </div>
          <div className="flex items-center gap-2">
            {nebiusConnected && (
              <span
                id="nebius-transcript-connected-indicator"
                className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-600"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                Nebius • Nemotron Connected
              </span>
            )}
            <span className="text-[10px] text-neutral-500 font-mono">10 Languages</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EMERGENCY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              id={`preset-${preset.id}`}
              onClick={() => handlePresetClick(preset)}
              disabled={isAnalyzing}
              className="text-xs px-2.5 py-1 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700 flex items-center gap-1.5 transition-all active:scale-95"
            >
              <span>{preset.icon}</span>
              <span>{preset.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Active Analysis Loading State Bar */}
      {(isAnalyzing || isVoiceProcessing) && (
        <div
          id="nebius-triage-loading-indicator"
          className="mt-3 p-3 rounded-xl bg-neutral-900 border border-red-500/60 flex items-center gap-3 animate-pulse"
        >
          <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span>
                {isVoiceProcessing && !isAnalyzing
                  ? 'Multilingual Voice Transcription In Progress...'
                  : offlineForce
                  ? 'Deterministic Local Engine Processing...'
                  : 'Nebius Token Factory Analysis In Progress...'}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-800">
                {isVoiceProcessing && !isAnalyzing ? 'ASR' : offlineForce ? 'OFFLINE' : 'LIVE API'}
              </span>
            </div>
            <div className="text-[11px] text-neutral-400 truncate">
              {isVoiceProcessing && !isAnalyzing
                ? 'Transcribing speech and detecting the spoken language — the original transcript will be preserved...'
                : offlineForce
                ? 'Processing distress transcript with zero-network deterministic triage rules...'
                : 'Streaming transcript to Nemotron backend for structured JSON triage & needs extraction...'}
            </div>
          </div>
        </div>
      )}

      {/* Primary Triage Trigger Button */}
      <div className="mt-4">
        <button
          id="submit-emergency-analysis-btn"
          // Wrapped deliberately: binding the prop directly would hand React's
          // SyntheticEvent to the triage handler instead of the transcript string.
          onClick={() => onSubmitEmergency(transcript)}
          disabled={!transcript.trim() || isAnalyzing}
          className={`w-full py-3.5 px-4 rounded-xl font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg transition-all ${
            !transcript.trim() || isAnalyzing
              ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
              : highContrast
              ? 'bg-white text-black hover:bg-neutral-200 border-2 border-white'
              : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/40 active:scale-[0.99]'
          }`}
        >
          <Send className="w-4 h-4 sm:w-5 sm:h-5" />
          <span>
            {isAnalyzing
              ? offlineForce
                ? 'Running Deterministic Offline Engine...'
                : 'Connecting to Nebius Token Factory (Nemotron)...'
              : offlineForce
              ? 'Run Deterministic Offline Triage & Translation'
              : 'Triage Distress & Generate SOS Card'}
          </span>
          {!isAnalyzing && <ArrowRight className="w-4 h-4 text-white/70 ml-1" />}
        </button>
        <div className="text-[11px] text-center text-neutral-400 mt-1.5">
          Tip: Press <kbd className="px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300 font-mono text-[10px]">Ctrl + Enter</kbd> to triage
        </div>
      </div>

      {/* Location Privacy Modal */}
      <LocationPrivacyModal
        isOpen={showLocationPrivacyModal}
        onConfirm={handleConfirmLocationPrivacy}
        onCancel={() => setShowLocationPrivacyModal(false)}
      />
    </div>
  );
};
