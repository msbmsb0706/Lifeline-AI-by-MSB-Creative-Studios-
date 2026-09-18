import React, { useState } from 'react';
import { Shield, ShieldCheck, Wifi, WifiOff, Info, Sun, Moon, Volume2, VolumeX, Sparkles, X, Lock } from 'lucide-react';
import { SystemStatus } from '../types.ts';

interface HeaderProps {
  systemStatus: SystemStatus | null;
  offlineForce: boolean;
  onToggleOfflineForce: () => void;
  highContrast: boolean;
  onToggleHighContrast: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onShowSplash?: () => void;
  onOpenPrivacyModal?: () => void;
  nebiusConnected?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  systemStatus,
  offlineForce,
  onToggleOfflineForce,
  highContrast,
  onToggleHighContrast,
  soundEnabled,
  onToggleSound,
  onShowSplash,
  onOpenPrivacyModal,
  nebiusConnected = false
}) => {
  const [showInfoModal, setShowInfoModal] = useState(false);

  return (
    <header
      id="lifeline-header"
      className={`w-full border-b transition-colors ${
        highContrast
          ? 'bg-black border-white text-white'
          : 'bg-neutral-900/90 backdrop-blur-md border-neutral-800 text-neutral-100'
      } sticky top-0 z-40 px-3 py-2.5 sm:px-6 sm:py-3`}
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        {/* Official Brand & Studio Logo */}
        <div
          onClick={onShowSplash}
          className="flex items-center gap-2.5 cursor-pointer group select-none"
          title="Click to view LifeLine AI splash screen"
        >
          <div
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl overflow-hidden shadow-inner flex items-center justify-center bg-neutral-950 flex-shrink-0 transition-transform group-hover:scale-105 ${
              highContrast ? 'border-2 border-white ring-2 ring-red-600' : 'border border-neutral-700/80 ring-1 ring-red-500/30'
            }`}
          >
            <img
              src="/file_00000000f3ec8211ba741b84f232a029.png"
              alt="LifeLine AI by MSB Creative Studios"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.src.includes('logo.png')) {
                  target.src = '/logo.png';
                }
              }}
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-extrabold text-base sm:text-lg tracking-tight text-white">
                LifeLine <span className="text-red-500">AI</span>
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-950 text-red-400 border border-red-800">
                EMERGENCY
              </span>
            </div>
            <div className="text-[10px] sm:text-[11px] text-neutral-400 font-medium tracking-wide uppercase">
              BY <span className="text-neutral-200 font-bold">MSB CREATIVE STUDIOS</span>
            </div>
          </div>
        </div>

        {/* Right side controls: Mode Pill, High Contrast, Sound, Info */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Connection Indicator: ONLY when an actual successful API request has been completed */}
          {nebiusConnected && (
            <div
              id="nebius-connection-indicator"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-500 shadow-sm transition-all"
              title="Verified live connection: actual successful API request completed with Nebius Token Factory Nemotron"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              <span className="whitespace-nowrap">Nebius • Nemotron Connected</span>
            </div>
          )}

          {/* Clearly separated Online / Offline mode selector */}
          <div className="hidden lg:flex flex-col items-end leading-tight mr-1" aria-label="Current analysis mode">
            <span className="text-[9px] font-black tracking-widest text-neutral-500">{offlineForce ? 'OFFLINE / RESILIENCE' : 'ONLINE / HACKATHON'}</span>
            <span className={`text-[9px] font-semibold ${offlineForce ? 'text-amber-400' : 'text-emerald-400'}`}>{offlineForce ? 'No Internet • No API Key' : 'Nebius • Nemotron'}</span>
          </div>
          <button
            id="toggle-offline-mode-btn"
            onClick={onToggleOfflineForce}
            title={offlineForce ? 'Switch to Online AI mode' : 'Force offline deterministic fallback mode'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
              offlineForce
                ? 'bg-amber-950/80 text-amber-300 border-amber-600 hover:bg-amber-900'
                : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
            }`}
          >
            {offlineForce ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden xs:inline">OFFLINE • No API Key</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-neutral-400" />
                <span className="hidden xs:inline">ONLINE • Nebius</span>
              </>
            )}
          </button>

          {/* Sound toggle */}
          <button
            id="toggle-sound-btn"
            onClick={onToggleSound}
            title={soundEnabled ? 'Mute audio alerts' : 'Enable audio alerts'}
            className="p-2 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 transition-colors"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-neutral-500" />}
          </button>

          {/* High Contrast Toggle */}
          <button
            id="toggle-contrast-btn"
            onClick={onToggleHighContrast}
            title={highContrast ? 'Standard theme' : 'High-contrast emergency mode'}
            className={`p-2 rounded-lg transition-colors ${
              highContrast ? 'bg-yellow-400 text-black font-bold' : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300'
            }`}
          >
            {highContrast ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Privacy & Safety Link Button */}
          {onOpenPrivacyModal && (
            <button
              id="open-privacy-safety-btn"
              onClick={onOpenPrivacyModal}
              title="LifeLine AI — Privacy & Safety Policy"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/80 text-emerald-300 transition-colors text-xs font-bold shadow-sm"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">Privacy & Safety</span>
            </button>
          )}

          {/* Architecture info button */}
          <button
            id="open-info-modal-btn"
            onClick={() => setShowInfoModal(true)}
            title="System & Architecture Information"
            className="p-2 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 transition-colors"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Architecture & Offline Fallback Explanation Modal */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl p-5 shadow-2xl text-neutral-100 relative">
            <button
              id="close-info-modal-btn"
              onClick={() => setShowInfoModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl overflow-hidden border border-neutral-700 bg-neutral-950 flex-shrink-0">
                <img
                  src="/file_00000000f3ec8211ba741b84f232a029.png"
                  alt="LifeLine AI by MSB Creative Studios"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.src.includes('logo.png')) {
                      target.src = '/logo.png';
                    }
                  }}
                />
              </div>
              <div>
                <h2 className="text-lg font-black text-white leading-tight">
                  LifeLine <span className="text-red-500">AI</span>
                </h2>
                <div className="text-[11px] font-extrabold tracking-widest text-neutral-400 uppercase">
                  BY MSB CREATIVE STUDIOS
                </div>
              </div>
            </div>

            <p className="text-xs text-neutral-300 mb-4 leading-relaxed">
              Official emergency communication assistant engineered for rapid crisis classification, automated responder triage, and high-visibility visual SOS guidance.
            </p>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-neutral-800/70 border border-neutral-700">
                <div className="font-semibold text-emerald-400 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-4 h-4" />
                  Nebius Token Factory & Nemotron (Online)
                </div>
                <p className="text-neutral-300">
                  Backend calls NVIDIA Nemotron LLMs via Nebius Token Factory API using secure server-side <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">NEBIUS_API_KEY</code>. Returns strictly structured JSON for triage, required units, and 911 dispatch scripts.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-neutral-800/70 border border-amber-900/50">
                <div className="font-semibold text-amber-400 flex items-center gap-1.5 mb-1">
                  <WifiOff className="w-4 h-4" />
                  Deterministic Offline Fallback Engine
                </div>
                <p className="text-neutral-300">
                  When Nebius connectivity is unavailable, no key is configured, or offline mode is toggled, LifeLine AI uses an instant, deterministic local rule-based triage classifier.
                </p>
                <p className="text-[11px] text-amber-300/80 mt-1 font-medium italic">
                  Note: Nebius Token Factory operates strictly online; the offline mode uses verified local deterministic heuristics so you never lose emergency triage capability.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-neutral-800/70 border border-neutral-700">
                <div className="font-semibold text-sky-400 mb-1">
                  High-Contrast SOS Display
                </div>
                <p className="text-neutral-300">
                  Deterministically generates visual cards with medical triage color coding (Severity 1-5), responder instructions, first aid protocols, and an emergency beacon strobe for signaling through smoke or darkness.
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {onShowSplash && (
                  <button
                    id="replay-splash-screen-btn"
                    onClick={() => {
                      setShowInfoModal(false);
                      onShowSplash();
                    }}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-semibold rounded-xl border border-neutral-700 transition-colors flex items-center gap-1.5"
                  >
                    <span>Splash</span>
                  </button>
                )}
                {onOpenPrivacyModal && (
                  <button
                    id="info-modal-privacy-link"
                    onClick={() => {
                      setShowInfoModal(false);
                      onOpenPrivacyModal();
                    }}
                    className="px-3 py-2 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 text-xs font-bold rounded-xl border border-emerald-700/80 transition-colors flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Privacy & Safety</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowInfoModal(false)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-colors ml-auto"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
