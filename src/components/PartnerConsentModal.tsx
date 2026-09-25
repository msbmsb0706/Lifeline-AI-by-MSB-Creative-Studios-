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
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-md overflow-y-auto p-3 sm:p-6 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-modal-title"
    >
      <div className="w-full max-w-xl rounded-2xl border-2 border-red-600 bg-neutral-950 text-white shadow-2xl overflow-hidden my-4">
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

        <div className="p-4 sm:p-5 space-y-4 text-xs sm:text-sm">
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

          {/* Local records never receive transmission approval or a partner destination. */}
          {isLocalOnly && (
            <div className="p-3 rounded-xl bg-amber-950/80 border-2 border-amber-600 text-amber-100 text-xs font-bold">
              LOCAL SAVE ONLY — Nothing will be sent to any partner, TEST/DEMO endpoint, or emergency service.
              Without the optional consent below, reconnecting and reopening will not upload this SOS. You can share the saved text manually from the queue.
              Save a video to your device separately before closing this page.
            </div>
          )}

          {isLocalOnly && (
            <label className="block p-3 rounded-xl border border-amber-700 text-amber-100 text-xs">
              <span className="flex items-start gap-2 font-bold"><input type="checkbox" checked={automaticRecovery}
                onChange={(e) => setAutomaticRecovery(e.target.checked)} />
                Automatically send this SOS when a verified Internet connection becomes available.</span>
              <span className="block mt-2">If enabled, LifeLine will attempt to send this confirmed SOS when a verified Internet connection becomes available, only to a configured authorized API. No GPS or photo/video bytes will be sent automatically. If no destination is configured, your SOS stays local. Recovery works only while this web application can execute.</span>
            </label>
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
                  <span>{isLocalOnly && automaticRecovery ? 'SAVE LOCALLY + AUTOMATIC RECOVERY' : 'SAVE LOCALLY'}</span>
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
