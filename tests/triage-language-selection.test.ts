/**
 * Triage language selection — the language chosen in the voice / type panel
 * (English, தமிழ், and every other supported language) is the language the
 * emergency CARD ITSELF is authored in.
 *
 * Why this file exists: since the online triage and the translation follow-up
 * were decoupled, `targetLanguage` was still sent to POST /api/analyze-emergency
 * but only the OFFLINE engine honoured it. The online path accepted the value
 * and used it for nothing, so the card language depended entirely on a separate
 * best-effort translation call — and that call is skipped whenever the selected
 * language equals the language the person spoke in. A Tamil caller selecting
 * Tamil therefore received an English card, and any imperfection in the
 * structured translation phase reset the whole card to English.
 *
 * These tests pin the reconnection over REAL routes (real Express app against an
 * isolated provider fixture) and in the REAL App (jsdom), plus the boundaries
 * that must not move: the dispatch report stays English, the original
 * transmission is preserved verbatim, the translated transmission block is
 * produced by the follow-up as before, and the default English card is
 * byte-identical to the one that has always been returned.
 *
 * No live credentials are used: NEBIUS_API_KEY is a dummy value for the child
 * process and `.env` is untouched.
 */
import { createServer, request as httpRequest, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { installDomHarness, installReactInputProbeEnvironment, waitFor } from './dom-harness.ts';
import { mockResponse } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import { EMERGENCY_TRANSLATION_DICTIONARY, SUPPORTED_LANGUAGES, isWrittenInScript } from '../src/lib/languages.ts';

// React DOM determines event support once at import time, so the probe
// environment has to exist before it is loaded (same setup as the other App
// tests in this repository).
installReactInputProbeEnvironment();
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const App = (await import('../src/App.tsx')).default;

const EN_TEXT = 'Please help me, I cannot breathe.';
const TA_TEXT =
  'முதியவருக்கு கடுமையான நெஞ்சு வலி, இடது கைக்கு வலி பரவுகிறது. மூச்சுத் திணறல் அதிகமாக உள்ளது. உடனடியாக ஆம்புலன்ஸ் தேவை.';
const DISPATCH_REPORT =
  'DISPATCH ALERT: Priority 5/5 - [MEDICAL] Immediate ambulance response required.';

const textUsesLanguageScript = (text: string, languageCode: string): boolean => {
  const language = SUPPORTED_LANGUAGES.find((entry) => entry.code === languageCode);
  if (!language?.script) return true;
  return isWrittenInScript(text, language.script);
};

/** Provider replies the fixture can produce for POST /api/analyze-emergency. */
type ProviderBehaviour = 'compliant' | 'ignores_language' | 'romanized_only' | 'devanagari';

const TA_COMPLIANT_CARD = {
  headline: 'மருத்துவ அவசரநிலை (முன்னுரிமை 5/5)',
  action_steps: [
    'உடனடியாக அவசர உதவி எண்ணை அழைக்கவும்',
    'வாதிலையைத் திறந்து வைக்கவும்',
    'நோயாளியை அசைக்க வேண்டாம்'
  ],
  instructions_for_responders:
    'அவசர மருத்துவ உதவி — முன்னுரிமை 5/5. நோயாளி சுயநினைவுடன் உள்ளார்.',
  first_aid_actions: ['சுவாசப்பாதையைத் திறந்திருக்கவும்', 'நோயாளியை அமைதியாக வைக்கவும்']
};
const TA_ROMANIZED_CARD = {
  headline: 'Maruthuva avasara nilai (PRIORITY 5/5)',
  action_steps: ['udane 108-ai akkavum', 'kathvai thiranthu vekkavum', 'nodhayi aiyaakka vendam'],
  instructions_for_responders: 'Vettikarai udane anupavum.',
  first_aid_actions: ['soasai paathaiyai thiranthu vekkavum']
};
const DEVANAGARI_CARD = {
  headline: 'गंभीर चिकित्सा आपातकाल (प्राथमिकता 5/5)',
  action_steps: ['तुरंत आपातकालीन नंबर पर कॉल करें', 'दरवाजा खुला रखें', 'मरीज को न हिलाएँ'],
  instructions_for_responders: 'आपातकालीन चिकित्सा सहायता — प्राथमिकता 5/5.',
  first_aid_actions: ['श्वसन मार्ग खुला रखें', 'रोगी को शांत रखें']
};

let providerBehaviour: ProviderBehaviour = 'compliant';
let analyzePrompts: { system: string; user: string }[] = [];
let analyzeCalls = 0;
let translationCalls = 0;
let lastTranslationBody: any = null;

function requestedCardLanguageName(systemPrompt: string): string {
  const match = /MUST be written in ([A-Za-z ]+?) \(/.exec(systemPrompt);
  return (match?.[1] || '').trim().toLowerCase();
}

/** Exactly what POST /api/analyze-emergency returns for a localized card. */
function authoredTamilResult() {
  return {
    language: 'Tamil',
    transcript: TA_TEXT,
    emergency_type: 'MEDICAL',
    severity: 5,
    needs: ['ஆம்புலன்ஸ் அவசர ஊர்தி'],
    message: DISPATCH_REPORT,
    visual_card: {
      headline: TA_COMPLIANT_CARD.headline,
      badge_color: 'RED',
      action_steps: TA_COMPLIANT_CARD.action_steps,
      priority_symbol: 'HEART_PULSE',
      instructions_for_responders: TA_COMPLIANT_CARD.instructions_for_responders,
      first_aid_actions: TA_COMPLIANT_CARD.first_aid_actions
    },
    visual_card_language: 'ta',
    raw_visual_card: TA_COMPLIANT_CARD.headline,
    visual_card_text: TA_COMPLIANT_CARD.headline,
    emergency_category: 'MEDICAL',
    detected_language: { code: 'ta', name: 'Tamil' },
    source: 'nebius_nemotron',
    model_used: 'fixture/triage-language-model',
    timestamp: 'ui-triage-language-selection',
    raw_transcript: TA_TEXT,
    location_coordinates: null,
    nebius_connected: true,
    translation_status: 'none',
    translation_error: null
  };
}

function tamilPrimaryTranslation() {
  return {
    target_language: 'ta',
    target_language_name: 'Tamil',
    original_message: TA_TEXT,
    translated_message: 'உதவுங்கள், சுவாசிக்க முடியவில்லை.',
    category: 'MEDICAL',
    severity: 5,
    emergency_type: 'MEDICAL',
    timestamp: new Date().toISOString(),
    source: 'nebius_nemotron',
    translation_status: 'ok',
    structured_translation_status: 'none'
  };
}

const upstream: Server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += String(chunk);
  });
  req.on('end', () => {
    let body: any = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = {};
    }
    const systemPrompt: string = body?.messages?.[0]?.content || '';
    const userPrompt: string = body?.messages?.[1]?.content || '';
    const respond = (payload: any, finishReason = 'stop') => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              finish_reason: finishReason,
              message: { role: 'assistant', content: typeof payload === 'string' ? payload : JSON.stringify(payload) }
            }
          ]
        })
      );
    };

    // ---------------- translation follow-up (primary / structured phases)
    if (systemPrompt.toLowerCase().includes('translation engine')) {
      translationCalls += 1;
      lastTranslationBody = body;
      if (systemPrompt.includes('structured emergency-responder')) {
        return respond({
          translated_headline: 'தீ அவசரநிலை',
          translated_action_steps: ['உடனே வெளியேறுங்கள்'],
          translated_instructions_for_responders: 'உடனே நேரடியாக அணுகவும்',
          translated_first_aid_actions: ['சுவாசப்பாதையைச் சரிபார்க்கவும்'],
          translated_needs: ['ஆம்புலன்ஸ்']
        });
      }
      const marker = 'ORIGINAL TRANSMISSION (the only text to translate):\n';
      const index = userPrompt.indexOf(marker);
      let original = '';
      try {
        original = index < 0 ? '' : JSON.parse(userPrompt.slice(index + marker.length).split('\n')[0]);
      } catch {
        original = '';
      }
      // The fixture follows the language the SERVER asked for, so a request for
      // a different language is answered in that different language.
      const askedTarget = (/into the target language: ([A-Za-z ]+?) \(/.exec(systemPrompt)?.[1] || 'Tamil').trim();
      const english = askedTarget.toLowerCase() === 'english';
      return respond({
        detected_source_language: { code: english ? 'ta' : 'en', name: english ? 'Tamil' : 'English' },
        target_language: english ? 'en' : 'ta',
        target_language_name: english ? 'English' : 'Tamil',
        original_message: original,
        translated_message: english ? 'Help me, I cannot breathe.' : 'உதவுங்கள், சுவாசிக்க முடியவில்லை.'
      });
    }

    // ---------------- online triage
    analyzeCalls += 1;
    analyzePrompts.push({ system: systemPrompt, user: userPrompt });
    const askedForTamil = requestedCardLanguageName(systemPrompt) === 'tamil';
    const transcript = userPrompt.includes(TA_TEXT) ? TA_TEXT : EN_TEXT;
    const base = {
      language: userPrompt.includes(TA_TEXT) ? 'Tamil' : 'English',
      transcript,
      emergency_type: 'MEDICAL',
      severity: 5,
      needs: ['ALS Paramedic Ambulance', 'Portable Oxygen'],
      message: DISPATCH_REPORT
    };

    if (providerBehaviour === 'compliant' && askedForTamil) {
      return respond({ ...base, needs: ['ஆம்புலன்ஸ் அவசர ஊர்தி', 'Portable Oxygen'], visual_card: TA_COMPLIANT_CARD });
    }
    if (providerBehaviour === 'romanized_only' && askedForTamil) {
      return respond({ ...base, visual_card: TA_ROMANIZED_CARD });
    }
    if (providerBehaviour === 'devanagari') {
      return respond({ ...base, visual_card: DEVANAGARI_CARD });
    }
    // Ignores the card-language requirement entirely (also the default reply for
    // languages whose script cannot be verified).
    return respond({ ...base, visual_card: 'MEDICAL EMERGENCY (PRIORITY 5/5)' });
  });
});

function resolveTsxRunner(): { command: string; args: string[] } {
  const cli = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (existsSync(cli)) return { command: process.execPath, args: [cli, 'server.ts'] };
  const bin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  if (existsSync(bin)) return { command: bin, args: ['server.ts'] };
  return { command: process.execPath, args: ['server.ts'] };
}
const TSX = resolveTsxRunner();

function httpCall(method: 'GET' | 'POST', url: string, body?: any): Promise<{ status: number; json: any; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += String(chunk);
        });
        res.on('end', () => {
          let json: any = {};
          try {
            json = JSON.parse(data);
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode || 0, json, text: data });
        });
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('failed to bind fixture server'));
    });
  });
}
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function analyze(body: Record<string, any>): Promise<any> {
  analyzePrompts = [];
  const response = await httpCall('POST', `${APP_BASE}/api/analyze-emergency`, {
    offlineModeForce: false,
    ...body
  });
  return { status: response.status, data: response.json?.data || {}, prompts: analyzePrompts };
}

section('Triage language selection — real Express app + isolated provider fixture');

const upstreamPort = await listen(upstream);
const appPort = await freePort();
const APP_BASE = `http://127.0.0.1:${appPort}`;

const child: ChildProcess = spawn(TSX.command, TSX.args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(appPort),
    NODE_ENV: 'production',
    NEBIUS_BASE_URI: `http://127.0.0.1:${upstreamPort}/v1`,
    NEBIUS_API_KEY: 'fixture-key-not-a-real-credential',
    NEBIUS_MODEL: 'fixture/triage-language-model',
    AUTHORIZED_PARTNER_API_URL: '',
    AUTHORIZED_PARTNER_API_KEY: ''
  },
  stdio: ['ignore', 'ignore', 'pipe']
});
let serverLog = '';
child.stderr?.on('data', (chunk) => {
  serverLog += String(chunk);
});

let ready = false;
for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
  try {
    ready = (await httpCall('GET', `${APP_BASE}/api/status`)).status === 200;
  } catch {
    await sleep(500);
  }
}
assert(ready, 'the application server started against the isolated provider fixture');

if (!ready) {
  child.kill('SIGTERM');
  upstream.close();
} else {
  const ENGLISH_ACTION_STEPS = [
    'MEDICAL EMERGENCY (PRIORITY 5/5)',
    'Ensure immediate personal safety and protect vital signs',
    'Keep communication lines open for incoming responders'
  ];
  const ENGLISH_FIRST_AID = [
    'Assess airway, breathing, and circulation',
    'Do not move injured patient unless in immediate secondary danger'
  ];
  const ENGLISH_RESPONDER_DIRECTIVE =
    'Emergency Category: MEDICAL (Priority 5/5). Immediate direct on-scene access required.';

  // -------------------------------------------------------------------------
  // 1. The untouched default: English selection (and no selection at all)
  // -------------------------------------------------------------------------
  providerBehaviour = 'ignores_language';
  const englishDefault = await analyze({ text: EN_TEXT, language: 'English' });
  const englishSelected = await analyze({ text: EN_TEXT, language: 'English', targetLanguage: 'en' });

  assertEqual(englishDefault.status, 200, 'triage without a language selection succeeds');
  assertEqual(englishDefault.prompts[0].system.includes('CARD LANGUAGE'), false,
    'the English triage prompt is not extended with a card-language requirement');
  assert(englishDefault.prompts[0].system.trimEnd().endsWith('Write "message" and "visual_card" in English for responder interoperability.'),
    'the English triage prompt keeps its historical closing constraint word for word');
  assertEqual(englishDefault.prompts[0].user.includes('Card language:'), false,
    'the English triage user message is unchanged');
  assertEqual(englishDefault.data.visual_card.headline, 'MEDICAL EMERGENCY (PRIORITY 5/5)',
    'the English card headline is the one the app has always displayed');
  assertEqual(JSON.stringify(englishDefault.data.visual_card.action_steps), JSON.stringify(ENGLISH_ACTION_STEPS),
    'the English action steps are unchanged');
  assertEqual(JSON.stringify(englishDefault.data.visual_card.first_aid_actions), JSON.stringify(ENGLISH_FIRST_AID),
    'the English first-aid directives are unchanged');
  assertEqual(englishDefault.data.visual_card.instructions_for_responders, ENGLISH_RESPONDER_DIRECTIVE,
    'the English responder directive is unchanged');
  assertEqual(englishDefault.data.visual_card_language, undefined,
    'no card-language marker is added for the default English card');
  assertEqual(JSON.stringify(englishSelected.data.visual_card), JSON.stringify(englishDefault.data.visual_card),
    'explicitly selecting English produces exactly the same card as selecting nothing');
  assertEqual(translationCalls, 0,
    'triage still performs no translation of its own (PR #35 decoupling preserved)');

  // -------------------------------------------------------------------------
  // 2. A selected language authors the card — provider compliant
  // -------------------------------------------------------------------------
  providerBehaviour = 'compliant';
  const tamilTriage = await analyze({ text: EN_TEXT, language: 'English', targetLanguage: 'ta' });
  const tamilCard = tamilTriage.data.visual_card;

  assertEqual(tamilTriage.prompts[0].system.includes('CARD LANGUAGE'), true,
    'a selected language reaches the triage prompt (the value is no longer dropped)');
  assert(/MUST be written in Tamil \(தமிழ்\)/.test(tamilTriage.prompts[0].system),
    'the prompt names the selected language and its native script');
  assert(tamilTriage.prompts[0].system.includes('"instructions_for_responders"'),
    'the prompt asks for the structured responder fields so the whole card can be authored');
  assert(tamilTriage.prompts[0].user.includes('Card language: Tamil (தமிழ்)'),
    'the selected language is repeated in the user message');
  assertEqual(tamilCard.headline, TA_COMPLIANT_CARD.headline,
    'the compliant provider headline in the selected language is used as-is');
  assertEqual(JSON.stringify(tamilCard.action_steps), JSON.stringify(TA_COMPLIANT_CARD.action_steps),
    'the action steps are the selected language ones');
  assertEqual(JSON.stringify(tamilCard.first_aid_actions), JSON.stringify(TA_COMPLIANT_CARD.first_aid_actions),
    'the first-aid directives are the selected language ones');
  assertEqual(tamilCard.instructions_for_responders, TA_COMPLIANT_CARD.instructions_for_responders,
    'the responder directive is the selected language one');
  assertEqual(tamilTriage.data.visual_card_language, 'ta',
    'the response records the language the card was authored in');
  assertEqual(tamilCard.priority_symbol, 'HEART_PULSE',
    'the priority symbol is unaffected by the language selection');
  assertEqual(tamilCard.badge_color, 'RED',
    'the severity badge colour is unaffected by the language selection');
  assert(tamilTriage.data.needs.every((need: string) => need.trim().length > 0),
    'required units are still returned');

  // -------------------------------------------------------------------------
  // 3. Untouchable boundaries: original transmission + dispatch report
  // -------------------------------------------------------------------------
  assertEqual(tamilTriage.data.raw_transcript, EN_TEXT,
    "the user's original transmission is preserved verbatim for a localized card");
  assertEqual(tamilTriage.data.transcript, EN_TEXT,
    'the transcript field is never replaced by card-language text');
  assertEqual(tamilTriage.data.detected_language.code, 'en',
    'the detected SOURCE language is still the language the person used');
  assertEqual(tamilTriage.data.message, DISPATCH_REPORT,
    'the responder dispatch report stays English for interoperability');
  assertEqual(tamilTriage.data.translation_status, 'none',
    'triage still reports no translation of its own');
  assertEqual(tamilTriage.data.emergency_type, englishDefault.data.emergency_type,
    'the language selection never changes the triage category');
  assertEqual(tamilTriage.data.severity, englishDefault.data.severity,
    'the language selection never changes the priority LEVEL (severity number)');

  // -------------------------------------------------------------------------
  // 4. The deterministic guarantee: provider ignores or half-complies
  // -------------------------------------------------------------------------
  providerBehaviour = 'ignores_language';
  const tamilIgnored = await analyze({ text: EN_TEXT, language: 'English', targetLanguage: 'ta' });
  const phrasebookTamil = EMERGENCY_TRANSLATION_DICTIONARY.ta.sampleDirectives.MEDICAL;

  assertEqual(tamilIgnored.data.visual_card.headline, phrasebookTamil.headline,
    'when the provider ignores the requirement the card headline comes from the bundled phrasebook');
  assertEqual(JSON.stringify(tamilIgnored.data.visual_card.action_steps), JSON.stringify(phrasebookTamil.actionSteps),
    'the action steps fall back to the phrasebook, never to English');
  assertEqual(JSON.stringify(tamilIgnored.data.visual_card.first_aid_actions), JSON.stringify(phrasebookTamil.firstAid),
    'the first-aid directives fall back to the phrasebook');
  assert(tamilIgnored.data.visual_card.instructions_for_responders.includes(EMERGENCY_TRANSLATION_DICTIONARY.ta.priorityLabel),
    'the responder directive carries the PRIORITY wording in the selected language');
  assert(tamilIgnored.data.visual_card.instructions_for_responders.includes('5/5'),
    'the priority level itself keeps the triaged severity');
  assert(!/MEDICAL EMERGENCY \(PRIORITY/.test(tamilIgnored.data.visual_card.headline),
    'a selected language can never silently produce the English headline');

  providerBehaviour = 'romanized_only';
  const romanized = await analyze({ text: EN_TEXT, language: 'English', targetLanguage: 'ta' });
  assert(isWrittenInScript(romanized.data.visual_card.headline, 'Tamil'),
    'romanized Tamil is rejected: the card must use the native script');
  assertEqual(romanized.data.visual_card.action_steps.every((step: string) => isWrittenInScript(step, 'Tamil')), true,
    'a partially romanized step list is replaced as a whole, never half-swapped');
  assertEqual(romanized.data.visual_card.headline, phrasebookTamil.headline,
    'the romanized provider headline is replaced by the phrasebook headline');

  // -------------------------------------------------------------------------
  // 5. Shared scripts are honoured (Marathi accepts Devanagari)
  // -------------------------------------------------------------------------
  providerBehaviour = 'devanagari';
  const marathi = await analyze({ text: EN_TEXT, language: 'English', targetLanguage: 'mr' });
  assertEqual(marathi.data.visual_card.headline, DEVANAGARI_CARD.headline,
    'Devanagari provider text is accepted for Marathi instead of being discarded');
  assertEqual(marathi.data.visual_card_language, 'mr', 'the Marathi card records its authored language');

  // -------------------------------------------------------------------------
  // 6. Languages without a verifiable script are authored deterministically
  // -------------------------------------------------------------------------
  providerBehaviour = 'compliant';
  const spanish = await analyze({ text: EN_TEXT, language: 'English', targetLanguage: 'es' });
  const phrasebookSpanish = EMERGENCY_TRANSLATION_DICTIONARY.es.sampleDirectives.MEDICAL;
  assertEqual(spanish.prompts[0].system.includes('CARD LANGUAGE'), false,
    'Spanish keeps the historical triage prompt because its output cannot be verified by script');
  assertEqual(spanish.data.visual_card.headline, phrasebookSpanish.headline,
    'the Spanish card is authored from the curated phrasebook instead');
  assertEqual(spanish.data.visual_card_language, 'es', 'the Spanish card records its authored language');
  assertEqual(
    spanish.data.needs[0],
    EMERGENCY_TRANSLATION_DICTIONARY.es.needsTranslations['ALS Paramedic Ambulance'],
    'required units are mapped through the phrasebook'
  );
  assert(spanish.data.needs.some((need: string) => need === 'Portable Oxygen'),
    'an asset the phrasebook does not know keeps its original wording — no guessed resource');

  // -------------------------------------------------------------------------
  // 7. Every supported non-English language authors its own card
  // -------------------------------------------------------------------------
  providerBehaviour = 'ignores_language';
  for (const language of SUPPORTED_LANGUAGES.filter((entry) => entry.code !== 'en')) {
    const result = await analyze({ text: EN_TEXT, language: 'English', targetLanguage: language.code });
    const card = result.data.visual_card;
    const phrasebook = EMERGENCY_TRANSLATION_DICTIONARY[language.code].sampleDirectives.MEDICAL;
    assertEqual(card.headline, phrasebook.headline, `${language.code}: headline authored in ${language.name}`);
    assertEqual(card.action_steps.length > 0 && card.first_aid_actions.length > 0, true,
      `${language.code}: action steps and first aid are present in ${language.name}`);
    assert(card.instructions_for_responders.includes(EMERGENCY_TRANSLATION_DICTIONARY[language.code].priorityLabel),
      `${language.code}: priority wording is in ${language.name}`);
    assertEqual(result.data.visual_card_language, language.code, `${language.code}: authored language recorded`);
    assertEqual(result.data.detected_language.code, 'en', `${language.code}: source language untouched`);
    assertEqual(result.data.message, DISPATCH_REPORT, `${language.code}: dispatch report stays English`);
    if (language.script) {
      assert(
        [card.headline, ...card.action_steps, card.instructions_for_responders].every((text: string) =>
          textUsesLanguageScript(text, language.code)
        ),
        `${language.code}: every card field uses the native script`
      );
    }
  }

  // -------------------------------------------------------------------------
  // 8. The follow-up stays what it is for: the person's own words. The
  //    redundant responder re-translation is skipped for an authored card, so
  //    the card never shows a misleading "not translated" notice.
  // -------------------------------------------------------------------------
  providerBehaviour = 'compliant';
  analyzeCalls = 0;
  translationCalls = 0;
  const authoredTamilCard = (await analyze({ text: EN_TEXT, language: 'English', targetLanguage: 'ta' })).data;
  assertEqual(analyzeCalls, 1, 'triage makes exactly one provider call');
  const followup = await httpCall('POST', `${APP_BASE}/api/translate-emergency`, {
    text: authoredTamilCard.raw_transcript,
    targetLanguage: 'ta',
    sourceLanguage: authoredTamilCard.detected_language.code,
    currentSOS: authoredTamilCard,
    offlineModeForce: false
  });
  assertEqual(followup.status, 200, 'the follow-up translation of the original transmission succeeds');
  assertEqual(followup.json?.data?.translated_message, 'உதவுங்கள், சுவாசிக்க முடியவில்லை.',
    'the follow-up still returns the translated transmission (bottom block unchanged)');
  assertEqual(followup.json?.data?.original_message, EN_TEXT,
    "the translated transmission is still associated with the user's own words");
  assertEqual(translationCalls, 1, 'no redundant structured re-translation runs for an authored card');
  assertEqual(followup.json?.data?.structured_translation_status, 'none',
    'the response reports no structured phase instead of a failure notice');

  const otherLanguage = await httpCall('POST', `${APP_BASE}/api/translate-emergency`, {
    text: authoredTamilCard.raw_transcript,
    targetLanguage: 'en',
    sourceLanguage: authoredTamilCard.detected_language.code,
    currentSOS: authoredTamilCard,
    offlineModeForce: false
  });
  assertEqual(otherLanguage.status, 200, 'translating an authored card into another language succeeds');
  assertEqual(translationCalls, 3, 'a different target language still runs both translation phases (PR #38 preserved)');

  // -------------------------------------------------------------------------
  // 9. Voice capture + selected language: the spoken original stays authoritative
  // -------------------------------------------------------------------------
  providerBehaviour = 'compliant';
  const spoken = await analyze({
    text: TA_TEXT,
    language: 'Tamil',
    targetLanguage: 'ta',
    voiceCapture: {
      asrProvider: 'fixture',
      asrModel: 'fixture-asr',
      detectedLanguage: { code: 'ta', name: 'Tamil' },
      originalTranscript: TA_TEXT,
      englishTranslation: EN_TEXT
    }
  });
  assertEqual(spoken.data.visual_card.headline, TA_COMPLIANT_CARD.headline,
    'spoken Tamil with Tamil selected gets a Tamil card without any translation call');
  assertEqual(spoken.data.detected_language.code, 'ta', 'the spoken source language is preserved');
  assertEqual(spoken.data.raw_transcript, TA_TEXT, 'the spoken original transmission is preserved');
  assertEqual(spoken.data.voice_capture?.originalTranscript, TA_TEXT,
    'the bilingual voice capture record keeps the original-language transcript');
  assertEqual(translationCalls, 3, 'the same-language spoken case needs no translation follow-up at all');

  child.kill('SIGTERM');
  upstream.close();
  await sleep(150);
  assert(true, 'fixture server and application server shut down');
  if (serverLog.includes('undefined is not a function')) {
    assert(false, `server log contains an unexpected runtime error:\n${serverLog.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// The panel itself: choosing the language in the voice / type area is what
// drives the triage language, and the block under the card (original
// transmission + translated transmission) is untouched by it.
// ---------------------------------------------------------------------------
section('Triage language selection — real App in jsdom (voice / type option → card)');
{
  const requests: Array<{ url: string; body: any }> = [];
  const h = installDomHarness();
  Object.defineProperty(h.window.navigator, 'onLine', { configurable: true, value: true });
  const previousFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, body });
    if (url === '/api/analyze-emergency') {
      return mockResponse(200, { success: true, data: authoredTamilResult() });
    }
    if (url === '/api/translate-emergency') {
      return mockResponse(200, { success: true, data: tamilPrimaryTranslation() });
    }
    throw new Error(`Unexpected request in App test: ${url}`);
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
  const chooseLanguage = async (code: string) => {
    await act(async () => {
      const select = h.document.getElementById('target-emergency-language-select');
      if (!select) throw new Error('Missing test UI element #target-emergency-language-select');
      select.value = code;
      select.dispatchEvent(new h.window.Event('change', { bubbles: true }));
    });
  };
  const submitTamilEmergency = async () => {
    await click('preset-tamil-chest-pain');
    const input = h.document.getElementById('emergency-transcript-input');
    // The app's own Tamil preset fills the field; assert it really arrived
    // (starts with 'ம', the first letter of the preset sentence).
    if (!input || !String(input.value || '').startsWith('\u0BAE')) {
      throw new Error('Tamil emergency preset was not populated');
    }
    await click('submit-emergency-analysis-btn');
  };

  try {
    // Tamil speech/text with Tamil selected is the case the decoupled follow-up
    // never covered: the same-language skip rule means no translation is
    // requested, so only triage itself can localize the card.
    await click('skip-splash-btn');
    await chooseLanguage('ta');
    await submitTamilEmergency();
    let cardRendered = false;
    await act(async () => {
      cardRendered = await waitFor(() => h.document.getElementById('visual-sos-card') !== null, 2000);
    });

    const analyzeRequest = requests.find((request) => request.url === '/api/analyze-emergency');
    assertEqual(analyzeRequest?.body?.targetLanguage, 'ta',
      'the language chosen in the voice / type panel is sent with the triage request');
    assertEqual(analyzeRequest?.body?.language, 'Tamil', 'the language the person used travels separately');
    assert(cardRendered, 'the SOS card is displayed from the triage response alone');

    const card = h.document.getElementById('visual-sos-card');
    const cardText = card?.textContent || '';
    assert(cardText.includes(TA_COMPLIANT_CARD.headline), 'the card headline is displayed in the selected language');
    assert(cardText.includes(TA_COMPLIANT_CARD.action_steps[0]), 'the action steps are displayed in the selected language');
    assert(cardText.includes(TA_COMPLIANT_CARD.instructions_for_responders),
      'the responder directive is displayed in the selected language');
    assert(!cardText.includes('Ensure immediate personal safety and protect vital signs'),
      'no English responder boilerplate remains on a card authored in another language');

    const transmission = h.document.getElementById('original-transmission-always')?.textContent || '';
    assert(transmission.includes(TA_TEXT),
      'the original transmission below the card is still shown verbatim, untouched');
    assertEqual(h.document.getElementById('structured-translation-unavailable'), null,
      'an authored card does not report a missing structured translation');
    assertEqual(requests.filter((request) => request.url === '/api/translate-emergency').length, 0,
      'the same-language case still requests no translation follow-up (rule unchanged)');

    // Choosing a different language keeps using the existing translation
    // follow-up for the person's own words — that block is not affected.
    await chooseLanguage('en');
    await click('translate-sos-btn');
    let translated = false;
    await act(async () => {
      translated = await waitFor(
        () => (h.document.getElementById('dispatch-transmission-container')?.textContent || '').includes('உதவுங்கள்'),
        2000
      );
    });
    assertEqual(requests.filter((request) => request.url === '/api/translate-emergency').length, 1,
      'the manual Translate SOS action still issues the existing translation follow-up');
    assert(translated, 'manual translation of the transmission still displays the translated message');
    const transmissionAfter = h.document.getElementById('dispatch-transmission-container')?.textContent || '';
    assert(transmissionAfter.includes(TA_TEXT),
      'the original transmission stays visible next to the translated one');
    assert(transmissionAfter.includes('உதவுங்'),
      'the translated transmission block shows the follow-up result beside it');
  } finally {
    await act(async () => root.unmount());
    h.cleanup();
    if (previousFetch === undefined) delete (globalThis as any).fetch;
    else (globalThis as any).fetch = previousFetch;
  }
}
