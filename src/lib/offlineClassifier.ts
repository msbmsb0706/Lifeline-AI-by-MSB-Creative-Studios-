import {
  NemotronEmergencyResponse,
  SeverityLevel,
  StandardEmergencyCategory,
  VisualSOSCard
} from '../types.ts';
import {
  detectLanguage,
  standardizeCategory,
  translateEmergencyOffline,
  getLanguageByCodeOrName
} from './languages.ts';

/**
 * English/ASCII keywords must start on a word boundary and end on a word
 * boundary or a simple inflection (s, es, d, ed, ing, ...). This prevents
 * mid-word false positives such as "stable" -> "stab", "begun" -> "gun",
 * "paediatric" -> "aed" and "know"/"snow" -> "now". Non-ASCII (Indic)
 * keywords keep plain substring matching, since JS word boundaries do not
 * understand those scripts.
 */
const ASCII_KEYWORD = /^[a-z0-9 '\-]+$/;
const INFLECTION = "(?:s|es|d|ed|ing|ings|er|ers)?";
const matcherCache = new Map<string, RegExp | null>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(keyword: string, suffix: string): RegExp | null {
  const kw = keyword.toLowerCase();
  const cacheKey = `${suffix}|${kw}`;
  if (!matcherCache.has(cacheKey)) {
    matcherCache.set(
      cacheKey,
      ASCII_KEYWORD.test(kw) ? new RegExp(`(?<![a-z0-9])${escapeRegExp(kw)}${suffix}(?![a-z0-9])`, 'g') : null
    );
  }
  return matcherCache.get(cacheKey)!;
}

/**
 * English negation directly before a keyword ("no bleeding", "not unconscious",
 * "isn't stable", "no active bleeding"). Applies only to NEGATABLE_KEYWORDS.
 */
const NEGATION_BEFORE = /(?:^|[^a-z0-9'])(?:no(?:\s+hay)?|not|isn't|wasn't|aren't|without|never|sin|sans|pas\s+de|pas\s+d')\s*(?:(?:active|more|visible|heavy|major|serious|further|any|signs?\s+of)\s+)?$/;
/**
 * Only symptom / hazard words can be negated. Resource and need keywords
 * ("without drinking water", "no shelter", "no defibrillator") describe a
 * need and must never be suppressed.
 */
const NEGATABLE_KEYWORDS = new Set([
  'bleeding', 'blood', 'hemorrhage', 'arterial', 'stab', 'stabbed', 'stabbing', 'gunshot', 'deep cut',
  'unconscious', 'passed out', 'fainted', 'chest pain', 'left arm pain', 'heart attack', 'cardiac',
  'stroke', 'facial droop', 'slurred speech', 'choking', 'gasping',
  'fire', 'flames', 'burning', 'smoke', 'explosion', 'arson',
  'gas leak', 'fumes', 'strange odor', 'intruder', 'weapon', 'gun', 'knife', 'attacker', 'assault', 'violence',
  'seizure', 'convulsion', 'convulsing', 'poison', 'overdose', 'fracture', 'head injury', 'broken bone',
  'allergic reaction', 'electric shock',
  // Explicit symptom/hazard words only; never resource-need phrases such as
  // "sin agua potable" / "pas de nourriture" or "no respira" / "ne respire pas".
  'sangre', 'sangrando', 'saigne', 'saignement', 'hemorragia', 'hemorragie',
  'fuego', 'incendio', 'humo', 'feu', 'incendie', 'fumee', 'accidente',
  // severity modifiers
  'dying', 'critical', 'critically', 'arrest', 'fatal', 'fatally', 'stable', 'minor', 'mild'
]);

/** Keyword-specific contexts that are not the emergency ("blood pressure"). */
const KEYWORD_EXCLUSIONS: Record<string, RegExp> = {
  blood: /^\s+(?:pressure|sugar|tests?|group|type|report|donation|donor|bank|count)\b/
};

/** Indic negation is only applied to these hazard/symptom tokens, NOT needs or
 * negative life-threatening phrases ("மூச்சு இல்லை", "सांस नहीं"). */
const INDIC_NEGATABLE_KEYWORDS = new Set([
  'தீ', 'மயக்கம்', 'வலிப்பு', 'ரத்தம்', 'இரத்தம்', 'மாரடைப்பு',
  'आग', 'बेहोश', 'दुर्घटना', 'खून', 'ख़ून', 'हार्ट अटैक',
  'మంటలు', 'రక్తం', 'ಬೆಂಕಿ', 'രക്തം', 'തീ', 'আগুন', 'রক্ত'
]);
const INDIC_ABSENCE_AFTER = /^\s*(?:இல்லை|இல்ல|नहीं|नाही|లేదు|లేవు|ಇಲ್ಲ|ഇല്ല|নেই|নাই)(?:$|[\s.!?।,;])/;
const INDIC_FIRE_OUT_AFTER = /^\s*(?:அணைந்துவிட்டது|அணைந்தது|बुझ\s+गई|बुझ\s+गया)(?:$|[\s.!?।,;])/;
/** "Le téléphone est mort" / "Mi teléfono está muerto" do not report a death. */
const INANIMATE_DEATH_SUBJECT = /(?:telefono|telephone|telefon|phone|portable|celular|movil|bateria|battery|ordinateur|computadora|computer|voiture|coche)\s+$/;
const RESOLVED_FIRE_AFTER: Record<string, RegExp> = {
  fuego: /^\s+(?:(?:esta|ya\s+esta)\s+)?(?:apagado|extinguido)(?:\s+ahora)?(?:$|[\s,.!?;])/,
  feu: /^\s+(?:(?:est|a\s+ete)\s+)?(?:eteint|maitrise)(?:\s+maintenant)?(?:$|[\s,.!?;])/
};

function hasAffirmedMatch(text: string, keyword: string, suffix: string): boolean {
  const kw = keyword.toLowerCase();
  const re = buildMatcher(kw, suffix);
  if (!re) {
    let index = text.indexOf(kw);
    while (index !== -1) {
      const after = text.slice(index + kw.length);
      const absent = INDIC_ABSENCE_AFTER.test(after);
      const extinguished = (kw === 'தீ' || kw === 'आग') && INDIC_FIRE_OUT_AFTER.test(after);
      if (!INDIC_NEGATABLE_KEYWORDS.has(kw) || (!absent && !extinguished)) {
        return true;
      }
      index = text.indexOf(kw, index + kw.length);
    }
    return false;
  }
  const exclusion = KEYWORD_EXCLUSIONS[kw];
  const negatable = NEGATABLE_KEYWORDS.has(kw);
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    if (negatable && NEGATION_BEFORE.test(text.slice(Math.max(0, index - 30), index))) continue;
    // No negation of "no respira" / "ne respire pas" (critical phrases).
    if (negatable && (kw === 'saigne' || kw === 'saignement') &&
        /^\s+pas\b/.test(text.slice(index + m[0].length)) &&
        /\bne\s+$/.test(text.slice(Math.max(0, index - 20), index))) continue;
    if (exclusion && exclusion.test(text.slice(index + m[0].length))) continue;
    if (RESOLVED_FIRE_AFTER[kw]?.test(text.slice(index + m[0].length))) continue;
    if (['esta muerto', 'esta muerta', 'est mort', 'est morte'].includes(kw) &&
        INANIMATE_DEATH_SUBJECT.test(text.slice(Math.max(0, index - 35), index))) continue;
    return true;
  }
  return false;
}

/** Rule keyword match: whole word (+ simple inflection) for ASCII keywords, not negated. */
function containsKeyword(text: string, keyword: string): boolean {
  return hasAffirmedMatch(text, keyword, INFLECTION);
}

/** Prefix match for ASCII words ("help" matches "helpless", "now" does not match "know"). */
function containsWordStart(text: string, word: string): boolean {
  const re = buildMatcher(word, '[a-z0-9]*');
  return re ? text.search(re) !== -1 : text.includes(word.toLowerCase());
}

/** Exact whole-word match for ASCII words ("arrest" does not match "arrested"), not negated. */
function containsExactWord(text: string, word: string): boolean {
  return hasAffirmedMatch(text, word, '');
}

/**
 * "My grandmother collapsed" is a medical collapse, not a structural one.
 * A person word followed (in the same clause, with no structure word in
 * between) by "collapse(d)" is rewritten to a medical token before scoring.
 */
const PERSON_WORDS = "he|she|patient|man|woman|person|someone|somebody|child|kid|baby|boy|girl|grandmother|grandfather|grandma|grandpa|granny|mother|father|mom|mum|dad|husband|wife|son|daughter|brother|sister|friend|uncle|aunt|neighbou?r|colleague|student|player|runner|driver|elderly|lady|guy";
const STRUCTURE_WORDS = "building|house|home|wall|roof|bridge|ceiling|structure|floor|tunnel|rubble|earthquake|tower|block|stage|shed|school|hospital|temple|church|mosque|factory|apartment";
const PERSON_COLLAPSE = new RegExp(
  `((?<![a-z0-9])(?:${PERSON_WORDS})(?![a-z0-9])(?:(?!(?<![a-z0-9])(?:${STRUCTURE_WORDS})(?![a-z0-9]))[^.!?;])*?)(?<![a-z0-9])collaps(?:e|ed|es|ing)(?![a-z0-9])`,
  'g'
);

function markPersonCollapse(text: string): string {
  return text.replace(PERSON_COLLAPSE, '$1person-collapsed');
}

interface EmergencyRule {
  keywords: string[];
  type: string;
  category: StandardEmergencyCategory;
  defaultSeverity: SeverityLevel;
  needs: string[];
  badgeColor: VisualSOSCard['badge_color'];
  prioritySymbol: string;
  actionSteps: string[];
  firstAid: string[];
  responderInstructions: string;
}

const EMERGENCY_RULES: EmergencyRule[] = [
  // 1. MEDICAL
  {
    keywords: ['heart attack', 'chest pain', 'cardiac', 'defibrillator', 'aed', 'no pulse', 'passed out', 'unconscious', 'not breathing', 'stopped breathing', "isn't breathing", 'is not breathing', 'no breathing', 'unresponsive', 'not responding', 'fainted', 'no longer breathing', 'person-collapsed', 'left arm pain', 'நெஞ்சு வலி', 'दिल का दौरा', 'గుండె నొప్పి', 'ಹೃದಯಾಘಾತ', 'ഹൃദയാഘാതം', 'হার্ট অ্যাটাক', 'छातीत दुखणे'],
    type: 'Medical - Cardiac Emergency',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Ambulance', 'Medical help', 'Automated External Defibrillator (AED)'],
    badgeColor: 'RED',
    prioritySymbol: 'HEART_PULSE',
    actionSteps: [
      'Contact your local emergency services immediately.',
      'Locate nearest AED and begin CPR if patient stops breathing',
      'Keep patient resting in a half-sitting position, loosen tight clothing',
      'Do not give oral fluids or unprescribed medication'
    ],
    firstAid: [
      'Check responsiveness and normal breathing (look, listen, feel for 10 seconds)',
      'If unresponsive: 30 chest compressions (100-120 bpm) followed by 2 rescue breaths, or continuous hands-only CPR'
    ],
    responderInstructions: 'Patient exhibiting symptoms of acute coronary syndrome/arrest. Rapid AED access and telemetry monitoring required.'
  },
  {
    keywords: ['stroke', 'facial droop', 'slurred speech', 'arm weakness', 'sudden numbness', 'fast test', 'பக்கவாதம்', 'लकवा', 'పక్షవాతం', 'ಪಾರ್ಶ್ವವಾಯು', 'പക്ഷാഘാതം', 'পক্ষাঘাত'],
    type: 'Medical - Acute Stroke Protocol',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Stroke Response Ambulance', 'Neurological Trauma Dispatch'],
    badgeColor: 'RED',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Note exact time symptoms first began',
      'Do not allow patient to eat, drink, or take aspirin',
      'Keep patient lying flat on side (recovery position) if vomiting occurs',
      'Remain calm and speak in simple, reassuring sentences'
    ],
    firstAid: [
      'FAST evaluation: Face drooping, Arm weakness, Speech slurred, Time to call dispatch',
      'Maintain clear airway, monitor breathing continually until ambulance arrives'
    ],
    responderInstructions: 'Suspected acute ischemic or hemorrhagic stroke. Urgent stroke center transport window.'
  },
  {
    keywords: ['choking', 'cannot breathe', "can't breathe", 'cant breathe', 'unable to breathe', 'gasping', 'throat blocked', 'heimlich', 'asphyxia', 'மூச்சு திணறல்', 'सांस रुकना', 'శ్వాస ఆడటం లేదు', 'ಉಸಿರುಗಟ್ಟುವಿಕೆ', 'ശ്വാസംമുട്ടൽ', 'দম বন্ধ'],
    type: 'Medical - Airway Obstruction / Choking',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Advanced Airway EMS Team', 'Suction & Intubation Kit'],
    badgeColor: 'RED',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Encourage patient to cough forcefully if capable',
      'Stand behind victim, place fist above navel, perform rapid inward/upward abdominal thrusts (Heimlich Maneuver)',
      'For infants: 5 back blows followed by 5 chest thrusts',
      'If patient becomes unconscious, lower to ground and commence CPR immediately'
    ],
    firstAid: [
      'Check mouth for visible foreign objects only if clearly dislodged; do not perform blind finger sweeps',
      'Deliver rescue breaths if trained and airway becomes partially open'
    ],
    responderInstructions: 'Severe upper airway obstruction. Responders should prepare video laryngoscopy and surgical cricothyroid kit.'
  },
  {
    keywords: ['bleeding', 'blood', 'hemorrhage', 'stab', 'stabbed', 'stabbing', 'gunshot', 'deep cut', 'arterial', 'ரத்தப்போக்கு', 'रक्तस्राव', 'రక్తస్రావం', 'ರಕ್ತಸ್ರಾವ', 'രക്തസ്രാവം', 'রক্তপাত'],
    type: 'Trauma - Severe Hemorrhage',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Trauma Paramedic Unit', 'Tourniquet / Hemostatic Team', 'Police Secure Escort'],
    badgeColor: 'RED',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Apply firm, direct, continuous pressure directly over the wound with clean dressing',
      'If limb bleeding is catastrophic/arterial, apply a certified windlass tourniquet 2-3 inches above wound',
      'Keep patient lying down, elevate legs if possible to maintain central blood pressure',
      'Cover victim to prevent hypothermic shock'
    ],
    firstAid: [
      'Do not remove blood-soaked dressings; layer new dressings directly on top',
      'Tighten tourniquet until bright red spurting ceases and lock the windlass rod'
    ],
    responderInstructions: 'Life-threatening hemorrhage. Bring hemostatic gauze, rapid fluid infusers, and secure landing zone if remote.'
  },

  // 2. FIRE
  {
    keywords: ['fire', 'flames', 'burning', 'smoke', 'explosion', 'wildfire', 'arson', 'firefighter', 'தீ', 'आग', 'మంటలు', 'ಬೆಂಕಿ', 'തീ', 'আগুন', 'विस्फोट'],
    type: 'Fire - Structure / Smoke Hazard',
    category: 'FIRE',
    defaultSeverity: 5,
    needs: ['Fire service', 'Rescue', 'Medical help'],
    badgeColor: 'RED',
    prioritySymbol: 'FLAME',
    actionSteps: [
      'EVACUATE IMMEDIATELY: Do not stop to collect personal belongings',
      'Crawl low under smoke layer where breathable air remains coolest',
      'Feel closed doors with back of hand before opening: if warm, do NOT open; find alternate exit',
      'Close doors behind you to slow flame and smoke progression'
    ],
    firstAid: [
      'Stop, Drop, and Roll if clothing catches fire',
      'Cool superficial burns with clean running room-temperature water for 10 minutes; never apply ice or butter'
    ],
    responderInstructions: 'Confirmed active fire conditions. Prepare structural attack, search & rescue, and establish water relay.'
  },

  // 3. RESCUE
  {
    keywords: ['car crash', 'accident', 'collision', 'rollover', 'pedestrian hit', 'pinned inside', 'airbag', 'trapped in car', 'விபத்து', 'गाड़ी दुर्घटना', 'రోడ్డు ప్రమాదం', 'ಅಪಘಾತ', 'വാഹനാപകടം', 'দুর্ঘটনা'],
    type: 'Rescue - Vehicle Collision & Extrication',
    category: 'RESCUE',
    defaultSeverity: 4,
    needs: ['Heavy Rescue / Extrication Unit', 'Hydraulic Jaws of Life', 'EMS Trauma Ambulances', 'Traffic Safety Unit'],
    badgeColor: 'ORANGE',
    prioritySymbol: 'CAR_CRASH',
    actionSteps: [
      'Turn off vehicle ignitions if safe to prevent fire sparks',
      'Turn on vehicle hazard flashers and place warning triangles upstream',
      'Do not move injured occupants unless there is immediate fire or explosion threat',
      'Stabilize the neck and spine of victims with suspected head/neck injuries'
    ],
    firstAid: [
      'Direct pressure on active external bleeding with clean cloth',
      'Monitor airway, breathing, and level of consciousness; cover with jacket to prevent shock'
    ],
    responderInstructions: 'Vehicle collision with potential mechanical entrapment. Prepare hydraulic cutting tools and spinal immobilization boards.'
  },
  {
    keywords: ['collapse', 'rubble', 'trapped under', 'earthquake rescue', 'buried', 'landslide', 'இடிபாடுகள்', 'मलबे में दबा', 'శిధిలాలు', 'ಕುಸಿತ', 'കെട്ടിടം തകർന്നു', 'ধসে পড়া'],
    type: 'Rescue - Structural Collapse / Urban Search & Rescue',
    category: 'RESCUE',
    defaultSeverity: 5,
    needs: ['Urban Search & Rescue (USAR)', 'Canine K9 Search Squad', 'Heavy Shoring Equipment', 'Acoustic Listening Devices'],
    badgeColor: 'RED',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Protect head and vital organs with available cushions or arms',
      'Tap on pipes or solid structures rhythmically to create acoustic beacons for search squads',
      'Avoid unnecessary shouting to conserve oxygen and prevent dust inhalation',
      'Cover mouth and nose with a cloth or clothing filter'
    ],
    firstAid: [
      'Monitor for crush injury syndrome when victim is liberated',
      'Keep patient warm and immobilize injured limbs'
    ],
    responderInstructions: 'Structural collapse with pinned civilians. USAR acoustic listening arrays, air bags, and shoring required.'
  },

  // 4. FOOD
  {
    keywords: ['starvation', 'no food', 'starving', 'baby formula', 'infant milk', 'famine', 'food shortage', 'malnutrition', 'உணவு இல்லை', 'खाना नहीं है', 'ఆహారం లేదు', 'ಆಹಾರವಿಲ್ಲ', 'ഭക്ഷണമില്ല', 'খাবার নেই', 'भुकेने व्याकूळ'],
    type: 'Disaster Relief - Acute Food & Infant Nutrition Distress',
    category: 'FOOD',
    defaultSeverity: 4,
    needs: ['Emergency Rations Squad', 'Pediatric Formula & Nutrition Kit', 'Disaster Relief Coordination'],
    badgeColor: 'YELLOW',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Prioritize available rations for infants, nursing mothers, and elderly persons',
      'Conserve physical exertion and stay protected from extreme weather',
      'Do not consume food contaminated by flood water or exposed sewage',
      'Keep visual emergency flags or reflectors ready for supply drop coordination'
    ],
    firstAid: [
      'Administer clean electrolyte solution in small, frequent sips to prevent sudden refeeding illness',
      'Prevent hypothermia in malnourished patients by insulating body core'
    ],
    responderInstructions: 'Acute nutritional distress in disaster quadrant. Deliver high-energy emergency rations and pediatric nutrition.'
  },

  // 5. WATER
  {
    keywords: ['drinking water', 'clean water', 'potable water', 'dehydration', 'dying of thirst', 'water shortage', 'contaminated water', 'poisoned well', 'தண்ணீர் இல்லை', 'पानी की कमी', 'తాగునీరు లేదు', 'ಕುಡಿಯುವ ನೀರಿಲ್ಲ', 'കുടിവെള്ളമില്ല', 'বিশুদ্ধ জল নেই', 'पाणी संकट'],
    type: 'Disaster Relief - Potable Water Failure & Dehydration',
    category: 'WATER',
    defaultSeverity: 4,
    needs: ['Emergency Water Tanker / Distribution Unit', 'Water Purification Chlorine Tablets', 'Oral Rehydration Salts (ORS)'],
    badgeColor: 'BLUE',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Do not ingest untreated flood, stagnant, or brackish water under any circumstances',
      'Boil available water vigorously for a full minute before drinking if heat source is available',
      'Ration remaining clean water evenly across all individuals; prioritize young children',
      'Remain in shaded, cooler areas during peak daytime hours to minimize perspiration loss'
    ],
    firstAid: [
      'Administer oral rehydration salts (ORS) dissolved in clean water in slow, regular sips',
      'Place heat-exhausted or severely dehydrated victims in recumbent position in shade with moist cloth'
    ],
    responderInstructions: 'Critical potable water failure. Bulk purified drinking water delivery and rapid water-testing units required.'
  },

  // 6. SHELTER
  {
    keywords: ['shelter', 'homeless', 'roof collapsed', 'freezing', 'hypothermia', 'house destroyed', 'storm refuge', 'evacuee', 'tent needed', 'தங்குமிடம்', 'आश्रय', 'ఆశ్రయం లేదు', 'ಆಶ್ರಯವಿಲ್ಲ', 'അഭയം', 'আশ্রয় নেই', 'घर कोसळले'],
    type: 'Disaster Relief - Emergency Shelter & Refuge Need',
    category: 'SHELTER',
    defaultSeverity: 4,
    needs: ['Emergency Shelter Unit', 'Thermal Survival Blankets', 'Temporary Housing Command', 'Weatherproof Tents'],
    badgeColor: 'YELLOW',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Gather family members inside the most structurally sound remaining segment',
      'Insulate bodies from wet cold ground using cardboard, dry wood, or dry foliage beneath blankets',
      'Stay away from cracked outer walls, unstable chimney structures, and sagging electrical lines',
      'Maintain an active flashlight or beacon signal for nighttime emergency sweep patrols'
    ],
    firstAid: [
      'Replace wet clothes immediately with dry thermal layers to reverse impending hypothermia',
      'Warm the core body gently; avoid vigorous friction rubbing on frostbitten skin'
    ],
    responderInstructions: 'Displaced civilians exposed to severe environmental hazard. Provide emergency transport to designated relief shelter.'
  },

  // 7. MISSING PERSON
  {
    keywords: ['missing child', 'lost child', 'kidnapped', 'missing person', 'abducted', 'disappeared', 'lost in woods', 'wandering elder', 'காணவில்லை', 'लापता', 'తప్పిపోయారు', 'ಕಾಣೆಯಾಗಿದ್ದಾರೆ', 'കാണാനില്ല', 'নিখোঁজ', 'बेपत्ता'],
    type: 'Search & Rescue - Missing Vulnerable Individual',
    category: 'MISSING_PERSON',
    defaultSeverity: 5,
    needs: ['Law Enforcement Search Command', 'K9 Scent-Tracking Unit', 'Thermal Drone Aerial Search Team', 'Community Volunteer Grid'],
    badgeColor: 'ORANGE',
    prioritySymbol: 'SHIELD_ALERT',
    actionSteps: [
      'Record exact time, location, direction of travel, and complete clothing description immediately',
      'Preserve unwashed personal garments belonging to the missing individual in clean bag for K9 scent tracking',
      'Do not allow foot traffic to disturb the immediate vicinity where the individual was last confirmed',
      'Contact emergency dispatch and local search coordinators without delaying'
    ],
    firstAid: [
      'Prepare warm blankets, hydration, and medical assessment kit ready at command post upon recovery',
      'Check for disorientation, hypothermia, or trauma upon first contact'
    ],
    responderInstructions: 'Time-critical search and rescue for missing vulnerable individual. Establish perimeter grid and coordinate K9 search.'
  },

  // 8. OTHER / HAZMAT / GENERAL
  {
    keywords: ['gas leak', 'chemical', 'toxic', 'fumes', 'sulfur', 'carbon monoxide', 'dizzy all of us', 'strange odor', 'எரிவாயு கசிவு', 'गैस रिसाव', 'గ్యాస్ లీక్', 'ಅನಿಲ ಸೋರಿಕೆ', 'വാതക ചോർച്ച', 'গ্যাস লিক'],
    type: 'Hazardous Material / Toxic Gas',
    category: 'OTHER',
    defaultSeverity: 4,
    needs: ['Hazmat Specialized Company', 'Ventilation Squad', 'Utility Gas Emergency Dispatch'],
    badgeColor: 'ORANGE',
    prioritySymbol: 'BIOHAZARD',
    actionSteps: [
      'Evacuate structure immediately to an upwind outdoor location',
      'Do not operate light switches, doorbells, or electrical appliances (prevents spark detonation)',
      'Leave doors open as you exit to assist passive ventilation if safe',
      'Warn neighbors without ringing electric chimes'
    ],
    firstAid: [
      'Provide clean, uncompromised outdoor air immediately',
      'Wash skin or eyes with copious clean water if exposed to liquid chemical splashes'
    ],
    responderInstructions: 'Airborne toxic gas / explosive combustible hazard. Air monitoring detectors and self-contained breathing apparatus required.'
  },
  {
    keywords: ['intruder', 'weapon', 'gun', 'robbery', 'assault', 'violence', 'hostage', 'knife', 'attacker', 'stalker'],
    type: 'Law Enforcement / Active Threat',
    category: 'OTHER',
    defaultSeverity: 5,
    needs: ['Armed Tactical / Police Patrol', 'Tactical Emergency Medical Services (TEMS)'],
    badgeColor: 'RED',
    prioritySymbol: 'SHIELD_ALERT',
    actionSteps: [
      'RUN: Evacuate if a safe path is available without confronting the threat',
      'HIDE: Lock doors, barricade entryways, silence smartphones and vibration motors',
      'FIGHT: As an absolute last resort when your life is in imminent danger, use improvised tools to incapacitate the threat',
      'Keep hands visible, open, and empty when first contact is made with police officers'
    ],
    firstAid: [
      'Treat self or wounded bystanders only when in a concealed, secured shelter',
      'Pack penetrating wounds with clean cloth and apply direct compression'
    ],
    responderInstructions: 'High-risk law enforcement priority. Approaching officers require tactical situational assessment and clear perimeter.'
  },

  // 9. ADDITIONAL LIFE-THREATENING PRESENTATIONS
  // Appended last so any tie with an earlier rule still resolves to the earlier
  // rule, which keeps existing classifications unchanged. Guidance follows widely
  // published lay-rescuer first aid (Red Cross / ILCOR) and is pending clinical review.
  {
    keywords: ['drown', 'near drowning', 'pulled from the water', 'pulled out of the water', 'fell into the river', 'fell into the well', 'fell into the lake', 'fell into the sea', 'swept away', 'நீரில் மூழ்கி', 'डूब'],
    type: 'Rescue - Drowning / Water Rescue',
    category: 'RESCUE',
    defaultSeverity: 5,
    needs: ['Water Rescue Team', 'Ambulance', 'Medical help'],
    badgeColor: 'RED',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Contact your local emergency services immediately.',
      'Do not enter the water unless trained; reach with a pole or rope, or throw something that floats',
      'Once the person is out of the water, check for response and normal breathing',
      'If not breathing normally, give 5 rescue breaths if trained, then start CPR (30 compressions : 2 breaths) or hands-only CPR'
    ],
    firstAid: [
      'If breathing, place in the recovery position, remove wet clothing and keep warm',
      'Anyone rescued from drowning needs medical assessment, even if they seem well'
    ],
    responderInstructions: 'Submersion / drowning incident. Prepare water rescue, airway management, oxygen and hypothermia care.'
  },
  {
    keywords: ['seizure', 'convulsion', 'convulsing', 'epileptic', 'epilepsy', 'having a fit', 'வலிப்பு', 'मिर्गी'],
    type: 'Medical - Seizure / Convulsion',
    category: 'MEDICAL',
    defaultSeverity: 4,
    needs: ['Ambulance', 'Medical help'],
    badgeColor: 'ORANGE',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Protect the person from injury: move hard or sharp objects away and cushion the head',
      'Do NOT hold the person down and do NOT put anything in their mouth',
      'Time the seizure; contact emergency services if it lasts over 5 minutes, repeats, is a first seizure, or the person is injured or pregnant',
      'When the jerking stops, turn the person onto their side (recovery position) and check breathing'
    ],
    firstAid: [
      'Stay with the person and reassure them until they are fully alert',
      'If not breathing normally after the seizure, start CPR'
    ],
    responderInstructions: 'Active or recent seizure. Assess for status epilepticus, airway compromise, hypoglycaemia and head injury.'
  },
  {
    keywords: ['poison', 'overdose', 'swallowed pills', 'took pills', 'too many pills', 'sleeping pills', 'pesticide', 'insecticide', 'rat killer', 'drank bleach', 'swallowed bleach', 'drank kerosene', 'விஷம்', 'जहर', 'ज़हर'],
    type: 'Medical - Poisoning / Overdose',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Ambulance', 'Medical help', 'Poison Control Advice'],
    badgeColor: 'RED',
    prioritySymbol: 'BIOHAZARD',
    actionSteps: [
      'Contact your local emergency services or poison control immediately.',
      'Do NOT make the person vomit and do not give food, drink or remedies unless a medical professional tells you to',
      'Keep the container, pills or substance to show responders',
      'If unresponsive but breathing, place in the recovery position; if not breathing normally, start CPR'
    ],
    firstAid: [
      'If poison is on the skin or in the eyes, rinse with plenty of clean running water for at least 15 minutes',
      'If fumes were inhaled, move the person to fresh air only if it is safe for you'
    ],
    responderInstructions: 'Suspected poisoning or overdose. Identify substance, amount and time; prepare airway support and toxicology consult.'
  },
  {
    keywords: ['snake bite', 'snakebite', 'bitten by a snake', 'snake bit', 'scorpion sting', 'stung by a scorpion', 'dog bite', 'bitten by a dog', 'animal bite', 'பாம்பு கடி', 'सांप ने काटा', 'साँप ने काटा'],
    type: 'Medical - Snake / Animal Bite',
    category: 'MEDICAL',
    defaultSeverity: 4,
    needs: ['Ambulance', 'Medical help', 'Antivenom-capable Hospital'],
    badgeColor: 'ORANGE',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Move away from the animal; do not try to catch or kill it',
      'Keep the person calm and still; keep the bitten limb still and at or below heart level',
      'Remove rings, watches and tight clothing near the bite before swelling starts',
      'Get to a hospital urgently; snake bites may need antivenom'
    ],
    firstAid: [
      'Do NOT cut the wound, suck out venom, apply ice, or tie a tight tourniquet',
      'For dog or other animal bites, wash the wound with soap and running water for 15 minutes; rabies vaccination may be needed'
    ],
    responderInstructions: 'Envenomation or animal bite. Note time of bite and species if known; prepare for antivenom and anaphylaxis.'
  },
  {
    keywords: ['in labor', 'in labour', 'labor pain', 'labour pain', 'water broke', 'waters broke', 'baby is coming', 'baby coming', 'giving birth', 'contractions', 'delivery pain', 'பிரசவ வலி', 'प्रसव'],
    type: 'Medical - Childbirth / Labour',
    category: 'MEDICAL',
    defaultSeverity: 4,
    needs: ['Ambulance', 'Medical help', 'Maternity Unit'],
    badgeColor: 'ORANGE',
    prioritySymbol: 'HEART_PULSE',
    actionSteps: [
      'Contact your local emergency services immediately.',
      'Help the mother into a comfortable position on clean sheets or towels; wash your hands',
      'Do not pull on the baby or the cord; support the baby as it is born',
      'Tell responders immediately about heavy bleeding, fits, or the cord or a limb appearing first'
    ],
    firstAid: [
      "After birth, dry the baby, place it skin-to-skin on the mother's chest and cover both to keep warm",
      'If the baby is not breathing, rub its back gently; if still not breathing, start infant CPR'
    ],
    responderInstructions: 'Active labour / imminent delivery. Prepare obstetric kit, neonatal resuscitation and postpartum haemorrhage care.'
  },
  {
    keywords: ['anaphylaxis', 'anaphylactic', 'allergic reaction', 'throat swelling', 'tongue swelling', 'face swelling', 'epipen', 'ஒவ்வாமை', 'एलर्जी'],
    type: 'Medical - Severe Allergic Reaction (Anaphylaxis)',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Ambulance', 'Medical help'],
    badgeColor: 'RED',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Contact your local emergency services immediately.',
      'If the person has an adrenaline (epinephrine) auto-injector, help them use it in the outer thigh',
      'Let them sit up if breathing is difficult; lie flat with legs raised if faint or dizzy',
      'If there is no improvement after 5 minutes and a second auto-injector is available, it may be used'
    ],
    firstAid: [
      'Do not let the person stand up or walk suddenly',
      'If not breathing normally, start CPR'
    ],
    responderInstructions: 'Suspected anaphylaxis. Prepare IM adrenaline, airway management and oxygen.'
  },
  {
    keywords: ['electric shock', 'electrocuted', 'electrocution', 'live wire', 'got current', 'current shock', 'மின்சாரம் தாக்கி', 'करंट'],
    type: 'Medical - Electric Shock',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Ambulance', 'Medical help', 'Electricity Utility Emergency'],
    badgeColor: 'RED',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Do NOT touch the person until the power source is switched off',
      'Switch off power at the mains or unplug the device; for high-voltage lines, stay well back and wait for responders',
      'Contact your local emergency services immediately.',
      'Once it is safe, check breathing; if not breathing normally, start CPR'
    ],
    firstAid: [
      'Cool electrical burns under cool running water and cover loosely with clean, non-fluffy material',
      'Everyone who has had an electric shock needs medical assessment'
    ],
    responderInstructions: 'Electrical injury. Confirm scene is de-energised; assess for arrhythmia, burns and secondary trauma.'
  },
  {
    keywords: ['fell from', 'fell off', 'fell down the stairs', 'fall from', 'head injury', 'hit his head', 'hit her head', 'fracture', 'broken bone', 'broken leg', 'broken arm', 'spinal injury', 'neck injury', 'கீழே விழுந்து', 'गिर गया', 'गिर गई'],
    type: 'Medical - Fall / Head or Bone Injury',
    category: 'MEDICAL',
    defaultSeverity: 4,
    needs: ['Ambulance', 'Medical help'],
    badgeColor: 'ORANGE',
    prioritySymbol: 'ALERT_TRIANGLE',
    actionSteps: [
      'Do not move the person if a head, neck or back injury is possible, unless they are in danger',
      'Keep the head and neck still and in line with the body',
      'Contact your local emergency services, especially after a fall from height or a head injury',
      'Watch for drowsiness, confusion, vomiting or unequal pupils and tell responders'
    ],
    firstAid: [
      'Control any bleeding with firm pressure using a clean cloth',
      'Support injured limbs in the position found; if not breathing normally, start CPR'
    ],
    responderInstructions: 'Fall / blunt trauma. Assess for head, spinal and long-bone injury; prepare immobilisation.'
  },
  {
    keywords: ['he is dead', 'she is dead', 'has died', 'he died', 'she died', 'dead body', 'body found', 'no signs of life', 'lifeless', 'இறந்துவிட்டார்', 'मर गया', 'मर गई'],
    type: 'Medical - Possible Death / Unresponsive Person',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['Ambulance', 'Medical help', 'Police'],
    badgeColor: 'RED',
    prioritySymbol: 'HEART_PULSE',
    actionSteps: [
      'Contact your local emergency services immediately.',
      'Check for response and normal breathing; if not breathing normally, start CPR unless death is obvious',
      'If death is obvious, do not move the body or disturb the scene; wait for police and medical responders',
      'Keep other people away from the area'
    ],
    firstAid: [
      'If you are unsure whether the person is alive, start CPR and continue until help arrives',
      'Use an AED if one is available'
    ],
    responderInstructions: 'Reported death or lifeless person. Confirm signs of life, begin resuscitation if indicated, and secure the scene.'
  }
];

/**
 * Multilingual TYPED-input keywords (Spanish, French, Romanized Hindi
 * "Hinglish", Romanized Tamil "Tanglish" and additional Indian-script
 * phrases). Latin keywords are written without accents: input is
 * accent-folded before matching, so "cardíaco" and "cardiaco" both match.
 * Kept separate from the base rules so the original lists stay untouched;
 * merged once at module load.
 */
const MULTILINGUAL_KEYWORDS: Record<string, string[]> = {
  'Medical - Cardiac Emergency': [
    // Spanish / French
    'ataque al corazon', 'ataque cardiaco', 'infarto', 'paro cardiaco', 'no respira', 'ya no respira', 'dejo de respirar', 'inconsciente', 'se desmayo', 'dolor en el pecho', 'sin pulso',
    'crise cardiaque', 'arret cardiaque', 'ne respire pas', 'ne respire plus', 'inconscient', 'douleur thoracique', 'douleur a la poitrine', 'evanoui', 'pas de pouls',
    // Hinglish / Tanglish
    'dil ka daura', 'saans nahi', 'sans nahi', 'saans nahi le raha', 'saans nahi le rahe', 'saans nahi le rahi', 'behosh', 'seene mein dard', 'seene me dard', 'chhati mein dard',
    'nenju vali', 'nenjuvali', 'moochu vidala', 'moochu illa', 'mayakkam', 'maaradaippu', 'maradaippu',
    // Indian scripts
    'सांस नहीं', 'साँस नहीं', 'बेहोश', 'सीने में दर्द', 'हार्ट अटैक', 'मूच्छित', 'बेशुद्ध', 'श्वास घेत नाही',
    'மூச்சு விடவில்லை', 'மூச்சு இல்லை', 'மயக்கம்', 'மாரடைப்பு', 'స్పృహ లేదు', 'ಪ್ರಜ್ಞೆ ಇಲ್ಲ', 'ബോധമില്ല', 'অজ্ঞান'
  ],
  'Medical - Acute Stroke Protocol': ['derrame cerebral', 'accidente cerebrovascular', 'avc', 'accident vasculaire', 'lakwa', 'lakva'],
  'Medical - Airway Obstruction / Choking': [
    'no puede respirar', 'atragantado', 'atragantada', 'ne peut pas respirer', 'il s\'etouffe', 'elle s\'etouffe', 'etouffement',
    'dum ghut', 'dam ghut', 'gale mein atak', 'moochu thinaral', 'moochu thenaral', 'दम घुट', 'गले में अटक'
  ],
  'Trauma - Severe Hemorrhage': [
    'sangre', 'sangrando', 'hemorragia', 'apunalado', 'apunalada', 'herida de bala', 'disparo',
    'saigne', 'saignement', 'du sang', 'beaucoup de sang', 'hemorragie', 'poignarde', 'poignardee', 'blessure par balle',
    'khoon', 'khun beh', 'khoon beh', 'ratham', 'rattham', 'raththam',
    'खून', 'ख़ून', 'ரத்தம்', 'இரத்தம்', 'রক্ত', 'రక్తం', 'ರಕ್ತ', 'രക്തം'
  ],
  'Fire - Structure / Smoke Hazard': [
    'incendio', 'fuego', 'humo', 'en llamas', 'incendie', 'feu', 'au feu', 'fumee', 'flammes',
    'aag', 'aag lagi', 'aag lag gayi', 'neruppu', 'thee pidichiruchu', 'thee pidichirukku', 'thee pudichiruchu', 'theeppidippu',
    'आग लगी', 'आग लागली', 'தீ பிடித்து', 'நெருப்பு'
  ],
  'Rescue - Vehicle Collision & Extrication': [
    'accidente', 'choque', 'accidente de coche', 'accident de voiture', 'accident de la route',
    'accident ho gaya', 'accident aayiduchu', 'accident aachu', 'दुर्घटना', 'एक्सीडेंट', 'अपघात', 'சாலை விபத்து', 'ആക്സിഡന്റ്'
  ],
  'Rescue - Structural Collapse / Urban Search & Rescue': ['derrumbe', 'edificio colapsado', 'effondrement', 'immeuble effondre', 'building gir gaya', 'इमारत गिर'],
  'Disaster Relief - Acute Food & Infant Nutrition Distress': ['sin comida', 'no hay comida', 'pas de nourriture', 'khana nahi', 'saapadu illa', 'sapadu illa', 'भोजन नहीं'],
  'Disaster Relief - Potable Water Failure & Dehydration': ['sin agua potable', 'no hay agua', 'pas d\'eau potable', 'pas d\'eau', 'paani nahi', 'pani nahi', 'thanni illa', 'kudi thanni illa', 'पीने का पानी नहीं'],
  'Disaster Relief - Emergency Shelter & Refuge Need': ['sin refugio', 'necesitamos refugio', 'sans abri', 'besoin d\'abri', 'rehne ki jagah nahi', 'ghar toot gaya', 'veedu idinthu'],
  'Search & Rescue - Missing Vulnerable Individual': ['desaparecido', 'desaparecida', 'nino perdido', 'nina perdida', 'secuestrado', 'disparu', 'disparue', 'enfant perdu', 'enleve', 'laapata', 'lapata', 'kho gaya', 'kho gayi', 'kaanavillai', 'kanavillai', 'गुम हो गया', 'अपहरण'],
  'Hazardous Material / Toxic Gas': ['fuga de gas', 'olor a gas', 'fuite de gaz', 'odeur de gaz', 'gas leak ho raha', 'gas kasivu', 'गैस लीक', 'गॅस गळती'],
  'Law Enforcement / Active Threat': [
    'pistola', 'cuchillo', 'robo', 'asalto', 'ladron', 'secuestro', 'arme', 'couteau', 'agression', 'cambrioleur', 'voleur', 'pistolet',
    'chaku', 'bandook', 'bandooq', 'goli chali', 'chor', 'maar raha', 'kathi', 'thirudan',
    'चाकू', 'बंदूक', 'गोली', 'चोर', 'हमला', 'கத்தி', 'திருடன்', 'துப்பாக்கி'
  ],
  'Rescue - Drowning / Water Rescue': ['ahogamiento', 'se esta ahogando', 'noyade', 'se noie', 'il se noie', 'doob raha', 'doob rahi', 'doob gaya', 'doob gayi', 'moozhgi', 'moolgi', 'নিমজ্জিত', 'ডুবে', 'నీటిలో మునిగి', 'ಮುಳುಗ', 'മുങ്ങി', 'बुडत'],
  'Medical - Seizure / Convulsion': ['convulsion', 'convulsiones', 'ataque epileptico', 'crise d\'epilepsie', 'crise epileptique', 'convulsions', 'mirgi', 'valippu', 'jhatke aa rahe'],
  'Medical - Poisoning / Overdose': ['veneno', 'envenenado', 'envenenada', 'sobredosis', 'empoisonne', 'empoisonnee', 'zeher', 'zehar', 'jahar', 'visham', 'vishamm', 'poochi marundhu'],
  'Medical - Snake / Animal Bite': ['mordedura de serpiente', 'mordio una serpiente', 'picadura de alacran', 'morsure de serpent', 'mordu par un serpent', 'saanp ne kaata', 'saap ne kata', 'saanp ne kata', 'saamp', 'paambu kadi', 'pambu kadi', 'paambu kadichiruchu', 'pambu kadichiruchu', 'naai kadi'],
  'Medical - Childbirth / Labour': ['parto', 'dando a luz', 'trabajo de parto', 'se rompio la fuente', 'accouchement', 'elle accouche', 'perdu les eaux', 'contractions', 'prasav', 'prasav pida', 'prasava vali', 'delivery aagudhu'],
  'Medical - Severe Allergic Reaction (Anaphylaxis)': ['reaccion alergica', 'choque anafilactico', 'reaction allergique', 'choc anaphylactique', 'gala sooj', 'allergy reaction'],
  'Medical - Electric Shock': ['descarga electrica', 'electrocutado', 'electrocutada', 'electrocute', 'electrocutee', 'choc electrique', 'current laga', 'current lag gaya', 'current lagi', 'karant', 'current adichiruchu', 'current adichu', 'करंट लगा', 'शॉक लगा'],
  'Medical - Fall / Head or Bone Injury': ['se cayo', 'fractura', 'hueso roto', 'est tombe', 'est tombee', 'jambe cassee', 'bras casse', 'gir gaya', 'gir gayi', 'haddi toot', 'haddi tut', 'keezha vizhunthu', 'keela vizhunthu', 'keezhe vizhundhutaar', 'எலும்பு முறிவு', 'हड्डी टूट'],
  'Medical - Possible Death / Unresponsive Person': ['esta muerto', 'esta muerta', 'murio', 'est mort', 'est morte', 'decede', 'mar gaya', 'mar gayi', 'maut ho gayi', 'irandhuttar', 'iranthuttar', 'செத்துட்டார்', 'मृत्यू']
};

/** Urgent words (fallback severity 3) in typed Spanish / French / Hinglish / Tanglish / scripts. */
const MULTILINGUAL_URGENT_WORDS = [
  'ayuda', 'socorro', 'emergencia', 'urgente', 'au secours', 'aidez', 'urgence', 'a l\'aide',
  'bachao', 'bachaao', 'madad', 'jaldi aao', 'kaapathunga', 'kapathunga', 'kaapaathunga', 'udhavi', 'udavi',
  'मदद', 'உதவி', 'সাহায্য', 'సహాయం చేయండి', 'ಸಹಾಯ', 'സഹായം', 'वाचवा', 'मदत'
];

/** Critical-condition words (force severity 5) in typed Spanish / French / Hinglish. */
const MULTILINGUAL_CRITICAL_WORDS = ['muriendo', 'se muere', 'estado critico', 'mourant', 'il meurt', 'elle meurt', 'etat critique', 'marne wala', 'mar raha', 'mar rahi', 'jaan khatre mein'];

const MULTILINGUAL_KEYWORD_SET = new Set<string>();

for (const rule of EMERGENCY_RULES) {
  const extra = (MULTILINGUAL_KEYWORDS[rule.type] || []).filter((kw) => !rule.keywords.includes(kw));
  extra.forEach((kw) => MULTILINGUAL_KEYWORD_SET.add(kw));
  rule.keywords = [...rule.keywords, ...extra];
}

/** Fold Latin accents (á→a, é→e, ñ→n, ç→c, œ→oe) so typed Spanish/French match with or without accents. Non-Latin scripts are untouched. */
function foldLatin(value: string): string {
  return value
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ñ/g, 'n').replace(/ç/g, 'c')
    .replace(/œ/g, 'oe').replace(/ÿ/g, 'y');
}

export function classifyEmergencyOffline(
  text: string,
  locationHint?: string,
  preferredLanguage: string = 'English',
  targetLanguageCode?: string
): NemotronEmergencyResponse {
  // Narrow English denial handling: remove only a complete explicit fire-denial
  // clause, not emergency negations ("no pulse") or "no fire extinguisher".
  // Keep the original text for display and translation. Other hazards still score.
  const normalizedInput = foldLatin(text.toLowerCase().trim().replace(/[\u2018\u2019\u02bc]/g, "'"));
  let normalized = normalizedInput.replace(
    /(^|[.!?;,]|\bbut\b)\s*(?:there\s+is\s+no\s+(?:active\s+)?fire|no\s+(?:active\s+)?fire|(?:the\s+)?fire\s+(?:is|was|has\s+been)\s+(?:(?:now|already|completely|fully)\s+)?(?:out|extinguished|put\s+out)(?:\s+now)?)(?=\s*(?:$|[.!?;,]|\bbut\b|\band\b))/g,
    '$1 '
  );
  normalized = normalized.replace(
    /(^|[.!?;,])\s*(?:no\s+hay\s+(?:fuego|incendio)|(?:el\s+)?fuego\s+(?:(?:ya\s+)?esta\s+)?(?:apagado|extinguido)(?:\s+ahora)?|(?:il\s+n'y\s+a\s+)?pas\s+(?:de\s+|d')(?:feu|incendie)|(?:le\s+)?feu\s+est\s+(?:eteint|maitrise)(?:\s+maintenant)?)(?=\s*(?:$|[.!?;,]|\b(?:pero|mais|et|y)\b))/g,
    '$1 '
  );
  const hasExplicitFireDenial = normalized !== normalizedInput;
  normalized = markPersonCollapse(normalized);
  let clarificationOnly = false;
  const detected = detectLanguage(text);

  // Find matching rule with highest keyword matches
  let bestRule: EmergencyRule | null = null;
  let bestScore = 0;

  for (const rule of EMERGENCY_RULES) {
    let score = 0;
    const matched = rule.keywords.filter(kw => containsKeyword(normalized, kw));
    for (const kw of rule.keywords) {
      // A keyword embedded in another matched keyword of the same rule still
      // scores (e.g. "fire" inside "wildfire"), preserving the original weighting.
      // Multilingual additions score only on a direct match that is not part
      // of a longer matched keyword, so they never alter existing tie-breaks.
      const lower = kw.toLowerCase();
      if (MULTILINGUAL_KEYWORD_SET.has(kw)) {
        if (matched.includes(kw) && !matched.some(m => m !== kw && m.toLowerCase().includes(lower))) score += 2;
        continue;
      }
      const baseMatched = matched.filter(m => !MULTILINGUAL_KEYWORD_SET.has(m));
      if (baseMatched.includes(kw) || baseMatched.some(m => m !== kw && m.toLowerCase().includes(lower))) {
        score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  // Fallback if no specific keyword matched
  if (!bestRule || bestScore === 0) {
    const category = standardizeCategory(hasExplicitFireDenial ? normalized : text);
    const hasUrgentWords = ['urgent', 'emergency', 'help', 'now', 'hurt', 'pain', 'danger', 'sos', 'காப்பாத்துங்க', 'बचाओ', 'సహాయం', 'ಕಾಪಾಡಿ', 'രക്ഷിക്കൂ', 'বাঁচাও', ...MULTILINGUAL_URGENT_WORDS].some(w => containsWordStart(normalized, w));
    
    clarificationOnly = hasExplicitFireDenial && !hasUrgentWords;
    bestRule = {
      keywords: [],
      type: hasUrgentWords ? `${category} Emergency - Evaluation Required` : `General ${category} Incident`,
      category,
      defaultSeverity: hasUrgentWords ? 3 : 2,
      needs: ['Emergency Medical Services (EMS) Assessment', 'First Responder Verification'],
      badgeColor: hasUrgentWords ? 'ORANGE' : 'YELLOW',
      prioritySymbol: 'ALERT_TRIANGLE',
      actionSteps: [
        'Confirm you are in a safe physical location away from immediate hazards',
        'Keep mobile device charged and line open for incoming responder callbacks',
        'State current address, landmarks, and visible hazards to first contact',
        'Stay calm and monitor vital signs until professional assistance arrives'
      ],
      firstAid: [
        'Place patient in recovery position if conscious and breathing normally',
        'Do not leave patient unattended if symptoms worsen'
      ],
      responderInstructions: 'Unclassified incident. On-scene visual assessment and triage required upon arrival.'
    };
  }

  if (clarificationOnly) {
    bestRule = {
      keywords: [],
      type: 'No active fire reported — clarification required',
      category: 'OTHER',
      defaultSeverity: 1,
      needs: [],
      badgeColor: 'YELLOW',
      prioritySymbol: 'ALERT_TRIANGLE',
      actionSteps: ['If you need assistance, describe the current hazard or symptoms.'],
      firstAid: [],
      responderInstructions: 'The user explicitly denies fire. No active hazard was identified by local rules; clarify before escalation.'
    };
  }

  // Calculate dynamic severity
  let severity = bestRule.defaultSeverity;
  if (
    ['unconscious', 'dying', 'critical', 'critically', 'arrest', 'fatal', 'fatally', 'not breathing', 'stopped breathing', "isn't breathing", 'no breathing', ...MULTILINGUAL_CRITICAL_WORDS]
      .some(word => containsExactWord(normalized, word)) ||
    normalized.includes('உயிருக்கு ஆபத்து') ||
    normalized.includes('गंभीर') ||
    normalized.includes('ప్రాణాపాయం')
  ) {
    severity = 5;
  } else if (['stable', 'minor', 'mild'].some(word => containsExactWord(normalized, word))) {
    severity = Math.max(1, severity - 1) as SeverityLevel;
  }

  // Formulate dispatch message
  const locString = locationHint ? ` [Location: ${locationHint}]` : '';
  const dispatchMessage = clarificationOnly
    ? `CLARIFICATION REQUIRED: No active fire reported. Details: "${text.trim()}".${locString} Describe any current hazard or symptoms if assistance is needed.`
    : `DISPATCH ALERT: Priority ${severity}/5 - [${bestRule.category}] ${bestRule.type}. Details: "${text.trim()}".${locString} Required Assets: ${bestRule.needs.join(', ')}. Action: Dispatch nearest units immediately.`;

  const baseResponse: NemotronEmergencyResponse = {
    transcript: text.trim(),
    emergency_category: bestRule.category,
    emergency_type: bestRule.type,
    severity,
    needs: bestRule.needs,
    message: dispatchMessage,
    visual_card: {
      headline: `${bestRule.type.toUpperCase()} (PRIORITY ${severity})`,
      badge_color: bestRule.badgeColor,
      action_steps: bestRule.actionSteps,
      priority_symbol: bestRule.prioritySymbol,
      instructions_for_responders: bestRule.responderInstructions,
      first_aid_actions: bestRule.firstAid
    },
    language: preferredLanguage || detected.name,
    detected_language: detected
  };

  // If a target language is specified (e.g. Tamil or Hindi) and differs from detected, generate translated SOS.
  // Per the multilingual data contract, `translated_message` must be a faithful
  // translation of the USER'S SOURCE TEXT (the transcript), never the generated
  // dispatch message. The structured directive fields remain separate above.
  const targetCode = targetLanguageCode || (preferredLanguage ? getLanguageByCodeOrName(preferredLanguage).code : undefined);
  if (targetCode && targetCode !== detected.code) {
    const translated = translateEmergencyOffline(
      text.trim(),
      targetCode,
      bestRule.category,
      severity,
      bestRule.type,
      detected.code,
      locationHint
    );
    baseResponse.translation = {
      ...translated,
      source: 'offline_fallback',
      model_used: 'LifeLine AI Deterministic Emergency Engine'
    };
  }

  return baseResponse;
}
