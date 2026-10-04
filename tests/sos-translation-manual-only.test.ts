/**
 * SOS translation is a separate, user-initiated action.
 *
 * Two languages exist and they must never move together:
 *   1. TRIAGE language — chosen beside the microphone / text field. It is the
 *      language the emergency CARD is authored in (unchanged).
 *   2. SOS language — chosen on the card itself (the Translate SOS control). It
 *      is the language the person's own transmission is translated into.
 *
 * Why this file exists: the triage selection used to ALSO start a background
 * /api/translate-emergency follow-up the moment the triage response arrived, so
 * the transmission was translated without a click and the card's own language
 * selector was overwritten with the triage language. The translation now runs
 * only when the person taps "Translate SOS", with the card's own selection.
 *
 * These tests pin that separation over the REAL App/SOSCardView (jsdom) with
 * only fetch mocked:
 *   - triage alone issues no translation request, whatever language is chosen;
 *   - the card keeps its own, independent target language;
 *   - exactly one translation is requested per explicit tap, and an unrelated
 *     re-render never duplicates it;
 *   - a failed manual translation is explicit (never substituted offline) and
 *     can be retried deliberately.
 * The translation itself is unchanged: still produced by
 * POST /api/translate-emergency from the person's own words.
 */
import { installDomHarness, installReactInputProbeEnvironment, wait, waitFor } from './dom-harness.ts';
import { getPendingQueue } from '../src/lib/emergencyPartnerQueue.ts';
import { mockResponse } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';

const ORIGINAL_TEXT = 'முதியவருக்கு கடுமையான நெஞ்சு வலி, இடது கைக்கு வலி பரவுகிறது. மூச்சுத் திணறல் அதிகமாக உள்ளது. உடனடியாக ஆம்புலன்ஸ் தேவை காப்பாத்துங்க.';
const TRANSLATED_TEXT = 'An elderly person has severe chest pain.';
const TAMIL_TRANSLATED_TEXT = 'முதியவருக்கு கடுமையான நெஞ்சு வலி. உடனடியாக ஆம்புலன்ஸ் தேவை.';
const DISPATCH_TEXT = 'DISPATCH ALERT: Priority 5/5 - [MEDICAL] Immediate ambulance response required.';

// React DOM determines event support once at import time. Install the same
// script-enabled probe environment used by the repository's browser tests.
installReactInputProbeEnvironment();
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const App = (await import('../src/App.tsx')).default;

function onlineResult(timestamp: string) {
  return {
    language: 'Tamil',
    transcript: ORIGINAL_TEXT,
    emergency_type: 'MEDICAL',
    severity: 5,
    needs: ['Ambulance'],
    message: DISPATCH_TEXT,
    visual_card: {
      headline: 'MEDICAL EMERGENCY — CRITICAL',
      badge_color: 'RED',
      action_steps: ['Call an ambulance immediately'],
      priority_symbol: 'HEART_PULSE',
      instructions_for_responders: 'Emergency Category: MEDICAL (Priority 5/5).',
      first_aid_actions: ['Keep the person still']
    },
    emergency_category: 'MEDICAL',
    detected_language: { code: 'ta', name: 'Tamil' },
    source: 'nebius_nemotron',
    model_used: 'fixture/online-model',
    timestamp,
    raw_transcript: ORIGINAL_TEXT,
    nebius_connected: true,
    translation_status: 'none',
    translation_error: null
  };
}

function englishTranslation() {
  return {
    target_language: 'en',
    target_language_name: 'English',
    original_message: ORIGINAL_TEXT,
    translated_message: TRANSLATED_TEXT,
    translated_headline: 'Critical medical emergency',
    translated_action_steps: ['Call an ambulance immediately'],
    translated_instructions_for_responders: 'Emergency Category: MEDICAL (Priority 5/5).',
    translated_first_aid_actions: ['Keep the person still'],
    translated_needs: ['Ambulance'],
    category: 'MEDICAL',
    severity: 5,
    emergency_type: 'MEDICAL',
    timestamp: new Date().toISOString(),
    source: 'nebius_nemotron'
  };
}

function tamilTranslation() {
  return {
    ...englishTranslation(),
    target_language: 'ta',
    target_language_name: 'Tamil',
    translated_message: TAMIL_TRANSLATED_TEXT
  };
}

async function mountApp(fetcher: (url: string, init?: any) => Promise<any>) {
  const previousFetch = (globalThis as any).fetch;
  const requests: Array<{ url: string; body: any }> = [];
  const h = installDomHarness();
  Object.defineProperty(h.window.navigator, 'onLine', { configurable: true, value: true });
  // Every request the App makes is recorded before the fixture answers it.
  (globalThis as any).fetch = async (url: string, init?: any) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return fetcher(url, init);
  };
  const root = createRoot(h.root);
  await act(async () => {
    root.render(React.createElement(App));
  });

  const click = async (id: string) => {
    await act(async () => {
      const element = h.document.getElementById(id);
      if (!element) throw new Error(`Missing test UI element #${id}`);
      element.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
    });
  };
  const chooseLanguage = async (id: string, code: string) => {
    await act(async () => {
      const select = h.document.getElementById(id) as HTMLSelectElement | null;
      if (!select) throw new Error(`Missing test UI element #${id}`);
      select.value = code;
      select.dispatchEvent(new h.window.Event('change', { bubbles: true }));
    });
  };
  // Tamil speech/text with Hindi selected for TRIAGE: the two languages differ,
  // which is exactly the case that used to start the translation by itself.
  const submitTamilPresetWithTriageHindi = async () => {
    await click('skip-splash-btn');
    await chooseLanguage('target-emergency-language-select', 'hi');
    await click('preset-tamil-chest-pain');
    const input = h.document.getElementById('emergency-transcript-input');
    if (!input || input.value !== ORIGINAL_TEXT) {
      throw new Error('Tamil emergency preset was not populated');
    }
    await click('submit-emergency-analysis-btn');
  };
  const waitForCard = async () => {
    let shown = false;
    await act(async () => {
      shown = await waitFor(() => h.document.getElementById('visual-sos-card') !== null, 2000);
    });
    if (!shown) throw new Error('the SOS card never rendered');
  };
  const translationRequests = () => requests.filter((request) => request.url === '/api/translate-emergency');
  const unmount = async () => {
    await act(async () => root.unmount());
    h.cleanup();
    if (previousFetch === undefined) delete (globalThis as any).fetch;
    else (globalThis as any).fetch = previousFetch;
  };

  return { h, click, chooseLanguage, submitTamilPresetWithTriageHindi, waitForCard, translationRequests, requests, unmount };
}

section('Triage alone never starts an SOS translation, and the card keeps its own language');
{
  const app = await mountApp(async (url) => {
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: onlineResult('manual-only-no-auto') });
    }
    throw new Error(`Triage must not request a translation by itself: ${url}`);
  });

  try {
    await app.submitTamilPresetWithTriageHindi();
    await app.waitForCard();

    const analyzeRequest = app.requests.find((request) => request.url === '/api/analyze-emergency');
    assertEqual(analyzeRequest?.body?.targetLanguage, 'hi',
      'the triage language chosen in the voice / type panel is still sent with the triage request');
    assertEqual(
      (app.h.document.getElementById('target-emergency-language-select') as HTMLSelectElement)?.value,
      'hi',
      'the triage language selector keeps the language the person chose'
    );
    assertEqual(app.h.document.getElementById('visual-sos-card') !== null, true,
      'the triage card is displayed on its own, without any translation');

    // Give any background follow-up the same window the old behavior used.
    await act(async () => {
      await wait(150);
    });
    assertEqual(app.requests.filter((request) => request.url === '/api/translate-emergency').length, 0,
      'triaging never issues a translation request, whatever triage language is selected');

    assertEqual(app.h.document.getElementById('translation-unavailable-state'), null,
      'nothing is reported as failed — no translation was requested');
    const transmissionText = app.h.document.getElementById('dispatch-transmission-container')?.textContent || '';
    assert(!transmissionText.includes('Translated Transmission'),
      'no translated transmission block appears before the person asks for one');
    assert(transmissionText.includes(ORIGINAL_TEXT),
      'the person\'s own words stay visible while the transmission is untranslated');

    // The card's translation language is its own: it is not the triage language.
    const sosLanguage = (app.h.document.getElementById('sos-target-lang-select') as HTMLSelectElement)?.value;
    assertEqual(sosLanguage, 'en',
      'the card\'s SOS language stays independent from the triage language (which is "hi")');
  } finally {
    await app.unmount();
  }
}

section('Tapping Translate SOS translates once, in the card\'s own language');
{
  const app = await mountApp(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: onlineResult('manual-only-on-tap') });
    }
    if (url === '/api/translate-emergency') {
      return mockResponse(200, { success: true, data: body?.targetLanguage === 'ta' ? tamilTranslation() : englishTranslation() });
    }
    throw new Error(`Unexpected request in App test: ${url}`);
  });

  try {
    await app.submitTamilPresetWithTriageHindi();
    await app.waitForCard();
    assertEqual(app.translationRequests().length, 0, 'the card is rendered before any translation is requested');

    await app.click('translate-sos-btn');
    let translated = false;
    await act(async () => {
      translated = await waitFor(
        () => (app.h.document.getElementById('dispatch-transmission-container')?.textContent || '').includes(TRANSLATED_TEXT),
        2000
      );
    });

    const first = app.translationRequests()[0];
    assertEqual(app.translationRequests().length, 1, 'one explicit tap issues exactly one translation request');
    assertEqual(first?.body?.text, ORIGINAL_TEXT, 'only the person\'s original words are submitted for translation');
    assertEqual(first?.body?.targetLanguage, 'en',
      'the request uses the card\'s own SOS language, not the language selected for triage');
    assertEqual(first?.body?.offlineModeForce, false, 'an online translation is requested as online');
    assert(translated, 'the translated transmission is displayed after the tap');
    const afterText = app.h.document.getElementById('dispatch-transmission-container')?.textContent || '';
    assert(afterText.includes(ORIGINAL_TEXT), 'the original transmission stays visible next to the translation');

    // An unrelated re-render must never start or repeat a translation.
    await app.click('toggle-contrast-btn');
    await act(async () => {
      await wait(100);
    });
    assertEqual(app.translationRequests().length, 1,
      'an unrelated React re-render does not issue another translation');

    // The SOS language works separately from triage: pick another one and ask again.
    await app.chooseLanguage('sos-target-lang-select', 'ta');
    await app.click('translate-sos-btn');
    let retranslated = false;
    await act(async () => {
      retranslated = await waitFor(
        () => (app.h.document.getElementById('dispatch-transmission-container')?.textContent || '').includes(TAMIL_TRANSLATED_TEXT),
        2000
      );
    });
    const second = app.translationRequests()[1];
    assertEqual(app.translationRequests().length, 2, 'changing the SOS language and tapping again issues its own request');
    assertEqual(second?.body?.targetLanguage, 'ta', 'the second request uses the language chosen on the card');
    assert(retranslated, 'the translation for the newly chosen SOS language is displayed');
    assertEqual(
      (app.h.document.getElementById('target-emergency-language-select') as HTMLSelectElement)?.value,
      'hi',
      'translating the SOS never changes the language selected for triage'
    );
  } finally {
    await app.unmount();
  }
}

section('A failed manual translation stays explicit and never substitutes offline text');
{
  const seen: Array<{ url: string; body: any }> = [];
  const app = await mountApp(async (url, init) => {
    seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: onlineResult('manual-only-failure') });
    }
    if (url === '/api/translate-emergency') {
      // First deliberate attempt fails; the second (deliberate retry) succeeds.
      return seen.filter((request) => request.url === '/api/translate-emergency').length === 1
        ? mockResponse(502, {
            success: false,
            code: 'TRANSLATION_UPSTREAM_HTTP',
            error: 'Translation provider returned HTTP 500. The original transmission is preserved.'
          })
        : mockResponse(200, { success: true, data: englishTranslation() });
    }
    throw new Error(`Unexpected request in App test: ${url}`);
  });

  try {
    await app.submitTamilPresetWithTriageHindi();
    await app.waitForCard();
    await app.click('translate-sos-btn');
    let failedStateShown = false;
    await act(async () => {
      failedStateShown = await waitFor(
        () => app.h.document.getElementById('translation-unavailable-state') !== null,
        2000
      );
    });

    assert(failedStateShown, 'a failed manual translation is reported explicitly');
    assert((app.h.document.body.textContent || '').includes('Translation provider returned HTTP 500'),
      'the explicit failure shows its reason once');
    assert((app.h.document.getElementById('dispatch-transmission-container')?.textContent || '').includes(ORIGINAL_TEXT),
      'the original transmission stays preserved after the failure');
    const bodyText = app.h.document.body.textContent || '';
    assert(!bodyText.includes(TRANSLATED_TEXT),
      'no bundled/offline translation is substituted after the online request fails');
    assertEqual(app.translationRequests().length, 1, 'the failed request is not silently retried');

    await app.click('translate-sos-btn');
    let retried = false;
    await act(async () => {
      retried = await waitFor(
        () => app.translationRequests().length === 2 &&
          (app.h.document.body.textContent || '').includes(TRANSLATED_TEXT),
        2000
      );
    });
    assert(retried, 'a deliberate second tap retries and succeeds');
    assertEqual(app.h.document.getElementById('translation-unavailable-state'), null,
      'the successful retry clears the prior failure state');
  } finally {
    await app.unmount();
  }
}


// A card AUTHORED by triage in Hindi (the language chosen beside the microphone /
// text field), while the person actually spoke Tamil.
const HI_HEADLINE = 'गंभीर चिकित्सा आपातकाल (प्राथमिकता 5/5)';
const HI_STEP_1 = 'तुरंत आपातकालीन नंबर पर कॉल करें';

function hindiAuthoredResult(timestamp: string) {
  return {
    ...onlineResult(timestamp),
    visual_card_language: 'hi',
    visual_card: {
      headline: HI_HEADLINE,
      badge_color: 'RED',
      action_steps: [HI_STEP_1, 'दरवाजा खुला रखें', 'मरीज को न हिलाएँ'],
      priority_symbol: 'HEART_PULSE',
      instructions_for_responders: 'आपातकालीन चिकित्सा सहायता — प्राथमिकता 5/5.',
      first_aid_actions: ['श्वसन मार्ग खुला रखें']
    }
  };
}

// The translation of the SOS MESSAGE, with its own (different) structured
// fields — which must NOT replace the card.
const EN_TRANSLATED_HEADLINE = 'CRITICAL MEDICAL EMERGENCY';
const EN_TRANSLATED_STEP = 'Call an ambulance immediately';

function englishStructuredTranslation() {
  return {
    ...englishTranslation(),
    translated_headline: EN_TRANSLATED_HEADLINE,
    translated_action_steps: [EN_TRANSLATED_STEP],
    translated_instructions_for_responders: 'Emergency Category: MEDICAL (Priority 5/5).',
    translated_first_aid_actions: ['Keep the person still'],
    translated_needs: ['Ambulance']
  };
}

section('The card stays exactly as triaged — only the SOS message is translated');
{
  const app = await mountApp(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: hindiAuthoredResult('card-stays-triaged') });
    }
    if (url === '/api/translate-emergency') {
      assertEqual(body?.targetLanguage, 'en', 'the SOS message is requested in the language chosen on the card');
      return mockResponse(200, { success: true, data: englishStructuredTranslation() });
    }
    throw new Error(`Unexpected request in App test: ${url}`);
  });

  try {
    await app.submitTamilPresetWithTriageHindi();
    await app.waitForCard();
    const cardBefore = app.h.document.getElementById('visual-sos-card')?.textContent || '';
    assert(cardBefore.includes(HI_HEADLINE), 'the card is triaged in the selected language (Hindi)');

    await app.click('translate-sos-btn');
    let translated = false;
    await act(async () => {
      translated = await waitFor(
        () => (app.h.document.getElementById('dispatch-transmission-container')?.textContent || '').includes(TRANSLATED_TEXT),
        2000
      );
    });
    assert(translated, 'the SOS message is translated after the explicit tap');

    // The card: still exactly the triage output — Hindi, unchanged.
    const cardAfter = app.h.document.getElementById('visual-sos-card')?.textContent || '';
    assert(cardAfter.includes(HI_HEADLINE), 'the card headline stays in the triage language after translating');
    assert(cardAfter.includes(HI_STEP_1), 'the card action steps stay in the triage language after translating');
    assert(!cardAfter.includes(EN_TRANSLATED_HEADLINE),
      'the translated structured headline never replaces the card headline');
    assert(!cardAfter.includes(EN_TRANSLATED_STEP),
      'the translated structured steps never replace the card steps');

    // Only one thing changed: the SOS message below, next to the original words.
    const transmission = app.h.document.getElementById('dispatch-transmission-container')?.textContent || '';
    assert(transmission.includes(TRANSLATED_TEXT), 'the translated SOS message is shown');
    assert(transmission.includes(ORIGINAL_TEXT), 'the person\'s original words stay visible next to it');
    assert(transmission.includes('SOS message translated into') || (app.h.document.body.textContent || '').includes('SOS message translated into'),
      'the status states that only the SOS message was translated');
    assert((app.h.document.body.textContent || '').includes('Card unchanged'),
      'the status states that the card itself is unchanged');
    assertEqual(app.h.document.getElementById('sos-translation-status') !== null, true,
      'the SOS translation status bar is rendered');
  } finally {
    await app.unmount();
  }
}

section('The translated SOS message is what gets saved with the record');
{
  const app = await mountApp(async (url) => {
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: hindiAuthoredResult('saved-translation') });
    }
    if (url === '/api/translate-emergency') {
      return mockResponse(200, { success: true, data: englishStructuredTranslation() });
    }
    // Partner endpoints stay inert: this test only inspects the saved record.
    if (url.includes('/api/emergency-partner')) {
      return mockResponse(200, { success: true, data: { configured: false } });
    }
    throw new Error(`Unexpected request in App test: ${url}`);
  });

  try {
    await app.submitTamilPresetWithTriageHindi();
    await app.waitForCard();
    await app.click('translate-sos-btn');
    let translated = false;
    await act(async () => {
      translated = await waitFor(
        () => (app.h.document.getElementById('dispatch-transmission-container')?.textContent || '').includes(TRANSLATED_TEXT),
        2000
      );
    });
    assert(translated, 'the SOS message is translated before saving');

    await app.click('save-local-sos-btn');
    let consentShown = false;
    await act(async () => {
      consentShown = await waitFor(() => app.h.document.getElementById('consent-confirm-send-btn') !== null, 2000);
    });
    assert(consentShown, 'saving a real SOS still requires explicit confirmation');
    await app.click('consent-confirm-send-btn');
    let saved = false;
    await act(async () => {
      saved = await waitFor(() => getPendingQueue().length > 0, 2000);
      await wait(30);
    });
    assert(saved, 'the confirmed SOS record is stored locally');
    const record = getPendingQueue()[0]?.sosPackage;
    assertEqual(record?.originalTranscript, ORIGINAL_TEXT, 'the saved record keeps the person\'s own words verbatim');
    assertEqual(record?.message, TRANSLATED_TEXT,
      'the saved record carries the translated SOS message a responder can read');
    assertEqual(record?.translation?.translatedMessage, TRANSLATED_TEXT,
      'the saved record stores the translation next to the original for later reading');
    assertEqual(record?.translation?.targetLanguageName, 'English',
      'the saved record names the language the SOS message was translated into');
  } finally {
    await app.unmount();
  }
}

// The two scenarios the user asked to confirm, end to end:
//   A) triage language = English (panel), SOS translation = Tamil (card box)
//   B) the same triage output is kept while a DIFFERENT language is chosen for
//      the message — one Analyze, one tap, never a second triage run.
const TA_STRUCT_HEADLINE = 'கடுமையான மருத்துவ அவசரநிலை';
const TA_STRUCT_STEP = 'உடனடியாக ஆம்புலன்ஸ் அழைக்கவும்';

function tamilStructuredTranslation() {
  return {
    ...tamilTranslation(),
    translated_headline: TA_STRUCT_HEADLINE,
    translated_action_steps: [TA_STRUCT_STEP],
    translated_instructions_for_responders: 'மருத்துவ அவசரநிலை — முன்னுரிமை 5/5.',
    translated_first_aid_actions: ['நோயாளியை அசைக்க வேண்டாம்'],
    translated_needs: ['ஆம்புலன்ஸ்']
  };
}

section('English triage + any other SOS language: one triage, one tap, card unchanged');
{
  const app = await mountApp(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: onlineResult('english-triage-other-sos') });
    }
    if (url === '/api/translate-emergency') {
      assertEqual(body?.targetLanguage, 'ta', 'the SOS message is requested in the user-defined card language');
      return mockResponse(200, { success: true, data: tamilStructuredTranslation() });
    }
    throw new Error(`Unexpected request in App test: ${url}`);
  });

  try {
    // Triage language chosen ABOVE = English.
    await app.click('skip-splash-btn');
    await app.chooseLanguage('target-emergency-language-select', 'en');
    await app.click('preset-tamil-chest-pain');
    await app.click('submit-emergency-analysis-btn');
    await app.waitForCard();

    const cardBefore = app.h.document.getElementById('visual-sos-card')?.textContent || '';
    assert(cardBefore.includes('MEDICAL EMERGENCY — CRITICAL'), 'the card is triaged in the selected English panel language');
    assertEqual(app.requests.filter((r) => r.url === '/api/analyze-emergency').length, 1, 'exactly ONE triage request is made');
    assertEqual(app.translationRequests().length, 0, 'triaging alone still translates nothing');

    // The person chooses a DIFFERENT language for the SOS message on the card.
    await app.chooseLanguage('sos-target-lang-select', 'ta');
    await app.click('translate-sos-btn');
    let translated = false;
    await act(async () => {
      translated = await waitFor(
        () => (app.h.document.getElementById('dispatch-transmission-container')?.textContent || '').includes(TAMIL_TRANSLATED_TEXT),
        2000
      );
    });
    assert(translated, 'the SOS message is translated into the user-defined language on one tap');

    // The triage output is untouched, and triage is not run a second time.
    const cardAfter = app.h.document.getElementById('visual-sos-card')?.textContent || '';
    assert(cardAfter.includes('MEDICAL EMERGENCY — CRITICAL'), 'the English triage card is unchanged');
    assert(!cardAfter.includes(TA_STRUCT_HEADLINE), 'the Tamil structured headline never replaces the English card headline');
    assert(!cardAfter.includes(TA_STRUCT_STEP), 'the Tamil structured steps never replace the English card steps');
    assertEqual(app.requests.filter((r) => r.url === '/api/analyze-emergency').length, 1,
      'translating the SOS never re-runs triage (no two times)');
    assertEqual(app.translationRequests().length, 1, 'one tap issues exactly one translation');
    const transmission = app.h.document.getElementById('dispatch-transmission-container')?.textContent || '';
    assert(transmission.includes(ORIGINAL_TEXT), 'the person\'s original words stay beside the translated message');
    assert((app.h.document.body.textContent || '').includes('Card unchanged'),
      'the status confirms the card itself was not changed');
  } finally {
    await app.unmount();
  }
}
