import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Wifi,
  WifiOff,
  MapPin,
  Share2,
  AlertTriangle,
  X,
  CheckCircle2,
  FileText,
  Sparkles,
  Server,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Mail
} from 'lucide-react';
import { SystemStatus } from '../types.ts';

interface PrivacySafetyModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemStatus: SystemStatus | null;
  offlineForce: boolean;
  historyStorageEnabled: boolean;
  onToggleHistoryStorage: (enabled: boolean) => void;
  onClearHistory: () => void;
  storedReportsCount: number;
  /** Opens the Privacy Contact Form (no email address is published anywhere in the UI). */
  onOpenContactForm?: () => void;
}

/** "Contact & Privacy Requests" card — the only contact channel shown to users. */
const PrivacyContactCard: React.FC<{ onOpenContactForm?: () => void; compact?: boolean }> = ({
  onOpenContactForm,
  compact = false
}) => (
  <div
    id="privacy-contact-section"
    className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/70 flex items-start gap-3"
  >
    <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-400 shrink-0 mt-0.5">
      <Mail className="w-4 h-4" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-extrabold text-white text-xs uppercase tracking-wide">
        Contact &amp; Privacy Requests
      </div>
      <p className="text-neutral-300 text-xs mt-0.5 font-medium">
        Questions, data access or deletion requests, or feedback about this policy? Contact MSB Creative Studios
        through the Privacy Contact Form.
      </p>
      {!compact && (
        <p className="text-neutral-400 text-[11px] mt-0.5">
          The form asks for your name (optional), a reply email address (required) and your message (required). What you
          submit is used only to respond to your request. Because a reply address is required, submissions are not
          anonymous.
        </p>
      )}
      {onOpenContactForm && (
        <button
          id="open-privacy-contact-form-btn"
          type="button"
          onClick={onOpenContactForm}
          className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition-colors flex items-center gap-1.5 active:scale-95"
        >
          <Mail className="w-3.5 h-3.5" />
          <span>Open Privacy Contact Form</span>
        </button>
      )}
    </div>
  </div>
);

export const PrivacySafetyModal: React.FC<PrivacySafetyModalProps> = ({
  isOpen,
  onClose,
  systemStatus,
  offlineForce,
  historyStorageEnabled,
  onToggleHistoryStorage,
  onClearHistory,
  storedReportsCount,
  onOpenContactForm
}) => {
  const [activeTab, setActiveTab] = useState<'quick' | 'statement'>('quick');

  if (!isOpen) return null;

  const isOnlineMode = !offlineForce && systemStatus?.nebius_configured;

  return (
    <div
      id="privacy-safety-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
    >
      <div className="w-full max-w-xl bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl text-neutral-100 relative my-6 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-800 bg-neutral-950/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-700/80 text-emerald-400">
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="privacy-modal-title" className="text-base sm:text-lg font-black text-white leading-tight">
                  PRIVACY & SAFETY
                </h2>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-bold">
                  v1.0
                </span>
              </div>
              <p className="text-xs text-neutral-400 font-medium">
                Your control matters. Built with privacy-first emergency principles.
              </p>
            </div>
          </div>

          <button
            id="close-privacy-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
            title="Close Privacy & Safety screen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Active Mode Indicator Banner */}
        <div className="px-4 py-2.5 bg-neutral-950/40 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-neutral-400 font-semibold">Active Engine Mode:</span>
          {offlineForce ? (
            <span className="px-2.5 py-1 rounded-full bg-amber-950 border border-amber-700 text-amber-300 font-bold flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span>OFFLINE FALLBACK (Zero Network Transmission)</span>
            </span>
          ) : isOnlineMode ? (
            <span className="px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-300 font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>ONLINE AI (Nebius Token Factory / Nemotron)</span>
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-300 font-bold flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-neutral-400" />
              <span>OFFLINE READY (Deterministic Engine)</span>
            </span>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-neutral-800 bg-neutral-950/60 px-4 pt-2 gap-2 text-xs font-bold">
          <button
            id="tab-privacy-card"
            onClick={() => setActiveTab('quick')}
            className={`pb-2 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'quick'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Core Privacy Card</span>
          </button>
          <button
            id="tab-full-statement"
            onClick={() => setActiveTab('statement')}
            className={`pb-2 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'statement'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Full Privacy Statement (11 Principles)</span>
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs sm:text-sm leading-relaxed flex-1">
          {activeTab === 'quick' ? (
            /* Recommended Core Summary Screen */
            <div className="space-y-3.5" id="privacy-quick-card">
              <div className="text-center pb-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-xs font-bold text-neutral-200 mb-1">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>🔒 PRIVACY & SAFETY</span>
                </div>
                <div className="text-base font-black text-white">Your control matters.</div>
              </div>

              {/* ONLINE AI */}
              <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-400 shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-extrabold text-white text-xs uppercase tracking-wide flex items-center gap-2">
                    <span>ONLINE AI</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-900/60 text-emerald-300">
                      Minimal Payload
                    </span>
                  </div>
                  <p className="text-neutral-300 text-xs mt-0.5 font-medium">
                    Emergency text → Nebius/Nemotron
                  </p>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Only information needed for emergency processing is sent.
                  </p>
                </div>
              </div>

              {/* OFFLINE FALLBACK */}
              <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-400 shrink-0 mt-0.5">
                  <WifiOff className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-extrabold text-white text-xs uppercase tracking-wide">
                    OFFLINE FALLBACK
                  </div>
                  <p className="text-neutral-300 text-xs mt-0.5 font-medium">
                    No network transmission.
                  </p>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Deterministic on-device triage runs completely isolated from the internet.
                  </p>
                </div>
              </div>

              {/* LOCATION */}
              <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-sky-950/60 border border-sky-800 text-sky-400 shrink-0 mt-0.5">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-extrabold text-white text-xs uppercase tracking-wide">
                    📍 LOCATION
                  </div>
                  <p className="text-neutral-300 text-xs mt-0.5 font-medium">
                    Never shared without your permission.
                  </p>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Collected on-demand only when you explicitly tap "Attach GPS".
                  </p>
                </div>
              </div>

              {/* SHARING */}
              <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-purple-950/60 border border-purple-800 text-purple-400 shrink-0 mt-0.5">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-extrabold text-white text-xs uppercase tracking-wide">
                    📤 SHARING
                  </div>
                  <p className="text-neutral-300 text-xs mt-0.5 font-medium">
                    You review and confirm before sending.
                  </p>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Full preview of emergency payload is shown prior to any transmission.
                  </p>
                </div>
              </div>

              {/* EMERGENCY SERVICES */}
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/80 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-red-900/60 border border-red-700 text-red-400 shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-extrabold text-red-300 text-xs uppercase tracking-wide">
                    🚨 EMERGENCY SERVICES
                  </div>
                  <p className="text-neutral-200 text-xs mt-0.5 font-bold">
                    LifeLine AI does not automatically contact authorities or emergency services.
                  </p>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Always dial 911, 112, or 108 directly when in life-threatening distress.
                  </p>
                </div>
              </div>

              {/* Local Storage Opt-in Setting */}
              <div className="p-3 rounded-xl bg-neutral-950/90 border border-neutral-800 mt-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-white text-xs flex items-center gap-1.5">
                      <EyeOff className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Local Emergency History Storage</span>
                    </div>
                    <p className="text-neutral-400 text-[11px] mt-0.5">
                      {historyStorageEnabled
                        ? `Enabled (${storedReportsCount} saved reports on this device)`
                        : 'Disabled by default to protect privacy (reports vanish on reload)'}
                    </p>
                  </div>
                  <button
                    id="toggle-history-storage-btn"
                    onClick={() => onToggleHistoryStorage(!historyStorageEnabled)}
                    className="text-neutral-300 hover:text-white transition-colors"
                    title={historyStorageEnabled ? 'Disable storage' : 'Enable local storage'}
                  >
                    {historyStorageEnabled ? (
                      <ToggleRight className="w-7 h-7 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-7 h-7 text-neutral-600" />
                    )}
                  </button>
                </div>

                {storedReportsCount > 0 && (
                  <div className="mt-2 pt-2 border-t border-neutral-800 flex justify-end">
                    <button
                      onClick={onClearHistory}
                      className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear all stored reports now</span>
                    </button>
                  </div>
                )}
              </div>

              {/* CONTACT & PRIVACY REQUESTS */}
              <PrivacyContactCard onOpenContactForm={onOpenContactForm} />
            </div>
          ) : (
            /* Full Verbatim Privacy Statement (11 Principles) */
            <div className="space-y-3" id="privacy-full-statement">
              <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800">
                <h3 className="font-black text-sm text-white uppercase tracking-wider mb-1">
                  LIFELINE AI — PRIVACY & SAFETY
                </h3>
                <p className="text-neutral-300 text-xs font-semibold">
                  LifeLine AI is designed to minimize the information required during an emergency.
                </p>
              </div>

              <ul className="space-y-2.5 text-xs text-neutral-300">
                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Voice and emergency messages</strong> are processed only when the user activates the emergency/voice function.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    In <strong>Online AI Mode</strong>, the required emergency text is sent securely to the configured Nebius Token Factory service for Nemotron processing.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Do not send unnecessary personal information</strong> to the AI model. Only situation, symptoms, and immediate threats are analyzed.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Location must never be collected or shared</strong> without explicit user permission.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Before sharing an emergency alert or location</strong>, clearly show what information will be shared and require user confirmation.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>LifeLine AI does not automatically contact</strong> government authorities, emergency services, or other people without a user-initiated action.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Offline Fallback Mode</strong> must not transmit data over the network. All triage heuristics run entirely on-device.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Clearly indicate</strong> whether the application is in Online AI Mode or Offline Fallback Mode.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Do not store voice recordings or emergency information</strong> unless the user explicitly enables a storage feature.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Never expose API keys or secrets</strong> in the frontend. All credentials remain protected in the backend proxy.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 p-2 rounded-lg bg-neutral-950/60 border border-neutral-800/80">
                  <CheckCircle2 className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>LifeLine AI is an emergency communication assistance tool</strong> and does not replace professional emergency services.
                  </span>
                </li>
              </ul>

              {/* CONTACT & PRIVACY REQUESTS */}
              <PrivacyContactCard onOpenContactForm={onOpenContactForm} compact />
            </div>
          )}
        </div>

        {/* Footer with Contact Privacy Team + [ I UNDERSTAND ] Buttons */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/90 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => setActiveTab(activeTab === 'quick' ? 'statement' : 'quick')}
            className="text-xs text-neutral-400 hover:text-white underline underline-offset-2"
          >
            {activeTab === 'quick' ? 'View Full Statement (11 Principles)' : 'Back to Summary Card'}
          </button>

          <div className="flex items-center gap-2 ml-auto">
            {onOpenContactForm && (
              <button
                id="privacy-contact-team-btn"
                type="button"
                onClick={onOpenContactForm}
                title="Open the Privacy Contact Form"
                className="px-3 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-emerald-800/70 text-emerald-300 font-bold text-xs transition-colors flex items-center gap-1.5"
              >
                <Mail className="w-4 h-4 text-emerald-400" />
                <span>Contact Privacy Team</span>
              </button>
            )}

            <button
              id="privacy-understand-btn"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm transition-all shadow-lg shadow-emerald-950/50 flex items-center gap-2 active:scale-95"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>[ I UNDERSTAND ]</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
