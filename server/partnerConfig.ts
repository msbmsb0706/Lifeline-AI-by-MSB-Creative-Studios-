/**
 * LifeLine AI — Emergency partner API configuration lookup (server-side only).
 *
 * GET /api/emergency-partner/config?country=XX reports whether an authorized
 * emergency-partner API endpoint is configured. The response carries ONLY
 * public status metadata — endpoint URLs, API keys, and any other credentials
 * are NEVER included, logged, or exposed to the browser.
 *
 * Outcomes:
 * - 200 { status: 'CONFIGURED' }     — authorized endpoint + credentials present
 * - 200 { status: 'NOT_CONFIGURED' }  — server successfully reports no provider
 * - 503 { code: 'PARTNER_CONFIG_UNAVAILABLE' } — the lookup itself failed
 */

export type PartnerConfigStatus = 'CONFIGURED' | 'NOT_CONFIGURED';

export interface PartnerConfigData {
  status: PartnerConfigStatus;
  country: string;
  /** Public display name only — never a URL, key, or secret. */
  providerName: string | null;
  apiEnabled: boolean;
  /** Partner explicitly contracts to deduplicate repeated SOS IDs; required for auto recovery. */
  automaticRecoverySupported: boolean;
  checkedAt: string;
}

interface PartnerConfigEnv {
  AUTHORIZED_PARTNER_API_URL?: string;
  AUTHORIZED_PARTNER_API_KEY?: string;
  AUTHORIZED_PARTNER_IDEMPOTENCY_SUPPORTED?: string;
}

/**
 * Pure status derivation from server environment. Returns public metadata only.
 * Never throws — route-level failures are mapped to HTTP 503 by the caller.
 */
export function getEmergencyPartnerConfig(
  countryCode: string | undefined,
  env: PartnerConfigEnv
): PartnerConfigData {
  const country = (countryCode || 'GLOBAL').toUpperCase().slice(0, 16);
  const apiUrl = (env.AUTHORIZED_PARTNER_API_URL || '').trim();
  const apiKey = (env.AUTHORIZED_PARTNER_API_KEY || '').trim();
  // A missing/malformed/insecure URL is not an authorized HTTPS integration.
  let secureEndpoint = false;
  try {
    const parsed = new URL(apiUrl);
    secureEndpoint = parsed.protocol === 'https:' && Boolean(parsed.hostname) &&
      !parsed.username && !parsed.password;
  } catch { /* not a usable URL */ }
  const configured = Boolean(secureEndpoint && apiKey);

  return {
    status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    country,
    providerName: configured ? 'Authorized Rescue Network API' : null,
    apiEnabled: configured,
    automaticRecoverySupported: configured && env.AUTHORIZED_PARTNER_IDEMPOTENCY_SUPPORTED === 'true',
    checkedAt: new Date().toISOString()
  };
}
