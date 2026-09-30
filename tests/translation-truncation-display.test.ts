/**
 * Translation follow-up — truncation budget + single failure display.
 *
 * 1. The online translation request now reserves 4096 tokens (was 2400), so
 *    long free-form transmissions no longer come back with
 *    `finish_reason === 'length'`. Truncation is still reported explicitly —
 *    the higher budget never weakens the failure contract.
 * 2. A failed online translation is shown ONCE: the specific reason appears
 *    once, and "original transmission preserved" appears once — both in the
 *    composed client message and in the rendered SOS card's explicit
 *    translation-unavailable state.
 *
 * The server implementation and the real React component are exercised
 * directly (only `fetch` is stubbed) — no source-string inspection of the
 * behaviour under test.
 */
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installBrowserStub } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import { resolveEmergencyTranslation, TRANSLATION_MAX_TOKENS } from '../server/translation.ts';
import {
  ORIGINAL_PRESERVED_SENTENCE,
  ensureOriginalPreservedNotice,
  formatTranslationUnavailableMessage,
  stripOriginalPreservedNotice
} from '../src/lib/translationSafety.ts';
import { SOSCardView } from '../src/components/SOSCardView.tsx';

installBrowserStub({ online: true });
const nativeFetch = (globalThis as any).fetch;

const EN_TEXT = 'Please help me, there is a fire.';
const TA_TEXT = 'தயவுசெய்து எனக்கு உதவுங்கள், தீ விபத்து ஏற்பட்டுள்ளது.';
const CONFIG = { apiKey: 'test-key', baseUri: 'https://upstream.test/v1', model: 'test/online-model' };

/** Exactly the client-facing text authored by the server for a truncation. */
const TRUNCATED_REASON = 'The online translation service returned an incomplete (truncated) response.';
const TRUNCATED_ERROR = `${TRUNCATED_REASON} ${ORIGINAL_PRESERVED_SENTENCE}`;

const count = (haystack: string, needle: string): number =>
  haystack.toLowerCase().split(needle.toLowerCase()).length - 1;

/** "original transmission preserved" / "original transmission is preserved". */
const preservedCount = (text: string): number =>
  (text.match(/original transmission (?:is )?preserved/gi) || []).length;

function validPayload(): string {
  return JSON.stringify({
    target_language: 'ta',
    target_language_name: 'Tamil',
    original_message: EN_TEXT,
    translated_message: TA_TEXT,
    translated_headline: 'தீ விபத்து',
    translated_action_steps: ['வெளியேறு'],
    translated_instructions_for_responders: 'காட்சியை மதிப்பிடு',
    translated_first_aid_actions: ['தண்ணீர் ஊற்று'],
    translated_needs: ['தீயணைப்பு வாகனம்']
  });
}

// ---------------------------------------------------------------------------
// A. The online translation budget is 4096 tokens.
// ---------------------------------------------------------------------------
section('Follow-up A — the online translation budget is 4096 tokens');

assertEqual(TRANSLATION_MAX_TOKENS, 4096, 'TRANSLATION_MAX_TOKENS is 4096 (raised from 2400)');

{
  const calls: any[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: validPayload() } }]
      }),
      text: async () => validPayload()
    };
  };

  const outcome = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta' }, CONFIG);
  assertEqual(outcome.kind, 'ok', 'the stubbed online translation succeeds');
  assertEqual(calls.length, 1, 'exactly one upstream request was made');

  const body = JSON.parse(calls[0].init.body);
  assertEqual(body.max_tokens, 4096, 'the real upstream request asks for 4096 max_tokens');
  assertEqual(body.max_tokens, TRANSLATION_MAX_TOKENS, 'the request uses the exported budget constant');

  // The higher budget never weakens the failure contract: a truncated
  // completion is still an explicit TRANSLATION_TRUNCATED error.
  (globalThis as any).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '{"translated_message":"x"}' } }]
    }),
    text: async () => ''
  });

  const truncated = await resolveEmergencyTranslation({ text: EN_TEXT, targetLanguage: 'ta' }, CONFIG);
  assert(truncated.kind === 'error', 'finish_reason=length is still an explicit translation error');
  if (truncated.kind === 'error') {
    assertEqual(truncated.code, 'TRANSLATION_TRUNCATED', 'the truncation code is unchanged');
    assertEqual(count(truncated.error, TRUNCATED_REASON), 1, 'the server failure states the truncation reason once');
    assertEqual(preservedCount(truncated.error), 1, 'the server failure states the guarantee once');
  }
}

// ---------------------------------------------------------------------------
// B. The composed failure message shows the failure exactly once.
// ---------------------------------------------------------------------------
section('Follow-up B — the composed translation failure is shown once');

{
  const composed = formatTranslationUnavailableMessage(TRUNCATED_ERROR);
  assertEqual(
    composed,
    `Translation unavailable — ${TRUNCATED_REASON} ${ORIGINAL_PRESERVED_SENTENCE}`,
    'the composed message is prefix + reason + guarantee'
  );
  assertEqual(count(composed, TRUNCATED_REASON), 1, 'the truncated-response message appears exactly once');
  assertEqual(preservedCount(composed), 1, '"original transmission preserved" appears exactly once');
  assertEqual(count(composed, 'Translation unavailable'), 1, '"Translation unavailable" appears exactly once');
  assertEqual(
    formatTranslationUnavailableMessage(composed),
    composed,
    'composing an already-composed message is idempotent (no repetition)'
  );

  // Server messages can already carry both the prefix and the guarantee.
  const alreadyComposed =
    'Translation unavailable — the translation engine returned content that failed safety validation (BAD). ' +
    'The original transmission is preserved.';
  assertEqual(
    preservedCount(formatTranslationUnavailableMessage(alreadyComposed)),
    1,
    'a server message that already carries the guarantee is not doubled'
  );
  assertEqual(
    count(formatTranslationUnavailableMessage(alreadyComposed), 'Translation unavailable'),
    1,
    'a server message that already carries the prefix is not doubled'
  );

  assertEqual(
    formatTranslationUnavailableMessage(''),
    `Translation unavailable — the online translation service did not return a usable translation. ${ORIGINAL_PRESERVED_SENTENCE}`,
    'an empty reason falls back to a single generic reason'
  );
}

// ---------------------------------------------------------------------------
// C. Preserve-notice helpers stay idempotent.
// ---------------------------------------------------------------------------
section('Follow-up C — preserve-notice helpers');

assertEqual(stripOriginalPreservedNotice(TRUNCATED_ERROR), TRUNCATED_REASON, 'the trailing guarantee is stripped');
assertEqual(
  stripOriginalPreservedNotice(`${TRUNCATED_ERROR} ${ORIGINAL_PRESERVED_SENTENCE}`),
  TRUNCATED_REASON,
  'repeated guarantee sentences are all stripped'
);
assertEqual(stripOriginalPreservedNotice(ORIGINAL_PRESERVED_SENTENCE), '', 'a bare guarantee sentence has no detail');
assertEqual(ensureOriginalPreservedNotice(TRUNCATED_REASON), TRUNCATED_ERROR, 'the guarantee is appended once');
assertEqual(ensureOriginalPreservedNotice(TRUNCATED_ERROR), TRUNCATED_ERROR, 'appending the guarantee is idempotent');

// ---------------------------------------------------------------------------
// D. The rendered SOS card shows the truncated failure once.
// ---------------------------------------------------------------------------
section('Follow-up D — the SOS card shows the truncated failure once');

{
  const baseResult: any = {
    language: 'English',
    transcript: EN_TEXT,
    raw_transcript: EN_TEXT,
    emergency_type: 'FIRE',
    emergency_category: 'FIRE',
    severity: 5,
    needs: ['Fire Engine'],
    message: 'DISPATCH ALERT: Priority 5/5 - [FIRE] Structure Fire.',
    visual_card: {
      headline: 'FIRE — Structure Fire',
      badge_color: 'RED',
      action_steps: ['Evacuate'],
      priority_symbol: 'FLAME',
      instructions_for_responders: 'Assess scene safety and vitals.',
      first_aid_actions: ['Cool the burn']
    },
    source: 'nebius_nemotron',
    model_used: 'test/online-model',
    timestamp: new Date().toISOString()
  };

  const render = (result: any) =>
    renderToStaticMarkup(
      React.createElement(SOSCardView as any, {
        result,
        highContrast: false,
        soundEnabled: false,
        onTranslateSOS: async () => {},
        isTranslating: false
      })
    );

  const truncatedHtml = render({
    ...baseResult,
    translation_status: 'error',
    translation_error: { code: 'TRANSLATION_TRUNCATED', error: TRUNCATED_ERROR }
  });

  assert(
    truncatedHtml.includes('translation-unavailable-state'),
    'the explicit translation-unavailable state is rendered for a truncated failure'
  );
  assertEqual(
    count(truncatedHtml, TRUNCATED_REASON),
    1,
    'the truncated-response message appears exactly once in the card'
  );
  assertEqual(
    preservedCount(truncatedHtml),
    1,
    '"original transmission preserved" appears exactly once in the card'
  );
  assertEqual(
    count(truncatedHtml, 'Translation unavailable'),
    1,
    'the translation-unavailable heading appears exactly once in the card'
  );

  // Offline/validation states keep their own single explicit message.
  const offlineHtml = render({
    ...baseResult,
    translation: {
      original_message: EN_TEXT,
      translated_message: '[TA faithful translation not available offline — original preserved]',
      target_language: 'ta',
      target_language_name: 'Tamil'
    },
    translation_status: 'ok',
    translation_error: null
  });
  assert(
    offlineHtml.includes('Translation unavailable offline — original transmission preserved.'),
    'the offline-unavailable state keeps its explicit single notice'
  );
  assertEqual(
    preservedCount(offlineHtml),
    1,
    'the offline-unavailable state states the guarantee exactly once'
  );
}

// ---------------------------------------------------------------------------
// E. The App failure banner composes through the shared helper.
// ---------------------------------------------------------------------------
section('Follow-up E — the App failure banner composes the failure once');

{
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert(
    app.includes('formatTranslationUnavailableMessage(result.translation_error.error)'),
    'the analysis-path banner composes the translation failure through the shared once-only helper'
  );
  assert(
    !app.includes('${result.translation_error.error} The original transmission is preserved.'),
    'the failure text is never concatenated with a second guarantee sentence'
  );
  assert(
    app.includes('formatTranslationUnavailableMessage(failureDetail)'),
    'the Translate-SOS path composes its failure through the shared once-only helper'
  );
}

// Restore the real fetch so later test files can talk to real servers.
(globalThis as any).fetch = nativeFetch;
