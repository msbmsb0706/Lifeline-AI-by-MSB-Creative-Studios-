/**
 * Android keyboard voice-dictation regression tests (the critical mobile bug):
 *
 *   "User taps the transcript field, activates the Gboard mic, speaks — the
 *    phone hears them, but the transcribed text is dropped and never lands in
 *    the input box."
 *
 * Root cause modelled here: Android IMEs deliver dictation through a
 * *composition session*. While it is active, the DOM holds the growing
 * dictation but the app's React state still holds the PRE-dictation value
 * (onChange is deferred until compositionend). The old controlled
 * `<textarea value={transcript}>` therefore re-applied the stale value to the
 * DOM on re-renders, which makes Android Chrome/WebView cancel the IME
 * session and discard the whole utterance. The fix (src/lib/imeSafeTextarea.ts
 * + src/lib/keyboardFocusGuard.ts) must make the field composition-proof.
 *
 * HOW THE TESTS SIMULATE AN ANDROID IME IN JSDOM
 * ----------------------------------------------
 * jsdom can't replay a real IME, so the tests drive the REAL component's REAL
 * React handlers:
 *   - `__reactProps$` on the DOM node exposes the exact onCompositionStart /
 *     onCompositionEnd / onChange handlers React rendered onto the field.
 *     Invoking them is the same code path a native IME event would take after
 *     React's own event routing (which this suite's module-load order
 *     prevents from receiving synthesized composition events — a jsdom
 *     artifact, not an app behaviour).
 *   - React's change detection tracks `element.value` through a shadowing
 *     setter, so a plain `el.value = x` looks "invisible" to it (real
 *     keystrokes/IME writes bypass the JS setter). The `imeType()` helper
 *     removes that shadow once per element so subsequent `el.value = x` +
 *     `input`/`keyup` dispatches reach React's onChange exactly like native
 *     input would.
 *
 * Covered:
 *   1. an in-progress composition survives re-renders that carry a STALE
 *      transcript value (the old bug), and the compositionend commit reaches
 *      the app state intact — nothing dropped;
 *   2. external writes (server-ASR voice capture) still reach the field;
 *   3. Clear / preset buttons still work;
 *   4. blur resyncs state with the field's real content (IMEs that emit no
 *      trailing input/onChange);
 *   5. the keyboard focus guard restores focus + caret after a "phantom"
 *      blur while the soft keyboard is open;
 *   6. the guard never steals focus the user explicitly moved elsewhere.
 */
import { section, assert, assertEqual } from './helpers.ts';

let jsdomReady = true;
try {
  await import('jsdom');
} catch {
  jsdomReady = false;
}

if (!jsdomReady) {
  section('Mobile dictation input (jsdom missing)');
  assert(true, 'jsdom is not installed — mobile dictation suite skipped (npm install)');
} else {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { TranscriptArea } = await import('../src/components/TranscriptArea.tsx');
  const { installDomHarness, wait } = await import('./dom-harness.ts');

  // ---------------------------------------------------------------------
  // Simulation helpers
  // ---------------------------------------------------------------------

  /** The real React handlers rendered onto the element (React 17+ node key). */
  const getReactProps = (el: any): any => {
    const key = Object.keys(el).find((k: string) => k.startsWith('__reactProps$'));
    return key ? el[key] : null;
  };

  const unshadowed = new WeakSet<any>();

  /**
   * Simulate NATIVE text input (a keystroke or an IME interim phrase):
   * the DOM value changes in a way React's value-tracker sees, then the
   * corresponding native events are dispatched. Covers both React event
   * modes (modern `input`-driven and legacy keyup/keydown/propertychange
   * driven) — at most one onChange fires in either.
   */
  const imeType = async (ta: any, win: any, text: string): Promise<void> => {
    if (!unshadowed.has(ta)) {
      Object.defineProperty(ta, 'value', {
        value: ta.value,
        writable: true,
        configurable: true,
        enumerable: true
      });
      unshadowed.add(ta);
    }
    await act(async () => {
      ta.value = text;
      ta.dispatchEvent(new win.Event('input', { bubbles: true }));
      ta.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    });
  };

  /**
   * Simulate a plain DOM edit (models an IME that emits no React onChange
   * at all): the value changes and a native `input` event fires, but React's
   * change detection is not involved.
   */
  const rawType = async (ta: any, win: any, text: string): Promise<void> => {
    await act(async () => {
      ta.value = text;
      ta.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
  };

  /** Begin/end an IME composition session through the element's REAL React handlers. */
  const compositionStart = async (ta: any): Promise<void> => {
    const props = getReactProps(ta);
    assertEqual(props && typeof props.onCompositionStart === 'function', true,
      'the field exposes a real onCompositionStart handler');
    await act(async () => {
      props.onCompositionStart({ currentTarget: ta, target: ta, nativeEvent: {} });
    });
  };

  const compositionEnd = async (ta: any): Promise<void> => {
    const props = getReactProps(ta);
    assertEqual(props && typeof props.onCompositionEnd === 'function', true,
      'the field exposes a real onCompositionEnd handler');
    await act(async () => {
      props.onCompositionEnd({ currentTarget: ta, target: ta, nativeEvent: {} });
    });
  };

  // ---------------------------------------------------------------------
  // Test harness: the parent owns the `transcript` prop and records every
  // onTranscriptChange call. Applying a recorded change to the prop is done
  // EXPLICITLY by each test — that is how the tests model "React state lags
  // behind the DOM during composition" (the Android IME timing).
  // ---------------------------------------------------------------------
  interface Store {
    transcript: string;
    notice: string;
  }

  const makeHarnessApp = (store: Store, calls: string[], submitted: string[]) =>
    React.createElement(
      'div',
      null,
      React.createElement(TranscriptArea, {
        transcript: store.transcript,
        onTranscriptChange: (text: string) => {
          calls.push(text);
        },
        onSubmitEmergency: (text: string) => {
          submitted.push(text);
        },
        isAnalyzing: false,
        offlineForce: false,
        highContrast: false,
        locationInfo: null,
        onLocationUpdate: () => undefined,
        selectedLanguage: 'en',
        onLanguageChange: () => undefined,
        voiceCapture: null,
        onDismissVoiceCapture: () => undefined,
        voiceNotice: store.notice,
        isVoiceProcessing: false
      })
    );

  const fireVvEvent = (vvMock: any, type: string) => {
    for (const cb of vvMock._listeners[type] || []) cb({ type });
  };

  const makeVvMock = (height: number) => {
    const vvMock: any = {
      height,
      width: 400,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      _listeners: { resize: [] as Array<(e: any) => void>, scroll: [] as Array<(e: any) => void> },
      addEventListener: (type: string, cb: (e: any) => void) => {
        (vvMock._listeners[type] ||= []).push(cb);
      },
      removeEventListener: (type: string, cb: (e: any) => void) => {
        vvMock._listeners[type] = (vvMock._listeners[type] || []).filter((f: any) => f !== cb);
      },
      dispatchEvent: () => true
    };
    return vvMock;
  };

  const openKeyboard = (vvMock: any, openHeight: number) => {
    vvMock.height = openHeight;
    fireVvEvent(vvMock, 'resize');
  };

  // =====================================================================
  // 1. The core regression: an active dictation composition must survive
  //    re-renders that carry a STALE transcript value, and the final
  //    commit must reach the app state intact.
  // =====================================================================
  section('1. In-progress Gboard dictation survives concurrent re-renders');
  {
    const h = installDomHarness();
    const win: any = h.window;
    const doc: any = h.document;
    const root = createRoot(h.root);
    const store: Store = { transcript: 'Help me', notice: '' };
    const calls: string[] = [];
    const submitted: string[] = [];

    try {
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      const ta = doc.getElementById('emergency-transcript-input') as any;
      assertEqual(ta !== null, true, 'transcript field is rendered');
      assertEqual(ta.value, 'Help me', 'initial transcript is visible in the field');

      // The person focuses the field and activates the keyboard microphone.
      await act(async () => {
        ta.focus();
      });
      assertEqual(doc.activeElement, ta, 'the field is focused before dictation starts');

      // Dictation begins: an IME composition session is now active and
      // interim phrases stream into the DOM. The app state still says
      // 'Help me' — on Android, React's onChange is not delivered until
      // compositionend.
      await compositionStart(ta);
      await imeType(ta, win, 'Help me the patient is having');

      // While the person speaks, other app code keeps writing the
      // transcript state (live captions, resets, voice-pipeline updates).
      // Those stale values re-render the tree with a DIFFERENT stale
      // transcript prop — exactly what the old controlled textarea used to
      // stamp into the DOM and what used to cancel the dictation session.
      store.transcript = '';
      store.notice = 'network flap 1';
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      assertEqual(
        ta.value,
        'Help me the patient is having',
        'stale re-render #1 did NOT clobber the in-progress dictation'
      );

      // More speech arrives, then another stale value from app state:
      await imeType(ta, win, 'Help me the patient is having severe chest pain');
      store.transcript = 'Help me';
      store.notice = 'live caption update';
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      assertEqual(
        ta.value,
        'Help me the patient is having severe chest pain',
        'stale re-render #2 (different stale value) did NOT clobber the dictation'
      );

      // The person finishes; Gboard commits the final phrase.
      const FINAL = 'Help me the patient is having severe chest pain. Send an ambulance.';
      ta.value = FINAL;
      await compositionEnd(ta);
      assertEqual(
        calls[calls.length - 1],
        FINAL,
        'the final dictation commit reached the app state — nothing was dropped'
      );

      // The app state catches up (the normal next render cycle):
      store.transcript = FINAL;
      store.notice = '';
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      assertEqual(ta.value, FINAL, 'state and DOM agree after the commit');
      assert(
        calls.includes('Help me the patient is having'),
        'interim dictation text was mirrored live (char count / language badge stay current)'
      );
      assertEqual(submitted.length, 0, 'dictation never auto-submits');
    } finally {
      await act(async () => root.unmount());
      h.cleanup();
    }
  }

  // =====================================================================
  // 2. External writes (server-ASR voice capture) still reach the field —
  //    the fix must not break the app's own voice pipeline.
  // =====================================================================
  section('2. External transcript writes (voice capture) reach the field');
  {
    const h = installDomHarness();
    const doc: any = h.document;
    const root = createRoot(h.root);
    const store: Store = { transcript: '', notice: '' };
    const calls: string[] = [];
    const submitted: string[] = [];

    try {
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      const ta = doc.getElementById('emergency-transcript-input') as any;

      // Server ASR finishes and App does setTranscript(data.transcript) —
      // the field is NOT focused (the person was on the microphone button).
      const VOICE = 'நெஞ்சு வலி உள்ளது, ஆம்புலன்ஸ் அனுப்பவும்.';
      store.transcript = VOICE;
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      assertEqual(ta.value, VOICE, 'voice-capture text is written into the field');

      // Same path when the field had been focused earlier and then blurred
      // (the person looked at the field, then used the mic button).
      await act(async () => {
        ta.focus();
      });
      await act(async () => {
        ta.blur();
      });
      const VOICE2 = 'Second voice capture transcript.';
      store.transcript = VOICE2;
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      assertEqual(ta.value, VOICE2, 'voice-capture text still lands after a prior focus/blur');
    } finally {
      await act(async () => root.unmount());
      h.cleanup();
    }
  }

  // =====================================================================
  // 3. Clear and preset buttons keep working with the IME-safe binding.
  // =====================================================================
  section('3. Clear and preset buttons work through the new binding');
  {
    const h = installDomHarness();
    const win: any = h.window;
    const doc: any = h.document;
    const root = createRoot(h.root);
    const store: Store = { transcript: 'Some typed distress text', notice: '' };
    const calls: string[] = [];
    const submitted: string[] = [];

    try {
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      const ta = doc.getElementById('emergency-transcript-input') as any;
      assertEqual(ta.value, 'Some typed distress text', 'initial text is visible');

      // Clear button: onTranscriptChange('') -> app state -> DOM.
      const clearBtn = doc.getElementById('clear-transcript-btn');
      assertEqual(clearBtn !== null, true, 'clear button is rendered while text exists');
      await act(async () => {
        clearBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(calls[calls.length - 1], '', 'clear reported an empty transcript to the app');
      store.transcript = '';
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      assertEqual(ta.value, '', 'the field is empty after Clear');

      // Preset button fills the field with the scenario text.
      const presetBtn = doc.getElementById('preset-cardiac-en');
      assertEqual(presetBtn !== null, true, 'preset buttons are rendered');
      await act(async () => {
        presetBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      });
      const presetText = calls[calls.length - 1];
      assert(presetText.includes('crushing chest pain'), 'preset click reported the preset text');
      store.transcript = presetText;
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      assertEqual(ta.value, presetText, 'the field shows the preset text');
    } finally {
      await act(async () => root.unmount());
      h.cleanup();
    }
  }

  // =====================================================================
  // 4. Blur resyncs state with the field's real content — covers IMEs that
  //    deliver no trailing `input`/`onChange` for the last edit.
  // =====================================================================
  section('4. Blur resyncs state with the field content');
  {
    const h = installDomHarness();
    const win: any = h.window;
    const doc: any = h.document;
    const root = createRoot(h.root);
    const store: Store = { transcript: '', notice: '' };
    const calls: string[] = [];
    const submitted: string[] = [];

    try {
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      const ta = doc.getElementById('emergency-transcript-input') as any;
      await act(async () => {
        ta.focus();
      });
      // Direct DOM edit — React's onChange is deliberately not involved
      // (an IME that commits silently, or a cancelled preedit retraction).
      await rawType(ta, win, 'Typed text with no trailing input event');
      await act(async () => {
        ta.blur();
      });
      assertEqual(
        calls[calls.length - 1],
        'Typed text with no trailing input event',
        'blur guarantees the final field content reached the app state'
      );
    } finally {
      await act(async () => root.unmount());
      h.cleanup();
    }
  }

  // =====================================================================
  // 5. Keyboard focus guard: a "phantom" blur while the soft keyboard is
  //    open must be repaired (focus + caret restored).
  // =====================================================================
  section('5. Keyboard focus guard restores focus after a phantom blur');
  {
    const h = installDomHarness();
    const win: any = h.window;
    const doc: any = h.document;
    win.scrollBy = () => {};
    // Install a visualViewport mock BEFORE the component mounts so the
    // guard attaches to it (the guard reads window.visualViewport).
    const vvMock = makeVvMock(800);
    Object.defineProperty(win, 'visualViewport', { value: vvMock, configurable: true });
    const root = createRoot(h.root);
    const store: Store = { transcript: 'Start of dictation', notice: '' };
    const calls: string[] = [];
    const submitted: string[] = [];

    try {
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      await wait(20);
      const ta = doc.getElementById('emergency-transcript-input') as any;

      await act(async () => {
        ta.focus();
      });
      // Recent typing activity on the field (native-style edit):
      await rawType(ta, win, 'Start of dictation, more words');
      ta.setSelectionRange(3, 3);
      await act(async () => {
        ta.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true, key: 'w' }));
      });

      // The keyboard opens (visual viewport shrinks):
      openKeyboard(vvMock, 340);
      await wait(40);

      // A layout jump blurs the field without any user focus move — the
      // exact condition that used to cancel Android voice dictation.
      await act(async () => {
        ta.blur();
      });
      assertEqual(doc.activeElement, doc.body, 'the field was blurred (phantom blur)');
      await wait(60); // the guard repairs on the next task/frame
      assertEqual(doc.activeElement, ta, 'the guard restored focus to the field');
      assertEqual(ta.selectionStart, 3, 'the caret position was restored');
    } finally {
      await act(async () => root.unmount());
      h.cleanup();
    }
  }

  // =====================================================================
  // 6. The guard must NEVER steal focus the user explicitly moved elsewhere.
  // =====================================================================
  section('6. Keyboard focus guard never steals intentional focus moves');
  {
    const h = installDomHarness();
    const win: any = h.window;
    const doc: any = h.document;
    win.scrollBy = () => {};
    const vvMock = makeVvMock(800);
    Object.defineProperty(win, 'visualViewport', { value: vvMock, configurable: true });
    const root = createRoot(h.root);
    const store: Store = { transcript: 'Some text', notice: '' };
    const calls: string[] = [];
    const submitted: string[] = [];

    try {
      await act(async () => {
        root.render(makeHarnessApp(store, calls, submitted));
      });
      await wait(20);
      const ta = doc.getElementById('emergency-transcript-input') as any;
      const gpsBtn = doc.getElementById('attach-gps-location-btn') as any;
      assertEqual(gpsBtn !== null, true, 'a second control exists to move focus to');

      await act(async () => {
        ta.focus();
      });
      await rawType(ta, win, 'Some text and more');
      openKeyboard(vvMock, 340);
      await wait(40);

      // The person intentionally taps another control (e.g. Attach GPS):
      // the field blurs AND focus moves to the button.
      await act(async () => {
        ta.blur();
        gpsBtn.focus();
      });
      assertEqual(doc.activeElement, gpsBtn, 'focus moved to the tapped control');
      // ...and the control is dismissed again (focus falls back to <body>):
      await act(async () => {
        gpsBtn.blur();
      });
      await wait(60);
      assertEqual(
        doc.activeElement,
        doc.body,
        'the guard did NOT yank focus back to the field after an intentional move'
      );
    } finally {
      await act(async () => root.unmount());
      h.cleanup();
    }
  }
}
