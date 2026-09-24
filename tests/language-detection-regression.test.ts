/**
 * Audit FAIL-1 / FAIL-2 regression tests (repeated multilingual audit, 2026-09-24).
 *
 * FAIL-1: non-canonical source-language identifiers (ta-IN, tam, 'Tamil
 *         language', …) must resolve to their real language; unknown
 *         identifiers must fall back to actual text/script detection — never
 *         silently relabel the user's words as English.
 * FAIL-2: romanized/keyword markers must not fire inside larger words
 *         ('vali' in 'invalid'/'kavali') and English homographs ('hospital',
 *         'sang') must not trigger Spanish/French detection.
 */
import {
  detectLanguage,
  matchLanguageIdentifier,
  getLanguageByCodeOrName,
  resolveDetectedSourceLanguage,
  translateEmergencyOffline
} from '../src/lib/languages.ts';
import { buildOfflineTranslation } from '../server/translation.ts';
import { section, assert, assertEqual } from './helpers.ts';

const TA_TEXT = 'உதவி தேவை, என் அப்பாவுக்கு மாரடைப்பு வருகிறது.';
const EN_TEXT = 'Help me, my father is having a heart attack at 12 Green Street.';
const code = (t: string) => detectLanguage(t).code;

section('FAIL-2 — the four confirmed audit repros');
assertEqual(code('My father is having a heart attack at the hospital.'), 'en', "'hospital' must not imply Spanish");
assertEqual(code('The alarm sensor is invalid and beeping loudly.'), 'en', "'vali' inside 'invalid' must not imply Tamil");
assertEqual(code('They sang songs at the service and then left.'), 'en', "'sang' must not imply French");
assertEqual(code('Kapadandi, nannaku sahayam kavali, manta ekkuva.'), 'te', "'kavali' must not steal Romanized Telugu as Tamil");

section('FAIL-2 — previously passing detection fixtures stay correct');
assertEqual(code('உதவி தேவை, என் அப்பாவுக்கு மாரடைப்பு வருகிறது.'), 'ta', 'Tamil script');
assertEqual(code('मदद चाहिए, मेरे पापा को हार्ट अटैक आ रहा है।'), 'hi', 'Hindi script');
assertEqual(code('సహాయం కావాలి, నా నాన్నకు గుండెపోటు వస్తోంది.'), 'te', 'Telugu script');
assertEqual(code('ಸಹಾಯ ಬೇಕು, ನನ್ನ ಅಪ್ಪನಿಗೆ ಹೃದಯಾಘಾತವಾಗುತ್ತಿದೆ.'), 'kn', 'Kannada script');
assertEqual(code('സഹായം വേണം, എന്റെ അച്ഛന് ഹൃദയാഘാതം വരുന്നു.'), 'ml', 'Malayalam script');
assertEqual(code('সাহায্য দরকার, আমার বাবার হার্ট অ্যাটাক হচ্ছে।'), 'bn', 'Bengali script');
assertEqual(code('मदत हवी, माझ्या वडिलांना हृदयविकार होत आहे.'), 'mr', 'Marathi markers');
assertEqual(code(EN_TEXT), 'en', 'English distress text');
assertEqual(code('Ayuda, mi padre está teniendo un ataque al corazón.'), 'es', 'Spanish markers');
assertEqual(code('Aidez-moi, mon père fait une crise cardiaque.'), 'fr', "French markers ('aide' inside 'Aidez' still works)");
assertEqual(code('Kapathunga, thaykku udavi venum, vali romba jasthi.'), 'ta', 'Romanized Tamil (standalone "vali" still matches)');
assertEqual(code('Madad karo, mere papa ko heart attack aa raha hai, bachao!'), 'hi', 'Romanized Hindi');
assertEqual(code('Sahaya kapaadi, nan thandige rogi, benki hechu.'), 'kn', 'Romanized Kannada');
assertEqual(code('Sahayikku, ente achanu vedana, rakshikku vaa.'), 'ml', 'Romanized Malayalam');
assertEqual(code('Shahajjo! Rokto porchche, shonko bereche.'), 'bn', 'Romanized Bengali');
assertEqual(code('Vachva! Madat hava, apghaat jhala, police bolva.'), 'mr', 'Romanized Marathi');

section('FAIL-1 — tolerant identifiers, no silent English');
for (const id of ['ta', 'TA', 'Tamil', 'தமிழ்', 'ta-IN', 'ta_in', 'tam', 'Tamil language', 'Tamil (India)']) {
  assertEqual(resolveDetectedSourceLanguage(id, EN_TEXT).code, 'ta', `sourceLanguage '${id}' -> ta`);
}
assertEqual(resolveDetectedSourceLanguage('Klingon-9000', TA_TEXT).code, 'ta', 'unknown label -> script detection (never English)');
assertEqual(resolveDetectedSourceLanguage('', TA_TEXT).code, 'ta', 'empty label -> script detection');
assertEqual(resolveDetectedSourceLanguage(undefined, EN_TEXT).code, 'en', 'no label, English text -> en');
assertEqual(resolveDetectedSourceLanguage('fr', EN_TEXT).code, 'fr', 'recognised non-Indian label still wins (contract preserved)');
assertEqual(getLanguageByCodeOrName('tam').code, 'ta', "getLanguageByCodeOrName('tam') -> ta");
assertEqual(getLanguageByCodeOrName('ta-IN').code, 'ta', "getLanguageByCodeOrName('ta-IN') -> ta");
assertEqual(getLanguageByCodeOrName('zz').code, 'en', 'English fallback contract preserved for truly unknown identifiers');
assert(
  matchLanguageIdentifier('tam')?.code === 'ta' &&
    matchLanguageIdentifier('Tamil language')?.code === 'ta' &&
    matchLanguageIdentifier('nope') === null,
  'strict matcher resolves tolerant identifiers and returns null for unknown'
);

section('FAIL-1 — translation layer reports the real source language');
for (const id of ['ta-IN', 'Tamil language', 'tam']) {
  const t = buildOfflineTranslation({ sourceText: TA_TEXT, targetLanguage: 'en', sourceLanguage: id, currentSOS: null });
  assertEqual(t.detected_source_language.code, 'ta', `buildOfflineTranslation sourceLanguage '${id}' -> ta`);
  assertEqual(t.original_message, TA_TEXT, `original preserved verbatim for '${id}'`);
}
// Preserve the existing offline contract (BUG 2 suite also guards this).
const same = translateEmergencyOffline(EN_TEXT, 'en', 'MEDICAL', 5, 'Medical', 'en');
assertEqual(same.translated_message, EN_TEXT, 'same-language offline translation still idempotent');
const unknownLabel = buildOfflineTranslation({ sourceText: TA_TEXT, targetLanguage: 'en', sourceLanguage: 'zz-klingon', currentSOS: null });
assertEqual(unknownLabel.detected_source_language.code, 'ta', 'unknown sourceLanguage -> text detection inside translation too');
