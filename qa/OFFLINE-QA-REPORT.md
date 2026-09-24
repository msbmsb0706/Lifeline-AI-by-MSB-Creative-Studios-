# Offline QA Report — 2026-09-24

Scope: `src/lib/offlineClassifier.ts` (used by the offline path in `App.tsx` and by `SilentSOS.tsx`).
Method: `fetch` blocked throughout, 0 network calls, no messages sent.

| Status | |
|---|---|
| Full offline QA (automated) | **PASS**: 87 cases × 500 repetitions (87,000 classifications), 0 fetch calls, deterministic |
| Full regression suite | **PASS**: 3660 passed, 0 failed, stable across 10 consecutive full runs |
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

### OFFLINE-BUG-004: negated symptoms escalated (MEDIUM, over-triage)
| Input | Before | After |
|---|---|---|
| No bleeding / Not bleeding, just a bruise | Hemorrhage 5 | MEDICAL 2 |
| He is not unconscious, he is awake | Cardiac 5 | MEDICAL 2 |
| The fire is out now, everyone is fine | FIRE 5 | Clarification required (1) |
| He is not stable, bleeding heavily | 5 | 5 (unchanged, correct) |

Negation ("no / not / isn't / without / never", optionally followed by "active / more / signs of") only suppresses **symptom and hazard** words. It never suppresses needs: "without drinking water", "no shelter", "no food" and "no defibrillator" are unaffected. Keywords that are negative themselves ("no pulse", "not breathing") keep working.

### OFFLINE-BUG-005: common emergencies not recognised (HIGH, under-triage)
New rules for drowning (5), seizure (4), poisoning/overdose (5), snake/animal bite (4), labour/childbirth (4), anaphylaxis (5), electric shock (5), fall/head/bone injury (4), and possible death (5). English keywords, plus Tamil and Hindi keywords where the wording is reliable. These rules are **appended last**, so any tie with an existing rule still goes to the existing rule (e.g. "carbon monoxide poisoning" stays Hazmat).
⚠️ The first-aid text follows widely published lay-rescuer guidance (Red Cross / ILCOR) but **still needs sign-off from a clinician**.

### OFFLINE-BUG-006: "blood pressure" → Severe Hemorrhage 5 (LOW)
"blood" no longer triggers the hemorrhage rule when it is followed by pressure / sugar / test / group / type / report / count / donation. "Blood everywhere" is still 5.

### OFFLINE-BUG-007: a person collapsing → Structural Collapse / USAR (MEDIUM)
"My grandmother collapsed" / "She suddenly collapsed at the gym" → Cardiac rule (check breathing, CPR). Building, roof, bridge and similar collapses stay USAR, including "The building collapsed on my father".

## Remaining limitations
- Negation and person-collapse handling are English-only. Indian-language inputs behave as before.
- Other Indian languages (Telugu, Kannada, Malayalam, Bengali, Marathi) have no keywords yet for the new rule types.

## Real-device checklist (pending)
Airplane mode → open the installed PWA → enter "My father is not breathing" and "The patient is stable" → confirm priority 5 / priority 1, no network activity, and no SMS/partner send without confirmation. Repeat in Silent SOS.

Re-run: `npm test` (includes `tests/offline-qa-500.test.ts`).
