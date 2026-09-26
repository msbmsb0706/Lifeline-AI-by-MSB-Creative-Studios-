import React, { useEffect, useState } from 'react';
import {
  EmergencyPartnerProvider,
  SOSPackage,
  MediaAttachmentInfo
} from '../types.ts';
import {
  ShieldAlert,
  CheckCircle2,
  X,
  AlertTriangle,
  FileText,
  MapPin,
  Image as ImageIcon,
  Video,
  Clock,
  Send,
  Save,
  Info
} from 'lucide-react';

interface PartnerConsentModalProps {
  isOpen: boolean;
  provider: EmergencyPartnerProvider;
  sosPackage: SOSPackage;
  isOffline: boolean;
  onCancel: () => void;
  onConfirm: (options: { includeGps: boolean; automaticRecovery: boolean }) => void;
  /** True only for a separately reviewed, configured authorized-partner handoff. */
  allowGpsSelection?: boolean;
}

export const PartnerConsentModal: React.FC<PartnerConsentModalProps> = ({
  isOpen,
  provider,
  sosPackage,
  isOffline,
  onCancel,
  onConfirm,
  allowGpsSelection = false
}) => {
  const [includeGps, setIncludeGps] = useState(false);
  const [automaticRecovery, setAutomaticRecovery] = useState(false);
  useEffect(() => { setIncludeGps(false); setAutomaticRecovery(false); }, [isOpen, provider.id, sosPackage.sosId]);
  if (!isOpen) return null;

  const isTestProvider = provider.providerType === 'TEST';
  const isLocalOnly = provider.providerType === 'LOCAL_ONLY';
  const isPublicContact = provider.providerType === 'PUBLIC_CONTACT';
  const isAuthorizedApi = provider.providerType === 'AUTHORIZED_API';

  const photosCount = sosPackage.photos ? sosPackage.photos.length : 0;
  const hasVideo = Boolean(sosPackage.video);
  const mediaSupported = Boolean(provider.supportsMediaUpload);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain p-3 sm:p-6 flex items-start sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-modal-title"
    >
      <div className="w-full max-w-xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] rounded-2xl border-2 border-red-600 bg-neutral-950 text-white shadow-2xl overflow-hidden my-0 sm:my-4 flex flex-col">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-neutral-900 border-b border-neutral-800 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-950 text-red-400 border border-red-800">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] font-black tracking-widest text-red-400 uppercase">
                USER REVIEW & CONSENT
              </div>
              <h2 id="consent-modal-title" className="text-lg sm:text-xl font-black">
                {isLocalOnly ? 'SAVE SOS ON THIS DEVICE' : 'EMERGENCY PARTNER'}
              </h2>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
            aria-label="Cancel partner consent"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          role="region"
          tabIndex={0}
          aria-label="Consent details. Scroll or swipe vertically to review."
          className="min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5 space-y-4 text-xs sm:text-sm"
        >
          {/* Destination Provider Box */}
          <div className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
            <div className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase">
              {isLocalOnly ? 'Save destination — no partner' : 'Destination Provider'}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-extrabold text-white text-base">
                {provider.providerName}
              </div>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase tracking-wider ${
                  isLocalOnly
                    ? 'bg-amber-950 text-amber-300 border-amber-700'
                    : isTestProvider
                    ? 'bg-purple-950 text-purple-300 border-purple-700'
                    : isAuthorizedApi
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-blue-950 text-blue-300 border-blue-700'
                }`}
              >
                {isLocalOnly
                  ? 'LOCAL ONLY — NOT SENT'
                  : isTestProvider
                  ? 'TEST / DEMO'
                  : isAuthorizedApi
                  ? 'AUTHORIZED API'
                  : 'PUBLIC CONTACT'}
              </span>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">
              {provider.description}
            </p>
          </div>

          {/*
            The offline choice is the FIRST thing after the destination: on a
            phone the old layout pushed "SAVE ON THIS DEVICE ONLY" below the
            fold, so only the auto-send option was visible without scrolling.
            Both choices are stacked vertically before the long details, and the
            dialog body scrolls up and down on smaller screens.
          */}
          {isLocalOnly && (
            <div
              id="offline-save-choice"
              className="p-3 rounded-xl border-2 border-amber-600 bg-neutral-900/70 text-xs space-y-2"
            >
              <div className="font-black text-amber-200 uppercase tracking-wider text-[11px]">
                Choose what happens when the connection comes back
              </div>
              <p className="text-[11px] text-neutral-400">
                Both choices are above. Swipe or scroll down to review the details.
              </p>

              <div className="flex flex-col gap-2">
                <label
                  className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors font-bold text-white ${
                    !automaticRecovery ? 'border-amber-500 bg-amber-950/40' : 'border-neutral-700 bg-neutral-950/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="lifeline-offline-choice"
                    checked={!automaticRecovery}
                    onChange={() => setAutomaticRecovery(false)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    SAVE ON THIS DEVICE ONLY
                    <span className="block mt-1 text-[11px] font-semibold text-neutral-300">
                      Default — nothing is ever sent automatically. You share it yourself.
                    </span>
                  </span>
                </label>

                <label
                  className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors font-bold text-white ${
                    automaticRecovery ? 'border-emerald-600 bg-emerald-950/40' : 'border-neutral-700 bg-neutral-950/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="lifeline-offline-choice"
                    checked={automaticRecovery}
                    onChange={() => setAutomaticRecovery(true)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    SAVE + AUTO-SEND WHEN THE CONNECTION RETURNS
                    <span className="block mt-1 text-[11px] font-semibold text-neutral-300">
                      Sends by itself only if every condition listed below is true.
                    </span>
                  </span>
                </label>
              </div>

              <div className="p-2.5 rounded-lg bg-neutral-950/70 border border-neutral-800 space-y-2">
                <div>
                  <div className="font-black text-white">SAVE ON THIS DEVICE ONLY — what it does</div>
                  <p className="mt-1 text-neutral-300">
                    Nothing is ever sent automatically, now or later. Open the Pending SOS Queue and use
                    <b> SHARE VIA DEVICE</b> (WhatsApp / SMS / call) or <b>SEND NOW</b> yourself.
                  </p>
                </div>

                <div className="pt-2 border-t border-neutral-800">
                  <div className="font-black text-white">
                    SAVE + AUTO-SEND WHEN THE CONNECTION RETURNS — what it does
                  </div>
                  <p className="mt-1 text-neutral-300">
                    LifeLine will try to send this exact SOS on its own as soon as ALL of these are true:
                  </p>
                  <ol className="mt-1.5 ml-4 list-decimal space-y-1 text-neutral-300">
                    <li>This page is still open on this device and in the foreground (a tab that is closed or backgrounded cannot run).</li>
                    <li>A real Internet connection is verified — not just a Wi-Fi icon. LifeLine pings this server and continues only on a genuine reply.</li>
                    <li>An authorized partner destination is actually configured on the server. If none is, nothing is sent and the SOS stays here.</li>
                    <li>You have not deleted the record or already sent it from the Pending SOS Queue.</li>
                  </ol>
                  <p className="mt-1.5 text-neutral-400">
                    Never sent automatically: GPS coordinates, photos, video. When it does send, the status card on
                    your SOS turns 🟢 SOS SENT — until then it says <b>NOT SENT</b>.
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-neutral-400">
                Either way the record is stored on this device first, so it survives the connection dropping.
                Browser storage can still be cleared by the operating system, so share it yourself if you can.
              </p>
            </div>
          )}

          {/* Local records never receive transmission approval or a partner destination. */}
          {isLocalOnly && (
            <div className="p-3 rounded-xl bg-amber-950/80 border-2 border-amber-600 text-amber-100 text-xs font-bold">
              LOCAL SAVE ONLY — Nothing is being sent now to any partner, TEST/DEMO endpoint, or emergency service.
              Without the optional consent chosen above, reconnecting and reopening will not upload this SOS. You can share the saved text manually from the queue.
              Save a video to your device separately before closing this page.
            </div>
          )}

          {isAuthorizedApi && allowGpsSelection && (
            <div className="p-3 rounded-xl bg-amber-950/70 border border-amber-600 text-amber-100 text-xs space-y-2">
              <label className="flex gap-2 items-start font-bold">
                <input type="checkbox" checked={includeGps} disabled={!sosPackage.gps || isOffline}
                  onChange={(event) => setIncludeGps(event.target.checked)} />
                Include this saved ONE-TIME GPS fix in the authorized partner handoff.
                {sosPackage.gps ? ' Off by default.' : ' No saved fix available.'}
              </label>
              <p>Live GPS tracking is separate and stays OFF unless you later opt in again AND a verified partner accepts an assigned case.</p>
            </div>
          )}

          {/* Test or Public Contact Notice Banner */}
          {isTestProvider && (
            <div className="p-3 rounded-xl bg-purple-950/80 border-2 border-purple-600 text-purple-200 flex items-start gap-2.5">
              <Info className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-black uppercase tracking-wider text-xs text-white">
                  TEST / DEMO PROVIDER
                </div>
                <div className="text-xs mt-0.5 text-purple-200 font-semibold">
                  TEST / DEMO — NO REAL EMERGENCY SERVICE WILL RECEIVE THIS ALERT.
                </div>
              </div>
            </div>
          )}

          {isPublicContact && (
            <div className="p-3 rounded-xl bg-blue-950/80 border-2 border-blue-600 text-blue-200 flex items-start gap-2.5">
              <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-black uppercase tracking-wider text-xs text-white">
                  PUBLIC EMERGENCY CONTACT ONLY
                </div>
                <div className="text-xs mt-0.5 text-blue-200">
                  Public contact channels do not accept digital API payloads.
                  Call official line <span className="font-extrabold text-white">{provider.phone || 'directly'}</span>.
                </div>
              </div>
            </div>
          )}

          {/* Offline Notice Banner */}
          {isOffline && !isLocalOnly && (
            <div className="p-3 rounded-xl bg-amber-950/80 border border-amber-700 text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-black uppercase text-xs">OFFLINE MODE ACTIVE</div>
                <div className="text-xs mt-0.5">
                  OFFLINE — only SOS text/metadata is saved here; it is NOT sent now. Reopening can attempt recovery only if you opt in below. Manually choose an authorized destination if one becomes available. No emergency service receives TEST/DEMO alerts.
                </div>
              </div>
            </div>
          )}

          {/* Data That May Be Sent Checklist */}
          <div className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2.5">
            <div className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase">
              {isLocalOnly ? 'Data saved on this device (not sent):' : 'Data that may be sent:'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <b>Emergency type:</b> {sosPackage.emergencyType}
                </span>
              </div>

              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <b>Severity:</b> Level {sosPackage.severity}/5
                </span>
              </div>

              <div className="flex items-center gap-2 text-emerald-300 col-span-1 sm:col-span-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">
                  <b>Message:</b> "{sosPackage.message}"
                </span>
              </div>
              {sosPackage.originalTranscript && (
                <div className="text-emerald-300 col-span-1 sm:col-span-2" dir="auto">
                  <b>Original typed/spoken words ({sosPackage.detectedLanguage?.name || 'as entered'}):</b>{' '}
                  {sosPackage.originalTranscript}
                </div>
              )}
              {sosPackage.translation?.translatedMessage && (
                <div className="text-emerald-300 col-span-1 sm:col-span-2" dir="auto">
                  <b>Translation ({sosPackage.translation.targetLanguageName}):</b>{' '}
                  {sosPackage.translation.translatedMessage}
                </div>
              )}

              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <b>GPS location:</b>{' '}
                  {isAuthorizedApi && allowGpsSelection && !includeGps
                    ? 'Not sent (opt-in unchecked)'
                    : sosPackage.gps
                    ? `${sosPackage.gps.latitude.toFixed(4)}, ${sosPackage.gps.longitude.toFixed(4)}`
                    : 'Not available'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <b>Timestamp:</b>{' '}
                  {new Date(sosPackage.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>

              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <b>Up to 2 photos:</b>{' '}
                  {photosCount > 0
                    ? `${photosCount} photo(s) selected — file details only, NOT the images`
                    : 'No photos'}
                  {!mediaSupported && !isLocalOnly && photosCount > 0 && (
                    <span className="text-amber-400 text-[10px] block">
                      (Excluded: destination does not support photo uploads)
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <b>10-second video:</b>{' '}
                  {hasVideo ? 'Video selected — file details only, NOT the recording' : 'No video'}
                  {!mediaSupported && !isLocalOnly && hasVideo && (
                    <span className="text-amber-400 text-[10px] block">
                      (Excluded: destination does not support video uploads)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <p className="p-2.5 rounded-lg border border-amber-700 bg-amber-950/60 text-amber-200 text-xs">
            Photo/video bytes are NOT saved to this partner queue and cannot be uploaded later from it, even if the destination supports media. Use the device share sheet while the files are still open, or save the video locally first.
          </p>

          {/* Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              id="consent-cancel-btn"
              type="button"
              onClick={onCancel}
              className="py-3 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <X className="w-4 h-4" />
              <span>CANCEL</span>
            </button>

            <button
              id="consent-confirm-send-btn"
              type="button"
              onClick={() => onConfirm({ includeGps: isAuthorizedApi && allowGpsSelection && includeGps && Boolean(sosPackage.gps), automaticRecovery: isLocalOnly && automaticRecovery })}
              className="py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-950 transition-colors"
            >
              {isOffline || isLocalOnly ? (
                <>
                  <Save className="w-4 h-4" />
                  <span>
                    {isLocalOnly && automaticRecovery
                      ? 'SAVE + AUTO-SEND WHEN ONLINE'
                      : 'SAVE ON THIS DEVICE ONLY'}
                  </span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>CONFIRM & SEND</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
