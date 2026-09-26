import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield,
  X,
  PhoneCall,
  MapPinOff,
  ShieldCheck,
  Check,
  ExternalLink,
  Info
} from 'lucide-react';
import { SUPPORTED_COUNTRIES } from '../lib/emergencyPartnersData.ts';
import {
  EMERGENCY_NUMBER_NOT_CONFIGURED,
  listPublicEmergencyNumbers,
  type PublicEmergencyNumberEntry
} from '../lib/emergencyNumbers.ts';

interface EmergencyNumbersModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Country already chosen by the person (highlighted in the list). It only
   * decides which single number the top banner promotes — it never hides the
   * rest of the verified directory.
   */
  selectedCountry?: string | null;
  /**
   * Called when a country row is chosen. The call-site persists the selection
   * (shared storage key) so the banner immediately shows that country's
   * configured number.
   */
  onSelectCountry?: (countryCode: string) => void;
  /** Optional extra block rendered above the country list (call-site content). */
  children?: React.ReactNode;
}

/** Length of the slide-in / slide-out CSS transition (ms) — mirrors the class below. */
export const EMERGENCY_NUMBERS_SHEET_TRANSITION_MS = 300;

/** Human label for the directory service codes. */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  GENERAL_EMERGENCY: 'General emergency',
  AMBULANCE: 'Ambulance',
  POLICE: 'Police',
  FIRE: 'Fire',
  RESCUE: 'Rescue',
  COAST_GUARD: 'Coast guard',
  MOUNTAIN_RESCUE: 'Mountain rescue'
};

function serviceLabel(serviceType: string): string {
  return SERVICE_TYPE_LABELS[serviceType] || serviceType;
}

interface CountryRow {
  code: string;
  name: string;
  flag: string;
  entries: PublicEmergencyNumberEntry[];
  /** The GENERAL_EMERGENCY number this country promotes in the banner (or null). */
  promoted: string | null;
}

/**
 * Sliding bottom-sheet layer that lists every verified public/government
 * emergency number, grouped by country.
 *
 * Contracts (PR #16 / PR #28):
 *  - the list is PUBLIC: no GPS/geolocation, no sign-in, no partner
 *    authentication is ever used or requested to build it;
 *  - numbers come only from the verified directory — one is never invented. A
 *    country without a verified number shows the explicit not-configured notice
 *    instead of a guess, and cannot be selected;
 *  - choosing a country only promotes that ONE number in the top banner; the
 *    rest of the directory stays visible.
 *
 * The sheet stays mounted through its slide-out so the transition can play, and
 * the rest of the app (including the voice button) is never unmounted — closing
 * the sheet returns the person exactly where they were.
 */
export const EmergencyNumbersModal: React.FC<EmergencyNumbersModalProps> = ({
  isOpen,
  onClose,
  selectedCountry = null,
  onSelectCountry,
  children
}) => {
  // `mounted` keeps the sheet in the DOM during the exit transition; `visible`
  // drives the actual translate-y animation (painted one frame after mount).
  const [mounted, setMounted] = useState<boolean>(isOpen);
  const [visible, setVisible] = useState<boolean>(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      let frame = 0;
      if (typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(() => setVisible(true));
      } else {
        frame = setTimeout(() => setVisible(true), 16) as unknown as number;
      }
      return () => {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        else clearTimeout(frame);
      };
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), EMERGENCY_NUMBERS_SHEET_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Escape closes the sheet, like every other modal layer in the app.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Esc') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // While the layer slides out it is aria-hidden: focus must not stay inside it,
  // so the person's next Tab continues in the app behind (Tap to Speak, etc.).
  useEffect(() => {
    if (isOpen) return;
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && sheetRef.current && sheetRef.current.contains(active)) active.blur();
    } catch {
      // Focus handling is best-effort; never block closing the layer.
    }
  }, [isOpen]);

  // Move focus into the sheet so keyboard/screen-reader users land on it.
  useEffect(() => {
    if (!isOpen || !visible) return;
    try {
      closeBtnRef.current?.focus();
    } catch {
      // Focus is best-effort; never block an emergency list on it.
    }
  }, [isOpen, visible]);

  const rows = useMemo<CountryRow[]>(() => {
    const entries = listPublicEmergencyNumbers();
    const known = new Map<string, CountryRow>();

    for (const country of SUPPORTED_COUNTRIES) {
      // "Global / Test Providers" is a demo bucket, not a country: it has no
      // public emergency number and must never be offered as one.
      if (country.code === 'GLOBAL') continue;
      known.set(country.code, {
        code: country.code,
        name: country.name,
        flag: country.flag,
        entries: [],
        promoted: null
      });
    }

    for (const entry of entries) {
      let row = known.get(entry.country);
      if (!row) {
        row = { code: entry.country, name: entry.countryName, flag: '', entries: [], promoted: null };
        known.set(entry.country, row);
      }
      row.entries.push(entry);
      if (entry.serviceType === 'GENERAL_EMERGENCY' && row.promoted === null) {
        row.promoted = entry.phone;
      }
    }

    return [...known.values()].sort(
      (a, b) =>
        // Countries with a verified number first, then alphabetical.
        Number(b.entries.length > 0) - Number(a.entries.length > 0) ||
        a.name.localeCompare(b.name) ||
        a.code.localeCompare(b.code)
    );
  }, []);

  if (!mounted) return null;

  const selectedCode = selectedCountry ? String(selectedCountry).toUpperCase().trim() : '';

  return (
    <div
      id="emergency-numbers-modal-overlay"
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      aria-hidden={!isOpen}
    >
      <div
        id="emergency-numbers-modal"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-numbers-modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`w-full sm:max-w-lg max-h-[88vh] flex flex-col bg-neutral-900 border border-neutral-700 shadow-2xl text-neutral-100 rounded-t-2xl sm:rounded-2xl transition-transform duration-300 ease-out ${
          visible ? 'translate-y-0' : 'translate-y-full sm:translate-y-8'
        }`}
      >
        {/* Grab handle — signals a swipeable layer on touch devices. */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-neutral-700" />
        </div>

        {/* Header */}
        <div className="flex items-start gap-3 px-4 pt-2.5 pb-3 border-b border-neutral-800">
          <div className="p-2.5 rounded-xl bg-red-950 border border-red-800 text-red-400 shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
              Triage / Alert Navigation
            </div>
            <h3
              id="emergency-numbers-modal-title"
              className="text-base sm:text-lg font-black text-white leading-tight"
            >
              Select country to view its emergency number
            </h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Public, verified government numbers — no sign-in, no location, nothing hidden.
            </p>
          </div>
          <button
            id="close-emergency-numbers-btn"
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close emergency numbers"
            className="shrink-0 p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Privacy line — the sheet never asks for GPS or an account. */}
        <div className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-400 bg-neutral-950/60 border-b border-neutral-800">
          <span className="flex items-center gap-1">
            <MapPinOff className="w-3 h-3 text-emerald-400" />
            <span>No GPS or location needed to see these</span>
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>No account, no partner authentication</span>
          </span>
        </div>

        {/* Country rows (loop container) */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {children}

          <ul id="emergency-numbers-country-list" className="space-y-2">
            {rows.map((row) => {
              const isSelected = Boolean(selectedCode) && row.code === selectedCode;
              const hasNumber = row.entries.length > 0;
              return (
                <li
                  key={row.code}
                  id={`emergency-number-row-${row.code}`}
                  className={`rounded-xl border p-2.5 ${
                    isSelected
                      ? 'bg-emerald-950/50 border-emerald-700'
                      : hasNumber
                        ? 'bg-neutral-950/70 border-neutral-800'
                        : 'bg-neutral-950/40 border-neutral-800/70 opacity-80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      {row.flag && (
                        <span className="text-lg leading-none" aria-hidden="true">
                          {row.flag}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-white truncate">
                          {row.name}
                          {isSelected && (
                            <span className="ml-1.5 text-[10px] text-emerald-300 font-extrabold uppercase">
                              selected
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-neutral-500 font-mono">{row.code}</div>
                      </div>
                    </div>

                    {hasNumber && (
                      <button
                        id={`select-country-btn-${row.code}`}
                        type="button"
                        onClick={() => onSelectCountry?.(row.code)}
                        aria-pressed={isSelected}
                        className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-black flex items-center gap-1 transition-colors ${
                          isSelected
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700'
                        }`}
                      >
                        {isSelected ? <Check className="w-3.5 h-3.5" /> : null}
                        <span>{isSelected ? 'In use' : 'Use'}</span>
                      </button>
                    )}
                  </div>

                  {hasNumber ? (
                    <div className="mt-2 space-y-1.5">
                      {row.entries.map((entry) => (
                        <div
                          key={`${entry.country}-${entry.serviceType}-${entry.phone}`}
                          className="flex items-center justify-between gap-2 rounded-lg bg-neutral-900/70 border border-neutral-800 px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] font-bold text-neutral-100">
                              {serviceLabel(entry.serviceType)}
                              {row.promoted === entry.phone && entry.serviceType === 'GENERAL_EMERGENCY' && (
                                <span className="ml-1.5 text-[9px] font-extrabold uppercase text-red-300">
                                  banner
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-500 truncate">
                              {entry.providerName}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5">
                            {entry.website && (
                              <a
                                href={entry.website}
                                target="_blank"
                                rel="noreferrer noopener"
                                aria-label={`${entry.countryName} official source (opens in a new tab)`}
                                className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <a
                              href={`tel:${entry.phone}`}
                              className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-black text-xs flex items-center gap-1 transition-colors"
                            >
                              <PhoneCall className="w-3 h-3" />
                              <span>{entry.phone}</span>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p
                      id={`emergency-number-not-configured-${row.code}`}
                      className="mt-2 text-[11px] text-neutral-400 flex items-start gap-1.5"
                    >
                      <Info className="w-3.5 h-3.5 text-neutral-500 shrink-0 mt-0.5" />
                      <span>
                        {EMERGENCY_NUMBER_NOT_CONFIGURED} No verified official number is stored for this
                        country yet — LifeLine AI never invents one.
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-neutral-800 bg-neutral-950/70 sm:rounded-b-2xl">
          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Choosing a country only decides which single number the top banner promotes — every other
            verified number above stays visible. Numbers come from official government sources only;
            a country that is not listed has not been verified. In immediate life danger, call your
            local emergency service directly.
          </p>
          <button
            id="emergency-numbers-done-btn"
            type="button"
            onClick={onClose}
            className="mt-2.5 w-full py-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-black transition-colors"
          >
            Done — back to Tap to Speak
          </button>
        </div>
      </div>
    </div>
  );
};
