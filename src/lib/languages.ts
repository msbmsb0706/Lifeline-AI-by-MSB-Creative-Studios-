import { StandardEmergencyCategory, SeverityLevel, DetectedLanguage, SupportedLanguageInfo } from '../types.ts';

export const SUPPORTED_LANGUAGES: SupportedLanguageInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English', isIndianRegional: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', isIndianRegional: false },
  { code: 'fr', name: 'French', nativeName: 'Français', isIndianRegional: false },
  // Indian Regional Languages
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', isIndianRegional: true, script: 'Tamil' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', isIndianRegional: true, script: 'Devanagari' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', isIndianRegional: true, script: 'Telugu' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', isIndianRegional: true, script: 'Kannada' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', isIndianRegional: true, script: 'Malayalam' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', isIndianRegional: true, script: 'Bengali' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', isIndianRegional: true, script: 'Devanagari' }
];

export const STANDARDIZED_CATEGORIES: {
  id: StandardEmergencyCategory;
  label: string;
  color: 'RED' | 'ORANGE' | 'YELLOW' | 'BLUE' | 'GREEN';
  icon: string;
  description: string;
}[] = [
  {
    id: 'MEDICAL',
    label: 'Medical Emergency',
    color: 'RED',
    icon: 'HEART_PULSE',
    description: 'Acute trauma, cardiac event, stroke, respiratory crisis, hemorrhage, unconscious patient'
  },
  {
    id: 'FIRE',
    label: 'Fire & Explosion',
    color: 'RED',
    icon: 'FLAME',
    description: 'Structural fires, smoke entrapment, industrial blazes, wildland fire, chemical detonations'
  },
  {
    id: 'RESCUE',
    label: 'Search & Rescue / Collision',
    color: 'ORANGE',
    icon: 'CAR_CRASH',
    description: 'Vehicle extrication, structural collapse, flood entrapment, trench or swift water rescue'
  },
  {
    id: 'FOOD',
    label: 'Emergency Food Aid',
    color: 'YELLOW',
    icon: 'ALERT_TRIANGLE',
    description: 'Severe disaster starvation threat, isolated communities without provisions, infant nutrition'
  },
  {
    id: 'WATER',
    label: 'Potable Water Crisis',
    color: 'BLUE',
    icon: 'ALERT_TRIANGLE',
    description: 'Dehydration danger, clean water supply failure, flood water pathogen contamination'
  },
  {
    id: 'SHELTER',
    label: 'Emergency Shelter & Refuge',
    color: 'YELLOW',
    icon: 'ALERT_TRIANGLE',
    description: 'Displaced families, destroyed residential structure, severe hypothermia or storm refuge'
  },
  {
    id: 'MISSING_PERSON',
    label: 'Missing Person / Abduction',
    color: 'ORANGE',
    icon: 'SHIELD_ALERT',
    description: 'Lost child, missing vulnerable elder, wilderness disappearance, urgent amber distress'
  },
  {
    id: 'OTHER',
    label: 'General / Hazmat / Threat',
    color: 'YELLOW',
    icon: 'ALERT_TRIANGLE',
    description: 'Hazardous gas leak, toxic chemical spill, downed electrical grid, urgent civil hazard'
  }
];

export function getLanguageByCodeOrName(identifier?: string): SupportedLanguageInfo {
  if (!identifier) return SUPPORTED_LANGUAGES[0];
  const clean = identifier.toLowerCase().trim();
  const match = SUPPORTED_LANGUAGES.find(
    (l) => l.code.toLowerCase() === clean || l.name.toLowerCase() === clean || l.nativeName.toLowerCase() === clean
  );
  return match || SUPPORTED_LANGUAGES[0];
}

/**
 * High-accuracy multi-script & heuristic language detector
 * Supports English, Spanish, French, and Indian Regional (Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali, Marathi)
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return { code: 'en', name: 'English', confidence: 1.0 };
  }

  const raw = text.trim();
  const lower = raw.toLowerCase();

  // 1. Script-based Unicode detection for Indian Regional Languages
  const tamilRegex = /[\u0B80-\u0BFF]/;
  const teluguRegex = /[\u0C00-\u0C7F]/;
  const kannadaRegex = /[\u0C80-\u0CFF]/;
  const malayalamRegex = /[\u0D00-\u0D7F]/;
  const bengaliRegex = /[\u0980-\u09FF]/;
  const devanagariRegex = /[\u0900-\u097F]/;

  if (tamilRegex.test(raw)) {
    return { code: 'ta', name: 'Tamil', confidence: 0.98 };
  }
  if (teluguRegex.test(raw)) {
    return { code: 'te', name: 'Telugu', confidence: 0.98 };
  }
  if (kannadaRegex.test(raw)) {
    return { code: 'kn', name: 'Kannada', confidence: 0.98 };
  }
  if (malayalamRegex.test(raw)) {
    return { code: 'ml', name: 'Malayalam', confidence: 0.98 };
  }
  if (bengaliRegex.test(raw)) {
    return { code: 'bn', name: 'Bengali', confidence: 0.98 };
  }

  // Devanagari could be Marathi or Hindi
  if (devanagariRegex.test(raw)) {
    // Distinct Marathi indicators: 'ळ', 'आहे', 'नाही', 'मदत', 'वाचवा', 'अपघात', 'इथे'
    const marathiMarkers = ['ळ', 'आहे', 'नाही', 'मदत', 'वाचवा', 'अपघात', 'इथे', 'लवकर', 'आम्ही', 'पोलीस', 'रुग्ण'];
    const isMarathi = marathiMarkers.some((m) => raw.includes(m));
    if (isMarathi) {
      return { code: 'mr', name: 'Marathi', confidence: 0.95 };
    }
    return { code: 'hi', name: 'Hindi', confidence: 0.95 };
  }

  // 2. Transliterated / Romanized Emergency markers for Indian Regional Languages
  const romanizedTamil = ['kapathunga', 'udavi', 'thee', 'maruthuva', 'vali', 'appadiye', 'vanthudunga', 'tamil'];
  if (romanizedTamil.some((w) => lower.includes(w))) {
    return { code: 'ta', name: 'Tamil', confidence: 0.88 };
  }

  const romanizedHindi = ['bachao', 'madad', 'aag', 'chot', 'dard', 'aspataal', 'saans', 'jaldi', 'gadi'];
  if (romanizedHindi.some((w) => lower.includes(w))) {
    return { code: 'hi', name: 'Hindi', confidence: 0.88 };
  }

  const romanizedTelugu = ['sahayam', 'sahayatha', 'kapadandi', 'nappi', 'manta', 'raktham'];
  if (romanizedTelugu.some((w) => lower.includes(w))) {
    return { code: 'te', name: 'Telugu', confidence: 0.88 };
  }

  const romanizedKannada = ['sahaya', 'kapaadi', 'benki', 'rogi', 'nogavu', 'thondare'];
  if (romanizedKannada.some((w) => lower.includes(w))) {
    return { code: 'kn', name: 'Kannada', confidence: 0.88 };
  }

  const romanizedMalayalam = ['sahayikku', 'sahayam', 'rakshikku', 'thee', 'vedana', 'aasupathri'];
  if (romanizedMalayalam.some((w) => lower.includes(w))) {
    return { code: 'ml', name: 'Malayalam', confidence: 0.88 };
  }

  const romanizedBengali = ['bachao', 'shahajjo', 'agun', 'rokto', 'batha', 'shonko'];
  if (romanizedBengali.some((w) => lower.includes(w))) {
    return { code: 'bn', name: 'Bengali', confidence: 0.88 };
  }

  const romanizedMarathi = ['vachva', 'madat', 'aag', 'tras', 'vedna', 'davaakhana'];
  if (romanizedMarathi.some((w) => lower.includes(w))) {
    return { code: 'mr', name: 'Marathi', confidence: 0.88 };
  }

  // 3. Spanish markers
  const spanishMarkers = [
    'ayuda', 'socorro', 'fuego', 'dolor', 'emergencia', 'herido', 'sangre', 'respirar',
    'hospital', 'ambulancia', 'accidente', 'urgente', 'incendio', 'pecho', 'por favor'
  ];
  const spanishChars = /[áéíóúñ¿¡]/i;
  const spanishHits = spanishMarkers.filter((w) => lower.includes(w)).length;
  if (spanishHits >= 1 || (spanishChars.test(raw) && (lower.includes('el') || lower.includes('la') || lower.includes('de')))) {
    return { code: 'es', name: 'Spanish', confidence: 0.92 };
  }

  // 4. French markers
  const frenchMarkers = [
    'aide', 'secours', 'urgence', 'feu', 'douleur', 'blessé', 'sang', 'respirer',
    'hôpital', 'pompiers', 'accident', 'étouffement', 'poitrine', 's\'il vous plaît'
  ];
  const frenchChars = /[àèêëîïôùûçœ]/i;
  const frenchHits = frenchMarkers.filter((w) => lower.includes(w)).length;
  if (frenchHits >= 1 || (frenchChars.test(raw) && (lower.includes('le') || lower.includes('la') || lower.includes('est') || lower.includes('du')))) {
    return { code: 'fr', name: 'French', confidence: 0.92 };
  }

  return { code: 'en', name: 'English', confidence: 0.85 };
}

/**
 * Standardizes an arbitrary emergency description or type into one of the 8 required categories:
 * MEDICAL, FIRE, RESCUE, FOOD, WATER, SHELTER, MISSING_PERSON, OTHER
 */
export function standardizeCategory(input: string): StandardEmergencyCategory {
  const norm = input.toUpperCase();

  // Explicit check
  if (norm.includes('MISSING') || norm.includes('ABDUCT') || norm.includes('KIDNAP') || norm.includes('LOST CHILD')) {
    return 'MISSING_PERSON';
  }
  if (norm.includes('FOOD') || norm.includes('STARV') || norm.includes('HUNGER') || norm.includes('FORMULA') || norm.includes('RATION')) {
    return 'FOOD';
  }
  if (norm.includes('WATER') && (norm.includes('DRINK') || norm.includes('THIRST') || norm.includes('DEHYDRAT') || norm.includes('POTABLE') || norm.includes('CONTAMINAT'))) {
    return 'WATER';
  }
  if (norm.includes('SHELTER') || norm.includes('DISPLAC') || norm.includes('HOMELESS') || norm.includes('REFUGE') || norm.includes('EVACUEE') || norm.includes('FREEZING') || norm.includes('ROOF COLLAPSE')) {
    return 'SHELTER';
  }
  if (norm.includes('FIRE') || norm.includes('FLAME') || norm.includes('BLAZE') || norm.includes('SMOKE') || norm.includes('BURN') || norm.includes('EXPLOSION')) {
    return 'FIRE';
  }
  if (norm.includes('CRASH') || norm.includes('COLLISION') || norm.includes('RESCUE') || norm.includes('EXTRICAT') || norm.includes('TRAPPED') || norm.includes('COLLAPSE') || norm.includes('FLOOD')) {
    return 'RESCUE';
  }
  if (norm.includes('MEDIC') || norm.includes('CARDIAC') || norm.includes('HEART') || norm.includes('STROKE') || norm.includes('BREATH') || norm.includes('BLEED') || norm.includes('HEMORRHAGE') || norm.includes('ALLERG') || norm.includes('ANAPHYLAXIS') || norm.includes('FRACTURE') || norm.includes('POISON') || norm.includes('UNCONSCIOUS')) {
    return 'MEDICAL';
  }

  // Fallback to lower case checking on situation keywords
  const l = input.toLowerCase();
  if (l.includes('food') || l.includes('starv') || l.includes('ration')) return 'FOOD';
  if (l.includes('thirst') || l.includes('clean water') || l.includes('drinking water')) return 'WATER';
  if (l.includes('shelter') || l.includes('tents') || l.includes('displaced')) return 'SHELTER';
  if (l.includes('missing') || l.includes('lost') || l.includes('child')) return 'MISSING_PERSON';
  if (l.includes('fire') || l.includes('smoke') || l.includes('flame')) return 'FIRE';
  if (l.includes('crash') || l.includes('accident') || l.includes('trapped')) return 'RESCUE';
  if (l.includes('pain') || l.includes('hurt') || l.includes('blood') || l.includes('sick') || l.includes('doctor')) return 'MEDICAL';

  return 'OTHER';
}

/**
 * Deterministic offline translation dictionary and emergency generator
 * Preserves emergency meaning, severity, and category across all 10 languages
 */
export interface OfflineEmergencyDict {
  categoryLabels: Record<StandardEmergencyCategory, string>;
  dispatchHeader: string;
  priorityLabel: string;
  requiredAssetsLabel: string;
  actionRequiredLabel: string;
  responderArrivalDirective: string;
  immediateActionPrefix: string;
  firstAidHeader: string;
  needsTranslations: Record<string, string>;
  sampleDirectives: Record<StandardEmergencyCategory, {
    headline: string;
    actionSteps: string[];
    responderDirective: string;
    firstAid: string[];
  }>;
}

export const EMERGENCY_TRANSLATION_DICTIONARY: Record<string, OfflineEmergencyDict> = {
  en: {
    categoryLabels: {
      MEDICAL: 'Medical Emergency',
      FIRE: 'Fire & Explosion',
      RESCUE: 'Search & Rescue / Extrication',
      FOOD: 'Emergency Food Aid',
      WATER: 'Emergency Potable Water Crisis',
      SHELTER: 'Emergency Shelter & Refuge',
      MISSING_PERSON: 'Missing Person Distress',
      OTHER: 'Hazardous / Urgent Condition'
    },
    dispatchHeader: 'DISPATCH ALERT',
    priorityLabel: 'Priority',
    requiredAssetsLabel: 'Required Assistance',
    actionRequiredLabel: 'Action: Dispatch nearest units immediately.',
    responderArrivalDirective: 'Immediate scene safety and priority triage required upon arrival.',
    immediateActionPrefix: 'Immediate Action Steps',
    firstAidHeader: 'First Aid Directives',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'ALS Paramedic Ambulance',
      'Automated External Defibrillator (AED)': 'Automated External Defibrillator (AED)',
      'Fire Engine Suppression': 'Fire Engine Suppression',
      'Heavy Hydraulic Rescue': 'Heavy Hydraulic Rescue',
      'Drinking Water Supply Unit': 'Emergency Drinking Water Supply Unit',
      'Emergency Rations Squad': 'Emergency Food & Infant Nutrition Unit',
      'Emergency Shelter Team': 'Temporary Shelter & Thermal Blankets',
      'Search & Rescue Tracking Team': 'Search & Rescue K9 / Tracking Team'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'CRITICAL MEDICAL EMERGENCY - IMMEDIATE EMS DISPATCH',
        actionSteps: [
          'Call local emergency services immediately',
          'Keep patient resting in a safe, monitored position',
          'Do not administer unprescribed oral medication',
          'Monitor breathing continually until ambulance arrives'
        ],
        responderDirective: 'Patient exhibiting acute clinical symptoms. Prepare rapid ALS telemetry and emergency transport.',
        firstAid: [
          'Check consciousness and airway openness (look, listen, feel)',
          'Apply direct pressure to active bleeding with clean cloth'
        ]
      },
      FIRE: {
        headline: 'STRUCTURAL FIRE & SMOKE HAZARD - EVACUATE NOW',
        actionSteps: [
          'Evacuate immediately through closest safe exit',
          'Stay low beneath toxic smoke layer',
          'Close doors behind you to compartmentalize fire',
          'Do not use elevators under any circumstances'
        ],
        responderDirective: 'Active fire conditions with potential occupant entrapment. Immediate search and water suppression.',
        firstAid: [
          'Move affected persons immediately to fresh outdoor air',
          'Cool thermal burns with clean, cool running water for 10 minutes'
        ]
      },
      RESCUE: {
        headline: 'RESCUE & VEHICULAR EXTRICATION REQUIRED',
        actionSteps: [
          'Turn off engine ignitions to prevent ignition of fuel leaks',
          'Do not move injured victims unless immediate fire threat exists',
          'Stabilize neck and spine without twisting',
          'Keep victim warm and reassure with calm communication'
        ],
        responderDirective: 'Physical or mechanical entrapment. Prepare hydraulic extrication tools and spinal immobilizers.',
        firstAid: [
          'Control external hemorrhage with firm direct pressure',
          'Maintain manual in-line cervical spine stabilization'
        ]
      },
      FOOD: {
        headline: 'EMERGENCY FOOD AID & INFANT NUTRITION DISTRESS',
        actionSteps: [
          'Prioritize infants, elderly, and nursing mothers for remaining rations',
          'Conserve physical energy and stay sheltered from heat/cold',
          'Signal rescue personnel with visible flags or markers',
          'Avoid consuming uninspected or spoiled flood-damaged food'
        ],
        responderDirective: 'Acute nutritional distress in disaster quadrant. Deliver high-energy emergency rations and pediatric nutrition.',
        firstAid: [
          'Provide clean electrolyte solutions in small frequent sips to severely malnourished victims',
          'Prevent refeeding complications by introducing simple carbohydrates gradually'
        ]
      },
      WATER: {
        headline: 'CRITICAL DRINKING WATER SHORTAGE & DEHYDRATION RISK',
        actionSteps: [
          'Do not drink untreated flood or surface water under any conditions',
          'Boil available water vigorously for 1 minute before ingestion if heat source exists',
          'Ration remaining clean water evenly among individuals',
          'Keep in shade to minimize perspiration and dehydration'
        ],
        responderDirective: 'Critical potable water failure. Dispatch bulk purified drinking water containers and purification tablets.',
        firstAid: [
          'Administer clean oral rehydration salts (ORS) slowly in small sips',
          'Move dehydrated victims into cool shade with wet cloth on forehead'
        ]
      },
      SHELTER: {
        headline: 'EMERGENCY SHELTER REQUIRED - SEVERE EXPOSURE THREAT',
        actionSteps: [
          'Assemble family members in the most structurally sound remaining space',
          'Protect from hypothermia by layering dry garments and cardboard insulation',
          'Stay away from cracked walls, dangling roof beams, and utility lines',
          'Keep an active beacon or flashlight visible for night search squads'
        ],
        responderDirective: 'Displaced civilians exposed to severe environmental hazard. Provide emergency transport to designated relief shelter.',
        firstAid: [
          'Insulate body core with dry blankets to counter hypothermia',
          'Treat frostbite or exposure by gentle warming; avoid direct extreme heat'
        ]
      },
      MISSING_PERSON: {
        headline: 'MISSING PERSON EMERGENCY - RAPID SEARCH DISPATCH',
        actionSteps: [
          'Preserve last known location and items with scent for search teams',
          'Record exact clothing, physical description, and departure time',
          'Do not contaminate primary search trail with heavy foot traffic',
          'Alert neighborhood emergency coordinators and law enforcement immediately'
        ],
        responderDirective: 'Time-critical search and rescue for missing vulnerable individual. Establish perimeter grid and coordinate K9 search.',
        firstAid: [
          'Prepare thermal blankets, clean fluids, and medical exam upon recovery',
          'Check for disorientation, hypothermia, or trauma upon first contact'
        ]
      },
      OTHER: {
        headline: 'CRITICAL EMERGENCY DISTRESS - PRIORITY RESPONSE',
        actionSteps: [
          'Move away from immediate hazardous area to safe vantage point',
          'Keep lines of communication open for emergency dispatch callback',
          'Warn other bystanders to keep distance from the hazard',
          'Follow instructions of certified first responders upon arrival'
        ],
        responderDirective: 'Hazardous incident verification. Conduct rapid perimeter reconnaissance and deploy appropriate specialized response.',
        firstAid: [
          'Ensure personal safety before attempting bystander first aid',
          'Monitor vitals and comfort distressed victims in recovery posture'
        ]
      }
    }
  },
  ta: {
    categoryLabels: {
      MEDICAL: 'அவசர மருத்துவ உதவி (Medical)',
      FIRE: 'தீ மற்றும் வெடிப்பு விபத்து (Fire)',
      RESCUE: 'தேடல் மற்றும் மீட்புப் பணி (Rescue)',
      FOOD: 'அவசர உணவு உதவி (Food Aid)',
      WATER: 'குடிநீர் பற்றாக்குறை ஆபத்து (Water)',
      SHELTER: 'அவசர தங்குமிடம் (Shelter)',
      MISSING_PERSON: 'காணாமல் போன நபர் (Missing Person)',
      OTHER: 'பொது அவசர நிலை (Emergency)'
    },
    dispatchHeader: 'அவசர அறிவிப்பு (DISPATCH ALERT)',
    priorityLabel: 'முன்னுரிமை (Priority)',
    requiredAssetsLabel: 'தேவைப்படும் உதவிகள்',
    actionRequiredLabel: 'நடவடிக்கை: அருகிலுள்ள மீட்புக் குழுவை உடனடியாக அனுப்பவும்.',
    responderArrivalDirective: 'மீட்புக் குழுவினர் வந்தவுடன் முதலுதவி மற்றும் உயிர்காக்கும் சோதனையை உடனடியாகத் தொடங்கவும்.',
    immediateActionPrefix: 'உடனடி பாதுகாப்பு வழிகாட்டுதல்கள்',
    firstAidHeader: 'முதலுதவி நெறிமுறைகள்',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'ஆம்புலன்ஸ் அவசர ஊர்தி (ALS Ambulance)',
      'Automated External Defibrillator (AED)': 'இதய மீட்புக் கருவி (AED Defibrillator)',
      'Fire Engine Suppression': 'தீயணைப்பு வாகனம் (Fire Engine)',
      'Heavy Hydraulic Rescue': 'ஹைட்ராலிக் மீட்புக் குழு (Hydraulic Rescue)',
      'Drinking Water Supply Unit': 'பாதுகாப்பான குடிநீர் வழங்கல் பிரிவு (Drinking Water)',
      'Emergency Rations Squad': 'அவசர உணவுப் பொருட்கள் பிரிவு (Emergency Food)',
      'Emergency Shelter Team': 'தற்காலிக தங்குமிடம் மற்றும் போர்வைகள் (Emergency Shelter)',
      'Search & Rescue Tracking Team': 'தேடல் மற்றும் மீட்புக் குழு (Search & Rescue Team)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'அவசர மருத்துவ எச்சரிக்கை - உடனடி ஆம்புலன்ஸ் தேவை',
        actionSteps: [
          'உடனடியாக 108 / 112 அவசர எண்ணை அழைக்கவும்',
          'நோயாளியை அமைதியாக உட்கார வைக்கவும், இறுக்கமான ஆடைகளைத் தளர்த்தவும்',
          'மருத்துவர் ஆலோசனையின்றி எந்த மாத்திரையும் உணவும் கொடுக்க வேண்டாம்',
          'ஆம்புலன்ஸ் வரும் வரை நோயாளியின் சுவாசத்தைக் கவனித்துக்கொண்டிருக்கவும்'
        ],
        responderDirective: 'நோயாளி தீவிர மருத்துவ நிலையில் உள்ளார். இதய துடிப்பு மற்றும் சுவாச சோதனையை உடனடியாகச் செய்யவும்.',
        firstAid: [
          'நோயாளிக்கு சுயநினைவு மற்றும் சுவாசம் உள்ளதா என சோதிக்கவும்',
          'ரத்தப்போக்கு இருந்தால் சுத்தமான துணியால் அழுத்திப் பிடிக்கவும்'
        ]
      },
      FIRE: {
        headline: 'தீ விபத்து ஆபத்து - உடனடியாக வெளியேறவும்',
        actionSteps: [
          'அருகிலுள்ள பாதுகாப்பான வழி வழியாக உடனடியாக வெளியேறவும்',
          'விஷப் புகையிலிருந்து தப்ப குனிந்து தரையோடு தவழ்ந்து செல்லவும்',
          'தீ பரவாமல் இருக்க கதவுகளை மூடிவிட்டுச் செல்லவும்',
          'எந்தக் காரணத்தைக் கொண்டும் மின்தூக்கியைப் (Elevator) பயன்படுத்த வேண்டாம்'
        ],
        responderDirective: 'கட்டடத்தில் தீவிர தீப் பரவல் உள்ளது. உள்ளே சிக்கியவர்களை உடனடியாக மீட்கவும்.',
        firstAid: [
          'புகையால் பாதிக்கப்பட்டவரை உடனடியாக வெளிக்காற்றுக்குக் கொண்டு வரவும்',
          'தீக்காயங்கள் மீது 10 நிமிடங்கள் குளிர்ந்த சுத்தமான நீரைக் கொண்டு நனைக்கவும்'
        ]
      },
      RESCUE: {
        headline: 'விபத்து மீட்புப் பணி தேவை - மீட்புக் குழு விரைவு',
        actionSteps: [
          'தீப்பொறி வராமல் தடுக்க வாகனத்தின் இன்ஜினை அணைக்கவும்',
          'தீ ஆபத்து இல்லையெனில் காயமடைந்தவர்களை அவசரப்பட்டு நகர்த்த வேண்டாம்',
          'கழுத்து மற்றும் முதுகுத் தண்டுவடம் அசையாமல் கவனமாகப் பாதுகாக்கவும்',
          'காயமடைந்தவருக்கு ஆறுதல் கூறி அமைதிப்படுத்தவும்'
        ],
        responderDirective: 'வாகனத்தில் ஆட்கள் சிக்கியிருக்க வாய்ப்புள்ளது. ஹைட்ராலிக் வெட்டும் கருவிகளைத் தயார் செய்யவும்.',
        firstAid: [
          'ரத்தம் வழியும் இடங்களில் சுத்தமான துணியை வைத்து அழுத்தவும்',
          'கழுத்து அசையாமல் நேராக வைத்திருக்கவும்'
        ]
      },
      FOOD: {
        headline: 'அவசர உணவு உதவி தேவை - பேரிடர் நிலை',
        actionSteps: [
          'குழந்தைகள், முதியவர்கள் மற்றும் தாய்மார்களுக்கு முன்னுரிமை அளிக்கவும்',
          'உடல் சக்தியை வீணாக்காமல் பாதுகாப்பான இடத்தில் ஓய்வெடுக்கவும்',
          'மீட்புக் குழுவின் கவனத்தை ஈர்க்க கொடி அல்லது பிரகாசமான துணியைக் காட்டவும்',
          'பாதிக்கப்பட்ட அல்லது அழுகிய உணவை உட்கொள்ள வேண்டாம்'
        ],
        responderDirective: 'பேரிடர் பகுதியில் தீவிர உணவுப் பற்றாக்குறை உள்ளது. அவசர உலர் உணவுப் பொட்டலங்களை உடனடியாக வழங்கவும்.',
        firstAid: [
          'உணவின்றி பலவீனமானவர்களுக்கு லேசான உப்பு-சர்க்கரை கரைசலை சிறிது சிறிதாகக் கொடுக்கவும்',
          'திடீரென அதிக உணவு தராமல் மெதுவாக சத்துணவை அறிமுகப்படுத்தவும்'
        ]
      },
      WATER: {
        headline: 'சுத்தமான குடிநீர் பற்றாக்குறை - நீரிழப்பு அபாயம்',
        actionSteps: [
          'வெள்ள நீரிலோ அசுத்தமான நீரிலோ நேரடியாக குடிக்க வேண்டாம்',
          'கிடைக்கும் நீரை குறைந்தது 1 நிமிடம் நன்கு கொதிக்க வைத்து குடிக்கவும்',
          'உள்ள குடிநீரை அனைவருக்கும் சமமாகப் பகிர்ந்தளித்து சிக்கனமாகப் பயன்படுத்தவும்',
          'வியர்வை மற்றும் நீரிழப்பைக் குறைக்க நிழலான இடங்களில் இருக்கவும்'
        ],
        responderDirective: 'சுத்தமான குடிநீர் தட்டுப்பாடு தீவிரமாக உள்ளது. குளோரின் மாத்திரைகள் மற்றும் குடிநீர் கேன்களை விநியோகிக்கவும்.',
        firstAid: [
          'நீரிழப்பு ஏற்பட்டவர்களுக்கு சுத்தமான ஓ.ஆர்.எஸ் (ORS) கரைசலை கொடுக்கவும்',
          'மயக்கமடைந்தவரை குளிர்ந்த நிழலில் படுக்க வைத்து நெற்றியில் ஈரத்துணி வைக்கவும்'
        ]
      },
      SHELTER: {
        headline: 'அவசர தங்குமிடம் தேவை - கடுமையான இயற்கை பாதிப்பு',
        actionSteps: [
          'உறுதியான, பாதுகாப்பான எஞ்சிய கட்டடத்தில் குடும்பத்தினரை ஒன்று சேர்க்கவும்',
          'குளிரிலிருந்து தப்ப உலர் உடைகள் மற்றும் போர்வைகளைப் பயன்படுத்தவும்',
          'விரிசல் விழுந்த சுவர்கள் மற்றும் அறுந்து விழுந்த மின்கம்பிகளை விட்டு விலகி நிற்கவும்',
          'இரவு நேர மீட்புக் குழுவினருக்கு டார்ச் லைட் அல்லது சிக்னல் வெளிச்சம் காட்டவும்'
        ],
        responderDirective: 'பாதிக்கப்பட்ட மக்கள் தங்குமிடமின்றி திறந்தவெளியில் உள்ளனர். அருகிலுள்ள நிவாரண முகாமுக்கு அழைத்துச் செல்லவும்.',
        firstAid: [
          'குளிர் நடுக்கம் உள்ளவர்களுக்கு உலர் போர்வைகளை போர்த்தி சூடேற்றவும்',
          'காயங்கள் ஏதேனும் இருந்தால் சுத்தமான துணியால் மூடவும்'
        ]
      },
      MISSING_PERSON: {
        headline: 'காணாமல் போன நபர் தேடல் - உடனடி மீட்பு முயற்சி',
        actionSteps: [
          'நபர் கடைசியாகக் காணப்பட்ட இடம் மற்றும் அவர் அணிந்திருந்த ஆடை விவரங்களை குறித்துக்கொள்ளவும்',
          'மோப்ப நாய்களுக்காக நபர் பயன்படுத்திய துணிகளைப் பாதுகாப்பாக வைக்கவும்',
          'தேடல் பகுதியைப் பாழாக்காமல் உடனடியாகக் காவல்துறையிடம் தகவல் தெரிவிக்கவும்',
          'அக்கம்பக்கத்தினருக்கும் அவசர மீட்புக் குழுவினருக்கும் புகைப்படம் பகிரவும்'
        ],
        responderDirective: 'காணாமல் போனவரைத் தேடும் பணிக்கு முன்னுரிமை அளிக்கவும். காவல் மற்றும் தேடல் நாய்களை ஈடுபடுத்தவும்.',
        firstAid: [
          'மீட்கப்பட்டவுடன் குடிநீர் மற்றும் அவசர முதலுதவி அளிக்கத் தயாராக இருக்கவும்',
          'அதிர்ச்சி அல்லது நீரிழப்பு உள்ளதா என மருத்துவப் பரிசோதனை செய்யவும்'
        ]
      },
      OTHER: {
        headline: 'அவசர உதவி எச்சரிக்கை - அவசர நடவடிக்கை தேவை',
        actionSteps: [
          'ஆபத்தான பகுதியிலிருந்து பாதுகாப்பான தொலைவுக்கு உடனடியாக நகரவும்',
          'அவசர மீட்புக் குழுவினர் தொடர்புகொள்ள அலைபேசியை ஆன் செய்து வைக்கவும்',
          'மற்றவர்களையும் அந்த பகுதிக்குச் செல்லாமல் எச்சரிக்கவும்',
          'அதிகாரிகள் வந்தவுடன் அவர்களின் வழிகாட்டுதல்களைப் பின்பற்றவும்'
        ],
        responderDirective: 'சம்பவ இடத்தை விரைந்து ஆய்வு செய்து உரிய அவசரப் பாதுகாப்புப் பிரிவை அனுப்பவும்.',
        firstAid: [
          'முதலில் உங்கள் சொந்த பாதுகாப்பை உறுதிசெய்த பின்பே மற்றவர்களுக்கு உதவவும்',
          'பாதிக்கப்பட்டவரை ஆறுதல்படுத்தி பாதுகாப்பாக வைத்திருக்கவும்'
        ]
      }
    }
  },
  hi: {
    categoryLabels: {
      MEDICAL: 'चिकित्सा आपातकाल (Medical)',
      FIRE: 'आग एवं विस्फोट दुर्घटना (Fire)',
      RESCUE: 'खोज एवं बचाव कार्य (Rescue)',
      FOOD: 'आपातकालीन खाद्य सहायता (Food Aid)',
      WATER: 'पेयजल संकट (Drinking Water)',
      SHELTER: 'आपातकालीन आश्रय (Shelter)',
      MISSING_PERSON: 'लापता व्यक्ति (Missing Person)',
      OTHER: 'सामान्य आपातकाल (Emergency)'
    },
    dispatchHeader: 'आपातकालीन प्रेषण चेतावनी (DISPATCH ALERT)',
    priorityLabel: 'प्राथमिकता (Priority)',
    requiredAssetsLabel: 'आवश्यक सहायता एवं इकाइयाँ',
    actionRequiredLabel: 'कार्रवाई: निकटतम प्रतिक्रिया दल को तुरंत भेजें।',
    responderArrivalDirective: 'पहुंचते ही तत्काल दृश्य सुरक्षा और जीवन रक्षक परीक्षण करें।',
    immediateActionPrefix: 'तत्काल सुरक्षा कदम',
    firstAidHeader: 'प्राथमिक चिकित्सा निर्देश',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'पैरामेडिक एम्बुलेंस (ALS Ambulance)',
      'Automated External Defibrillator (AED)': 'हृदय गति बहाली उपकरण (AED Defibrillator)',
      'Fire Engine Suppression': 'दमकल वाहन (Fire Engine)',
      'Heavy Hydraulic Rescue': 'हाइड्रोलिक बचाव दल (Hydraulic Rescue)',
      'Drinking Water Supply Unit': 'स्वच्छ पेयजल आपूर्ति दल (Drinking Water)',
      'Emergency Rations Squad': 'आपातकालीन राशन व शिशु आहार (Emergency Rations)',
      'Emergency Shelter Team': 'अस्थायी आश्रय व कंबल दल (Emergency Shelter)',
      'Search & Rescue Tracking Team': 'खोज एवं बचाव दल (Search & Rescue Team)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'गंभीर चिकित्सा आपातकाल - तुरंत एम्बुलेंस भेजें',
        actionSteps: [
          'तुरंत 108 / 112 आपातकालीन नंबर पर कॉल करें',
          'रोगी को आराम से आधी बैठी स्थिति में रखें, तंग कपड़े ढीले करें',
          'डॉक्टर की सलाह के बिना कोई दवा या पेय न दें',
          'एम्बुलेंस आने तक सांस और नाड़ी की निगरानी जारी रखें'
        ],
        responderDirective: 'रोगी गंभीर स्थिति में है। तुरंत ईसीजी और आपातकालीन ऑक्सीजन तैयार रखें।',
        firstAid: [
          'जांचें कि मरीज होश में है या नहीं और सांस ले रहा है या नहीं',
          'रक्तस्राव होने पर साफ कपड़े से सीधा दबाव डालें'
        ]
      },
      FIRE: {
        headline: 'आग और धुएं का खतरा - तुरंत बाहर निकलें',
        actionSteps: [
          'निकटतम सुरक्षित निकास से तुरंत बाहर निकलें',
          'जहरीले धुएं से बचने के लिए फर्श पर झुककर या रेंगकर चलें',
          'आग की गति धीमी करने के लिए पीछे के दरवाजे बंद करते जाएं',
          'किसी भी स्थिति में लिफ्ट का प्रयोग न करें'
        ],
        responderDirective: 'इमारत में आग फैल रही है। फंसे हुए लोगों को निकालने के लिए तुरंत खोज शुरू करें।',
        firstAid: [
          'धुएं से प्रभावित व्यक्ति को तुरंत ताजी हवा में लाएं',
          'जले हुए स्थान पर 10 मिनट तक ठंडा साफ पानी डालें'
        ]
      },
      RESCUE: {
        headline: 'सड़क दुर्घटना एवं बचाव - तुरंत हाइड्रोलिक कटर भेजें',
        actionSteps: [
          'आग से बचाव के लिए वाहन का इंजन तुरंत बंद करें',
          'गंभीर आग के खतरे के बिना घायल को जबरन न हिलाएं',
          'गर्दन और रीढ़ की हड्डी को स्थिर रखें',
          'घायल को शांत रखें और ढांढस बंधाएं'
        ],
        responderDirective: 'वाहन में लोगों के फंसे होने की आशंका है। हाइड्रोलिक उपकरण और स्ट्रेचर तैयार रखें।',
        firstAid: [
          'बहते खून को रोकने के लिए साफ कपड़े से दबाएं',
          'गर्दन को सीधा रखें और झुकने न दें'
        ]
      },
      FOOD: {
        headline: 'आपातकालीन भोजन व शिशु आहार की सख्त आवश्यकता',
        actionSteps: [
          'बच्चों, बुजुर्गों और माताओं को उपलब्ध भोजन में प्राथमिकता दें',
          'ऊर्जा बचाने के लिए सुरक्षित स्थान पर विश्राम करें',
          'बचाव दल को दूर से संकेत देने के लिए कपड़ा या झंडा दिखाएं',
          'बाढ़ या दूषित पानी से खराब हुआ भोजन न खाएं'
        ],
        responderDirective: 'आपदा क्षेत्र में भोजन की भारी कमी है। तुरंत उच्च ऊर्जा वाले राशन पैकेट वितरित करें।',
        firstAid: [
          'कमजोर व्यक्ति को ओआरएस या हल्का चीनी-नमक का घोल धीरे-धीरे पिलाएं',
          'अचानक बहुत भारी भोजन देने से बचें'
        ]
      },
      WATER: {
        headline: 'पेयजल का गंभीर संकट - निर्जलीकरण का खतरा',
        actionSteps: [
          'बाढ़ या गंदे पानी को सीधे बिल्कुल न पिएं',
          'उपलब्ध पानी को कम से कम 1 मिनट उबालकर ही पिएं',
          'बचे हुए पानी को सभी के बीच समान रूप से बांटें',
          'पसीने और पानी की कमी से बचने के लिए छांव में रहें'
        ],
        responderDirective: 'स्वच्छ पानी की आपूर्ति ठप है। क्लोरीन की गोलियां और सीलबंद पानी तुरंत पहुंचाएं।',
        firstAid: [
          'डिहाइड्रेशन के मरीज को ओआरएस का घोल घूंट-घूंट करके दें',
          'रोगी को ठंडी जगह पर लिटाएं और सिर पर गीला कपड़ा रखें'
        ]
      },
      SHELTER: {
        headline: 'आपातकालीन आश्रय की आवश्यकता - ठंड व मौसम का प्रकोप',
        actionSteps: [
          'परिवार को किसी सुरक्षित व मजबूत हिस्से में एकत्रित करें',
          'ठंड से बचने के लिए सूखे कपड़े और कंबल ओढ़ें',
          'टूटी दीवारों और लटकते बिजली के तारों से दूर रहें',
          'रात में बचाव दल को टॉर्च या रोशनी का संकेत दिखाएं'
        ],
        responderDirective: 'लोग बेघर होकर खुले आसमान के नीचे हैं। तुरंत राहत शिविर में स्थानांतरित करें।',
        firstAid: [
          'ठंड से कांप रहे व्यक्ति को सूखे गर्म कंबलों से ढकें',
          'चोटों पर साफ पट्टी बांधें'
        ]
      },
      MISSING_PERSON: {
        headline: 'लापता व्यक्ति की तलाश - तत्काल खोज अभियान',
        actionSteps: [
          'अंतिम बार देखे गए स्थान और पहने गए कपड़ों का सटीक विवरण नोट करें',
          'खोजी कुत्तों के लिए व्यक्ति द्वारा इस्तेमाल किए गए कपड़े सुरक्षित रखें',
          'तुरंत पुलिस और आपदा प्रबंधन को सूचित करें',
          'आस-पास के सभी समूहों में तस्वीर और विवरण साझा करें'
        ],
        responderDirective: 'समय अत्यंत महत्वपूर्ण है। पुलिस और डॉग स्क्वायड के साथ तुरंत घेराबंदी कर खोजें।',
        firstAid: [
          'मिलने पर तुरंत प्राथमिक चिकित्सा और पानी उपलब्ध कराएं',
          'शारीरिक चोट या घबराहट की जांच करें'
        ]
      },
      OTHER: {
        headline: 'आपातकालीन स्थिति - त्वरित कार्रवाई आवश्यक',
        actionSteps: [
          'खतरे वाले क्षेत्र से तुरंत सुरक्षित दूरी पर चले जाएं',
          'आपातकालीन संपर्क के लिए मोबाइल चालू रखें',
          'अन्य लोगों को भी खतरे से आगाह करें',
          'बचाव कर्मियों के आने पर उनके निर्देशों का पालन करें'
        ],
        responderDirective: 'घटनास्थल का त्वरित निरीक्षण करें और उपयुक्त विशेषज्ञ टीम तैनात करें।',
        firstAid: [
          'पहले अपनी सुरक्षा सुनिश्चित करें, फिर दूसरों की मदद करें',
          'मरीज को सांत्वना दें और सुरक्षित स्थिति में रखें'
        ]
      }
    }
  },
  te: {
    categoryLabels: {
      MEDICAL: 'వైద్య అత్యవసరం (Medical)',
      FIRE: 'అగ్ని ప్రమాదం (Fire)',
      RESCUE: 'రెస్క్యూ & సహాయక చర్యలు (Rescue)',
      FOOD: 'అత్యవసర ఆహార సహాయం (Food Aid)',
      WATER: 'తాగునీటి సంక్షోభం (Drinking Water)',
      SHELTER: 'అత్యవసర ఆశ్రయం (Shelter)',
      MISSING_PERSON: 'తప్పిపోయిన వ్యక్తి (Missing Person)',
      OTHER: 'సాధారణ అత్యవసరం (Emergency)'
    },
    dispatchHeader: 'అత్యవసర సమాచారం (DISPATCH ALERT)',
    priorityLabel: 'ప్రాధాన్యత (Priority)',
    requiredAssetsLabel: 'అవసరమైన సహాయక బృందాలు',
    actionRequiredLabel: 'చర్య: సమీప సహాయక బృందాన్ని వెంటనే పంపండి.',
    responderArrivalDirective: 'చేరుకున్న వెంటనే ప్రాథమిక చికిత్స మరియు రక్షణ చర్యలను ప్రారంభించండి.',
    immediateActionPrefix: 'తక్షణ భద్రతా చర్యలు',
    firstAidHeader: 'ప్రథమ చికిత్స మార్గదర్శకాలు',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'అంబులెన్స్ వాహనం (ALS Ambulance)',
      'Automated External Defibrillator (AED)': 'గుండె పునరుద్ధరణ పరికరం (AED)',
      'Fire Engine Suppression': 'ఫైర్ ఇంజిన్ (Fire Engine)',
      'Heavy Hydraulic Rescue': 'హైడ్రాలిక్ రెస్క్యూ బృందం (Hydraulic Rescue)',
      'Drinking Water Supply Unit': 'తాగునీటి సరఫరా విభాగం (Drinking Water)',
      'Emergency Rations Squad': 'అత్యవసర ఆహార సామాగ్రి (Emergency Rations)',
      'Emergency Shelter Team': 'తాత్కాలిక ఆశ్రయం & దుప్పట్లు (Emergency Shelter)',
      'Search & Rescue Tracking Team': 'శోధన మరియు రెస్క్యూ బృందం (Search & Rescue)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'తీవ్ర వైద్య అత్యవసర పరిస్థితి - వెంటనే అంబులెన్స్ పంపండి',
        actionSteps: [
          'వెంటనే 108 లేదా 112 నంబర్‌కు కాల్ చేయండి',
          'రోగిని నిశ్శబ్దంగా సౌకర్యవంతమైన స్థితిలో ఉంచండి',
          'వైద్యుల సలహా లేకుండా ఎటువంటి మందులు ఇవ్వవద్దు',
          'అంబులెన్స్ వచ్చే వరకు శ్వాసక్రియను గమనించండి'
        ],
        responderDirective: 'రోగి పరిస్థితి ఆందోళనకరంగా ఉంది. తక్షణ వైద్య పరీక్షలు ప్రారంభించండి.',
        firstAid: [
          'రోగి స్పృహలో ఉన్నారో లేదో పరిశీలించండి',
          'రక్తస్రావం ఉంటే శుభ్రమైన గుడ్డతో గట్టిగా నొక్కండి'
        ]
      },
      FIRE: {
        headline: 'అగ్ని ప్రమాదం - వెంటనే భవనం నుండి బయటకు రండి',
        actionSteps: [
          'సమీప సురక్షిత మార్గం ద్వారా వెంటనే బయటకు రండి',
          'విషపూరిత పొగ పీల్చకుండా నేలపై వంగి నడవండి',
          'మంటలు వ్యాపించకుండా వెనుక తలుపులు మూసివేయండి',
          'లిఫ్టులను ఎట్టిపరిస్థితుల్లోనూ ఉపయోగించవద్దు'
        ],
        responderDirective: 'భవనంలో మంటలు చెలరేగుతున్నాయి. చిక్కుకున్న వారిని వెంటనే రక్షించండి.',
        firstAid: [
          'పొగ బారిన పడిన వారిని వెంటనే స్వచ్ఛమైన గాలిలోకి తీసుకురండి',
          'కాలిన గాయాలపై 10 నిమిషాల పాటు చల్లటి నీరు పోయండి'
        ]
      },
      RESCUE: {
        headline: 'వాహన ప్రమాదం - రెస్క్యూ కట్టర్లు అవసరం',
        actionSteps: [
          'మంటలు చెలరేగకుండా వాహనం ఇంజిన్ ఆపివేయండి',
          'తీవ్రమైన ముప్పు లేకపోతే క్షతగాత్రులను కదల్చవద్దు',
          'మెడ మరియు వెన్నెముక కదలకుండా జాగ్రత్త వహించండి',
          'క్షతగాత్రులకు ధైర్యం చెప్పి ఓదార్చండి'
        ],
        responderDirective: 'వాహనంలో వ్యక్తులు చిక్కుకున్నారు. హైడ్రాలిక్ కట్టర్లు సిద్ధం చేయండి.',
        firstAid: [
          'రక్తస్రావాన్ని ఆపడానికి శుభ్రమైన గుడ్డతో ఒత్తిడి చేయండి',
          'మెడను నిటారుగా ఉంచండి'
        ]
      },
      FOOD: {
        headline: 'అత్యవసర ఆహార సహాయం అవసరం - విపత్తు ప్రాంతం',
        actionSteps: [
          'పిల్లలు, వృద్ధులు మరియు బాలింతలకు ప్రాధాన్యత ఇవ్వండి',
          'శక్తిని ఆదా చేసుకునేందుకు సురక్షిత ప్రదేశంలో విశ్రాంతి తీసుకోండి',
          'రెస్క్యూ టీమ్‌లకు సంకేతంగా జెండా లేదా రంగు గుడ్డను ప్రదర్శించండి',
          'పాడైపోయిన వరద ఆహారాన్ని తినవద్దు'
        ],
        responderDirective: 'తీవ్ర ఆహార కొరత ఉంది. వెంటనే అత్యవసర ఆహార పొట్లాలు పంపిణీ చేయండి.',
        firstAid: [
          'బలహీనంగా ఉన్నవారికి ఓఆర్ఎస్ లేదా ఉప్పు-చక్కెర ద్రావణం కొద్దికొద్దిగా ఇవ్వండి',
          'నెమ్మదిగా తేలికపాటి ఆహారాన్ని అందించండి'
        ]
      },
      WATER: {
        headline: 'తాగునీటి కొరత - డీహైడ్రేషన్ ముప్పు',
        actionSteps: [
          'వరద నీటిని నేరుగా తాగవద్దు',
          'నీటిని కనీసం ఒక నిమిషం పాటు మరిగించి మాత్రమే తాగండి',
          'లభ్యమైన నీటిని అందరికీ సమానంగా పంచండి',
          'నీడలో ఉండి శరీరంలోని నీటిని కాపాడుకోండి'
        ],
        responderDirective: 'తాగునీటి సంక్షోభం తీవ్రంగా ఉంది. వెంటనే క్లోరిన్ మాత్రలు మరియు తాగునీరు అందించండి.',
        firstAid: [
          'డీహైడ్రేషన్ రోగులకు ఓఆర్ఎస్ ద్రావణం నెమ్మదిగా తాగించండి',
          'చల్లటి ప్రదేశంలో పడుకోబెట్టి నుదుటిపై తడిగుడ్డ ఉంచండి'
        ]
      },
      SHELTER: {
        headline: 'అత్యవసర ఆశ్రయం అవసరం - తీవ్ర వాతావరణ ముప్పు',
        actionSteps: [
          'కుటుంబాన్ని సురక్షితమైన మిగిలిన భవన భాగంలో చేర్చండి',
          'చలి నుండి రక్షణకు పొడి దుస్తులు మరియు దుప్పట్లు వాడండి',
          'కూలిపోయే గోడలు మరియు విద్యుత్ వైర్లకు దూరంగా ఉండండి',
          'రాత్రి వేళ టార్చ్ లైట్ లేదా కాంతి సంకేతాలు చూపించండి'
        ],
        responderDirective: 'నిరాశ్రయులైన వారిని వెంటనే సహాయ పునరావాస శిబిరానికి తరలించండి.',
        firstAid: [
          'చలితో వణుకుతున్న వారిని వెచ్చని దుప్పట్లతో కప్పండి',
          'గాయాలపై శుభ్రమైన కట్టు కట్టండి'
        ]
      },
      MISSING_PERSON: {
        headline: 'తప్పిపోయిన వ్యక్తి కోసం గాలింపు - తక్షణ చర్య',
        actionSteps: [
          'చివరిగా కనిపించిన ప్రదేశం మరియు దుస్తుల వివరాలు భద్రపరచండి',
          'స్నిఫర్ డాగ్స్ కోసం వ్యక్తి వాడిన వస్త్రాలను జాగ్రత్త చేయండి',
          'వెంటనే పోలీసులకు సమాచారం అందించండి',
          'సమీప ప్రాంతాల ప్రజలకు ఫోటో పంపండి'
        ],
        responderDirective: 'సమయం చాలా విలువైనది. డాగ్ స్క్వాడ్‌తో గాలింపు ముమ్మరం చేయండి.',
        firstAid: [
          'దొరికిన వెంటనే నీరు మరియు ప్రాథమిక చికిత్స అందించండి',
          'ఆందోళన లేదా గాయాలు ఉన్నాయేమో పరీక్షించండి'
        ]
      },
      OTHER: {
        headline: 'అత్యవసర పరిస్థితి - తక్షణ స్పందన అవసరం',
        actionSteps: [
          'ప్రమాద ప్రాంతం నుండి వెంటనే సురక్షిత దూరానికి వెళ్లండి',
          'రెస్క్యూ టీమ్ కాల్ కోసం ఫోన్ సిద్ధంగా ఉంచండి',
          'ఇతరులను కూడా ఆ ప్రాంతానికి రాకుండా హెచ్చరించండి',
          'సహాయక సిబ్బంది ఆదేశాలను పాటించండి'
        ],
        responderDirective: 'పరిస్థితిని సమీక్షించి తగిన సహాయక బృందాన్ని మోహరించండి.',
        firstAid: [
          'మీ స్వంత భద్రతను నిర్ధారించుకున్న తర్వాతే ఇతరులకు సహాయం చేయండి',
          'బాధిత వ్యక్తికి ధైర్యం చెప్పండి'
        ]
      }
    }
  },
  kn: {
    categoryLabels: {
      MEDICAL: 'ವೈದ್ಯಕೀಯ ತುರ್ತುಸ್ಥಿತಿ (Medical)',
      FIRE: 'ಬೆಂಕಿ ಮತ್ತು ಸ್ಫೋಟ (Fire)',
      RESCUE: 'ರಕ್ಷಣಾ ಕಾರ್ಯಾಚರಣೆ (Rescue)',
      FOOD: 'ತುರ್ತು ಆಹಾರ ನೆರವು (Food Aid)',
      WATER: 'ಕುಡಿಯುವ ನೀರಿನ ಕೊರತೆ (Water)',
      SHELTER: 'ತುರ್ತು ಆಶ್ರಯ (Shelter)',
      MISSING_PERSON: 'ಕಾಣೆಯಾದ ವ್ಯಕ್ತಿ (Missing Person)',
      OTHER: 'ಸಾಮಾನ್ಯ ತುರ್ತುಸ್ಥಿತಿ (Emergency)'
    },
    dispatchHeader: 'ತುರ್ತು ರವಾನೆ ಎಚ್ಚರಿಕೆ (DISPATCH ALERT)',
    priorityLabel: 'ಆದ್ಯತೆ (Priority)',
    requiredAssetsLabel: 'ಅಗತ್ಯವಿರುವ ನೆರವು ಮತ್ತು ತಂಡಗಳು',
    actionRequiredLabel: 'ಕ್ರಮ: ಹತ್ತಿರದ ರಕ್ಷಣಾ ತಂಡವನ್ನು ತಕ್ಷಣ ಕಳುಹಿಸಿ.',
    responderArrivalDirective: 'ತಲುಪಿದ ತಕ್ಷಣ ಪ್ರಾಥಮಿಕ ಚಿಕಿತ್ಸೆ ಮತ್ತು ಜೀವ ರಕ್ಷಣಾ ತಪಾಸಣೆ ನಡೆಸಿ.',
    immediateActionPrefix: 'ತಕ್ಷಣದ ಸುರಕ್ಷತಾ ಕ್ರಮಗಳು',
    firstAidHeader: 'ಪ್ರಥಮ ಚಿಕಿತ್ಸಾ ಮಾರ್ಗಸೂಚಿಗಳು',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'ಆಂಬ್ಯುಲೆನ್ಸ್ ವಾಹನ (ALS Ambulance)',
      'Automated External Defibrillator (AED)': 'ಹೃದಯ ಪುನಶ್ಚೇತನ ಯಂತ್ರ (AED Defibrillator)',
      'Fire Engine Suppression': 'ಅಗ್ನಿಶಾಮಕ ವಾಹನ (Fire Engine)',
      'Heavy Hydraulic Rescue': 'ಹೈಡ್ರಾಲಿಕ್ ರಕ್ಷಣಾ ತಂಡ (Hydraulic Rescue)',
      'Drinking Water Supply Unit': 'ಶುದ್ಧ ಕುಡಿಯುವ ನೀರು ಪೂರೈಕೆ (Drinking Water)',
      'Emergency Rations Squad': 'ತುರ್ತು ಪಡಿತರ ಸಾಮಗ್ರಿ (Emergency Rations)',
      'Emergency Shelter Team': 'ತಾತ್ಕಾಲಿಕ ಆಶ್ರಯ ಮತ್ತು ಕಂಬಳಿಗಳು (Emergency Shelter)',
      'Search & Rescue Tracking Team': 'ಶೋಧ ಮತ್ತು ರಕ್ಷಣಾ ತಂಡ (Search & Rescue)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'ಗಂಭೀರ ವೈದ್ಯಕೀಯ ತುರ್ತುಸ್ಥಿತಿ - ತಕ್ಷಣ ಆಂಬ್ಯುಲೆನ್ಸ್ ಕಳುಹಿಸಿ',
        actionSteps: [
          'ತಕ್ಷಣವೇ 108 ಅಥವಾ 112 ಗೆ ಕರೆ ಮಾಡಿ',
          'ರೋಗಿಯನ್ನು ಆರಾಮದಾಯಕ ಭಂಗಿಯಲ್ಲಿ ಕುಳ್ಳಿರಿಸಿ, ಬಿಗಿಯಾದ ಬಟ್ಟೆಗಳನ್ನು ಸಡಿಲಗೊಳಿಸಿ',
          'ವೈದ್ಯರ ಸಲಹೆಯಿಲ್ಲದೆ ಯಾವುದೇ ಮಾತ್ರೆ ಅಥವಾ ದ್ರವ ನೀಡಬೇಡಿ',
          'ಆಂಬ್ಯುಲೆನ್ಸ್ ಬರುವವರೆಗೆ ಉಸಿರಾಟವನ್ನು ಗಮನಿಸುತ್ತಿರಿ'
        ],
        responderDirective: 'ರೋಗಿಯ ಸ್ಥಿತಿ ಗಂಭೀರವಾಗಿದೆ. ಇಸಿಜಿ ಮತ್ತು ಆಮ್ಲಜನಕವನ್ನು ಸಿದ್ಧವಾಗಿಡಿ.',
        firstAid: [
          'ಪ್ರಜ್ಞೆ ಮತ್ತು ಉಸಿರಾಟವನ್ನು ಪರೀಕ್ಷಿಸಿ',
          'ರಕ್ತಸ್ರಾವವಿದ್ದರೆ ಸ್ವಚ್ಛವಾದ ಬಟ್ಟೆಯಿಂದ ಒತ್ತಿ ಹಿಡಿಯಿರಿ'
        ]
      },
      FIRE: {
        headline: 'ಬೆಂಕಿ ಮತ್ತು ಹೊಗೆಯ ಅಪಾಯ - ತಕ್ಷಣ ಹೊರಬನ್ನಿ',
        actionSteps: [
          'ಹತ್ತಿರದ ಸುರಕ್ಷಿತ ದಾರಿಯ ಮೂಲಕ ತಕ್ಷಣವೇ ಹೊರಬನ್ನಿ',
          'ವಿಷಕಾರಿ ಹೊಗೆಯಿಂದ ತಪ್ಪಿಸಿಕೊಳ್ಳಲು ನೆಲದ ಮೇಲೆ ಬಗ್ಗಿ ಸಾಗಿ',
          'ಬೆಂಕಿ ಹರಡುವುದನ್ನು ತಡೆಯಲು ಹಿಂಬದಿಯ ಬಾಗಿಲುಗಳನ್ನು ಮುಚ್ಚಿ',
          'ಯಾವುದೇ ಕಾರಣಕ್ಕೂ ಲಿಫ್ಟ್ ಬಳಸಬೇಡಿ'
        ],
        responderDirective: 'ಕಟ್ಟಡದಲ್ಲಿ ಬೆಂಕಿ ವ್ಯಾಪಿಸುತ್ತಿದೆ. ಸಿಲುಕಿರುವವರನ್ನು ತಕ್ಷಣವೇ ರಕ್ಷಿಸಿ.',
        firstAid: [
          'ಹೊಗೆಯಿಂದ ಬಾಧಿತರಾದವರನ್ನು ತಕ್ಷಣ ಶುದ್ಧ ಗಾಳಿಗೆ ಕರೆತನ್ನಿ',
          'ಸುಟ್ಟ ಗಾಯಗಳ ಮೇಲೆ 10 ನಿಮಿಷಗಳ ಕಾಲ ತಣ್ಣೀರು ಸುರಿಯಿರಿ'
        ]
      },
      RESCUE: {
        headline: 'ರಸ್ತೆ ಅಪಘಾತ ರಕ್ಷಣೆ - ಕಟಿಂಗ್ ಉಪಕರಣಗಳ ಅಗತ್ಯವಿದೆ',
        actionSteps: [
          'ಬೆಂಕಿಯ ಅಪಾಯ ತಪ್ಪಿಸಲು ವಾಹನದ ಎಂಜಿನ್ ಆಫ್ ಮಾಡಿ',
          'ತೀವ್ರ ಬೆಂಕಿಯ ಅಪಾಯವಿಲ್ಲದಿದ್ದರೆ ಗಾಯಾಳುಗಳನ್ನು ಬಲವಂತವಾಗಿ ಎಳೆಯಬೇಡಿ',
          'ಕುತ್ತಿಗೆ ಮತ್ತು ಬೆನ್ನುಮೂಳೆಯನ್ನು ಅಲುಗಾಡದಂತೆ ಕಾಪಾಡಿ',
          'ಗಾಯಾಳುಗಳಿಗೆ ಧೈರ್ಯ ನೀಡಿ ಸಮಾಧಾನಪಡಿಸಿ'
        ],
        responderDirective: 'ವಾಹನದಲ್ಲಿ ಜನರು ಸಿಲುಕಿಕೊಂಡಿದ್ದಾರೆ. ಹೈಡ್ರಾಲಿಕ್ ರಕ್ಷಣಾ ಪರಿಕರಗಳನ್ನು ಸಿದ್ಧಪಡಿಸಿ.',
        firstAid: [
          'ರಕ್ತಸ್ರಾವ ನಿಲ್ಲಿಸಲು ಬಟ್ಟೆಯಿಂದ ಒತ್ತಿ ಹಿಡಿಯಿರಿ',
          'ಕುತ್ತಿಗೆ ನೇರವಾಗಿರುವಂತೆ ನೋಡಿಕೊಳ್ಳಿ'
        ]
      },
      FOOD: {
        headline: 'ತುರ್ತು ಆಹಾರ ನೆರವು ಅಗತ್ಯವಿದೆ - ಸಂತ್ರಸ್ತ ಪ್ರದೇಶ',
        actionSteps: [
          'ಮಕ್ಕಳು, ಹಿರಿಯರು ಮತ್ತು ಗರ್ಭಿಣಿಯರಿಗೆ ಆದ್ಯತೆ ನೀಡಿ',
          'ಶಕ್ತಿಯನ್ನು ಉಳಿಸಲು ಸುರಕ್ಷಿತ ಜಾಗದಲ್ಲಿ ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ',
          'ರಕ್ಷಣಾ ತಂಡಕ್ಕೆ ಸಂಕೇತವಾಗಿ ಬಟ್ಟೆ ಅಥವಾ ಧ್ವಜ ಪ್ರದರ್ಶಿಸಿ',
          'ಹಾಳಾದ ಪ್ರವಾಹದ ನೀರು ತಾಗಿದ ಆಹಾರ ಸೇವಿಸಬೇಡಿ'
        ],
        responderDirective: 'ಆಹಾರದ ಕೊರತೆ ತೀವ್ರವಾಗಿದೆ. ತಕ್ಷಣ ಪೌಷ್ಟಿಕ ಆಹಾರದ ಪೊಟ್ಟಣಗಳನ್ನು ವಿತರಿಸಿ.',
        firstAid: [
          'ದುರ್ಬಲರಿಗೆ ಒಆರ್‌ಎಸ್ ಅಥವಾ ಸಕ್ಕರೆ-ಉಪ್ಪಿನ ದ್ರಾವಣವನ್ನು ಹನಿಹನಿಯಾಗಿ ನೀಡಿ',
          'ಹಂತ-ಹಂತವಾಗಿ ಆಹಾರ ನೀಡಿ'
        ]
      },
      WATER: {
        headline: 'ಕುಡಿಯುವ ನೀರಿನ ಕೊರತೆ - ನಿರ್ಜಲೀಕರಣದ ಅಪಾಯ',
        actionSteps: [
          'ಪ್ರವಾಹದ ಅಥವಾ ಅಶುದ್ಧ ನೀರನ್ನು ನೇರವಾಗಿ ಕುಡಿಯಬೇಡಿ',
          'ಲಭ್ಯವಿರುವ ನೀರನ್ನು ಕನಿಷ್ಠ 1 ನಿಮಿಷ ಚೆನ್ನಾಗಿ ಕುದಿಸಿ ಕುಡಿಯಿರಿ',
          'ನೀರಿನ ಬಳಕೆಯನ್ನು ಮಿತವಾಗಿರಿಸಿ, ಎಲ್ಲರಿಗೂ ಹಂಚಿ',
          'ಬೆವರುವಿಕೆ ತಡೆಯಲು ನೆರಳಿನಲ್ಲಿ ವಿಶ್ರಮಿಸಿ'
        ],
        responderDirective: 'ಕುಡಿಯುವ ನೀರಿನ ತುರ್ತು ಸರಬರಾಜು ಮಾಡಿ. ಕ್ಲೋರಿನ್ ಮಾತ್ರೆಗಳನ್ನು ತಕ್ಷಣ ವಿತರಿಸಿ.',
        firstAid: [
          'ನಿರ್ಜಲೀಕರಣಗೊಂಡವರಿಗೆ ಒಆರ್‌ಎಸ್ ನೀಡಿ',
          'ತಂಪಾದ ಜಾಗದಲ್ಲಿ ಮಲಗಿಸಿ ಹಣೆಯ ಮೇಲೆ ತೇವದ ಬಟ್ಟೆ ಇಡಿ'
        ]
      },
      SHELTER: {
        headline: 'ತುರ್ತು ಆಶ್ರಯ ಅಗತ್ಯವಿದೆ - ನೈಸರ್ಗಿಕ ವಿಕೋಪದ ಎಚ್ಚರಿಕೆ',
        actionSteps: [
          'ಕುಟುಂಬವನ್ನು ಸುರಕ್ಷಿತ ಕಟ್ಟಡದ ಭಾಗದಲ್ಲಿ ಒಟ್ಟುಗೂಡಿಸಿ',
          'ಚಳಿಯಿಂದ ರಕ್ಷಿಸಿಕೊಳ್ಳಲು ಒಣ ಬಟ್ಟೆ ಮತ್ತು ಕಂಬಳಿಗಳನ್ನು ಧರಿಸಿ',
          'ಬಿರುಕು ಬಿಟ್ಟ ಗೋಡೆಗಳು ಮತ್ತು ವಿದ್ಯುತ್ ತಂತಿಗಳಿಂದ ದೂರವಿರಿ',
          'ರಾತ್ರಿಯ ವೇಳೆ ಟಾರ್ಚ್ ಅಥವಾ ಬೆಳಕಿನ ಸಂಕೇತಗಳನ್ನು ತೋರಿಸಿ'
        ],
        responderDirective: 'ನಿರಾಶ್ರಿತರನ್ನು ತಕ್ಷಣ ಪುನರ್ವಸತಿ ಶಿಬಿರಕ್ಕೆ ಸ್ಥಳಾಂತರಿಸಿ.',
        firstAid: [
          'ಚಳಿಗೆ ನಡುಗುವವರಿಗೆ ಬೆಚ್ಚಗಿನ ಹೊದಿಕೆ ಹೊದಿಸಿ',
          'ಗಾಯಗಳಿದ್ದರೆ ಶುದ್ಧ ಬ್ಯಾಂಡೇಜ್ ಕಟ್ಟಿ'
        ]
      },
      MISSING_PERSON: {
        headline: 'ಕಾಣೆಯಾದ ವ್ಯಕ್ತಿಯ ಹುಡುಕಾಟ - ಶೀಘ್ರ ಕಾರ್ಯಾಚರಣೆ',
        actionSteps: [
          'ಕೊನೆಯದಾಗಿ ಕಂಡ ಸ್ಥಳ ಮತ್ತು ಧರಿಸಿದ್ದ ಬಟ್ಟೆಯ ವಿವರ ಬರೆದಿಡಿ',
          'ಶ್ವಾನದಳಕ್ಕಾಗಿ ವ್ಯಕ್ತಿ ಬಳಸಿದ ಬಟ್ಟೆಯನ್ನು ರಕ್ಷಿಸಿಡಿ',
          'ತಕ್ಷಣ ಪೊಲೀಸರಿಗೆ ಹಾಗೂ ರಕ್ಷಣಾ ತಂಡಕ್ಕೆ ಮಾಹಿತಿ ನೀಡಿ',
          'ಚಿತ್ರವನ್ನು ನೆರೆಹೊರೆಯವರಿಗೆ ಹಂಚಿಕೊಳ್ಳಿ'
        ],
        responderDirective: 'ಸಮಯ ಮಹತ್ವದ್ದಾಗಿದೆ. ಡಾಗ್ ಸ್ಕ್ವಾಡ್‌ನೊಂದಿಗೆ ತಕ್ಷಣ ಹುಡುಕಾಟ ಪ್ರಾರಂಭಿಸಿ.',
        firstAid: [
          'ಸಿಕ್ಕ ತಕ್ಷಣ ನೀರು ಮತ್ತು ಪ್ರಥಮ ಚಿಕಿತ್ಸೆ ನೀಡಿ',
          'ಆಘಾತ ಅಥವಾ ಗಾಯಗಳಿವೆಯೇ ಎಂದು ಪರೀಕ್ಷಿಸಿ'
        ]
      },
      OTHER: {
        headline: 'ತುರ್ತು ಪರಿಸ್ಥಿತಿ - ತುರ್ತು ಕ್ರಮ ಅಗತ್ಯ',
        actionSteps: [
          'ಅಪಾಯದ ಸ್ಥಳದಿಂದ ತಕ್ಷಣ ಸುರಕ್ಷಿತ ದೂರಕ್ಕೆ ತೆರಳಿ',
          'ಸಂಪರ್ಕಕ್ಕಾಗಿ ಮೊಬೈಲ್ ಫೋನ್ ಆನ್ ಆಗಿರಿಸಿ',
          'ಇತರರಿಗೂ ಅಪಾಯದ ಬಗ್ಗೆ ಎಚ್ಚರಿಕೆ ನೀಡಿ',
          'ಅಧಿಕಾರಿಗಳು ಬಂದಾಗ ಅವರ ಸೂಚನೆಗಳನ್ನು ಪಾಲಿಸಿ'
        ],
        responderDirective: 'ಸ್ಥಳವನ್ನು ಪರಿಶೀಲಿಸಿ ಸೂಕ್ತ ಪರಿಹಾರ ತಂಡವನ್ನು ಕಳುಹಿಸಿ.',
        firstAid: [
          'ನಿಮ್ಮ ಸುರಕ್ಷತೆ ಖಚಿತಪಡಿಸಿಕೊಂಡ ನಂತರವೇ ಬೇರೆಯವರಿಗೆ ನೆರವಾಗಿ',
          'ಸಂತ್ರಸ್ತರಿಗೆ ಧೈರ್ಯ ತುಂಬಿ'
        ]
      }
    }
  },
  ml: {
    categoryLabels: {
      MEDICAL: 'അടിയന്തര വൈദ്യസഹായം (Medical)',
      FIRE: 'തീപിടുത്തവും സ്ഫോടനവും (Fire)',
      RESCUE: 'രക്ഷാപ്രവർത്തനം (Rescue)',
      FOOD: 'അടിയന്തര ഭക്ഷണ സഹായം (Food Aid)',
      WATER: 'കുടിവെള്ള ക്ഷാമം (Drinking Water)',
      SHELTER: 'അടിയന്തര അഭയം (Shelter)',
      MISSING_PERSON: 'കാണാതായ ആൾ (Missing Person)',
      OTHER: 'പൊതു അടിയന്തരാവസ്ഥ (Emergency)'
    },
    dispatchHeader: 'അടിയന്തര സന്ദേശം (DISPATCH ALERT)',
    priorityLabel: 'മുൻഗണന (Priority)',
    requiredAssetsLabel: 'ആവശ്യമായ സഹായ സേനകൾ',
    actionRequiredLabel: 'നടപടി: അടുത്തുള്ള രക്ഷാപ്രവർത്തകരെ ഉടൻ അയക്കുക.',
    responderArrivalDirective: 'എത്തിച്ചേർന്നാലുടൻ ജീവൻരക്ഷാ പരിശോധനയും പ്രഥമശുശ്രൂഷയും ആരംഭിക്കുക.',
    immediateActionPrefix: 'ഉടൻ ചെയ്യേണ്ട സുരക്ഷാ കാര്യങ്ങൾ',
    firstAidHeader: 'പ്രഥമശുശ്രൂഷാ നിർദ്ദേശങ്ങൾ',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'ആംബുലൻസ് വാഹനം (ALS Ambulance)',
      'Automated External Defibrillator (AED)': 'ഹൃദയ പുനരുജ്ജീവന ഉപകരണം (AED)',
      'Fire Engine Suppression': 'ഫയർ എഞ്ചിൻ (Fire Engine)',
      'Heavy Hydraulic Rescue': 'ഹൈഡ്രോളിക് റെസ്ക്യൂ സംഘം (Hydraulic Rescue)',
      'Drinking Water Supply Unit': 'ശുദ്ധമായ കുടിവെള്ള വിതരണം (Drinking Water)',
      'Emergency Rations Squad': 'അടിയന്തര റേഷൻ വിതരണ സംഘം (Emergency Rations)',
      'Emergency Shelter Team': 'താൽക്കാലിക അഭയവും പുതപ്പുകളും (Emergency Shelter)',
      'Search & Rescue Tracking Team': 'തിരച്ചിൽ, രക്ഷാപ്രവർത്തന സംഘം (Search & Rescue)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'ഗുരുതരമായ മെഡിക്കൽ എമർജൻസി - ആംബുലൻസ് ഉടൻ അയക്കുക',
        actionSteps: [
          'ഉടൻ തന്നെ 108 അല്ലെങ്കിൽ 112 നമ്പറിലേക്ക് വിളിക്കുക',
          'രോഗിയെ ശാന്തമായി ഇരുത്തുക, ഇറുകിയ വസ്ത്രങ്ങൾ അയക്കുക',
          'ഡോക്ടറുടെ നിർദ്ദേശമില്ലാതെ മരുന്നുകളോ വെള്ളമോ നൽകരുത്',
          'ആംബുലൻസ് എത്തുന്നതുവരെ ശ്വാസോച്ഛ്വാസം ശ്രദ്ധിക്കുക'
        ],
        responderDirective: 'രോഗിയുടെ നില ഗുരുതരമാണ്. ഇസിജിയും ഓക്സിജനും തയ്യാറാക്കുക.',
        firstAid: [
          'ബോധവും ശ്വാസവും പരിശോധിക്കുക',
          'രക്തസ്രാവമുണ്ടെങ്കിൽ വൃത്തിയുള്ള തുണികൊണ്ട് അമർത്തിപ്പിടിക്കുക'
        ]
      },
      FIRE: {
        headline: 'തീപിടുത്തം - കെട്ടിടത്തിൽ നിന്നും ഉടൻ പുറത്തിറങ്ങുക',
        actionSteps: [
          'അടുത്തുള്ള സുരക്ഷിതമായ വഴിയിലൂടെ ഉടൻ പുറത്തു കടക്കുക',
          'വിഷപ്പുക ശ്വസിക്കാതിരിക്കാൻ നിലത്തുകൂടി ഇഴഞ്ഞു നീങ്ങുക',
          'തീ പടരാതിരിക്കാൻ പിന്നിലെ വാതിലുകൾ അടയ്ക്കുക',
          'ഒരു കാരണവശാലും ലിഫ്റ്റ് ഉപയോഗിക്കരുത്'
        ],
        responderDirective: 'കെട്ടിടത്തിൽ തീ ആളിപ്പടരുന്നു. അകത്തു കുടുങ്ങിയവരെ ഉടൻ പുറത്തെത്തിക്കുക.',
        firstAid: [
          'പുക ശ്വസിച്ചവരെ ശുദ്ധവായുവിലേക്ക് മാറ്റുക',
          'പൊള്ളലേറ്റ ഭാഗത്ത് 10 മിനിറ്റ് തണുത്ത വെള്ളമൊഴിക്കുക'
        ]
      },
      RESCUE: {
        headline: 'വാഹനാപകടം - കട്ടിങ് യന്ത്രങ്ങൾ അടിയന്തരമായി എത്തിക്കുക',
        actionSteps: [
          'തീപിടുത്ത സാധ്യത ഒഴിവാക്കാൻ വാഹനത്തിന്റെ എഞ്ചിൻ ഓഫ് ചെയ്യുക',
          'ഗുരുതരമായ തീപിടുത്ത ഭീഷണിയില്ലെങ്കിൽ പരിക്കേറ്റവരെ വലിച്ചിറക്കരുത്',
          'കഴുത്തും നട്ടെല്ലും അനങ്ങാതെ ശ്രദ്ധിക്കുക',
          'പരിക്കേറ്റവർക്ക് ധൈര്യം നൽകുക'
        ],
        responderDirective: 'വാഹനത്തിനുള്ളിൽ ആളുകൾ കുടുങ്ങിയിട്ടുണ്ട്. ഹൈഡ്രോളിക് റെസ്ക്യൂ ഉപകരണങ്ങൾ ഒരുക്കുക.',
        firstAid: [
          'രക്തസ്രാവം തടയാൻ വൃത്തിയുള്ള തുണികൊണ്ട് അമർത്തുക',
          'കഴുത്ത് നേരെ നിർത്തുക'
        ]
      },
      FOOD: {
        headline: 'അടിയന്തര ഭക്ഷണ സഹായം ആവശ്യമുണ്ട് - ദുരന്തമേഖല',
        actionSteps: [
          'കുട്ടികൾക്കും വയോധികർക്കും ഭക്ഷണത്തിൽ മുൻഗണന നൽകുക',
          'ഊർജ്ജം സംരക്ഷിക്കാൻ സുരക്ഷിതമായ സ്ഥലത്ത് വിശ്രമിക്കുക',
          'രക്ഷാപ്രവർത്തകരുടെ ശ്രദ്ധ ആകർഷിക്കാൻ തുണിയോ കൊടിയോ കാണിക്കുക',
          'വെള്ളം കയറി കേടായ ആഹാരം കഴിക്കരുത്'
        ],
        responderDirective: 'ഭക്ഷണത്തിന് കടുത്ത ക്ഷാമമുണ്ട്. അടിയന്തര ഡ്രൈ റേഷൻ കിറ്റുകൾ എത്തിക്കുക.',
        firstAid: [
          'ക്ഷീണിതരായവർക്ക് ഒ.ആർ.എസ് അല്ലെങ്കിൽ ഉപ്പും പഞ്ചസാരയും ചേർത്ത വെള്ളം നൽകുക',
          'പതുക്കെ ലളിതമായ ഭക്ഷണം നൽകിത്തുടങ്ങുക'
        ]
      },
      WATER: {
        headline: 'കുടിവെള്ള ക്ഷാമം - നിർജ്ജലീകരണ ഭീഷണി',
        actionSteps: [
          'പ്രളയജലമോ അഴുക്കുവെള്ളമോ കുടിക്കരുത്',
          'കിട്ടുന്ന വെള്ളം കുറഞ്ഞത് 1 മിനിറ്റെങ്കിലും തിളപ്പിച്ച ശേഷം മാത്രം കുടിക്കുക',
          'വെള്ളം തുല്യമായി പങ്കിട്ട് ശ്രദ്ധയോടെ ഉപയോഗിക്കുക',
          'വിയർപ്പും ദാഹവും കുറയ്ക്കാൻ തണലിൽ വിശ്രമിക്കുക'
        ],
        responderDirective: 'കുടിവെള്ള വിതരണം നിലച്ചു. ക്ലോറിൻ ഗുളികകളും കുപ്പിവെള്ളവും വിതരണം ചെയ്യുക.',
        firstAid: [
          'നിർജ്ജലീകരണമുള്ളവർക്ക് ഒ.ആർ.എസ് ലായനി നൽകുക',
          'തണുപ്പുള്ള തണലിൽ കിടത്തി നെറ്റിയിൽ നനഞ്ഞ തുണിയിടുക'
        ]
      },
      SHELTER: {
        headline: 'അടിയന്തര അഭയം ആവശ്യമുണ്ട് - ദുരന്ത ബാധിതർ',
        actionSteps: [
          'കുടുംബത്തെ സുരക്ഷിതമായ കെട്ടിട ഭാഗത്തേക്ക് മാറ്റുക',
          'തണുപ്പിൽ നിന്നും രക്ഷനേടാൻ ഉണങ്ങിയ വസ്ത്രങ്ങളും പുതപ്പുകളും ഉപയോഗിക്കുക',
          'പൊട്ടിയ മതിലുകളിൽ നിന്നും വൈദ്യുത കമ്പികളിൽ നിന്നും അകന്നു നിൽക്കുക',
          'രാത്രിയിൽ ടോർച്ച് അല്ലെങ്കിൽ വെളിച്ചം കാണിച്ച് ശ്രദ്ധക്ഷണിക്കുക'
        ],
        responderDirective: 'വീട് നഷ്ടപ്പെട്ടവരെ ഉടൻ തന്നെ ദുരിതാശ്വാസ ക്യാമ്പിലേക്ക് മാറ്റുക.',
        firstAid: [
          'തണുത്തുവിറയ്ക്കുന്നവരെ പുതപ്പുകൾ പുതപ്പിച്ചു ചൂടാക്കുക',
          'മുറിവുകൾ വൃത്തിയുള്ള തുണികൊണ്ടു മൂടുക'
        ]
      },
      MISSING_PERSON: {
        headline: 'കാണാതായ ആൾക്കായുള്ള തിരച്ചിൽ - അടിയന്തര നടപടി',
        actionSteps: [
          'അവസാനം കണ്ട സ്ഥലവും വസ്ത്ര വിവരങ്ങളും കുറിച്ചുവെക്കുക',
          'പൊലീസ് നായ്ക്കൾക്കായി ഉപയോഗിച്ച വസ്ത്രങ്ങൾ മാറ്റിവെക്കുക',
          'ഉടൻ പൊലീസിലും രക്ഷാസേനയിലും വിവരമറിയിക്കുക',
          'സമീപവാസികൾക്ക് ഫോട്ടോ അയച്ചുകൊടുക്കുക'
        ],
        responderDirective: 'സമയം നിർണ്ണായകമാണ്. ഡോഗ് സ്ക്വാഡുമായി തിരച്ചിൽ ഊർജ്ജിതമാക്കുക.',
        firstAid: [
          'കണ്ടെത്തിയാലുടൻ വെള്ളവും പ്രഥമശുശ്രൂഷയും നൽകുക',
          'പരിക്കുകളോ മാനസികാഘാതമോ ഉണ്ടോ എന്ന് പരിശോധിക്കുക'
        ]
      },
      OTHER: {
        headline: 'അടിയന്തരാവസ്ഥ - അടിയന്തര നടപടി സ്വീകരിക്കുക',
        actionSteps: [
          'അപകട സ്ഥലത്തുനിന്നും സുരക്ഷിതമായ അകലത്തിലേക്ക് മാറുക',
          'രക്ഷാപ്രവർത്തകരുടെ കോൾ ലഭിക്കാൻ ഫോൺ ഓൺ ചെയ്തു വെക്കുക',
          'മറ്റുള്ളവരെയും അപകടത്തെക്കുറിച്ച് ബോധവാന്മാരാക്കുക',
          'അധികാരികളുടെ നിർദ്ദേശങ്ങൾ കർശനമായി പാലിക്കുക'
        ],
        responderDirective: 'സ്ഥലത്തെ സ്ഥിതിഗതികൾ വിലയിരുത്തി ആവശ്യമായ വിദഗ്ധ സംഘത്തെ അയക്കുക.',
        firstAid: [
          'സ്വന്തം സുരക്ഷ ഉറപ്പാക്കിയ ശേഷം മാത്രം മറ്റുള്ളവരെ സഹായിക്കുക',
          'രോഗിക്ക് സാന്ത്വനം നൽകുക'
        ]
      }
    }
  },
  bn: {
    categoryLabels: {
      MEDICAL: 'চিকিৎসা জরুরি অবস্থা (Medical)',
      FIRE: 'আগুন ও বিস্ফোরণ (Fire)',
      RESCUE: 'উদ্ধার অভিযান (Rescue)',
      FOOD: 'জরুরি খাদ্য সহায়তা (Food Aid)',
      WATER: 'পানীয় জলের সংকট (Water)',
      SHELTER: 'জরুরি আশ্রয় (Shelter)',
      MISSING_PERSON: 'নিখোঁজ ব্যক্তি (Missing Person)',
      OTHER: 'সাধারণ জরুরি অবস্থা (Emergency)'
    },
    dispatchHeader: 'জরুরি প্রেরণ সতর্কতা (DISPATCH ALERT)',
    priorityLabel: 'অগ্রাধিকার (Priority)',
    requiredAssetsLabel: 'প্রয়োজনীয় সাহায্য ও ইউনিট',
    actionRequiredLabel: 'পদক্ষেপ: নিকটতম উদ্ধারকারী দলকে অবিলম্বে পাঠান।',
    responderArrivalDirective: 'পৌঁছানোর সাথে সাথে তাৎক্ষণিক জীবন রক্ষাকারী পরীক্ষা ও প্রাথমিক চিকিৎসা শুরু করুন।',
    immediateActionPrefix: 'তাৎক্ষণিক সুরক্ষার পদক্ষেপ',
    firstAidHeader: 'প্রাথমিক চিকিৎসার নির্দেশাবলী',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'প্যারামেডিক অ্যাম্বুলেন্স (ALS Ambulance)',
      'Automated External Defibrillator (AED)': 'ডিফিব্রিলেটর (AED Defibrillator)',
      'Fire Engine Suppression': 'দমকল গাড়ি (Fire Engine)',
      'Heavy Hydraulic Rescue': 'হাইড্রোলিক উদ্ধারকারী দল (Hydraulic Rescue)',
      'Drinking Water Supply Unit': 'বিশুদ্ধ পানীয় জল সরবরাহ (Drinking Water)',
      'Emergency Rations Squad': 'জরুরি ত্রাণ ও খাদ্য দল (Emergency Rations)',
      'Emergency Shelter Team': 'অস্থায়ী আশ্রয় ও কম্বল (Emergency Shelter)',
      'Search & Rescue Tracking Team': 'অনুসন্ধান ও উদ্ধারকারী দল (Search & Rescue)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'গুরুতর চিকিৎসা জরুরি অবস্থা - অবিলম্বে অ্যাম্বুলেন্স পাঠান',
        actionSteps: [
          'অবিলম্বে ১০৮ বা ১১২ নম্বরে ফোন করুন',
          'রোগীকে শান্তভাবে বসিয়ে রাখুন, আঁটসাঁট পোশাক ঢিলে করুন',
          'চিকিৎসকের পরামর্শ ছাড়া কোনো ওষুধ বা খাবার দেবেন না',
          'অ্যাম্বুলেন্স না আসা পর্যন্ত শ্বাসপ্রশ্বাস লক্ষ্য রাখুন'
        ],
        responderDirective: 'রোগীর অবস্থা আশঙ্কাজনক। অবিলম্বে ইসিজি এবং অক্সিজেন প্রস্তুত রাখুন।',
        firstAid: [
          'রোগীর জ্ঞান এবং শ্বাসপ্রশ্বাস পরীক্ষা করুন',
          'রক্তপাত হলে পরিষ্কার কাপড় দিয়ে চেপে ধরুন'
        ]
      },
      FIRE: {
        headline: 'আগুন ও বিষাক্ত ধোঁয়া - অবিলম্বে বাইরে বেরিয়ে আসুন',
        actionSteps: [
          'নিকটতম নিরাপদ পথ দিয়ে দ্রুত বাইরে বেরিয়ে আসুন',
          'ধোঁয়া এড়াতে মেঝেতে হামাগুড়ি দিয়ে চলুন',
          'আগুন ছড়ানো আটকাতে পেছনের দরজা বন্ধ করে আসুন',
          'কোনো অবস্থাতেই লিফট ব্যবহার করবেন না'
        ],
        responderDirective: 'ভবনে আগুন ছড়িয়ে পড়ছে। আটকে পড়া ব্যক্তিদের দ্রুত উদ্ধার করুন।',
        firstAid: [
          'ধোঁয়া আক্রান্ত ব্যক্তিকে দ্রুত খোলা বাতাসে আনুন',
          'পোড়া স্থানে ১০ মিনিট পরিষ্কার ঠান্ডা জল ঢালুন'
        ]
      },
      RESCUE: {
        headline: 'যানবাহন দুর্ঘটনা ও উদ্ধার - হাইড্রোলিক কাটার প্রয়োজন',
        actionSteps: [
          'আগুন লাগার ঝুঁকি এড়াতে গাড়ির ইঞ্জিন বন্ধ করুন',
          'আগুনের প্রত্যক্ষ ভয় না থাকলে আহতদের জোর করে টানবেন না',
          'ঘাড় ও মেরুদণ্ড সোজা রাখুন',
          'আহত ব্যক্তিকে আশ্বস্ত করুন'
        ],
        responderDirective: 'গাড়িতে মানুষ আটকে থাকার আশঙ্কা। হাইড্রোলিক কাটার প্রস্তুত রাখুন।',
        firstAid: [
          'রক্তপাত বন্ধ করতে কাপড় দিয়ে চেপে ধরুন',
          'ঘাড় সোজা রাখুন'
        ]
      },
      FOOD: {
        headline: 'জরুরি খাদ্য ও পুষ্টির প্রয়োজন - দুর্যোগ কবলিত এলাকা',
        actionSteps: [
          'শিশু, বৃদ্ধ এবং মায়েদের খাদ্যে অগ্রাধিকার দিন',
          'শক্তি সংরক্ষণের জন্য নিরাপদ স্থানে বিশ্রাম নিন',
          'উদ্ধারকারী দলের দৃষ্টি আকর্ষণে লাল কাপড় বা সংকেত দেখান',
          'নষ্ট বা বন্যার জল লাগা খাবার খাবেন না'
        ],
        responderDirective: 'খাদ্যের তীব্র অভাব। অবিলম্বে শুকনো খাবার ও ত্রাণ সামগ্রী বিতরণ করুন।',
        firstAid: [
          'দুর্বলদের ওআরএস বা নুন-চিনির জল অল্প অল্প করে খাওয়ান',
          'ধীরে ধীরে সহজপাচ্য খাবার দিন'
        ]
      },
      WATER: {
        headline: 'পানীয় জলের সংকট - পানিশূন্যতার ঝুঁকি',
        actionSteps: [
          'বন্যার জল সরাসরি পান করবেন না',
          'জল ফুটিয়ে কমপক্ষে ১ মিনিট রেখে তবেই পান করুন',
          'জল পরিমিতভাবে সবার মধ্যে ভাগ করে ব্যবহার করুন',
          'ঘাম ও তৃষ্ণা কমাতে ছায়ায় থাকুন'
        ],
        responderDirective: 'বিশুদ্ধ জলের সংকট তীব্র। অবিলম্বে ক্লোরিন ট্যাবলেট ও পানীয় জল সরবরাহ করুন।',
        firstAid: [
          'ডিহাইড্রেশনের রোগীকে ওআরএস খাওয়ান',
          'ঠান্ডা স্থানে শুইয়ে কপালে ভেজা কাপড় দিন'
        ]
      },
      SHELTER: {
        headline: 'জরুরি আশ্রয়ের প্রয়োজন - প্রাকৃতিক দুর্যোগ',
        actionSteps: [
          'পরিবারকে কোনো অক্ষত নিরাপদ স্থানে একত্রিত করুন',
          'ঠান্ডা থেকে বাঁচতে শুকনো পোশাক ও কম্বল ব্যবহার করুন',
          'ভাঙা দেওয়াল ও বিদ্যুতের তার থেকে দূরে থাকুন',
          'রাতে টর্চলাইট জ্বালিয়ে সংকেত দিন'
        ],
        responderDirective: 'গৃহহীনদের অবিলম্বে ত্রাণ শিবিরে স্থানান্তরিত করুন।',
        firstAid: [
          'শীতার্থদের কম্বল জড়িয়ে গরম রাখুন',
          'ক্ষতস্থানে পরিষ্কার ব্যান্ডেজ বাঁধুন'
        ]
      },
      MISSING_PERSON: {
        headline: 'নিখোঁজ ব্যক্তির সন্ধান - দ্রুত তল্লাশি শুরু করুন',
        actionSteps: [
          'শেষ দেখার স্থান এবং পরনের পোশাকের বিবরণ লিখে রাখুন',
          'সন্ধানী কুকুরের জন্য ব্যবহৃত জামাকাপড় সংরক্ষণ করুন',
          'অবিলম্বে পুলিশ ও উদ্ধারকারীদের জানান',
          'চারপাশে ছবি ও তথ্য শেয়ার করুন'
        ],
        responderDirective: 'সময় অত্যন্ত গুরুত্বপূর্ণ। ডগ স্কোয়াড নিয়ে তল্লাশি জোরদার করুন।',
        firstAid: [
          'খুঁজে পাওয়ার সাথে সাথে জল ও প্রাথমিক চিকিৎসা দিন',
          'আঘাত বা মানসিক ধাক্কা পরীক্ষা করুন'
        ]
      },
      OTHER: {
        headline: 'জরুরি অবস্থা - দ্রুত ব্যবস্থা গ্রহণ প্রয়োজন',
        actionSteps: [
          'বিপদজনক এলাকা থেকে নিরাপদ দূরত্বে সরে যান',
          'ফোনে যোগাযোগের লাইন খোলা রাখুন',
          'অন্যদেরও বিপদ সম্পর্কে সতর্ক করুন',
          'উদ্ধারকারীদের নির্দেশ মেনে চলুন'
        ],
        responderDirective: 'পরিস্থিতি মূল্যায়ন করে বিশেষজ্ঞ দল মোতায়েন করুন।',
        firstAid: [
          'নিজের নিরাপত্তা নিশ্চিত করে তবেই সাহায্য করুন',
          'রোগীকে শান্ত রাখুন'
        ]
      }
    }
  },
  mr: {
    categoryLabels: {
      MEDICAL: 'वैद्यकीय आणीबाणी (Medical)',
      FIRE: 'आग व स्फोट दुर्घटना (Fire)',
      RESCUE: 'शोध व बचाव कार्य (Rescue)',
      FOOD: 'तातडीची अन्न मदत (Food Aid)',
      WATER: 'पिण्याच्या पाण्याचे संकट (Water)',
      SHELTER: 'तातडीचा निवारा (Shelter)',
      MISSING_PERSON: 'बेपत्ता व्यक्ती (Missing Person)',
      OTHER: 'सामान्य आणीबाणी (Emergency)'
    },
    dispatchHeader: 'तातडीचा संदेश (DISPATCH ALERT)',
    priorityLabel: 'प्राधान्य (Priority)',
    requiredAssetsLabel: 'आवश्यक मदत व पथके',
    actionRequiredLabel: 'कारवाई: जवळचे मदत पथक तातडीने रवाना करा.',
    responderArrivalDirective: 'घटनास्थळी पोहोचताच तातडीने जीवरक्षक तपासणी व प्रथमोपचार सुरू करा.',
    immediateActionPrefix: 'तातडीचे सुरक्षा उपाय',
    firstAidHeader: 'प्रथमोपचार मार्गदर्शक तत्त्वे',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'रुग्णवाहिका (ALS Ambulance)',
      'Automated External Defibrillator (AED)': 'हृदयविकार डिफिब्रिलेटर (AED)',
      'Fire Engine Suppression': 'अग्निशामक बंब (Fire Engine)',
      'Heavy Hydraulic Rescue': 'हायड्रॉलिक बचाव पथक (Hydraulic Rescue)',
      'Drinking Water Supply Unit': 'पिण्याच्या पाण्याचा पुरवठा (Drinking Water)',
      'Emergency Rations Squad': 'तातडीचे अन्नधान्य पथक (Emergency Rations)',
      'Emergency Shelter Team': 'हंगामी निवारा व चादरी (Emergency Shelter)',
      'Search & Rescue Tracking Team': 'शोध व बचाव पथक (Search & Rescue)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'गंभीर वैद्यकीय आणीबाणी - तातडीने रुग्णवाहिका पाठवा',
        actionSteps: [
          'तातडीने १०८ किंवा ११२ वर संपर्क साधा',
          'रुग्णाला शांतपणे बसवून ठेवा, घट्ट कपडे सैल करा',
          'डॉक्टरांच्या सल्ल्याशिवाय कोणतीही गोळी किंवा पाणी देऊ नका',
          'रुग्णवाहिका येईपर्यंत श्वासोच्छ्वासावर लक्ष ठेवा'
        ],
        responderDirective: 'रुग्णाची प्रकृती गंभीर आहे. ईसीजी आणि ऑक्सिजन तयार ठेवा.',
        firstAid: [
          'रुग्ण शुद्धीत आहे का ते तपासा',
          'रक्तस्त्राव होत असल्यास स्वच्छ कापडाने दाबून धरा'
        ]
      },
      FIRE: {
        headline: 'आग आणि धुराचा धोका - तातडीने बाहेर पडा',
        actionSteps: [
          'जवळच्या सुरक्षित मार्गाने ताबडतोब बाहेर पडा',
          'विषारी धुरापासून वाचण्यासाठी जमिनीवर वाकून चाला',
          'आग पसरू नये म्हणून मागील दारे बंद करा',
          'कोणत्याही परिस्थितीत लिफ्टचा वापर करू नका'
        ],
        responderDirective: 'इमारतीत आग पसरत आहे. अडकलेल्या नागरिकांना त्वरित बाहेर काढा.',
        firstAid: [
          'धूर लागलेल्या व्यक्तीला ताजी हवेत आणा',
          'भाजलेल्या भागावर १० मिनिटे थंड पाणी टाका'
        ]
      },
      RESCUE: {
        headline: 'अपघात बचाव कार्य - हायड्रॉलिक कटरची आवश्यकता',
        actionSteps: [
          'आगीचा धोका टाळण्यासाठी वाहनाचे इंजिन बंद करा',
          'आगीचा तीव्र धोका नसल्यास जखमीला ओढू नका',
          'मान आणि पाठीचा कणा हलणार नाही याची काळजी घ्या',
          'जखमी व्यक्तीला धीर द्या'
        ],
        responderDirective: 'वाहनात नागरिक अडकल्याची शक्यता आहे. हायड्रॉलिक कटर सज्ज ठेवा.',
        firstAid: [
          'रक्तस्त्राव थांबवण्यासाठी स्वच्छ कापडाने दाबा',
          'मान सरळ ठेवा'
        ]
      },
      FOOD: {
        headline: 'तातडीची अन्न मदत आवश्यक - आपत्तीग्रस्त भाग',
        actionSteps: [
          'लहान मुले, वृद्ध आणि मातांना अन्नात प्राधान्य द्या',
          'ऊर्जा वाचवण्यासाठी सुरक्षित ठिकाणी विश्रांती घ्या',
          'मदत पथकाला दिसण्यासाठी निशाणी किंवा कपडा दाखवा',
          'खराब झालेले किंवा पुराचे पाणी लागलेले अन्न खाऊ नका'
        ],
        responderDirective: 'अन्नाचा तीव्र तुटवडा आहे. तातडीने सुके खाद्यपदार्थ आणि पोषण किट वाटा.',
        firstAid: [
          'अशक्त व्यक्तीला ओआरएस किंवा मीठ-साखरेचे पाणी थोडे थोडे द्या',
          'हळूहळू हलके अन्न द्या'
        ]
      },
      WATER: {
        headline: 'पिण्याच्या पाण्याचे संकट - डिहायड्रेशनचा धोका',
        actionSteps: [
          'पुराचे किंवा अस्वच्छ पाणी थेट पिऊ नका',
          'मिळालेले पाणी किमान १ मिनिट उकळूनच प्या',
          'पाण्याचा वापर काटकसरीने सर्वांना समान वाटून करा',
          'घाम आणि तहान टाळण्यासाठी सावलीत थांबा'
        ],
        responderDirective: 'पिण्याच्या पाण्याचा पुरवठा खंडित झाला आहे. क्लोरीन गोळ्या व बाटलीबंद पाणी पुरवा.',
        firstAid: [
          'डिहायड्रेशन झालेल्या व्यक्तीला ओआरएस द्या',
          'थंड जागेत झोपवून कपाळावर ओली पट्टी ठेवा'
        ]
      },
      SHELTER: {
        headline: 'तातडीच्या निवार्याची गरज - नैसर्गिक आपत्ती',
        actionSteps: [
          'कुटुंबाला सुरक्षित इमारतीच्या भागात एकत्र करा',
          'थंडीपासून संरक्षणासाठी सुके कपडे व ब्लँकेट वापरा',
          'तडे गेलेल्या भिंती व विजेच्या तारांपासून लांब राहा',
          'रात्री टॉर्चने किंवा प्रकाशाने इशारा करा'
        ],
        responderDirective: 'बेघर झालेल्या नागरिकांना तातडीने मदत शिबिरात हलवा.',
        firstAid: [
          'थंडीने गारठलेल्या व्यक्तीला उबदार कपडे पांघरा',
          'जखमांवर स्वच्छ मलमपट्टी करा'
        ]
      },
      MISSING_PERSON: {
        headline: 'बेपत्ता व्यक्तीचा शोध - तातडीने मोहीम सुरू करा',
        actionSteps: [
          'शेवटचे पाहिलेले ठिकाण आणि कपड्यांचे वर्णन नोंदवून ठेवा',
          'श्वान पथकासाठी व्यक्तीने वापरलेले कपडे सुरक्षित ठेवा',
          'त्वरित पोलिसांशी व मदत पथकांशी संपर्क साधा',
          'परिसरात फोटो व माहिती पाठवा'
        ],
        responderDirective: 'वेळ अत्यंत महत्त्वाची आहे. श्वान पथकासह शोधमोहीम तीव्र करा.',
        firstAid: [
          'व्यक्ती सापडल्यास पाणी व प्रथमोपचार द्या',
          'दुखापत किंवा धक्का बसला आहे का ते तपासा'
        ]
      },
      OTHER: {
        headline: 'आणीबाणी परिस्थिती - तातडीने कारवाई आवश्यक',
        actionSteps: [
          'धोकादायक ठिकाणापासून सुरक्षित अंतरावर जा',
          'मदत पथकाच्या संपर्कासाठी फोन सुरू ठेवा',
          'इतरांनाही धोक्याची सूचना द्या',
          'अधिकार्यांच्या सूचनांचे पालन करा'
        ],
        responderDirective: 'परिस्थितीची पाहणी करून योग्य तज्ज्ञ पथक पाठवा.',
        firstAid: [
          'स्वतःची सुरक्षा खात्री करूनच इतरांना मदत करा',
          'रुग्णाला धीर द्या'
        ]
      }
    }
  },
  es: {
    categoryLabels: {
      MEDICAL: 'Emergencia Médica (Medical)',
      FIRE: 'Incendio y Explosión (Fire)',
      RESCUE: 'Búsqueda y Rescate / Rescate Vehicular (Rescue)',
      FOOD: 'Ayuda Alimentaria de Emergencia (Food Aid)',
      WATER: 'Crisis de Agua Potable (Water)',
      SHELTER: 'Refugio de Emergencia (Shelter)',
      MISSING_PERSON: 'Persona Desaparecida (Missing Person)',
      OTHER: 'Condición Peligrosa / Emergencia (Emergency)'
    },
    dispatchHeader: 'ALERTA DE DESPACHO (DISPATCH ALERT)',
    priorityLabel: 'Prioridad (Priority)',
    requiredAssetsLabel: 'Asistencia y Unidades Requeridas',
    actionRequiredLabel: 'Acción: Despachar unidades más cercanas de inmediato.',
    responderArrivalDirective: 'Evaluación inmediata de la seguridad de la escena y triaje crítico a la llegada.',
    immediateActionPrefix: 'Pasos de Acción Inmediata',
    firstAidHeader: 'Instrucciones de Primeros Auxilios',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'Ambulancia de Soporte Vital Avanzado (ALS)',
      'Automated External Defibrillator (AED)': 'Desfibrilador Externo Automático (DEA)',
      'Fire Engine Suppression': 'Unidad de Extinción de Incendios',
      'Heavy Hydraulic Rescue': 'Equipo de Rescate Hidráulico Pesado',
      'Drinking Water Supply Unit': 'Unidad de Suministro de Agua Potable',
      'Emergency Rations Squad': 'Raciones de Emergencia y Nutrición Infantil',
      'Emergency Shelter Team': 'Refugio Temporal y Mantas Térmicas',
      'Search & Rescue Tracking Team': 'Equipo Canino de Búsqueda y Rastreo (K9)'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'EMERGENCIA MÉDICA CRÍTICA - DESPACHO INMEDIATO DE AMBULANCIA',
        actionSteps: [
          'Llame a los servicios de emergencia de inmediato (911 / 112)',
          'Mantenga al paciente en posición de reposo semi-incorporado',
          'No administre medicamentos orales sin orden médica',
          'Monitoree la respiración continuamente hasta la llegada del equipo médico'
        ],
        responderDirective: 'Paciente con síntomas agudos. Preparar telemetría y soporte vital avanzado.',
        firstAid: [
          'Verifique estado de conciencia y apertura de vía aérea',
          'Aplique presión directa continua sobre heridas con sangrado activo'
        ]
      },
      FIRE: {
        headline: 'INCENDIO ESTRUCTURAL Y HUMO TÓXICO - EVACUE INMEDIATAMENTE',
        actionSteps: [
          'Evacúe de inmediato por la salida segura más próxima',
          'Permanezca agachado por debajo de la capa de humo tóxico',
          'Cierre puertas tras de sí para retrasar el fuego',
          'No utilice elevadores bajo ninguna circunstancia'
        ],
        responderDirective: 'Fuego activo con posible atrapamiento de ocupantes. Búsqueda y supresión inmediata.',
        firstAid: [
          'Traslade a personas afectadas al aire fresco exterior',
          'Enfríe quemaduras con agua corriente limpia y fresca durante 10 minutos'
        ]
      },
      RESCUE: {
        headline: 'COLISIÓN VEHICULAR - EXTRICACIÓN HIDRÁULICA REQUERIDA',
        actionSteps: [
          'Apague motores de vehículos para prevenir chispas e incendios',
          'No mueva a ocupantes heridos a menos que exista amenaza inmediata de fuego',
          'Estabilice el cuello y la columna sin giros bruscos',
          'Tranquilice a la víctima con comunicación serena'
        ],
        responderDirective: 'Atrapamiento mecánico vehicular. Preparar herramientas hidráulicas y tabla espinal.',
        firstAid: [
          'Controle hemorragias externas con presión directa',
          'Mantenga inmovilización cervical manual en línea recta'
        ]
      },
      FOOD: {
        headline: 'ASISTENCIA ALIMENTARIA DE EMERGENCIA - ZONA DE DESASTRE',
        actionSteps: [
          'Priorice a niños pequeños, ancianos y madres lactantes para las raciones',
          'Conserve energía física y permanezca en un lugar seguro',
          'Haga señales visibles a los rescatistas con banderas o ropa brillante',
          'No consuma alimentos contaminados por agua de inundación'
        ],
        responderDirective: 'Desabastecimiento alimentario agudo. Distribuir raciones energéticas de inmediato.',
        firstAid: [
          'Administre soluciones de rehidratación en pequeños sorbos frecuentes',
          'Introduzca alimentos sencillos de manera gradual'
        ]
      },
      WATER: {
        headline: 'CRISIS DE AGUA POTABLE - RIESGO SEVERO DE DESHIDRATACIÓN',
        actionSteps: [
          'No beba agua de inundación o sin tratar bajo ninguna circunstancia',
          'Hierva el agua disponible vigorosamente durante 1 minuto antes de beber',
          'Raccione el agua limpia equitativamente entre los presentes',
          'Permanezca en la sombra para reducir la sudoración y la deshidratación'
        ],
        responderDirective: 'Falla crítica de agua potable. Distribuir agua potable embotellada y pastillas purificadoras.',
        firstAid: [
          'Administre sales de rehidratación oral (SRO) en sorbos lentos',
          'Coloque al afectado a la sombra con paños húmedos en la frente'
        ]
      },
      SHELTER: {
        headline: 'REFUGIO DE EMERGENCIA REQUERIDO - EXPOSICIÓN SEVERA',
        actionSteps: [
          'Reúna a los familiares en la estructura más sólida y segura restante',
          'Protéjase del frío con mantas secas y capas de ropa',
          'Manténgase alejado de paredes agrietadas y cables caídos',
          'Use linternas o señales lumínicas para alertar a los equipos nocturnos'
        ],
        responderDirective: 'Población desplazada a la intemperie. Trasladar al centro de evacuación designado.',
        firstAid: [
          'Cubra a personas con escalofríos con mantas secas para evitar hipotermia',
          'Cubra heridas con apósitos limpios'
        ]
      },
      MISSING_PERSON: {
        headline: 'BÚSQUEDA DE PERSONA EXTRAVIADA - OPERATIVO URGENTE',
        actionSteps: [
          'Registre el último punto de avistamiento y la vestimenta exacta',
          'Conserve prendas con olor para los perros de rastreo',
          'Notifique a las autoridades policiales de inmediato',
          'Difunda la fotografía entre grupos de rescate'
        ],
        responderDirective: 'Tiempo crítico. Establecer perímetro de búsqueda y rastreo con unidad K9.',
        firstAid: [
          'Tenga agua y mantas listas al momento del hallazgo',
          'Evalúe signos de hipotermia o confusión mental'
        ]
      },
      OTHER: {
        headline: 'ALERTA DE EMERGENCIA CRÍTICA - RESPUESTA PRIORITARIA',
        actionSteps: [
          'Aléjese del área de peligro hacia una posición segura',
          'Mantenga el teléfono disponible para la llamada de despacho',
          'Advierta a otros transeúntes sobre el peligro',
          'Siga las órdenes del personal de emergencia al llegar'
        ],
        responderDirective: 'Evaluar riesgos en la escena y desplegar equipo especializado necesario.',
        firstAid: [
          'Asegure su propia integridad antes de asistir a terceros',
          'Tranquilice a la víctima en posición de seguridad'
        ]
      }
    }
  },
  fr: {
    categoryLabels: {
      MEDICAL: 'Urgence Médicale (Medical)',
      FIRE: 'Incendie & Explosion (Fire)',
      RESCUE: 'Recherche et Sauvetage / Désincarcération (Rescue)',
      FOOD: 'Aide Alimentaire d\'Urgence (Food Aid)',
      WATER: 'Crise d\'Eau Potable (Water)',
      SHELTER: 'Hébergement d\'Urgence (Shelter)',
      MISSING_PERSON: 'Personne Disparue (Missing Person)',
      OTHER: 'Situation Dangereuse / Urgence (Emergency)'
    },
    dispatchHeader: 'ALERTE DE DISPATCH (DISPATCH ALERT)',
    priorityLabel: 'Priorité (Priority)',
    requiredAssetsLabel: 'Assistance et Unités Requises',
    actionRequiredLabel: 'Action: Déployer les unités les plus proches immédiatement.',
    responderArrivalDirective: 'Évaluation immédiate de la sécurité et triage prioritaire dès l\'arrivée.',
    immediateActionPrefix: 'Mesures d\'Action Immédiate',
    firstAidHeader: 'Protocoles de Premiers Secours',
    needsTranslations: {
      'ALS Paramedic Ambulance': 'Ambulance de Réanimation (SMUR / ALS)',
      'Automated External Defibrillator (AED)': 'Défibrillateur Automatisé Externe (DAE)',
      'Fire Engine Suppression': 'Fourgon d\'Incendie et de Secours',
      'Heavy Hydraulic Rescue': 'Unité de Désincarcération Hydraulique',
      'Drinking Water Supply Unit': 'Unité de Distribution d\'Eau Potable',
      'Emergency Rations Squad': 'Rations d\'Urgence et Nutrition Pédiatrique',
      'Emergency Shelter Team': 'Abris d\'Urgence et Couvertures de Survie',
      'Search & Rescue Tracking Team': 'Équipe Cynophile de Recherche et Sauvetage'
    },
    sampleDirectives: {
      MEDICAL: {
        headline: 'URGENCE MÉDICALE CRITIQUE - ENVOI IMMÉDIAT DU SMUR',
        actionSteps: [
          'Appelez immédiatement les secours d\'urgence (15 / 112)',
          'Maintenez le patient au repos en position demi-assise',
          'N\'administrez aucun médicament par voie orale sans avis médical',
          'Surveillez continuellement la respiration jusqu\'à l\'arrivée des secours'
        ],
        responderDirective: 'Patient présentant une détresse aiguë. Préparer monitoring et réanimation.',
        firstAid: [
          'Vérifiez l\'état de conscience et la liberté des voies respiratoires',
          'Comprimez fermement et sans relâcher toute hémorragie active'
        ]
      },
      FIRE: {
        headline: 'INCENDIE ET FUMÉES TOXIQUES - ÉVACUEZ IMMÉDIATEMENT',
        actionSteps: [
          'Évacuez sans délai par l\'issue de secours la plus proche',
          'Restez baissé sous les fumées toxiques',
          'Fermez les portes derrière vous pour ralentir la progression du feu',
          'N\'utilisez jamais les ascenseurs'
        ],
        responderDirective: 'Incendie structurel actif avec risque de piégeage. Reconnaissance et extinction immédiates.',
        firstAid: [
          'Menez les personnes incommodées à l\'air libre',
          'Refroidissez les brûlures sous l\'eau courante tiède à fraîche pendant 10 minutes'
        ]
      },
      RESCUE: {
        headline: 'ACCIDENT DE LA ROUTE - DÉSINCARCÉRATION REQUISE',
        actionSteps: [
          'Coupez le contact des véhicules pour éviter tout départ de feu',
          'Ne déplacez pas les blessés sauf en cas de danger d\'incendie imminent',
          'Maintenez l\'axe tête-cou-tronc sans torsion',
          'Rassurez la victime par des paroles calmes'
        ],
        responderDirective: 'Désincarcération requise. Préparer outillage hydraulique et plan dur.',
        firstAid: [
          'Comprimez les plaies hémorragiques à l\'aide d\'un linge propre',
          'Maintenez la tête dans l\'axe'
        ]
      },
      FOOD: {
        headline: 'AIDE ALIMENTAIRE D\'URGENCE - DÉTRESSE NUTRITIONNELLE',
        actionSteps: [
          'Donnez la priorité aux nourrissons, aux personnes âgées et aux mères',
          'Conservez l\'énergie physique dans un endroit abrité',
          'Signalez votre présence aux sauveteurs à l\'aide d\'étoffes vives',
          'Ne consommez aucun aliment souillé par les eaux de crue'
        ],
        responderDirective: 'Pénurie alimentaire critique. Distribuer des rations d\'urgence enrichies.',
        firstAid: [
          'Donnez des solutés de réhydratation par petites gorgées régulières',
          'Réintroduisez une alimentation douce progressivement'
        ]
      },
      WATER: {
        headline: 'CRISE D\'EAU POTABLE - RISQUE SÉVÈRE DE DÉSHYDRATATION',
        actionSteps: [
          'Ne buvez en aucun cas l\'eau d\'inondation non traitée',
          'Faites bouillir l\'eau disponible à gros bouillons pendant 1 minute',
          'Rationnez l\'eau potable équitablement entre toutes les personnes',
          'Restez à l\'ombre pour limiter les pertes en eau corporelle'
        ],
        responderDirective: 'Rupture d\'eau potable. Distribuer des bonbonnes d\'eau et des pastilles de purification.',
        firstAid: [
          'Administrez des sels de réhydratation orale par petites gorgées',
          'Allongez la personne à l\'ombre avec un linge humide sur le front'
        ]
      },
      SHELTER: {
        headline: 'HÉBERGEMENT D\'URGENCE REQUIS - EXPOSITION AUX INTEMPÉRIES',
        actionSteps: [
          'Regroupez la famille dans la structure restante la plus solide',
          'Isolez-vous du froid avec des vêtements secs et des couvertures',
          'Éloignez-vous des murs fissurés et des câbles électriques tombés',
          'Activez une lampe torche pour guider les équipes de nuit'
        ],
        responderDirective: 'Sinistrés sans abri exposés aux éléments. Évacuation vers le centre d\'accueil d\'urgence.',
        firstAid: [
          'Réchauffez les personnes frissonnantes avec des couvertures de survie',
          'Protégez les plaies avec des pansements propres'
        ]
      },
      MISSING_PERSON: {
        headline: 'RECHERCHE DE PERSONNE DISPARUE - ENGAGEMENT RAPIDE',
        actionSteps: [
          'Notez le dernier point de repère connu et la tenue vestimentaire exacte',
          'Conservez des vêtements avec l\'odeur pour les équipes cynophiles',
          'Alertez sans attendre les services de police et de secours',
          'Diffusez la photo aux groupes de secours locaux'
        ],
        responderDirective: 'Recherche urgente. Établir un périmètre de recherche avec équipe cynophile K9.',
        firstAid: [
          'Préparez de l\'eau et des couvertures dès la localisation',
          'Vérifiez la présence d\'hypothermie ou de traumatisme'
        ]
      },
      OTHER: {
        headline: 'ALERTE D\'URGENCE CRITIQUE - INTERVENTION PRIORITAIRE',
        actionSteps: [
          'Éloignez-vous de la zone dangereuse vers un lieu sécurisé',
          'Gardez la ligne téléphonique disponible pour le rappel des secours',
          'Prévenez les témoins à proximité du danger',
          'Appliquez strictement les consignes des premiers intervenants'
        ],
        responderDirective: 'Reconnaissance des risques et engagement des équipes spécialisées adaptées.',
        firstAid: [
          'Assurez d\'abord votre propre sécurité avant d\'intervenir',
          'Rassurez la victime en position latérale de sécurité si inconsciente'
        ]
      }
    }
  }
};

/**
 * Deterministically translates an emergency SOS result into any of the 10 supported languages,
 * strictly maintaining severity, category, and emergency meaning.
 */
export function translateEmergencyOffline(
  originalMessage: string,
  targetLanguageCodeOrName: string,
  currentCategory: StandardEmergencyCategory,
  currentSeverity: SeverityLevel,
  currentEmergencyType: string,
  sourceLanguageHint?: string,
  locationHint?: string
) {
  const targetLang = getLanguageByCodeOrName(targetLanguageCodeOrName);
  const detectedSource = sourceLanguageHint
    ? getLanguageByCodeOrName(sourceLanguageHint)
    : detectLanguage(originalMessage);

  const langKey = EMERGENCY_TRANSLATION_DICTIONARY[targetLang.code] ? targetLang.code : 'en';
  const dict = EMERGENCY_TRANSLATION_DICTIONARY[langKey] || EMERGENCY_TRANSLATION_DICTIONARY.en;

  const directive = dict.sampleDirectives[currentCategory] || dict.sampleDirectives.OTHER;
  const categoryLabel = dict.categoryLabels[currentCategory] || currentCategory;

  const locPart = locationHint ? ` [${locationHint}]` : '';

  // Standardized, high-urgency translated radio transmission message
  const translatedMessage = `${dict.dispatchHeader}: ${dict.priorityLabel} ${currentSeverity}/5 - ${categoryLabel}.${locPart} ${dict.requiredAssetsLabel}: ${directive.responderDirective} ${dict.actionRequiredLabel}`;

  const translatedNeeds = Object.entries(dict.needsTranslations).slice(0, 3).map(([_, trans]) => trans);

  return {
    detected_source_language: {
      code: detectedSource.code,
      name: detectedSource.name
    },
    target_language: targetLang.code,
    target_language_name: targetLang.name,
    original_message: originalMessage,
    translated_message: translatedMessage,
    translated_headline: directive.headline,
    translated_action_steps: directive.actionSteps,
    translated_instructions_for_responders: directive.responderDirective,
    translated_first_aid_actions: directive.firstAid,
    translated_needs: translatedNeeds.length > 0 ? translatedNeeds : [dict.requiredAssetsLabel],
    category: currentCategory,
    severity: currentSeverity,
    emergency_type: currentEmergencyType,
    timestamp: new Date().toISOString()
  };
}
