# PR #38 Regression Review — 2026-10-03

## Verdict

**No regression found.** PR #38 ("Fix truncated online emergency translation responses") does not break
speech input, text input, language selection, triage submission or the translation follow-up. This review
changed **no runtime code** — this document is the only change in this PR.

The review was triggered by a report that the *current* build shows "text/voice interaction not behaving
correctly" while a *previous* build showed "speech input worked, text input worked, language selection
worked, triage worked, Tamil translation worked, SOS card displayed translated sections correctly".
The two screenshot **images were not available in this repository** — only their written descriptions were
reviewed, so the behavioural states below are derived from code, history, tests and end-to-end runs.

## Comparison points

| Point | Commit | Meaning |
|---|---|---|
| CURRENT | `384376c50bc3ef705dd05a56a3011bb6262493dd` | merge of PR #38 (= current `main`) |
| PREVIOUS | `eded98bef92d5b2fded11dfa12cee162fa9aab89` | merge of PR #37 — the commit immediately before PR #38 |
| Interaction baseline | `3f0e72b` (merge of PR #34) | last commit before the PR #35–#38 window |

## What PR #38 actually changed

`git diff --numstat eded98b 384376c`:

| File | +/− | Runtime effect |
|---|---|---|
| `server/translation.ts` | +290 / −130 | primary translation and structured responder translation become two separate upstream calls |
| `src/App.tsx` | **+3 / −1** | one line in `handleTranslateSOS`: `translation_status: transData.translation_status === 'partial' ? 'partial' : 'ok'` |
| `src/components/SOSCardView.tsx` | +10 / −0 | new amber notice when the optional structured phase is unavailable |
| `src/types.ts` | +14 / −6 | types only (`'partial'` status, `structured_translation_*` fields) |
| 5 `tests/*.test.ts` files | +274 / −80 | assertions for the two-phase contract |

No speech, input, language-selection, triage or routing code was touched.

## The interaction layer is byte-identical to before the window

```
git diff 3f0e72b 384376c -- \
  src/components/TranscriptArea.tsx src/components/EmergencyVoiceButton.tsx \
  src/lib/speech.ts src/lib/speechCapture.ts src/utils/ src/main.tsx index.html
```

→ **empty**. Speech-recognition lifecycle, the IME-safe transcript field and the voice/language chips have
not changed since PR #34. Within PR #35–#38 the only client-side changes are:

- `src/lib/onlineTriage.ts`: default timeout `4000 → 12000 ms` (PR #35, matching the server triage deadline);
- `src/App.tsx` + `src/lib/onlineTriage.ts`: every backend call now goes through `apiUrl()` (PR #36), which
  returns the identical relative `/api/*` path on the web and the production origin only inside the
  Capacitor shell;
- the single `translation_status` line above (PR #38).

## Method

1. `git diff`/`git log` over `eded98b..384376c` and over every file in the interaction path.
2. Full regression suite on `384376c`: **5411 passed, 0 failed** (`npm test`).
3. **A/B end-to-end run**: the REAL `App` rendered in jsdom, talking to the REAL Express server
   (`tsx server.ts`) whose Nebius upstream was a local mock — executed identically against `384376c` and
   against `eded98b` (git worktree). This exercises the whole chain: input → `/api/analyze-emergency` →
   SOS card → `/api/translate-emergency` → translated card.

## A/B results (same script, both commits)

| Scenario | `eded98b` (before PR #38) | `384376c` (current) |
|---|---|---|
| Type English text, select Tamil, Analyze | triage → **one** translation call → card shows the Tamil message + translated sections | triage → **two** calls (primary + structured) → same Tamil message + translated sections |
| Voice (browser recognition) Tamil speech → auto-submit, target Tamil | — | transcript filled, triage card rendered, translation displayed, no error banner |
| Voice Tamil speech with default English target | — | automatic follow-up ran and the card showed the English translation of the Tamil original |
| Target language == detected language | no automatic translation (rule predates PR #35: `if (targetLangObj.code !== detectedSourceLang.code)`) | unchanged: no automatic translation; card offers Translate SOS |
| Structured phase truncated (`finish_reason: length`) | **HTTP 502 — no translation at all** ("incomplete (truncated) response") | **HTTP 200 — primary Tamil translation displayed** + amber structured notice |

The last row is the defect PR #38 was written to fix: before it, a truncation of the combined call erased
the whole translation; after it, the safety-validated primary translation survives and the failed optional
phase is reported explicitly (`translation_status: 'partial'`).

## Why the screenshots differ (code-verifiable states)

1. **Async card (introduced by PR #35, live before PR #38).** Triage and translation are decoupled: the SOS
   card renders as soon as `/api/analyze-emergency` returns, then `/api/translate-emergency` runs in the
   background ("Translating SOS…"). A capture taken in that window shows an untranslated card
   ("Not translated yet. Choose a language above and tap Translate SOS…"). Before PR #35 the translation
   travelled inside the analyze response, so any post-card capture already contained Tamil.
2. **Skip rule that predates PR #38.** The automatic follow-up only starts when the requested target
   language differs from the detected source language. Tamil speech/text with Tamil selected ⇒ no automatic
   translation by design (identical rule in the pre-#35 server).
3. **PR #38's new visible state.** If the optional structured phase fails, the card shows the primary
   translation plus the amber "Structured responder details remain in their original language…" notice.
   A screenshot containing that notice is the *fix*: the same upstream condition previously produced no
   translation at all.
4. **Deployment/configuration state.** The online path requires a working `NEBIUS_API_KEY`; if it is absent
   or the upstream fails/times out, the app deliberately classifies on-device — the card still appears,
   labelled `ONLINE AI UNAVAILABLE`, and the online translation follow-up is intentionally not attempted
   (`source === 'nebius_nemotron'` is required). `/api/status` reporting ASR unconfigured only routes voice
   to browser recognition, which still works.

## Verification commands and results

| Command | Result |
|---|---|
| `npm test` | **5411 passed, 0 failed**, exit 0 |
| `npm run lint` (`tsc --noEmit`) | clean, exit 0 |
| `npm run build` (vite + service-worker stamp + server bundle) | success, exit 0 |

## Preserved guarantees

PR #35 (triage/translation decoupling), PR #36 (centralized `apiUrl()` routing + Capacitor CORS),
PR #37 (multilingual translation quality), PR #38 (primary/structured split), Offline/Resilience mode,
Silent SOS, the speech-lifecycle fixes, the translation architecture, the Android/Capacitor project,
the app icon and CORS are all untouched by this PR.

## Scope note

This document is a review record only. If the reported screenshots can be attached, the exact state (1–4
above) they captured can be identified in a single pass; no code change should be made before that.
