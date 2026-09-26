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

Three things about this codebase turned that into data loss:

### 1a. A controlled textarea re-applies a stale value mid-composition

The transcript field was a fully React-controlled input:

```tsx
<textarea value={transcript} onChange={(e) => onTranscriptChange(e.target.value)} />
```

During a dictation session the DOM holds the growing dictation text, but the
React `transcript` state still holds the **pre-dictation** value — React's
`onChange` is not trusted to fire per-interim for IME text; the commit arrives
at `compositionend`. LifeLine AI re-renders its tree for unrelated reasons at
all times (network `online`/`offline` flaps → `setNetworkAvailable`, the
partner-queue subscription → `setPendingQueueCount`, service-worker status,
the voice pipeline, geolocation). Any re-render in that window makes React
write the stale `value` prop back into the DOM.

**A programmatic `textarea.value = <stale>` write while a composition session
is active makes Android Chrome / WebView cancel the IME session and silently
discard the entire pending utterance.** That is exactly the reported symptom.

### 1b. Nothing keeps the field focused/visible while the keyboard animates

When the soft keyboard opens, the visual viewport shrinks. In WebView
containers (or with legacy `resizes-content` behaviour) that is a full layout
reflow plus a page scroll. If the focused field moves out of the visual
viewport — or the container's layout pass blurs it — Android fires `blur()` on
the composing element, which **also cancels the dictation session**. The app
had no `visualViewport` handling at all, and the transcript box sits well
below the fold.

### 1c. Missing hardening

- The viewport `meta` did not opt into `interactive-widget=resizes-visual`,
  so older Chrome behaviour (resize the *layout* viewport on keyboard open →
  reflow → layout/scroll/focus churn) applied.
- The field lacked `autoCorrect`/`autoCapitalize`/`spellCheck`/`enterKeyHint`
  tuning, and the WebView host configuration (below) was not specified.

---

## 2. What was changed

| File | Change |
|---|---|
| `src/lib/imeSafeTextarea.ts` | **New** — `useImeSafeTextarea()` hook: the composition-proof input binding (see §3.1). |
| `src/lib/keyboardFocusGuard.ts` | **New** — `attachKeyboardFocusGuard()`: focus + visual-viewport guard (see §3.2). |
| `src/components/TranscriptArea.tsx` | Transcript field now uses the IME-safe binding (no `value` prop), IME input attributes, guard attached; Enter-to-submit reads the DOM value directly. |
| `src/components/SilentSOS.tsx` | Same IME-safe binding applied to the Silent SOS message field (same bug class). |
| `src/App.tsx` | `onTranscriptChange` is now a stable `useCallback` (the binding mirrors every input event through it, including mid-dictation interim text). |
| `index.html` | Viewport meta: `viewport-fit=cover, interactive-widget=resizes-visual`. |
| `src/index.css` | `overscroll-behavior: none` on `html, body` (no pull-to-refresh/gesture yank while the keyboard is open). |
| `tests/mobile-dictation-input.test.ts` | **New** — 27-assertion regression suite (real `TranscriptArea` in jsdom: stale re-renders mid-composition, commit integrity, external writes, clear/preset, blur resync, focus-guard restore + no-focus-theft). |
| `tests/dom-harness.ts` | No-op `attachEvent`/`detachEvent` shims (React's legacy change-event polyfill path under jsdom) — test infra only. |
| `tests/helpers.ts` | `assertEqual` no longer `JSON.stringify`s DOM nodes eagerly (it crashed on passing object comparisons). |

---

## 3. How the fix works (answers to the three questions)

### 3.1 Uncontrolled-during-composition input (the core fix)

`useImeSafeTextarea(value, onTextChange)` keeps the parent as the single
source of truth while making it **impossible for a re-render to clobber an
active IME session**:

1. **The textarea is rendered without a `value` prop.** React therefore never
   writes the DOM value — no re-render loop, debounce or not, can reset the
   composition string mid-speech. (This is deliberately *not* a "just remove
   value" hack: everything below keeps state and DOM in lockstep.)
2. **DOM → state mirrors, synchronously, on every event that matters:**
   - every `input` event (plain typing *and* IME interim text — the char
     count, detected-language badge and submit button stay live),
   - `compositionend` — the **authoritative commit** (some Android IMEs
     deliver the final text with `compositionend` itself and never fire a
     trailing `input`, so the handler re-reads the DOM, not the event),
   - `blur` — catches an IME retracting preedit text (e.g. dictation
     cancelled), so state always ends equal to what the user sees.
3. **State → DOM happens in one guarded effect** for external writes only
   (server-ASR voice capture, presets, Clear):

   ```ts
   useEffect(() => {
     const el = ref.current;
     if (!el) return;
     if (composingRef.current) return;  // ← the IME owns the value; NEVER touch it
     if (el.value !== value) el.value = value;
   }, [value]);
   ```

   `composingRef` is set **synchronously** from native `compositionstart` /
   `compositionend` — it does not rely on `e.nativeEvent.isComposing`, which
   is not reliable across every Android IME build.
4. **No debouncing anywhere on this path.** The mirror is synchronous; the
   only "delay" is React's own commit, and because the DOM is unowned by
   React, a late commit is harmless. (Debounce would be *worse* here: it is
   precisely the async value round-trip that let the old code stamp stale
   text into a live composition.)
5. **Enter-to-submit reads `e.currentTarget.value`** (the DOM) instead of the
   state prop, so even if a dictation commit and the Enter key land in the
   same batch, the submitted text is what the user sees.

External writes (e.g. the server-ASR path doing `setTranscript(data.transcript)`)
arrive as a prop change and are written to the field by the effect — always
while the field is unfocused in practice (the user was on the microphone
button), and protected by the composition guard regardless.

### 3.2 Focus + visual-viewport guard (`keyboardFocusGuard.ts`)

Attached to the field's ref on mount. Defensive, best-effort, never throws,
no-op on desktop:

- **Keyboard state:** tracks `window.visualViewport.height` (fallback:
  `window.resize`, debounced). A drop of >120px below the running baseline =
  keyboard open; growth back = closed. Baseline re-sets on orientation change.
- **Keep-in-view:** while the keyboard is open **and the field owns focus**,
  the field is kept ≥12px inside the visual viewport
  (`getBoundingClientRect` is already visual-viewport-relative; a minimal
  `window.scrollBy(delta)` corrects any shortfall, rAF-throttled). Android
  dismisses the IME when its target is not visible — this prevents the most
  common "text dropped" variant in WebView containers.
- **Phantom-blur repair:** if the field blurs while the keyboard is open and
  focus dropped to `<body>` (layout jump / container glitch) and there was
  recent typing/IME activity, the guard re-focuses with
  `focus({ preventScroll: true })` and restores the saved caret/selection
  (saved on focus/input/keyup/click/compositionend).
- **Never fights the user:** focus moves to another control (tracked via a
  document-level `focusin` with a 1.2s window) are never overridden; the
  guard requires recent activity, backs off after 3 failed refocus attempts,
  and never grabs focus in a backgrounded tab.

The document-level (capture) listeners mean the guard survives React
remounting the element without re-attaching.

### 3.3 HTML attributes + WebView host configuration

**Input attributes (now on the transcript and Silent SOS fields):**

| Attribute | Why |
|---|---|
| `autoComplete="off"` | No autofill suggestions/rewrites of emergency text. |
| `autoCapitalize="sentences"` | Dictation already capitalizes; typed messages get normal sentence capitalization. |
| `autoCorrect="off"` | The IME must never "fix" a verbatim emergency message after the user finishes speaking. |
| `spellCheck={false}` | No red squigglies / rewrites over distress text (10+ languages). |
| `enterKeyHint="send"` | The field submits on Enter (existing behaviour), so the keyboard's action key shows Send. |
| `inputMode="text"` | Explicitly keep the full IME-capable keyboard (voice dictation needs it; never `decimal`/`none`). |
| `dir="auto"` / `lang="mul"` | RTL/LTR and multilingual text render correctly. |

**Viewport meta (`index.html`):**

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-visual">
```

`interactive-widget=resizes-visual` (Chrome 108+): when the keyboard opens,
only the **visual** viewport resizes — the layout viewport keeps its size, so
the page does **not** reflow while the IME is active. This removes the layout
jump that used to blur the focused input (which cancels dictation). Older
engines ignore the attribute and keep working.

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
