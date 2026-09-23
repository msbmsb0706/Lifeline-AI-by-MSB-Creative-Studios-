import { getCountryEmergencyConfig } from '../src/lib/emergencyPartnersData.ts';
import { getOriginalTransmission, isUsableOnlineTranslation } from '../src/lib/translation.ts';
import { permittedPartnerPayload } from '../server/emergencyPartnerConfig.ts';
import { section, assert, assertEqual } from './helpers.ts';

section('Country references and translation source/validation');
assertEqual(getCountryEmergencyConfig('US').emergencyNumbers.join(','), '911', 'US configured number');
assertEqual(getCountryEmergencyConfig('IN').emergencyNumbers.join(','), '112', 'India configured number');
assertEqual(getCountryEmergencyConfig('GB').emergencyNumbers.join(','), '999', 'UK uses existing directory, not guessed numbers');
for (const code of ['XX', 'GLOBAL', 'ALL', '']) assertEqual(getCountryEmergencyConfig(code).emergencyNumbers.length, 0, `${code || 'empty'} does not invent a number`);
assert(getCountryEmergencyConfig('IN').sources.every(s => s.name && s.url), 'country configuration retains source metadata');
assertEqual(getOriginalTransmission({ raw_transcript: 'original', original_message: 'second', message: 'generated' }), 'original', 'raw transcript wins');
assertEqual(getOriginalTransmission({ original_message: 'original', message: 'generated' }), 'original', 'original message before legacy message');
assertEqual(getOriginalTransmission({ message: 'legacy' }), 'legacy', 'legacy fallback supported');
for (const translated_message of [null, 1, [], '', '  ', '[TA faithful translation not available offline]']) {
  assert(!isUsableOnlineTranslation({ source: 'nebius_nemotron', translated_message }), `invalid translated_message rejected: ${JSON.stringify(translated_message)}`);
}
assert(!isUsableOnlineTranslation({ source: 'offline_fallback', translated_message: 'words' }), 'offline payload never accepted as online');
assertEqual(JSON.stringify(permittedPartnerPayload({ message: 'help', gps: { latitude: 1 }, secret: 'never' }, ['message', 'secret'])), '{"message":"help"}', 'only supported AND permitted SOS fields forwarded');

section('Shared online translation authorization and failure contract');
const { translateEmergency, TranslationError, translationFailure } = await import('../server/translation.ts');
const originalFetch = globalThis.fetch;
try {
  for (const apiKey of ['fixture-key', 'Bearer fixture-key']) {
    globalThis.fetch = async (_input, init) => {
      assertEqual((init?.headers as any).Authorization, 'Bearer fixture-key', 'translation normalizes authorization exactly like analysis');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translated_message: 'translated only', original_message: 'model rewrite', severity: 1, category: 'FIRE' }) } }] }));
    };
    const result = await translateEmergency({ text: 'original', targetLanguage: 'ta', currentSOS: { severity: 5, emergency_category: 'RESCUE' } }, { apiKey, baseUri: 'https://fixture.invalid', model: 'fixture' });
    assertEqual(result.original_message, 'original', 'model cannot overwrite original_message');
    assertEqual(result.severity, 5, 'model cannot change locked severity');
    assertEqual(result.category, 'RESCUE', 'model cannot change locked category');
  }
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not fetch'); };
  try {
    await translateEmergency({ text: 'original', targetLanguage: 'ta' }, { apiKey: '', baseUri: '', model: '' });
    assert(false, 'missing online key must fail');
  } catch (err) {
    assert(err instanceof TranslationError && err.status === 503, 'missing online key is explicit 503, not successful offline translation');
  }
  assert(!called, 'unconfigured translation does not call an upstream');
  assertEqual(translationFailure(new Error('private endpoint detail')).error, 'Translation request failed or timed out.', 'network failures expose no private endpoint details');
} finally { globalThis.fetch = originalFetch; }
