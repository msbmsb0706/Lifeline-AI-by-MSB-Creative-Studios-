/**
 * OFFLINE-BUG-002 / OFFLINE-BUG-003 regression + repeated full offline QA.
 *
 * - BUG-002: absent breathing / unresponsive reports were severity 2.
 * - BUG-003: English keywords matched inside unrelated words
 *   ("stable" -> stab, "begun" -> gun, "paediatric" -> aed, "know" -> now,
 *   "arrested" -> arrest severity).
 *
 * Every case runs 500 times with fetch blocked; results must be identical
 * each time and no network call may occur. Controls pin existing behaviour.
 */
import { classifyEmergencyOffline } from '../src/lib/offlineClassifier.ts';
import { assert, assertEqual, section } from './helpers.ts';

type Expect = { category: string; minSeverity?: number; maxSeverity?: number; severity?: number; type?: string };

const CASES: Array<[string, Expect]> = [
  // BUG-002 — absent breathing must be critical
  ['My father is not breathing.', { category: 'MEDICAL', severity: 5, type: 'Medical - Cardiac Emergency' }],
  ['She is not breathing', { category: 'MEDICAL', severity: 5 }],
  ['Baby is not breathing, help', { category: 'MEDICAL', severity: 5 }],
  ['He stopped breathing', { category: 'MEDICAL', severity: 5 }],
  ["My mother isn't breathing", { category: 'MEDICAL', severity: 5 }],
  ['My mother isn\u2019t breathing', { category: 'MEDICAL', severity: 5 }],
  ['He is unresponsive', { category: 'MEDICAL', severity: 5 }],
  ['He collapsed and is not responding', { category: 'MEDICAL', severity: 5 }],
  ['A person has fainted.', { category: 'MEDICAL', severity: 5 }],
  ["He can't breathe", { category: 'MEDICAL', severity: 5, type: 'Medical - Airway Obstruction / Choking' }],
  ['He can\u2019t breathe', { category: 'MEDICAL', severity: 5, type: 'Medical - Airway Obstruction / Choking' }],
  ['I am unable to breathe', { category: 'MEDICAL', severity: 5, type: 'Medical - Airway Obstruction / Choking' }],
  ['No fire, but my father is not breathing.', { category: 'MEDICAL', severity: 5 }],
  // BUG-003 — no mid-word false positives
  ['The patient is stable.', { category: 'OTHER', maxSeverity: 2 }],
  ['The work has begun', { category: 'OTHER', maxSeverity: 2 }],
  ['Paediatric ward visit', { category: 'OTHER', maxSeverity: 2 }],
  ['I know the address', { category: 'OTHER', maxSeverity: 2 }],
  ['He was arrested yesterday', { category: 'OTHER', maxSeverity: 2 }],
  // Controls — existing behaviour preserved
  ['My father cannot breathe.', { category: 'MEDICAL', severity: 5, type: 'Medical - Airway Obstruction / Choking' }],
  ['Heart attack', { category: 'MEDICAL', severity: 5, type: 'Medical - Cardiac Emergency' }],
  ['My husband has no pulse', { category: 'MEDICAL', severity: 5, type: 'Medical - Cardiac Emergency' }],
  ['Cardiac arrest in the lobby', { category: 'MEDICAL', severity: 5 }],
  ['He is stabbed and bleeding', { category: 'MEDICAL', severity: 5, type: 'Trauma - Severe Hemorrhage' }],
  ['Stab wound', { category: 'MEDICAL', severity: 5, type: 'Trauma - Severe Hemorrhage' }],
  ['Minor bleeding from a cut', { category: 'MEDICAL', severity: 4 }],
  ['He has a gun', { category: 'OTHER', severity: 5, type: 'Law Enforcement / Active Threat' }],
  ['There are fires everywhere', { category: 'FIRE', severity: 5 }],
  ['Firefighter is injured', { category: 'FIRE', severity: 5 }],
  ['Wildfire and he is unconscious', { category: 'FIRE', severity: 5 }],
  ['Earthquake, building collapsed', { category: 'RESCUE', severity: 5 }],
  ['Car accident on highway', { category: 'RESCUE', severity: 4 }],
  ['Critically injured after fall', { category: 'OTHER', severity: 5 }],
  ['Help!', { category: 'OTHER', severity: 3 }],
  ['Please help now', { category: 'OTHER', severity: 3 }],
  ['I have a mild headache', { category: 'OTHER', severity: 1 }],
  ['There is no fire. Everyone is safe.', { category: 'OTHER', severity: 1 }],
  ['Missing person near the lake', { category: 'MISSING_PERSON', severity: 5 }],
  ['Gas leak in kitchen', { category: 'OTHER', severity: 4, type: 'Hazardous Material / Toxic Gas' }],
  ['நெஞ்சு வலி', { category: 'MEDICAL', severity: 5 }],
  ['மூச்சு திணறல்', { category: 'MEDICAL', severity: 5 }],
  ['आग लगी है बचाओ', { category: 'FIRE', severity: 5 }],
  ['दिल का दौरा', { category: 'MEDICAL', severity: 5 }],
  ['రక్తస్రావం', { category: 'MEDICAL', severity: 5 }],
  ['আগুন', { category: 'FIRE', severity: 5 }]
];

const REPETITIONS = 500;

section(`Offline QA — ${CASES.length} cases × ${REPETITIONS} repetitions, network blocked`);
const previousFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (() => { fetchCalls++; throw new Error('Offline QA must not fetch'); }) as typeof fetch;
try {
  for (const [text, expect] of CASES) {
    // translation.timestamp is wall-clock by design; everything else must be identical.
    const stable = (r: ReturnType<typeof classifyEmergencyOffline>) =>
      JSON.stringify({ ...r, translation: r.translation ? { ...r.translation, timestamp: '' } : undefined });
    const first = stable(classifyEmergencyOffline(text, 'Chennai', 'English', 'ta'));
    let unstable = 0;
    let wrong = 0;
    let lastDetail = '';
    for (let i = 0; i < REPETITIONS; i++) {
      const plain = classifyEmergencyOffline(text);
      const translated = classifyEmergencyOffline(text, 'Chennai', 'English', 'ta');
      if (stable(translated) !== first) unstable++;
      const bad =
        plain.emergency_category !== expect.category ||
        (expect.severity !== undefined && plain.severity !== expect.severity) ||
        (expect.minSeverity !== undefined && plain.severity < expect.minSeverity) ||
        (expect.maxSeverity !== undefined && plain.severity > expect.maxSeverity) ||
        (expect.type !== undefined && plain.emergency_type !== expect.type) ||
        plain.transcript !== text.trim() ||
        (translated.translation !== undefined && translated.translation.original_message !== text.trim()) ||
        plain.severity < 1 || plain.severity > 5;
      if (bad) {
        wrong++;
        lastDetail = `${plain.emergency_category}/${plain.severity}/${plain.emergency_type}`;
      }
    }
    assert(wrong === 0 && unstable === 0,
      `${JSON.stringify(text)} → ${expect.category}${expect.severity ? '/' + expect.severity : ''} ×${REPETITIONS}` +
      (wrong ? ` [wrong ${wrong}: ${lastDetail}]` : '') + (unstable ? ` [non-deterministic ${unstable}]` : ''));
  }
  assertEqual(fetchCalls, 0, `offline QA made zero fetch calls across ${CASES.length * REPETITIONS * 2} classifications`);
} finally {
  globalThis.fetch = previousFetch;
}
