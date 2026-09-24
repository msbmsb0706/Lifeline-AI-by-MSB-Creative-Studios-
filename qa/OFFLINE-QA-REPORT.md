# Offline QA Report — 2026-09-24

Scope: `src/lib/offlineClassifier.ts` (used by the offline path in `App.tsx` and by `SilentSOS.tsx`).
Method: `fetch` blocked throughout, 0 network calls, no messages sent.

| Status | |
|---|---|
| Full offline QA (automated) | **PASS**: 44 cases × 500 repetitions (44,000 classifications), 0 fetch calls, deterministic |
| Full regression suite | **PASS**: 3617 passed, 0 failed, stable across 10 consecutive full runs |
| `tsc --noEmit` / `npm run build` | **PASS** |
| Real-device QA | **PENDING ⏳**: needs a phone in airplane mode (see checklist below) |

## Fixed

### OFFLINE-BUG-002: absent breathing under-prioritized (HIGH)
| Input | Before | After |
|---|---|---|
| My father is not breathing. | MEDICAL 2, generic | MEDICAL **5**, Cardiac (CPR guidance) |
| He stopped breathing / isn't breathing | MEDICAL 2 | MEDICAL **5** |
| He is unresponsive / not responding | OTHER 2 | MEDICAL **5** |
| A person has fainted. | OTHER 2 | MEDICAL **5** |
| He can't breathe (straight or curly apostrophe) | MEDICAL 2 | MEDICAL **5**, Airway (same as "cannot breathe") |

These phrases now use the **existing** reviewed rules. No new medical guidance text was written.

### OFFLINE-BUG-003: English keywords matched inside unrelated words (HIGH)
| Input | Before | After |
|---|---|---|
| The patient is stable. | MEDICAL 4, *Severe Hemorrhage* ("stab") | OTHER 1 |
| The work has begun | OTHER 5, *Active Threat* ("gun") | OTHER 2 |
| Paediatric emergency | MEDICAL 5, *Cardiac/AED* ("aed") | OTHER 3 |
| I know the address | severity 3 ("now") | severity 2 |
| He was arrested | severity 5 ("arrest") | severity 2 |

Fix: English keywords must be whole words, optionally with a simple ending (s/es/d/ed/ing/er). Indian-language keywords keep substring matching, unchanged. A keyword found inside another matched keyword still scores (e.g. `fire` in `wildfire`), so existing tie-breaks stay the same. I added `stabbed`, `stabbing` and `firefighter` so those inputs keep their previous result.

A side-by-side run of the old and new code on 3,199 inputs showed no unintended changes. The only differences were the fixes above and made-up words from the test templates.

## Found, NOT fixed (need your decision / medical review)
1. **Negation is not understood (over-triage).** "No bleeding" → Hemorrhage 5. "He is not unconscious" → 5. "The fire is out now, everyone is fine" → FIRE 5. Over-triage is safer than under-triage, so I left it.
2. **Missing emergency types (under-triage, severity 2).** Drowning, seizure, overdose/poison, snake bite, labour/childbirth, severe allergic reaction, electric shock, fall from height, "he is dead". Each needs a new rule **with new first-aid text**, which needs medical review.
3. **"Blood pressure is high"** → Severe Hemorrhage 5 (the word "blood"). Over-triage.
4. **"My grandmother collapsed"** → *Structural Collapse / USAR* instead of medical.

## Real-device checklist (pending)
Airplane mode → open the installed PWA → enter "My father is not breathing" and "The patient is stable" → confirm priority 5 / priority 1, no network activity, and no SMS/partner send without confirmation. Repeat in Silent SOS.

Re-run: `npm test` (includes `tests/offline-qa-500.test.ts`).
