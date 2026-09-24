/** Narrow regression for OFFLINE-BUG-001. No live APIs or browser required. */
import { classifyEmergencyOffline } from '../src/lib/offlineClassifier.ts';
import { assert, assertEqual, section } from './helpers.ts';

section('Offline explicit fire denial — no invented active fire');
const previousFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (() => { fetchCalls++; throw new Error('Offline must not fetch'); }) as typeof fetch;
try {
  for (let repetition = 0; repetition < 100; repetition++) {
    for (const text of ['There is no fire. Everyone is safe.', 'No fire.', 'There is no active fire.']) {
      const result = classifyEmergencyOffline(text, undefined, 'English', 'ta');
      assertEqual(result.emergency_category, 'OTHER', 'denial is not active fire');
      assertEqual(result.severity, 1, 'denial requires clarification, not highest priority');
      assertEqual(result.needs.length, 0, 'no invented dispatch assets');
      assert(!result.message.includes('Dispatch nearest units immediately'), 'no immediate dispatch recommendation');
      assertEqual(result.transcript, text, 'original transcript preserved');
      assertEqual(result.translation?.original_message, text, 'translation retains original denial');
    }
    for (const text of ['There is a fire in the kitchen.', 'There is no fire extinguisher. There is a fire.', 'No fire, but there is smoke.', 'No fire. There is a fire upstairs.', 'There is no fire and smoke is filling the room.']) {
      assertEqual(classifyEmergencyOffline(text).emergency_category, 'FIRE', 'affirmative fire/smoke still classified');
    }
    for (const text of ['No fire, but severe chest pain.', 'There is no fire. He has no pulse.', 'There is no fire. She cannot breathe.']) {
      const result = classifyEmergencyOffline(text);
      assertEqual(result.emergency_category, 'MEDICAL', 'affirmative medical hazard survives fire denial');
      assertEqual(result.severity, 5, 'medical emergency remains highest priority');
    }
    assertEqual(classifyEmergencyOffline('There is no fire, but I need urgent help.').severity, 3, 'unspecified urgent assistance is not suppressed');
  }
  assertEqual(fetchCalls, 0, 'all offline denial/control checks made zero fetch calls');
} finally {
  globalThis.fetch = previousFetch;
}
