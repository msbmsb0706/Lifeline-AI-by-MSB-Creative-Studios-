import React from 'react';
import { MapPin, ShieldCheck, X, Check, AlertCircle } from 'lucide-react';

interface LocationPrivacyModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const LocationPrivacyModal: React.FC<LocationPrivacyModalProps> = ({
  isOpen,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  return (
    <div
      id="location-privacy-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-privacy-title"
    >
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl p-5 shadow-2xl text-neutral-100 relative">
        <button
          id="close-location-privacy-btn"
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-3.5">
          <div className="p-2.5 rounded-xl bg-sky-950/80 border border-sky-700 text-sky-400">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold text-sky-400 uppercase tracking-wider">
              Privacy Notice
            </div>
            <h3 id="location-privacy-title" className="text-base font-black text-white leading-tight">
              📍 Location Permission Notice
            </h3>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 mb-3.5 text-xs leading-relaxed space-y-2">
          <p className="font-semibold text-white">
            Location must never be collected or shared without explicit user permission.
          </p>
          <ul className="space-y-1.5 text-neutral-300">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">•</span>
              <span>Coordinates are acquired strictly on-demand on this device.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">•</span>
              <span>Attached only to your active emergency dispatch draft.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">•</span>
              <span>LifeLine AI never automatically transmits location to authorities or third parties.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">•</span>
              <span>You review and confirm all shared information before dispatching.</span>
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            id="cancel-location-permission-btn"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            id="confirm-location-permission-btn"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-sky-950"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Allow & Acquire GPS</span>
          </button>
        </div>
      </div>
    </div>
  );
};
