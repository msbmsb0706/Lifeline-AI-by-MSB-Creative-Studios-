import { EmergencyPartnerProvider, CountryInfo } from '../types.ts';

export const SUPPORTED_COUNTRIES: CountryInfo[] = [
  { code: 'GLOBAL', name: 'Global / Test Providers', flag: '🌐' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'EU', name: 'European Union', flag: '🇪🇺' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' }
];

export const EMERGENCY_PARTNER_PROVIDERS: EmergencyPartnerProvider[] = [
  // 1. TEST / DEMO PROVIDER
  {
    id: 'test-partner-demo',
    country: 'GLOBAL',
    countryName: 'Global / Test Provider',
    providerName: 'TEST EMERGENCY PARTNER — DEMONSTRATION ONLY',
    providerType: 'TEST',
    serviceType: 'GENERAL_EMERGENCY',
    apiBaseUrl: '/api/emergency-partner/dispatch',
    apiEnabled: true,
    requiresUserConfirmation: true,
    supportsMediaUpload: true,
    description: 'Simulated local emergency partner endpoint for live demonstrations. Simulates receiving an SOS package and returns a fake acknowledgment and reference ID. NO REAL EMERGENCY SERVICE WILL RECEIVE THIS ALERT.',
    verifiedOfficialSource: 'LifeLine AI Demo Architecture'
  },

  // 2. AUTHORIZED API PROVIDER SAMPLE (Disabled by default until real credentials/endpoint are configured)
  {
    id: 'authorized-partner-sample',
    country: 'US',
    countryName: 'United States',
    providerName: 'Authorized Rescue Network API (Configured Endpoint)',
    providerType: 'AUTHORIZED_API',
    serviceType: 'RESCUE',
    apiBaseUrl: '/api/emergency-partner/dispatch',
    apiEnabled: false, // Must be explicitly configured on server
    requiresUserConfirmation: true,
    supportsMediaUpload: true,
    description: 'Used only when an organization has provided an actual documented API. Sends SOS package via secure HTTPS to authorized endpoint with authentication and acknowledgment handling. Never exposes secrets in browser code.',
    verifiedOfficialSource: 'Documented Partner API Interface'
  },

  // 3. PUBLIC CONTACT PROVIDERS (Verified Official Emergency Information)
  // United States
  {
    id: 'public-us-911',
    country: 'US',
    countryName: 'United States',
    providerName: 'United States Public Emergency Services (911)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'GENERAL_EMERGENCY',
    phone: '911',
    website: 'https://www.911.gov',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official US emergency dispatch telephone network. Call 911 directly. No automated digital API submission available.',
    verifiedOfficialSource: 'National 911 Program (911.gov)'
  },

  // India
  {
    id: 'public-in-112',
    country: 'IN',
    countryName: 'India',
    providerName: 'India Emergency Response Support System (112)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'GENERAL_EMERGENCY',
    phone: '112',
    website: 'https://112.gov.in',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official pan-India single emergency helpline for Police, Fire, and Ambulance. Call 112 directly. No automated digital API submission available.',
    verifiedOfficialSource: 'Ministry of Home Affairs, Govt. of India (112.gov.in)'
  },
  {
    id: 'public-in-108',
    country: 'IN',
    countryName: 'India',
    providerName: 'National Health Mission Ambulance Service (108)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'AMBULANCE',
    phone: '108',
    website: 'https://nhm.gov.in',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official emergency medical and ambulance dispatch line across Indian states. Call 108 directly.',
    verifiedOfficialSource: 'National Health Mission (NHM)'
  },
  {
    id: 'public-in-100',
    country: 'IN',
    countryName: 'India',
    providerName: 'India Police Control Room (100)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'POLICE',
    phone: '100',
    website: 'https://112.gov.in',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official police emergency contact number in India.',
    verifiedOfficialSource: 'Govt. of India Official Helplines'
  },
  {
    id: 'public-in-101',
    country: 'IN',
    countryName: 'India',
    providerName: 'India Fire Services (101)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'FIRE',
    phone: '101',
    website: 'https://112.gov.in',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official fire brigade emergency contact line in India.',
    verifiedOfficialSource: 'Govt. of India Official Helplines'
  },

  // European Union
  {
    id: 'public-eu-112',
    country: 'EU',
    countryName: 'European Union',
    providerName: 'European Single Emergency Call Line (112)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'GENERAL_EMERGENCY',
    phone: '112',
    website: 'https://digital-strategy.ec.europa.eu/en/policies/112',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official single European emergency number valid across all EU member states. Call 112 directly.',
    verifiedOfficialSource: 'European Commission Official 112 Portal'
  },

  // United Kingdom
  {
    id: 'public-gb-999',
    country: 'GB',
    countryName: 'United Kingdom',
    providerName: 'UK Emergency Services (999 / 112)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'GENERAL_EMERGENCY',
    phone: '999',
    website: 'https://www.gov.uk/emergency-services',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official UK public emergency telephone service for Police, Fire, Ambulance, and Coastguard.',
    verifiedOfficialSource: 'GOV.UK'
  },

  // Canada
  {
    id: 'public-ca-911',
    country: 'CA',
    countryName: 'Canada',
    providerName: 'Canada Emergency Services (911)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'GENERAL_EMERGENCY',
    phone: '911',
    website: 'https://www.canada.ca',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official Canadian public emergency service phone line. Call 911 directly.',
    verifiedOfficialSource: 'Government of Canada'
  },

  // Australia
  {
    id: 'public-au-000',
    country: 'AU',
    countryName: 'Australia',
    providerName: 'Australia Primary Emergency Service Triple Zero (000)',
    providerType: 'PUBLIC_CONTACT',
    serviceType: 'GENERAL_EMERGENCY',
    phone: '000',
    website: 'https://www.triplezero.gov.au',
    apiEnabled: false,
    requiresUserConfirmation: true,
    supportsMediaUpload: false,
    description: 'Official Australian primary emergency service telephone line. Call 000 directly.',
    verifiedOfficialSource: 'Australian Government Triple Zero (triplezero.gov.au)'
  }
];

export function getProvidersByCountry(countryCode: string): EmergencyPartnerProvider[] {
  if (countryCode === 'ALL') {
    return EMERGENCY_PARTNER_PROVIDERS;
  }
  // Include global/test provider + matching country providers
  return EMERGENCY_PARTNER_PROVIDERS.filter(
    (p) => p.country === countryCode || p.country === 'GLOBAL'
  );
}

// A real SOS is saved here for manual device sharing. It is NOT a partner,
// endpoint, or background upload destination; exclude it from the directory.
export const LOCAL_ONLY_PROVIDER: EmergencyPartnerProvider = {
  id: 'local-device-only',
  country: 'GLOBAL',
  countryName: 'This device',
  providerName: 'This device — manual sharing only',
  providerType: 'LOCAL_ONLY',
  serviceType: 'GENERAL_EMERGENCY',
  apiEnabled: false,
  requiresUserConfirmation: false,
  supportsMediaUpload: false,
  description: 'Saved only in this browser on this device. No partner, demo endpoint, or responder receives it. You can review and manually share the text after reopening the app.'
};

export function getTestProvider(): EmergencyPartnerProvider {
  return (
    EMERGENCY_PARTNER_PROVIDERS.find((p) => p.id === 'test-partner-demo') ||
    EMERGENCY_PARTNER_PROVIDERS[0]
  );
}

export function getProviderById(id: string): EmergencyPartnerProvider | undefined {
  return EMERGENCY_PARTNER_PROVIDERS.find((p) => p.id === id);
}
