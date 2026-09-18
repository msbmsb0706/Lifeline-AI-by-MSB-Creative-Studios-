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
    keywords: ['heart attack', 'chest pain', 'cardiac', 'defibrillator', 'aed', 'no pulse', 'passed out', 'unconscious', 'left arm pain', 'நெஞ்சு வலி', 'दिल का दौरा', 'గుండె నొప్పి', 'ಹೃದಯಾಘಾತ', 'ഹൃദയാഘാതം', 'হার্ট অ্যাটাক', 'छातीत दुखणे'],
    type: 'Medical - Cardiac Emergency',
    category: 'MEDICAL',
    defaultSeverity: 5,
    needs: ['ALS Paramedic Ambulance', 'Automated External Defibrillator (AED)', 'Emergency Cardiac Care Team'],
    badgeColor: 'RED',
    prioritySymbol: 'HEART_PULSE',
    actionSteps: [
      'Call emergency services immediately (911 / 112 / 108)',
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
    keywords: ['choking', 'cannot breathe', 'gasping', 'throat blocked', 'heimlich', 'asphyxia', 'மூச்சு திணறல்', 'सांस रुकना', 'శ్వాస ఆడటం లేదు', 'ಉಸಿರುಗಟ್ಟುವಿಕೆ', 'ശ്വാസംമുട്ടൽ', 'দম বন্ধ'],
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
    keywords: ['bleeding', 'blood', 'hemorrhage', 'stab', 'gunshot', 'deep cut', 'arterial', 'ரத்தப்போக்கு', 'रक्तस्राव', 'రక్తస్రావం', 'ರಕ್ತಸ್ರಾವ', 'രക്തസ്രാവം', 'রক্তপাত'],
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
    keywords: ['fire', 'flames', 'burning', 'smoke', 'explosion', 'wildfire', 'arson', 'தீ', 'आग', 'మంటలు', 'ಬೆಂಕಿ', 'തീ', 'আগুন', 'विस्फोट'],
    type: 'Fire - Structure / Smoke Hazard',
    category: 'FIRE',
    defaultSeverity: 5,
    needs: ['Fire Engine Company', 'Aerial Ladder Squad', 'Thermal Imaging Search Team', 'Paramedic Standby'],
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
  }
];

export function classifyEmergencyOffline(
  text: string,
  locationHint?: string,
  preferredLanguage: string = 'English',
  targetLanguageCode?: string
): NemotronEmergencyResponse {
  const normalized = text.toLowerCase().trim();
  const detected = detectLanguage(text);

  // Find matching rule with highest keyword matches
  let bestRule: EmergencyRule | null = null;
  let bestScore = 0;

  for (const rule of EMERGENCY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (normalized.includes(kw.toLowerCase())) {
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
    const category = standardizeCategory(text);
    const hasUrgentWords = ['urgent', 'emergency', 'help', 'now', 'hurt', 'pain', 'danger', 'sos', 'காப்பாத்துங்க', 'बचाओ', 'సహాయం', 'ಕಾಪಾಡಿ', 'രക്ഷിക്കൂ', 'বাঁচাও'].some(w => normalized.includes(w));
    
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

  // Calculate dynamic severity
  let severity = bestRule.defaultSeverity;
  if (
    normalized.includes('unconscious') ||
    normalized.includes('dying') ||
    normalized.includes('critical') ||
    normalized.includes('arrest') ||
    normalized.includes('fatal') ||
    normalized.includes('உயிருக்கு ஆபத்து') ||
    normalized.includes('गंभीर') ||
    normalized.includes('ప్రాణాపాయం')
  ) {
    severity = 5;
  } else if (normalized.includes('stable') || normalized.includes('minor') || normalized.includes('mild')) {
    severity = Math.max(1, severity - 1) as SeverityLevel;
  }

  // Formulate dispatch message
  const locString = locationHint ? ` [Location: ${locationHint}]` : '';
  const dispatchMessage = `DISPATCH ALERT: Priority ${severity}/5 - [${bestRule.category}] ${bestRule.type}. Details: "${text.trim()}".${locString} Required Assets: ${bestRule.needs.join(', ')}. Action: Dispatch nearest units immediately.`;

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

  // If a target language is specified (e.g. Tamil or Hindi) and differs from detected, generate translated SOS
  const targetCode = targetLanguageCode || (preferredLanguage ? getLanguageByCodeOrName(preferredLanguage).code : undefined);
  if (targetCode && targetCode !== detected.code) {
    const translated = translateEmergencyOffline(
      dispatchMessage,
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
