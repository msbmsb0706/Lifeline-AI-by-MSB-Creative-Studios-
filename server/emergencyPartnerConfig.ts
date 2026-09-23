import { getProviderById } from '../src/lib/emergencyPartnersData.ts';

// Server-only endpoint, key and payload policy. Only `publicProvider` may leave this module.
export function getAuthorizedPartnerConfig() {
  const endpoint = process.env.AUTHORIZED_PARTNER_API_URL?.trim();
  const key = process.env.AUTHORIZED_PARTNER_API_KEY?.trim();
  const name = process.env.AUTHORIZED_PARTNER_NAME?.trim();
  const country = process.env.AUTHORIZED_PARTNER_COUNTRY?.trim().toUpperCase() || 'GLOBAL';
  const configured = Boolean(endpoint && key && name);
  const allowedFields = (process.env.AUTHORIZED_PARTNER_ALLOWED_FIELDS || 'sosId,timestamp,emergencyType,severity,message,source')
    .split(',').map(s => s.trim());
  return {
    endpoint, key, allowedFields,
    publicProvider: {
      ...getProviderById('authorized-partner-sample')!,
      country, countryName: country,
      providerName: name || 'Authorized partner not configured',
      apiEnabled: configured,
      apiStatus: configured ? 'CONFIGURED_NOT_VERIFIED' as const : 'NOT_CONFIGURED' as const,
      description: 'Server-configured partner. Configuration does not confirm delivery or responder acknowledgement.',
      verifiedOfficialSource: 'Operator configuration — authorization must be verified by the operator',
    }
  };
}

export function permittedPartnerPayload(payload: Record<string, unknown>, allowedFields: string[]) {
  // Intersect operator policy with supported SOS fields; never forward arbitrary request fields.
  const supported = ['sosId', 'timestamp', 'emergencyType', 'severity', 'message', 'gps', 'photos', 'video', 'detectedLanguage', 'originalTranscript', 'englishTranslation', 'source'];
  return Object.fromEntries(supported.filter(key => allowedFields.includes(key) && payload[key] !== undefined).map(key => [key, payload[key]]));
}
