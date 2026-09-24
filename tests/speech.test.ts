/**
 * Real-time multilingual speech: the microphone must speak answers in the
 * heard language, not leave a typed-only English box, and must never invent
 * an emergency number.
 */
import { getSpeechRecognitionLocale } from '../src/lib/languages.ts';
import {
  buildSpokenEmergencyBrief,
  pickStartLanguage,
  resolveSpeechLocale,
  shouldSwitchRecognitionLanguage,
  spokenPhrase
} from '../src/lib/speech.ts';
import { section, assert, assertEqual } from './helpers.ts';

section('Speech locale follows the heard language, not a forced English tag');
assertEqual(resolveSpeechLocale('ta'), 'ta-IN', 'Tamil code speaks as ta-IN');
assertEqual(resolveSpeechLocale('Tamil'), 'ta-IN', 'Tamil name speaks as ta-IN');
assertEqual(resolveSpeechLocale('ta-IN'), 'ta-IN', 'BCP-47 Tamil tag is preserved');
assertEqual(resolveSpeechLocale('hi'), 'hi-IN', 'Hindi speaks as hi-IN');
assertEqual(resolveSpeechLocale('es'), 'es-ES', 'Spanish speaks as es-ES');
assertEqual(resolveSpeechLocale('fr'), 'fr-FR', 'French speaks as fr-FR');
assertEqual(getSpeechRecognitionLocale('ml'), 'ml-IN', 'Malayalam recognizer locale');

section('Any-language start hint');
assertEqual(pickStartLanguage('ta', ['en-US']), 'ta', 'explicit Tamil selection wins over an English device');
assertEqual(pickStartLanguage('en', ['ta-IN', 'en-US']), 'ta', 'device Tamil is the any-language hint when the app is still on English');
assertEqual(pickStartLanguage('en', ['en-US']), 'en', 'English device with no other hint stays English');
assertEqual(pickStartLanguage(undefined, []), 'en', 'no hint defaults to English without crashing');

section('Live recognizer retarget');
assertEqual(
  shouldSwitchRecognitionLanguage('en', 'முதியவருக்கு கடுமையான நெஞ்சு வலி காப்பாத்துங்க'),
  'ta',
  'Tamil speech retargets an English recognizer immediately'
);
assertEqual(
  shouldSwitchRecognitionLanguage('en', 'राजमार्ग पर मदद भेजो'),
  'hi',
  'Hindi speech retargets live'
);
assertEqual(
  shouldSwitchRecognitionLanguage('ta', 'chest pain and shortness of breath'),
  null,
  'weak Latin text does not yank a Tamil session back to English'
);
assertEqual(
  shouldSwitchRecognitionLanguage('en', 'முதியவருக்கு நெஞ்சு வலி', 'fr'),
  null,
  'a locked language chip is not overridden'
);

section('Spoken answer is in the heard language, not a typed English card');
const tamil = buildSpokenEmergencyBrief({ languageCode: 'ta', category: 'MEDICAL', severity: 5 });
assert(/[\u0B80-\u0BFF]/.test(tamil), 'Tamil answer contains Tamil script');
assert(!tamil.includes('Contact your local emergency services immediately'), 'English gloss is not spoken over Tamil');
assert(tamil.includes('5'), 'severity is spoken');

const spanish = buildSpokenEmergencyBrief({ languageCode: 'es', category: 'FIRE', severity: 4 });
assert(spanish.includes('Ayuda de emergencia'), 'Spanish answer starts in Spanish');
assert(!spanish.includes('911 / 112 / 108'), 'no invented universal emergency-number combination');

const french = buildSpokenEmergencyBrief({ languageCode: 'French', category: 'RESCUE', severity: 4 });
assert(french.includes("Aide d'urgence"), 'French name resolves and is spoken in French');

section('Configured number only — never invented');
const withNumber = buildSpokenEmergencyBrief({
  languageCode: 'hi',
  category: 'MEDICAL',
  severity: 5,
  emergencyNumber: '112'
});
assert(withNumber.includes('112'), 'a configured number is spoken');
assert(/[\u0900-\u097F]/.test(withNumber), 'Hindi answer stays in Hindi around that number');

const bare = buildSpokenEmergencyBrief({ languageCode: 'en', category: 'MEDICAL', severity: 3 });
assert(!bare.includes('911'), 'English answer does not invent 911');
assert(!bare.includes('108'), 'English answer does not invent 108');
assertEqual(
  buildSpokenEmergencyBrief({ languageCode: 'en', category: 'MEDICAL', severity: 3, emergencyNumber: 'call now' }).includes('call now'),
  false,
  'non-numeric text is not spoken as an emergency number'
);

section('Parenthetical English is stripped from spoken phrases');
assertEqual(
  spokenPhrase('உடனடியாக தொடர்பு கொள்ளுங்கள் (Contact your local emergency services immediately.)'),
  'உடனடியாக தொடர்பு கொள்ளுங்கள்',
  'spoken phrase drops the English parenthesis'
);
