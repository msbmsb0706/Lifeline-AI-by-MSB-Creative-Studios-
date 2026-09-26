# Android Keyboard Voice Dictation — Root Cause & Fix

**Symptom (as reported):** On Android (Chrome or an Android WebView container),
a user taps the main transcript field, activates the keyboard's
microphone/dictation key (e.g. Gboard voice typing), and speaks. The phone
clearly hears them — but the transcribed text is dropped and **never lands in
the input box**.

This page documents the root cause, the fix that was implemented in this
codebase, and the Android WebView host-app configuration required for the fix
to be complete end-to-end.

---

## 1. Root cause

On Android, keyboard voice dictation (Gboard and every other IME) does not
"pretend to type". It delivers text through an **IME composition session**:

```
tap mic ──▶ compositionstart
speaking ──▶ interim phrases stream into the field's DOM value (preedit)
finish   ──▶ compositionend (the ONLY event that carries the final commit)
```

Two things about this codebase turned that into data loss:

### 1a. The IME composition conflict (the main bug)

The transcript field was a fully React-controlled input
(`value={transcript}` + `onChange`). During a dictation session the DOM holds
the growing dictation text, but the React `transcript` state still holds the
**pre-dictation** value — React's `onChange` is not trusted to fire per-interim
for IME text; the commit arrives at `compositionend`. LifeLine AI re-renders
its tree for unrelated reasons at all times (network `online`/`offline` flaps
→ `setNetworkAvailable`, the partner-queue subscription →
`setPendingQueueCount`, service-worker status → `setOfflineShellReady`, the
voice pipeline → `setVoiceNotice`/`setVoiceCapture`). Any re-render in that
window makes React write the stale `value` prop back into the DOM.

**Android's Chromium backend treats that external script write as a command
override: it cancels the IME session and discards the entire dictation
buffer.** That is exactly the reported symptom.

### 1b. The viewport-shrink blur

When the soft keyboard slides up, the visual viewport undergoes a sudden
layout jump. Without defensive focus handling, the focused textarea can
experience a momentary `blur()` (container layout pass, or the field pushed
out of the visual viewport). **On Android a blur event instantly kills active
voice dictation.**

---

## 2. What was changed

| File | Change |
|---|---|
| `src/utils/imeHelpers.ts` | **New** — decoupled IME composition-session manager: `activeIMESession` singleton, `isImeComposing(el)` gate, `commitImeValueToState()` deterministic commit, `imeEventHandlers` (see §3.1). |
| `src/utils/viewportGuard.ts` | **New** — `setupViewportGuard(element)`: keyboard visual-viewport guard (see §3.2). |
| `src/components/TranscriptArea.tsx` | Transcript field is now an IME-resilient uncontrolled input (no `value` prop; state->DOM sync gated on `isImeComposing`; authoritative commit on `compositionend`/`blur`), viewport guard bound to its ref, IME input attributes; Enter-to-submit reads the DOM value directly. |
| `src/components/SilentSOS.tsx` | Same IME-resilient pattern applied to the Silent SOS message field (same bug class). |
| `src/App.tsx` | `onTranscriptChange` is a stable `useCallback` (the binding mirrors every input event through it, including mid-dictation interim text). |
| `index.html` | Viewport meta: `viewport-fit=cover, interactive-widget=resizes-visual`. |
| `src/index.css` | `overscroll-behavior: none` on `html, body` (no pull-to-refresh/gesture yank while the keyboard is open). |
| `tests/mobile-dictation-input.test.ts` | **New** — 27-assertion regression suite (real `TranscriptArea` in jsdom: stale re-renders mid-composition, commit integrity, external writes, clear/preset, blur resync, focus-guard restore + no-focus-theft). |
| `tests/dom-harness.ts` | No-op `attachEvent`/`detachEvent` shims (React's legacy change-event polyfill path under jsdom) — test infra only. |
| `tests/helpers.ts` | `assertEqual` no longer `JSON.stringify`s DOM nodes eagerly (it crashed on passing object comparisons). |

---

## 3. How the fix works

### 3.1 IME-resilient inputs (`src/utils/imeHelpers.ts`)

The design goal: **React keeps its state loop, but never programmatically
overwrites the native DOM value while an IME composition session is active in
that field.** Concretely, each protected field (TranscriptArea, SilentSOS):

1. **Renders its textarea without a `value` prop** (uncontrolled, with
   `defaultValue` for the initial mount value). React therefore can never
   write the DOM value — no re-render loop can reset the composition string
   mid-speech.
2. **Mirrors every DOM change up to state via `onChange`** — plain typing
   *and* IME interim text, so the char count, detected-language badge and
   submit button stay live.
3. **Gates the state→DOM sync effect** — the only place state can reach the
   DOM (external writes: server-ASR voice capture, presets, Clear):

   ```ts
   useEffect(() => {
     const el = textareaRef.current;
     if (el && !isImeComposing(el) && el.value !== transcript) {
       el.value = transcript;
     }
   }, [transcript]);
   ```

   `isImeComposing(el)` reads the `activeIMESession` singleton set
   **synchronously** by `imeEventHandlers.onCompositionStart` (it does not
   rely on `e.nativeEvent.isComposing`, which is not reliable across every
   Android IME build). The element argument matters: a composition in the
   Silent SOS field never blocks a state→DOM sync in the transcript field.
4. **Commits authoritatively on `compositionend` and `blur`** via
   `commitImeValueToState(el, state, setState)` — a direct read of the DOM
   value pushed into state. Some Android IMEs deliver the final dictation
   text with `compositionend` itself and never fire a trailing `input`, so
   the DOM must be read directly (the utility also dispatches a synthesized
   `input` event as a second, browser-native path through React's
   value-tracker `onChange`; the two are idempotent together). The `blur`
   commit covers an IME retracting preedit text — state always ends equal to
   what the user sees.
5. **No debounce anywhere on this path.** The mirrors are synchronous; the
   async state round-trip is precisely what let the old code stamp stale
   text into a live composition.
6. **Enter-to-submit reads `e.currentTarget.value`** (the DOM), so even if a
   dictation commit and the Enter key land in the same batch, the submitted
   text is what the user sees.

### 3.2 Keyboard visual-viewport guard (`src/utils/viewportGuard.ts`)

`setupViewportGuard(element)` (bound to each field's ref on mount; returns a
cleanup). Defensive, best-effort, never throws, no-op on desktop:

- **Keyboard state:** tracks `window.visualViewport.height` (debounced
  `window.resize` fallback). A drop of >120px below the running baseline =
  keyboard open; growth back = closed. Baseline re-sets on orientation change.
- **Keep-in-view:** while the keyboard is open **and the field owns focus**,
  the field is kept ≥12px inside the visual viewport (rAF-throttled minimal
  `scrollBy` — `getBoundingClientRect` is already visual-viewport-relative).
  Android dismisses the IME when its target is not visible.
- **Phantom-blur repair:** if the field blurs while the keyboard is open and
  focus dropped to `<body>` (layout jump / container glitch) with recent
  typing/IME activity, focus is restored with `focus({preventScroll:true})`
  plus the saved caret/selection (saved on focus/input/keyup/click/
  compositionend).
- **Never fights the user:** focus moves to another control (document-level
  `focusin`, 1.2s window) are never overridden — a naive
  `setTimeout(() => el.focus(), 30)` would yank focus back 30ms after the
  user taps *any* other control (Attach GPS, a preset, a modal), which is a
  real regression in an emergency app. The guard also requires recent
  activity, backs off after 3 failed refocus attempts, and never grabs focus
  in a backgrounded tab or on a disabled element.

Document-level (capture) listeners mean the guard survives React remounting
the element without re-attaching.

### 3.3 HTML attributes + WebView host configuration

**Input attributes (now on the transcript and Silent SOS fields):**

| Attribute | Why |
|---|---|
| `autoComplete="off"` | No autofill suggestions/rewrites of emergency text. |
| `autoCapitalize="sentences"` | Dictation already capitalizes; typed messages get normal sentence capitalization. |
| `autoCorrect="off"` | The IME must never "fix" a verbatim emergency message after the user finishes speaking. |
| `spellCheck={false}` | No spell-rewrite layer over distress text (10+ languages). |
| `enterKeyHint="send"` (transcript field) | The field submits on Enter, so the keyboard's action key shows Send. |
| `inputMode="text"` | Explicitly keep the full IME-capable keyboard (voice dictation needs it; never `decimal`/`none`). |
| `dir="auto"` / `lang="mul"` | RTL/LTR and multilingual text render correctly. |

**Viewport meta (`index.html`):**

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-visual">
```

`interactive-widget=resizes-visual` (Chrome 108+): when the keyboard opens,
only the **visual** viewport resizes — the layout viewport keeps its size, so
the page does **not** reflow while the IME is active. That removes the layout
jump behind root cause 1b. Deliberate choices:

- `resizes-visual`, **not** `resizes-content`: `resizes-content` (the
  default) shrinks the *layout* viewport on keyboard open → full reflow +
  `resize` storm → exactly the layout jump that can blur the focused input.
- **No `maximum-scale=1.0, user-scalable=no`**: an emergency app must stay
  pinch-zoomable (WCAG 1.4.4); disabling zoom is an accessibility regression
  for the people most likely to use it.

**CSS (`src/index.css`):** `html, body { overscroll-behavior: none; }` —
stops pull-to-refresh / rubber-banding / gesture navigation from yanking the
page (and blurring the input) while the soft keyboard is open.

**Android WebView host-app configuration** (for the container app — the
frontend cannot fix these itself):

```kotlin
// AndroidManifest.xml — the Activity hosting the WebView:
//   android:windowSoftInputMode="adjustResize"
//   (NEVER adjustNothing/adjustPan: the WebView must receive a real layout
//    resize so visualViewport reports the keyboard correctly.)

val webview = findViewById<WebView>(R.id.webview)
webview.settings.apply {
    javaScriptEnabled = true
    domStorageEnabled = true          // the app persists opt-ins in localStorage
    mediaPlaybackRequiresUserGesture = false // in-app alert pings/voice
    geolocationEnabled = true         // the app requests GPS only after explicit consent
    builtInZoomControls = false       // pinch-zoom fighting the keyboard causes the same blur class of bug
    displayZoomControls = false
    useWideViewPort = true
    loadWithOverviewMode = false
}
```

Note: `webView.requestFocus(View.FOCUS_DOWN)` / `setFocusable(true)` /
`setFocusableInTouchMode(true)` are standard WebView hygiene (hardware-key
focus routing) but are **not** what makes IME text injection work — the soft
keyboard writes into the focused DOM element regardless; the fixes that
matter are `adjustResize`, a DOM that never fights the IME (§3.1), and the
container pitfalls below.

**Container pitfalls that independently cause this exact bug** — do not do
these in the host app:

1. Do **not** run `evaluateJavascript`/`loadUrl("javascript:...")` that touches
   `document.activeElement`, calls `.blur()`, or writes any input's `.value`
   while the soft keyboard is open (a "restore focus/scroll" script is the
   #1 container-side cause of dropped dictation).
2. Do not overlay a non-click-through view on top of the WebView during the
   keyboard animation (it can intercept focus).
3. If you inject a wrapper document, keep it out of `position: fixed` layers
   over the input; `interactive-widget=resizes-visual` depends on an
   unobstructed visual viewport.

---

## 4. Regression coverage

`tests/mobile-dictation-input.test.ts` (27 assertions, real `TranscriptArea`
in jsdom) reproduces the failure modes:

1. **Core regression** — an active composition survives re-renders that carry
   a *stale* transcript value (the old bug), interim text is mirrored live,
   and the `compositionend` commit reaches app state verbatim — nothing
   dropped.
2. External writes (server-ASR voice capture) still reach the field.
3. Clear / preset buttons still work through the new binding.
4. Blur resyncs state with the field's real content.
5. Focus guard restores focus **and caret** after a phantom blur with the
   keyboard open.
6. Focus guard never steals an intentional focus move.

Run with `npm test` (the full suite is 4200+ assertions).

## 5. Device verification checklist (QA)

For each environment — **Android Chrome**, **installed PWA**, **app WebView**:

1. Cold start, tap the transcript field, tap the keyboard mic, speak a full
   sentence (≥10 words, pause mid-sentence so Gboard updates interim text).
   → The field fills live; on commit the full text is present, char count and
     detected-language badge correct.
2. Repeat while toggling Airplane Mode mid-sentence (network flap = the
   re-render that used to kill the session). → Text still lands.
3. Use Gboard **transliteration** (e.g. type "namaste" in Devanagari mode) and
   tap away. → Commit survives.
4. Long dictation that pushes the field near the bottom of the screen. →
   The field scrolls to stay visible; dictation is never cancelled.
5. Dictate, then tap **Attach GPS** (keyboard open, focus moves away), then
   dismiss. → Focus is **not** yanked back to the field.
6. Run the app's own microphone button, then tap the field and dictate. →
   No lost text; submit (Ctrl+Enter / Enter) sends what is visible.
7. Silent SOS: dictate into the optional message field. → Same guarantees.
