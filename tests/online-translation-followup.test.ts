/**
 * End-to-end browser flow for online triage and its independent translation.
 * Real App/SOSCardView are mounted in jsdom; only fetch is mocked. The tests
 * cover a stalled follow-up, a successful follow-up, explicit failure/no
 * offline substitution, and continued manual translation after that failure.
 */
import { installDomHarness, installReactInputProbeEnvironment, waitFor } from './dom-harness.ts';
import { mockResponse } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';

const ORIGINAL_TEXT = 'முதியவருக்கு கடுமையான நெஞ்சு வலி, இடது கைக்கு வலி பரவுகிறது. மூச்சுத் திணறல் அதிகமாக உள்ளது. உடனடியாக ஆம்புலன்ஸ் தேவை காப்பாத்துங்க.';
const TRANSLATED_TEXT = 'An elderly person has severe chest pain.';
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

function onlineTranslation() {
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

function partialOnlineTranslation() {
  return {
    ...onlineTranslation(),
    translation_status: 'partial',
    structured_translation_status: 'error',
    structured_translation_error: {
      code: 'TRANSLATION_TRUNCATED',
      error: 'Structured responder translation unavailable: the response was truncated. The original transmission and primary translated_message are preserved.'
    }
  };
}

async function mountApp(fetcher: (url: string, init?: any) => Promise<any>) {
  const previousFetch = (globalThis as any).fetch;
  const h = installDomHarness();
  Object.defineProperty(h.window.navigator, 'onLine', { configurable: true, value: true });
  (globalThis as any).fetch = fetcher;
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
  const submitTamilPreset = async () => {
    await click('skip-splash-btn');
    await click('preset-tamil-chest-pain');
    const input = h.document.getElementById('emergency-transcript-input');
    if (!input || input.value !== ORIGINAL_TEXT) {
      throw new Error('Tamil emergency preset was not populated');
    }
    await click('submit-emergency-analysis-btn');
  };
  const unmount = async () => {
    await act(async () => root.unmount());
    h.cleanup();
    if (previousFetch === undefined) delete (globalThis as any).fetch;
    else (globalThis as any).fetch = previousFetch;
  };

  return { h, click, submitTamilPreset, unmount };
}

section('Online SOS displays immediately while the follow-up translation is stalled');
{
  const requests: Array<{ url: string; body: any }> = [];
  let releaseTranslation!: (response: any) => void;
  const stalledTranslation = new Promise<any>((resolve) => { releaseTranslation = resolve; });
  const app = await mountApp(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, body });
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: onlineResult('flow-success-slow') });
    }
    if (url === '/api/translate-emergency') return stalledTranslation;
    throw new Error(`Unexpected request in App test: ${url}`);
  });

  try {
    await app.submitTamilPreset();
    let translationStarted = false;
    await act(async () => {
      translationStarted = await waitFor(
        () => requests.filter((request) => request.url === '/api/translate-emergency').length === 1,
        1500
      );
    });

    assert(translationStarted, 'successful online triage starts one separate /api/translate-emergency request');
    assertEqual(app.h.document.getElementById('visual-sos-card') !== null, true,
      'the online Nemotron SOS card is displayed before translation responds');
    assertEqual(app.h.document.getElementById('translate-sos-btn')?.textContent?.includes('Translating SOS...'), true,
      'the existing translation progress state is visible while the request is pending');
    assert((app.h.document.getElementById('original-transmission-always')?.textContent || '').includes(ORIGINAL_TEXT),
      'the original Tamil emergency transmission remains visible during follow-up');
    const translationRequest = requests.find((request) => request.url === '/api/translate-emergency');
    assertEqual(translationRequest?.body?.text, ORIGINAL_TEXT, 'only the user original is submitted for translation');
    assertEqual(translationRequest?.body?.offlineModeForce, false, 'online follow-up explicitly avoids offline substitution');

    // Re-render while the same follow-up is still pending. The request must not
    // be tied to a render/effect and must not be duplicated.
    await app.click('toggle-contrast-btn');
    assertEqual(requests.filter((request) => request.url === '/api/translate-emergency').length, 1,
      'an unrelated React re-render does not start another automatic translation');

    await act(async () => {
      releaseTranslation(mockResponse(200, { success: true, data: partialOnlineTranslation() }));
      await waitFor(() => (app.h.document.body.textContent || '').includes(TRANSLATED_TEXT), 1500);
    });
    assert((app.h.document.body.textContent || '').includes(TRANSLATED_TEXT),
      'successful primary follow-up updates the displayed result with translated_message');
    assertEqual(app.h.document.getElementById('translation-unavailable-state'), null,
      'partial primary success does not show the total-translation error state');
    assertEqual(app.h.document.getElementById('structured-translation-unavailable') !== null, true,
      'the card explicitly marks structured responder translation as unavailable');
    assert((app.h.document.body.textContent || '').includes(ORIGINAL_TEXT),
      'the original transmission remains visible with a partial translation');
  } finally {
    // If an assertion fails before the promise is resolved, release it so the
    // React tree can unmount cleanly without leaving a pending async handler.
    releaseTranslation(mockResponse(200, { success: true, data: onlineTranslation() }));
    await app.unmount();
  }
}

section('Online follow-up failure stays explicit and never substitutes offline translation');
{
  const requests: Array<{ url: string; body: any }> = [];
  const app = await mountApp(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, body });
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: onlineResult('flow-failure-manual-retry') });
    }
    if (url === '/api/translate-emergency' && requests.filter((r) => r.url === url).length === 1) {
      return mockResponse(502, {
        success: false,
        code: 'TRANSLATION_UPSTREAM_HTTP',
        error: 'Translation provider returned HTTP 500. The original transmission is preserved.'
      });
    }
    if (url === '/api/translate-emergency') {
      return mockResponse(200, { success: true, data: onlineTranslation() });
    }
    throw new Error(`Unexpected request in App test: ${url}`);
  });

  try {
    await app.submitTamilPreset();
    let failedStateShown = false;
    await act(async () => {
      failedStateShown = await waitFor(
        () => app.h.document.getElementById('translation-unavailable-state') !== null,
        1500
      );
    });

    assert(failedStateShown, 'online follow-up failure updates the result to an explicit translation error');
    assert((app.h.document.body.textContent || '').includes('Translation provider returned HTTP 500'),
      'the explicit translation error displays its failure reason');
    assert((app.h.document.getElementById('original-transmission-always')?.textContent || '').includes(ORIGINAL_TEXT),
      'the original transmission stays preserved after the online failure');
    assert(!(app.h.document.body.textContent || '').includes(TRANSLATED_TEXT),
      'no bundled/offline translation appears after the online request fails');
    assertEqual(requests.filter((request) => request.url === '/api/translate-emergency').length, 1,
      'the failed automatic request is not silently retried or substituted');
    assertEqual(requests.find((request) => request.url === '/api/translate-emergency')?.body?.offlineModeForce, false,
      'online failure path is explicitly marked as online');

    // The manual Translate SOS action remains available and can request a new
    // online attempt after the automatic follow-up has completed.
    await app.click('translate-sos-btn');
    let retried = false;
    await act(async () => {
      retried = await waitFor(
        () => requests.filter((request) => request.url === '/api/translate-emergency').length === 2 &&
          (app.h.document.body.textContent || '').includes(TRANSLATED_TEXT),
        1500
      );
    });
    assert(retried, 'manual Translate SOS continues to work after an automatic online failure');
    assertEqual(requests.filter((request) => request.url === '/api/translate-emergency').length, 2,
      'manual translation performs exactly one deliberate retry');
    assertEqual(app.h.document.getElementById('translation-unavailable-state'), null,
      'successful manual retry clears the prior translation error');
  } finally {
    await app.unmount();
  }
}
