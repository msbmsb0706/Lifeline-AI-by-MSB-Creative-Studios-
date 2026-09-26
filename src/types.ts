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

/**
 * Explicit ONLINE translation outcome for an emergency record.
 *
 * - 'none'  : no translation was requested/produced.
 * - 'ok'    : a translation was produced (online, or in Offline Mode bundled).
 * - 'error' : ONLINE translation was attempted and FAILED. The original
 *             transmission is preserved and NO offline translation was
 *             silently substituted.
 *
 * 'error' is deliberately distinct from Offline Mode: an unavailable online
 * translation service is not the same thing as the user choosing
 * offline / resilience mode.
 */
export type TranslationStatus = 'none' | 'ok' | 'error';

export interface TranslationErrorInfo {
  /** Stable machine-readable failure code, e.g. TRANSLATION_UPSTREAM_HTTP. */
  code: string;
  /** Human-readable explanation shown in the UI. */
  error: string;
  /** Upstream HTTP status when the failure came from the translation provider. */
  upstream_status?: number;
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
  /** Explicit online-translation outcome (never a silent offline substitution). */
  translation_status?: TranslationStatus;
  /** Present when translation_status === 'error'. */
  translation_error?: TranslationErrorInfo | null;
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

export type PartnerProviderType = 'AUTHORIZED_API' | 'PUBLIC_CONTACT' | 'TEST' | 'LOCAL_ONLY';

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
  /** Only synthetic partner-directory fixtures may be sent to the TEST endpoint. */
  demoOnly?: boolean;
  /** Bilingual voice context — present when the emergency was captured via multilingual voice ASR. */
  detectedLanguage?: { code: string; name: string } | null;
  /** Original-language transcript (authoritative user speech), never overwritten by translation. */
  originalTranscript?: string | null;
  /** English aid translation, when available. */
  englishTranslation?: string | null;
  /**
   * Faithful translation of `originalTranscript` into the selected target
   * language, when the user produced one. This is the person's own words in
   * another language — never the generated dispatch text — so a responder can
   * read the original message even from the saved queue.
   */
  translation?: {
    targetLanguage: string;
    targetLanguageName: string;
    translatedMessage: string;
  } | null;
}

/**
 * Explicit SOS communication lifecycle for a queued SOS package.
 *
 * Local-only SOS: SOS SAVED → PENDING_LOCAL / WAITING_FOR_CONNECTION.
 * Explicit authorized-partner send: PENDING_LOCAL → SENDING → SENT.
 * Offline partner record: WAITING_FOR_CONNECTION → SENDING → SENT, or
 * UNCONFIRMED if an outbound partner outcome cannot be safely determined.
 * UNCONFIRMED must never be retried through the partner API.
 *
 * SENT / DELIVERED / ACKNOWLEDGED are distinct trust levels:
 * - SENT          : the app handed the SOS to the configured destination endpoint.
 * - DELIVERED     : ONLY when the configured receiving system explicitly confirms
 *                   delivery (never inferred from an HTTP 200).
 * - ACKNOWLEDGED  : ONLY when a human/configured organization explicitly
 *                   acknowledges the SOS (never fabricated by this client).
 * UNCONFIRMED     : partner may have received the SOS; API resend is blocked.
 * FAILED          : last transmission attempt failed; item stays stored locally
 *                   and remains retryable.
 *
 * 'TRANSMITTING' is a legacy persisted value (pre-lifecycle releases). It is
 * migrated on load by normalizePendingSOSItem() and never written anymore
 * (use SENDING).
 */
export type SOSDeliveryStatus =
  | 'PENDING_LOCAL'
  | 'WAITING_FOR_CONNECTION'
  | 'SENDING'
  | 'UNCONFIRMED'
  | 'SENT'
  | 'DELIVERED'
  | 'ACKNOWLEDGED'
  | 'FAILED';

/** Timestamped record of one lifecycle transition for a queued SOS. */
export interface SOSStatusTransition {
  status: SOSDeliveryStatus;
  timestamp: string;
  /** Optional human-readable context, e.g. why a transmission failed. */
  detail?: string;
  /**
   * true when the transition was produced by the local TEST / DEMO ONLY
   * lifecycle simulator (never by real partner integration).
   */
  simulated?: boolean;
}

/**
 * Acknowledgment returned by the transmission endpoint after a handoff.
 *
 * `status` reports the verified lifecycle fact: SENT for accepted handoff,
 * DELIVERED only for explicit delivery confirmation, ACKNOWLEDGED only for
 * explicit responder acknowledgement. Never infer these from a reference ID.
 *
 * `deliveryConfirmed` / `responderAcknowledged` may ONLY be set to true by a
 * real configured receiving integration that explicitly reports delivery or a
 * human/organizational acknowledgment. The TEST / DEMO endpoint must never set
 * them, so DELIVERED and ACKNOWLEDGED can never be fabricated in demo mode.
 */
export interface PartnerAcknowledgment {
  success: boolean;
  status: 'SENT' | 'DELIVERED' | 'ACKNOWLEDGED' | 'FAILED' | 'REJECTED';
  referenceId: string;
  timestamp: string;
  message: string;
  partnerId: string;
  partnerName: string;
  providerType: PartnerProviderType;
  /** true ONLY when the configured receiving system explicitly confirmed delivery. */
  deliveryConfirmed?: boolean;
  /** true ONLY when a human/configured organization explicitly acknowledged the SOS. */
  responderAcknowledged?: boolean;
  /** Short-lived, signed case-status capability from this server; never a partner API credential. */
  caseAccessToken?: string;
  caseAccessExpiresAt?: string;
}

/** Partner-provided case facts. Never infer these from a handoff receipt or GPS. */
export interface PartnerCaseStatus {
  sosId: string;
  referenceId: string;
  partnerAccepted: boolean;
  trackingAccepted: boolean;
  caseNumber?: string;
  assignedResponder?: { id: string; name: string };
  distanceKm?: number;
  etaMinutes?: number;
  stage?: 'ACCEPTED' | 'ASSIGNED' | 'EN_ROUTE' | 'ARRIVED' | 'CLOSED';
  updatedAt: string;
}

export interface PendingSOSItem {
  sosPackage: SOSPackage;
  targetPartner: EmergencyPartnerProvider;
  userApprovedForPartnerTransmission: boolean;
  /** Per-record explicit opt-in; absent/legacy is always false. */
  automaticRecovery?: boolean;
  /** Retry gate for temporary errors, persisted across restarts. */
  nextRecoveryAt?: number;
  /** Permanent configuration/auth failure: do not retry automatically. */
  recoveryBlocked?: boolean;
  /** Unknown partner outcome: do not retry the API, even manually, until reconciled. */
  handoffUnconfirmed?: boolean;
  /** Separate opt-in for sending saved one-time GPS with an authorized handoff. */
  gpsApprovedForPartnerTransmission?: boolean;
  /** Confirmation time for local save or, for an approved partner record, transmission consent. */
  userConsentTimestamp: string;
  /** Typed delivery lifecycle state — see SOSDeliveryStatus. */
  status: SOSDeliveryStatus;
  /** Chronological lifecycle transition log (confirmed/queued/sending/sent/... timestamps). */
  statusHistory?: SOSStatusTransition[];
  /** Set ONLY when a configured receiving system explicitly confirmed delivery. */
  deliveredAt?: string;
  /** Set ONLY when a human/configured organization explicitly acknowledged the SOS. */
  acknowledgedAt?: string;
  attempts: number;
  lastAttemptTimestamp?: string;
  errorMessage?: string;
  acknowledgment?: PartnerAcknowledgment;
  /** Last *partner-confirmed* case facts; display as last-known, never as a live offline ETA. */
  caseStatus?: PartnerCaseStatus;
}

export interface CountryInfo {
  code: string;
  name: string;
  flag: string;
}
