/**
 * PR #28 regression suite — the four user-reported defects.
 *
 *  1. TRANSLATION / ORIGINAL TEXT: the SOS card must show the person's OWN
 *     words in EVERY state — including before any translation exists. It used to
 *     show only the generated "DISPATCH ALERT ..." text in that state.
 *  2. EMERGENCY NUMBERS: every verified government number is publicly readable,
 *     with no country selection, no GPS/geolocation and no authentication.
 *  3. OFFLINE SEND TRUST: a not-yet-sent record states exactly what happens
 *     next, when it will be checked, and how to send it manually.
 *  4. ANDROID CHROME VOICE: covered by voice-android-lifecycle.test.ts.
 */
import { installDomHarness, installReactInputProbeEnvironment, wait } from './dom-harness.ts';
import { section, assert, assertEqual } from './helpers.ts';
import { listPublicEmergencyNumbers, getCountryEmergencyNumber } from '../src/lib/emergencyNumbers.ts';

// The library checks need localStorage/navigator, so a browser environment is
// installed for them and torn down again before the React suites.
const libEnv = installDomHarness();

// ---------------------------------------------------------------------------
// Library contracts.
// ---------------------------------------------------------------------------
section('Government emergency numbers are public data — no GPS, no auth');
{
  const entries = listPublicEmergencyNumbers();
  assert(entries.length > 0, 'the verified directory exposes public emergency numbers');
  const india = entries.filter((e) => e.country === 'IN');
  assert(india.length >= 2, 'India has more than one verified public number (112 and 108)');
  assert(
    india.some((e) => e.phone === '112') && india.some((e) => e.phone === '108'),
    'both 112 (all-services) and 108 (ambulance) are listed for India'
  );
  assert(entries.every((e) => typeof e.phone === 'string' && e.phone.trim() !== ''),
    'every listed entry carries a real phone number');
  assert(entries.every((e) => e.providerName.trim() !== '' && e.countryName.trim() !== ''),
    'every entry is labelled with its official provider and country');
  // Purity: the same list must come back with no country selected and no
  // geolocation available at all — the numbers never depend on location.
  const before = JSON.stringify(entries);
  const hadOwnGeo = Object.prototype.hasOwnProperty.call(globalThis.navigator, 'geolocation');
  const geoDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'geolocation');
  Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true });
  try {
    assertEqual(JSON.stringify(listPublicEmergencyNumbers()), before,
      'removing navigator.geolocation entirely does not change the list');
  } finally {
    if (hadOwnGeo && geoDescriptor) {
      Object.defineProperty(globalThis.navigator, 'geolocation', geoDescriptor);
    } else {
      try { delete (globalThis.navigator as any).geolocation; } catch { /* read-only */ }
    }
  }
  // Source-level proof: the number resolution never consults location at all.
  {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(new URL('../src/lib/emergencyNumbers.ts', import.meta.url), 'utf8');
    const numbersSrc = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/geolocation|getCurrentPosition|watchPosition|ipapi|ip-api/i.test(numbersSrc),
      'the emergency-number module never references geolocation or IP lookup');
    assert(!/apiKey|api_key|authorization|bearer|token/i.test(numbersSrc),
      'reading the emergency numbers requires no credential or authentication');
  }
  assertEqual(getCountryEmergencyNumber('IN'), '112', 'the promoted Indian number is 112');
  assertEqual(getCountryEmergencyNumber(null), null, 'an unknown country yields no invented number');
}

section('A saved SOS carries the translated original words into the queue');
{
  const { createSOSPackage, createQueuedSOSItem, savePendingSOS, getPendingQueue, clearPendingQueue } =
    await import('../src/lib/emergencyPartnerQueue.ts');
  const { LOCAL_ONLY_PROVIDER } = await import('../src/lib/emergencyPartnersData.ts');
  clearPendingQueue();

  const pkg = createSOSPackage({
    emergencyType: 'Structure fire',
    severity: 5,
    message: 'DISPATCH ALERT: Priority 5/5 - [FIRE] Structure fire.',
    source: 'offline',
    originalTranscript: 'என் வீட்டில் தீ பிடித்துள்ளது',
    detectedLanguage: { code: 'ta', name: 'Tamil' },
    translation: {
      targetLanguage: 'en',
      targetLanguageName: 'English',
      translatedMessage: 'There is a fire in my house'
    }
  });
  const item = createQueuedSOSItem({
    sosPackage: pkg,
    targetPartner: LOCAL_ONLY_PROVIDER,
    automaticRecovery: true,
    userConsentTimestamp: new Date().toISOString()
  });
  assertEqual(savePendingSOS(item), true, 'the record saves on this device');
  const stored = getPendingQueue().find((i) => i.sosPackage.sosId === pkg.sosId);
  assertEqual(stored?.sosPackage.originalTranscript, 'என் வீட்டில் தீ பிடித்துள்ளது',
    'the original-language words survive the round trip');
  assertEqual(stored?.sosPackage.translation?.translatedMessage, 'There is a fire in my house',
    'the translation of those exact words survives the round trip');
  assertEqual(stored?.sosPackage.translation?.targetLanguageName, 'English',
    'the target language is stored with the translation');
  clearPendingQueue();
}

libEnv.cleanup();

// ---------------------------------------------------------------------------
// Component rendering (jsdom + real React components).
// ---------------------------------------------------------------------------
let jsdomReady = true;
try {
  await import('jsdom');
} catch {
  jsdomReady = false;
}

if (!jsdomReady) {
  section('PR28 UI suite (jsdom missing)');
  assert(true, 'jsdom is not installed — UI rendering suite skipped (npm install)');
} else {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  installReactInputProbeEnvironment();

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { SOSCardView } = await import('../src/components/SOSCardView.tsx');
  const { PublicEmergencyNumbers } = await import('../src/components/PublicEmergencyNumbers.tsx');
  const { SOSDeliveryStatusCard } = await import('../src/components/SOSDeliveryStatus.tsx');

  const TAMIL = 'என் வீட்டில் தீ பிடித்துள்ளது';
  const GENERATED =
    'DISPATCH ALERT: Priority 5/5 - [FIRE] Structure fire. Required Assets: Fire unit. Action: Dispatch nearest units immediately.';

  const makeResult = (withTranslation: boolean): any => ({
    transcript: TAMIL,
    raw_transcript: TAMIL,
    emergency_category: 'FIRE',
    emergency_type: 'Structure fire',
    severity: 5,
    needs: ['Fire unit', 'Rescue team'],
    message: GENERATED,
    visual_card: {
      headline: 'STRUCTURE FIRE (PRIORITY 5)',
      badge_color: 'RED',
      action_steps: ['Evacuate immediately'],
      priority_symbol: 'ALERT_TRIANGLE',
      instructions_for_responders: 'Send fire unit',
      first_aid_actions: ['Move to open ground']
    },
    language: 'Tamil',
    detected_language: { code: 'ta', name: 'Tamil', confidence: 0.99 },
    source: 'offline_fallback',
    model_used: 'LifeLine Local Deterministic Triage Rules',
    timestamp: new Date().toISOString(),
    latency_ms: 4,
    ...(withTranslation
      ? {
          translation_status: 'ok',
          translation_error: null,
          translation: {
            detected_source_language: { code: 'ta', name: 'Tamil' },
            target_language: 'en',
            target_language_name: 'English',
            original_message: TAMIL,
            translated_message: 'There is a fire in my house',
            translated_headline: 'STRUCTURE FIRE',
            translated_action_steps: ['Evacuate immediately'],
            translated_instructions_for_responders: 'Send fire unit',
            translated_first_aid_actions: ['Move to open ground'],
            translated_needs: ['Fire unit'],
            category: 'FIRE',
            severity: 5,
            emergency_type: 'Structure fire',
            timestamp: new Date().toISOString(),
            source: 'offline_fallback',
            model_used: 'Bundled emergency phrasebook'
          }
        }
      : {})
  });

  const flush = async (ms: number) => {
    await act(async () => {
      await wait(ms);
    });
  };

  async function render(element: any, options?: { withClipboard?: boolean; harness?: any }) {
    const h = options?.harness || installDomHarness();
    if (options?.withClipboard !== false) {
      (h.window.navigator as any).clipboard = { writeText: async () => {} };
    }
    const root = createRoot(h.root);
    await act(async () => {
      root.render(element);
    });
    await flush(30);
    return {
      h,
      text: () => h.document.body.textContent || '',
      stop: async () => {
        await act(async () => {
          root.unmount();
        });
        if (!options?.harness) h.cleanup();
      }
    };
  }

  // -------------------------------------------------------------------------
  section('SOS card WITHOUT a translation still shows the person\'s own words');
  {
    const v = await render(
      React.createElement(SOSCardView, {
        result: makeResult(false),
        highContrast: false,
        soundEnabled: false,
        offlineMode: true
      })
    );
    const body = v.text();
    assert(body.includes(TAMIL), 'the original Tamil transmission is visible before any translation');
    assert(body.includes('Your original words'), 'the box is labelled as the person\'s own words');
    assert(body.includes('Responder transmission (generated'),
      'the generated dispatch text is clearly labelled as generated');
    assert(
      body.indexOf(TAMIL) < body.indexOf('Responder transmission'),
      'the original words are shown ABOVE the generated text'
    );
    assert(body.includes('Translate SOS'), 'the translate action is still offered');
    assert(
      Boolean(v.h.document.getElementById('original-transmission-always')),
      'the always-visible original transmission block is rendered'
    );
    assert(
      Boolean(v.h.document.getElementById('public-emergency-numbers')),
      'the public government numbers list is on the SOS card'
    );
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('SOS card WITH a translation shows both the translation and the original');
  {
    const v = await render(
      React.createElement(SOSCardView, {
        result: makeResult(true),
        highContrast: false,
        soundEnabled: false,
        offlineMode: true
      })
    );
    const body = v.text();
    assert(body.includes('There is a fire in my house'), 'the translation is visible');
    assert(body.includes(TAMIL), 'the original Tamil words remain visible next to it');
    assert(body.includes('Original Transmission (Tamil)'), 'the original box is labelled with its language');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('A legacy record with no original text is labelled, never silently swapped');
  {
    const legacy = makeResult(false);
    delete legacy.raw_transcript;
    delete legacy.transcript;
    const v = await render(
      React.createElement(SOSCardView, {
        result: legacy,
        highContrast: false,
        soundEnabled: false,
        offlineMode: true
      })
    );
    assert(
      v.text().includes('Original transmission not available'),
      'a record with no stored original says so instead of passing generated text off as the user\'s words'
    );
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Public emergency numbers render with no country selected');
  {
    const v = await render(React.createElement(PublicEmergencyNumbers, { defaultOpen: true }));
    const body = v.text();
    assert(body.includes('112'), 'the Indian/EU number 112 is listed');
    assert(body.includes('911'), 'the US/Canada number 911 is listed');
    assert(body.includes('No GPS or location needed to see these'),
      'the list states plainly that no location is used');
    assert(body.includes('No account, no partner authentication'),
      'the list states plainly that no sign-in is required');
    const links = Array.from(v.h.document.querySelectorAll('a[href^="tel:"]')) as any[];
    assert(links.length >= 5, 'every listed number is a tappable tel: link');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Not-yet-sent SOS states exactly what happens next');
  {
    const queueEnv = installDomHarness();
    const { createSOSPackage, createQueuedSOSItem, savePendingSOS, markWaitingForConnection, clearPendingQueue } =
      await import('../src/lib/emergencyPartnerQueue.ts');
    const { LOCAL_ONLY_PROVIDER } = await import('../src/lib/emergencyPartnersData.ts');
    clearPendingQueue();

    const pkg = createSOSPackage({
      emergencyType: 'Structure fire',
      severity: 5,
      message: GENERATED,
      source: 'offline',
      originalTranscript: TAMIL,
      detectedLanguage: { code: 'ta', name: 'Tamil' }
    });
    const item = createQueuedSOSItem({
      sosPackage: pkg,
      targetPartner: LOCAL_ONLY_PROVIDER,
      automaticRecovery: true,
      userConsentTimestamp: new Date().toISOString()
    });
    savePendingSOS(item);
    markWaitingForConnection(item, 'Device offline when the SOS was confirmed — stored, not sent.');

    let openedQueue = 0;
    const v = await render(
      React.createElement(SOSDeliveryStatusCard, {
        sosId: pkg.sosId,
        offlineMode: true,
        onOpenQueue: () => { openedQueue += 1; }
      }),
      { harness: queueEnv }
    );
    const body = v.text();
    const panel = v.h.document.getElementById('sos-what-happens-next');
    assert(Boolean(panel), 'the "what happens next" panel is rendered for an unsent record');
    assert(body.includes('nothing has been sent yet') || body.includes('Nothing has been sent yet'),
      'the panel states plainly that nothing has been sent');
    assert(body.includes('open and in the foreground'),
      'it states the real precondition that the page must be running');
    assert(body.includes('authorized partner destination'),
      'it states that a configured destination is required');
    assert(body.includes('GPS, photos and video are never sent automatically'),
      'it states what is never sent automatically');
    const btn = v.h.document.getElementById('sos-open-queue-btn');
    assert(Boolean(btn), 'a manual escape hatch button is offered');
    await act(async () => {
      btn.dispatchEvent(new v.h.window.MouseEvent('click', { bubbles: true }));
    });
    assertEqual(openedQueue, 1, 'the button opens the Pending SOS Queue');
    await v.stop();
    clearPendingQueue();
    queueEnv.cleanup();
  }

  // -------------------------------------------------------------------------
  section('Manual-send choice explains that nothing is ever sent automatically');
  {
    const queueEnv = installDomHarness();
    const { createSOSPackage, createQueuedSOSItem, savePendingSOS, clearPendingQueue } =
      await import('../src/lib/emergencyPartnerQueue.ts');
    const { LOCAL_ONLY_PROVIDER } = await import('../src/lib/emergencyPartnersData.ts');
    clearPendingQueue();
    const pkg = createSOSPackage({
      emergencyType: 'Medical',
      severity: 3,
      message: 'DISPATCH ALERT: Priority 3/5 - [MEDICAL] Medical.',
      source: 'offline'
    });
    const item = createQueuedSOSItem({
      sosPackage: pkg,
      targetPartner: LOCAL_ONLY_PROVIDER,
      automaticRecovery: false,
      userConsentTimestamp: new Date().toISOString()
    });
    savePendingSOS(item);

    const v = await render(
      React.createElement(SOSDeliveryStatusCard, { sosId: pkg.sosId, offlineMode: true }),
      { harness: queueEnv }
    );
    const body = v.text();
    assert(body.includes('will never send it on its own'),
      'the manual choice is stated unambiguously');
    assert(body.includes('SHARE VIA DEVICE'), 'the manual share path is named');
    await v.stop();
    clearPendingQueue();
    queueEnv.cleanup();
  }

  // -------------------------------------------------------------------------
  section('Offline consent offers two explicit choices with their consequences');
  {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/components/PartnerConsentModal.tsx', import.meta.url), 'utf8');
    assert(src.includes('SAVE + AUTO-SEND WHEN THE CONNECTION RETURNS'),
      'choice 1 is named for what it does');
    assert(src.includes('SAVE ON THIS DEVICE ONLY'), 'choice 2 is named for what it does');
    assert(src.includes('page is still open on this device and in the foreground'),
      'choice 1 lists the precondition that the app must be running');
    assert(src.includes('A real Internet connection is verified'),
      'choice 1 states that connectivity is verified, not assumed');
    assert(!src.includes('<input type="checkbox" checked={automaticRecovery}'),
      'the choice is no longer a single buried checkbox');
  }
}
