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
}

export interface SystemStatus {
  nebius_configured: boolean;
  base_uri?: string;
  model: string;
  status: 'online' | 'offline_ready';
  server_time: string;
  supported_languages?: string[];
  standardized_categories?: string[];
}

export interface QuickPreset {
  id: string;
  title: string;
  category: StandardEmergencyCategory | string;
  text: string;
  icon: string;
  languageCode?: string;
}
