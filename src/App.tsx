import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { EmergencyVoiceButton } from './components/EmergencyVoiceButton.tsx';
import { TranscriptArea } from './components/TranscriptArea.tsx';
import { SOSCardView } from './components/SOSCardView.tsx';
import { SplashScreen } from './components/SplashScreen.tsx';
import { PrivacySafetyModal } from './components/PrivacySafetyModal.tsx';
import {
  EmergencyAnalysisResult,
  SystemStatus,
  TranslatedSOS
} from './types.ts';
import { classifyEmergencyOffline } from './lib/offlineClassifier.ts';
import { translateEmergencyOffline, detectLanguage } from './lib/languages.ts';
import { playPing } from './lib/audio.ts';
import { AlertOctagon, PhoneCall, History, Trash2, ShieldCheck, Lock } from 'lucide-react';

export default function App() {
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);
  const [transcript, setTranscript] = useState('');
  const [locationInfo, setLocationInfo] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number; accuracyMeters?: number } | null>(null);
  const [offlineForce, setOfflineForce] = useState<boolean>(false);
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

  // Privacy Rule: Do not store voice recordings or emergency information unless user explicitly enables storage feature
  const [historyStorageEnabled, setHistoryStorageEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('lifeline_storage_opt_in') === 'true';
    } catch {
      return false;
    }
  });

  // Check system status from backend on mount
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data: SystemStatus = await res.json();
          setSystemStatus(data);
        }
      } catch (err) {
        console.warn('Could not fetch backend status. Assuming local offline mode ready.', err);
      }
    }
    checkStatus();
  }, []);

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
  }, []);

  const handleLocationUpdate = (
    loc: string,
    coords?: { latitude: number; longitude: number; accuracyMeters?: number }
  ) => {
    setLocationInfo(loc);
    if (coords) setLocationCoords(coords);
  };

  const handleAnalyzeEmergency = async () => {
    if (!transcript.trim()) return;

    setIsAnalyzing(true);
    setError(null);

    const textToAnalyze = transcript.trim();
    const detectedLang = detectLanguage(textToAnalyze);

    // If explicit Offline Fallback Mode is chosen by user
    if (offlineForce) {
      try {
        const response = await fetch('/api/analyze-emergency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textToAnalyze,
            location: locationInfo,
            coordinates: locationCoords,
            offlineModeForce: true,
            language: detectedLang.name,
            targetLanguage: selectedLanguage
          })
        });

        if (!response.ok) {
          throw new Error(`Offline server returned HTTP ${response.status}`);
        }

        const json = await response.json();
        if (json.success && json.data) {
          const result: EmergencyAnalysisResult = json.data;
          setNebiusConnected(false);
          setCurrentResult(result);
          saveReportToHistory(result);
          if (soundEnabled) playPing('sos');
        } else {
          throw new Error(json.error || 'Failed to analyze offline emergency');
        }
      } catch (err: any) {
        // Direct browser client deterministic fallback
        const offlineClassified = classifyEmergencyOffline(
          textToAnalyze,
          locationInfo || undefined,
          detectedLang.name,
          selectedLanguage
        );
        const fallbackResult: EmergencyAnalysisResult = {
          ...offlineClassified,
          source: 'offline_fallback',
          model_used: 'Browser Client Deterministic Triage Engine',
          timestamp: new Date().toISOString(),
          offline_notice: 'Direct browser offline triage executed. Zero network connectivity.',
          latency_ms: 10,
          raw_transcript: textToAnalyze,
          location_coordinates: locationCoords
        };
        setNebiusConnected(false);
        setCurrentResult(fallbackResult);
        saveReportToHistory(fallbackResult);
        if (soundEnabled) playPing('sos');
      } finally {
        setIsAnalyzing(false);
      }
      return;
    }

    // Online AI Mode: Send to Nebius Token Factory backend for Nemotron processing
    try {
      const response = await fetch('/api/analyze-emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToAnalyze,
          location: locationInfo,
          coordinates: locationCoords,
          offlineModeForce: false,
          language: detectedLang.name,
          targetLanguage: selectedLanguage
        })
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok || !json.success) {
        const errMessage =
          json.error ||
          (response.status === 401
            ? 'Nebius API authentication failed. Verify NEBIUS_API_KEY configuration.'
            : response.status === 502
            ? 'Nebius Token Factory service unreachable or timed out. Switch to Offline Fallback Mode if needed.'
            : `Analysis request failed with status ${response.status}.`);

        setError(errMessage);
        setNebiusConnected(false);
        if (soundEnabled) playPing('alert');
        return;
      }

      if (json.success && json.data) {
        const result: EmergencyAnalysisResult = json.data;
        // Verify actual completed Nebius response
        if (result.source === 'nebius_nemotron' || result.nebius_connected) {
          setNebiusConnected(true);
        }
        setCurrentResult(result);
        saveReportToHistory(result);
        setError(null);
        if (soundEnabled) {
          playPing(result.severity >= 4 ? 'alert' : 'sos');
        }
      } else {
        throw new Error(json.error || 'Invalid response from Nebius Token Factory');
      }
    } catch (apiErr: any) {
      console.error('Online Nebius analysis failed:', apiErr);
      // Explicit error state: do not fabricate successful response or silent fallback!
      setError(
        apiErr.message ||
        'Network error contacting Nebius Token Factory. Please check connection or switch to Offline Mode.'
      );
      setNebiusConnected(false);
      if (soundEnabled) playPing('alert');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Dedicated "Translate SOS" Handler
  const handleTranslateSOS = async (targetLangCode: string) => {
    if (!currentResult) return;

    setIsTranslating(true);
    setError(null);

    try {
      const response = await fetch('/api/translate-emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentResult.message,
          targetLanguage: targetLangCode,
          sourceLanguage: currentResult.detected_language?.code || currentResult.language,
          currentSOS: currentResult,
          offlineModeForce: offlineForce,
          location: locationInfo
        })
      });

      if (!response.ok) {
        throw new Error(`Translation API returned HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json.success && json.data) {
        const transData: TranslatedSOS = json.data;
        const updatedResult: EmergencyAnalysisResult = {
          ...currentResult,
          translation: transData
        };
        setCurrentResult(updatedResult);
        saveReportToHistory(updatedResult);
        if (soundEnabled) playPing('sos');
      } else {
        throw new Error(json.error || 'Failed to translate emergency message');
      }
    } catch (err: any) {
      console.warn('Backend translation failed or timed out. Using local browser offline translation:', err);

      const localTrans = translateEmergencyOffline(
        currentResult.message,
        targetLangCode,
        currentResult.emergency_category || 'MEDICAL',
        currentResult.severity,
        currentResult.emergency_type,
        currentResult.detected_language?.code,
        locationInfo || undefined
      );

      const updatedResult: EmergencyAnalysisResult = {
        ...currentResult,
        translation: localTrans
      };
      setCurrentResult(updatedResult);
      saveReportToHistory(updatedResult);
      if (soundEnabled) playPing('sos');
    } finally {
      setIsTranslating(false);
    }
  };

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
        onToggleSound={() => setSoundEnabled((prev) => !prev)}
        onShowSplash={() => setShowSplash(true)}
        onOpenPrivacyModal={() => setShowPrivacyModal(true)}
        nebiusConnected={nebiusConnected}
      />

      {/* Main Container */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-3.5 py-4 sm:px-6 sm:py-6 flex flex-col">
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
            <a
              href="tel:911"
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-extrabold rounded-lg flex items-center gap-1 transition-colors"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Call 911</span>
            </a>
            <a
              href="tel:112"
              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold rounded-lg text-xs transition-colors"
            >
              112 (EU/Intl)
            </a>
            <a
              href="tel:108"
              className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold rounded-lg text-xs transition-colors"
              title="National Emergency Ambulance (India)"
            >
              108 (India)
            </a>
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

        {/* Big Emergency Voice Push Button */}
        <EmergencyVoiceButton
          onTranscriptChange={handleTranscriptVoiceChange}
          isAnalyzing={isAnalyzing}
          soundEnabled={soundEnabled}
          highContrast={highContrast}
        />

        {/* Speech-to-Text Transcript Area & Presets */}
        <TranscriptArea
          transcript={transcript}
          onTranscriptChange={setTranscript}
          onSubmitEmergency={handleAnalyzeEmergency}
          isAnalyzing={isAnalyzing}
          offlineForce={offlineForce}
          highContrast={highContrast}
          locationInfo={locationInfo}
          onLocationUpdate={handleLocationUpdate}
          selectedLanguage={selectedLanguage}
          onLanguageChange={setSelectedLanguage}
          nebiusConnected={nebiusConnected}
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
                    location_coordinates: locationCoords
                  };
                  setCurrentResult(fallbackResult);
                  saveReportToHistory(fallbackResult);
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow transition-colors"
                title="Switch to Offline Fallback Mode for immediate on-device triage"
              >
                Use Offline Fallback
              </button>
              <button
                id="error-retry-btn"
                onClick={handleAnalyzeEmergency}
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

      {/* Footer */}
      <footer className="w-full border-t border-neutral-800/80 py-4 px-4 text-center text-[11px] text-neutral-400">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img
              src="/file_00000000f3ec8211ba741b84f232a029.png"
              alt="LifeLine AI"
              className="w-5 h-5 rounded object-cover"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.src.includes('logo.png')) target.src = '/logo.png';
              }}
            />
            <span>
              <span className="font-bold text-white">LifeLine AI</span> — Emergency Communication Assistant <span className="uppercase font-bold tracking-wider text-neutral-300">BY MSB CREATIVE STUDIOS</span>
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
            <span className="text-neutral-600 hidden sm:inline">•</span>
            <div className="text-[10px] text-neutral-400">
              NVIDIA Nemotron via Nebius Token Factory • Multilingual Emergency Translation
            </div>
          </div>
        </div>
      </footer>

      {/* Privacy & Safety Statement Modal */}
      <PrivacySafetyModal
        isOpen={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        isOfflineMode={offlineForce || !systemStatus?.nebius_configured}
        historyStorageEnabled={historyStorageEnabled}
        onToggleHistoryStorage={handleToggleHistoryStorage}
      />
    </div>
  );
};
