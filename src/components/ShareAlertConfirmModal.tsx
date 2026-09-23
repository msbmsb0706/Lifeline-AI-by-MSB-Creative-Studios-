import React, { useState } from 'react';
import { Share2, MapPin, ShieldAlert, X, Check, Copy, AlertTriangle } from 'lucide-react';
import { EmergencyAnalysisResult } from '../types.ts';
import { looksLikeGeneratedDispatch } from '../lib/translationSafety.ts';

interface ShareAlertConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: EmergencyAnalysisResult;
  onConfirmShare: () => void;
}

export const ShareAlertConfirmModal: React.FC<ShareAlertConfirmModalProps> = ({
  isOpen,
  onClose,
  result,
  onConfirmShare
}) => {
  const [includeLocation, setIncludeLocation] = useState(true);

  if (!isOpen) return null;

  const hasLocation = Boolean(result.location_coordinates);
  const locationText = result.location_coordinates
    ? `Lat ${result.location_coordinates.latitude.toFixed(5)}, Lng ${result.location_coordinates.longitude.toFixed(5)}`
    : 'No location attached';

  // Preview guard (PR #16): a stored translation that looks like generated
  // dispatch/triage boilerplate is never previewed as the user's translated
  // transmission — the dispatch message is shown instead.
  const storedTranslation = result.translation?.translated_message || '';
  const previewText =
    storedTranslation && !looksLikeGeneratedDispatch(storedTranslation) ? storedTranslation : result.message;

  return (
    <div
      id="share-alert-confirm-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-confirm-title"
    >
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl p-5 shadow-2xl text-neutral-100 relative my-6">
        <button
          id="close-share-confirm-btn"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-purple-950 border border-purple-700 text-purple-400">
            <Share2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold text-purple-400 uppercase tracking-wider">
              User Review & Confirmation
            </div>
            <h3 id="share-confirm-title" className="text-base sm:text-lg font-black text-white leading-tight">
              Review Alert Before Sharing
            </h3>
          </div>
        </div>

        {/* Mandatory Privacy Reminder */}
        <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/80 mb-4 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Explicit User Confirmation Required</p>
            <p className="text-neutral-300 text-[11px] mt-0.5">
              LifeLine AI does not automatically contact government authorities, emergency services, or other people. You are choosing to share this alert now.
            </p>
          </div>
        </div>

        {/* Content That Will Be Shared */}
        <div className="space-y-3 mb-4 text-xs">
          <div className="font-semibold text-neutral-300 uppercase tracking-wider text-[10px]">
            Data That Will Be Transmitted:
          </div>

          <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-400">Emergency Priority:</span>
              <span className="font-bold text-red-400 px-1.5 py-0.5 rounded bg-red-950 border border-red-800">
                Priority {result.severity}/5 ({result.emergency_category || 'EMERGENCY'})
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-400">Emergency Type:</span>
              <span className="font-semibold text-white">{result.emergency_type}</span>
            </div>

            <div className="pt-2 border-t border-neutral-800/70">
              <span className="text-neutral-400 text-[11px] block mb-1">Dispatch Message:</span>
              <p className="text-neutral-200 text-xs font-mono bg-neutral-900 p-2.5 rounded-lg border border-neutral-800 leading-relaxed max-h-28 overflow-y-auto">
                {previewText}
              </p>
            </div>

            {hasLocation && (
              <div className="pt-2 border-t border-neutral-800/70 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sky-400">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="font-mono text-[11px]">{locationText}</span>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeLocation}
                    onChange={(e) => setIncludeLocation(e.target.checked)}
                    className="rounded border-neutral-700 text-purple-600 focus:ring-0"
                  />
                  <span>Include GPS</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Confirmation Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            id="cancel-share-btn"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            id="confirm-share-alert-btn"
            onClick={() => {
              onConfirmShare();
              onClose();
            }}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-lg shadow-purple-950 flex items-center gap-2 active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Confirm & Transmit / Copy</span>
          </button>
        </div>
      </div>
    </div>
  );
};
