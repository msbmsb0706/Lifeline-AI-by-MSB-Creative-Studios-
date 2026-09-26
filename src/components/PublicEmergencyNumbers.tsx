import React, { useState } from 'react';
import { ChevronRight, MapPinOff, PhoneCall, ShieldCheck } from 'lucide-react';
import { listPublicEmergencyNumbers } from '../lib/emergencyNumbers.ts';

interface PublicEmergencyNumbersProps {
  /** Collapsed by default on the SOS card; open by default in the directory. */
  defaultOpen?: boolean;
  /** Country code to highlight, when the person has chosen one. */
  highlightCountry?: string | null;
  /** Dense variant for the top banner. */
  compact?: boolean;
}

/**
 * Every government / public emergency number this app knows, always visible.
 *
 * Deliberately unconditional:
 *  - NO GPS or geolocation is ever used or requested to build this list;
 *  - NO sign-in, API key or partner authentication is required to read it;
 *  - the numbers come from the verified public-contact directory only and are
 *    never invented. A country the app has not verified simply is not listed.
 *
 * The country selector elsewhere only decides which ONE number is promoted in
 * the banner — it never hides the others.
 */
export const PublicEmergencyNumbers: React.FC<PublicEmergencyNumbersProps> = ({
  defaultOpen = false,
  highlightCountry = null,
  compact = false
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const entries = listPublicEmergencyNumbers();

  if (!entries.length) return null;

  const sorted = [...entries].sort((a, b) => {
    const code = (highlightCountry || '').toUpperCase();
    if (code) {
      if (a.country === code && b.country !== code) return -1;
      if (b.country === code && a.country !== code) return 1;
    }
    return a.country.localeCompare(b.country) || a.serviceType.localeCompare(b.serviceType);
  });

  return (
    <div
      id="public-emergency-numbers"
      className={`rounded-xl border ${
        compact ? 'bg-neutral-900/90 border-neutral-800' : 'bg-black/40 border-neutral-800'
      }`}
    >
      <button
        id="public-emergency-numbers-toggle"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-bold text-neutral-200">
          <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
          <span>Government emergency numbers ({entries.length}) — public, no sign-in</span>
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-400">
            <span className="flex items-center gap-1">
              <MapPinOff className="w-3 h-3 text-emerald-400" />
              <span>No GPS or location needed to see these</span>
            </span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>No account, no partner authentication</span>
            </span>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {sorted.map((entry) => {
              const highlighted =
                Boolean(highlightCountry) && entry.country === String(highlightCountry).toUpperCase();
              return (
                <li
                  key={`${entry.country}-${entry.serviceType}-${entry.phone}`}
                  className={`p-2 rounded-lg border text-xs flex items-start justify-between gap-2 ${
                    highlighted
                      ? 'bg-emerald-950/50 border-emerald-700'
                      : 'bg-neutral-900/70 border-neutral-800'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-bold text-white">
                      {entry.countryName}
                      {highlighted && (
                        <span className="ml-1 text-[10px] text-emerald-300 font-extrabold">(selected)</span>
                      )}
                    </div>
                    <div className="text-[10px] text-neutral-400 truncate">{entry.providerName}</div>
                    <div className="text-[10px] text-neutral-500 font-mono">{entry.serviceType}</div>
                  </div>
                  <a
                    href={`tel:${entry.phone}`}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-black text-xs flex items-center gap-1 transition-colors"
                  >
                    <PhoneCall className="w-3 h-3" />
                    <span>{entry.phone}</span>
                  </a>
                </li>
              );
            })}
          </ul>

          <p className="text-[10px] text-neutral-500">
            Numbers come from verified official government sources only. A country that is not listed has not been
            verified — call your local emergency service. LifeLine AI never invents an emergency number.
          </p>
        </div>
      )}
    </div>
  );
};
