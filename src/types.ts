export type SeverityLevel = 1 | 2 | 3 | 4 | 5;

export type StandardEmergencyCategory =
  | 'MEDICAL'
  | 'FIRE'
  | 'RESCUE'
  | 'FOOD'
  | 'WATER'
  | 'SHELTER'
  | 'MISSING_PERSON'
  | 'OTHER';

export interface VisualSOSCard {
  headline: string;
  badge_color: 'RED' | 'ORANGE' | 'YELLOW' | 'BLUE' | 'GREEN';
  action_steps: string[];
  priority_symbol: string;
  instructions_for_responders: string;
  first_aid_actions: string[];
}

export interface DetectedLanguage {
  code: string;
  name: string;
  nativeName?: string;
  confidence?: number;
  /**
   * How the language was determined:
   * - 'asr': reported by the speech recognition provider (e.g. NVIDIA NIM Whisper large-v3)
   * - 'script': deterministic Unicode-script/keyword detection on the transcript text
   */
  source?: 'asr' | 'script';
}

/**
 * Metadata for a voice capture that went through server-side multilingual ASR.
 * The original-language transcript is always preserved; the English translation
 * is an aid for interoperability and may be absent (failed or unnecessary).
 */
export interface VoiceCaptureMetadata {
  /** Provider identifier, e.g. 'nvidia_nim'. 'browser' when the Web Speech API path was used. */
  asrProvider: string;
  /** ASR model identifier, e.g. 'openai/whisper-large-v3'. */
  asrModel: string;
  detectedLanguage: DetectedLanguage;
  /** Authoritative transcript in the language the user actually spoke. */
  originalTranscript: string;
  /** English translation of originalTranscript, or undefined when unavailable. */
  englishTranslation?: string;
  /** true when the English translation step failed — original transcript remains usable. */
  translationFailed?: boolean;
  /** Approximate captured speech duration in milliseconds. */
  durationMs?: number;
  timestamp: string;
}

export interface SupportedLanguageInfo {
  code: string;
  name: string;
  nativeName: string;
  isIndianRegional?: boolean;
  script?: string;
}

export interface TranslatedSOS {
  target_language: string;
  target_language_name: string;
  original_message: string;
  translated_message: string;
  translated_headline?: string;
  translated_action_steps?: string[];
  translated_instructions_for_responders?: string;
  translated_first_aid_actions?: string[];
  translated_needs?: string[];
  category: StandardEmergencyCategory;
  severity: SeverityLevel;
  emergency_type: string;
  timestamp: string;
  detected_source_language?: DetectedLanguage;
  model_used?: string;
  source?: 'nebius_nemotron' | 'offline_fallback';
}

export interface NemotronEmergencyResponse {
  language: string;
  transcript: string;
  emergency_type: StandardEmergencyCategory | string;
  severity: SeverityLevel;
  needs: string[];
  message: string;
  visual_card: VisualSOSCard | string;
  raw_visual_card?: string;
  visual_card_text?: string;
  emergency_category?: StandardEmergencyCategory;
  detected_language?: DetectedLanguage;
  translation?: TranslatedSOS;
  nebius_connected?: boolean;
}

export interface EmergencyAnalysisResult extends NemotronEmergencyResponse {
  source: 'nebius_nemotron' | 'offline_fallback';
  model_used: string;
  timestamp: string;
  offline_notice?: string;
  latency_ms?: number;
  raw_transcript?: string;
  location_coordinates?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    timestamp?: number;
  } | null;
  detected_language?: DetectedLanguage;
  translation?: TranslatedSOS;
  active_view_language?: 'original' | 'translated';
  nebius_connected?: boolean;
  /** Present when the emergency was captured via multilingual voice ASR. */
  voice_capture?: VoiceCaptureMetadata;
}

export interface SystemStatus {
  nebius_configured: boolean;
  base_uri?: string;
  model: string;
  status: 'online' | 'offline_ready';
  server_time: string;
  supported_languages?: string[];
  standardized_categories?: string[];
  /** Server-side multilingual voice ASR availability (names only — never keys). */
  asr?: {
    configured: boolean;
    provider: string;
    model: string;
  };
}

export interface QuickPreset {
  id: string;
  title: string;
  category: StandardEmergencyCategory | string;
  text: string;
  icon: string;
  languageCode?: string;
}

// ==========================================
// EMERGENCY PARTNER INTEGRATION FRAMEWORK
// ==========================================

export type PartnerProviderType = 'AUTHORIZED_API' | 'PUBLIC_CONTACT' | 'TEST';

export type PartnerServiceType =
  | 'POLICE'
  | 'FIRE'
  | 'AMBULANCE'
  | 'RESCUE'
  | 'GENERAL_EMERGENCY';

export interface EmergencyPartnerProvider {
  id: string;
  country: string; // e.g. "US", "IN", "EU", "GB", "CA", "AU", "GLOBAL"
  countryName: string;
  providerName: string;
  providerType: PartnerProviderType;
  serviceType: PartnerServiceType;
  phone?: string;
  website?: string;
  apiBaseUrl?: string;
  apiEnabled: boolean;
  requiresUserConfirmation: boolean;
  supportsMediaUpload?: boolean;
  description?: string;
  verifiedOfficialSource?: string;
}

export interface MediaAttachmentInfo {
  type: 'image' | 'video';
  name: string;
  mimeType: string;
  sizeBytes?: number;
  dataUrl?: string; // Base64 or metadata preview
}

export interface SOSPackage {
  sosId: string;
  timestamp: string;
  emergencyType: string;
  category?: StandardEmergencyCategory;
  severity: SeverityLevel;
  message: string;
  gps?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    timestamp?: number;
  } | null;
  photos?: MediaAttachmentInfo[];
  video?: MediaAttachmentInfo | null;
  source: 'online' | 'offline';
  offlineCreated?: boolean;
  /** Bilingual voice context — present when the emergency was captured via multilingual voice ASR. */
  detectedLanguage?: { code: string; name: string } | null;
  /** Original-language transcript (authoritative user speech), never overwritten by translation. */
  originalTranscript?: string | null;
  /** English aid translation, when available. */
  englishTranslation?: string | null;
}

export interface PartnerAcknowledgment {
  success: boolean;
  status: 'ACKNOWLEDGED' | 'FAILED' | 'REJECTED';
  referenceId: string;
  timestamp: string;
  message: string;
  partnerId: string;
  partnerName: string;
  providerType: PartnerProviderType;
}

export interface PendingSOSItem {
  sosPackage: SOSPackage;
  targetPartner: EmergencyPartnerProvider;
  userApprovedForPartnerTransmission: boolean;
  userConsentTimestamp: string;
  status: 'PENDING_LOCAL' | 'TRANSMITTING' | 'SENT' | 'FAILED';
  attempts: number;
  lastAttemptTimestamp?: string;
  errorMessage?: string;
  acknowledgment?: PartnerAcknowledgment;
}

export interface CountryInfo {
  code: string;
  name: string;
  flag: string;
}
