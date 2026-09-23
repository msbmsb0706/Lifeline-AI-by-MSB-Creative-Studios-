/**
 * LifeLine AI — Country-aware emergency numbers (PR #16).
 *
 * Rules:
 * - Country-independent offline guidance NEVER contains hard-coded universal
 *   combinations such as "911 / 112 / 108". Generic guidance always says:
 *     "Contact your local emergency services immediately."
 * - When a configured country-specific number exists (from the verified public
 *   emergency-contact directory), that configured number is displayed.
 * - When the country is unknown or no number is configured for it:
 *     "Emergency number not configured."
 * - An emergency number is NEVER invented.
 */

import { EMERGENCY_PARTNER_PROVIDERS } from './emergencyPartnersData.ts';

/** Generic country-independent guidance sentence (used verbatim). */
export const GENERIC_EMERGENCY_GUIDANCE = 'Contact your local emergency services immediately.';

/** Displayed when the country is unknown or has no configured number. */
export const EMERGENCY_NUMBER_NOT_CONFIGURED = 'Emergency number not configured.';

/** localStorage key shared by the partner directory and the SOS card. */
export const SELECTED_COUNTRY_STORAGE_KEY = 'lifeline_selected_country';

/**
 * Returns the configured general-emergency number for a country code, or null
 * when the country is unknown/unconfigured. The number always comes from the
 * verified PUBLIC_CONTACT directory entry (GENERAL_EMERGENCY service) — it is
 * never invented and never a universal multi-number fallback.
 */
export function getCountryEmergencyNumber(countryCode: string | null | undefined): string | null {
  if (!countryCode || typeof countryCode !== 'string') return null;
  const code = countryCode.toUpperCase().trim();
  if (!code || code === 'GLOBAL' || code === 'ALL') return null;
  const provider = EMERGENCY_PARTNER_PROVIDERS.find(
    (p) =>
      p.country === code &&
      p.providerType === 'PUBLIC_CONTACT' &&
      p.serviceType === 'GENERAL_EMERGENCY' &&
      typeof p.phone === 'string' &&
      p.phone.trim() !== ''
  );
  return provider?.phone?.trim() || null;
}

/**
 * Display text for a country: the configured number, or the explicit
 * not-configured notice. Never a universal fallback combination.
 */
export function getEmergencyNumberDisplay(countryCode: string | null | undefined): string {
  return getCountryEmergencyNumber(countryCode) || EMERGENCY_NUMBER_NOT_CONFIGURED;
}

/** Reads the last country selected in the partner directory (may be null). */
export function getSelectedCountry(): string | null {
  try {
    const raw = localStorage.getItem(SELECTED_COUNTRY_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

/** Persists the country selected in the partner directory. */
export function setSelectedCountry(countryCode: string): void {
  try {
    localStorage.setItem(SELECTED_COUNTRY_STORAGE_KEY, countryCode);
  } catch {
    // Persistence is best-effort; the directory still works in-memory.
  }
}
