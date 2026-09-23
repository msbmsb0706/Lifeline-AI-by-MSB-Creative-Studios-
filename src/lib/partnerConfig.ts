/**
 * LifeLine AI — Emergency partner API configuration status (PR #16).
 *
 * Three DISTINCT states (never conflated):
 * - CONFIGURED                — the server successfully reports an authorized
 *                               provider endpoint is configured.
 * - NOT_CONFIGURED            — the server successfully reports that NO
 *                               provider is configured for the country.
 * - CONFIGURATION_UNAVAILABLE — the config lookup itself failed (HTTP 503,
 *                               timeout, network error, or malformed response).
 *                               This must NEVER be displayed as "not configured".
 *
 * No endpoint credentials or secrets are ever requested, logged, or stored here.
 */

/** Distinct configuration states for the authorized emergency-partner API. */
export type PartnerConfigState = 'CONFIGURED' | 'NOT_CONFIGURED' | 'CONFIGURATION_UNAVAILABLE';

/** Displayed when the configuration lookup itself failed. */
export const PARTNER_CONFIG_UNAVAILABLE_TEXT = 'Emergency API configuration unavailable.';

/** Displayed when the server cannot be reached for a status check (offline). */
export const PARTNER_STATUS_UNAVAILABLE_TEXT = 'Emergency API status unavailable.';

/** Displayed ONLY when the server successfully reports no configured provider. */
export const PARTNER_NOT_CONFIGURED_TEXT = 'Emergency API integration not configured for this country.';

export interface PartnerConfigResult {
  state: PartnerConfigState;
  /** Public provider display name only (never URLs, keys, or secrets). */
  providerName?: string | null;
  country?: string;
}

interface FetchPartnerConfigOptions {
  /** Milliseconds before the lookup is treated as unavailable. Default 8000. */
  timeoutMs?: number;
}

/**
 * Queries GET /api/emergency-partner/config for a country and maps the outcome
 * onto the three distinct states. Any transport failure, non-OK status (503,
 * timeout/abort, …), or malformed payload yields CONFIGURATION_UNAVAILABLE.
 */
export async function fetchPartnerConfigState(
  countryCode: string,
  options?: FetchPartnerConfigOptions
): Promise<PartnerConfigResult> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const country = (countryCode || 'GLOBAL').toUpperCase();

  // Offline: the lookup cannot run — report unavailable WITHOUT any fetch.
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { state: 'CONFIGURATION_UNAVAILABLE', country };
    }
  } catch {
    // A broken navigator stub must never break the lookup; fall through.
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`/api/emergency-partner/config?country=${encodeURIComponent(country)}`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      // HTTP 503 / 4xx / 5xx: the lookup failed — NOT "not configured".
      return { state: 'CONFIGURATION_UNAVAILABLE', country };
    }

    const json: any = await response.json().catch(() => null);
    const status = json?.success === true ? json?.data?.status : undefined;

    if (status === 'CONFIGURED') {
      const providerName =
        typeof json.data.providerName === 'string' ? json.data.providerName : null;
      return { state: 'CONFIGURED', providerName, country };
    }
    if (status === 'NOT_CONFIGURED') {
      return { state: 'NOT_CONFIGURED', country };
    }
    // Malformed success payload: cannot determine configuration.
    return { state: 'CONFIGURATION_UNAVAILABLE', country };
  } catch {
    // Network error, timeout/abort, JSON failure — lookup unavailable.
    return { state: 'CONFIGURATION_UNAVAILABLE', country };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Display text for a resolved configuration state. */
export function getPartnerConfigDisplayText(result: PartnerConfigResult): string {
  if (result.state === 'CONFIGURED') {
    return result.providerName
      ? `Emergency API integration configured for this country (${result.providerName}).`
      : 'Emergency API integration configured for this country.';
  }
  if (result.state === 'NOT_CONFIGURED') {
    return PARTNER_NOT_CONFIGURED_TEXT;
  }
  return PARTNER_CONFIG_UNAVAILABLE_TEXT;
}
