/**
 * BUG 2 regression tests — translated_message is a faithful translation of the
 * user's original message, never generated dispatch text (requirement D).
 *
 * Stubs the browser globals the queue lib needs (languages.ts only uses a few
 * pure functions, but importing the module graph is harmless).
 */
import { installBrowserStub } from './browser-stub.ts';
import { translateEmergencyOffline } from '../src/lib/languages.ts';
import { classifyEmergencyOffline } from '../src/lib/offlineClassifier.ts';
import { section, assert, assertEqual } from './helpers.ts';

installBrowserStub({ online: true });

// The generated dispatch text signature that MUST NOT leak into
// translated_message. Matches the old buggy construction.
const DISPATCH_MARKERS = [/DISPATCH ALERT/i, /Priority \d\/5/i, /Required Assistance/i];

function isDispatchText(text: string): boolean {
  return DISPATCH_MARKERS.some((re) => re.test(text));
}

section('BUG 2 — translated_message data contract (deterministic offline path)');

// en → es (curated phrase coverage).
{
  const t = translateEmergencyOffline('call an ambulance', 'es', 'MEDICAL', 5, 'Medical', 'en');
  assert(t.translated_message === 'llame a una ambulancia', `en→es phrase translation, got: "${t.translated_message}"`);
  assert(!isDispatchText(t.translated_message), 'en→es translated_message is NOT dispatch text');
  assert(t.original_message === 'call an ambulance', 'original_message is preserved verbatim');
}

// en → fr.
{
  const t = translateEmergencyOffline('there is a fire', 'fr', 'FIRE', 5, 'Fire', 'en');
  assertEqual(t.translated_message, 'il y a un incendie', `en→fr phrase translation, got: "${t.translated_message}"`);
  assert(!isDispatchText(t.translated_message), 'en→fr translated_message is NOT dispatch text');
}

// Same-language (idempotent): text unchanged, never dispatch text, even for hi→hi.
{
  const t = translateEmergencyOffline(
    'राजमार्ग पर दो गाड़ियों की भीषण टक्कर हुई है',
    'hi',
    'RESCUE',
    4,
    'Rescue',
    'hi'
  );
  assertEqual(t.translated_message, 'राजमार्ग पर दो गाड़ियों की भीषण टक्कर हुई है', 'hi→hi translated_message is the original text itself');
}

// No bundled free-text translation (en → ta): honest availability fallback,
// original text preserved, and NEVER the generated dispatch message.
{
  const source = 'My father has severe chest pain, please help';
  const t = translateEmergencyOffline(source, 'ta', 'MEDICAL', 5, 'Medical', 'en');
  assert(!isDispatchText(t.translated_message), `en→ta translated_message is NOT dispatch text, got: "${t.translated_message}"`);
  assert(t.translated_message.includes('faithful translation not available offline'), 'en→ta fallback carries explicit availability indication');
  assert(t.translated_message.includes(source), 'en→ta fallback preserves the original message text');
  assert(t.original_message === source, 'original_message preserved verbatim');
}

// The separate structured directive fields remain present and populated
// (do not remove useful emergency triage information).
{
  const t = translateEmergencyOffline('help me', 'ta', 'MEDICAL', 5, 'Medical', 'en');
  assert(typeof t.translated_headline === 'string' && t.translated_headline.length > 0, 'translated_headline is populated');
  assert(Array.isArray(t.translated_action_steps) && t.translated_action_steps.length > 0, 'translated_action_steps is populated');
  assert(typeof t.translated_instructions_for_responders === 'string' && t.translated_instructions_for_responders.length > 0, 'translated_instructions_for_responders is populated');
  assert(Array.isArray(t.translated_first_aid_actions) && t.translated_first_aid_actions.length > 0, 'translated_first_aid_actions is populated');
  assert(Array.isArray(t.translated_needs) && t.translated_needs.length > 0, 'translated_needs is populated');
  assertEqual(t.category, 'MEDICAL', 'category locked');
  assertEqual(t.severity, 5, 'severity locked');
  assertEqual(t.emergency_type, 'Medical', 'emergency_type locked');
}

section('BUG 2 — offline classifyEmergencyOffline translation preserves sourceText');

// The offline classifier passes the *generated dispatch message* into
// translateEmergencyOffline as originalMessage; but the data contract fix means
// even that input must never come back out with dispatch text for the
// translation — and translated_message itself is now an honest faithful-or-
// fallback string. Make sure the result shape is the isolated offline struct.
{
  const result = classifyEmergencyOffline(
    'There is a fire inside the building and people are trapped',
    undefined,
    'English',
    'ta'
  );
  const tm = result.translation?.translated_message;
  assert(typeof tm === 'string' && tm.length > 0, 'offline classifier produces a translation payload');
  assert(!isDispatchText(tm || ''), `offline translation is NOT the generated dispatch text, got: "${tm}"`);
  assert(result.emergency_category === 'FIRE', 'offline classifier category preserved');
}
