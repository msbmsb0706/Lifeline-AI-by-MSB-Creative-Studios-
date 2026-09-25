# Offline QA Report — 2026-09-24

## This round — Android voice lifecycle + offline SOS device flow

Reproduced with the REAL components rendered in jsdom against a fake Chrome/Android `SpeechRecognition` (`tests/voice-android-lifecycle.test.ts`, `tests/offline-sos-android-flow.test.ts`, harness in `tests/dom-harness.ts`). No device, no paid ASR service, no partner endpoint involved.

| Trigger (Android Chrome) | Before this round (actual) | Expected and verified now | Evidence |
|---|---|---|---|
| Chrome ends a continuous session at its own speech end-point and immediately ends again without hearing anything (no-speech loop, muted mic, airplane mode) | `onstart` reset the restart budget on every restart, so the `>= 6` cap was **unreachable**: 12 end-pointing cycles produced **13 starts** and the microphone stayed open forever with the button reading "Listening" | Restart budget counts only Chrome's own end-points, is reset by real speech or a user-initiated session, and is capped at **3**; the session then ends, keeps what was heard, and tells the person to tap again | 12-cycle churn: 3 restarts, session ended, `started === false` |
| `onerror` `network` (Android offline) | Each error was followed by another auto-restart → silent endless loop | Fatal errors (`network`, `audio-capture`, `language-not-supported`) finish the session with whatever was already heard; no further start | 10 network errors: **0** additional starts |
| Tap to stop, then tap again to speak (Chrome still closing the previous session) | The decision used React's `isListening`, which lags a render behind Chrome's `onend`, so the second tap called `finishBrowserSession()` again and was **swallowed** — the microphone stayed off and nothing restarted | Tap decisions use the recognizer's real state (`runningRef`); a queued start runs from `onend`, with a 500 ms fallback if the browser never reports the end | second tap produces a new session and the stopped session still submits its own text once |
| `onresult` with a stale `resultIndex` | Only results from `resultIndex` were read, so an unheard final could be dropped | Every result is read through `buildTranscript()` and merged duplicate-safely with `mergeFinalChunk()` | interim-only + cumulative-final fixtures |
| Offline SOS confirmed on the card, page closed, then reopened online | Status stayed a bare `PENDING_LOCAL` with no explicit waiting state | Offline confirmations record `WAITING_FOR_CONNECTION` in the lifecycle; nothing is transmitted in either state | real `SOSCardView` driven through its own buttons |
| Offline → confirm → close/reopen → online (the 10 Android test steps) | — | **0 network calls while offline**; the SAME `sosId` survives the reopen with the original Tamil text verbatim; still labelled **SAVED LOCALLY — NOT SENT**; 200 reconnect queue scans upload **nothing**; only an explicit action moves `SENDING → SENT`, and `SENT` is never inflated into `DELIVERED` | `tests/offline-sos-android-flow.test.ts` (34 assertions) |

Suite after this round: **4040 passed, 0 failed** (`npm test`), `npx tsc --noEmit` clean, `npm run build` OK, `git diff --check` clean. The new DOM suites fail 9 assertions against the previous component, so they are real regression guards.

**Still not verified:** a physical Android phone (see the real-device checklist below). Chrome's actual end-pointing timing, the Google speech service availability, and service-worker/background delivery while the browser is fully closed cannot be reproduced here.

---

Scope: offline triage, production PWA startup, interrupted SOS recovery, local-only/manual sharing, TEST/DEMO protection, and multilingual typed input. Offline tests block `fetch` or emulate airplane mode; **online** endpoint tests use isolated mock fixtures only. No real emergency responder received a message.

| Check | Result |
|---|---|
| Repeated offline classification | **PASS:** 143 cases × 500 runs × 2 classifications = **143,000** classifications; 0 `fetch` calls, stable results (`tests/offline-qa-500.test.ts`) |
| Repeated PWA airplane-mode startup | **PASS:** 500 cached shell + JS/CSS navigations with **0 network calls**; missing-asset and failed-update checks (`tests/offline-shell.test.ts`) |
| Repeated failure / queue guards | **PASS:** 500 offline Tamil AI attempts, 500 dropped-online attempts using a mock, 500 offline queue reads, and 500 reconnect queue scans with legacy `auto-send=true` and **0 partner uploads** (`tests/online-triage-fallback.test.ts`, `tests/offline-resilience.test.ts`) |
| Full regression suite | **PASS:** **3,882 passed, 0 failed** (`npm test`, after manual-only policy changes) |
| Typecheck and production bundle | **PASS:** `npx tsc --noEmit`, `npm run build`; `git diff --check` clean |
| Headless production browser (Chromium 153) | **PASS:** offline reload from worker (HTTP 200), Tamil SOS priority 5, 0 offline `/api/` requests, LOCAL_ONLY record retained after reconnect/restart, 0 partner uploads despite legacy preference TRUE, exact Tamil words passed to a **stubbed** device share sheet; no browser exceptions |
| Real phone, OS lock/battery/reboot, and actual partner delivery | **NOT TESTED:** physical device and a configured authorized partner are unavailable |

The 500-run checks are controlled automated repetitions, **not** 500 real devices. The previous classifier-only pass (87 × 500 cases, 3,660 tests across 10 runs) was captured before the improvements below.

## Earlier classifier fixes (retained and rechecked)

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

## Current round — input, observed bug, expected result, verification

| Input / trigger | Before this round (actual) | Expected and verified now | Evidence |
|---|---|---|---|
| Previously visited production site, then airplane mode and reload | No reliable cached app shell; offline startup depended on browser/network | Versioned worker serves **matching HTML + JS + CSS**; offline reload HTTP 200 from worker, zero offline `/api/` requests. A first-ever offline visit **still cannot load**. | `tests/offline-shell.test.ts` (500 cached launches, failed update rollback); Chromium browser smoke |
| Online AI stalls, no API key, or network fails while typing “அப்பா மூச்சு விடவில்லை” | Error/no usable SOS; user had to switch modes | After a 4-second-bounded online attempt (immediately in airplane mode), local MEDICAL **5** with visible offline-fallback notice; no responder contact | `tests/online-triage-fallback.test.ts` (500 failed-signal simulations); browser smoke |
| Manual OFFLINE switch → reload/recharge/reopen | Mode preference lost | Offline-mode choice restored from browser storage when available | `src/App.tsx`; source/queue restart checks |
| Confirm 8 SOS records offline; fill storage | Former queue kept only 5; write failures could be shown as saved | All 8 unsent records retained; quota failure returns FALSE and UI says **SAVE FAILED — NOT SENT** | `tests/offline-resilience.test.ts` |
| Partner endpoint replies but local receipt cannot be stored | Receipt persistence was ignored; UI could claim SENT despite a stuck SENDING record | UI warns handoff may have occurred but receipt is unverified; recovery leaves it for manual verification, never auto-resends | `tests/offline-resilience.test.ts` (quota after mock handoff, restart) |
| Legacy `lifeline_autosend_pending_sos=true`, reconnect or restart with saved consent | Default was ON, and reopening/reconnect could upload to TEST without a new action | **No automatic upload**, even with legacy TRUE: 500 queue scans, zero requests; browser restart leaves SOS pending | `tests/offline-resilience.test.ts`; Chromium browser smoke |
| Save real Tamil SOS in main card or Silent SOS, online or offline | Partner button could POST real text to a TEST/DEMO endpoint | Saves **LOCAL_ONLY**, partner approval FALSE, no endpoint. User may manually share saved text/location via device/clipboard. Legacy real TEST records cannot be resent to demo. | Queue unit tests; browser smoke; real HTTP test `TEST → 403`, `LOCAL_ONLY → 403` |
| Manually press TEST directory example | Demo receipt could read like responder success | Only a fixed **synthetic** example reaches the mock endpoint. `SENT TO TEST/DEMO ONLY — NO RESPONDER` and simulated final statuses; never a real delivery confirmation. | `tests/sos-lifecycle.test.ts`, `tests/pr16-corrective.test.ts`, real HTTP `synthetic → 200` |
| Reopen after interrupted `SENDING` / battery recovery | Record could remain stuck in SENDING | Restored to PENDING_LOCAL or WAITING_FOR_CONNECTION; original message preserved; **manual share/send only**, never a background promise | `tests/offline-resilience.test.ts` (simulated restart) |
| Type “அப்பா மூச்சு விடவில்லை” / “Mi padre no respira” / “papa saans nahi le rahe” / “Il y a un incendie” | Many typed script, Spanish/French and romanized inputs fell back to generic OTHER 2 | Specific MEDICAL 5 / FIRE 5, with original Unicode text retained. IME Enter does not submit unfinished composition. | `tests/offline-qa-500.test.ts`, `tests/language-detection-regression.test.ts`, `src/components/TranscriptArea.tsx` |
| Record a 10-second Silent SOS video; close the tab | Recording not durable; offline queue held only file details | Explicit **SAVE VIDEO TO DEVICE** option and disclosure. Video is **not** uploaded by queue or recoverable after close unless saved manually. | Silent SOS code and source assertion in resilience tests; no physical phone media test |

Classifier differential against the prior version: 50 changed among 3,568 sampled inputs; checked changes were the intended multilingual/negation behavior and English controls were unchanged. Examples measured prior → current: “அப்பா மூச்சு விடவில்லை” OTHER 2 → MEDICAL 5; “Mi padre no respira” OTHER 2 → MEDICAL 5; “No hay fuego, todo está bien” OTHER 2 → OTHER 1. The full current 143-case set repeats each input 500 times without a fetch.

**Partner API status (this deployment):** `GET /api/emergency-partner/config?country=IN` returned `NOT_CONFIGURED`. Manual `AUTHORIZED_API` POST returned **HTTP 400**; `TEST` real-text/`LOCAL_ONLY` POSTs returned **HTTP 403**. The only **HTTP 200** was the synthetic demo example, with no delivery/responder flags. An online directory visit may make an informational **GET** to read configuration; it is not an SOS upload. Tests use dummy text and mocked/disabled providers — no actual responder integration was exercised.

## Remaining limitations and safety warnings
- **No lock-screen or zero-battery guarantee:** web pages are suspended by browsers/OS, so nothing runs while the battery is drained. A cached app can reopen after charging **if** browser storage survives. Cache/storage may be evicted; first use needs one successful online PWA installation.
- **No offline delivery:** airplane mode means no partner upload, SMS, or guaranteed share-sheet delivery. Phone calls need service. Use the correct local emergency number directly in immediate danger; no country-independent 911/112/108 fallback is assumed.
- **No real responder API:** only a disabled authorized template is present. TEST/DEMO is synthetic; no record here proves delivery to an emergency organization. Exactly-once sending after a crash cannot be guaranteed without partner idempotency by `sosId`.
- **Media bytes are tab-only:** the SOS queue stores names/types/sizes, never photo/video content. Manually save video or share files while the tab remains open; device share-sheet/file support varies. Online *voice transcription*, if separately configured and activated, is a distinct feature that can send microphone audio to its ASR backend; type in offline mode to avoid that path.
- **Heuristic language and clinical limitations:** offline typed-language matching is rule-based, not exhaustive; related dialects/transliterations can be missed or misread. Negation and collapse disambiguation do not cover every language/wording. Nine new first-aid rule sets still need clinician sign-off. Offline translation is a fixed phrasebook, not a free-form multilingual interpreter.
- **Privacy of local storage:** SOS text/coordinates in browser storage are not encrypted by this app and may be visible on a shared device. Browser quota/privacy settings may block saves; do not treat it as a durable evidence vault.

## Real-device checklist (pending)
1. On Android Chrome and iOS Safari/PWA, open once online, verify offline-ready indicator, then enable airplane mode and cold-launch/reload. Confirm Tamil/Hindi/Spanish typed cases, priority, and zero app API requests; repeat with forced Offline mode; on a fresh unprepared browser with no cached worker, expect the browser's offline error (the app cannot start), never a fabricated sent status.
2. Save a real SOS and (separately) a 10-second video; background/lock/unlock/restart/charge. Verify SOS text survives **if storage persists**, no auto-upload, manual sharing requires a new tap, video only survives if explicitly saved to the device.
3. Reconnect; confirm nothing is sent, then test a manual device share, canceled share, and clipboard fallback. Verify no app confirmation is interpreted as responder delivery. Only test authorized API integration after an organization supplies credentials and an endpoint.

Re-run: `npm test`, `npx tsc --noEmit`, `npm run build`. Browser/physical device checks are separate from the Node test suite.
