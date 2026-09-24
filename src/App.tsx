import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.tsx';
import { EmergencyVoiceButton } from './components/EmergencyVoiceButton.tsx';
import { TranscriptArea } from './components/TranscriptArea.tsx';
import { SOSCardView } from './components/SOSCardView.tsx';
import { SplashScreen } from './components/SplashScreen.tsx';
import { PrivacySafetyModal } from './components/PrivacySafetyModal.tsx';
import { PrivacyContactFormModal } from './components/PrivacyContactFormModal.tsx';
import { SilentSOS } from './components/SilentSOS.tsx';
import { EmergencyPartnersManagerModal } from './components/EmergencyPartnersManagerModal.tsx';
import {
  EmergencyAnalysisResult,
  SystemStatus,
  TranslatedSOS,
  VoiceCaptureMetadata,
  DetectedLanguage
} from './types.ts';
import { classifyEmergencyOffline } from './lib/offlineClassifier.ts';

import { translateEmergencyOffline, detectLanguage } from './lib/languages.ts';
import { selectTranslationSource, validateTranslatedMessage } from './lib/translationSafety.ts';
import {
  getPendingQueue,
  subscribeToQueue,
  SOS_DELIVERY_STATUS_META
} from './lib/emergencyPartnerQueue.ts';
import { playPing } from './lib/audio.ts';
import { getCountryEmergencyNumber, getSelectedCountry } from './lib/emergencyNumbers.ts';
import { buildSpokenEmergencyBrief, speakText, stopSpeaking } from './lib/speech.ts';
import { checkOfflineShellReady } from './lib/offlineShell.ts';
import { attemptOnlineTriage } from './lib/onlineTriage.ts';
import { AlertOctagon, PhoneCall, History, Trash2, ShieldCheck, Lock, Shield, Clock, Send, Mail } from 'lucide-react';

/** Keep a weak/failed online AI connection from blocking an on-device SOS. */
const ONLINE_ANALYZE_TIMEOUT_MS = 4000;

export default function App() {
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);
  const [showPrivacyContactForm, setShowPrivacyContactForm] = useState<boolean>(false);
  const [showPartnersModal, setShowPartnersModal] = useState<boolean>(false);
  const [showSilentSOS, setShowSilentSOS] = useState<boolean>(false);
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);
  const [transcript, setTranscript] = useState('');
  const [locationInfo, setLocationInfo] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number; accuracyMeters?: number } | null>(null);
  // Remember the user-selected offline mode across reloads / battery restarts.
  // Only the preference is stored here, never an emergency transcript.
  const [offlineForce, setOfflineForce] = useState<boolean>(() => {
    try { return localStorage.getItem('lifeline_force_offline') === 'true'; }
    catch { return false; }
  });
  const [networkAvailable, setNetworkAvailable] = useState<boolean>(() => navigator.onLine);
  const [offlineShellReady, setOfflineShellReady] = useState<boolean | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<EmergencyAnalysisResult | null>(null);
  const [recentReports, setRecentReports] = useState<EmergencyAnalysisResult[]>([]);
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [nebiusConnected, setNebiusConnected] = useState<boolean>(false);

  // Multilingual fast voice (server ASR) state. Audio is captured only after the
  // user explicitly activates the voice button and is held transiently in memory.
  const [asrPhase, setAsrPhase] = useState<'idle' | 'listening' | 'transcribing' | 'translating'>('idle');
  const [voiceCapture, setVoiceCapture] = useState<VoiceCaptureMetadata | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [asrConfigured, setAsrConfigured] = useState<boolean | null>(null);
  const [isSpeakingAnswer, setIsSpeakingAnswer] = useState(false);
  const asrProbeRef = useRef<{ at: number; configured: boolean } | null>(null);
  const voiceOriginRef = useRef(false);
  const voiceCaptureRef = useRef<VoiceCaptureMetadata | null>(null);
  const pendingVoiceTextRef = useRef<string | null>(null);
  const analyzeRef = useRef<(text?: string) => void>(() => undefined);
  const [voiceSubmitTick, setVoiceSubmitTick] = useState(0);
  voiceCaptureRef.current = voiceCapture;

  /**
   * Resolved at explicit voice-button activation so Offline/Resilience mode stays
   * completely network-silent (offline always returns 'browser' without any fetch).
   */
  const resolveVoiceMode = useCallback(async (): Promise<'server' | 'browser'> => {
    if (offlineForce || !navigator.onLine) return 'browser';
    const now = Date.now();
    if (asrProbeRef.current && now - asrProbeRef.current.at < 5 * 60 * 1000) {
      return asrProbeRef.current.configured ? 'server' : 'browser';
    }
    try {
      const res = await fetch('/api/status');
      const json = await res.json().catch(() => ({}));
      const configured = Boolean(json?.asr?.configured);
      asrProbeRef.current = { at: now, configured };
      setAsrConfigured(configured);
      return configured ? 'server' : 'browser';
    } catch {
      asrProbeRef.current = { at: now, configured: false };
      setAsrConfigured(false);
      return 'browser';
    }
  }, [offlineForce]);

  const voiceModeNotice = !offlineForce && asrConfigured === false
    ? 'Live microphone speaks answers in any supported language. Browser voice follows what you speak, not a typed box.'
    : null;

  /**
   * Server multilingual ASR pipeline: transcribe → preserve original transcript →
   * English aid translation via Nemotron. Failures never fabricate results and
   * never discard the original transcript.
   */
  const handleVoiceRecordingStopped = useCallback(async (audioBase64: string, mimeType: string, durationMs: number) => {
    if (offlineForce || !navigator.onLine) {
      setAsrPhase('idle');
      setVoiceNotice('Offline voice upload unavailable — type the emergency instead. No recording was uploaded.');
      return;
    }
    setError(null);
    setVoiceNotice(null);
    setAsrPhase('transcribing');
    try {
      const res = await fetch('/api/transcribe-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType, durationMs })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.data?.transcript) {
        throw new Error(json.error || `Speech transcription failed (HTTP ${res.status}).`);
      }

      const data = json.data;
      const detected: DetectedLanguage = data.detected_language || detectLanguage(data.transcript);
      const capture: VoiceCaptureMetadata = {
        asrProvider: data.asr_provider || 'server',
        asrModel: data.asr_model || 'unknown',
        detectedLanguage: detected,
        originalTranscript: data.transcript,
        durationMs: typeof data.duration_ms === 'number' ? data.duration_ms : durationMs,
        timestamp: new Date().toISOString()
      };

      // Original-language transcript is preserved, then spoken triage starts
      // immediately — do not wait for an English aid translation, and do not
      // leave the person with only a typed box.
      voiceOriginRef.current = true;
      voiceCaptureRef.current = capture;
      setTranscript(data.transcript);
      setVoiceCapture(capture);
      pendingVoiceTextRef.current = data.transcript;
      setVoiceSubmitTick((tick) => tick + 1);

      if (detected.code === 'en') {
        // English speech needs no English aid translation.
        setAsrPhase('idle');
        return;
      }

      setAsrPhase('translating');
      try {
        const tRes = await fetch('/api/translate-to-english', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: data.transcript, sourceLanguage: detected.name })
        });
        const tJson = await tRes.json().catch(() => ({}));
        if (!tRes.ok || !tJson.success || !tJson.data?.english_translation) {
          throw new Error(tJson.error || `English translation failed (HTTP ${tRes.status}).`);
        }
        const enriched: VoiceCaptureMetadata = {
          ...capture,
          englishTranslation: tJson.data.english_translation,
          translationFailed: false
        };
        voiceCaptureRef.current = enriched;
        setVoiceCapture(enriched);
      } catch (tErr: any) {
        console.warn('English translation failed; preserving original transcript:', tErr);
        const failed: VoiceCaptureMetadata = { ...capture, translationFailed: true };
        voiceCaptureRef.current = failed;
        setVoiceCapture(failed);
        setVoiceNotice('English translation unavailable — the original-language transcript is preserved and can still be triaged.');
      } finally {
        setAsrPhase('idle');
      }
    } catch (err: any) {
      console.error('Voice transcription failed:', err);
      setAsrPhase('idle');
      setVoiceNotice(err?.message || 'Speech transcription failed. Tap the microphone to retry, use browser voice, or type the emergency.');
      // Any previously captured transcript is intentionally preserved.
    }
  }, [offlineForce]);

  // Refresh pending queue count ("pending" = not yet handed off — terminal
  // SENT / DELIVERED / ACKNOWLEDGED records stay stored but are not pending).
  const refreshPendingQueue = useCallback(() => {
    const queue = getPendingQueue();
    const unsent = queue.filter((i) => !SOS_DELIVERY_STATUS_META[i.status]?.terminal);
    setPendingQueueCount(unsent.length);
  }, []);

  // Re-read locally saved SOS records after restart and on network changes.
  // Never send on startup, reconnect, focus, a timer, or after battery recovery.
  // A fresh user action is required to share. New code ignores the legacy
  // preference; force it OFF too, for any older tab still open on this device.
  useEffect(() => {
    try { localStorage.setItem('lifeline_autosend_pending_sos', 'false'); }
    catch { /* older tabs may remain active; storage could be unavailable */ }
    refreshPendingQueue(); // also recovers interrupted SENDING records, without uploading
    const handleOnline = () => { setNetworkAvailable(true); refreshPendingQueue(); };
    const handleOffline = () => { setNetworkAvailable(false); refreshPendingQueue(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubscribe = subscribeToQueue(refreshPendingQueue);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [refreshPendingQueue]);

  // Verify the worker has HTML AND its JS/CSS before promising offline startup.
  // Recheck after foregrounding: OS storage eviction can happen at any time.
  useEffect(() => {
    if (!(import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD) return;
    if (!('serviceWorker' in navigator)) {
      setOfflineShellReady(false);
      return;
    }
    let mounted = true;
    const update = () => {
      checkOfflineShellReady().then((ready) => {
        if (mounted) setOfflineShellReady(ready);
      });
    };
    const foreground = () => { if (document.visibilityState === 'visible') update(); };
    update();
    navigator.serviceWorker.addEventListener('controllerchange', update);
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('pageshow', update);
    return () => {
      mounted = false;
      navigator.serviceWorker.removeEventListener('controllerchange', update);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('pageshow', update);
    };
  }, []);

  // Persist the offline-mode switch only; no message, location or recording.
  useEffect(() => {
    try { localStorage.setItem('lifeline_force_offline', String(offlineForce)); }
    catch { /* private mode / unavailable storage */ }
  }, [offlineForce]);

  // Privacy Rule: Do not store voice recordings or emergency information unless user explicitly enables storage feature
  const [historyStorageEnabled, setHistoryStorageEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('lifeline_storage_opt_in') === 'true';
    } catch {
      return false;
    }
  });

  // Deliberately no automatic status request: this keeps Offline/Resilience mode network-silent.
  // Online mode remains API-backed when the user explicitly selects it and submits an analysis.

  // Load recent reports from localStorage ONLY if user has opted into storage feature
  useEffect(() => {
    if (!historyStorageEnabled) return;
    try {
      const saved = localStorage.getItem('lifeline_recent_reports');
      if (saved) {
        setRecentReports(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
  }, [historyStorageEnabled]);

  const saveReportToHistory = useCallback((report: EmergencyAnalysisResult) => {
    setRecentReports((prev) => {
      const updated = [report, ...prev.filter(r => r.timestamp !== report.timestamp)].slice(0, 10);
      if (historyStorageEnabled) {
        try {
          localStorage.setItem('lifeline_recent_reports', JSON.stringify(updated));
        } catch {
          // ignore
        }
      }
      return updated;
    });
  }, [historyStorageEnabled]);

  const handleToggleHistoryStorage = (enabled: boolean) => {
    setHistoryStorageEnabled(enabled);
    try {
      if (enabled) {
        localStorage.setItem('lifeline_storage_opt_in', 'true');
        localStorage.setItem('lifeline_recent_reports', JSON.stringify(recentReports));
      } else {
        localStorage.removeItem('lifeline_storage_opt_in');
        localStorage.removeItem('lifeline_recent_reports');
      }
    } catch {
      // ignore
    }
  };

  const handleClearHistory = () => {
    setRecentReports([]);
    try {
      localStorage.removeItem('lifeline_recent_reports');
    } catch {
      // ignore
    }
  };

  const handleTranscriptVoiceChange = useCallback((newTranscript: string) => {
    setTranscript(newTranscript);
    setError(null);
    // New browser-voice speech invalidates any previous bilingual server-ASR
    // capture so stale metadata can never be attached to a new analysis.
    setVoiceCapture(null);
    setVoiceNotice(null);
  }, []);

  const handleLocationUpdate = (
    loc: string,
    coords?: { latitude: number; longitude: number; accuracyMeters?: number }
  ) => {
    setLocationInfo(loc);
    if (coords) setLocationCoords(coords);
  };

  /**
   * Single triage entry point.
   *
   * `providedText` is DATA — the transcript to triage — never a DOM event. React
   * invokes any handler bound directly to `onClick` with a SyntheticEvent, so this
   * function must NEVER be passed as `onClick={handleAnalyzeEmergency}`: DOM
   * handlers must wrap it explicitly, i.e. `onClick={() => handleAnalyzeEmergency(transcript)}`.
   *
   * Defense in depth: a non-string first argument is rejected (never coerced) and the
   * authoritative transcript state is triaged instead, so a malformed caller can
   * never crash triage or fabricate transcript text.
   */
  const handleAnalyzeEmergency = async (providedText?: string) => {
    const inputText = typeof providedText === 'string' ? providedText : transcript;
    if (!inputText.trim()) return;

    setIsAnalyzing(true);
    setError(null);

    const textToAnalyze = inputText.trim();
    const startedAt = Date.now();
    const detectedLang = detectLanguage(textToAnalyze);
    const activeVoiceCapture = voiceCaptureRef.current;

    const announceVoiceAnswer = (result: EmergencyAnalysisResult) => {
      if (!voiceOriginRef.current || !soundEnabled) return;
      const languageCode =
        result.voice_capture?.detectedLanguage?.code ||
        result.detected_language?.code ||
        activeVoiceCapture?.detectedLanguage?.code ||
        detectedLang.code;
      const brief = buildSpokenEmergencyBrief({
        languageCode,
        category: result.emergency_category || result.emergency_type,
        severity: result.severity,
        emergencyNumber: getCountryEmergencyNumber(getSelectedCountry())
      });
      const spoken = speakText(brief, {
        languageCode,
        interrupt: true,
        onEnd: () => setIsSpeakingAnswer(false)
      });
      setIsSpeakingAnswer(spoken.started);
      if (!spoken.started) {
        setVoiceNotice('This browser cannot speak answers aloud. The emergency guidance is on screen.');
      } else if (spoken.voiceMatched === false) {
        const name = result.detected_language?.name || languageCode.toUpperCase();
        setVoiceNotice(`No ${name} speaking voice is installed on this device. The answer is on screen. Add a ${name} voice in system settings to hear it.`);
      }
    };

    // Bilingual voice context (detected language + original transcript + optional
    // English translation) travels with the triage request when voice was used.
    const voiceCapturePayload = activeVoiceCapture
      ? {
          asrProvider: activeVoiceCapture.asrProvider,
          asrModel: activeVoiceCapture.asrModel,
          detectedLanguage: activeVoiceCapture.detectedLanguage,
          originalTranscript: activeVoiceCapture.originalTranscript,
          ...(activeVoiceCapture.englishTranslation ? { englishTranslation: activeVoiceCapture.englishTranslation } : {})
        }
      : undefined;

    // TRUE OFFLINE MODE: classification happens in this browser only. No fetch, no server,
    // no API key, and no remote logging/storage are involved.
    if (offlineForce) {
      const offlineClassified = classifyEmergencyOffline(
        textToAnalyze,
        locationInfo || undefined,
        activeVoiceCapture?.detectedLanguage?.name || detectedLang.name,
        selectedLanguage
      );
      const fallbackResult: EmergencyAnalysisResult = {
        ...offlineClassified,
        source: 'offline_fallback',
        model_used: 'LifeLine Local Deterministic Triage Rules',
        timestamp: new Date().toISOString(),
        offline_notice: 'OFFLINE — classified locally in this browser. No cloud API was called.',
        latency_ms: Math.max(0, Date.now() - startedAt),
        raw_transcript: textToAnalyze,
        location_coordinates: locationCoords,
        voice_capture: activeVoiceCapture ?? undefined
      };
      setNebiusConnected(false);
      setCurrentResult(fallbackResult);
      saveReportToHistory(fallbackResult);
      if (soundEnabled) playPing('sos');
      announceVoiceAnswer(fallbackResult);
      setIsAnalyzing(false);
      return;
    }

    // AUTOMATIC OFFLINE SOS: when the online AI cannot answer (airplane mode,
    // no signal, timeout, server/API-key failure), the SOS is classified on
    // this device immediately. This is never silent — the result is labelled
    // offline_fallback and states why the online AI was not used.
    const completeOnDevice = (reason: string) => {
      const offlineClassified = classifyEmergencyOffline(
        textToAnalyze,
        locationInfo || undefined,
        activeVoiceCapture?.detectedLanguage?.name || detectedLang.name,
        selectedLanguage
      );
      const onDeviceResult: EmergencyAnalysisResult = {
        ...offlineClassified,
        source: 'offline_fallback',
        model_used: 'LifeLine Local Deterministic Triage Rules',
        timestamp: new Date().toISOString(),
        offline_notice: `ONLINE AI UNAVAILABLE — ${reason} Classified locally on this device; this result was NOT sent to a responder. Call your local emergency number in immediate danger.`,
        latency_ms: Math.max(0, Date.now() - startedAt),
        raw_transcript: textToAnalyze,
        location_coordinates: locationCoords,
        voice_capture: activeVoiceCapture ?? undefined
      };
      setNebiusConnected(false);
      setError(null);
      setCurrentResult(onDeviceResult);
      saveReportToHistory(onDeviceResult);
      if (soundEnabled) playPing(onDeviceResult.severity >= 4 ? 'alert' : 'sos');
      announceVoiceAnswer(onDeviceResult);
      setIsAnalyzing(false);
    };

    // The online attempt is time-bounded and fully tested; a failed/invalid
    // reply returns a reason instead of blocking the SOS. The helper NEVER
    // sends to emergency partners — only the explicit consent flow can do that.
    try {
      const attempt = await attemptOnlineTriage({
        text: textToAnalyze,
        location: locationInfo,
        coordinates: locationCoords,
        language: voiceCapture?.detectedLanguage?.name || detectedLang.name,
        targetLanguage: selectedLanguage,
        voiceCapture: voiceCapturePayload
      }, { isOnline: navigator.onLine, timeoutMs: ONLINE_ANALYZE_TIMEOUT_MS });

      if ('reason' in attempt) {
        completeOnDevice(attempt.reason);
        return;
      }

      const result = attempt.data;
      setNebiusConnected(result.source === 'nebius_nemotron' || Boolean(result.nebius_connected));
      if (activeVoiceCapture && !result.voice_capture) result.voice_capture = activeVoiceCapture;
      setCurrentResult(result);
      saveReportToHistory(result);
      announceVoiceAnswer(result);
      // A successful ONLINE analysis can carry an explicit ONLINE translation
      // error. Never replace that with a fabricated offline translation.
      if (result.translation_status === 'error' && result.translation_error) {
        setError(`Translation unavailable — ${result.translation_error.error} The original transmission is preserved.`);
      } else {
        setError(null);
      }
      if (soundEnabled) playPing(result.severity >= 4 ? 'alert' : 'sos');
    } catch (error) {
      // Unexpected client failure is still not a reason to hide the local SOS.
      console.error('Online emergency analysis failed:', error);
      completeOnDevice('Online AI could not complete the request.');
    } finally {
      setIsAnalyzing(false);
    }
  };
  analyzeRef.current = handleAnalyzeEmergency;

  // Server ASR finishes outside the tap. Speak the answer from the latest analyzer.
  useEffect(() => {
    if (!voiceSubmitTick) return;
    const text = pendingVoiceTextRef.current;
    pendingVoiceTextRef.current = null;
    if (text) analyzeRef.current(text);
  }, [voiceSubmitTick]);

  // Dedicated "Translate SOS" Handler
  const handleTranslateSOS = async (targetLangCode: string) => {
    if (!currentResult) return;

    setIsTranslating(true);
    setError(null);

    // Translation source contract (PR #16): what gets translated is the USER'S
    // ORIGINAL TRANSMISSION selected as raw_transcript -> original_message ->
    // legacy transcript — NEVER the generated responder/dispatch message, a
    // responder instruction, action steps, required units, an AI summary, or a
    // structured emergency directive. When no legitimate original transmission
    // exists, translation is unavailable: the original record is preserved and
    // an explicit error is shown (never a silent dispatch-text substitution).
    const sourceTranscript = selectTranslationSource({
      raw_transcript: currentResult.raw_transcript,
      transcript: currentResult.transcript,
      translation: currentResult.translation
        ? { original_message: currentResult.translation.original_message }
        : null
    });

    if (!sourceTranscript) {
      setError('Translation unavailable — the original transmission is not available for this record. The original emergency record is preserved.');
      setIsTranslating(false);
      return;
    }

    // Deterministic guard: a translated_message that looks like generated
    // dispatch/triage boilerplate is rejected — it is never displayed as the
    // user's translated transmission.
    const acceptTranslation = (candidate: TranslatedSOS | null | undefined): candidate is TranslatedSOS => {
      if (!candidate) return false;
      return validateTranslatedMessage(candidate.translated_message).ok;
    };

    // Any locally classified result (including automatic fallback) uses the
    // honest, bundled phrasebook. An ONLINE-classified result never silently
    // substitutes offline text for a failed online translation.
    if (offlineForce || currentResult.source === 'offline_fallback') {
      const localTrans = translateEmergencyOffline(
        sourceTranscript,
        targetLangCode,
        currentResult.emergency_category || 'MEDICAL',
        currentResult.severity,
        currentResult.emergency_type,
        currentResult.detected_language?.code,
        locationInfo || undefined
      );
      if (!acceptTranslation(localTrans as TranslatedSOS)) {
        setError('Translation unavailable — the translation failed safety validation. The original transmission is preserved.');
        setIsTranslating(false);
        return;
      }
      const updatedResult: EmergencyAnalysisResult = {
        ...currentResult,
        translation: { ...localTrans, source: 'offline_fallback', model_used: 'Bundled emergency phrasebook' },
        // This is an OFFLINE-classified SOS, never a substitute for a failed
        // online translation of an ONLINE-classified result.
        translation_status: 'ok',
        translation_error: null
      };
      setCurrentResult(updatedResult);
      saveReportToHistory(updatedResult);
      setIsTranslating(false);
      return;
    }

    // Failure/error code returned by the online translation endpoint, when any.
    let failureCode = 'TRANSLATION_FAILED';

    try {
      const response = await fetch('/api/translate-emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sourceTranscript,
          targetLanguage: targetLangCode,
          sourceLanguage: currentResult.detected_language?.code || currentResult.language,
          currentSOS: currentResult,
          offlineModeForce: offlineForce,
          location: locationInfo
        })
      });

      const json: any = await response.json().catch(() => ({}));
      if (typeof json?.code === 'string' && json.code) failureCode = json.code;

      // Safety-validation failures are explicit and terminal: the original is
      // preserved and NO silent offline substitution is performed for them.
      if (json?.code === 'TRANSLATION_INVALID_SOURCE' || json?.code === 'TRANSLATION_VALIDATION_FAILED') {
        throw new Error(
          `TRANSLATION_VALIDATION_FAILED: ${json.error || 'Translation unavailable — safety validation failed. The original transmission is preserved.'}`
        );
      }

      if (!response.ok) {
        throw new Error(json?.error || `Translation API returned HTTP ${response.status}`);
      }

      if (json.success && json.data) {
        const transData: TranslatedSOS = json.data;
        if (!acceptTranslation(transData)) {
          throw new Error('TRANSLATION_VALIDATION_FAILED: Translation unavailable — the translation failed safety validation. The original transmission is preserved.');
        }
        const updatedResult: EmergencyAnalysisResult = {
          ...currentResult,
          translation: transData,
          translation_status: 'ok',
          translation_error: null
        };
        setCurrentResult(updatedResult);
        saveReportToHistory(updatedResult);
        setError(null);
        if (soundEnabled) playPing('sos');
      } else {
        throw new Error(json.error || 'Failed to translate emergency message');
      }
    } catch (err: any) {
      const message = typeof err?.message === 'string' ? err.message : '';
      const unavailableMessage = message.startsWith('TRANSLATION_VALIDATION_FAILED:')
        ? message.slice('TRANSLATION_VALIDATION_FAILED:'.length).trim()
        : `Translation unavailable — ${
            message || 'the online translation service did not return a usable translation.'
          } The original transmission is preserved.`;

      // ONLINE translation failure == explicit unavailable/error state.
      // The original transmission is preserved and NO offline translation is
      // silently substituted: offline translation belongs to OFFLINE MODE only
      // (never to a failed online request).
      console.warn('Online translation unavailable:', failureCode, message || err);
      const updatedResult: EmergencyAnalysisResult = {
        ...currentResult,
        // Never present a stale or unrelated translation as if it succeeded.
        translation: undefined,
        translation_status: 'error',
        translation_error: { code: failureCode, error: unavailableMessage }
      };
      setCurrentResult(updatedResult);
      saveReportToHistory(updatedResult);
      setError(unavailableMessage);
    } finally {
      setIsTranslating(false);
    }
  };
  // The country is explicitly selected in the partner directory; never guess a
  // phone number from browser language or an unreliable offline IP lookup.
  const configuredEmergencyNumber = getCountryEmergencyNumber(getSelectedCountry());
  const localOnlyMode = offlineForce || !networkAvailable;

  return (
    <div
      className={`min-h-screen flex flex-col font-sans transition-colors ${
        highContrast ? 'bg-black text-white' : 'bg-neutral-950 text-neutral-100'
      }`}
    >
      {/* Official Launch Splash Screen */}
      {showSplash && (
        <SplashScreen
          onDismiss={() => setShowSplash(false)}
          nebiusConfigured={systemStatus?.nebius_configured}
        />
      )}

      {/* Sticky Header with branding and status */}
      <Header
        systemStatus={systemStatus}
        offlineForce={offlineForce}
        onToggleOfflineForce={() => {
          setOfflineForce((prev) => {
            const next = !prev;
            if (next) setNebiusConnected(false);
            return next;
          });
        }}
        highContrast={highContrast}
        onToggleHighContrast={() => setHighContrast((prev) => !prev)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((prev) => {
          if (prev) {
            stopSpeaking();
            setIsSpeakingAnswer(false);
          }
          return !prev;
        })}
        onShowSplash={() => setShowSplash(true)}
        onOpenPrivacyModal={() => setShowPrivacyModal(true)}
        onOpenPartnersModal={() => setShowPartnersModal(true)}
        nebiusConnected={nebiusConnected}
      />

      {/* Main Container */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-3.5 py-4 sm:px-6 sm:py-6 flex flex-col">
        {/* Pending SOS Local Queue Banner */}
        {pendingQueueCount > 0 && (
          <div
            id="pending-sos-queue-banner"
            className="mb-3 p-3 rounded-xl bg-amber-950/90 border-2 border-amber-600 text-amber-200 text-xs font-bold flex flex-wrap items-center justify-between gap-2 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <b>NOT SENT:</b> {pendingQueueCount} SOS record(s) stored on this device. Reconnecting or reopening NEVER uploads them. Review and share manually when ready. TEST/DEMO alerts never reach responders; call your local emergency number directly.
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setShowPartnersModal(true)}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-black transition-colors flex items-center gap-1"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>View & Share Saved SOS</span>
              </button>
            </div>
          </div>
        )}

        {/* Rapid SOS Banner on top with Privacy link */}
        <div
          id="sos-call-reminder-banner"
          className="flex flex-wrap items-center justify-between gap-2 p-2.5 sm:p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs sm:text-sm text-red-200 mb-3"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertOctagon className="w-4 h-4 sm:w-5 sm:h-5 text-red-400 shrink-0" />
            <span>In immediate life danger, call emergency services directly:</span>
          </div>
          <div className="flex items-center gap-2">
            {configuredEmergencyNumber ? (
              <a
                href={`tel:${configuredEmergencyNumber}`}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-extrabold rounded-lg flex items-center gap-1 transition-colors"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Call {configuredEmergencyNumber}</span>
              </a>
            ) : (
              <button type="button" onClick={() => setShowPartnersModal(true)}
                className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg text-xs">
                Select country to view its emergency number
              </button>
            )}
            <button
              id="banner-privacy-link-btn"
              onClick={() => setShowPrivacyModal(true)}
              className="ml-1 px-2 py-1 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-emerald-300 font-bold text-xs border border-emerald-800/70 flex items-center gap-1 transition-colors"
              title="View LifeLine AI Privacy & Safety principles"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Privacy & Safety</span>
            </button>
          </div>
        </div>

        {/* Explicit mode status */}
        <div className={`mb-2 px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-wide ${localOnlyMode ? 'bg-amber-950/60 border-amber-700 text-amber-300' : 'bg-emerald-950/40 border-emerald-800 text-emerald-300'}`}>
          {localOnlyMode
            ? 'LOCAL SOS TRIAGE — typed messages work without internet. Nothing is automatically sent; browser voice may need a network.'
            : 'ONLINE AI selected — on-device SOS takes over if unreachable. Dispatch requires separate consent and a real supported partner.'}
        </div>

        {offlineShellReady !== null && (
          <div id="offline-shell-readiness" aria-live="polite"
            className={`mb-3 px-3 py-2 rounded-lg border text-xs ${offlineShellReady ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : 'border-amber-700 bg-amber-950/50 text-amber-200'}`}>
            {offlineShellReady
              ? 'App files saved for offline startup on this device. You can type an SOS without network; browser storage can still be cleared by the OS. No message is delivered in airplane mode.'
              : 'Offline startup not verified on this device yet. Open once on a working connection and wait until app files finish saving; keep the page open until then.'}
          </div>
        )}

        {/* Silent SOS activation: location is requested only after this explicit user action */}
        <button
          id="open-silent-sos-btn"
          onClick={() => setShowSilentSOS(true)}
          className="w-full mb-3 py-4 rounded-xl bg-red-700 hover:bg-red-600 border-2 border-red-400 text-white font-black tracking-wide shadow-lg shadow-red-950/50 flex items-center justify-center gap-2"
        >
          <ShieldCheck className="w-5 h-5" />
          SILENT SOS
          <span className="text-[10px] font-semibold opacity-80">No speaking required • Confirmation required</span>
        </button>

        {/* Big Emergency Voice Push Button */}
        <EmergencyVoiceButton
          onTranscriptChange={handleTranscriptVoiceChange}
          onSubmitEmergency={(text) => {
            voiceOriginRef.current = true;
            void handleAnalyzeEmergency(text);
          }}
          isAnalyzing={isAnalyzing}
          offlineMode={localOnlyMode}
          soundEnabled={soundEnabled}
          highContrast={highContrast}
          selectedLanguage={selectedLanguage}
          onResolveVoiceMode={resolveVoiceMode}
          onVoiceRecordingStopped={handleVoiceRecordingStopped}
          voicePhase={asrPhase}
          voiceModeNotice={voiceNotice || voiceModeNotice}
          isSpeakingAnswer={isSpeakingAnswer}
          onCancelSpeech={() => setIsSpeakingAnswer(false)}
        />

        {/* Speech-to-Text Transcript Area & Presets */}
        <TranscriptArea
          transcript={transcript}
          onTranscriptChange={(text) => {
            setTranscript(text);
            // Typing is the fallback, not the microphone path — do not speak a
            // typed edit as if it were a live voice answer.
            voiceOriginRef.current = false;
            // ANY manual transcript change (typing, presets, clearing)
            // invalidates the previous bilingual voice capture so it can never
            // be attached to an analysis it did not produce. The server voice
            // path updates the transcript directly and is not affected.
            setVoiceCapture(null);
            voiceCaptureRef.current = null;
            setVoiceNotice(null);
          }}
          onSubmitEmergency={handleAnalyzeEmergency}
          onOfflineTest={(testText) => {
            setTranscript(testText);
            handleAnalyzeEmergency(testText);
          }}
          isAnalyzing={isAnalyzing}
          offlineForce={localOnlyMode}
          highContrast={highContrast}
          locationInfo={locationInfo}
          onLocationUpdate={handleLocationUpdate}
          selectedLanguage={selectedLanguage}
          onLanguageChange={setSelectedLanguage}
          nebiusConnected={nebiusConnected}
          voiceCapture={voiceCapture}
          onDismissVoiceCapture={() => {
            setVoiceCapture(null);
            setVoiceNotice(null);
          }}
          voiceNotice={voiceNotice}
          isVoiceProcessing={asrPhase === 'transcribing' || asrPhase === 'translating'}
        />

        {/* Dedicated Error State Banner with Direct Actions */}
        {error && (
          <div
            id="emergency-analysis-error-banner"
            className="mt-4 p-3.5 sm:p-4 rounded-xl bg-red-950/90 border-2 border-red-700 text-red-200 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertOctagon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>Emergency Analysis Error</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-900/90 text-red-200 border border-red-700">
                    Nebius Token Factory
                  </span>
                </div>
                <div className="text-xs text-red-300 mt-1 leading-relaxed">
                  {error}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                id="error-switch-offline-btn"
                onClick={() => {
                  setError(null);
                  setOfflineForce(true);
                  setNebiusConnected(false);
                  const detectedLang = detectLanguage(transcript);
                  const offlineClassified = classifyEmergencyOffline(
                    transcript,
                    locationInfo || undefined,
                    detectedLang.name,
                    selectedLanguage
                  );
                  const fallbackResult: EmergencyAnalysisResult = {
                    ...offlineClassified,
                    source: 'offline_fallback',
                    model_used: 'Browser Client Deterministic Triage Engine',
                    timestamp: new Date().toISOString(),
                    offline_notice: 'Switched to on-device deterministic triage. Zero network connection required.',
                    latency_ms: 10,
                    raw_transcript: transcript,
                    location_coordinates: locationCoords,
                    voice_capture: voiceCapture ?? undefined
                  };
                  setCurrentResult(fallbackResult);
                  saveReportToHistory(fallbackResult);
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow transition-colors"
                title="Switch to Offline Fallback Mode for immediate on-device triage"
              >
                Switch to Offline Mode
              </button>
              <button
                id="error-retry-btn"
                onClick={() => handleAnalyzeEmergency(transcript)}
                className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-bold text-xs shadow transition-colors"
              >
                Retry
              </button>
              <button
                id="error-dismiss-btn"
                onClick={() => setError(null)}
                className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs"
                title="Dismiss error"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Visual High-Contrast SOS Card (Rendered deterministically from Nemotron JSON) */}
        {currentResult && (
          <SOSCardView
            result={currentResult}
            highContrast={highContrast}
            soundEnabled={soundEnabled}
            offlineMode={offlineForce}
            onTranslateSOS={handleTranslateSOS}
            isTranslating={isTranslating}
          />
        )}

        {/* Recent Emergency Reports in Session */}
        {recentReports.length > 1 && (
          <section id="recent-session-reports" className="mt-8 pt-6 border-t border-neutral-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-400 uppercase tracking-wider">
                <History className="w-3.5 h-3.5" />
                <span>Session Emergency Reports ({recentReports.length})</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-normal normal-case ${historyStorageEnabled ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-neutral-800 text-neutral-400'}`}>
                  {historyStorageEnabled ? 'Saved to Device' : 'Volatile (Memory Only)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleHistoryStorage(!historyStorageEnabled)}
                  className="text-[10px] text-neutral-400 hover:text-neutral-200 underline"
                  title="Do not store voice recordings or emergency information unless explicitly enabled"
                >
                  {historyStorageEnabled ? 'Disable Persistence' : 'Enable Persistence'}
                </button>
                <button
                  onClick={handleClearHistory}
                  className="text-[11px] text-neutral-500 hover:text-red-400 flex items-center gap-1 transition-colors ml-2"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {recentReports.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => setCurrentResult(item)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    currentResult?.timestamp === item.timestamp
                      ? 'bg-neutral-800/90 border-red-500 ring-1 ring-red-500'
                      : 'bg-neutral-900/50 hover:bg-neutral-800/70 border-neutral-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs font-bold text-white truncate">
                      {item.visual_card.headline}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] px-1 py-0.2 rounded bg-neutral-800 text-neutral-300 font-mono">
                        {item.emergency_category || 'MEDICAL'}
                      </span>
                      <span
                        className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded font-mono ${
                          item.severity >= 4 ? 'bg-red-950 text-red-400' : 'bg-amber-950 text-amber-400'
                        }`}
                      >
                        P{item.severity}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-neutral-400 line-clamp-1">
                    {item.raw_transcript || item.message}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-neutral-400 mt-1.5 pt-1 border-t border-neutral-800/50">
                    <span className="flex items-center gap-1">
                      <span>{item.source === 'nebius_nemotron' ? 'Nemotron' : 'Offline'}</span>
                      {item.translation && (
                        <span className="text-emerald-400 font-bold">• Translated</span>
                      )}
                    </span>
                    <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {showSilentSOS && (
        <SilentSOS
          offlineMode={localOnlyMode}
          onClose={() => setShowSilentSOS(false)}
          onSaveResult={(result) => {
            setCurrentResult(result);
            saveReportToHistory(result);
          }}
          onQueueUpdated={refreshPendingQueue}
        />
      )}

      {/* Emergency Partners Configuration & Queue Manager Modal */}
      <EmergencyPartnersManagerModal
        isOpen={showPartnersModal}
        onClose={() => setShowPartnersModal(false)}
        isOffline={localOnlyMode}
        onQueueUpdated={refreshPendingQueue}
      />

      {/* Footer */}
      <footer className="w-full border-t border-neutral-800/80 py-4 px-4 text-center text-[11px] text-neutral-400">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img
              src="/logo.png"
              alt="LifeLine AI"
              className="w-5 h-5 rounded object-cover"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.src.includes('logo.png')) target.src = '/logo.png';
              }}
            />
            <span>
              <span className="font-bold text-white">LifeLine AI</span> — Emergency Communication Assistant <span className="uppercase font-bold tracking-wider text-neutral-300">BY MSB CREATIVE STUDIOS</span>
              <span className="block text-[10px] text-neutral-400 mt-0.5">© 2026 MSB Creative Studios · Apache License 2.0</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="footer-privacy-safety-btn"
              onClick={() => setShowPrivacyModal(true)}
              className="text-emerald-400 hover:text-emerald-300 font-bold underline underline-offset-2 flex items-center gap-1 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacy & Safety</span>
            </button>
            <span className="text-neutral-600">•</span>
            <button
              id="footer-privacy-contact-btn"
              onClick={() => setShowPrivacyContactForm(true)}
              className="text-emerald-400 hover:text-emerald-300 font-bold underline underline-offset-2 flex items-center gap-1 transition-colors"
              title="Contact the MSB Creative Studios privacy team through the Privacy Contact Form"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Contact Privacy Team</span>
            </button>
            <span className="text-neutral-600 hidden sm:inline">•</span>
            <div className="text-[10px] text-neutral-400">
              {offlineForce ? 'Offline local rules • Bundled emergency phrasebook' : 'NVIDIA Nemotron via Nebius Token Factory • Online emergency translation'}
            </div>
          </div>
        </div>
      </footer>

      {/* Privacy & Safety Statement Modal */}
      <PrivacySafetyModal
        isOpen={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        systemStatus={systemStatus}
        offlineForce={offlineForce}
        historyStorageEnabled={historyStorageEnabled}
        onToggleHistoryStorage={handleToggleHistoryStorage}
        onClearHistory={handleClearHistory}
        storedReportsCount={recentReports.length}
        onOpenContactForm={() => setShowPrivacyContactForm(true)}
      />

      {/* Privacy Contact Form — posts to /api/privacy-contact; no email address is published in the client */}
      <PrivacyContactFormModal
        isOpen={showPrivacyContactForm}
        offlineMode={localOnlyMode}
        onClose={() => setShowPrivacyContactForm(false)}
      />
    </div>
  );
};
