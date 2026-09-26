/**
 * Multilingual recognition + on-demand read-aloud locales: the microphone
 * must start and retarget in the heard language. The emergency answer is
 * shown on screen and is never auto-spoken (no spoken-brief tests remain).
 */
import { getSpeechRecognitionLocale } from '../src/lib/languages.ts';
import {
  pickStartLanguage,
  resolveSpeechLocale,
  shouldSwitchRecognitionLanguage
} from '../src/lib/speech.ts';
import { section, assertEqual } from './helpers.ts';

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
