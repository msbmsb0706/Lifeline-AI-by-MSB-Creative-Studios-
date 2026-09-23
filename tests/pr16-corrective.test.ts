/**
 * PR #16 corrective regression tests.
 *
 * 1. TRANSLATION SAFETY — translated_message contains ONLY a faithful
 *    translation of the user's original transmission (source priority:
 *    raw_transcript -> original_message -> legacy transcript; NEVER generated
 *    dispatch/responder content). Deterministic boilerplate validation rejects
 *    dispatch/triage combinations while accepting legitimate transmissions.
 * 2. SIMULATED LABELS — simulated DELIVERED / ACKNOWLEDGED can never appear
 *    to be real emergency-service acknowledgement.
 * 3. COUNTRY-AWARE EMERGENCY NUMBERS — no universal 911/112/108 fallback in
 *    country-independent guidance; configured numbers shown, otherwise an
 *    explicit not-configured notice. Numbers are never invented.
 * 4. CONFIGURATION UNAVAILABLE — CONFIGURED / NOT_CONFIGURED /
 *    CONFIGURATION_UNAVAILABLE are distinct; 503/timeout/malformed never
 *    display as "not configured"; no secrets exposed.
 *
 * Exercises the REAL modules with only browser globals stubbed, plus
 * call-site/source assertions in the style of app-call-sites.test.ts.
 */
import { readFileSync } from 'node:fs';
import { installBrowserStub, mockResponse } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import {
  selectTranslationSource,
  looksLikeGeneratedDispatch,
  validateTranslatedMessage
} from '../src/lib/translationSafety.ts';
import {
  GENERIC_EMERGENCY_GUIDANCE,
  EMERGENCY_NUMBER_NOT_CONFIGURED,
  getCountryEmergencyNumber,
  getEmergencyNumberDisplay
} from '../src/lib/emergencyNumbers.ts';
import {
  fetchPartnerConfigState,
  getPartnerConfigDisplayText,
  PARTNER_CONFIG_UNAVAILABLE_TEXT,
  PARTNER_NOT_CONFIGURED_TEXT
} from '../src/lib/partnerConfig.ts';
import { getEmergencyPartnerConfig } from '../server/partnerConfig.ts';
import {
  SIMULATED_DELIVERED_LABEL,
  SIMULATED_ACKNOWLEDGED_LABEL,
  SIMULATED_DELIVERY_EXPLANATION,
  SIMULATED_ACK_EXPLANATION,
  isSimulatedFinalStatus,
  getDeliveryDisplayLabel,
  createSOSPackage,
  createQueuedSOSItem,
  savePendingSOS,
  getPendingQueue,
  clearPendingQueue,
  transmitSingleSOSItem,
  simulateDemoLifecycleAdvance
} from '../src/lib/emergencyPartnerQueue.ts';
import { getTestProvider } from '../src/lib/emergencyPartnersData.ts';
import { translateEmergencyOffline } from '../src/lib/languages.ts';
import { classifyEmergencyOffline } from '../src/lib/offlineClassifier.ts';
import { EmergencyPartnerProvider } from '../src/types.ts';

function readRepoSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

// ---------------------------------------------------------------------------
// 1a. Translation source selection — raw_transcript -> original_message ->
//     legacy transcript; NEVER generated dispatch content.
// ---------------------------------------------------------------------------
section('PR16 1a — translation source priority (never generated dispatch text)');

assertEqual(
  selectTranslationSource({
    raw_transcript: 'user original words',
    transcript: 'legacy transcript',
    message: 'DISPATCH ALERT: Priority 5/5',
    translation: { original_message: 'stored original' }
  }),
  'user original words',
  'priority 1: raw_transcript wins over every other field'
);

assertEqual(
  selectTranslationSource({
    transcript: 'legacy transcript',
    message: 'DISPATCH ALERT: Priority 5/5',
    translation: { original_message: 'stored original' }
  }),
  'stored original',
  'priority 2: stored translation.original_message used when raw_transcript is absent'
);

assertEqual(
  selectTranslationSource({
    original_message: 'top-level original',
    transcript: 'legacy transcript',
    message: 'DISPATCH ALERT: Priority 5/5'
  }),
  'top-level original',
  'priority 2: top-level original_message used when raw_transcript is absent'
);

assertEqual(
  selectTranslationSource({
    transcript: 'legacy transcript only',
    message: 'DISPATCH ALERT: Priority 5/5 - Required Assets: X. Action: Dispatch now.'
  }),
  'legacy transcript only',
  'priority 3: genuinely legacy transcript used only when no newer original field exists'
);

assertEqual(
  selectTranslationSource({
    message: 'DISPATCH ALERT: Priority 5/5 - Required Assets: X. Action: Dispatch now.'
  }),
  null,
  'generated dispatch message alone is NEVER accepted as a translation source (null)'
);

assertEqual(selectTranslationSource({}), null, 'empty result object yields no source (null)');
assertEqual(selectTranslationSource(null), null, 'null input yields no source (null)');
assertEqual(
  selectTranslationSource({ raw_transcript: '   ', transcript: '' }),
  null,
  'whitespace-only originals yield no source (null)'
);

assertEqual(
  selectTranslationSource({
    raw_transcript: 'DISPATCH ALERT: Priority 5/5 - Required Assets: X. Action: Dispatch now.',
    transcript: 'clean legacy user words'
  }),
  'clean legacy user words',
  'dispatch-like raw_transcript is skipped in favor of the next clean original'
);

assertEqual(
  selectTranslationSource({
    raw_transcript: 'Emergency Category: FIRE. Priority 5/5. Required Units: Engine. First Aid: CPR.',
    transcript: 'Action Required: dispatch. Responder Instruction: go. Priority 4/5. Emergency Category: X.'
  }),
  null,
  'all candidates dispatch-like yields no source (null)'
);

// ---------------------------------------------------------------------------
// 1b. Deterministic dispatch/triage boilerplate validation (no AI).
// ---------------------------------------------------------------------------
section('PR16 1b — generated dispatch text rejected, legitimate text accepted');

const DISPATCH_SAMPLES = [
  'DISPATCH ALERT: Priority 5/5 - [FIRE] Fire - Structure / Smoke Hazard. Details: "fire". Required Assets: Fire service. Action: Dispatch nearest units immediately.',
  'Emergency Category: MEDICAL (Priority 5/5). Immediate direct on-scene access required. Required Units: Ambulance. Responder Instruction: assess vitals.',
  'Required Units: Fire Engine, Ambulance. Action Required: dispatch now. First Aid: apply CPR. Emergency Category: FIRE.',
  'DISPATCH ALERT alone is conclusive proof of generated content'
];

for (const sample of DISPATCH_SAMPLES) {
  assert(
    looksLikeGeneratedDispatch(sample),
    `dispatch boilerplate rejected: "${sample.slice(0, 60)}…"`
  );
  assertEqual(validateTranslatedMessage(sample).ok, false, 'validateTranslatedMessage rejects dispatch text');
}

const LEGITIMATE_EN = 'Please help me, there is a fire.';
const LEGITIMATE_TA = 'தயவுசெய்து எனக்கு உதவுங்கள், தீ விபத்து ஏற்பட்டுள்ளது.';
const LEGITIMATE_HI = 'कृपया मेरी मदद करें, आग लगी है।';

for (const text of [LEGITIMATE_EN, LEGITIMATE_TA, LEGITIMATE_HI]) {
  assert(!looksLikeGeneratedDispatch(text), `legitimate transmission accepted: "${text.slice(0, 40)}"`);
  assertEqual(validateTranslatedMessage(text).ok, true, 'validateTranslatedMessage accepts legitimate text');
}

// A single incidental word must never cause a false rejection.
assert(!looksLikeGeneratedDispatch('I need first aid for my cut'), 'single "First Aid" mention is not rejected');
assertEqual(validateTranslatedMessage('').ok, false, 'empty translation rejected');
assertEqual(validateTranslatedMessage('   ').ok, false, 'whitespace translation rejected');

// ---------------------------------------------------------------------------
// 1c. Four requested language pairs (real offline modules).
// ---------------------------------------------------------------------------
section('PR16 1c — language pairs: en→ta, ta→en, en→hi, ta→hi');

const PAIRS: { source: string; target: string; text: string; label: string }[] = [
  { source: 'en', target: 'ta', text: LEGITIMATE_EN, label: 'en→ta' },
  { source: 'ta', target: 'en', text: LEGITIMATE_TA, label: 'ta→en' },
  { source: 'en', target: 'hi', text: LEGITIMATE_EN, label: 'en→hi' },
  { source: 'ta', target: 'hi', text: LEGITIMATE_TA, label: 'ta→hi' }
];

for (const pair of PAIRS) {
  const t = translateEmergencyOffline(pair.text, pair.target, 'FIRE', 5, 'Fire', pair.source);
  assert(
    !looksLikeGeneratedDispatch(t.translated_message),
    `${pair.label}: translated_message is NOT generated dispatch text`
  );
  assertEqual(
    validateTranslatedMessage(t.translated_message).ok,
    true,
    `${pair.label}: translated_message passes safety validation`
  );
  assert(
    t.translated_message.includes(pair.text),
    `${pair.label}: honest offline fallback preserves the original transmission verbatim`
  );
  assertEqual(t.original_message, pair.text, `${pair.label}: original_message is the user's transmission`);
  assertEqual(t.category, 'FIRE', `${pair.label}: category locked`);
  assertEqual(t.severity, 5, `${pair.label}: severity locked`);
}

// End-to-end: the offline classifier translates the USER'S text (never its own
// generated dispatch report) for an uncovered pair.
{
  const result = classifyEmergencyOffline(LEGITIMATE_EN, undefined, 'English', 'ta');
  const tm = result.translation?.translated_message || '';
  assert(!looksLikeGeneratedDispatch(tm), 'classifier en→ta translation is NOT dispatch text');
  assert(tm.includes(LEGITIMATE_EN), 'classifier en→ta translation preserves the user text');
  assert(/DISPATCH ALERT/i.test(result.message), 'classifier dispatch message remains separate (result.message)');
}

// ---------------------------------------------------------------------------
// 1d. Translation call-site contracts (App + server).
// ---------------------------------------------------------------------------
section('PR16 1d — translation call-site contracts');

const appSource = readRepoSource('../src/App.tsx');
{
  const start = appSource.indexOf('const handleTranslateSOS =');
  assert(start !== -1, 'handleTranslateSOS exists in App');
  const fn = appSource.slice(start, appSource.indexOf('\n  return (', start));
  assert(fn.includes('selectTranslationSource'), 'handleTranslateSOS selects its source via selectTranslationSource');
  assert(
    !fn.includes('currentResult.raw_transcript || currentResult.message'),
    'legacy generated-message fallback removed from the translation source'
  );
  assert(!fn.includes('text: currentResult.message'), 'online request never sends the generated dispatch message');
  assert(fn.includes('currentSOS: currentResult'), 'currentSOS context still forwarded (locked triage fields)');
  assert(
    fn.includes('validateTranslatedMessage') || fn.includes('acceptTranslation'),
    'incoming translated_message is deterministically validated before display'
  );
  assert(fn.includes('TRANSLATION_VALIDATION_FAILED'), 'validation failures take an explicit terminal error path');
  assert(fn.includes('Translation unavailable'), 'explicit translation-unavailable error state shown');
}

const serverSource = readRepoSource('../server.ts');
assert(
  !serverSource.includes('const sourceText = text || currentSOS?.message'),
  'server no longer falls back to the generated dispatch message as translation source'
);
assert(serverSource.includes('currentSOS?.raw_transcript'), 'server prefers raw_transcript as translation source');
assert(serverSource.includes('TRANSLATION_INVALID_SOURCE'), 'server rejects dispatch-like translation sources');
assert(serverSource.includes('TRANSLATION_VALIDATION_FAILED'), 'server rejects dispatch-like translation output');
assert(serverSource.includes('raw_transcript: trimmedText'), 'server raw_transcript is the submitted original text');

const cardSource = readRepoSource('../src/components/SOSCardView.tsx');
assert(cardSource.includes('translationFailedValidation'), 'SOS card guards the translated display with validation');
assert(
  cardSource.includes('Translation unavailable — safety validation failed.'),
  'SOS card shows an explicit translation error state'
);

// ---------------------------------------------------------------------------
// 2. Simulated delivery/acknowledgement labels.
// ---------------------------------------------------------------------------
section('PR16 2 — simulated statuses can never look like real acknowledgement');

assertEqual(SIMULATED_DELIVERED_LABEL, 'SIMULATED — DELIVERED', 'simulated delivered label is exact');
assertEqual(
  SIMULATED_ACKNOWLEDGED_LABEL,
  'SIMULATED — RESPONDER ACKNOWLEDGED',
  'simulated acknowledged label is exact'
);
assertEqual(
  SIMULATED_DELIVERY_EXPLANATION,
  'Simulation only — no real emergency organization received this SOS.',
  'simulated delivery explanation is exact'
);
assertEqual(
  SIMULATED_ACK_EXPLANATION,
  'Simulation only — no real emergency organization acknowledged this SOS.',
  'simulated acknowledgement explanation is exact'
);

const AUTHORIZED_PROVIDER: EmergencyPartnerProvider = {
  id: 'authorized-test',
  country: 'US',
  countryName: 'United States',
  providerName: 'Authorized Test Partner',
  providerType: 'AUTHORIZED_API',
  serviceType: 'RESCUE',
  apiBaseUrl: '/api/emergency-partner/dispatch',
  apiEnabled: true,
  requiresUserConfirmation: true,
  supportsMediaUpload: false
};

function refind(sosId: string) {
  return getPendingQueue().find((i) => i.sosPackage.sosId === sosId);
}

// Simulated flow: labels, persistence across refresh, zero network.
clearPendingQueue();
installBrowserStub({
  online: true,
  fetch: () =>
    Promise.resolve(
      mockResponse(200, {
        success: true,
        data: {
          success: true,
          status: 'ACKNOWLEDGED',
          referenceId: 'PR16-SIM-1',
          timestamp: new Date().toISOString(),
          message: 'MOCK ack — DEMONSTRATION ONLY',
          partnerId: 'test-partner-demo',
          partnerName: 'TEST',
          providerType: 'TEST'
        }
      })
    )
});
{
  const item = createQueuedSOSItem({
    sosPackage: createSOSPackage({
      emergencyType: 'MEDICAL',
      category: 'MEDICAL',
      severity: 3,
      message: 'PR16 simulation label check',
      source: 'online'
    }),
    targetPartner: getTestProvider(),
    userConsentTimestamp: new Date().toISOString()
  });
  savePendingSOS(item);
  await transmitSingleSOSItem(item);
  assertEqual(refind(item.sosPackage.sosId)?.status, 'SENT', 'fixture reaches SENT before simulation');
  assertEqual(isSimulatedFinalStatus(refind(item.sosPackage.sosId)), false, 'SENT is not a simulated final state');
  assertEqual(getDeliveryDisplayLabel(refind(item.sosPackage.sosId)!), 'SENT', 'SENT label unchanged');

  // From here on the simulator must perform ZERO network requests.
  let simFetchCalls = 0;
  (globalThis as any).fetch = () => {
    simFetchCalls += 1;
    throw new Error('simulator must never call fetch');
  };

  assertEqual(simulateDemoLifecycleAdvance(item.sosPackage.sosId, 'DELIVERED').ok, true, 'simulate DELIVERED');
  let fresh = refind(item.sosPackage.sosId)!;
  assertEqual(isSimulatedFinalStatus(fresh), true, 'simulated DELIVERED detected from persisted history');
  assertEqual(getDeliveryDisplayLabel(fresh), 'SIMULATED — DELIVERED', 'simulated delivered label shown');
  // "Refresh": re-read from localStorage — the simulated label must persist.
  fresh = refind(item.sosPackage.sosId)!;
  assertEqual(getDeliveryDisplayLabel(fresh), 'SIMULATED — DELIVERED', 'simulated label persists across refresh');

  assertEqual(simulateDemoLifecycleAdvance(item.sosPackage.sosId, 'ACKNOWLEDGED').ok, true, 'simulate ACKNOWLEDGED');
  fresh = refind(item.sosPackage.sosId)!;
  assertEqual(isSimulatedFinalStatus(fresh), true, 'simulated ACKNOWLEDGED detected from persisted history');
  assertEqual(
    getDeliveryDisplayLabel(fresh),
    'SIMULATED — RESPONDER ACKNOWLEDGED',
    'simulated acknowledged label shown'
  );
  fresh = refind(item.sosPackage.sosId)!;
  assertEqual(
    getDeliveryDisplayLabel(fresh),
    'SIMULATED — RESPONDER ACKNOWLEDGED',
    'simulated acknowledged label persists across refresh'
  );
  assertEqual(simFetchCalls, 0, 'simulator performed ZERO network requests');
}

// Real AUTHORIZED_API confirmations keep their exact legacy display behavior.
{
  clearPendingQueue();
  installBrowserStub({
    online: true,
    fetch: () =>
      Promise.resolve(
        mockResponse(200, {
          success: true,
          data: {
            success: true,
            status: 'ACKNOWLEDGED',
            referenceId: 'PR16-AUTH-1',
            timestamp: new Date().toISOString(),
            message: 'Authorized partner response',
            partnerId: 'authorized-test',
            partnerName: 'Authorized Rescue Network API',
            providerType: 'AUTHORIZED_API',
            deliveryConfirmed: true
          }
        })
      )
  });
  const item = createQueuedSOSItem({
    sosPackage: createSOSPackage({
      emergencyType: 'RESCUE',
      category: 'RESCUE',
      severity: 4,
      message: 'PR16 real delivery check',
      source: 'online'
    }),
    targetPartner: AUTHORIZED_PROVIDER,
    userConsentTimestamp: new Date().toISOString()
  });
  savePendingSOS(item);
  await transmitSingleSOSItem(item);
  const fresh = refind(item.sosPackage.sosId)!;
  assertEqual(fresh.status, 'DELIVERED', 'real deliveryConfirmed reaches DELIVERED');
  assertEqual(isSimulatedFinalStatus(fresh), false, 'real DELIVERED is not flagged simulated');
  assertEqual(getDeliveryDisplayLabel(fresh), 'DELIVERED', 'real DELIVERED label unchanged');
}

// HTTP 200 alone still does not imply delivery or acknowledgement.
{
  clearPendingQueue();
  installBrowserStub({
    online: true,
    fetch: () =>
      Promise.resolve(
        mockResponse(200, {
          success: true,
          data: {
            success: true,
            status: 'ACKNOWLEDGED',
            referenceId: 'PR16-HTTP-1',
            timestamp: new Date().toISOString(),
            message: 'Authorized partner response',
            partnerId: 'authorized-test',
            partnerName: 'Authorized Rescue Network API',
            providerType: 'AUTHORIZED_API'
          }
        })
      )
  });
  const item = createQueuedSOSItem({
    sosPackage: createSOSPackage({
      emergencyType: 'RESCUE',
      category: 'RESCUE',
      severity: 4,
      message: 'PR16 http-only check',
      source: 'online'
    }),
    targetPartner: AUTHORIZED_PROVIDER,
    userConsentTimestamp: new Date().toISOString()
  });
  savePendingSOS(item);
  await transmitSingleSOSItem(item);
  const fresh = refind(item.sosPackage.sosId)!;
  assertEqual(fresh.status, 'SENT', 'HTTP 200 without flags remains SENT');
  assert(!fresh.deliveredAt && !fresh.acknowledgedAt, 'no delivery/ack inferred from HTTP 200');
}

// UI surfaces render the simulated constants.
{
  const deliverySource = readRepoSource('../src/components/SOSDeliveryStatus.tsx');
  assert(deliverySource.includes('SIMULATED_DELIVERED_LABEL'), 'delivery card uses the simulated delivered label');
  assert(deliverySource.includes('SIMULATED_ACKNOWLEDGED_LABEL'), 'delivery card uses the simulated ack label');
  assert(deliverySource.includes('SIMULATED_DELIVERY_EXPLANATION'), 'delivery card shows the delivery explanation');
  assert(deliverySource.includes('SIMULATED_ACK_EXPLANATION'), 'delivery card shows the ack explanation');
  const modalSource = readRepoSource('../src/components/EmergencyPartnersManagerModal.tsx');
  assert(modalSource.includes('getDeliveryDisplayLabel'), 'queue manager uses the simulated display label');
  assert(modalSource.includes('SIMULATED_DELIVERY_EXPLANATION'), 'queue manager shows the delivery explanation');
  assert(modalSource.includes('SIMULATED_ACK_EXPLANATION'), 'queue manager shows the ack explanation');
}

// ---------------------------------------------------------------------------
// 3. Country-aware emergency numbers.
// ---------------------------------------------------------------------------
section('PR16 3 — country-aware emergency numbers (never invented, never universal)');

assertEqual(
  GENERIC_EMERGENCY_GUIDANCE,
  'Contact your local emergency services immediately.',
  'generic guidance sentence is exact'
);
assertEqual(
  EMERGENCY_NUMBER_NOT_CONFIGURED,
  'Emergency number not configured.',
  'not-configured notice is exact'
);

// Configured countries resolve to their directory numbers.
assertEqual(getCountryEmergencyNumber('US'), '911', 'US → 911');
assertEqual(getCountryEmergencyNumber('IN'), '112', 'IN → 112 (general emergency, not 108)');
assertEqual(getCountryEmergencyNumber('EU'), '112', 'EU → 112');
assertEqual(getCountryEmergencyNumber('GB'), '999', 'GB → 999');
assertEqual(getCountryEmergencyNumber('CA'), '911', 'CA → 911');
assertEqual(getCountryEmergencyNumber('AU'), '000', 'AU → 000');
assertEqual(getCountryEmergencyNumber('us'), '911', 'country lookup is case-insensitive');

// Unknown / unconfigured countries never yield an invented number.
assertEqual(getCountryEmergencyNumber('XX'), null, 'unknown country → null');
assertEqual(getCountryEmergencyNumber('JP'), null, 'unconfigured country → null');
assertEqual(getCountryEmergencyNumber('GLOBAL'), null, 'GLOBAL → null');
assertEqual(getCountryEmergencyNumber('ALL'), null, 'ALL → null');
assertEqual(getCountryEmergencyNumber(undefined), null, 'undefined → null');
assertEqual(getCountryEmergencyNumber(''), null, 'empty → null');
assertEqual(
  getEmergencyNumberDisplay('XX'),
  'Emergency number not configured.',
  'unknown country displays the not-configured notice'
);
assertEqual(
  getEmergencyNumberDisplay(undefined),
  'Emergency number not configured.',
  'missing country displays the not-configured notice'
);

// No universal multi-number fallback exists anywhere in the helper output.
for (const code of ['US', 'IN', 'EU', 'GB', 'CA', 'AU', 'XX', 'JP', 'GLOBAL', undefined]) {
  const display = getEmergencyNumberDisplay(code);
  assert(!display.includes('/'), `no universal "a / b" fallback for ${String(code)}: "${display}"`);
  assert(
    display !== '911' || code === 'US' || code === 'CA',
    `bare 911 shown only for its configured countries (got "${display}" for ${String(code)})`
  );
}

// Country-independent offline guidance carries the generic sentence only.
{
  const cardiac = classifyEmergencyOffline('heart attack, chest pain, need help now', undefined, 'English');
  const steps = (cardiac.visual_card as { action_steps: string[] }).action_steps;
  assert(steps.includes(GENERIC_EMERGENCY_GUIDANCE), 'offline classifier uses the generic guidance sentence');
  assert(
    steps.every((s) => !/[0-9]{3}\s*\/\s*[0-9]{3}/.test(s)),
    'offline classifier guidance contains no universal number combination'
  );
  for (const lang of ['ta', 'hi', 'te', 'kn', 'ml', 'bn', 'mr', 'es', 'fr']) {
    const t = translateEmergencyOffline('help', lang, 'MEDICAL', 5, 'Medical', 'en');
    assert(
      (t.translated_action_steps || []).some((s) => s.includes(GENERIC_EMERGENCY_GUIDANCE)),
      `${lang} phrasebook medical guidance carries the generic sentence`
    );
    assert(
      (t.translated_action_steps || []).every((s) => !s.includes('108 / 112') && !s.includes('911 / 112')),
      `${lang} phrasebook medical guidance has no hard-coded number combination`
    );
  }
}

// Source-level: no hard-coded universal combinations remain in guidance.
{
  const classifierSource = readRepoSource('../src/lib/offlineClassifier.ts');
  assert(!classifierSource.includes('911 / 112 / 108'), 'offlineClassifier has no 911 / 112 / 108 combination');
  const languagesSource = readRepoSource('../src/lib/languages.ts');
  assert(!languagesSource.includes('108 / 112'), 'phrasebooks have no 108 / 112 combination');
  assert(!languagesSource.includes('911 / 112'), 'phrasebooks have no 911 / 112 combination');
  assert(!languagesSource.includes('(15 / 112)'), 'phrasebooks have no 15 / 112 combination');
  assert(!languagesSource.includes('১০৮'), 'phrasebooks have no Bengali-numeral 108');
  assert(!languagesSource.includes('१०८'), 'phrasebooks have no Devanagari-numeral 108');
  assert(cardSource.includes('getEmergencyNumberDisplay'), 'SOS card renders the country-aware number display');
  assert(!cardSource.includes('(911 / EMS)'), 'SOS card radio header no longer hard-codes 911');
}

// ---------------------------------------------------------------------------
// 4. Partner configuration availability states.
// ---------------------------------------------------------------------------
section('PR16 4 — CONFIGURED / NOT_CONFIGURED / CONFIGURATION_UNAVAILABLE');

assertEqual(
  PARTNER_CONFIG_UNAVAILABLE_TEXT,
  'Emergency API configuration unavailable.',
  'unavailable text is exact'
);
assertEqual(
  PARTNER_NOT_CONFIGURED_TEXT,
  'Emergency API integration not configured for this country.',
  'not-configured text is exact'
);

// Server-side status derivation (pure, no secrets in output).
{
  const configured = getEmergencyPartnerConfig('US', {
    AUTHORIZED_PARTNER_API_URL: 'https://partner.example.com/dispatch',
    AUTHORIZED_PARTNER_API_KEY: 'super-secret-key'
  });
  assertEqual(configured.status, 'CONFIGURED', 'env with URL + key → CONFIGURED');
  const serialized = JSON.stringify(configured);
  assert(!serialized.includes('super-secret-key'), 'configured output exposes no API key');
  assert(!serialized.includes('partner.example.com'), 'configured output exposes no endpoint URL');
  assert(!serialized.includes('apiKey') && !serialized.includes('apiUrl'), 'configured output has no secret fields');

  const missing = getEmergencyPartnerConfig('IN', {});
  assertEqual(missing.status, 'NOT_CONFIGURED', 'env without credentials → NOT_CONFIGURED');
  assertEqual(missing.providerName, null, 'NOT_CONFIGURED carries no provider name');

  const partial = getEmergencyPartnerConfig('US', { AUTHORIZED_PARTNER_API_URL: 'https://x.example' });
  assertEqual(partial.status, 'NOT_CONFIGURED', 'URL without key is still NOT_CONFIGURED');
}

// Client lookup: success paths.
{
  installBrowserStub({
    online: true,
    fetch: () =>
      Promise.resolve(
        mockResponse(200, {
          success: true,
          data: { status: 'CONFIGURED', country: 'US', providerName: 'Authorized Rescue Network API' }
        })
      )
  });
  const result = await fetchPartnerConfigState('US');
  assertEqual(result.state, 'CONFIGURED', 'server CONFIGURED → CONFIGURED');
  assert(
    getPartnerConfigDisplayText(result).includes('configured for this country'),
    'CONFIGURED display text confirms configuration'
  );

  installBrowserStub({
    online: true,
    fetch: () =>
      Promise.resolve(mockResponse(200, { success: true, data: { status: 'NOT_CONFIGURED', country: 'IN' } }))
  });
  const notConfigured = await fetchPartnerConfigState('IN');
  assertEqual(notConfigured.state, 'NOT_CONFIGURED', 'server NOT_CONFIGURED → NOT_CONFIGURED');
  assertEqual(
    getPartnerConfigDisplayText(notConfigured),
    'Emergency API integration not configured for this country.',
    '"not configured" shown only when the server successfully reports it'
  );
}

// Client lookup: every failure mode yields CONFIGURATION_UNAVAILABLE (never
// "not configured").
{
  // HTTP 503.
  installBrowserStub({
    online: true,
    fetch: () => Promise.resolve(mockResponse(503, { success: false, code: 'PARTNER_CONFIG_UNAVAILABLE' }))
  });
  const unavailable503 = await fetchPartnerConfigState('US');
  assertEqual(unavailable503.state, 'CONFIGURATION_UNAVAILABLE', 'HTTP 503 → CONFIGURATION_UNAVAILABLE');
  assertEqual(
    getPartnerConfigDisplayText(unavailable503),
    'Emergency API configuration unavailable.',
    'HTTP 503 displays the unavailable notice (not "not configured")'
  );

  // Network failure.
  installBrowserStub({
    online: true,
    fetch: () => Promise.reject(new Error('socket hangup'))
  });
  assertEqual(
    (await fetchPartnerConfigState('US')).state,
    'CONFIGURATION_UNAVAILABLE',
    'network failure → CONFIGURATION_UNAVAILABLE'
  );

  // Timeout (abort-aware mock: rejects when the lookup's AbortController fires).
  installBrowserStub({
    online: true,
    fetch: (_url: string, init?: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
  });
  assertEqual(
    (await fetchPartnerConfigState('US', { timeoutMs: 20 })).state,
    'CONFIGURATION_UNAVAILABLE',
    'timeout → CONFIGURATION_UNAVAILABLE'
  );

  // Malformed success payloads.
  installBrowserStub({
    online: true,
    fetch: () => Promise.resolve(mockResponse(200, { success: true, data: {} }))
  });
  assertEqual(
    (await fetchPartnerConfigState('US')).state,
    'CONFIGURATION_UNAVAILABLE',
    'malformed payload (no status) → CONFIGURATION_UNAVAILABLE'
  );
  installBrowserStub({
    online: true,
    fetch: () => Promise.resolve(mockResponse(200, { success: true }))
  });
  assertEqual(
    (await fetchPartnerConfigState('US')).state,
    'CONFIGURATION_UNAVAILABLE',
    'malformed payload (no data) → CONFIGURATION_UNAVAILABLE'
  );

  // Offline: unavailable with ZERO network requests.
  let offlineFetchCalls = 0;
  installBrowserStub({
    online: false,
    fetch: () => {
      offlineFetchCalls += 1;
      return Promise.resolve(mockResponse(200, { success: true, data: { status: 'CONFIGURED' } }));
    }
  });
  assertEqual(
    (await fetchPartnerConfigState('US')).state,
    'CONFIGURATION_UNAVAILABLE',
    'offline → CONFIGURATION_UNAVAILABLE'
  );
  assertEqual(offlineFetchCalls, 0, 'offline lookup performs ZERO network requests');
}

// Server route + client surface wiring.
{
  assert(serverSource.includes("app.get('/api/emergency-partner/config'"), 'server exposes GET /api/emergency-partner/config');
  assert(serverSource.includes('PARTNER_CONFIG_UNAVAILABLE'), 'server maps lookup failures to 503 unavailable');
  const modalSource = readRepoSource('../src/components/EmergencyPartnersManagerModal.tsx');
  assert(modalSource.includes('fetchPartnerConfigState'), 'partner directory resolves live config status');
  assert(modalSource.includes('getPartnerConfigDisplayText'), 'partner directory renders the resolved status text');
  assert(
    !modalSource.includes('AUTHORIZED_PARTNER_API_KEY') && !modalSource.includes('AUTHORIZED_PARTNER_API_URL'),
    'partner directory references no endpoint credentials or secrets'
  );
}
